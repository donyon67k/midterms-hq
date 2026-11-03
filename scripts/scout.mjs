// Call scout: election-night race calls from the decision desks, with sources.
//   npm run scout          (key in .secrets/anthropic-api-key.txt, or ANTHROPIC_API_KEY)
//   review page:           http://localhost:5299
//
// For every key race whose polls have closed, Claude searches the web for an explicit
// call by a decision desk (AP, Decision Desk HQ, NBC, CNN, ABC, CBS, Fox News) and for the
// latest vote count (official state/county results first). The scout then decides:
//   AUTO-CALL   2+ desks name the same winner, at least one claim is confirmed by reading
//               the cited page here, no desk disagrees, and the count isn't razor-close
//   ASK HQ      desks disagree, a lone desk call stays alone for 10+ minutes, the winner
//               isn't a listed candidate, or nothing can be confirmed (review page + Mac alert)
// Calls and counts go to live/scout.json on the `live` branch, which every copy reads.
//
// Env: SCOUT_BUDGET (US$ estimate the scout stops at, default 75), SCOUT_WORKERS (default 8),
//      SCOUT_ALL=1 (also safe House seats)
import Anthropic from '@anthropic-ai/sdk'
import { execFile } from 'node:child_process'
import { createServer } from 'node:http'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { publishLive } from './admin-plugin.mjs'
import { fetchAll } from '../src/data/live.js'
import { STATES } from '../src/data/wiki.js'
import { pollCloseFor, raceTitle } from '../src/lib/util.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'live/scout.json')
const STATE_FILE = join(ROOT, 'live/scout-state.json') // local only: review queue, decisions
const PORT = 5299
const MODEL = 'claude-opus-5-5'
const BUDGET = +process.env.SCOUT_BUDGET || 75
const WORKERS = +process.env.SCOUT_WORKERS || 8
// Spend estimate: Claude Opus 5.5 tokens ($4 in / $20 out per million) plus web searches (~$10 per 1,000).
const spent = () => (usage.inTok * 4 + usage.outTok * 20) / 1e6 + usage.searches * 0.01
const HOT_EVERY = 2 * 60 * 1000 // tossup-ish and Senate/Governor races
const KEY_EVERY = 6 * 60 * 1000
const RECHECK_CALLED = 10 * 60 * 1000 // one more look after a call, to catch a retraction
const LONE_DESK_ASK = 10 * 60 * 1000
const CLOSE_MARGIN = 0.5 // points; tighter than this always goes to HQ

export const DESKS = ['AP', 'Decision Desk HQ', 'NBC News', 'CNN', 'ABC News', 'CBS News', 'Fox News']

function apiKey() {
  if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY
  const f = join(ROOT, '..', '.secrets', 'anthropic-api-key.txt')
  if (existsSync(f)) return readFileSync(f, 'utf8').trim()
  console.error('No Anthropic API key. Save it to CLAUDE HOME/.secrets/anthropic-api-key.txt (one line), then run npm run scout again.')
  process.exit(1)
}
const client = new Anthropic({ apiKey: apiKey(), maxRetries: 3 })

// ---------- state ----------
const load = (f, d) => { try { return JSON.parse(readFileSync(f, 'utf8')) } catch { return d } }
const pub = load(OUT, { calls: {}, counts: {}, official: {} }) // what viewers see
const st = load(STATE_FILE, { review: {}, ignored: [], firstLone: {} })
const usage = { searches: 0, inTok: 0, outTok: 0, checks: 0, errors: 0 }
const log = []
const say = (msg) => { const line = `[${new Date().toLocaleTimeString()}] ${msg}`; console.log(line); log.unshift(line); log.length = Math.min(log.length, 200) }
const saveState = () => { mkdirSync(dirname(STATE_FILE), { recursive: true }); writeFileSync(STATE_FILE, JSON.stringify(st, null, 2)) }

let races = {}
let dirty = false
let paused = false

// ---------- race list ----------
async function refreshRaces() {
  const d = await fetchAll()
  if (!d) return
  const all = [...Object.values(d.senate), ...Object.values(d.governor), ...Object.values(d.house).flat()]
  races = Object.fromEntries(all.map((r) => [r.id, r]))
}
const score = (r) => Math.abs(r.consensus?.score ?? 0)
const inScope = (r) => r.type !== 'house' || process.env.SCOUT_ALL === '1' || score(r) < 3
const isHot = (r) => r.type !== 'house' || score(r) <= 1
const closed = (r) => { const w = pollCloseFor(r.state); return w && w.at <= new Date() }

const nextAt = {}
function pick() {
  const now = Date.now()
  const ready = Object.values(races).filter((r) => inScope(r) && closed(r) && !st.ignored.includes(r.id) && !busy.has(r.id) && (nextAt[r.id] ?? 0) <= now)
  ready.sort((a, b) => (nextAt[a.id] ?? 0) - (nextAt[b.id] ?? 0) || (isHot(b) - isHot(a)) || score(a) - score(b))
  return ready[0]
}

// ---------- asking Claude ----------
const REPORT_TOOL = {
  name: 'report',
  description: 'Report what you found for this race. Call it exactly once, at the end.',
  strict: true,
  input_schema: {
    type: 'object',
    additionalProperties: false,
    required: ['calls', 'count', 'official_results_url', 'notes'],
    properties: {
      calls: {
        type: 'array',
        description: 'One entry per decision desk that has explicitly projected/called a winner in the Nov 3, 2026 general election. Empty if none.',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['desk', 'outlet', 'winner', 'url', 'quote'],
          properties: {
            desk: { type: 'string', enum: [...DESKS, 'Other'], description: 'Whose call it is. Outlets that publish AP calls (NYT, Washington Post, etc.) count as AP.' },
            outlet: { type: 'string', description: 'Where you read it, e.g. "AP News", "New York Times (AP call)"' },
            winner: { type: 'string', description: 'Full name of the projected winner' },
            url: { type: 'string', description: 'https URL of the page that states the call' },
            quote: { type: 'string', description: 'The exact sentence from that page stating the call' },
          },
        },
      },
      count: {
        type: 'object',
        additionalProperties: false,
        required: ['found', 'pct_expected_in', 'candidates', 'source', 'url', 'as_of'],
        properties: {
          found: { type: 'boolean', description: 'false if you found no vote count' },
          pct_expected_in: { type: ['number', 'null'], description: 'Percent of expected vote counted (0-100)' },
          candidates: {
            type: 'array',
            items: { type: 'object', additionalProperties: false, required: ['name', 'votes', 'pct'], properties: { name: { type: 'string' }, votes: { type: ['number', 'null'] }, pct: { type: ['number', 'null'] } } },
          },
          source: { type: 'string', description: 'Who published these numbers, e.g. "Pennsylvania Department of State" or "AP via NBC News"' },
          url: { type: 'string' },
          as_of: { type: 'string', description: 'Time of the numbers as shown on the page, if any' },
        },
      },
      official_results_url: { type: 'string', description: "The state's official election-night results page, or an empty string" },
      notes: { type: 'string', description: 'One short line: anything confusing or contradictory' },
    },
  },
}

const SYSTEM = `You are the call desk researcher for Midterms HQ, a nonpartisan election-results dashboard. Today is Tuesday, November 3, 2026, the U.S. midterm general election; results are coming in now.

For the race you are given, use web search to find:
1. Whether any decision desk has CALLED (projected) the winner of the 2026 general election: AP, Decision Desk HQ, NBC News, CNN, ABC News, CBS News, Fox News. Outlets that show AP race calls (New York Times, Washington Post, many local papers) count as AP.
2. The latest vote count, preferring the state's official election-night results site or a county election office, otherwise AP numbers as shown by an outlet.

A call counts ONLY when the page explicitly says the desk projected, called or declared a winner ("AP: X wins", "NBC News projects X will win", a checkmark labeled as an AP call). These are NOT calls: a candidate leading, "expected to win", forecasts or ratings, a candidate declaring victory, a concession you cannot tie to a desk call, primary results, or 2024 results. If you are unsure whether something is a call, leave it out and say why in notes. Never guess a URL or a quote: copy the URL of the page you actually read and the sentence as written. Work quickly: a few targeted searches are enough. Finish by calling the report tool exactly once.`

function racePrompt(r) {
  const cands = r.candidates.slice(0, 6).map((c) => `${c.name} (${c.party})`).join(', ') || 'unknown'
  const have = pub.calls[r.id]?.sources?.map((s) => s.desk).join(', ')
  return `Race: ${raceTitle(r, STATES)} — 2026 general election.
Candidates: ${cands}.
Incumbent party: ${r.incumbent?.party || 'unknown'}.${have ? `\nAlready seen calls from: ${have} (check whether they still stand, and look for other desks).` : ''}`
}

async function ask(r) {
  const messages = [{ role: 'user', content: racePrompt(r) }]
  for (let turn = 0; turn < 4; turn++) {
    const res = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'low' }, // a lookup, not deep reasoning: faster and cheaper
      system: SYSTEM,
      tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 4 }, REPORT_TOOL],
      messages,
    })
    usage.inTok += res.usage?.input_tokens || 0
    usage.outTok += res.usage?.output_tokens || 0
    usage.searches += res.usage?.server_tool_use?.web_search_requests || 0
    if (res.stop_reason === 'refusal') throw new Error('declined by the model')
    const report = res.content.find((b) => b.type === 'tool_use' && b.name === 'report')
    if (report) return report.input
    messages.push({ role: 'assistant', content: res.content })
    if (res.stop_reason === 'pause_turn') continue
    messages.push({ role: 'user', content: 'Now call the report tool with what you found.' })
  }
  throw new Error('no report returned')
}

// ---------- checking the model's claims ----------
const surname = (n) => n.toLowerCase().replace(/[.,]/g, '').split(/\s+/).filter((w) => !/^(jr|sr|ii|iii|iv)$/.test(w)).pop() || ''
const matchCand = (r, name) => r.candidates.find((c) => surname(c.name) === surname(name)) || r.candidates.find((c) => name.toLowerCase().includes(surname(c.name)))
const https = (u) => (typeof u === 'string' && /^https:\/\/[^\s"<>]+$/.test(u) ? u : null)

// Read the cited page ourselves: the winner's name and call language must actually be there.
async function verify(claim) {
  try {
    const res = await fetch(claim.url, { headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh) MidtermsHQ-scout' }, signal: AbortSignal.timeout(9000), redirect: 'follow' })
    if (!res.ok) return false
    const text = (await res.text()).replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').toLowerCase()
    return text.includes(surname(claim.winner)) && /\b(projects?|projected|wins|won|winner|re-?elected|defeats?|declared|race call)\b/.test(text)
  } catch { return false }
}

const notify = (title, body) => execFile('osascript', ['-e', `display notification ${JSON.stringify(body)} with title ${JSON.stringify(title)} sound name "Glass"`], () => {})

function countFrom(r, c) {
  if (!c?.found || !Array.isArray(c.candidates) || !c.candidates.length) return null
  const cands = c.candidates.slice(0, 6).map((x) => ({ name: String(x.name).slice(0, 80), party: matchCand(r, String(x.name))?.party || 'I', votes: Number.isFinite(x.votes) ? x.votes : null, pct: Number.isFinite(x.pct) ? x.pct : null }))
  return { pctIn: Number.isFinite(c.pct_expected_in) ? c.pct_expected_in : null, cands, source: String(c.source || '').slice(0, 120), url: https(c.url), asOf: String(c.as_of || '').slice(0, 60), at: new Date().toISOString() }
}

async function check(r) {
  usage.checks++
  const rep = await ask(r)
  const now = Date.now()
  const count = countFrom(r, rep.count)
  if (count) { pub.counts[r.id] = count; dirty = true }
  const off = https(rep.official_results_url)
  if (off && /\.(gov|us)(\/|$)/.test(new URL(off).hostname + '/') && !pub.official[r.state]) { pub.official[r.state] = off; dirty = true }

  const claims = (rep.calls || []).filter((c) => https(c.url) && c.winner && c.desk !== 'Other')
  for (const c of claims) c.verified = await verify(c)
  for (const c of claims) c.cand = matchCand(r, c.winner)
  const winners = [...new Set(claims.map((c) => (c.cand ? c.cand.name : `?${c.winner}`)))]
  const desks = [...new Set(claims.map((c) => c.desk))]
  const lead = count?.cands?.filter((c) => c.pct != null).sort((a, b) => b.pct - a.pct)
  const margin = lead?.length > 1 ? lead[0].pct - lead[1].pct : null
  const ask_ = (why) => {
    if (!st.review[r.id]) { notify('Midterms HQ scout: needs you', `${raceTitle(r, STATES)}: ${why}`); say(`ASK HQ · ${raceTitle(r, STATES)} · ${why}`) }
    st.review[r.id] = { why, claims: claims.map(({ cand, ...c }) => ({ ...c, party: cand?.party || null })), count, notes: rep.notes, at: now }
    saveState()
  }
  nextAt[r.id] = now + (isHot(r) ? HOT_EVERY : KEY_EVERY)

  const existing = pub.calls[r.id]
  if (!claims.length) {
    delete st.firstLone[r.id]
    if (existing?.by === 'auto') ask_(`was auto-called for ${existing.winner}, but no desk call was found on this check (retracted, or just not found?)`)
    return
  }
  if (winners.length > 1) return ask_(`desks disagree: ${winners.join(' vs ')}`)
  const winner = claims[0].cand
  if (!winner) return ask_(`called for "${claims[0].winner}", who isn't a listed candidate`)
  if (existing && existing.winner !== winner.name) return ask_(`now called for ${winner.name}, but HQ shows ${existing.winner}`)
  if (existing) { // already on the board: just add new desks
    const have = new Set(existing.sources.map((s) => s.desk))
    const add = claims.filter((c) => !have.has(c.desk)).map((c) => ({ desk: c.desk, url: c.url }))
    if (add.length) { existing.sources.push(...add); dirty = true }
    nextAt[r.id] = now + RECHECK_CALLED * 3
    return
  }
  const verified = claims.filter((c) => c.verified).length
  if (desks.length >= 2 && verified >= 1 && !(margin != null && margin < CLOSE_MARGIN)) {
    publishCall(r, winner, claims, 'auto')
    nextAt[r.id] = now + RECHECK_CALLED
    return
  }
  if (desks.length >= 2) return ask_(margin != null && margin < CLOSE_MARGIN ? `${desks.join(' + ')} call it for ${winner.name}, but the count shows a ${margin.toFixed(2)}-pt margin` : `${desks.join(' + ')} call it for ${winner.name}, but the pages couldn't be confirmed automatically`)
  // one desk so far: give the others a few minutes before asking
  st.firstLone[r.id] ||= now
  if (now - st.firstLone[r.id] >= LONE_DESK_ASK) return ask_(`only ${desks[0]} has called it (for ${winner.name}) after ${Math.round((now - st.firstLone[r.id]) / 60000)} min`)
  nextAt[r.id] = now + 60 * 1000 // look again soon for a second desk
}

function publishCall(r, cand, claims, by) {
  const count = pub.counts[r.id]
  const pct = count?.cands?.find((c) => surname(c.name) === surname(cand.name))?.pct ?? null
  pub.calls[r.id] = {
    winner: cand.name, party: ['D', 'R'].includes(cand.party) ? cand.party : 'I', pct,
    flip: !!(r.incumbent?.party && r.incumbent.party !== cand.party),
    sources: [...new Map(claims.map((c) => [c.desk, { desk: c.desk, url: c.url }])).values()],
    by, at: new Date().toISOString(),
  }
  delete st.review[r.id]; delete st.firstLone[r.id]
  saveState()
  dirty = true
  say(`CALLED (${by}) · ${raceTitle(r, STATES)}: ${cand.name} · ${pub.calls[r.id].sources.map((s) => s.desk).join(', ') || 'HQ'}`)
}

// ---------- publishing ----------
let lastPub = 0
async function publish() {
  if (!dirty || Date.now() - lastPub < 20 * 1000) return
  dirty = false
  lastPub = Date.now()
  pub.updatedAt = new Date().toISOString()
  mkdirSync(dirname(OUT), { recursive: true })
  writeFileSync(OUT, JSON.stringify(pub) + '\n')
  try {
    await publishLive(ROOT, ['scout.json']) // also purges the jsDelivr mirror
  } catch (e) { dirty = true; say(`publish failed (will retry): ${e.message.split('\n')[0]}`) }
}

// ---------- loop ----------
const busy = new Set()
async function worker() {
  for (;;) {
    const r = !paused && spent() < BUDGET && pick()
    if (!r) { await new Promise((ok) => setTimeout(ok, 3000)); continue }
    busy.add(r.id)
    try { await check(r) } catch (e) {
      usage.errors++
      nextAt[r.id] = Date.now() + 90 * 1000
      say(`error on ${raceTitle(r, STATES)}: ${e.message}`)
    } finally { busy.delete(r.id) }
  }
}

// ---------- review page ----------
const page = () => `<!doctype html><meta charset="utf-8"><title>HQ Scout</title><meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{background:#050510;color:#c8ffc8;font:14px/1.45 ui-monospace,Menlo,monospace;margin:0;padding:16px;max-width:980px}
h1{color:#00ff41;font-size:18px}h2{color:#ffd700;font-size:14px;margin-top:24px}.card{border:2px solid #ffd700;padding:12px;margin:10px 0;background:#0b0b22}
.card.auto{border-color:#1a4d1a}.why{color:#ffd700}.dim{color:#5f9a5f}a{color:#7cc4ff}button{font:inherit;padding:8px 12px;margin:6px 6px 0 0;cursor:pointer;border:2px solid #00ff41;background:#03140a;color:#fff}
button.D{border-color:#4488ff;background:#0a1a44}button.R{border-color:#ff4444;background:#440a0a}button.ghost{border-color:#5f9a5f;background:none;color:#c8ffc8}
.ok{color:#00ff41}.no{color:#ff8a8a}pre{white-space:pre-wrap;color:#5f9a5f;font-size:12px}</style>
<h1>◆ HQ CALL SCOUT</h1><div id="stat" class="dim"></div><div id="app"></div>
<script>
const H={'Content-Type':'application/json','X-MHQ-Admin':'1'}
const esc=(s)=>String(s??'').replace(/[&<>"']/g,(c)=>'&#'+c.charCodeAt(0)+';')
async function act(body){await fetch('/decide',{method:'POST',headers:H,body:JSON.stringify(body)});load()}
async function load(){const s=await (await fetch('/state',{headers:H})).json()
document.getElementById('stat').textContent=(s.paused?'PAUSED · ':+s.cost>=s.budget?'BUDGET REACHED (restart with SCOUT_BUDGET=… to continue) · ':'RUNNING · ')+s.usage.checks+' checks · '+s.usage.searches+' searches · est. $'+s.cost+' of $'+s.budget+' · '+s.usage.errors+' errors'
let h='<button class="ghost" onclick="act({action:\\'pause\\'})">'+(s.paused?'▶ RESUME':'❚❚ PAUSE')+'</button>'
h+='<h2>NEEDS YOU ('+s.review.length+')</h2>'+(s.review.length?'':'<div class="dim">Nothing to confirm. The scout calls races itself when 2+ desks agree.</div>')
for(const r of s.review){h+='<div class="card"><b>'+esc(r.title)+'</b> <span class="dim">'+esc(r.rating)+'</span><div class="why">'+esc(r.why)+'</div>'
for(const c of r.claims)h+='<div>'+(c.verified?'<span class=ok>✓</span>':'<span class=no>?</span>')+' <b>'+esc(c.desk)+'</b> → '+esc(c.winner)+' · <a href="'+esc(c.url)+'" target=_blank>'+esc(c.outlet)+' ↗</a><br><span class=dim>“'+esc(c.quote)+'”</span></div>'
if(r.count)h+='<div class=dim>COUNT '+(r.count.pctIn??'?')+'% in: '+r.count.cands.map(c=>esc(c.name)+' '+(c.pct??'?')+'%').join(' · ')+' — '+(r.count.url?'<a href="'+esc(r.count.url)+'" target=_blank>'+esc(r.count.source)+' ↗</a>':esc(r.count.source))+'</div>'
if(r.notes)h+='<div class=dim>note: '+esc(r.notes)+'</div>'
for(const c of r.cands)h+='<button class="'+c.party+'" onclick="act({action:\\'call\\',id:\\''+r.id+'\\',winner:'+esc(JSON.stringify(c.name))+'})">✓ CALL FOR '+esc(c.name)+' ('+c.party+')</button>'
h+='<button class="ghost" onclick="act({action:\\'later\\',id:\\''+r.id+'\\'})">NOT YET · KEEP WATCHING</button><button class="ghost" onclick="act({action:\\'ignore\\',id:\\''+r.id+'\\'})">STOP SCOUTING THIS RACE</button></div>'}
h+='<h2>ON THE BOARD ('+s.calls.length+')</h2>'
for(const c of s.calls)h+='<div class="card auto"><b>'+esc(c.title)+'</b>: '+esc(c.winner)+' ('+c.party+') · '+(c.by==='hq'?'called by you':'auto')+' · '+c.sources.map(x=>'<a href="'+esc(x.url)+'" target=_blank>'+esc(x.desk)+'</a>').join(', ')+' <button class="ghost" onclick="act({action:\\'undo\\',id:\\''+c.id+'\\'})">UNDO</button></div>'
h+='<h2>LOG</h2><pre>'+esc(s.log.join('\\n'))+'</pre>'
document.getElementById('app').innerHTML=h}
load();setInterval(load,4000)
</script>`

const titleOf = (id) => (races[id] ? raceTitle(races[id], STATES) : id)
function stateJson() {
  return {
    paused, budget: BUDGET, usage, log: log.slice(0, 60),
    cost: spent().toFixed(2),
    review: Object.entries(st.review).map(([id, v]) => ({ id, title: titleOf(id), rating: races[id]?.consensus?.label || '', cands: (races[id]?.candidates || []).slice(0, 4).map((c) => ({ name: c.name, party: ['D', 'R'].includes(c.party) ? c.party : 'I' })), ...v })),
    calls: Object.entries(pub.calls).map(([id, c]) => ({ id, title: titleOf(id), ...c })).sort((a, b) => b.at.localeCompare(a.at)),
  }
}

createServer(async (req, res) => {
  const send = (code, body, type = 'application/json') => { res.writeHead(code, { 'Content-Type': type }); res.end(type === 'application/json' ? JSON.stringify(body) : body) }
  if (req.method === 'GET' && req.url === '/') return send(200, page(), 'text/html; charset=utf-8')
  // Same guard as the admin page: other websites can't send this header without a preflight we never answer.
  if (req.headers['x-mhq-admin'] !== '1') return send(403, { error: 'forbidden' })
  if (req.method === 'GET' && req.url === '/state') return send(200, stateJson())
  if (req.method === 'POST' && req.url === '/decide') {
    let s = ''
    for await (const c of req) { s += c; if (s.length > 10000) return send(413, {}) }
    const { action, id, winner } = JSON.parse(s || '{}')
    const r = races[id]
    if (action === 'pause') paused = !paused
    else if (action === 'call' && r) {
      const cand = r.candidates.find((c) => c.name === winner)
      if (cand) publishCall(r, cand, (st.review[id]?.claims || []).filter((c) => surname(c.winner) === surname(cand.name)), 'hq')
    } else if (action === 'later' && r) { delete st.review[id]; st.firstLone[id] = Date.now(); nextAt[id] = 0; saveState() }
    else if (action === 'ignore' && r) { delete st.review[id]; st.ignored.push(id); saveState() }
    else if (action === 'undo' && pub.calls[id]) { delete pub.calls[id]; st.ignored.push(id); dirty = true; saveState(); say(`UNDO · ${titleOf(id)} (no longer scouted; call it from HQ Admin if needed)`) }
    return send(200, { ok: true })
  }
  send(404, {})
}).listen(PORT, '127.0.0.1', () => say(`review page: http://localhost:${PORT}`))

await refreshRaces()
say(`${Object.values(races).filter(inScope).length} races in scope; scouting each one once its polls close`)
setInterval(() => refreshRaces().catch((e) => say(`race list refresh failed: ${e.message}`)), 5 * 60 * 1000)
setInterval(publish, 5000)
for (let i = 0; i < WORKERS; i++) worker()

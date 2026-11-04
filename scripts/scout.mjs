// Call scout: election-night race calls from the decision desks, with sources.
//   npm run scout          (key in .secrets/anthropic-api-key.txt, or ANTHROPIC_API_KEY)
//   review page:           http://localhost:5299
//
// It only searches when something suggests a race may have been called (free signals):
//   - a headline says a candidate won/was projected/conceded (news feeds, every 60 s)
//   - a slow backup sweep of the closest races (SCOUT_FALLBACK minutes, default 40; 0 = off)
//   - Senate/Governor races a minute after their polls close
//   - safe House seats: one search per state for up to 12 seats at once, 3 min after its
//     polls close and every 45 min while any are uncalled
// Each check, Claude Haiku searches apnews.com and nbcnews.com only, for an explicit AP or NBC
// call and the latest vote count. The scout then decides:
//   AUTO-CALL   AP and NBC name the same winner, at least one claim is confirmed by reading
//               the cited page here, no desk disagrees, and the count isn't razor-close
//   ASK HQ      desks disagree, a lone desk call stays alone for 10+ minutes, the winner
//               isn't a listed candidate, or nothing can be confirmed (review page + Mac alert)
// Calls and counts go to live/scout.json on the `live` branch, which every copy reads.
//
// Env: SCOUT_BUDGET (US$ estimate the scout stops at, default 10), SCOUT_WORKERS (default 8),
//      SCOUT_FALLBACK (minutes between backup checks of the closest races, default 40),
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
const PORT = +process.env.SCOUT_PORT || 5299
const MODEL = 'claude-haiku-5-5' // a lookup, not deep reasoning: ~1/40th of Opus' token price
const BUDGET = +process.env.SCOUT_BUDGET || 10
const WORKERS = +process.env.SCOUT_WORKERS || 8
// Spend estimate: Claude Opus 5.5 tokens ($4 in / $20 out per million) plus web searches (~$10 per 1,000).
const spent = () => (usage.inTok * 0.1 + usage.outTok * 0.5) / 1e6 + usage.searches * 0.01 // Haiku 5.5 (prompts under 100K) + $10/1,000 searches
const FALLBACK = (process.env.SCOUT_FALLBACK != null ? +process.env.SCOUT_FALLBACK : 40) * 60 * 1000
const LONE_RECHECK = 3 * 60 * 1000 // one desk has called it: look for a second
const RECHECK_CALLED = 10 * 60 * 1000 // one more look after a call, to catch a retraction
const AT_CLOSE = 60 * 1000 // Senate/Governor: first look a minute after polls close (desks call safe races right away)
const LONE_DESK_ASK = 10 * 60 * 1000
const CLOSE_MARGIN = 0.5 // points; tighter than this always goes to HQ

export const DESKS = ['AP', 'NBC News'] // the two fastest desks; both must agree for an auto-call
const SEARCH = { type: 'web_search_20250305', name: 'web_search', allowed_domains: ['apnews.com', 'nbcnews.com'] }

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
const usage = { searches: 0, inTok: 0, outTok: 0, checks: 0, errors: 0, triggers: 0 }
const log = []
const say = (msg) => { const line = `[${new Date().toLocaleTimeString()}] ${msg}`; console.log(line); log.unshift(line); log.length = Math.min(log.length, 200) }
const saveState = () => { if (saveState.off) return; mkdirSync(dirname(STATE_FILE), { recursive: true }); writeFileSync(STATE_FILE, JSON.stringify(st, null, 2)) }

let races = {}
let dirty = false
let paused = false
let noCredit = false // API credit ran out: Claude checks stop, the free NBC reader keeps going

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

// nextAt[id]: when to check a race next (undefined = only when a trigger fires).
// Senate/Governor races get a first look right after their polls close; close House races 10-30 min
// after; then the closest races are re-checked every FALLBACK.
const nextAt = {}
const lastTrigger = {}
function trigger(r, why) {
  if (!closed(r) || st.ignored.includes(r.id) || pub.calls[r.id]) return // any race, even a safe seat
  if (Date.now() - (lastTrigger[r.id] || 0) < 5 * 60 * 1000) return // one trigger per race per 5 min
  lastTrigger[r.id] = Date.now()
  nextAt[r.id] = 0
  usage.triggers++
  say(`TRIGGER · ${raceTitle(r, STATES)} · ${why}`)
}
function pick() {
  const now = Date.now()
  for (const r of Object.values(races)) {
    if (nextAt[r.id] === undefined && !(r.id in lastCheck) && FALLBACK && isHot(r) && inScope(r) && closed(r)) nextAt[r.id] = pollCloseFor(r.state).at.getTime() + (r.type !== 'house' ? AT_CLOSE : FALLBACK / 4 + Math.random() * FALLBACK / 2)
  }
  const ready = Object.values(races).filter((r) => nextAt[r.id] !== undefined && nextAt[r.id] <= now && (inScope(r) || lastTrigger[r.id]) && closed(r) && !st.ignored.includes(r.id) && !busy.has(r.id))
  ready.sort((a, b) => nextAt[a.id] - nextAt[b.id] || (isHot(b) - isHot(a)) || score(a) - score(b))
  return ready[0]
}
const lastCheck = {}

// ---------- free triggers: headlines ----------
const FEEDS = [
  ...['"projected winner"', '"wins" Senate race', '"wins" governor race', '"wins" House seat', '"race call"', 'concedes election', '"defeats" election'].map((q) => `https://news.google.com/rss/search?q=${encodeURIComponent(`${q} when:1d`)}&hl=en-US&gl=US&ceid=US:en`),
  'https://feeds.npr.org/1014/rss.xml',
  'https://feeds.nbcnews.com/nbcnews/public/politics',
  'https://www.cbsnews.com/latest/rss/politics',
  'https://moxie.foxnews.com/google-publisher/politics.xml',
]
const CALL_WORDS = /\b(wins?|won|winner|projected|projects|defeats?|defeated|re-?elected|elected|concedes?|conceded|victory|holds? (?:on|off)|flips?)\b/i
const seenHeads = new Set()
const decode = (t) => t.replace(/<!\[CDATA\[|\]\]>/g, '').replace(/&amp;/g, '&').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').trim()
async function scanHeadlines() {
  const open = Object.values(races).filter((r) => closed(r) && !pub.calls[r.id] && !st.ignored.includes(r.id))
  if (!open.length) return
  // surname -> races (a surname in several open races also needs the state named)
  const bySur = {}
  for (const r of open) for (const c of r.candidates.slice(0, 6)) { const k = surname(c.name); if (k.length >= 4) (bySur[k] ||= new Set()).add(r) }
  const titles = []
  await Promise.all(FEEDS.map(async (u) => {
    try {
      const res = await fetch(u, { headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh) MidtermsHQ-scout' }, signal: AbortSignal.timeout(10000) })
      if (!res.ok) return
      const xml = await res.text()
      for (const [item] of xml.matchAll(/<item>[\s\S]*?<\/item>/g)) {
        const t = decode(item.match(/<title>([\s\S]*?)<\/title>/)?.[1] || '')
        const at = Date.parse(item.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1] || '')
        if (Number.isFinite(at) && Date.now() - at > 6 * 3600 * 1000) continue // only tonight's news
        titles.push(t)
      }
    } catch { /* a feed being down is fine */ }
  }))
  for (const t of titles) {
    if (seenHeads.has(t)) continue
    seenHeads.add(t)
    if (!CALL_WORDS.test(t)) continue
    const lower = t.toLowerCase()
    for (const [sur, set] of Object.entries(bySur)) {
      if (!new RegExp(`\\b${sur}\\b`).test(lower)) continue
      for (const r of set) if (set.size === 1 || lower.includes(STATES[r.state].toLowerCase())) trigger(r, `headline: "${t.slice(0, 120)}"`)
    }
  }
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
            desk: { type: 'string', enum: [...DESKS, 'Other'], description: 'Whose call it is.' },
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
1. Whether AP (apnews.com) and/or NBC News (nbcnews.com) has CALLED (projected) the winner of the 2026 general election. Their race results pages are the fastest place to look (NBC: nbcnews.com/politics/2026-elections/...-results).
2. The latest vote count as shown on those pages.

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
    const res = await client.messages.create({
      model: MODEL,
      max_tokens: 16000,
      output_config: { effort: 'low' }, // a lookup, not deep reasoning: faster and cheaper
      system: SYSTEM,
      tools: [{ ...SEARCH, max_uses: 2 }, REPORT_TOOL],
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
  lastCheck[r.id] = Date.now()
  nextAt[r.id] = undefined // set again below if this race needs another look
  const rep = await ask(r)
  const now = Date.now()
  const count = countFrom(r, rep.count)
  if (count) { pub.counts[r.id] = count; dirty = true }
  const off = https(rep.official_results_url)
  if (off && /\.(gov|us)(\/|$)/.test(new URL(off).hostname + '/') && !pub.official[r.state]) { pub.official[r.state] = off; dirty = true }

  if (FALLBACK && isHot(r)) nextAt[r.id] = now + FALLBACK // backup sweep for the closest races
  await decide(r, rep.calls, count, rep.notes)
}

// Apply the calling rule to one race's desk claims. quiet: don't take a lone desk call to HQ
// (safe seats, which the next state sweep looks at again anyway).
async function decide(r, rawClaims, count, notes, { quiet = false } = {}) {
  const now = Date.now()
  const claims = (rawClaims || []).filter((c) => https(c.url) && c.winner && c.desk !== 'Other')
  for (const c of claims) c.verified = await verify(c)
  for (const c of claims) c.cand = matchCand(r, c.winner)
  const winners = [...new Set(claims.map((c) => (c.cand ? c.cand.name : `?${c.winner}`)))]
  const desks = [...new Set(claims.map((c) => c.desk))]
  const lead = count?.cands?.filter((c) => c.pct != null).sort((a, b) => b.pct - a.pct)
  const margin = lead?.length > 1 ? lead[0].pct - lead[1].pct : null
  const ask_ = (why) => {
    if (!st.review[r.id]) { notify('Midterms HQ scout: needs you', `${raceTitle(r, STATES)}: ${why}`); say(`ASK HQ · ${raceTitle(r, STATES)} · ${why}`) }
    st.review[r.id] = { why, claims: claims.map(({ cand, ...c }) => ({ ...c, party: cand?.party || null })), count, notes, at: now }
    saveState()
  }

  if (!quiet) say(`CHECK · ${raceTitle(r, STATES)} · ${claims.length ? claims.map((c) => `${c.desk}: ${c.winner}${c.verified ? ' ✓' : ''}`).join(', ') : 'no desk call yet'}`)
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
    nextAt[r.id] = undefined
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
  if (quiet) return
  st.firstLone[r.id] ||= now
  if (now - st.firstLone[r.id] >= LONE_DESK_ASK) return ask_(`only ${desks[0]} has called it (for ${winner.name}) after ${Math.round((now - st.firstLone[r.id]) / 60000)} min`)
  nextAt[r.id] = now + LONE_RECHECK // look again soon for a second desk
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

// ---------- safe House seats: one search per state ----------
// Seats every forecaster rates Safe aren't scouted one by one. Instead, a few minutes after a
// state's polls close (then every 45 minutes while any are uncalled) one search covers up to 12
// of them at once, and the same two-desk rule applies to each.
const SWEEP_FIRST = 3 * 60 * 1000
const SWEEP_EVERY = 45 * 60 * 1000
const sweepAt = {}
const isSafeSeat = (r) => r.type === 'house' && !inScope(r)

const BATCH_TOOL = {
  name: 'report',
  description: 'Report the calls you found for these House districts. Call it exactly once, at the end.',
  strict: true,
  input_schema: {
    type: 'object',
    additionalProperties: false,
    required: ['districts', 'notes'],
    properties: {
      districts: {
        type: 'array',
        description: 'Only districts where at least one desk has made a call',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['district', 'calls'],
          properties: {
            district: { type: 'string', description: 'Exactly as given, e.g. "TX-12"' },
            calls: REPORT_TOOL.input_schema.properties.calls,
          },
        },
      },
      notes: { type: 'string' },
    },
  },
}

async function sweepState(state, list) {
  usage.checks++
  const lines = list.map((r) => `${raceTitle(r, STATES)}: ${r.candidates.slice(0, 4).map((c) => `${c.name} (${c.party})`).join(', ')}`).join('\n')
  const messages = [{ role: 'user', content: `${STATES[state]} U.S. House races, 2026 general election. For each district below, find whether AP and/or NBC News has called the winner. Their state results pages list many races at once and are the fastest way; check both desks.\n\n${lines}` }]
  let input = null
  for (let turn = 0; turn < 4 && !input; turn++) {
    const res = await client.messages.create({
      model: MODEL, max_tokens: 16000,
      output_config: { effort: 'low' },
      system: SYSTEM.replace('For the race you are given', 'For the races you are given').replace('2. The latest vote count, preferring the state\'s official election-night results site or a county election office, otherwise AP numbers as shown by an outlet.\n', ''),
      tools: [{ ...SEARCH, max_uses: 3 }, BATCH_TOOL],
      messages,
    })
    usage.inTok += res.usage?.input_tokens || 0
    usage.outTok += res.usage?.output_tokens || 0
    usage.searches += res.usage?.server_tool_use?.web_search_requests || 0
    if (res.stop_reason === 'refusal') throw new Error('declined by the model')
    input = res.content.find((b) => b.type === 'tool_use' && b.name === 'report')?.input || null
    if (input) break
    messages.push({ role: 'assistant', content: res.content })
    if (res.stop_reason !== 'pause_turn') messages.push({ role: 'user', content: 'Now call the report tool with what you found.' })
  }
  if (!input) throw new Error('no report returned')
  const byLabel = Object.fromEntries(list.map((r) => [raceTitle(r, STATES), r]))
  for (const d of input.districts || []) {
    const r = byLabel[d.district]
    if (r && !pub.calls[r.id]) await decide(r, d.calls, pub.counts[r.id] || null, input.notes, { quiet: true })
  }
}

let sweeping = false
async function sweeps() {
  if (sweeping || paused || noCredit || process.env.SCOUT_AI === '0' || spent() >= BUDGET) return
  const now = Date.now()
  const byState = {}
  for (const r of Object.values(races)) if (isSafeSeat(r) && closed(r) && !pub.calls[r.id] && !st.ignored.includes(r.id)) (byState[r.state] ||= []).push(r)
  const due = Object.entries(byState).find(([state]) => now >= (sweepAt[state] ??= pollCloseFor(state).at.getTime() + SWEEP_FIRST))
  if (!due) return
  const [state, list] = due
  sweeping = true
  sweepAt[state] = now + SWEEP_EVERY
  try {
    for (let i = 0; i < list.length; i += 12) await sweepState(state, list.slice(i, i + 12))
    say(`SWEEP · ${STATES[state]}: ${list.filter((r) => pub.calls[r.id]).length}/${list.length} safe House seats now called`)
  } catch (e) { usage.errors++; if (/credit balance/i.test(e.message)) outOfCredit(); else say(`sweep failed for ${STATES[state]}: ${e.message}`) } finally { sweeping = false }
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

// Out of API credit: stop (every search would fail) and say so loudly. Unpause on the review page after topping up.
function outOfCredit() {
  if (noCredit) return
  noCredit = true
  say('OUT OF API CREDIT · Claude checks stopped (NBC calls still come in). Add credit at console.anthropic.com, then restart the scout')
  notify('Midterms HQ scout: out of API credit', 'Claude checks stopped; NBC calls still come in. Add credit, then restart the scout.')
}

// ---------- NBC News results pages (free, no AI) ----------
// Each state's NBC results page embeds every Senate/Governor/House race with NBC's own call
// ("Projected winner") and the count. One fetch per closed state every NBC_EVERY; NBC calls
// go up right away with an NBC source link, and AP (from the Claude checks) is added when found.
const NBC_EVERY = 90 * 1000
const NBC = 'https://www.nbcnews.com'
const nbcSeen = {} // race id -> winner NBC showed last time (to notice a withdrawn call)
async function nbcState(state) {
  const slug = STATES[state].toLowerCase().replace(/\s+/g, '-')
  const res = await fetch(`${NBC}/politics/2026-elections/${slug}-results`, { headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh) MidtermsHQ-scout' }, signal: AbortSignal.timeout(20000) })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const html = await res.text()
  const json = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/)?.[1]
  if (!json) throw new Error('no results data on the page')
  const rr = JSON.parse(json).props?.pageProps?.stateRaceResults || {}
  const mine = Object.values(races).filter((r) => r.state === state)
  const entries = [
    ...(rr.discreteOffices || []).filter((x) => x.officeCode === 'S' || x.officeCode === 'G').map((x) => ({ x, type: x.officeCode === 'S' ? 'senate' : 'governor' })),
    ...(rr.house || []).map((x) => ({ x, type: 'house' })),
  ]
  for (const { x, type } of entries) {
    const cands = (x.candidates || []).filter((c) => c.name && !/write-in/i.test(c.name))
    if (!cands.length) continue
    const has = (r) => cands.some((c) => r.candidates.some((k) => surname(k.name) === surname(c.name)))
    const pool = mine.filter((r) => r.type === type && (type !== 'house' || mine.filter((m) => m.type === 'house').length === 1 || String(r.district) === String(x.district)))
    const r = pool.length === 1 ? pool[0] : pool.find(has) // two Senate races in a state: tell them apart by candidates
    if (!r || st.ignored.includes(r.id)) continue
    const url = `${NBC}${x.href || ''}`
    const tot = cands.reduce((t, c) => t + (c.votes || 0), 0)
    if (tot > 0) {
      pub.counts[r.id] = { pctIn: Number.isFinite(x.percentIn) ? x.percentIn : null, cands: cands.slice(0, 6).map((c) => ({ name: c.name, party: c.party === 'dem' ? 'D' : c.party === 'gop' ? 'R' : 'I', votes: c.votes ?? null, pct: c.percentVote ?? null })), source: 'NBC News', url, asOf: '', at: new Date().toISOString() }
      dirty = true
    }
    const win = cands.find((c) => c.isWinner && c.callStatus === 'P')
    const call = pub.calls[r.id]
    if (!win) {
      if (nbcSeen[r.id] && call?.by === 'nbc') { delete pub.calls[r.id]; dirty = true; say(`CALL WITHDRAWN by NBC · ${raceTitle(r, STATES)}`); notify('Midterms HQ scout', `NBC withdrew its call in ${raceTitle(r, STATES)}`) }
      delete nbcSeen[r.id]
      continue
    }
    nbcSeen[r.id] = win.name
    const cand = matchCand(r, win.name)
    if (!cand) { if (!st.review[r.id]) { st.review[r.id] = { why: `NBC calls it for "${win.name}", who isn't a listed candidate`, claims: [{ desk: 'NBC News', winner: win.name, url, verified: true }], count: pub.counts[r.id] || null, notes: '', at: Date.now() }; saveState(); say(`ASK HQ · ${raceTitle(r, STATES)} · NBC winner not on the list`) } continue }
    if (call) {
      if (call.winner !== cand.name) { if (!st.review[r.id]) { st.review[r.id] = { why: `NBC now calls it for ${cand.name}, but HQ shows ${call.winner}`, claims: [{ desk: 'NBC News', winner: cand.name, party: cand.party, url, verified: true }], count: pub.counts[r.id] || null, notes: '', at: Date.now() }; saveState(); notify('Midterms HQ scout: needs you', `${raceTitle(r, STATES)}: NBC and HQ disagree`) } continue }
      if (!call.sources.some((s) => s.desk === 'NBC News')) { call.sources.push({ desk: 'NBC News', url }); dirty = true }
      continue
    }
    publishCall(r, cand, [{ desk: 'NBC News', url }], 'nbc')
    if (pub.calls[r.id] && win.percentVote != null) pub.calls[r.id].pct = win.percentVote
  }
}
let nbcBusy = false
async function nbcSweep() {
  if (nbcBusy || paused) return
  nbcBusy = true
  try {
    const states = [...new Set(Object.values(races).filter((r) => closed(r) && !st.ignored.includes(r.id)).map((r) => r.state))]
    for (let i = 0; i < states.length; i += 4) { // 4 at a time, gently
      await Promise.all(states.slice(i, i + 4).map((s) => nbcState(s).catch((e) => say(`NBC ${STATES[s]}: ${e.message}`))))
    }
  } finally { nbcBusy = false }
}

// ---------- loop ----------
const busy = new Set()
async function worker() {
  for (;;) {
    const r = !paused && !noCredit && process.env.SCOUT_AI !== '0' && spent() < BUDGET && pick()
    if (!r) { await new Promise((ok) => setTimeout(ok, 3000)); continue }
    busy.add(r.id)
    try { await check(r) } catch (e) {
      usage.errors++
      nextAt[r.id] = Date.now() + 90 * 1000
      if (/credit balance/i.test(e.message)) outOfCredit()
      else say(`error on ${raceTitle(r, STATES)}: ${e.message}`)
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
document.getElementById('stat').textContent=(s.paused?'PAUSED · ':+s.cost>=s.budget?'BUDGET REACHED (restart with SCOUT_BUDGET=… to continue) · ':'RUNNING · ')+s.usage.triggers+' triggers · '+s.usage.checks+' checks · '+s.usage.searches+' searches · est. $'+s.cost+' of $'+s.budget+' · '+s.usage.errors+' errors'
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

// NBC_TEST=GA: read one state's NBC page, print the calls it would make and exit (publishes nothing)
if (process.env.NBC_TEST) {
  await refreshRaces()
  for (const k of Object.keys(pub.calls)) delete pub.calls[k]
  saveState.off = true
  await nbcState(process.env.NBC_TEST)
  for (const [id, c] of Object.entries(pub.calls)) console.log(id, '→', c.winner, c.party, c.pct, c.flip ? 'FLIP' : '', c.sources.map((x) => x.url).join(' '))
  console.log(Object.keys(pub.counts).length, 'counts;', Object.keys(st.review).length, 'for review')
  process.exit(0)
}
// SCOUT_TEST=<race id>: one check, print what was found and exit (publishes nothing)
if (process.env.SCOUT_TEST) {
  await refreshRaces()
  const r = races[process.env.SCOUT_TEST]
  if (!r) { console.log('no such race'); process.exit(1) }
  const rep = await ask(r)
  for (const c of rep.calls) c.verified = await verify(c)
  console.log(JSON.stringify(rep, null, 2), `\n~$${spent().toFixed(2)}`)
  process.exit(0)
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
say(`${Object.values(races).filter(inScope).length} races in scope. Searching only when a headline suggests a call${FALLBACK ? ` plus a backup check of the closest races every ${FALLBACK / 60000} min` : ''}, once each state's polls close`)
setInterval(() => refreshRaces().catch((e) => say(`race list refresh failed: ${e.message}`)), 10 * 60 * 1000)
setInterval(() => scanHeadlines().catch((e) => say(`headline scan failed: ${e.message}`)), 60 * 1000)
setInterval(publish, 5000)
nbcSweep()
setInterval(nbcSweep, NBC_EVERY)
setInterval(() => sweeps(), 15 * 1000)
for (let i = 0; i < WORKERS; i++) worker()

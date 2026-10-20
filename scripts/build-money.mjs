#!/usr/bin/env node
// Builds live/money.json for every 2026 Senate and House race: each campaign's own
// totals (raised / spent / cash on hand) and who is spending from outside the campaigns
// (FEC Schedule E independent expenditures, as processed by the FEC), with each
// spender's committee type. `npm run money -- --publish` also pushes it to the `live`
// branch next to control.json; GitHub Actions does that on a schedule (money.yml), so
// no app ever needs its own FEC key.
//
// FEC key: FEC_API_KEY env var (the repo secret in Actions), VITE_FEC_API_KEY in
// .env.local, or CLAUDE HOME/.secrets/fec.key. DEMO_KEY runs out after ~40 requests.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { publishLive } from './admin-plugin.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'live/money.json')
const KEY_FILE = join(ROOT, '../.secrets/fec.key')
const ENV_FILE = join(ROOT, '.env.local')
const envKey = existsSync(ENV_FILE) ? readFileSync(ENV_FILE, 'utf8').match(/^VITE_FEC_API_KEY=(\S+)/m)?.[1] : null
const KEY = process.env.FEC_API_KEY || envKey || (existsSync(KEY_FILE) ? readFileSync(KEY_FILE, 'utf8').trim() : 'DEMO_KEY')
const API = 'https://api.open.fec.gov/v1'
const MONEY_URL = 'https://raw.githubusercontent.com/donyon67k/midterms-hq/live/money.json'
const UA = 'ProjectMidterms data builder (+https://github.com/donyon67k/midterms-hq)'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function fec(path, params) {
  const q = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) for (const x of [v].flat()) q.append(k, x)
  q.set('api_key', KEY)
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${API}${path}?${q}`, { headers: { 'User-Agent': UA } })
    if (res.ok) return res.json()
    if (res.status === 429 && attempt < 3) {
      if (KEY === 'DEMO_KEY') throw new Error('FEC DEMO_KEY limit hit. Save your FEC key to CLAUDE HOME/.secrets/fec.key and run again.')
      console.log('  rate limited, waiting a minute…')
      await sleep(60_000)
      continue
    }
    if (res.status >= 500 && attempt < 3) { await sleep(3000); continue }
    throw new Error(`FEC ${path} ${res.status}: ${(await res.text()).slice(0, 200)}`)
  }
}

async function allPages(path, params) {
  const out = []
  for (let page = 1; ; page++) {
    const j = await fec(path, { ...params, per_page: 100, page })
    out.push(...j.results)
    if (page >= j.pagination.pages) return out
  }
}

// FEC committee type -> short plain-English label shown in the app
const TYPE = (full = '') =>
  /super pac/i.test(full) ? 'Super PAC'
    : /hybrid/i.test(full) ? 'Hybrid PAC'
    : /party/i.test(full) ? 'Party committee'
    : /pac/i.test(full) ? 'PAC'
    : /communication cost/i.test(full) ? 'Internal communication'
    : /single.?candidate|independent expenditor/i.test(full) ? 'Group or person'
    : full ? full.replace(/\s*\(.*\)\s*$/, '') : 'Group or person'

// "COLLINS, MICHAEL A JR" -> the race's own spelling ("Mike Collins") when we have the
// candidate, otherwise "Michael A Collins Jr"
const SUFFIX = /^(JR|SR|II|III|IV)\.?$/i
function displayName(fecName, race) {
  const [last = '', rest = ''] = fecName.split(',').map((x) => x.trim())
  const norm = (x) => x.normalize('NFD').replace(/[^a-z ]/gi, '').toLowerCase()
  const hit = race?.candidates?.find((c) => norm(c.name).split(' ').includes(norm(last).split(' ').pop()))
  if (hit) return hit.name
  const words = rest.split(/\s+/).filter(Boolean)
  const suffix = words.filter((w) => SUFFIX.test(w))
  const title = (w) => w.toLowerCase().replace(/(^|[-' ])\p{L}/gu, (m) => m.toUpperCase())
  return [...words.filter((w) => !SUFFIX.test(w)), last, ...suffix].map(title).join(' ') || fecName
}

const PARTY = (p = '') => (p.startsWith('DEM') ? 'D' : p.startsWith('REP') ? 'R' : p.startsWith('LIB') ? 'L' : p.startsWith('GRE') ? 'G' : 'I')

async function main() {
  const snap = JSON.parse(readFileSync(join(ROOT, 'src/data/snapshot.json'), 'utf8'))
  // MONEY_STATES=GA,PA limits a test run to a few states
  const only = process.env.MONEY_STATES?.split(',')
  const pick = (list) => (only ? list.filter((s) => only.includes(s)) : list)
  const senateStates = pick([...new Set(Object.values(snap.senate).map((r) => r.state))])
  const houseStates = pick(Object.keys(snap.house))
  const senateId = (st) => (snap.senate[st] ? `senate-${st}` : `senate-${st}-special`)
  const houseIds = new Set(Object.values(snap.house).flat().map((r) => r.id))
  console.log(`FEC key: ${KEY === 'DEMO_KEY' ? 'DEMO_KEY (test only)' : 'personal key'}`)
  const raceOf = (office, st, district) => {
    if (office === 'senate' || office === 'S') return senateStates.includes(st) ? senateId(st) : null
    if (!houseStates.includes(st)) return null
    const id = houseIds.has(`house-${st}-AL`) ? `house-${st}-AL` : `house-${st}-${+district}`
    return houseIds.has(id) ? id : null
  }
  const snapRaceOf = (id) => (id.startsWith('senate-') ? snap.senate[id.slice(7)] : Object.values(snap.house).flat().find((x) => x.id === id))

  // 1. Every federal candidate's own campaign totals (raised / spent / cash). These also
  //    give each candidate's current state and district: the district inside an FEC
  //    candidate ID is where they first filed, which redistricting can change.
  const where = {}
  const totals = {}
  for (const office of ['S', 'H']) {
    const base = { cycle: 2026, election_full: true, office, has_raised_funds: true, sort: '-receipts' }
    const list = only ? (await Promise.all(only.map((state) => allPages('/candidates/totals/', { ...base, state })))).flat() : await allPages('/candidates/totals/', base)
    console.log(`${list.length} ${office === 'S' ? 'Senate' : 'House'} candidates with money raised`)
    for (const c of list) {
      const id = raceOf(office, c.state, c.district)
      where[c.candidate_id] = { id, party: PARTY(c.party_full || c.party) }
      if (!id || !(c.receipts > 0)) continue
      const race = (totals[id] ||= { through: '', candidates: [] })
      race.candidates.push({
        id: c.candidate_id,
        name: displayName(c.name, snapRaceOf(id)),
        party: PARTY(c.party_full || c.party),
        raised: Math.round(c.receipts),
        spent: Math.round(c.disbursements || 0),
        cash: c.cash_on_hand_end_period == null ? null : Math.round(c.cash_on_hand_end_period),
        through: c.coverage_end_date?.slice(0, 10) || '',
      })
    }
  }
  for (const race of Object.values(totals)) {
    race.candidates.sort((a, b) => b.raised - a.raised)
    race.candidates = race.candidates.slice(0, 8)
    race.through = race.candidates.map((c) => c.through).sort().pop() || ''
  }

  // 2. Outside spending. The per-spender breakdown needs a state (and a district for the
  //    House), so first find which seats have any at all, then ask only about those.
  const ieTotals = await allPages('/schedules/schedule_e/totals/by_candidate/', { cycle: 2026 })
  const seats = new Map() // "senate|GA" / "house|PA|07"
  for (const t of ieTotals) {
    const cid = t.candidate_id || ''
    const id = where[cid]?.id || raceOf(cid[0], cid.slice(2, 4), cid.slice(4, 6))
    if (!id) continue
    const [office, st, d] = id.split('-')
    seats.set(id, office === 'senate' ? ['senate', st] : ['house', st, d === 'AL' ? '00' : d.padStart(2, '0')])
  }
  console.log(`${seats.size} seats with outside spending`)

  const rows = []
  for (const [id, [office, st, district]] of seats) {
    process.stdout.write(`  ${id}          \r`)
    const got = await allPages('/schedules/schedule_e/by_candidate/', { cycle: 2026, office, state: st, ...(district && { district }), sort: '-total' })
    rows.push(...got.map((r) => ({ ...r, race: id })))
  }
  console.log(`\n${rows.length} spender-candidate totals`)

  // Committee names and types: 100 ids per request.
  const committees = {}
  const ids = [...new Set(rows.map((r) => r.committee_id).filter(Boolean))]
  for (let i = 0; i < ids.length; i += 100) {
    for (const r of (await fec('/committees/', { committee_id: ids.slice(i, i + 100), per_page: 100 })).results) committees[r.committee_id] = r
  }

  const outside = {}
  for (const r of rows) {
    const id = r.race
    const race = (outside[id] ||= { total: 0, candidates: {}, spenders: [] })
    const name = displayName(r.candidate_name || r.candidate_id, snapRaceOf(id))
    const c = (race.candidates[r.candidate_id] ||= { id: r.candidate_id, name, party: where[r.candidate_id]?.party || null, support: 0, oppose: 0 })
    c[r.support_oppose_indicator === 'O' ? 'oppose' : 'support'] += r.total
    race.total += r.total
    const cm = committees[r.committee_id]
    race.spenders.push({
      id: r.committee_id || '',
      name: r.committee_name || cm?.name || 'Unnamed filer',
      type: TYPE(cm?.committee_type_full),
      candidate: name,
      cid: r.candidate_id,
      so: r.support_oppose_indicator === 'O' ? 'O' : 'S',
      total: Math.round(r.total),
    })
  }
  for (const race of Object.values(outside)) {
    race.total = Math.round(race.total)
    race.candidates = Object.values(race.candidates)
      .map((c) => ({ ...c, support: Math.round(c.support), oppose: Math.round(c.oppose) }))
      .sort((a, b) => b.support + b.oppose - (a.support + a.oppose))
    race.spenders.sort((a, b) => b.total - a.total)
    race.spenders = race.spenders.slice(0, 25)
  }

  // Keep the governor section from the last published copy (filled by a separate source).
  let prev = {}
  try { prev = JSON.parse(readFileSync(OUT, 'utf8')) } catch {
    try { prev = await (await fetch(MONEY_URL, { headers: { 'User-Agent': UA } })).json() } catch { /* first run */ }
  }
  const out = {
    generatedAt: new Date().toISOString(),
    source: 'FEC: candidate totals and Schedule E independent expenditures (processed), cycle 2026',
    totals,
    outside,
    governor: prev.governor || {},
  }
  mkdirSync(dirname(OUT), { recursive: true })
  writeFileSync(OUT, JSON.stringify(out) + '\n')
  const ie = Object.values(outside).reduce((a, r) => a + r.total, 0)
  console.log(`Wrote live/money.json: totals for ${Object.keys(totals).length} races, outside money in ${Object.keys(outside).length} ($${(ie / 1e6).toFixed(1)}M)`)

  if (process.argv.includes('--publish')) console.log(await publishLive(ROOT))
  else console.log('Preview it with `npm run dev`; publish with `npm run money -- --publish` or the admin page.')
}

main().catch((e) => {
  // in Actions, surface the reason as an annotation on the run page
  console.error(process.env.GITHUB_ACTIONS ? `::error::${String(e.stack || e.message).replace(/\n/g, '%0A')}` : e.message)
  process.exit(1)
})

// Live data layer: pulls current wikitext from the Wikipedia API (CORS-enabled)
// and finance totals from the FEC API, then runs the shared parsers.
import {
  PAGES,
  parseSenatePage,
  parseGovernorPage,
  parseHousePage,
  parseGenericBallot,
  parseMeasuresPage,
  parseRacePage,
  parsePositions,
} from './wiki.js'
import { cacheGet, cacheSet, netFetch } from '../lib/desktop.js'

const WIKI_API = 'https://en.wikipedia.org/w/api.php'
const WIKI_REST = 'https://en.wikipedia.org/api/rest_v1'
const FEC_API = 'https://api.open.fec.gov/v1'
const ENV_FEC_KEY = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_FEC_API_KEY) || null

// A user's own free api.data.gov key (set in About & Settings) beats the shared DEMO_KEY.
let userFecKey
export async function getFecKey() {
  if (userFecKey === undefined) userFecKey = (await cacheGet('fecKey')) || null
  return userFecKey || ENV_FEC_KEY || 'DEMO_KEY'
}
export async function setFecKey(key) {
  userFecKey = key.trim() || null
  await cacheSet('fecKey', userFecKey)
  for (const k of [...cache.keys()]) if (k.startsWith('fec:')) cache.delete(k)
}

// Wikipedia answers 429 when it wants clients to slow down; honor Retry-After.
async function wikiFetch(url, tries = 3) {
  for (let i = 0; ; i++) {
    const res = await netFetch(url)
    if (res.status !== 429 || i >= tries - 1) return res
    const wait = Math.min(30, +res.headers.get('retry-after') || 5 * (i + 1))
    await new Promise((r) => setTimeout(r, wait * 1000))
  }
}

export async function fetchWikitext(title) {
  const url = `${WIKI_API}?action=query&prop=revisions&rvprop=content|timestamp|ids&rvslots=main&format=json&formatversion=2&redirects=1&origin=*&titles=${encodeURIComponent(title)}`
  const res = await wikiFetch(url)
  if (!res.ok) throw new Error(`Wikipedia ${res.status}`)
  const json = await res.json()
  const page = json.query?.pages?.[0]
  const rev = page?.revisions?.[0]
  if (!rev) throw new Error(`No page: ${title}`)
  return { text: rev.slots.main.content, timestamp: rev.timestamp, revid: rev.revid, title: page.title }
}

// Last fetched copy of each overview page, so unchanged pages are never re-downloaded.
const pageCache = new Map()
const OVERVIEW = ['senate', 'governor', 'house', 'houseRatings', 'measures']

// Revision IDs for several pages in one tiny request (~2 KB).
async function latestRevisions(titles) {
  const url = `${WIKI_API}?action=query&prop=revisions&rvprop=ids|timestamp&format=json&formatversion=2&redirects=1&origin=*&titles=${encodeURIComponent(titles.join('|'))}`
  const res = await wikiFetch(url)
  if (!res.ok) throw new Error(`Wikipedia ${res.status}`)
  const j = await res.json()
  const back = Object.fromEntries((j.query?.redirects || []).map((r) => [r.to, r.from]))
  const norm = Object.fromEntries((j.query?.normalized || []).map((r) => [r.to, r.from]))
  const out = {}
  for (const p of j.query?.pages || []) {
    const asked = back[p.title] || p.title
    out[norm[asked] || asked] = p.revisions?.[0]?.revid
  }
  return out
}

// Full national dataset, same shape as snapshot.json. Returns null when no
// overview page has changed since the last call (nothing to re-parse).
export async function fetchAll() {
  const titles = OVERVIEW.map((k) => PAGES[k])
  const revs = await latestRevisions(titles).catch(() => ({}))
  const stale = titles.filter((t) => !pageCache.has(t) || pageCache.get(t).revid !== revs[t])
  if (!stale.length) return null
  const fresh = await Promise.all(stale.map(fetchWikitext))
  stale.forEach((t, i) => pageCache.set(t, fresh[i]))
  const pages = Object.fromEntries(OVERVIEW.map((k) => [k, pageCache.get(PAGES[k])]))
  return { ...buildDataset(pages), changed: stale.length }
}

const EXPECT = { senate: 33, governor: 36, house: 435 }

// Sanity checks so a Wikipedia restructure shows up as a warning, not silently missing races.
export function healthCheck(data) {
  const warn = []
  const sen = Object.keys(data.senate).length
  const gov = Object.keys(data.governor).length
  const house = Object.values(data.house).flat()
  if (sen < EXPECT.senate) warn.push(`Senate: only ${sen} races parsed (expected ${EXPECT.senate}+)`)
  if (gov !== EXPECT.governor) warn.push(`Governor: ${gov} races parsed (expected ${EXPECT.governor})`)
  if (house.length !== EXPECT.house) warn.push(`House: ${house.length} seats parsed (expected ${EXPECT.house})`)
  const all = [...Object.values(data.senate), ...Object.values(data.governor), ...house]
  const noCands = all.filter((r) => !r.candidates.length).length
  if (noCands > 5) warn.push(`${noCands} races have no candidates parsed`)
  const junk = all.filter((r) => r.candidates.some((c) => /[{}|[\]=]/.test(c.name))).length
  if (junk) warn.push(`${junk} races have unparsed markup in candidate names`)
  if (!Object.values(data.measures).flat().length) warn.push('No ballot measures parsed')
  return warn
}

export function buildDataset({ senate, governor, house, houseRatings, measures }) {
  return {
    generatedAt: new Date().toISOString(),
    revisions: Object.fromEntries(
      Object.entries({ senate, governor, house, houseRatings, measures }).map(([k, v]) => [k, { timestamp: v.timestamp, revid: v.revid, title: v.title }]),
    ),
    genericBallot: parseGenericBallot(house.text),
    senate: parseSenatePage(senate.text),
    governor: parseGovernorPage(governor.text),
    house: parseHousePage(house.text, houseRatings.text),
    measures: parseMeasuresPage(measures.text),
  }
}

// ---------- per-race / per-candidate (on demand, cached) ----------

const cache = new Map()
const TTL = 10 * 60 * 1000

async function cached(key, fn, ttl = TTL) {
  const hit = cache.get(key)
  if (hit && Date.now() - hit.t < ttl) return hit.v
  const stored = await cacheGet(key)
  if (stored && Date.now() - stored.t < ttl) { cache.set(key, stored); return stored.v }
  const v = await fn()
  const entry = { t: Date.now(), v }
  cache.set(key, entry)
  cacheSet(key, entry)
  return v
}

export function raceIntel(page, district = null) {
  return cached(`race:${page}:${district}`, async () => {
    let { text, timestamp } = await fetchWikitext(page)
    // Big delegations (CA, TX...) split districts into sub-articles like "(districts 1–26)".
    if (district != null && !new RegExp(`^==\\s*District ${district}\\s*==`, 'm').test(text)) {
      for (const m of text.matchAll(/\{\{main\|([^}|]*\(districts (\d+)[–-](\d+)\))/gi)) {
        if (district >= +m[2] && district <= +m[3]) {
          ;({ text, timestamp } = await fetchWikitext(m[1].trim()))
          break
        }
      }
    }
    return { ...parseRacePage(text, district), timestamp }
  })
}

export const housePage = (stateName, atLarge) =>
  `2026 United States House of Representatives ${atLarge ? 'election' : 'elections'} in ${stateName}`

export function candidateSummary(title) {
  return cached(`sum:${title}`, async () => {
    const res = await wikiFetch(`${WIKI_REST}/page/summary/${encodeURIComponent(title.replace(/ /g, '_'))}`)
    if (!res.ok) return null
    const j = await res.json()
    return {
      title: j.title,
      description: j.description || '',
      extract: j.extract || '',
      thumb: j.thumbnail?.source || null,
      url: j.content_urls?.desktop?.page,
    }
  }, 6 * 60 * 60 * 1000)
}

export function candidatePositions(title) {
  return cached(`pos2:${title}`, async () => {
    const { text } = await fetchWikitext(title)
    return parsePositions(text)
  }, 6 * 60 * 60 * 1000)
}

// Commons image -> small thumbnail URL (rendered pixelated in the UI).
export const commonsThumb = (file, w = 48) =>
  `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(file.replace(/^(File|Image):/i, ''))}?width=${w}`

// FEC candidate totals for a federal race. office: 'senate' | 'house'.
export function fecRace(office, state, district) {
  const q = new URLSearchParams({
    cycle: '2026',
    office,
    state,
    election_full: 'true',
    per_page: '12',
    sort: '-total_receipts',
  })
  if (office === 'house') q.set('district', district === 'AL' ? '00' : String(district).padStart(2, '0'))
  return cached(`fec:${office}:${state}:${district}`, async () => {
    q.set('api_key', await getFecKey())
    const res = await netFetch(`${FEC_API}/elections/?${q}`)
    if (res.status === 429) throw new Error('FEC rate limit hit — add your free FEC key in ⓘ About & Settings')
    if (res.status === 403) throw new Error('FEC key rejected — check it in ⓘ About & Settings')
    if (!res.ok) throw new Error(`FEC ${res.status}`)
    const j = await res.json()
    return j.results.map((r) => ({
      name: r.candidate_name,
      party: (r.party_full || '').startsWith('DEM') ? 'D' : (r.party_full || '').startsWith('REP') ? 'R' : 'I',
      raised: r.total_receipts,
      spent: r.total_disbursements,
      cash: r.cash_on_hand_end_period,
      through: r.coverage_end_date,
      incumbent: r.incumbent_challenge_full,
      id: r.candidate_id,
    }))
  }, 60 * 60 * 1000)
}

// 2026 congressional district boundaries (120th Congress lines, which include the
// mid-decade redraws) from the Census TIGERweb service, as GeoJSON in lon/lat.
const TIGER_CD = 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Legislative/MapServer/0/query'

export function districtShapes(fips) {
  const q = new URLSearchParams({
    where: `STATE='${fips}'`,
    outFields: 'CD120,NAME',
    returnGeometry: 'true',
    outSR: '4326',
    maxAllowableOffset: '0.004',
    geometryPrecision: '4',
    f: 'geojson',
  })
  return cached(`cd120:${fips}`, async () => {
    const res = await netFetch(`${TIGER_CD}?${q}`)
    if (!res.ok) throw new Error(`Census TIGERweb ${res.status}`)
    const j = await res.json()
    if (!j.features?.length) throw new Error('No district boundaries returned')
    return j.features
  }, 7 * 24 * 60 * 60 * 1000)
}

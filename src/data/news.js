// News wire. Top stories come straight from ~34 outlets' public RSS feeds, picked
// for an even left/center/right spread, plus Google News searches for each race type
// (Senate, governor, House) so state and local outlets are in the mix. Each story is
// grouped across outlets so you can see who is (and isn't) covering it.
import { cacheGet, cacheSet, IS_DESKTOP, netFetch } from '../lib/desktop.js'
import { STATES } from './wiki.js'
import { FEEDS, STATE_FEEDS, balance, leanOf } from './sources.js'

const GNEWS = 'https://news.google.com/rss/search'
const GAP_MS = 1200 // one search at a time, politely spaced
const POOL_TTL = 4 * 60 * 1000 // feeds update within minutes of publishing
const RACE_TTL = 15 * 60 * 1000
const RETRY_TTL = 2 * 60 * 1000 // a race feed missing its search half tries again sooner
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// On the web, feeds come through the site's /api/feed (publishers don't send CORS headers).
const feedFetch = (url, init) => (IS_DESKTOP ? netFetch(url, init) : fetch(`/api/feed?u=${encodeURIComponent(url)}`, init))

// ---------- RSS / Atom ----------
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', hellip: '…' }
const decode = (s = '') => s
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/<[^>]+>/g, '')
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
  .replace(/&([a-z]+);/gi, (m, n) => ENT[n.toLowerCase()] ?? m)
  .replace(/\s+/g, ' ')
  .trim()
const tag = (xml, name) => xml.match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`, 'i'))?.[1]
const attr = (xml, re) => xml.match(re)?.[1]?.replace(/&amp;/g, '&')

export function parseFeed(xml, domain) {
  const items = xml.match(/<item\b[\s\S]*?<\/item>|<entry\b[\s\S]*?<\/entry>/gi) || []
  return items.map((it) => {
    // Aggregator items name the real outlet in <source url="…">Name</source>.
    const src = it.match(/<source\b[^>]*url="([^"]+)"[^>]*>([\s\S]*?)<\/source>/i)
    let title = decode(tag(it, 'title'))
    let from = domain
    if (src) {
      try { from = new URL(src[1].replace(/&amp;/g, '&')).hostname.replace(/^www\./, '') } catch { /* keep feed domain */ }
      const name = decode(src[2])
      if (name && title.endsWith(` - ${name}`)) title = title.slice(0, -(name.length + 3))
    }
    const link = decode(tag(it, 'link') || '') || attr(it, /<link\b[^>]*href="([^"]+)"/i) || decode(tag(it, 'guid') || '')
    const date = decode(tag(it, 'pubDate') || tag(it, 'published') || tag(it, 'updated') || tag(it, 'dc:date') || '')
    const t = Date.parse(date)
    return {
      title,
      url: link,
      domain: from,
      at: Number.isFinite(t) ? new Date(t).toISOString() : null,
      image: attr(it, /<media:(?:content|thumbnail)\b[^>]*url="([^"]+)"/i) || attr(it, /<enclosure\b[^>]*url="([^"]+)"[^>]*type="image/i) || null,
    }
  }).filter((a) => a.title && /^https:\/\//.test(a.url) && a.at)
}

async function readFeed(f) {
  const ctl = new AbortController()
  const t = setTimeout(() => ctl.abort(), 12000)
  try {
    const res = await feedFetch(f.url, { signal: ctl.signal })
    if (!res.ok) throw new Error(res.status)
    return parseFeed(await res.text(), f.domain)
  } finally { clearTimeout(t) }
}

// Google News search: hundreds of outlets, including the state and local press that
// covers governor and House races. Results name the original outlet, so lean ratings apply.
export const gnewsUrl = (q, days) => `${GNEWS}?q=${encodeURIComponent(`${q} when:${days}d`)}&hl=en-US&gl=US&ceid=US:en`
const gnews = async (q, { days = 7, beat } = {}) => {
  const list = await readFeed({ url: gnewsUrl(q, days), domain: 'news.google.com' })
  return list.filter((a) => a.domain !== 'news.google.com').map((a) => (beat ? { ...a, beat } : a))
}

// A state's statehouse newsroom. Its feed carries full article text (about 1 MB), so
// it's read only when one of that state's races is open, and kept for 20 minutes.
const STATE_TTL = 20 * 60 * 1000
function stateFeed(st) {
  const f = STATE_FEEDS.find((x) => x.state === st)
  if (!f) return Promise.resolve([])
  const have = memo.get(`state:${st}`)
  if (have && Date.now() - have.at < STATE_TTL) return have.list
  const list = readFeed(f).catch(() => [])
  memo.set(`state:${st}`, { at: Date.now(), list })
  return list
}

// Race-type beats searched on every refresh, so the desk isn't limited to what
// national politics desks happen to cover.
export const BEATS = [
  ['senate', '"Senate race" OR "Senate seat" OR "Senate candidate" OR "for Senate"'],
  ['governor', '"governor\'s race" OR gubernatorial OR "race for governor" OR "for governor" OR "governor candidate"'],
  ['house', '"House race" OR "congressional race" OR "congressional district" OR "House seat" OR "for Congress"'],
  ['all', 'midterms OR "midterm elections" OR "early voting"'],
]

// Every outlet's latest headlines (national feeds and beat searches), fetched in parallel and added to a rolling 14-day
// archive on disk, so race files can find coverage older than what feeds still list.
const memo = new Map()
const ARCHIVE_KEY = 'news3:archive'
const ARCHIVE_DAYS = 14
let poolPromise = null
export function fetchPool({ force } = {}) {
  const have = memo.get('pool')
  if (have && !force && Date.now() - have.at < POOL_TTL) return Promise.resolve(have)
  poolPromise ||= (async () => {
    const results = await Promise.allSettled([...FEEDS.map(readFeed), ...BEATS.map(([beat, q]) => gnews(q, { days: 3, beat }))])
    const ok = results.slice(0, FEEDS.length).filter((r) => r.status === 'fulfilled').length
    const beats = results.slice(FEEDS.length).filter((r) => r.status === 'fulfilled').length
    if (!ok && !beats) throw new Error('no news feeds reachable')
    const fresh = results.flatMap((r) => (r.status === 'fulfilled' ? r.value : []))
    const old = have?.archive || (await cacheGet(ARCHIVE_KEY)) || []
    const cutoff = Date.now() - ARCHIVE_DAYS * 86400e3
    const byUrl = new Map([...old, ...fresh].filter((a) => Date.parse(a.at) > cutoff).map((a) => [a.url, a]))
    const archive = [...byUrl.values()].sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, 6000)
    cacheSet(ARCHIVE_KEY, archive)
    const recent = Date.now() - 3 * 86400e3
    const v = { at: Date.now(), articles: archive.filter((a) => Date.parse(a.at) > recent), archive, ok, total: FEEDS.length, beats }
    memo.set('pool', v)
    return v
  })().finally(() => { poolPromise = null })
  return poolPromise
}

// ---------- search queue (urgent jobs jump ahead) ----------
const jobs = []
let pumping = false
let last = 0

function enqueue(fn, urgent) {
  return new Promise((resolve, reject) => {
    const job = { fn, resolve, reject }
    if (urgent) jobs.unshift(job)
    else jobs.push(job)
    pump()
  })
}

async function pump() {
  if (pumping) return
  pumping = true
  while (jobs.length) {
    const wait = last + GAP_MS - Date.now()
    if (wait > 0) await sleep(wait)
    const job = jobs.shift()
    try { job.resolve(await job.fn()) } catch (e) { job.reject(e) } finally { last = Date.now() }
  }
  pumping = false
}

// ---------- grouping ----------
// "Story title | Station Name" / "Story title – Paper": drop the outlet suffix.
const bare = (t) => t.replace(/\s+[|–—]\s+[^|–—]{2,45}$/, '').replace(/\s+-\s+[A-Z][^-]{1,40}$/, '').trim()

// Different outlets word the same story differently, so stories are grouped by
// shared keywords rather than identical titles.
const STOP = new Set(('the and but for with from into over after amid about than this that its his her their they who what why how '
  + 'are was were been has have had will would could can not new says say said just more most out off now here').split(' '))
const words = (t) => new Set(t.toLowerCase().replace(/['’]s\b/g, '').replace(/[^a-z0-9 ]/g, ' ').split(/\s+/)
  .filter((w) => w.length > 2 && !STOP.has(w)).map((w) => w.replace(/(?<=...)s$/, '')))
// Words every political headline shares count half, so "White House press secretary"
// alone doesn't merge two different stories.
const WEAK = new Set('white house trump gop democrat republican senate senator campaign election president state governor congres vote voter poll american america biden harri vance rep sen'.split(' '))
function similar(a, b) {
  let shared = 0
  let weight = 0
  for (const w of a) if (b.has(w)) { shared++; weight += WEAK.has(w) ? 0.5 : 1 }
  return weight >= 3 && shared / Math.min(a.size, b.size) >= 0.5 && shared / (a.size + b.size - shared) >= 0.34
}

// Networks of local stations (iHeart and co.) count once.
const outletOf = (domain = '') => {
  const d = domain.toLowerCase().replace(/^(www|m|amp)\./, '')
  return /\.iheart\.com$/.test(d) ? 'iheart.com' : d
}

// One story per event with every outlet that carried it.
export function cluster(articles) {
  const stories = []
  const sorted = articles
    .map((a) => ({ ...a, title: bare(a.title), domain: outletOf(a.domain) }))
    .filter((a) => a.title.length >= 20 && /^https:\/\//.test(a.url || '') && a.at)
    .sort((a, b) => (a.at < b.at ? -1 : 1))
  for (const a of sorted) {
    const w = words(a.title)
    // Match any headline already in a story, so differently worded follow-ups still join.
    let s = stories.find((x) => x.words.some((v) => similar(v, w)))
    if (!s) stories.push((s = { words: [], articles: [], image: null, beats: new Set() }))
    s.words.push(w)
    if (a.beat) s.beats.add(a.beat)
    if (s.articles.some((x) => x.domain === a.domain)) continue
    s.articles.push({ title: a.title, url: a.url, domain: a.domain, at: a.at })
    if (!s.image && /^https:\/\//.test(a.image || '')) s.image = a.image
  }
  return stories.map(({ articles: list, image, beats }) => {
    // Headline: a center outlet's wording if one carried it, else the first report.
    const lead = list.find((x) => leanOf(x.domain) === 0) || list[0]
    return {
      title: lead.title, url: lead.url, domain: lead.domain, image,
      at: list[list.length - 1].at, first: list[0].at,
      outlets: list.map((x) => x.domain),
      articles: list.slice(0, 40),
      beats: [...beats],
    }
  })
}

// Big (many outlets), balanced (covered across the spectrum) and fresh ranks first.
export function storyScore(s, now = Date.now()) {
  const b = balance(s.outlets)
  return (1 + Math.log2(s.outlets.length)) * (1 + 0.3 * Math.max(0, b.sides - 1)) * Math.exp(-(now - Date.parse(s.at)) / (12 * 3600e3))
}

// ---------- queries ----------
const plainName = (n = '') => n.replace(/\(.*?\)/g, '').replace(/"/g, '').replace(/,?\s+(jr|sr|ii|iii|iv)\.?$/i, '').replace(/\s+/g, ' ').trim()
const majors = (race) => race.candidates.filter((c) => c.party === 'D' || c.party === 'R').map((c) => plainName(c.name)).filter(Boolean).slice(0, 3)

export function raceQuery(race) {
  const st = STATES[race.state]
  const names = majors(race)
  if (!names.length && race.incumbent?.name) names.push(plainName(race.incumbent.name))
  const office = race.type === 'senate' ? 'Senate' : race.type === 'governor' ? 'governor' : 'congressional'
  if (!names.length) return `"${st}" ${office} race`
  return `${names.length > 1 ? `(${names.map((n) => `"${n}"`).join(' OR ')})` : `"${names[0]}"`} "${st}"`
}

// Political-feed headlines that are about the election (or name a tracked candidate).
const ELECTION = /\b(midterms?|elections?|electoral|ballots?|vot(?:e|es|ed|ers?|ing)|polls?|polling|pollsters?|campaign\w*|candidates?|primar(?:y|ies)|race|swing|battleground|gubernatorial|governor'?s? race|redistricting|gerrymander\w*|nrsc|dscc|dccc|nrcc|reelection|re-election|early voting|turnout|endorse\w*|debates?|ads?|attack ad|fundrais\w*|super pac|flip(?:s|ped|ping)?)\b/i

// Other countries' elections ("Israeli election", "Canada votes") aren't ours.
const FOREIGN = /\b(israel\w*|netanyahu|gaza|canad\w*|britain|british|u\.?k\.?|france|french|german\w*|japan\w*|brazil\w*|mexic\w*|ukrain\w*|russia\w*|india\w*|europe\w*|venezuela\w*|argentin\w*|australia\w*)\b/i

// Which races a headline is about: a full candidate name, or a last name plus the state.
export function raceIndex(races) {
  return races.flatMap((r) => majors(r).map((name) => ({
    race: r,
    full: name.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' '),
    last: name.split(' ').pop().toLowerCase(),
    st: STATES[r.state].toLowerCase(),
  })))
}

export function tagRaces(title, index) {
  const t = ` ${title.toLowerCase().replace(/['’]s\b/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ')} `
  const hit = new Map()
  for (const x of index) {
    if (t.includes(` ${x.full} `) || (x.last.length > 3 && t.includes(` ${x.last} `) && t.includes(` ${x.st} `))) hit.set(x.race.id, x.race)
  }
  return [...hit.values()].slice(0, 3)
}

// ---------- public API ----------
export const TOP_KEY = 'news3:top'
export const raceKey = (race) => `news3:${race.id}`

// Last copy of a feed regardless of age, for an instant first paint.
export async function cachedNews(key) {
  return memo.get(key) || (await cacheGet(key)) || null
}

function remember(key, v) {
  memo.set(key, v)
  cacheSet(key, v)
  return v
}

// Group everything first so each story's outlet count is complete, then keep the election ones.
export function topStories(articles, races = [], now = Date.now()) {
  const idx = raceIndex(races)
  const named = (t) => idx.length && tagRaces(t, idx).length
  const relevant = (s) => s.articles.some((a) => named(a.title) || (ELECTION.test(a.title) && !(FOREIGN.test(a.title) && !/midterm/i.test(a.title))))
  return cluster(articles).filter(relevant)
    .map((s) => ({ ...s, raceIds: [...new Set(s.articles.flatMap((a) => (idx.length ? tagRaces(a.title, idx) : []).map((r) => r.id)))] }))
    .sort((a, b) => storyScore(b, now) - storyScore(a, now)).slice(0, 120)
}

export async function fetchTopNews({ force, races = [] } = {}) {
  const pool = await fetchPool({ force })
  return remember(TOP_KEY, { at: pool.at, stories: topStories(pool.articles, races), feeds: { ok: pool.ok, total: pool.total, beats: pool.beats } })
}

// A statehouse headline counts for a race when it names a candidate in an election
// context (the state goes without saying there).
const namesCandidate = (race) => {
  const names = majors(race)
  const lasts = names.map((n) => n.split(' ').pop().toLowerCase()).filter((k) => k.length > 3)
  return (a) => {
    const t = a.title.toLowerCase()
    return names.some((n) => t.includes(n.toLowerCase())) || (lasts.some((k) => new RegExp(`\\b${k}\\b`).test(t)) && ELECTION.test(a.title))
  }
}

// A search hit counts for a race when its headline names a candidate or the state.
const onTopic = (race) => {
  const keys = [...majors(race).map((n) => n.split(' ').pop().toLowerCase()), STATES[race.state].toLowerCase()].filter((k) => k.length > 2)
  return (a) => { const t = a.title.toLowerCase(); return keys.some((k) => t.includes(k)) }
}

// Outlet feeds and the state's statehouse newsroom naming the race's candidates, plus a
// Google News search of every outlet (local papers and TV included). onFeeds gets the outlet-feed half right away.
export async function fetchRaceNews(race, { urgent, force, onFeeds } = {}) {
  const key = raceKey(race)
  const have = memo.get(key) || (await cacheGet(key))
  if (have && !force && Date.now() - have.at < (have.partial ? RETRY_TTL : RACE_TTL)) return have
  const idx = raceIndex([race])
  const byTime = (list) => cluster(list).sort((a, b) => (b.at > a.at ? 1 : -1)).slice(0, 30)
  const feeds = Promise.all([fetchPool().catch(() => ({ archive: [] })), stateFeed(race.state)]).then(([p, local]) => {
    const mine = [...p.archive.filter((a) => tagRaces(a.title, idx).length), ...local.filter(namesCandidate(race))]
    onFeeds?.({ at: Date.now(), stories: byTime(mine), partial: true, pending: true })
    return mine
  })
  const [pool, wide] = await Promise.allSettled([
    feeds,
    enqueue(() => gnews(raceQuery(race), { days: 14 }), urgent).then((list) => list.filter(onTopic(race))),
  ])
  if (pool.status === 'rejected' && wide.status === 'rejected') {
    if (have) return { ...have, error: wide.reason.message }
    throw wide.reason
  }
  const stories = byTime([...(pool.value || []), ...(wide.value || [])])
  return remember(key, { at: Date.now(), stories, partial: wide.status === 'rejected' })
}

// Search all U.S. coverage: the outlet-feed archive plus a Google News search.
export async function searchNews(q, { races = [] } = {}) {
  const key = `search:${q.toLowerCase().trim()}`
  const have = memo.get(key)
  if (have && Date.now() - have.at < POOL_TTL) return have
  const terms = q.toLowerCase().replace(/["()]/g, ' ').split(/\s+/).filter((t) => t.length > 1 && t !== 'or')
  const [pool, wide] = await Promise.allSettled([fetchPool(), enqueue(() => gnews(q, { days: 7 }), true)])
  const local = pool.status === 'fulfilled' ? pool.value.archive.filter((a) => terms.every((t) => a.title.toLowerCase().includes(t))) : []
  if (wide.status === 'rejected' && !local.length) throw wide.reason
  const idx = raceIndex(races)
  const now = Date.now()
  const stories = cluster([...local, ...(wide.value || [])])
    .map((s) => ({ ...s, raceIds: [...new Set(s.articles.flatMap((a) => tagRaces(a.title, idx).map((r) => r.id)))] }))
    .sort((a, b) => storyScore(b, now) - storyScore(a, now)).slice(0, 60)
  const v = { at: now, q, stories, partial: wide.status === 'rejected' }
  memo.set(key, v)
  return v
}

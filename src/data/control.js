// Live control file: live/control.json in the GitHub repo, edited with the local
// admin page (npm run admin) and read by every installed copy on each refresh.
// It changes content only (banner, notes, featured races, corrections), never code,
// so edits reach everyone in ~5 minutes without an app update.
import { REPO_URL, cacheGet, cacheSet, netFetch } from '../lib/desktop.js'

// Published copy lives on the repo's `live` branch; the dev server previews the local draft.
export const CONTROL_URL = `${REPO_URL.replace('github.com', 'raw.githubusercontent.com')}/live/control.json`
const DEV = typeof import.meta !== 'undefined' && import.meta.env?.DEV
const LABELS = ['Safe D', 'Likely D', 'Lean D', 'Tilt D', 'Tossup', 'Tilt R', 'Lean R', 'Likely R', 'Safe R']
const SCORE = { 'Safe D': -3, 'Likely D': -2, 'Lean D': -1, 'Tilt D': -0.5, Tossup: 0, 'Tilt R': 0.5, 'Lean R': 1, 'Likely R': 2, 'Safe R': 3 }

export const EMPTY_CONTROL = { banner: null, notes: {}, featured: [], ratings: {}, results: {}, news: [], minVersion: null }

const str = (v, max = 600) => (typeof v === 'string' ? v.trim().slice(0, max) : '')
const https = (v) => (typeof v === 'string' && /^https:\/\/[^\s"<>]+$/.test(v) ? v : null)
const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {})

// The file is plain data from the network: keep only known fields with sane types.
export function sanitizeControl(raw) {
  const r = obj(raw)
  const b = obj(r.banner)
  const banner = str(b.text) ? { id: str(b.id, 60) || str(b.text, 60), text: str(b.text, 280), level: b.level === 'alert' ? 'alert' : 'info', link: https(b.link) } : null
  const notes = Object.fromEntries(Object.entries(obj(r.notes)).map(([k, v]) => [str(k, 40), str(v, 1200)]).filter(([k, v]) => k && v))
  const featured = (Array.isArray(r.featured) ? r.featured : []).map((x) => str(x, 40)).filter(Boolean).slice(0, 24)
  const ratings = Object.fromEntries(Object.entries(obj(r.ratings)).filter(([, v]) => LABELS.includes(v)))
  const results = Object.fromEntries(Object.entries(obj(r.results)).map(([k, v]) => {
    const x = obj(v)
    if (x.hold === true) return [k, { hold: true }] // HQ: not called yet, ignore Wikipedia's mark
    return [k, str(x.winner, 80) && ['D', 'R', 'I'].includes(x.party) ? { winner: str(x.winner, 80), party: x.party, pct: Number.isFinite(+x.pct) && x.pct !== '' && x.pct != null ? +x.pct : null, flip: !!x.flip } : null]
  }).filter(([, v]) => v))
  // Pinned headlines: { title, url, race (optional race id) }
  const news = (Array.isArray(r.news) ? r.news : []).map((n) => {
    const x = obj(n)
    return { title: str(x.title, 200), url: https(x.url), race: str(x.race, 40) || null }
  }).filter((n) => n.title && n.url).slice(0, 12)
  const minVersion = /^\d+\.\d+\.\d+$/.test(r.minVersion || '') ? r.minVersion : null
  return { banner, notes, featured, ratings, results, news, minVersion, updatedAt: str(r.updatedAt, 40) || null }
}

// raw.githubusercontent.com caches for 5 minutes, too slow for election-night corrections.
// Publishing purges the jsDelivr copy, so it is usually fresh within seconds.
const CONTROL_FAST = `https://cdn.jsdelivr.net/gh/${REPO_URL.replace('https://github.com/', '')}@live/control.json`
let last = null

const newer = (a, b) => (!b || (a?.updatedAt || '') >= (b.updatedAt || '') ? a : b)

const get = async (url, init) => { const res = await netFetch(url, init); if (!res.ok) throw new Error(String(res.status)); return sanitizeControl(await res.json()) }

// fast: both mirrors at once, newest wins (jsDelivr purges can be throttled for an hour).
async function fetchFresh(fast) {
  if (DEV) return get(`/live/control.json?t=${Date.now()}`)
  if (!fast) return get(CONTROL_URL)
  const got = (await Promise.all([get(CONTROL_FAST, { cache: 'no-store' }), get(CONTROL_URL)].map((p) => p.catch(() => null)))).filter(Boolean)
  if (!got.length) throw new Error('no mirror reachable')
  return got.reduce((a, b) => newer(a, b))
}

// fast: election night, when HQ corrections should land within about a minute.
export async function fetchControl({ fast = false } = {}) {
  try {
    const ctl = newer(await fetchFresh(fast), last) // never step back to an older copy
    last = ctl
    cacheSet('control', ctl)
    return ctl
  } catch {
    // offline or file missing: keep the last copy we saw
    return last || sanitizeControl(await cacheGet('control'))
  }
}

// Layer the control file over the live dataset: rating/result corrections, HQ notes and pinned headlines.
export function applyControl(data, ctl) {
  if (!ctl) return data
  const touch = (r) => {
    const rating = ctl.ratings[r.id]
    const result = ctl.results[r.id]
    const note = ctl.notes[r.id]
    const news = ctl.news.filter((n) => n.race === r.id)
    if (!rating && !result && !note && !news.length) return r
    return {
      ...r,
      ...(rating && { consensus: { ...r.consensus, label: rating, score: SCORE[rating], hq: true } }),
      ...(result?.hold && { result: null, hqHold: true, candidates: r.candidates.map((c) => (c.won ? { ...c, won: false } : c)) }),
      ...(result && !result.hold && { result: { ...result, hq: true } }),
      ...(note && { hqNote: note }),
      ...(news.length && { hqNews: news }),
    }
  }
  const map = (o) => Object.fromEntries(Object.entries(o).map(([k, r]) => [k, touch(r)]))
  return {
    ...data,
    senate: map(data.senate),
    governor: map(data.governor),
    house: Object.fromEntries(Object.entries(data.house).map(([st, list]) => [st, list.map(touch)])),
  }
}

// "1.0.2" < "1.1.0"
export const olderThan = (a, b) => {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) < (pb[i] || 0)
  return false
}

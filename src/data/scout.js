// Scout file: race calls from the decision desks (AP, NBC, CNN, ...) and live vote counts,
// found by the HQ call scout (scripts/scout.mjs) and published to the `live` branch.
// jsDelivr is purged on every publish, so it's fresh within seconds and has no rate limit;
// raw.githubusercontent.com (5-minute cache) is the fallback.
import { REPO_URL, netFetch } from '../lib/desktop.js'

const REPO = REPO_URL.replace('https://github.com/', '')
const URLS = [
  `https://cdn.jsdelivr.net/gh/${REPO}@live/scout.json`,
  `${REPO_URL.replace('github.com', 'raw.githubusercontent.com')}/live/scout.json`,
]
const DEV = typeof import.meta !== 'undefined' && import.meta.env?.DEV

const str = (v, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '')
const https = (v) => (typeof v === 'string' && /^https:\/\/[^\s"<>]+$/.test(v) ? v : null)
const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {})
const num = (v) => (Number.isFinite(v) ? v : null)
const PARTY = ['D', 'R', 'I']

export const EMPTY_SCOUT = { calls: {}, counts: {}, official: {}, updatedAt: null }

export function sanitizeScout(raw) {
  const r = obj(raw)
  const calls = Object.fromEntries(Object.entries(obj(r.calls)).map(([id, v]) => {
    const x = obj(v)
    const sources = (Array.isArray(x.sources) ? x.sources : []).map((s) => ({ desk: str(obj(s).desk, 40), url: https(obj(s).url) })).filter((s) => s.desk && s.url).slice(0, 8)
    return [str(id, 40), str(x.winner, 80) && PARTY.includes(x.party) ? { winner: str(x.winner, 80), party: x.party, pct: num(x.pct), flip: !!x.flip, sources, by: x.by === 'hq' ? 'hq' : 'auto', at: str(x.at, 40) } : null]
  }).filter(([id, v]) => id && v))
  const counts = Object.fromEntries(Object.entries(obj(r.counts)).map(([id, v]) => {
    const x = obj(v)
    const cands = (Array.isArray(x.cands) ? x.cands : []).map((c) => ({ name: str(obj(c).name, 80), party: PARTY.includes(obj(c).party) ? c.party : 'I', votes: num(obj(c).votes), pct: num(obj(c).pct) })).filter((c) => c.name).slice(0, 6)
    return [str(id, 40), cands.length ? { pctIn: num(x.pctIn), cands, source: str(x.source, 120), url: https(x.url), asOf: str(x.asOf, 60), at: str(x.at, 40) } : null]
  }).filter(([id, v]) => id && v))
  const official = Object.fromEntries(Object.entries(obj(r.official)).map(([st, u]) => [str(st, 2), https(u)]).filter(([st, u]) => /^[A-Z]{2}$/.test(st) && u))
  return { calls, counts, official, updatedAt: str(r.updatedAt, 40) || null }
}

let last = null
export async function fetchScout() {
  for (const url of DEV ? ['/live/scout.json'] : URLS) {
    try {
      const res = await netFetch(`${url}${DEV ? `?t=${Date.now()}` : ''}`, { cache: 'no-store' })
      if (!res.ok) continue
      const sc = sanitizeScout(await res.json())
      if (!last || (sc.updatedAt || '') >= (last.updatedAt || '')) last = sc // never step back to an older copy
      return last
    } catch { /* try the next mirror */ }
  }
  return last
}

// Desk calls replace Wikipedia's; counts ride along on every race (called or not).
export function applyScout(data, sc) {
  if (!sc) return data
  const touch = (r) => {
    const call = sc.calls[r.id]
    const count = sc.counts[r.id]
    const official = sc.official[r.state]
    if (!call && !count && !official) return r
    const last = (n) => n.toLowerCase().split(/\s+/).filter((w) => !/^(jr\.?|sr\.?|ii|iii|iv)$/.test(w)).pop()
    return {
      ...r,
      ...(call && { result: { ...call, scout: true }, candidates: r.candidates.map((c) => ({ ...c, won: last(c.name) === last(call.winner) })) }),
      ...(count && { count }),
      ...(official && { officialResults: official }),
    }
  }
  const map = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Array.isArray(v) ? v.map(touch) : touch(v)]))
  return { ...data, senate: map(data.senate), governor: map(data.governor), house: map(data.house) }
}

// "AP, CNN +2"
export const deskList = (sources = [], max = 3) => {
  const names = sources.map((s) => s.desk)
  return names.length > max ? `${names.slice(0, max).join(', ')} +${names.length - max}` : names.join(', ')
}

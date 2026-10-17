export const ELECTION_DAY = new Date('2026-11-03T06:00:00-05:00')

// Diverging rating scale: blue (D) → amber toss-up → red (R).
export const RATING_COLORS = {
  'Safe D': '#2456e6',
  'Likely D': '#4a80ff',
  'Lean D': '#7fa6ff',
  'Tilt D': '#b0c6ff',
  Tossup: '#ffd700',
  'Tilt R': '#ffb0a8',
  'Lean R': '#ff7a6e',
  'Likely R': '#f2443a',
  'Safe R': '#b8141f',
}
export const NO_RACE = '#0c1626'

export const ratingColor = (label) => RATING_COLORS[label] || NO_RACE
export const ratingClass = (label = '') => `rating-badge rating-${label.toLowerCase().replace(/\s+/g, '-').replace('tilt', 'lean').replace('tossup', 'toss-up')}`

export const PARTY_COLOR = { D: '#4488ff', R: '#ff4444', I: '#bb44ff', L: '#ffd700', G: '#33dd66' }
export const partyColor = (p) => PARTY_COLOR[p] || PARTY_COLOR.I
export const partyBadge = (p) => (p === 'D' ? 'badge-d' : p === 'R' ? 'badge-r' : 'badge-i')

export function fmtMoney(n) {
  if (n == null || Number.isNaN(n)) return '—'
  const a = Math.abs(n)
  if (a >= 1e9) return `$${(n / 1e9).toFixed(2)}B`
  if (a >= 1e6) return `$${(n / 1e6).toFixed(1)}M`
  if (a >= 1e3) return `$${(n / 1e3).toFixed(0)}K`
  return `$${n.toFixed(0)}`
}

export function countdown(now = new Date()) {
  const ms = Math.max(0, ELECTION_DAY - now)
  const d = Math.floor(ms / 864e5)
  const h = Math.floor((ms % 864e5) / 36e5)
  const m = Math.floor((ms % 36e5) / 6e4)
  const s = Math.floor((ms % 6e4) / 1e3)
  return { d, h, m, s, done: ms === 0 }
}

export const pad = (n, w = 2) => String(n).padStart(w, '0')

export function timeAgo(iso) {
  if (!iso) return '—'
  const s = Math.round((Date.now() - new Date(iso)) / 1000)
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.round(s / 60)}m ago`
  if (s < 86400) return `${Math.round(s / 3600)}h ago`
  return `${Math.round(s / 86400)}d ago`
}

export function hash(str = '') {
  let h = 2166136261
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619)
  return h >>> 0
}

export const wikiUrl = (title) => `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`

export const districtLabel = (st, d) => (d === 'AL' ? `${st}-AL` : `${st}-${String(d).padStart(2, '0')}`)

// Seat-count projection from consensus scores.
export function tally(races) {
  const t = { D: 0, R: 0, toss: 0, leanD: 0, leanR: 0 }
  for (const r of races) {
    const s = r.consensus?.score
    if (s == null) continue
    if (Math.abs(s) < 0.35) t.toss++
    else if (s < 0) { t.D++; if (s > -1.5) t.leanD++ }
    else { t.R++; if (s < 1.5) t.leanR++ }
  }
  return t
}

// ---------- election night ----------

export const POLLS_CLOSE = new Date('2026-11-03T19:00:00-05:00') // first closings (ET)
const NIGHT_END = new Date('2026-11-07T00:00:00-05:00')
export const isElectionWindow = (now = new Date()) => now >= ELECTION_DAY && now < NIGHT_END

export const RESULT_COLORS = { D: '#2456e6', R: '#b8141f', I: '#9b30ff' }
export const AWAITING = '#2b3240'
export const resultColor = (result) => (result ? RESULT_COLORS[result.party] || RESULT_COLORS.I : AWAITING)

// Called-seat tally for results mode.
export function tallyResults(races) {
  const t = { D: 0, R: 0, I: 0, uncalled: 0, flipD: 0, flipR: 0 }
  for (const r of races) {
    const w = r.result
    if (!w) { t.uncalled++; continue }
    const p = w.party === 'D' || w.party === 'R' ? w.party : 'I'
    t[p]++
    if (w.flip && p === 'D') t.flipD++
    if (w.flip && p === 'R') t.flipR++
  }
  return t
}

// "None (new seat)" / "Vacant" are seat states, not names.
export const incLabel = (inc) => inc?.name || (inc?.vacancy === 'new' ? 'OPEN SEAT (NEW)' : inc?.vacancy === 'vacant' ? 'VACANT' : '—')

// 2024 presidential county margin (D% − R%) on the same diverging scale as ratings.
export function marginColor(dem, gop) {
  const m = dem - gop
  const a = Math.abs(m)
  const side = m > 0 ? 'D' : 'R'
  if (a < 1) return RATING_COLORS.Tossup
  if (a < 5) return RATING_COLORS[`Tilt ${side}`]
  if (a < 10) return RATING_COLORS[`Lean ${side}`]
  if (a < 20) return RATING_COLORS[`Likely ${side}`]
  return RATING_COLORS[`Safe ${side}`]
}
export const fmtMargin = (dem, gop) => {
  const m = dem - gop
  return Math.abs(m) < 0.05 ? 'EVEN' : `${m > 0 ? 'D' : 'R'}+${Math.abs(m).toFixed(1)}`
}

// Human name for a race, for search, logs and notifications.
export const raceTitle = (r, states) => (r.type === 'house'
  ? districtLabel(r.state, r.district)
  : `${states[r.state]} ${r.type === 'senate' ? `Senate${r.special ? ' (special)' : ''}` : 'Governor'}`)

// Election-night call safety. Anyone can edit Wikipedia, so a winner mark that shows up
// mid-session is held for CONFIRM_MS before HQ treats it as a call: a vandal edit or a
// premature call is normally reverted within a minute or two and never reaches the board.
// HQ result overrides (control.json) are trusted and skip the hold.
export const CONFIRM_MS = 90 * 1000

const callKey = (w) => `${w.party}|${w.winner}`

// seen: Map raceId -> { key, at } (first time this exact winner was seen).
// first: true on the first live load, when calls already on Wikipedia are accepted as-is.
// Returns the dataset with unconfirmed calls removed, plus the races still being confirmed.
export function holdCalls(data, seen, now = Date.now(), first = false) {
  const pending = []
  const hold = (r) => {
    if (!r.result) { seen.delete(r.id); return r }
    const key = callKey(r.result)
    const s = seen.get(r.id)
    if (!s || s.key !== key) seen.set(r.id, { key, at: first ? -Infinity : now })
    const at = seen.get(r.id).at
    if (now - at >= CONFIRM_MS) return r
    pending.push({ race: r, result: r.result, at })
    return { ...r, result: null, candidates: r.candidates.map((c) => (c.won ? { ...c, won: false } : c)) }
  }
  const map = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Array.isArray(v) ? v.map(hold) : hold(v)]))
  return { data: { ...data, senate: map(data.senate), governor: map(data.governor), house: map(data.house) }, pending }
}

// Which party has clinched each chamber from called seats (null until someone has).
export function controlCalls({ sen, house }) {
  return {
    senate: sen.d >= 51 ? 'D' : sen.r >= 50 ? 'R' : null, // a 50-50 Senate goes to the VP (R)
    house: house.d >= 218 ? 'D' : house.r >= 218 ? 'R' : null,
  }
}

export const PARTY_NAME = { D: 'DEMOCRATS', R: 'REPUBLICANS', I: 'INDEPENDENT' }

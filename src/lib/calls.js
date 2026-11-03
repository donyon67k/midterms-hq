// Race calls come only from the decision desks (via the HQ call scout) and from HQ itself,
// never from Wikipedia's winner marks, which anyone can edit. This clears Wikipedia's.
export function stripCalls(data) {
  const strip = (r) => (r.result || r.candidates.some((c) => c.won)
    ? { ...r, result: null, candidates: r.candidates.map((c) => (c.won ? { ...c, won: false } : c)) }
    : r)
  const map = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Array.isArray(v) ? v.map(strip) : strip(v)]))
  return { ...data, senate: map(data.senate), governor: map(data.governor), house: map(data.house) }
}

// Which party has clinched each chamber from called seats (null until someone has).
export function controlCalls({ sen, house }) {
  return {
    senate: sen.d >= 51 ? 'D' : sen.r >= 50 ? 'R' : null, // a 50-50 Senate goes to the VP (R)
    house: house.d >= 218 ? 'D' : house.r >= 218 ? 'R' : null,
  }
}

export const PARTY_NAME = { D: 'DEMOCRATS', R: 'REPUBLICANS', I: 'INDEPENDENT' }

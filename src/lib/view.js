import { STATES } from '../data/wiki.js'
import { housePage } from '../data/live.js'

// Everything the dossier and the zoomed map both need to agree on for one state:
// which tabs exist, which is active, and which terrain layer the map shows.
// `view` is { tab, district, layer } chosen by the user (any of them may be null).
export function resolveView(abbr, data, mode, view = {}) {
  const stateName = STATES[abbr]
  const senate = Object.values(data.senate).filter((r) => r.state === abbr)
  const gov = data.governor[abbr]
  const list = data.house[abbr] || []
  const house = list
    .map((r) => ({ ...r, page: housePage(stateName, list.length === 1) }))
    .sort((a, b) => Math.abs(a.consensus?.score ?? 3) - Math.abs(b.consensus?.score ?? 3) || (+a.district || 0) - (+b.district || 0))
  const measures = data.measures[abbr] || []

  const tabs = [
    ...senate.map((r) => ({ key: r.id, label: r.special ? 'SENATE·SP' : 'SENATE', icon: 'senate' })),
    ...(gov ? [{ key: gov.id, label: 'GOVERNOR', icon: 'governor' }] : []),
    ...(house.length ? [{ key: 'house', label: `HOUSE (${house.length})`, icon: 'house' }] : []),
    ...(measures.length ? [{ key: 'measures', label: `MEASURES (${measures.length})`, icon: 'measures' }] : []),
  ]
  const preferred = mode === 'senate' ? senate[0]?.id : mode === 'governor' ? gov?.id : mode
  const active = tabs.find((t) => t.key === view.tab) ? view.tab : tabs.find((t) => t.key === preferred)?.key || tabs[0]?.key
  const race = senate.find((r) => r.id === active) || (gov?.id === active ? gov : null)
  const district = active === 'house' ? view.district || null : null
  const layer = view.layer || (active === 'house' ? 'districts' : 'counties')

  return { stateName, senate, gov, house, measures, tabs, active, race, district, layer }
}

import { STATES } from '../data/wiki.js'
import { REGION_BY_KEY } from '../lib/regions.js'
import { ratingClass, raceTitle, resultColor, tally, tallyResults } from '../lib/util.js'
import Block from './Block.jsx'

// Side panel for a regional zoom: every Senate/governor race in the area plus
// the competitive House seats, so a cluster of small states reads at a glance.
export default function RegionBrief({ region, data, onPick, onPickState, onClose, results, watch }) {
  const r = REGION_BY_KEY[region]
  const states = r.states
  const sen = states.flatMap((st) => Object.values(data.senate).filter((x) => x.state === st))
  const gov = states.map((st) => data.governor[st]).filter(Boolean)
  const house = states.flatMap((st) => data.house[st] || [])
  const close = (x) => x.consensus && Math.abs(x.consensus.score) < 1
  const houseKey = house.filter((x) => close(x) || x.result?.flip || watch.ids.includes(x.id))
    .sort((a, b) => Math.abs(a.consensus?.score ?? 9) - Math.abs(b.consensus?.score ?? 9))

  const count = (races) => {
    if (results) {
      const t = tallyResults(races)
      return `D ${t.D} · R ${t.R}${t.I ? ` · I ${t.I}` : ''}${t.uncalled ? ` · ${t.uncalled} uncalled` : ''}`
    }
    const t = tally(races)
    return `D ${t.D} · R ${t.R}${t.toss ? ` · ${t.toss} tossup` : ''}`
  }

  const Row = ({ x }) => (
    <button type="button" className="watch" onClick={() => onPick(x)}>
      <span>{watch.ids.includes(x.id) ? '★ ' : ''}{raceTitle(x, STATES)}</span>
      {results && x.result
        ? <span className="result-chip" style={{ background: resultColor(x.result) }}>{x.result.party} {x.result.flip ? 'GAIN' : 'HOLD'}</span>
        : <span className={ratingClass(x.consensus?.label)}>{results ? 'AWAITING' : x.consensus?.label || '—'}</span>}
    </button>
  )

  return (
    <aside className="dossier overview" aria-label={`${r.label} region`}>
      <div className="dossier-head">
        <div>
          <div className="stamp">REGIONAL SECTOR // {states.length} STATES</div>
          <h2 className="pixel glow">{r.label}</h2>
          <div className="dossier-meta">{states.map((st) => STATES[st]).join(' · ')}</div>
        </div>
        <button type="button" className="btn-close" onClick={onClose} aria-label="Back to the whole map">✕</button>
      </div>
      <div className="dossier-body">
        <div className="wave-states" style={{ marginBottom: 12 }}>
          {states.map((st) => (
            <button key={st} type="button" className="wave-st hot" onClick={() => onPickState(st)} title={`Open ${STATES[st]}`}>{st}</button>
          ))}
        </div>

        <Block title={<>▣ SENATE ({sen.length}) <span className="dim">{sen.length ? count(sen) : 'no races here'}</span></>}>
          <div className="watchlist">{sen.map((x) => <Row key={x.id} x={x} />)}</div>
        </Block>

        <Block title={<>▣ GOVERNOR ({gov.length}) <span className="dim">{gov.length ? count(gov) : 'no races here'}</span></>}>
          <div className="watchlist">{gov.map((x) => <Row key={x.id} x={x} />)}</div>
        </Block>

        <Block title={<>▣ HOUSE ({house.length} SEATS) <span className="dim">{count(house)}</span></>}>
          {houseKey.length
            ? <div className="watchlist">{houseKey.map((x) => <Row key={x.id} x={x} />)}</div>
            : <div className="dim">No competitive House seats in this region.</div>}
        </Block>
      </div>
    </aside>
  )
}

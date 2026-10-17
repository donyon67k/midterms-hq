import { districtLabel, incLabel, partyColor, ratingClass, ratingColor, resultColor, tally, tallyResults, wikiUrl } from '../lib/util.js'
import { resolveView } from '../lib/view.js'
import { Icon } from './Sprites.jsx'
import RaceView from './RaceView.jsx'

export default function Dossier({ abbr, data, mode, view, setView, onClose, results, watch }) {
  const { stateName, senate, gov, house, measures, tabs, active, race, district } = resolveView(abbr, data, mode, view)
  const setDistrict = (key) => setView((v) => ({ ...v, tab: 'house', district: key }))
  const ht = tally(house)
  const hr = tallyResults(house)
  const delegation = house.reduce((a, r) => { const p = r.incumbent?.party || (r.incumbent?.vacancy ? 'OPEN' : '—'); a[p] = (a[p] || 0) + 1; return a }, {})

  return (
    <aside className="dossier" aria-label={`${stateName} dossier`}>
      <div className="dossier-head">
        <div>
          <div className="stamp">TOP SECRET // EYES ONLY</div>
          <h2 className="pixel glow">{stateName.toUpperCase()}</h2>
          <div className="dossier-meta">
            FILE #{abbr}-2026 · {senate.length} SEN · {gov ? 1 : 0} GOV · {house.length} HOUSE · {measures.length} MEASURES
          </div>
        </div>
        <button type="button" className="btn-close" onClick={onClose} aria-label="Close dossier">✕</button>
      </div>

      <div className="tabs" role="tablist">
        {tabs.map((t) => (
          <button key={t.key} role="tab" aria-selected={active === t.key} className={`tab ${active === t.key ? 'on' : ''}`} onClick={() => setView({ tab: t.key })}>
            <Icon name={t.icon} size={14} color={active === t.key ? '#050510' : '#00ff41'} /> {t.label}
          </button>
        ))}
      </div>

      <div className="dossier-body" key={`${abbr}-${active}-${district}`}>
        {!tabs.length && <div className="dim">No federal or gubernatorial operations in this state for 2026.</div>}
        {race && <RaceView race={race} stateName={stateName} results={results} watch={watch} />}

        {active === 'house' && !district && (
          <div>
            <div className="house-summary">
              <div>CURRENT DELEGATION: {Object.entries(delegation).map(([p, n]) => <span key={p} style={{ color: partyColor(p) }}> {p} {n} </span>)}</div>
              {results
                ? <div>CALLED: <span className="party-d">D {hr.D}</span> · <span className="party-r">R {hr.R}</span> · <span className="dim">{hr.uncalled} UNCALLED</span>{hr.flipD + hr.flipR > 0 && <> · ⚑ FLIPS D+{hr.flipD} R+{hr.flipR}</>}</div>
                : <div>PROJECTED: <span className="party-d">D {ht.D}</span> · <span style={{ color: 'var(--tossup)' }}>TOSS {ht.toss}</span> · <span className="party-r">R {ht.R}</span></div>}
            </div>
            <div className="district-list">
              {house.map((r) => (
                <button key={r.key} type="button" className="district" onClick={() => setDistrict(r.key)}>
                  <span className="d-swatch" style={{ background: results ? resultColor(r.result) : ratingColor(r.consensus?.label) }} />
                  <span className="d-name">{watch.ids.includes(r.id) ? '★' : ''}{districtLabel(r.state, r.district)}</span>
                  <span className={`d-inc ${r.incumbent?.vacancy ? 'open-seat' : ''}`} style={{ color: r.incumbent?.vacancy ? undefined : partyColor(r.incumbent?.party) }}>{incLabel(r.incumbent)}</span>
                  <span className="d-cands">{r.candidates.filter((c) => c.party === 'D' || c.party === 'R').map((c) => c.name.split(' ').pop()).join(' v ')}</span>
                  {results && r.result
                    ? <span className="result-chip" style={{ background: resultColor(r.result) }}>{r.result.party} {r.result.flip ? 'GAIN' : 'HOLD'}</span>
                    : <span className={ratingClass(r.consensus?.label)}>{r.consensus?.label || '—'}</span>}
                </button>
              ))}
            </div>
          </div>
        )}
        {active === 'house' && district && (
          <>
            <button type="button" className="btn-mini back" onClick={() => setDistrict(null)}>◀ ALL DISTRICTS</button>
            <RaceView race={house.find((r) => r.key === district)} stateName={stateName} results={results} watch={watch} />
          </>
        )}

        {active === 'measures' && (
          <div className="measures">
            {measures.map((m, i) => (
              <div key={i} className={`measure ${/approved/i.test(m.status) ? 'passed' : /defeated|rejected|failed/i.test(m.status) ? 'failed' : ''}`}>
                <div className="measure-head">
                  <span className="measure-status">{m.status.toUpperCase()}</span>
                  <span className="dim">{m.origin} · {m.date}</span>
                </div>
                <div className="measure-title">
                  {m.link ? <a href={wikiUrl(m.link)} target="_blank" rel="noreferrer">{m.title}</a> : m.title}
                </div>
                <p>{m.description}</p>
                {m.yes && <div className="measure-res">YES {m.yes} · NO {m.no}</div>}
              </div>
            ))}
          </div>
        )}
      </div>
    </aside>
  )
}

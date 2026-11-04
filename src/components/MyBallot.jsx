import { useState } from 'react'
import { STATES } from '../data/wiki.js'
import { districtLabel, pollCloseFor, raceTitle, ratingClass, resultColor } from '../lib/util.js'
import { IS_DESKTOP, enableWebAlerts, webAlerts } from '../lib/desktop.js'

// My ballot: pick your state (and district) once; see everything on your ballot in one place,
// star it all for alerts. Remembered on this device.
const KEY = 'mhq:ballot'
const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {} } catch { return {} } }

export default function MyBallot({ data, onPick, watch }) {
  const [me, setMeRaw] = useState(load)
  const [alerts, setAlerts] = useState(() => IS_DESKTOP || webAlerts())
  const setMe = (v) => { setMeRaw(v); try { localStorage.setItem(KEY, JSON.stringify(v)) } catch { /* private mode */ } }
  const st = me.state
  const house = st ? data.house[st] || [] : []
  const races = st ? [
    ...Object.values(data.senate).filter((r) => r.state === st),
    data.governor[st],
    house.length === 1 ? house[0] : house.find((r) => String(r.district) === String(me.district)),
  ].filter(Boolean) : []
  const measures = (st && data.measures[st]?.filter((m) => m.date === 'Nov 3')) || []
  const allStarred = races.length > 0 && races.every((r) => watch.ids.includes(r.id))
  const official = races.find((r) => r.officialResults)?.officialResults

  return (
    <div className="ballot">
      <div className="ballot-pick">
        <label>
          <span className="pixel">STATE</span>
          <select value={st || ''} onChange={(e) => setMe({ state: e.target.value || undefined })}>
            <option value="">Choose…</option>
            {Object.entries(STATES).sort((a, b) => a[1].localeCompare(b[1])).map(([k, n]) => <option key={k} value={k}>{n}</option>)}
          </select>
        </label>
        {house.length > 1 && (
          <label>
            <span className="pixel">DISTRICT</span>
            <select value={me.district || ''} onChange={(e) => setMe({ ...me, district: e.target.value || undefined })}>
              <option value="">Choose…</option>
              {house.map((r) => <option key={r.id} value={r.district}>{districtLabel(st, r.district)}{r.incumbent?.name ? ` · ${r.incumbent.name}` : ''}</option>)}
            </select>
          </label>
        )}
      </div>
      {house.length > 1 && !me.district && st && (
        <div className="dim">Don&apos;t know your district? <a href="https://www.house.gov/representatives/find-your-representative" target="_blank" rel="noreferrer">Find it on house.gov ↗</a></div>
      )}

      {st && (
        <>
          <div className="dim ballot-meta">
            Last polls close {pollCloseFor(st)?.label || '—'}
            {official && <> · <a href={official} target="_blank" rel="noreferrer">OFFICIAL {st} RESULTS ↗</a></>}
          </div>
          <div className="sim-list">
            {races.map((r) => (
              <button key={r.id} type="button" className="watch" onClick={() => onPick(r)}>
                <span>{watch.ids.includes(r.id) ? '★ ' : ''}{raceTitle(r, STATES)}</span>
                {r.result
                  ? <span className="result-chip" style={{ background: resultColor(r.result) }}>{r.result.winner.split(' ').pop()} ({r.result.party}) WINS</span>
                  : <span className={ratingClass(r.consensus?.label)}>{r.consensus?.label || 'AWAITING'}</span>}
              </button>
            ))}
          </div>
          {measures.length > 0 && (
            <>
              <h5 className="pixel picks-h">BALLOT MEASURES ({measures.length})</h5>
              <div className="sim-list">
                {measures.map((m) => (
                  <div key={m.title} className="sim-row">
                    <span className="sim-name static">{m.title}</span>
                    <span className="measure-status">{m.status.toUpperCase()}</span>
                  </div>
                ))}
              </div>
            </>
          )}
          <div className="sim-actions">
            <button type="button" className="btn-mini" disabled={!races.length} onClick={() => races.forEach((r) => (allStarred ? watch.ids.includes(r.id) : !watch.ids.includes(r.id)) && watch.toggle(r.id))}>
              {allStarred ? '★ STARRED · UNSTAR ALL' : '☆ STAR MY RACES'}
            </button>
            {!IS_DESKTOP && (
              <button type="button" className="btn-mini" disabled={alerts} onClick={async () => setAlerts(await enableWebAlerts())}>
                {alerts ? '🔔 ALERTS ON' : '🔔 ALERT ME WHEN THEY’RE CALLED'}
              </button>
            )}
          </div>
          <div className="dim">
            Starred races alert you when they&apos;re called{IS_DESKTOP ? '.' : ' while this site is open in a tab (the desktop app alerts even in the background).'}
          </div>
        </>
      )}
    </div>
  )
}

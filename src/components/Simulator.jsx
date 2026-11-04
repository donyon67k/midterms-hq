import { useMemo, useState } from 'react'
import { STATES } from '../data/wiki.js'
import { raceTitle, ratingClass, tallyResults } from '../lib/util.js'
import { PowerBar, SENATE_NOW, chamber } from './Overview.jsx'

// Path to majority: the called seats are fixed; click each uncalled race to hand it to a party
// and watch the chamber add up. Also counts how many of the remaining seats each side needs.
const NEED = { senate: { D: 51, R: 50 }, house: { D: 218, R: 218 } } // 50-50 Senate: VP (R) breaks ties

// Who's ahead right now: the live count if there is one, else the forecast lean.
export function likelyParty(r) {
  const c = r.count?.cands?.filter((x) => x.pct != null && (x.party === 'D' || x.party === 'R')).sort((a, b) => b.pct - a.pct)
  if (c?.length) return c[0].party
  const s = r.consensus?.score
  return s == null || Math.abs(s) < 0.35 ? undefined : s < 0 ? 'D' : 'R'
}

// Ways out of n uncalled seats to win at least k (as a share of all 2^n splits).
function share(n, k) {
  if (k <= 0) return 1
  if (k > n) return 0
  let c = 1
  let sum = 0
  for (let i = 0; i <= n; i++) { if (i >= k) sum += c; c = (c * (n - i)) / (i + 1) }
  return sum / 2 ** n
}

export default function Simulator({ data, onPick }) {
  const [which, setWhich] = useState('senate')
  const [sim, setSim] = useState({})
  const races = which === 'senate' ? Object.values(data.senate) : Object.values(data.house).flat()
  const base = useMemo(() => {
    if (which === 'senate') { const c = chamber(races, SENATE_NOW, true); return { d: c.d, r: c.r } }
    const t = tallyResults(races)
    return { d: t.D + t.I, r: t.R }
  }, [which, races])
  const open = races.filter((r) => !r.result).sort((a, b) => Math.abs(a.consensus?.score ?? 0) - Math.abs(b.consensus?.score ?? 0))
  const pick = (r) => sim[r.id]
  const d = base.d + open.filter((r) => pick(r) === 'D').length
  const rr = base.r + open.filter((r) => pick(r) === 'R').length
  const left = open.length - open.filter((r) => pick(r)).length
  const need = NEED[which]
  const total = which === 'senate' ? 100 : 435
  const dNeed = Math.max(0, need.D - d)
  const rNeed = Math.max(0, need.R - rr)
  const winner = d >= need.D ? 'D' : rr >= need.R ? 'R' : null

  const setAll = (fn) => setSim(Object.fromEntries(open.map((r) => [r.id, fn(r)]).filter(([, p]) => p)))
  const switchTo = (w) => { setWhich(w); setSim({}) }

  return (
    <div className="sim">
      <div className="sm-toggle" role="group" aria-label="Chamber">
        {['senate', 'house'].map((w) => <button key={w} type="button" className={which === w ? 'on' : ''} aria-pressed={which === w} onClick={() => switchTo(w)}>{w.toUpperCase()}</button>)}
      </div>
      <PowerBar label={which === 'senate' ? 'SENATE · YOUR MAP' : 'HOUSE · YOUR MAP'} icon={which} total={total} d={d} r={rr} toss={total - d - rr} middle="UNDECIDED"
        control={which === 'senate' ? 'D NEEDS 51 · R NEEDS 50' : '218 FOR CONTROL'} />
      <div className={`sim-verdict pixel ${winner ? `win-${winner}` : ''}`}>
        {winner
          ? `${winner === 'D' ? 'DEMOCRATS' : 'REPUBLICANS'} WIN THE ${which.toUpperCase()} ON THIS MAP`
          : `D NEEDS ${dNeed} MORE · R NEEDS ${rNeed} MORE · ${left} UNDECIDED`}
      </div>
      {!winner && left > 0 && (
        <div className="dim sim-odds">
          If every undecided seat were a coin flip: D reaches {need.D} in {Math.round(share(left, dNeed) * 100)}% of splits, R reaches {need.R} in {Math.round(share(left, rNeed) * 100)}%.
        </div>
      )}
      <div className="sim-actions">
        <button type="button" className="btn-mini" onClick={() => setAll(likelyParty)} title="Give each seat to whoever leads the count (or the forecast if no votes yet)">FILL BY CURRENT LEADER</button>
        <button type="button" className="btn-mini" onClick={() => setAll(() => 'D')}>ALL D</button>
        <button type="button" className="btn-mini" onClick={() => setAll(() => 'R')}>ALL R</button>
        <button type="button" className="btn-mini" onClick={() => setSim({})}>RESET</button>
      </div>
      <div className="dim" style={{ margin: '6px 0' }}>{open.length} uncalled {which === 'senate' ? 'Senate races' : 'House seats'}, closest first. Click a party to hand it the seat; called seats are locked in.</div>
      <div className="sim-list">
        {open.map((r) => (
          <div key={r.id} className="sim-row">
            <button type="button" className="sim-name" onClick={() => onPick(r)} title="Open the race file">{raceTitle(r, STATES)}</button>
            <span className={ratingClass(r.consensus?.label)}>{r.consensus?.label || '—'}</span>
            <span className="sim-pick" role="group" aria-label={`Winner of ${raceTitle(r, STATES)}`}>
              {['D', 'R'].map((p) => (
                <button key={p} type="button" className={`sp-${p} ${pick(r) === p ? 'on' : ''}`} aria-pressed={pick(r) === p} onClick={() => setSim((s) => ({ ...s, [r.id]: s[r.id] === p ? undefined : p }))}>{p}</button>
              ))}
            </span>
          </div>
        ))}
        {!open.length && <div className="dim">Every seat is called.</div>}
      </div>
    </div>
  )
}

import { STATES } from '../data/wiki.js'
import { raceTitle, ratingClass, resultColor } from '../lib/util.js'
import Block from './Block.jsx'

// After-the-call analysis: where results beat the forecasts and the partisan lean, plus short
// explainers on how election night works.
const pvi = (s = '') => { const m = /^([DR])\+(\d+(?:\.\d+)?)/.exec(s); return m ? (m[1] === 'D' ? 1 : -1) * +m[2] : /even/i.test(s) ? 0 : null }

// D-minus-R margin in points from the live count, only for called races that are nearly fully
// counted (early counts are lopsided: mail ballots and Election Day votes come in at different times).
export function countMargin(r, minIn = 95) {
  const c = r.count
  if (!r.result || !c || c.pctIn == null || c.pctIn < minIn) return null
  const d = c.cands.find((x) => x.party === 'D')?.pct
  const rr = c.cands.find((x) => x.party === 'R')?.pct
  return d != null && rr != null ? d - rr : null
}

// Swing vs the seat's lean: PVI says how much bluer/redder than the nation a seat votes (in
// two-party share), so a neutral year would give a margin of about 2 × PVI.
export function swingRows(races) {
  return races.map((r) => {
    const m = countMargin(r)
    const p = pvi(r.pvi)
    return m == null || p == null ? null : { r, margin: m, expected: 2 * p, swing: m - 2 * p }
  }).filter(Boolean)
}

const fmt = (m) => (Math.abs(m) < 0.05 ? 'EVEN' : `${m > 0 ? 'D' : 'R'}+${Math.abs(m).toFixed(1)}`)

const LESSONS = [
  ['How does a race get called?', 'Decision desks (AP, NBC News and others) project a winner when their models show the trailing candidate can no longer catch up with the votes left to count. They use the votes counted so far, where the uncounted ballots are, and surveys of voters. A call is a projection, not the official result; states certify weeks later.'],
  ['Why do leads change during the night?', 'States count different kinds of ballots at different times. In some, mail ballots (often more Democratic lately) are counted first; in others they come last, after Election Day in-person votes (often more Republican). Early leads that flip later are sometimes called a "red mirage" or "blue shift." Watch the % of expected vote counted, not just who leads.'],
  ['What does "flip" or "gain" mean?', 'A seat flips when a different party wins it than the party that held it going in. Control of a chamber changes hands only if one side gains enough flips: 51 Senate seats (or 50 plus the Vice President) and 218 House seats.'],
  ['What is PVI?', 'The Cook Partisan Voting Index compares how a state or district voted in the last two presidential elections with the nation as a whole. R+5 means about 5 points more Republican than the country. HQ uses it to measure swing: how much better or worse each party did than a seat\'s usual lean.'],
  ['Why do some races take days?', 'Close races may wait for mail ballots that arrive after Election Day (allowed in some states), provisional ballots, overseas ballots, and in some places automatic recounts when the margin is very small. Ranked-choice states such as Alaska and Maine run extra rounds when nobody gets a majority.'],
]

export default function Analysis({ data, onPick }) {
  const all = [...Object.values(data.senate), ...Object.values(data.governor), ...Object.values(data.house).flat()]
  const upsets = all.filter((r) => {
    const s = r.consensus?.score
    if (!r.result || s == null || Math.abs(s) < 0.35) return false
    return (s < 0 ? 'D' : 'R') !== r.result.party
  })
  const rows = swingRows(all)
  const avg = rows.length ? rows.reduce((t, x) => t + x.swing, 0) / rows.length : null
  const top = [...rows].sort((a, b) => Math.abs(b.swing) - Math.abs(a.swing)).slice(0, 12)

  return (
    <div className="analysis">
      <Block title="▣ THE NATIONAL SWING">
        {avg == null
          ? <div className="dim">Fills in as called races reach 95% of the expected vote counted.</div>
          : (
            <>
              <div className="pixel swing-big" style={{ color: avg > 0 ? 'var(--dem)' : 'var(--rep)' }}>{fmt(avg)}</div>
              <div className="dim">
                {rows.length < 30 ? 'PRELIMINARY · ' : ''}Average result vs each seat&apos;s partisan lean across {rows.length} called races with 95%+ counted. A positive D number means Democrats ran ahead of their usual lean. It settles as more races finish counting.
              </div>
            </>
          )}
      </Block>

      {top.length > 0 && (
        <Block title="▣ BIGGEST SWINGS VS PARTISAN LEAN">
          <div className="sim-list">
            {top.map(({ r, margin, expected, swing }) => (
              <button key={r.id} type="button" className="watch" onClick={() => onPick(r)} title={`Result ${fmt(margin)} vs usual lean ${fmt(expected)}`}>
                <span>{raceTitle(r, STATES)} <span className="dim">· result {fmt(margin)} · lean {fmt(expected)}</span></span>
                <span className="pixel" style={{ color: swing > 0 ? 'var(--dem)' : 'var(--rep)' }}>{swing > 0 ? 'D' : 'R'} SWING {Math.abs(swing).toFixed(1)}</span>
              </button>
            ))}
          </div>
        </Block>
      )}

      <Block title={<>▣ UPSETS · WINNER BEAT THE FORECAST ({upsets.length})</>}>
        {upsets.length
          ? <div className="sim-list">{upsets.map((r) => (
            <button key={r.id} type="button" className="watch" onClick={() => onPick(r)}>
              <span>{raceTitle(r, STATES)} <span className={ratingClass(r.consensus.label)}>{r.consensus.label}</span></span>
              <span className="result-chip" style={{ background: resultColor(r.result) }}>{r.result.party} WON</span>
            </button>
          ))}</div>
          : <div className="dim">No called race has gone against the forecasters&apos; lean yet.</div>}
      </Block>

      <Block title="▣ LEARN: HOW ELECTION NIGHT WORKS" closed>
        {LESSONS.map(([q, a]) => (
          <details key={q} className="explain lesson">
            <summary>{q.toUpperCase()}</summary>
            <p>{a}</p>
          </details>
        ))}
      </Block>
    </div>
  )
}

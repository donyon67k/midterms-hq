import { STATES } from '../data/wiki.js'
import { genericAverage, ratingClass, raceTitle, resultColor, tally, tallyResults, timeAgo } from '../lib/util.js'
import { useState } from 'react'
import { Icon } from './Sprites.jsx'
import { SeatChart, SeatLegend } from './SeatChart.jsx'

// Seats held by each caucus before the election (Senate caucus counts independents with Dems).
export const SENATE_NOW = { D: 47, R: 53 }
export const GOV_NOW = { D: 24, R: 26 }

export function PowerBar({ label, icon, d, r, toss, total, control, leanD = 0, leanR = 0, middle = 'TOSSUP' }) {
  const pct = (n) => `${(n / total) * 100}%`
  return (
    <div className="power">
      <div className="power-head">
        <Icon name={icon} size={16} /> <span className="pixel">{label}</span>
        <span className="dim">{control || `${total} SEATS`}</span>
      </div>
      <div className="power-bar" role="img" aria-label={`${label}: Democrats ${d}, ${middle.toLowerCase()} ${toss}, Republicans ${r}`}>
        <div className="pb-d" style={{ width: pct(d - leanD) }} />
        <div className="pb-d lean" style={{ width: pct(leanD) }} />
        <div className={middle === 'TOSSUP' ? 'pb-t' : 'pb-u'} style={{ width: pct(toss) }} />
        <div className="pb-r lean" style={{ width: pct(leanR) }} />
        <div className="pb-r" style={{ width: pct(r - leanR) }} />
        <div className="pb-mid" style={{ left: '50%' }} />
      </div>
      <div className="power-nums">
        <span className="party-d pixel">D {d}</span>
        <span className="pixel" style={{ color: middle === 'TOSSUP' ? 'var(--tossup)' : 'var(--text-dim)' }}>{toss} {middle}</span>
        <span className="party-r pixel">R {r}</span>
      </div>
    </div>
  )
}

// Seats not up this cycle + projected/called seats among those that are.
export function chamber(races, now, results) {
  const upR = races.filter((r) => r.incumbent.party === 'R').length
  const upD = races.length - upR
  if (results) {
    const t = tallyResults(races)
    return { d: now.D - upD + t.D + t.I, r: now.R - upR + t.R, toss: t.uncalled, flipD: t.flipD, flipR: t.flipR }
  }
  const t = tally(races)
  return { d: now.D - upD + t.D, r: now.R - upR + t.R, toss: t.toss, leanD: t.leanD, leanR: t.leanR }
}

export default function Overview({ data, onPick, log, results, watch, featured = [] }) {
  const senRaces = Object.values(data.senate)
  const govRaces = Object.values(data.governor)
  const houseRaces = Object.values(data.house).flat()
  const allRaces = [...senRaces, ...govRaces, ...houseRaces]

  const sen = chamber(senRaces, SENATE_NOW, results)
  const gov = chamber(govRaces, GOV_NOW, results)
  const house = results
    ? (() => { const t = tallyResults(houseRaces); return { d: t.D, r: t.R, toss: t.uncalled + t.I, flipD: t.flipD, flipR: t.flipR } })()
    : (() => { const t = tally(houseRaces); return { d: t.D, r: t.R, toss: t.toss, leanD: t.leanD, leanR: t.leanR } })()
  const middle = results ? 'UNCALLED' : 'TOSSUP'

  // Balance of power as bars or as a seat-by-seat dot chart (remembered per viewer).
  const [dots, setDotsRaw] = useState(() => { try { return localStorage.getItem('mhq:power') !== 'bars' } catch { return true } })
  const setDots = (v) => { setDotsRaw(v); try { localStorage.setItem('mhq:power', v ? 'dots' : 'bars') } catch { /* ignore */ } }

  const gb = genericAverage(data.genericBallot)
  const gbRows = data.genericBallot.filter((g) => g.source !== 'Average')

  const battle = allRaces
    .filter((r) => r.consensus && Math.abs(r.consensus.score) < 1.0)
    .sort((a, b) => Math.abs(a.consensus.score) - Math.abs(b.consensus.score))
  const watched = allRaces.filter((r) => watch.ids.includes(r.id))
  const picks = featured.map((id) => allRaces.find((r) => r.id === id)).filter(Boolean)
  const flips = results ? allRaces.filter((r) => r.result?.flip) : []

  const RaceRow = ({ r }) => (
    <button type="button" className="watch" onClick={() => onPick(r)}>
      <span>{watch.ids.includes(r.id) ? '★ ' : ''}{raceTitle(r, STATES)}</span>
      {results && r.result
        ? <span className="result-chip" style={{ background: resultColor(r.result) }}>{r.result.party} {r.result.flip ? 'GAIN' : 'HOLD'}</span>
        : <span className={ratingClass(r.consensus?.label)}>{results ? 'AWAITING' : r.consensus?.label || '—'}</span>}
    </button>
  )

  return (
    <aside className="dossier overview" aria-label="Situation room">
      <div className="dossier-head">
        <div>
          <div className="stamp">SITUATION ROOM // NATIONAL</div>
          <h2 className="pixel glow">BALANCE OF POWER</h2>
          <div className="dossier-meta">
            {results ? 'Called races (Wikipedia) · uncalled seats shown in gray' : 'Projected from forecaster consensus'} · press ⌘K to search
          </div>
        </div>
      </div>
      <div className="dossier-body">
        <div className="power-toggle">
          <span className="sm-toggle" role="group" aria-label="Balance of power view">
            <button type="button" className={dots ? 'on' : ''} aria-pressed={dots} onClick={() => setDots(true)}>● DOTS</button>
            <button type="button" className={dots ? '' : 'on'} aria-pressed={!dots} onClick={() => setDots(false)}>▬ BARS</button>
          </span>
        </div>
        {dots ? (
          <>
            <div className="seat-charts">
              <SeatChart label="SENATE" icon="senate" races={senRaces} now={SENATE_NOW} results={results} need="51 FOR CONTROL" onPick={onPick} />
              <SeatChart label="GOVERNORS" icon="governor" races={govRaces} now={GOV_NOW} results={results} need="50 STATES" onPick={onPick} />
            </div>
            <SeatChart wide label="HOUSE" icon="house" races={houseRaces} results={results} need="218 FOR CONTROL" onPick={onPick} />
            <SeatLegend results={results} />
          </>
        ) : (
          <>
            <PowerBar label="SENATE" icon="senate" total={100} control="D NEEDS 51 · R NEEDS 50 (VP TIEBREAK)" middle={middle} {...sen} />
            <PowerBar label="HOUSE" icon="house" total={435} control="218 FOR CONTROL" middle={middle} {...house} />
            <PowerBar label="GOVERNORS" icon="governor" total={50} middle={middle} {...gov} />
          </>
        )}
        {results && (sen.flipD + sen.flipR + house.flipD + house.flipR + gov.flipD + gov.flipR > 0) && (
          <div className="flip-sum">
            ⚑ FLIPS — SEN <span className="party-d">D +{sen.flipD}</span> / <span className="party-r">R +{sen.flipR}</span> ·
            HOUSE <span className="party-d">D +{house.flipD}</span> / <span className="party-r">R +{house.flipR}</span> ·
            GOV <span className="party-d">D +{gov.flipD}</span> / <span className="party-r">R +{gov.flipR}</span>
          </div>
        )}

        {picks.length > 0 && (
          <section className="intel-block">
            <h4 className="pixel">◆ HQ PICKS · RACES TO WATCH</h4>
            <div className="watchlist">{picks.map((r) => <RaceRow key={r.id} r={r} />)}</div>
          </section>
        )}

        <section className="intel-block">
          <h4 className="pixel">★ MY WATCHLIST ({watched.length})</h4>
          {watched.length
            ? <div className="watchlist">{watched.map((r) => <RaceRow key={r.id} r={r} />)}</div>
            : <div className="dim">Star (☆) any race in its file to pin it here. Starred races get desktop alerts for rating shifts and calls.</div>}
        </section>

        {results && flips.length > 0 && (
          <section className="intel-block">
            <h4 className="pixel">▣ SEATS THAT FLIPPED ({flips.length})</h4>
            <div className="watchlist">{flips.map((r) => <RaceRow key={r.id} r={r} />)}</div>
          </section>
        )}

        {gb && !results && (
          <section className="intel-block">
            <h4 className="pixel">▣ GENERIC BALLOT</h4>
            <div className="gb">
              <div className="gb-bar">
                <div className="pb-d" style={{ width: `${gb.D}%` }}><span>D {gb.D}%</span></div>
                <div className="pb-r" style={{ width: `${gb.R}%` }}><span>R {gb.R}%</span></div>
              </div>
              <div className="margin-call">{gb.margin} · average of {gb.n} poll average{gb.n === 1 ? '' : 's'}</div>
            </div>
            <details className="explain">
              <summary>WHAT IS THE GENERIC BALLOT?</summary>
              <p className="brief">
                A national poll question that names no candidates: <i>&ldquo;If the election for Congress were held today, would you vote
                for the Democratic or the Republican candidate in your district?&rdquo;</i> It&apos;s the main read on the national mood in a
                midterm, and matters most for the House, where every seat is up and many voters don&apos;t know their candidates well.
              </p>
              <p className="brief">
                <b>How to read it:</b> the number is one party&apos;s lead nationwide. It isn&apos;t a seat count: district lines mean a
                party can win the national vote narrowly and still lose seats, and a D+8 environment won&apos;t flip a deep-red district.
                Use it as the tide; the race ratings show which boats it can lift.
              </p>
              <p className="brief">
                <b>Where it comes from:</b> each source below averages many individual polls. HQ takes the plain mean of those averages,
                so no single pollster drives the number.
              </p>
            </details>
            {gbRows.length > 0 && (
              <details className="explain">
                <summary>SOURCES ({gbRows.length})</summary>
                <div className="table-scroll">
                  <table>
                    <thead><tr><th>Average</th><th>D</th><th>R</th><th>Margin</th><th>Updated</th></tr></thead>
                    <tbody>
                      {gbRows.map((g) => (
                        <tr key={g.source}>
                          <td>{g.source}</td><td className="party-d">{g.D}%</td><td className="party-r">{g.R}%</td>
                          <td>{g.margin.replace(/^Democrats/, 'D').replace(/^Republicans/, 'R')}</td><td className="dim">{g.updated}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            )}
          </section>
        )}

        <section className="intel-block">
          <h4 className="pixel">▣ BATTLEGROUNDS ({battle.length})</h4>
          <div className="watchlist">
            {battle.slice(0, 60).map((r) => <RaceRow key={r.id} r={r} />)}
          </div>
        </section>

        <section className="intel-block">
          <h4 className="pixel">▣ INTEL LOG</h4>
          <div className="log">
            {log.map((l, i) => (
              <div key={i} className={`log-line ${l.kind || ''}`}>
                <span className="dim">[{new Date(l.t).toLocaleTimeString()}]</span> {l.msg}
              </div>
            ))}
          </div>
          <div className="dim" style={{ marginTop: 6 }}>
            Source revisions: {Object.entries(data.revisions || {}).map(([k, v]) => `${k} ${timeAgo(v.timestamp)}`).join(' · ')}
          </div>
        </section>
      </div>
    </aside>
  )
}

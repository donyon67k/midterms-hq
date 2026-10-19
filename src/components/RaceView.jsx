import { useEffect, useMemo, useState } from 'react'
import { fecRace, raceIntel } from '../data/live.js'
import { districtLabel, fmtMoney, incLabel, partyColor, ratingClass, ratingColor, resultColor, timeAgo, wikiUrl } from '../lib/util.js'
import CandidateCard from './CandidateCard.jsx'
import { NewsBar, RaceNews, useRaceNews } from './News.jsx'

const lastName = (n = '') => n.replace(/\(.*?\)/g, '').replace(/,.*$/, '').trim().split(/\s+/).filter((w) => !/^(jr\.?|sr\.?|ii|iii|iv)$/i.test(w)).pop()?.toLowerCase()

const firstInitial = (n = '') => n.replace(/\(.*?\)/g, '').trim()[0]?.toLowerCase()

// Same last name AND first initial, so two candidates sharing a surname don't cross-wire.
// FEC names are "LAST, FIRST"; race-page tables are "First Last".
function sameCandidate(a = '', b = '') {
  const parse = (n) => (n.includes(',')
    ? { last: n.split(',')[0].trim().toLowerCase(), first: n.split(',')[1]?.trim()[0]?.toLowerCase() }
    : { last: lastName(n), first: firstInitial(n) })
  const x = parse(a)
  const y = parse(b)
  return x.last === y.last && (!x.first || !y.first || x.first === y.first)
}
const primaryParty = (title) => (/democrat/i.test(title) ? 'D' : /republican/i.test(title) ? 'R' : /libertarian/i.test(title) ? 'L' : /green/i.test(title) ? 'G' : 'I')
// Expand only the deciding round of the Democratic and Republican primaries.
const finalMajorRound = (p, all) => ['D', 'R'].includes(primaryParty(p.title))
  && (p.runoff || !all.some((q) => q.runoff && primaryParty(q.title) === primaryParty(p.title)))
const matchBy = (list, cand, key = 'name') => list?.find((x) => sameCandidate(x[key], cand.name))

// Poll end date from strings like "October 9–12, 2026" or "Sep 30 – Oct 2, 2026".
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
function pollDate(s = '') {
  const year = +(s.match(/20\d\d/)?.[0] || 2026)
  const months = [...s.toLowerCase().matchAll(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?/g)]
  const days = s.replace(/20\d\d/g, '').match(/\d{1,2}/g)
  if (!months.length || !days) return null
  return new Date(year, MONTHS.indexOf(months[months.length - 1][1]), +days[days.length - 1])
}

// Tiny trend line per candidate across dated polls (oldest → newest).
function Sparkline({ points, color }) {
  if (points.length < 3) return null
  const xs = points.map((p) => p.t)
  const ys = points.map((p) => p.v)
  const [x0, x1] = [Math.min(...xs), Math.max(...xs)]
  const [y0, y1] = [Math.min(...ys) - 1, Math.max(...ys) + 1]
  const X = (t) => (x1 === x0 ? 0 : ((t - x0) / (x1 - x0)) * 96 + 2)
  const Y = (v) => 18 - ((v - y0) / (y1 - y0)) * 16
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${X(p.t).toFixed(1)},${Y(p.v).toFixed(1)}`).join(' ')
  const last = points[points.length - 1]
  return (
    <svg className="spark" viewBox="0 0 100 20" preserveAspectRatio="none" aria-hidden="true">
      <path d={d} fill="none" stroke={color} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
      <circle cx={X(last.t)} cy={Y(last.v)} r="2" fill={color} />
    </svg>
  )
}

// Fallback field report when Wikipedia has no write-up: plain facts from this race's data.
function dataBrief(race, title) {
  const inc = race.incumbent
  const cons = race.consensus
  const field = race.candidates.filter((c) => c.party === 'D' || c.party === 'R').map((c) => `${c.name} (${c.party})`)
  const lines = [
    inc?.name ? `${title} is held by ${inc.name}${inc.party ? ` (${inc.party})` : ''}.${race.status ? ` Status: ${race.status}.` : ''}` : `${title} is an open seat.${race.status ? ` Status: ${race.status}.` : ''}`,
    race.pvi && `Partisan lean (Cook PVI): ${race.pvi}.`,
    field.length > 0 && `On the ballot: ${field.join(' vs. ')}.`,
    cons && (cons.implied
      ? `No forecaster lists it as competitive; it's rated ${cons.label} from its partisan lean.`
      : `Forecaster consensus: ${cons.label} across ${cons.n} rating${cons.n === 1 ? '' : 's'}${cons.flipVotes ? `, with ${cons.flipVotes} projecting a flip` : ''}.`),
  ]
  return lines.filter(Boolean).join(' ')
}

export default function RaceView({ race, stateName, results, watch }) {
  const [intel, setIntel] = useState(null)
  const [err, setErr] = useState(null)
  const [fec, setFec] = useState(null)
  const [fecErr, setFecErr] = useState(null)

  const isHouse = race.type === 'house'
  const page = race.page

  useEffect(() => {
    let live = true
    setIntel(null); setErr(null); setFec(null); setFecErr(null)
    if (!page) return
    raceIntel(page, isHouse && race.district !== 'AL' ? race.district : null)
      .then((d) => live && setIntel(d))
      .catch((e) => live && setErr(e.message))
    return () => { live = false }
  }, [page, isHouse, race.district])

  const loadFec = () => {
    setFecErr(null)
    fecRace(isHouse ? 'house' : 'senate', race.state, race.district)
      .then(setFec)
      .catch((e) => setFecErr(e.message))
  }

  const title = race.type === 'senate'
    ? `U.S. SENATE${race.special ? ' · SPECIAL' : ''}`
    : race.type === 'governor' ? 'GOVERNOR' : `U.S. HOUSE · ${districtLabel(race.state, race.district)}`

  // Average across aggregators → candidate projection
  const projection = useMemo(() => {
    if (!intel) return null
    if (!intel.aggregates?.length) {
      // No aggregator coverage: average the most recent individual polls.
      const recent = intel.polls.slice(0, 5)
      if (!recent.length) return null
      return intel.pollCandidates.map((n, i) => {
        const xs = recent.map((p) => p.values[i]).filter((x) => x != null)
        const pm = n.match(/\(([A-Z])\)/)
        return { name: n.replace(/\s*\([A-Z]\)\s*$/, ''), party: pm ? pm[1] : null, value: xs.length ? +(xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(1) : null }
      }).filter((x) => x.value != null)
    }
    const avgRow = intel.aggregates.find((a) => a.source === 'Average')
    const rows = intel.aggregates.filter((a) => a.source !== 'Average')
    const vals = avgRow?.values || intel.pollCandidates.map((_, i) => {
      const xs = rows.map((r) => r.values[i]).filter((x) => x != null)
      return xs.length ? +(xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(1) : null
    })
    return intel.pollCandidates.map((n, i) => {
      const pm = n.match(/\(([A-Z])\)/)
      return { name: n.replace(/\s*\([A-Z]\)\s*$/, ''), party: pm ? pm[1] : null, value: vals[i] }
    }).filter((x) => x.value != null)
  }, [intel])

  // Per-candidate poll series for the trend sparklines.
  const trends = useMemo(() => {
    if (!intel?.polls?.length) return {}
    const dated = intel.polls.map((p) => ({ ...p, t: pollDate(p.dates)?.getTime() })).filter((p) => p.t).sort((a, b) => a.t - b.t)
    return Object.fromEntries(intel.pollCandidates.map((n, i) => [
      n.replace(/\s*\([A-Z]\)\s*$/, ''),
      dated.filter((p) => p.values[i] != null).map((p) => ({ t: p.t, v: p.values[i] })),
    ]))
  }, [intel])

  const leaderName = projection?.length ? [...projection].sort((a, b) => b.value - a.value)[0].name : null

  const finance = intel?.fundraising?.candidates?.length
    ? { rows: intel.fundraising.candidates, asOf: intel.fundraising.asOf, src: 'Filings as reported on the race page' }
    : fec?.length ? { rows: fec.filter((r) => r.raised > 0).slice(0, 6), asOf: `FEC through ${fec[0]?.through || '—'}`, src: 'OpenFEC live API' } : null
  const maxRaised = finance ? Math.max(...finance.rows.map((r) => r.raised || 0), 1) : 1

  const sorted = [...race.candidates].sort((a, b) => {
    const rank = (c) => (c.party === 'D' || c.party === 'R' ? 0 : c.link ? 1 : 2)
    return rank(a) - rank(b)
  })
  const majors = sorted.filter((c) => c.party === 'D' || c.party === 'R' || (c.link && projection?.some((p) => sameCandidate(p.name, c.name))))
  const minors = sorted.filter((c) => !majors.includes(c))
  const incNames = (race.incumbents || [race.incumbent]).filter((i) => i?.name).map((i) => lastName(i.name))

  const mateOf = (c) => Object.entries(intel?.runningMates || {}).find(([n]) => sameCandidate(n, c.name))?.[1]
  const endorsementsOf = (c) => intel?.endorsements?.find((e) => sameCandidate(e.title.replace(/\s*\(.*\)\s*$/, ''), c.name))

  const ratingEntries = Object.entries(race.ratings || {})
  const cons = race.consensus
  const wire = useRaceNews(race)
  const report = race.summary || intel?.summary
  const openWire = () => document.getElementById(`wire-${race.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })

  return (
    <div className="race-view">
      <div className="race-head">
        <div>
          <div className="pixel race-title">{title}</div>
          <div className="race-sub">
            {stateName} · PVI <b>{race.pvi || '—'}</b> · INCUMBENT{' '}
            <b className={race.incumbent?.vacancy ? 'open-seat' : ''} style={{ color: race.incumbent?.vacancy ? undefined : partyColor(race.incumbent?.party) }}>{incLabel(race.incumbent)}</b>
            {race.incumbent?.name && race.incumbent?.party && ` (${race.incumbent.party})`}
          </div>
          <div className="race-status">STATUS: {race.status || '—'}</div>
          {race.type === 'governor' && (
            <div className="race-status">
              {race.firstElected ? `IN OFFICE SINCE ${+race.firstElected + 1} · ` : ''}
              {race.lastRace ? `LAST WON WITH ${race.lastRace} · ` : ''}
              {['NH', 'VT'].includes(race.state) ? '2-YEAR TERM' : '4-YEAR TERM'}
            </div>
          )}
        </div>
        <div className="race-head-right">
          {watch && (
            <button type="button" className={`star ${watch.ids.includes(race.id) ? 'on' : ''}`} onClick={() => watch.toggle(race.id)} aria-pressed={watch.ids.includes(race.id)} title="Add to watchlist (desktop alerts for this race)">
              {watch.ids.includes(race.id) ? '★ WATCHING' : '☆ WATCH'}
            </button>
          )}
          {cons && <div className={ratingClass(cons.label)} style={{ fontSize: 9 }}>{cons.label.toUpperCase()}</div>}
        </div>
      </div>

      <NewsBar wire={wire} onOpen={openWire} />

      {race.result && (
        <div className="result-banner" style={{ '--rc': resultColor(race.result) }}>
          <span className="pixel">✓ CALLED</span>
          <span><b>{race.result.winner}</b> ({race.result.party}){race.result.pct ? ` · ${race.result.pct}%` : ''}</span>
          <span className="pixel">{race.result.flip ? `⚑ ${race.result.party} GAIN` : `${race.result.party} HOLD`}</span>
        </div>
      )}
      {results && !race.result && <div className="result-banner awaiting"><span className="pixel">◌ AWAITING CALL</span><span>Forecast shown below until the race is called.</span></div>}

      {race.hqNote && (
        <div className="hq-note">
          <span className="pixel">◆ HQ NOTE</span>
          {race.hqNote.split(/\n+/).map((p, i) => <p key={i}>{p}</p>)}
        </div>
      )}

      {/* FORECAST */}
      <section className="intel-block">
        <h4 className="pixel">▣ FORECAST CONSENSUS</h4>
        {cons?.hq && <div className="hq-flag">◆ HQ rating: <b>{cons.label}</b> (set by Midterms HQ; forecasters below)</div>}
        {cons ? (
          <>
            <div className="meter" role="img" aria-label={`Consensus ${cons.label}, score ${cons.score}`}>
              <div className="meter-track" />
              {ratingEntries.map(([name, r], i) => (
                <div key={name} className="meter-dot" title={`${name}: ${r.label}`} style={{ left: `${((r.score + 3) / 6) * 100}%`, top: 4 + (i % 3) * 7, background: ratingColor(r.label) }} />
              ))}
              <div className="meter-needle" style={{ left: `${((cons.score + 3) / 6) * 100}%` }} />
              <div className="meter-labels"><span className="party-d">SAFE D</span><span style={{ color: 'var(--tossup)' }}>TOSSUP</span><span className="party-r">SAFE R</span></div>
            </div>
            {cons.implied ? (
              <div className="dim">Not on any forecaster’s competitive list — rated safe for the district’s partisan lean.</div>
            ) : (
              <div className="chips">
                {ratingEntries.map(([name, r]) => (
                  <span key={name} className="chip" title={r.flip ? 'Projected flip' : ''}>
                    <span className="chip-src">{name}</span>
                    <span className={ratingClass(r.label)}>{r.label}{r.flip ? ' ⚑' : ''}</span>
                  </span>
                ))}
              </div>
            )}
            {cons.flipVotes > 0 && <div className="alert-line">⚑ {cons.flipVotes}/{cons.n} FORECASTERS PROJECT A SEAT FLIP</div>}
          </>
        ) : <div className="dim">No forecaster ratings on file.</div>}
      </section>

      {/* POLLS */}
      <section className="intel-block">
        <h4 className="pixel">▣ POLL PROJECTION</h4>
        {!intel && !err && page && <div className="loading">INTERCEPTING POLL DATA<span className="blink">_</span></div>}
        {err && <div className="dim">Poll feed unavailable ({err}).</div>}
        {intel && !projection && !intel.polls.length && <div className="dim">No public general-election polling on file for this race.</div>}
        {projection && (
          <div className="bars">
            <div className="bars-cap">
              {intel.aggregates.length
                ? `Polling average across ${intel.aggregates.filter((a) => a.source !== 'Average').length} aggregators`
                : `Average of the ${Math.min(5, intel.polls.length)} most recent public polls`}
            </div>
            {projection.map((p) => (
              <div key={p.name} className="bar-row" title={`${p.name}: ${p.value}%`}>
                <span className="bar-name">{p.name}</span>
                <div className="bar-track">
                  <div className="bar-fill" style={{ width: `${p.value}%`, background: partyColor(p.party) }} />
                </div>
                <span className="bar-val">{p.value}%</span>
                <Sparkline points={trends[p.name] || []} color={partyColor(p.party)} />
              </div>
            ))}
            {Object.values(trends).some((t) => t.length >= 3) && <div className="bars-cap">Trend lines: each candidate across {Math.max(...Object.values(trends).map((t) => t.length))} dated polls, oldest → newest</div>}
            {intel.aggregates.find((a) => a.source === 'Average')?.margin && (
              <div className="margin-call">MARGIN: {intel.aggregates.find((a) => a.source === 'Average').margin}</div>
            )}
          </div>
        )}
        {intel?.polls?.length > 0 && (
          <details className="polls-table">
            <summary>RECENT POLLS ({intel.polls.length})</summary>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr><th>Pollster</th><th>Dates</th><th>Sample</th>{intel.pollCandidates.map((c) => <th key={c}>{c}</th>)}</tr>
                </thead>
                <tbody>
                  {intel.polls.map((p, i) => {
                    const max = Math.max(...p.values.filter((v) => v != null))
                    return (
                      <tr key={i}>
                        <td>{p.source}</td><td>{p.dates}</td><td>{p.sample}</td>
                        {p.values.map((v, j) => <td key={j} className={v === max ? 'lead' : ''}>{v != null ? `${v}%` : '–'}</td>)}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </details>
        )}
      </section>

      {/* FINANCE */}
      <section className="intel-block">
        <h4 className="pixel">▣ CAMPAIGN FINANCE</h4>
        {finance ? (
          <div className="bars">
            <div className="bars-cap">{finance.asOf ? `As of ${finance.asOf} · ` : ''}{finance.src}</div>
            {finance.rows.map((r) => (
              <div key={r.name} className="fin-row" title={`${r.name}: raised ${fmtMoney(r.raised)}, spent ${fmtMoney(r.spent)}, cash ${fmtMoney(r.cash)}`}>
                <span className="bar-name">{r.name}</span>
                <div className="bar-track">
                  <div className="bar-fill" style={{ width: `${((r.raised || 0) / maxRaised) * 100}%`, background: partyColor(r.party) }} />
                  <div className="bar-fill spent" style={{ width: `${((r.spent || 0) / maxRaised) * 100}%` }} />
                </div>
                <span className="bar-val">{fmtMoney(r.raised)}</span>
              </div>
            ))}
            <div className="legend-row"><span><i className="sw raised" /> Raised</span><span><i className="sw spent" /> Spent (overlay)</span></div>
          </div>
        ) : race.type === 'governor' ? (
          <div className="dim">{intel ? 'No fundraising table on file — governor races report to state agencies, not the FEC.' : 'Scanning state filings…'}</div>
        ) : (
          <div className="dim">{intel ? 'No fundraising table on the race page.' : 'Scanning…'}</div>
        )}
        {race.type !== 'governor' && (
          <div className="fec-row">
            <button type="button" className="btn-mini" onClick={loadFec}>⟳ PULL LIVE FEC TOTALS</button>
            {fecErr && <span className="err">{fecErr}</span>}
            {fec && finance?.src !== 'OpenFEC live API' && (
              <div className="table-scroll">
                <table>
                  <thead><tr><th>FEC filer</th><th>Raised</th><th>Spent</th><th>Cash</th><th>Through</th></tr></thead>
                  <tbody>
                    {fec.slice(0, 8).map((r) => (
                      <tr key={r.id}><td style={{ color: partyColor(r.party) }}>{r.name}</td><td>{fmtMoney(r.raised)}</td><td>{fmtMoney(r.spent)}</td><td>{fmtMoney(r.cash)}</td><td>{r.through}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </section>

      {/* CANDIDATES */}
      <section className="intel-block">
        <h4 className="pixel">▣ CANDIDATE DOSSIERS</h4>
        <div className="cand-grid">
          {majors.map((c) => {
            const f = finance && matchBy(finance.rows, c)
            return (
              <CandidateCard
                key={c.name}
                cand={c}
                image={race.images?.[c.link] || race.images?.[c.name]}
                incumbent={incNames.includes(lastName(c.name))}
                result={c.won ? 'won' : race.result ? 'lost' : null}
                leading={!race.result && leaderName && sameCandidate(leaderName, c.name)}
                money={f ? { raised: fmtMoney(f.raised), spent: fmtMoney(f.spent), cash: fmtMoney(f.cash) } : null}
                mate={mateOf(c)}
                endorsements={endorsementsOf(c)?.count}
              />
            )
          })}
        </div>
        {minors.length > 0 && (
          <div className="minor-list">
            <span className="dim">ALSO ON BALLOT:</span>{' '}
            {minors.map((c) => (
              <span key={c.name} className="minor"><span style={{ color: partyColor(c.party) }}>■</span> {c.name} <span className="dim">({c.partyName})</span></span>
            ))}
          </div>
        )}
      </section>

      {intel?.endorsements?.length > 0 && (
        <section className="intel-block">
          <h4 className="pixel">▣ KEY ENDORSEMENTS</h4>
          <div className="endorse-grid">
            {intel.endorsements.map((e) => (
              <div key={e.title} className="endorse">
                <div className="endorse-head"><b>{e.title}</b> <span className="dim">{e.count} total</span></div>
                {e.groups.slice(0, 5).map((g) => (
                  <div key={g.cat} className="endorse-row"><span className="dim">{g.cat} ({g.n}):</span> {g.names.join(', ')}{g.n > g.names.length ? ', …' : ''}</div>
                ))}
              </div>
            ))}
          </div>
        </section>
      )}

      {intel?.debates?.length > 0 && (
        <section className="intel-block">
          <h4 className="pixel">▣ DEBATES ({intel.debates.length})</h4>
          {intel.debates.map((d, i) => (
            <div key={i} className="debate-row">
              <span className="pixel">#{i + 1}</span>
              <span>{d.date}</span>
              <span className="dim">{d.host}</span>
              {d.url && <a className="btn-mini" href={d.url} target="_blank" rel="noreferrer">▶ WATCH</a>}
            </div>
          ))}
        </section>
      )}

      {intel?.primaries?.length > 0 && (
        <section className="intel-block">
          <h4 className="pixel">▣ THE ROAD HERE · PRIMARIES</h4>
          {intel.primaries.map((p) => (
            <details key={p.title} className="primary" open={finalMajorRound(p, intel.primaries)}>
              <summary>
                <span className="pixel">{p.title.toUpperCase()}</span>
                <span className="dim">{p.cands.length === 1 ? 'unopposed' : `${p.cands.length} candidates`}</span>
              </summary>
              {p.cands.slice(0, 6).map((c) => (
                <div key={c.name} className={`prim-row ${c.won ? 'won' : ''}`}>
                  <span className="bar-name">{c.won ? '✓ ' : ''}{c.name}</span>
                  <div className="bar-track"><div className="bar-fill" style={{ width: `${c.pct || 0}%`, background: partyColor(c.party || primaryParty(p.title)) }} /></div>
                  <span className="bar-val">{c.pct != null ? `${c.pct}%` : '—'}</span>
                  <span className="dim prim-votes">{c.votes ? c.votes.toLocaleString() : ''}</span>
                </div>
              ))}
              {p.cands.length > 6 && <div className="dim">+{p.cands.length - 6} more</div>}
            </details>
          ))}
        </section>
      )}

      {/* FIELD REPORT: Wikipedia's write-up (House districts come with the race intel), else HQ's data brief */}
      <section className="intel-block">
        <h4 className="pixel">▣ FIELD REPORT</h4>
        {report
          ? report.split('\n\n').map((p, i) => <p key={i} className="brief">{p}</p>)
          : (
            <>
              <p className="brief">{dataBrief(race, isHouse ? districtLabel(race.state, race.district) : race.type === 'senate' ? `This ${stateName} Senate seat` : `The ${stateName} governorship`)}</p>
              <div className="source-line">{intel || err || !page ? 'Built from the ratings and race data on this page; no Wikipedia write-up for this race yet.' : 'Scanning for a write-up…'}</div>
            </>
          )}
      </section>

      {intel?.background && (
        <section className="intel-block">
          <details>
            <summary className="pixel">▣ STATE BACKGROUND</summary>
            {intel.background.split(/\n\n+/).map((p, i) => <p key={i} className="brief">{p}</p>)}
          </details>
        </section>
      )}

      {/* NEWS: context, last */}
      <RaceNews race={race} wire={wire} id={`wire-${race.id}`} />

      {page && (
        <div className="source-line">
          SOURCE: <a href={wikiUrl(page)} target="_blank" rel="noreferrer">{page}</a>
          {intel?.timestamp && <> · page rev {timeAgo(intel.timestamp)}</>}
        </div>
      )}
    </div>
  )
}

// Campaign money for learners: outside spending on federal races (FEC Schedule E,
// via money.json) and plain-English explainers on how campaign money works.
import { fmtMoney, partyColor } from '../lib/util.js'
import { STATE_PORTALS, fecCommitteeUrl, fecOutsideUrl } from '../data/money.js'

const FEC_IE_GUIDE = 'https://www.fec.gov/help-candidates-and-committees/making-independent-expenditures/'
const FEC_LIMITS = 'https://www.fec.gov/help-candidates-and-committees/candidate-taking-receipts/contribution-limits/'
const NCSL_LIMITS = 'https://www.ncsl.org/elections-and-campaigns/state-limits-on-contributions-to-candidates'

export function StatePortal({ race }) {
  const p = STATE_PORTALS[race.state]
  if (race.type !== 'governor' || !p) return null
  return (
    <div className="money-src">
      CHECK THE FILINGS: <a href={p[1]} target="_blank" rel="noreferrer">{p[0]} ↗</a>
    </div>
  )
}

export function FinanceExplainer({ race }) {
  const gov = race.type === 'governor'
  return (
    <details className="explain">
      <summary>HOW CAMPAIGN MONEY WORKS</summary>
      <p className="brief">
        <b>Raised</b> is everything the candidate&apos;s own campaign took in: donations from individuals, from PACs and parties, plus any of
        the candidate&apos;s own money. <b>Spent</b> pays for ads, staff, travel and mail. <b>Cash on hand</b> is what&apos;s left in the
        bank, the money a campaign still has for the final stretch.
      </p>
      {gov ? (
        <p className="brief">
          <b>Governors play by state rules.</b> Senate and House candidates report to the federal FEC, but governor candidates report to
          their own state, and every state sets its own limits and deadlines. A few, including Texas and Pennsylvania, put no cap on what
          one person can give. That&apos;s why numbers can be harder to find and compare. The official filings are linked above.{' '}
          <a href={NCSL_LIMITS} target="_blank" rel="noreferrer">State limits (NCSL) ↗</a>
        </p>
      ) : (
        <p className="brief">
          <b>Federal limits:</b> in 2025–26 a person can give a candidate up to $3,500 per election (primary and general count
          separately), and a PAC up to $5,000. Every campaign reports to the FEC on a set schedule, so these numbers are public.{' '}
          <a href={FEC_LIMITS} target="_blank" rel="noreferrer">FEC limits ↗</a>
        </p>
      )}
      <p className="brief">
        <b>Money isn&apos;t votes.</b> Spending buys name recognition and airtime, but the bigger spender doesn&apos;t always win, and
        an incumbent or a candidate in a friendly state often needs less. Read it next to the polls and ratings, not instead of them.
      </p>
    </details>
  )
}

function OutsideExplainer({ gov }) {
  return (
    <details className="explain">
      <summary>WHAT IS OUTSIDE MONEY?</summary>
      <p className="brief">
        Groups that aren&apos;t the campaign can spend on a race by themselves: TV ads, mailers, door knocking. The law calls this an{' '}
        <b>independent expenditure</b>, and the group isn&apos;t allowed to coordinate it with the candidate. Each one is marked as{' '}
        <b>for</b> a candidate or <b>against</b> one.
      </p>
      <p className="brief">
        <b>Super PACs</b> do most of it. Since 2010 (<i>Citizens United v. FEC</i> and <i>SpeechNow.org v. FEC</i>) they can raise
        unlimited money from people, companies and unions, as long as they never give directly to a candidate. They do have to report
        their donors, though a donor can be a nonprofit that doesn&apos;t name its own (&ldquo;dark money&rdquo;). Regular{' '}
        <b>PACs</b> may give to candidates but only in limited amounts. <b>Party committees</b> such as the NRSC, DSCC, NRCC and DCCC
        spend here too.
      </p>
      {gov && (
        <p className="brief">
          <b>Governor races:</b> the biggest outside players are the Republican and Democratic Governors Associations (RGA and DGA). They
          usually spend through state-level committees, so their spending is reported to the state, not the FEC.
        </p>
      )}
      <p className="brief">
        <b>Follow it yourself:</b> tap any group to open its FEC page, which lists who gives to it and what it spends.{' '}
        <a href={FEC_IE_GUIDE} target="_blank" rel="noreferrer">FEC guide ↗</a>
      </p>
    </details>
  )
}

export function OutsideMoney({ race, money }) {
  const gov = race.type === 'governor'
  if (gov) {
    const p = STATE_PORTALS[race.state]
    return (
      <>
        <div className="dim">
          The FEC doesn&apos;t cover governor races, so outside spending here is reported to the state
          {p ? <> (<a href={p[1]} target="_blank" rel="noreferrer">{p[0]} ↗</a>)</> : ''}.
        </div>
        <OutsideExplainer gov />
      </>
    )
  }
  if (!money) return <div className="dim">Scanning FEC filings…</div>
  if (!money.generatedAt) {
    // the data file hasn't been published yet, or we're offline with no saved copy
    return (
      <>
        <div className="dim">
          Outside-spending data isn&apos;t loaded right now.{' '}
          <a href="https://www.fec.gov/data/independent-expenditures/?data_type=processed&cycle=2026" target="_blank" rel="noreferrer">Search it on FEC.gov ↗</a>
        </div>
        <OutsideExplainer />
      </>
    )
  }
  const o = money.outside[race.id]
  if (!o) {
    return (
      <>
        <div className="dim">No outside spending on this race has been reported to the FEC yet.</div>
        <OutsideExplainer />
      </>
    )
  }
  const max = Math.max(...o.candidates.map((c) => Math.max(c.support, c.oppose)), 1)
  const lead = o.candidates[0]
  return (
    <div className="outside">
      <div className="outside-total">
        <span className="pixel">{fmtMoney(o.total)}</span> spent by outside groups this cycle, primaries included
      </div>
      <div className="bars">
        {o.candidates.slice(0, 6).map((c) => (
          <div key={c.id} className="so-row" title={`${c.name}: ${fmtMoney(c.support)} for, ${fmtMoney(c.oppose)} against`}>
            <span className="bar-name" style={{ color: partyColor(c.party) }}>{c.name}</span>
            <div className="so-bars">
              <div className="bar-track"><div className="bar-fill" style={{ width: `${(c.support / max) * 100}%`, background: partyColor(c.party) }} /></div>
              <div className="bar-track"><div className="bar-fill against" style={{ width: `${(c.oppose / max) * 100}%` }} /></div>
            </div>
            <span className="so-vals"><span>{fmtMoney(c.support)}</span><span>{fmtMoney(c.oppose)}</span></span>
          </div>
        ))}
        <div className="legend-row"><span><i className="sw for" /> For (top bar)</span><span><i className="sw against" /> Against (bottom bar)</span></div>
      </div>
      <details className="explain" open>
        <summary>TOP SPENDERS ({o.spenders.length})</summary>
        <div className="table-scroll">
          <table className="spenders">
            <thead><tr><th>Group</th><th>Spent</th><th>Target</th><th className="sp-type">Type</th></tr></thead>
            <tbody>
              {o.spenders.map((s, i) => (
                <tr key={`${s.id}-${s.cid}-${s.so}-${i}`}>
                  <td>{s.id ? <a href={fecCommitteeUrl(s.id)} target="_blank" rel="noreferrer">{s.name}</a> : s.name}</td>
                  <td>{fmtMoney(s.total)}</td>
                  <td><span className={s.so === 'O' ? 'so-against' : 'so-for'}>{s.so === 'O' ? 'AGAINST' : 'FOR'}</span> {s.candidate}</td>
                  <td className="dim sp-type">{s.type}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
      <OutsideExplainer />
      <div className="money-src">
        Source: FEC independent-expenditure filings{money.generatedAt ? `, pulled ${new Date(money.generatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}` : ''}. The FEC takes a few
        days to process the newest 24- and 48-hour reports, so the last week of spending may be missing.{' '}
        {lead && <a href={fecOutsideUrl(lead.id)} target="_blank" rel="noreferrer">Every filing on FEC.gov ↗</a>}
      </div>
    </div>
  )
}

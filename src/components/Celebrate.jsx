import { useEffect, useMemo, useState } from 'react'
import { POLL_WAVES, isElectionWindow, resultColor } from '../lib/util.js'
import { PARTY_NAME } from '../lib/calls.js'
import { deskList } from '../data/scout.js'

// Election-night celebrations: a pixel-confetti burst for each call, same treatment for
// every party (HQ is a scoreboard, not a cheering section), and a bigger one when a
// chamber's control is decided.
const SHOW_MS = 4200
const BITS = 30

function Confetti({ color }) {
  const bits = useMemo(() => Array.from({ length: BITS }, (_, i) => {
    const a = (i / BITS) * Math.PI * 2 + Math.random() * 0.4
    const d = 120 + Math.random() * 220
    return {
      '--dx': `${Math.cos(a) * d}px`,
      '--dy': `${Math.sin(a) * d * 0.7 - 40}px`,
      '--c': i % 3 === 0 ? '#ffffff' : i % 3 === 1 ? '#ffd700' : color,
      animationDelay: `${Math.random() * 120}ms`,
    }
  }), [color])
  return <div className="confetti" aria-hidden="true">{bits.map((s, i) => <i key={i} style={s} />)}</div>
}

// queue items: { kind: 'race', title, result } | { kind: 'control', chamber, party } | { kind: 'batch', n }
export function CallBurst({ queue, onDone }) {
  const item = queue[0]
  useEffect(() => {
    if (!item) return
    const t = setTimeout(onDone, item.kind === 'control' ? SHOW_MS * 1.6 : SHOW_MS)
    return () => clearTimeout(t)
  }, [item, onDone])
  if (!item) return null

  const color = item.kind === 'race' ? resultColor(item.result) : item.kind === 'control' ? resultColor({ party: item.party }) : '#ffd700'
  return (
    <div className={`call-burst ${item.kind}`} style={{ '--rc': color }} role="status" aria-live="polite" onClick={onDone}>
      <Confetti color={color} />
      <div className="call-card pixel-border">
        {item.kind === 'race' && (
          <>
            <div className="pixel call-kicker">★ RACE CALLED ★</div>
            <div className="pixel call-title">{item.title.toUpperCase()}</div>
            <div className="call-winner"><b>{item.result.winner}</b> ({item.result.party}){item.result.pct ? ` · ${item.result.pct}%` : ''}</div>
            <div className="pixel call-tag">{item.result.flip ? `⚑ ${item.result.party} GAIN` : `${item.result.party} HOLD`}</div>
          </>
        )}
        {item.kind === 'control' && (
          <>
            <div className="pixel call-kicker">★ ★ CONTROL CALLED ★ ★</div>
            <div className="pixel call-title">{item.chamber === 'senate' ? 'U.S. SENATE' : 'U.S. HOUSE'}</div>
            <div className="pixel call-big">{PARTY_NAME[item.party]}</div>
            <div className="call-winner">{item.party === 'D' ? 'Democrats' : 'Republicans'} have clinched a majority of called seats.</div>
          </>
        )}
        {item.kind === 'batch' && (
          <>
            <div className="pixel call-kicker">★ CALLS COMING IN ★</div>
            <div className="pixel call-big">{item.n} RACES CALLED</div>
            <div className="call-winner">See the call feed on GAMEDAY.</div>
          </>
        )}
        <div className="dim call-src">
          {item.kind !== 'race' ? 'From called races' : item.result.hq ? 'Called by HQ' : item.result.sources?.length ? `Called by ${deskList(item.result.sources)}` : 'Confirmed by HQ'} · unofficial until certified
        </div>
      </div>
    </div>
  )
}

const KEY = 'mhq:election-banner'
const until = (ms) => {
  const m = Math.max(0, Math.round(ms / 6e4))
  const h = Math.floor(m / 60)
  return h ? `${h}H ${m % 60}M` : `${m}M`
}

// Election-week strip across the top of the app.
export function ElectionBanner({ called, total, onGameday }) {
  const [hidden, setHidden] = useState(() => { try { return sessionStorage.getItem(KEY) === '1' } catch { return false } })
  const [now, setNow] = useState(() => new Date())
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 30000); return () => clearInterval(t) }, [])
  if (hidden || !isElectionWindow(now)) return null

  const first = POLL_WAVES[0].at
  const last = POLL_WAVES[POLL_WAVES.length - 1].at
  const morning = new Date('2026-11-04T06:00:00-05:00')
  const [head, sub] = now < first
    ? ["IT'S ELECTION DAY", `Polls are open · first closings at ${POLL_WAVES[0].label} (in ${until(first - now)})`]
    : now < morning
      ? ['ELECTION NIGHT · RESULTS LIVE', `${called}/${total} races called${now < last ? ` · more polls close through ${POLL_WAVES[POLL_WAVES.length - 1].label}` : ''}`]
      : ['THE COUNT CONTINUES', `${called}/${total} races called · close races can take days`]

  const close = () => {
    setHidden(true)
    try { sessionStorage.setItem(KEY, '1') } catch { /* private mode */ }
  }
  return (
    <div className="election-banner" role="status">
      <span className="eb-stars" aria-hidden="true">★ ✦ ★</span>
      <span className="pixel eb-head">{head}</span>
      <span className="eb-sub">{sub}</span>
      {now < first && <a className="btn-mini" href="https://vote.gov" target="_blank" rel="noreferrer">FIND YOUR POLLS ↗</a>}
      <button type="button" className="btn-mini eb-go" onClick={onGameday}>GAMEDAY ▸</button>
      <span className="eb-stars" aria-hidden="true">★ ✦ ★</span>
      <button type="button" className="btn-close" onClick={close} aria-label="Hide for now">✕</button>
    </div>
  )
}

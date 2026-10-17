import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import snapshot from './data/snapshot.json'
import { fetchAll, healthCheck } from './data/live.js'
import { applyControl, fetchControl } from './data/control.js'
import { STATES, labelFor } from './data/wiki.js'
import {
  AWAITING, RATING_COLORS, RESULT_COLORS, countdown, isElectionWindow, pad, pollCloseFor, raceTitle, ratingColor, resultColor, timeAgo,
} from './lib/util.js'
import { resolveView } from './lib/view.js'
import { IS_DESKTOP, cacheGet, cacheSet, notify } from './lib/desktop.js'
import UsMap from './components/UsMap.jsx'
import Dossier from './components/Dossier.jsx'
import Overview from './components/Overview.jsx'
import Gameday from './components/Gameday.jsx'
import RegionBrief from './components/RegionBrief.jsx'
import CommandBar from './components/CommandBar.jsx'
import About from './components/About.jsx'
import UpdateBanner from './components/UpdateBanner.jsx'
import HqBanner from './components/HqBanner.jsx'
import { Icon } from './components/Sprites.jsx'
import './App.css'

const REFRESH_MS = 3 * 60 * 1000
const NIGHT_REFRESH_MS = 60 * 1000 // election week: revision checks are ~2 KB, so poll faster
const MODES = [
  { key: 'senate', label: 'SENATE', icon: 'senate' },
  { key: 'governor', label: 'GOVERNOR', icon: 'governor' },
  { key: 'house', label: 'HOUSE', icon: 'house' },
  { key: 'measures', label: 'MEASURES', icon: 'measures' },
]
const MEASURE_SCALE = ['#0c3a1c', '#0f6a2c', '#14a03c', '#00ff41']

const BOOT = [
  'INITIALIZING MIDTERMS HQ v2.6…',
  'ESTABLISHING SECURE UPLINK…………… OK',
  'DECRYPTING FORECAST CHANNELS (10)… OK',
  'SYNCING 35 SENATE · 36 GOVERNOR · 435 HOUSE FILES… OK',
  'LOADING BALLOT MEASURE ARCHIVE…… OK',
  'WELCOME, AGENT.',
]

function Boot({ onDone }) {
  const [n, setN] = useState(0)
  useEffect(() => {
    if (n >= BOOT.length) { const t = setTimeout(onDone, 450); return () => clearTimeout(t) }
    const t = setTimeout(() => setN(n + 1), 260)
    return () => clearTimeout(t)
  }, [n, onDone])
  return (
    <div className="boot" onClick={onDone} onKeyDown={onDone} role="button" tabIndex={0} aria-label="Skip intro">
      <div className="boot-inner">
        <Icon name="radar" size={64} />
        <h1 className="pixel glow">MIDTERMS HQ</h1>
        {BOOT.slice(0, n).map((l) => <div key={l} className="boot-line">&gt; {l}</div>)}
        <div className="boot-line"><span className="blink">█</span></div>
        <div className="dim boot-skip">[CLICK OR PRESS ANY KEY TO SKIP]</div>
      </div>
    </div>
  )
}

// Ticking pieces live in their own components so only they re-render every second.
function useClock() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t) }, [])
  return now
}

function Countdown() {
  const cd = countdown(useClock())
  if (cd.done) {
    return (
      <div className="countdown" aria-label="Election status">
        <div className="cd-label">ELECTION DAY · NOV 3</div>
        <div className="cd-digits pixel glow-amber">{isElectionWindow() ? 'POLLS ACTIVE' : 'RESULTS'}</div>
      </div>
    )
  }
  return (
    <div className="countdown" aria-label="Countdown to Election Day">
      <div className="cd-label">T-MINUS TO NOV 3</div>
      <div className="cd-digits pixel">
        {cd.d}<small>D</small> {pad(cd.h)}<small>H</small> {pad(cd.m)}<small>M</small> <span className="glow-amber">{pad(cd.s)}</span><small>S</small>
      </div>
    </div>
  )
}

function SyncStatus({ sync, onSync }) {
  useClock() // keep "synced Xs ago" current
  return (
    <div className="sync">
      <div className={`sync-dot ${sync.status}`} />
      <div>
        <div className="pixel" style={{ fontSize: 8 }}>
          {sync.status === 'live' ? 'LIVE UPLINK' : sync.status === 'syncing' ? 'SYNCING…' : sync.status === 'error' ? 'UPLINK LOST' : 'SNAPSHOT'}
        </div>
        <div className="dim">
          checked {timeAgo(sync.at)} · every {isElectionWindow() ? '1m' : '3m'}{IS_DESKTOP ? ' · DESKTOP LINK' : ''}
        </div>
      </div>
      <button type="button" className="btn-mini" onClick={onSync} disabled={sync.status === 'syncing'}>⟳ SYNC</button>
    </div>
  )
}

const allRaces = (d) => [...Object.values(d.senate), ...Object.values(d.governor), ...Object.values(d.house).flat()]

// What changed between two datasets: rating shifts, newly called races, decided measures.
function diffData(prev, next) {
  const out = []
  const before = Object.fromEntries(allRaces(prev).map((r) => [r.id, r]))
  for (const r of allRaces(next)) {
    const p = before[r.id]
    if (!p) continue
    const name = raceTitle(r, STATES)
    if (r.result && !p.result) {
      const w = r.result
      out.push({ id: r.id, type: r.type, kind: 'call', msg: `CALLED · ${name}: ${w.winner} (${w.party})${w.pct ? ` ${w.pct}%` : ''}${w.flip ? ` — ${w.party} GAIN` : ''}` })
    } else if (p.consensus?.label && r.consensus?.label && p.consensus.label !== r.consensus.label) {
      out.push({ id: r.id, type: r.type, kind: 'shift', msg: `RATING SHIFT · ${name}: ${p.consensus.label} → ${r.consensus.label}` })
    }
  }
  for (const [st, list] of Object.entries(next.measures)) {
    for (const m of list) {
      const old = prev.measures[st]?.find((x) => x.title === m.title)
      if (old && old.status !== m.status && !/on ballot/i.test(m.status)) {
        out.push({ id: `measure-${st}`, type: 'measure', kind: 'call', msg: `MEASURE · ${STATES[st]} ${m.title}: ${m.status.toUpperCase()}` })
      }
    }
  }
  return out
}

// Dev-only: fake calls (following the forecast lean) to preview results mode before Nov 3.
function simulateResults(d) {
  const call = (r) => {
    const s = r.consensus?.score ?? 0
    const party = s === 0 ? (Math.random() < 0.5 ? 'D' : 'R') : s < 0 ? 'D' : 'R'
    const c = r.candidates.find((x) => x.party === party) || r.candidates[0]
    if (!c || Math.random() < 0.15) return r
    const pct = +(50 + Math.min(25, Math.abs(s) * 6) + Math.random() * 3).toFixed(1)
    return { ...r, result: { winner: c.name, party, pct, flip: r.incumbent.party && r.incumbent.party !== party }, candidates: r.candidates.map((x) => (x === c ? { ...x, won: true, pct } : x)) }
  }
  const map = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Array.isArray(v) ? v.map(call) : call(v)]))
  return { ...d, senate: map(d.senate), governor: map(d.governor), house: map(d.house) }
}

export default function App() {
  const [booted, setBooted] = useState(() => { try { return localStorage.getItem('mhq:booted') === '1' } catch { return false } })
  const [liveData, setData] = useState(snapshot)
  const [control, setControl] = useState(null)
  // Live control file (rating/result corrections, HQ notes) layered over the Wikipedia data.
  const data = useMemo(() => applyControl(liveData, control), [liveData, control])
  const [mode, setMode] = useState('senate')
  const [selected, setSelectedRaw] = useState(null)
  const [view, setView] = useState({})
  const [region, setRegion] = useState(null)
  const regionRef = useRef(null)
  const [lensPick, setLensPick] = useState(null)
  const [cmdOpen, setCmdOpen] = useState(false)
  const [aboutOpen, setAboutOpen] = useState(false)
  const [watchIds, setWatchIds] = useState([])
  const [sync, setSync] = useState({ status: 'snapshot', at: snapshot.generatedAt })
  const [log, setLog] = useState([{ t: Date.now(), msg: `Snapshot loaded (built ${timeAgo(snapshot.generatedAt)}). Requesting live uplink…` }])
  const dataRef = useRef(snapshot)
  const viewRef = useRef(view)
  const watchRef = useRef(watchIds)
  const healthRef = useRef('')
  useEffect(() => { viewRef.current = view }, [view])
  useEffect(() => { regionRef.current = region }, [region])
  const selectedRef = useRef(null)
  useEffect(() => { selectedRef.current = selected }, [selected])
  useEffect(() => { watchRef.current = watchIds }, [watchIds])

  const setSelected = useCallback((st) => { setSelectedRaw(st); setView({}) }, [])
  const pushLog = (msg, kind) => setLog((l) => [{ t: Date.now(), msg, kind }, ...l].slice(0, 60))

  // ---------- watchlist ----------
  useEffect(() => { cacheGet('watchlist').then((v) => Array.isArray(v) && setWatchIds(v)) }, [])
  const toggleWatch = useCallback((id) => setWatchIds((w) => {
    const next = w.includes(id) ? w.filter((x) => x !== id) : [...w, id]
    cacheSet('watchlist', next)
    return next
  }), [])
  const watch = useMemo(() => ({ ids: watchIds, toggle: toggleWatch }), [watchIds, toggleWatch])

  // ---------- live data ----------
  const applyData = useCallback((next, label) => {
    const changes = diffData(dataRef.current, next)
    dataRef.current = next
    setData(next)
    for (const c of changes) pushLog(c.msg, c.kind === 'call' ? 'call' : 'alert')
    // Alerts: starred races only once you have a watchlist; otherwise Senate/Governor news.
    const w = watchRef.current
    const notable = changes.filter((c) => (w.length ? w.includes(c.id) : c.type === 'senate' || c.type === 'governor'))
    if (notable.length) notify(`Midterms HQ · ${notable.length} update${notable.length > 1 ? 's' : ''}`, notable.slice(0, 4).map((c) => c.msg).join('\n'))
    if (!changes.length && label) pushLog(label)
    const warn = healthCheck(next)
    if (warn.join('|') !== healthRef.current) {
      healthRef.current = warn.join('|')
      warn.forEach((m) => pushLog(`DATA HEALTH · ${m}`, 'alert'))
    }
  }, [])

  const busy = useRef(false)
  const refresh = useCallback(async () => {
    if (busy.current) return
    busy.current = true
    setSync((s) => ({ ...s, status: 'syncing' }))
    try {
      fetchControl().then(setControl) // independent of Wikipedia; never throws
      const next = await fetchAll()
      if (next) applyData(next, `Live uplink synced (${next.changed} source page${next.changed > 1 ? 's' : ''} updated). No rating shifts.`)
      setSync({ status: 'live', at: new Date().toISOString() })
    } catch (e) {
      setSync((s) => ({ ...s, status: 'error' }))
      pushLog(`Uplink failed (${e.message}). Holding last known data.`, 'alert')
    } finally {
      busy.current = false
    }
  }, [applyData])

  useEffect(() => {
    let t
    const loop = async () => {
      await refresh()
      t = setTimeout(loop, isElectionWindow() ? NIGHT_REFRESH_MS : REFRESH_MS)
    }
    loop()
    return () => clearTimeout(t)
  }, [refresh])

  // ---------- keyboard ----------
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setCmdOpen((o) => !o); return }
      if (/input|textarea/i.test(e.target.tagName)) return
      if (e.key === '/') { e.preventDefault(); setCmdOpen(true); return }
      if (e.key !== 'Escape' || document.querySelector('.cmd-backdrop')) return
      // Esc backs out one level: district → state → region → nation.
      if (viewRef.current.district) setView((v) => ({ ...v, district: null }))
      else if (selectedRef.current) setSelected(null)
      else if (regionRef.current) setRegion(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setSelected])

  // Dev helper: window.mhqSimulateResults() previews results mode with fake calls.
  useEffect(() => {
    if (!import.meta.env.DEV) return
    window.mhqSimulateResults = () => { applyData(simulateResults(dataRef.current)); setLensPick('results') }
    return () => { delete window.mhqSimulateResults }
  }, [applyData])

  const finishBoot = useCallback(() => {
    setBooted(true)
    try { localStorage.setItem('mhq:booted', '1') } catch { /* ignore */ }
  }, [])

  const go = useCallback(({ state, mode: m, tab, district }) => {
    if (m) setMode(m)
    setSelectedRaw(state)
    setView({ tab: tab || null, district: district || null })
  }, [])

  // ---------- results lens ----------
  const hasResults = useMemo(() => allRaces(data).some((r) => r.result), [data])
  const results = (lensPick || (hasResults ? 'results' : 'forecast')) === 'results'

  const { fills, blips, labels } = useMemo(() => {
    const fills = {}
    const blips = {}
    const labels = {}
    const vs = (r) => r.candidates.filter((c) => c.party === 'D' || c.party === 'R').map((c) => `${c.name} (${c.party})`).join(' vs ')
    if (mode === 'senate' || mode === 'governor') {
      for (const r of Object.values(data[mode])) {
        const prev = fills[r.state] && labels[r.state]
        const l = r.consensus?.label
        if (results) {
          if (!prev || !r.result) {
            fills[r.state] = resultColor(r.result)
            labels[r.state] = r.result
              ? `${r.result.party} ${r.result.flip ? 'GAIN' : 'HOLD'} · ${r.result.winner}${r.result.pct ? ` ${r.result.pct}%` : ''}`
              : `AWAITING CALL · polls close ${pollCloseFor(r.state)?.label || '—'} · forecast ${l || '—'} · ${vs(r)}`
          }
          if (r.result?.flip) blips[r.state] = true
          continue
        }
        if (!prev || Math.abs(r.consensus?.score ?? 9) < 1) {
          fills[r.state] = ratingColor(l)
          labels[r.state] = `${l || 'UNRATED'} · ${vs(r) || r.incumbent.name}`
        }
        if (l === 'Tossup' || r.consensus?.flipVotes >= 3) blips[r.state] = true
      }
    } else if (mode === 'house') {
      for (const [st, list] of Object.entries(data.house)) {
        if (results) {
          const d = list.filter((r) => r.result?.party === 'D').length
          const rr = list.filter((r) => r.result?.party === 'R').length
          const open = list.length - d - rr
          fills[st] = d === rr ? AWAITING : RESULT_COLORS[d > rr ? 'D' : 'R']
          labels[st] = `${list.length} SEATS · D ${d} · R ${rr}${open ? ` · ${open} UNCALLED · polls close ${pollCloseFor(st)?.label || '—'}` : ''}`
          if (list.some((r) => r.result?.flip)) blips[st] = true
          continue
        }
        const scores = list.map((r) => r.consensus?.score).filter((s) => s != null)
        const avg = scores.reduce((a, b) => a + b, 0) / (scores.length || 1)
        fills[st] = ratingColor(labelFor(avg))
        const d = list.filter((r) => r.consensus?.score < -0.35).length
        const rr = list.filter((r) => r.consensus?.score > 0.35).length
        const t = list.length - d - rr
        labels[st] = `${list.length} SEATS · D ${d} · R ${rr}${t ? ` · ${t} TOSSUP` : ''}`
        if (t) blips[st] = true
      }
    } else {
      for (const [st, list] of Object.entries(data.measures)) {
        if (!list.length) continue
        fills[st] = MEASURE_SCALE[Math.min(3, Math.floor((list.length - 1) / 2))]
        const pending = list.filter((m) => /on ballot/i.test(m.status)).length
        const passed = list.filter((m) => /approved/i.test(m.status)).length
        labels[st] = `${list.length} MEASURES · ${pending} ON NOV 3 BALLOT${passed ? ` · ${passed} APPROVED` : ''}`
      }
    }
    return { fills, blips, labels }
  }, [data, mode, results])

  const zoom = useMemo(() => {
    if (!selected) return null
    const v = resolveView(selected, data, mode, view)
    return {
      layer: v.layer,
      house: v.house,
      district: v.district,
      setLayer: (layer) => setView((x) => ({ ...x, layer })),
      onPickDistrict: (key) => setView((x) => ({ ...x, tab: 'house', district: key })),
    }
  }, [selected, data, mode, view])

  const pickRace = (r) => go({ state: r.state, mode: r.type, tab: r.type === 'house' ? 'house' : r.id, district: r.type === 'house' ? r.key : null })

  const tickerItems = useMemo(() => {
    const gb = data.genericBallot.find((g) => g.source === 'Average')
    const calls = log.filter((l) => l.kind === 'call').slice(0, 12).map((l) => `✓ ${l.msg.toUpperCase()}`)
    const toss = [...Object.values(data.senate), ...Object.values(data.governor)].filter((r) => r.consensus?.label === 'Tossup' && !r.result)
    return [
      ...calls,
      gb && !results && `GENERIC BALLOT: ${gb.margin.toUpperCase()}`,
      ...toss.map((r) => `TOSSUP ▸ ${STATES[r.state].toUpperCase()} ${r.type.toUpperCase()}: ${r.candidates.filter((c) => c.party === 'D' || c.party === 'R').map((c) => c.name.toUpperCase()).join(' VS ')}`),
      ...log.filter((l) => l.kind === 'alert').slice(0, 5).map((l) => `⚠ ${l.msg.toUpperCase()}`),
    ].filter(Boolean)
  }, [data, log, results])

  const legend = mode === 'measures'
    ? [['1–2', MEASURE_SCALE[0]], ['3–4', MEASURE_SCALE[1]], ['5–6', MEASURE_SCALE[2]], ['7+', MEASURE_SCALE[3]]]
    : results
      ? [['D WIN', RESULT_COLORS.D], ['R WIN', RESULT_COLORS.R], ['IND WIN', RESULT_COLORS.I], ['AWAITING CALL', AWAITING]]
      : Object.entries(RATING_COLORS)

  return (
    <div className="hq">
      {!booted && <Boot onDone={finishBoot} />}
      <CommandBar data={data} open={cmdOpen} onClose={() => setCmdOpen(false)} onGo={go} />
      <About open={aboutOpen} onClose={() => setAboutOpen(false)} />
      <UpdateBanner />
      <HqBanner control={control} />

      <header className="topbar">
        <div className="brand">
          <Icon name="radar" size={28} />
          <div>
            <h1 className="pixel glow">MIDTERMS HQ</h1>
            <div className="sub">2026 ELECTION INTELLIGENCE COMMAND</div>
          </div>
        </div>
        <Countdown />
        <div className="top-right">
          <SyncStatus sync={sync} onSync={refresh} />
          <button type="button" className="btn-mini about-btn" onClick={() => setAboutOpen(true)} title="About, credits and settings">ⓘ ABOUT</button>
        </div>
      </header>

      <nav className="modes" aria-label="Race type">
        {MODES.map((m) => (
          <button key={m.key} type="button" className={`mode ${mode === m.key ? 'on' : ''}`} onClick={() => { setMode(m.key); setView({}) }} aria-pressed={mode === m.key}>
            <Icon name={m.icon} size={16} color={mode === m.key ? '#050510' : '#00ff41'} />
            {m.label}
          </button>
        ))}
        <div className="spacer" />
        <button type="button" className="mode small" onClick={() => setCmdOpen(true)} title="Search (⌘K or /)">⌕ SEARCH <kbd>⌘K</kbd></button>
        <span className="sm-toggle lens" role="group" aria-label="Map lens">
          <button type="button" className={!results ? 'on' : ''} aria-pressed={!results} onClick={() => setLensPick('forecast')}>FORECAST</button>
          <button type="button" className={results ? 'on' : ''} aria-pressed={results} onClick={() => setLensPick('results')} title="Election night: poll closings, live calls and results">
            GAMEDAY{hasResults ? '' : ' (NOV 3)'}
          </button>
        </span>
        {selected && <button type="button" className="mode small" onClick={() => setSelected(null)}>◀ SITUATION ROOM</button>}
      </nav>

      <main className="main">
        <section className="map-panel pixel-border">
          <div className="panel-label">
            <span className="pixel">TACTICAL MAP · {mode.toUpperCase()} · {results ? 'GAMEDAY' : 'FORECAST'}</span>
            <span className="dim">{selected ? `TARGET LOCKED: ${STATES[selected].toUpperCase()}` : 'SELECT A STATE · ⌘K TO SEARCH'}</span>
          </div>
          <UsMap fills={fills} blips={blips} labels={labels} selected={selected} onSelect={setSelected} zoom={zoom} results={results} region={region} onRegion={setRegion} />
          <div className="legend" aria-label="Legend">
            {legend.map(([k, c]) => (
              <span key={k} className="lg"><i style={{ background: c }} />{k}</span>
            ))}
            {mode !== 'measures' && <span className="lg"><i className="blip-legend" />{results ? 'SEAT FLIPPED' : 'TOSSUP / FLIP WATCH'}</span>}
            <span className="lg"><i style={{ background: '#0c1626', border: '1px solid #1a4d1a' }} />NO RACE</span>
          </div>
        </section>

        {selected
          ? <Dossier key={selected} abbr={selected} data={data} mode={mode} view={view} setView={setView} onClose={() => setSelected(null)} results={results} watch={watch} />
          : region
            ? <RegionBrief region={region} data={data} onPick={pickRace} onPickState={setSelected} onClose={() => setRegion(null)} results={results} watch={watch} />
            : results
            ? <Gameday data={data} onPick={pickRace} onPickState={setSelected} log={log} watch={watch} />
            : <Overview data={data} onPick={pickRace} log={log} results={results} watch={watch} featured={control?.featured} />}
      </main>

      <footer className="ticker" aria-label="News ticker">
        <div className="ticker-tag pixel">INTEL FEED</div>
        <div className="ticker-window">
          <div className="ticker-track" style={{ animationDuration: `${Math.max(40, tickerItems.length * 7)}s` }}>
            {[...tickerItems, ...tickerItems].map((t, i) => <span key={i}>◆ {t}</span>)}
          </div>
        </div>
      </footer>
    </div>
  )
}

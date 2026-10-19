import { useEffect, useRef, useState } from 'react'
import { getFecKey, isOwner, setFecKey } from '../data/live.js'
import { IS_DESKTOP, REPO_URL } from '../lib/desktop.js'
import { Icon } from './Sprites.jsx'

/* global __APP_VERSION__ */
const VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev'

const SOURCES = [
  ['Ratings, candidates, polls, finance tables, ballot measures, results', 'Wikipedia contributors', 'https://en.wikipedia.org/wiki/2026_United_States_elections', 'CC BY-SA 4.0'],
  ['Candidate photos', 'Wikimedia Commons (each image under its own license; open a candidate’s full file for attribution)', 'https://commons.wikimedia.org/', 'various'],
  ['Live federal campaign finance', 'Federal Election Commission — OpenFEC API', 'https://api.open.fec.gov/developers/', 'public domain'],
  ['2026 congressional district boundaries', 'U.S. Census Bureau — TIGERweb', 'https://tigerweb.geo.census.gov/', 'public domain'],
  ['State and county shapes', 'us-atlas (Mike Bostock), from Census cartographic boundaries', 'https://github.com/topojson/us-atlas', 'ISC'],
  ['News headlines', 'Each outlet’s public RSS feed (34 outlets; headlines link to the original story)', 'https://github.com/donyon67k/midterms-hq/blob/main/src/data/sources.js', 'headline + link'],
  ['Statehouse news', 'One statehouse newsroom per state, most from the nonprofit States Newsroom network (RSS)', 'https://statesnewsroom.org/', 'headline + link'],
  ['Local and wider news search', 'Google News RSS search (each result links to the original outlet)', 'https://news.google.com/', 'headline + link'],
  ['Outlet logos', 'DuckDuckGo favicon service (only the outlet’s domain is sent)', 'https://duckduckgo.com/', 'each outlet’s own mark'],
  ['City locations and populations', 'U.S. Census Bureau — Gazetteer & Vintage 2024 population estimates', 'https://www.census.gov/geographies/reference-files/time-series/geo/gazetteer-files.html', 'public domain'],
  ['2024 presidential results by county', 'tonmcg/US_County_Level_Election_Results_08-24', 'https://github.com/tonmcg/US_County_Level_Election_Results_08-24', 'see source'],
]

const RELEASES = `${REPO_URL}/releases/latest`
const PLATFORMS = [
  { key: 'mac', label: 'MAC', file: /universal\.dmg$/, note: 'macOS 12+ · Apple Silicon and Intel', steps: [
    'Download the .dmg and open it.',
    'Drag Project Midterms into Applications.',
    'First launch: macOS blocks unsigned apps. Open System Settings → Privacy & Security, scroll down and click “Open Anyway”. You only do this once.',
  ] },
  { key: 'win', label: 'WINDOWS', file: /x64-setup\.exe$/, alt: /\.msi$/, note: 'Windows 10 and 11 · 64-bit', steps: [
    'Download the setup .exe and run it.',
    'If SmartScreen says “Windows protected your PC”, click “More info” → “Run anyway”. The app isn’t code-signed yet; that’s the only reason for the warning.',
    'Project Midterms installs to your Start menu.',
  ] },
]

// Installer links from the newest published GitHub release (falls back to the releases page).
function useLatestRelease(open) {
  const [rel, setRel] = useState(null)
  useEffect(() => {
    if (!open || rel) return
    fetch('https://api.github.com/repos/donyon67k/midterms-hq/releases/latest')
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => j && setRel({ tag: j.tag_name, assets: j.assets.map((a) => ({ name: a.name, url: a.browser_download_url, size: a.size })) }))
      .catch(() => {})
  }, [open, rel])
  return rel
}

const mb = (n) => `${Math.round(n / 1e6)} MB`

function DesktopApp({ open }) {
  const rel = useLatestRelease(open)
  const guess = /Win/i.test(navigator.userAgent) ? 'win' : 'mac'
  const [pick, setPick] = useState(guess)
  const p = PLATFORMS.find((x) => x.key === pick)
  const main = rel?.assets.find((a) => p.file.test(a.name))
  const alt = p.alt && rel?.assets.find((a) => p.alt.test(a.name))
  return (
    <section className="intel-block" id="desktop-app">
      <h4 className="pixel">▣ GET THE DESKTOP APP</h4>
      <p className="brief">
        The desktop app is the full-power version: it reads every source directly (no web relay), keeps a bigger offline
        cache, sends alerts when a rating shifts or a race is called, and updates itself. Free, no account.
      </p>
      <div className="dl-tabs" role="tablist" aria-label="Platform">
        {PLATFORMS.map((x) => (
          <button key={x.key} type="button" role="tab" aria-selected={pick === x.key} className={`mode small ${pick === x.key ? 'on' : ''}`} onClick={() => setPick(x.key)}>{x.label}</button>
        ))}
      </div>
      <div className="dl-card">
        <a className="dl-btn pixel" href={main?.url || RELEASES} target="_blank" rel="noreferrer">
          ⬇ DOWNLOAD FOR {p.label}{main ? ` · ${rel.tag}` : ''}
        </a>
        <div className="dim">{p.note}{main ? ` · ${mb(main.size)}` : ''}{alt && <> · or the <a href={alt.url} target="_blank" rel="noreferrer">.msi installer</a></>}</div>
        <ol className="dl-steps">{p.steps.map((s) => <li key={s}>{s}</li>)}</ol>
      </div>
      <p className="brief dim">
        On a phone? Use this website: add it to your home screen from the browser’s Share menu. All versions and release notes:{' '}
        <a href={`${REPO_URL}/releases`} target="_blank" rel="noreferrer">GitHub releases</a>.
      </p>
    </section>
  )
}

const OPEN_SOURCE = 'React (MIT) · d3-geo (ISC) · topojson-client (ISC) · Tauri (MIT/Apache-2.0) · Vite (MIT) · pixelarticons (MIT) · Press Start 2P & Share Tech Mono fonts (OFL, bundled)'

export default function About({ open, onClose, section }) {
  const [key, setKey] = useState('')
  const [saved, setSaved] = useState(null)
  const [owner, setOwner] = useState(false)
  const panel = useRef(null)

  useEffect(() => {
    if (!open) return
    setSaved(null)
    isOwner().then((o) => {
      setOwner(o)
      if (o) getFecKey().then((k) => setKey(k === 'DEMO_KEY' ? '' : k))
    })
    panel.current?.focus()
    if (section) requestAnimationFrame(() => document.getElementById(section)?.scrollIntoView({ block: 'start' }))
  }, [open, section])

  if (!open) return null

  const save = async (e) => {
    e.preventDefault()
    await setFecKey(key)
    setSaved(key.trim() ? 'Saved. Live FEC totals now use your key.' : 'Cleared. Using the shared demo key.')
  }

  return (
    <div className="cmd-backdrop" onMouseDown={onClose}>
      <div className="about" role="dialog" aria-label="About and settings" tabIndex={-1} ref={panel}
        onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }}>
        <div className="about-head">
          <Icon name="radar" size={36} />
          <div>
            <h2 className="pixel glow">PROJECT: MIDTERMS</h2>
            <div className="dim">
              v{VERSION}{IS_DESKTOP ? ' · desktop' : ' · web'} · <a href={REPO_URL} target="_blank" rel="noreferrer">github.com/donyon67k/midterms-hq</a>
            </div>
          </div>
          <button type="button" className="btn-close" onClick={onClose} aria-label="Close">✕</button>
        </div>

        {IS_DESKTOP
          ? <p className="brief dim">You’re on the desktop app. It updates itself when a new version is published.</p>
          : <DesktopApp open={open} />}

        {owner && <section className="intel-block">
          <h4 className="pixel">▣ SETTINGS <span className="dim">· owner build only</span></h4>
          <form className="setting" onSubmit={save}>
            <label htmlFor="fec-key">FEC API key <span className="dim">(optional, free)</span></label>
            <div className="setting-row">
              <input id="fec-key" value={key} onChange={(e) => setKey(e.target.value)} placeholder="Paste your api.data.gov key" autoComplete="off" spellCheck={false} />
              <button type="submit" className="btn-mini">SAVE</button>
            </div>
            <div className="dim">
              Live FEC totals use a shared demo key that runs out quickly. Get your own free key in a minute at{' '}
              <a href="https://api.data.gov/signup/" target="_blank" rel="noreferrer">api.data.gov/signup</a>. It’s stored only on this device.
            </div>
            {saved && <div className="setting-ok">{saved}</div>}
          </form>
        </section>}

        <section className="intel-block">
          <h4 className="pixel">▣ DISCLAIMER</h4>
          <p className="brief">
            Project: Midterms (and its Midterms HQ dashboard) is an independent project. It is not affiliated with any campaign, party, forecaster, news organization
            or government agency. Ratings and polls are other organizations’ published views, shown as reported on Wikipedia.
            Results come from Wikipedia’s volunteer-maintained pages and are <b>not official</b>; official results come from each
            state’s election office. Data can be incomplete or wrong; check the linked sources.
          </p>
          <p className="brief dim">Privacy: the app has no accounts, analytics or tracking. Settings and cached data stay on your device.</p>
        </section>

        <section className="intel-block">
          <h4 className="pixel">▣ DATA SOURCES & CREDITS</h4>
          <ul className="credits">
            {SOURCES.map(([what, who, url, lic]) => (
              <li key={what}>
                <b>{what}</b> — <a href={url} target="_blank" rel="noreferrer">{who}</a> <span className="dim">({lic})</span>
              </li>
            ))}
          </ul>
          <p className="brief dim">
            Text and data derived from Wikipedia are available under the{' '}
            <a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noreferrer">Creative Commons Attribution-ShareAlike 4.0</a> license.
            Each race file links to the Wikipedia article it came from.
          </p>
          <p className="brief dim">Open source: {OPEN_SOURCE}</p>
        </section>
      </div>
    </div>
  )
}

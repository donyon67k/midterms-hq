import { useEffect, useRef, useState } from 'react'
import { getFecKey, setFecKey } from '../data/live.js'
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
  ['2024 presidential results by county', 'tonmcg/US_County_Level_Election_Results_08-24', 'https://github.com/tonmcg/US_County_Level_Election_Results_08-24', 'see source'],
]

const OPEN_SOURCE = 'React (MIT) · d3-geo (ISC) · topojson-client (ISC) · Tauri (MIT/Apache-2.0) · Vite (MIT) · Press Start 2P & Share Tech Mono fonts (OFL, bundled)'

export default function About({ open, onClose }) {
  const [key, setKey] = useState('')
  const [saved, setSaved] = useState(null)
  const panel = useRef(null)

  useEffect(() => {
    if (!open) return
    setSaved(null)
    getFecKey().then((k) => setKey(k === 'DEMO_KEY' ? '' : k))
    panel.current?.focus()
  }, [open])

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
            <h2 className="pixel glow">MIDTERMS HQ</h2>
            <div className="dim">
              v{VERSION}{IS_DESKTOP ? ' · desktop' : ' · web'} · <a href={REPO_URL} target="_blank" rel="noreferrer">github.com/donyon67k/midterms-hq</a>
            </div>
          </div>
          <button type="button" className="btn-close" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <section className="intel-block">
          <h4 className="pixel">▣ SETTINGS</h4>
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
        </section>

        <section className="intel-block">
          <h4 className="pixel">▣ DISCLAIMER</h4>
          <p className="brief">
            Midterms HQ is an independent project. It is not affiliated with any campaign, party, forecaster, news organization
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

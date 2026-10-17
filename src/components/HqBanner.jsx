/* global __APP_VERSION__ */
import { useState } from 'react'
import { olderThan } from '../data/control.js'
import { REPO_URL } from '../lib/desktop.js'

const VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0'
const seen = () => { try { return localStorage.getItem('mhq:banner-dismissed') } catch { return null } }

// HQ broadcast from the live control file, plus a nudge when this copy is too old.
export default function HqBanner({ control }) {
  const [dismissed, setDismissed] = useState(seen)
  if (!control) return null
  const outdated = control.minVersion && olderThan(VERSION, control.minVersion)
  const b = control.banner
  const show = b && dismissed !== b.id
  if (!show && !outdated) return null

  const dismiss = () => {
    setDismissed(b.id)
    try { localStorage.setItem('mhq:banner-dismissed', b.id) } catch { /* private mode */ }
  }

  return (
    <>
      {outdated && (
        <div className="hq-banner alert" role="alert">
          <span className="pixel">▲ UPDATE REQUIRED</span>
          <span>This copy is v{VERSION}; HQ needs v{control.minVersion} or newer. Restart the app to update, or download it again.</span>
          <a className="btn-mini" href={`${REPO_URL}/releases/latest`} target="_blank" rel="noreferrer">DOWNLOAD ↗</a>
        </div>
      )}
      {show && (
        <div className={`hq-banner ${b.level}`} role="status">
          <span className="pixel">◆ HQ BROADCAST</span>
          <span>{b.text}</span>
          {b.link && <a className="btn-mini" href={b.link} target="_blank" rel="noreferrer">OPEN ↗</a>}
          <button type="button" className="btn-close" onClick={dismiss} aria-label="Dismiss">✕</button>
        </div>
      )}
    </>
  )
}

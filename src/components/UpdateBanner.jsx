import { useEffect, useState } from 'react'
import { IS_DESKTOP } from '../lib/desktop.js'

const CHECK_EVERY = 6 * 60 * 60 * 1000

// Desktop only: checks GitHub Releases for a newer signed build and installs it in place.
export default function UpdateBanner() {
  const [update, setUpdate] = useState(null)
  const [state, setState] = useState('idle') // idle | downloading | error
  const [progress, setProgress] = useState(0)
  const [hidden, setHidden] = useState(false)

  useEffect(() => {
    if (!IS_DESKTOP) return
    let live = true
    const look = async () => {
      try {
        const { check } = await import('@tauri-apps/plugin-updater')
        const u = await check()
        if (live && u) setUpdate(u)
      } catch { /* offline or no release yet */ }
    }
    look()
    const t = setInterval(look, CHECK_EVERY)
    return () => { live = false; clearInterval(t) }
  }, [])

  if (!update || hidden) return null

  const install = async () => {
    setState('downloading')
    try {
      let total = 0
      let got = 0
      await update.downloadAndInstall((e) => {
        if (e.event === 'Started') total = e.data.contentLength || 0
        if (e.event === 'Progress') { got += e.data.chunkLength; if (total) setProgress(Math.round((got / total) * 100)) }
      })
      const { relaunch } = await import('@tauri-apps/plugin-process')
      await relaunch()
    } catch {
      setState('error')
    }
  }

  return (
    <div className="update-banner" role="status">
      <span className="pixel">▲ UPDATE v{update.version}</span>
      <span className="dim">{update.body?.split('\n')[0] || 'A new version of Midterms HQ is ready.'}</span>
      {state === 'idle' && <button type="button" className="btn-mini" onClick={install}>INSTALL & RESTART</button>}
      {state === 'downloading' && <span className="blink">DOWNLOADING {progress ? `${progress}%` : '…'}</span>}
      {state === 'error' && <span className="err">Update failed. Try again later.</span>}
      {state !== 'downloading' && <button type="button" className="btn-close" onClick={() => setHidden(true)} aria-label="Dismiss">✕</button>}
    </div>
  )
}

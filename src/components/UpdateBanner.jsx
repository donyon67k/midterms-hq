import { useEffect, useState } from 'react'
import { IS_DESKTOP } from '../lib/desktop.js'

const CHECK_EVERY = 60 * 60 * 1000

// Desktop only: finds a newer signed build on GitHub Releases, downloads it in the
// background, then offers a one-click restart to switch over.
export default function UpdateBanner() {
  const [update, setUpdate] = useState(null)
  const [state, setState] = useState('downloading') // downloading | ready | installing | error
  const [hidden, setHidden] = useState(false)

  useEffect(() => {
    if (!IS_DESKTOP) return
    let live = true
    let found = false
    const look = async () => {
      if (found) return
      try {
        const { check } = await import('@tauri-apps/plugin-updater')
        const u = await check()
        if (!live || !u) return
        found = true
        setUpdate(u)
        await u.download()
        if (live) setState('ready')
      } catch {
        found = false // offline or no release yet; try again next round
      }
    }
    look()
    const t = setInterval(look, CHECK_EVERY)
    return () => { live = false; clearInterval(t) }
  }, [])

  if (!update || hidden || state === 'downloading') return null

  const restart = async () => {
    setState('installing')
    try {
      await update.install()
      const { relaunch } = await import('@tauri-apps/plugin-process')
      await relaunch()
    } catch {
      setState('error')
    }
  }

  return (
    <div className="update-banner" role="status">
      <span className="pixel">▲ v{update.version} READY</span>
      <span className="dim">{update.body?.split('\n').find((l) => l.trim() && !/^\*\*download/i.test(l)) || 'A new version of Project: Midterms has been downloaded.'}</span>
      {state === 'ready' && <button type="button" className="btn-mini" onClick={restart}>RESTART TO UPDATE</button>}
      {state === 'installing' && <span className="blink">INSTALLING…</span>}
      {state === 'error' && <span className="err">Update failed. Try again later.</span>}
      {state !== 'installing' && <button type="button" className="btn-close" onClick={() => setHidden(true)} aria-label="Later">✕</button>}
    </div>
  )
}

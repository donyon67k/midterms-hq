import { useState } from 'react'
import { SHARE_DONE, shareCard } from '../lib/shareCard.js'

// "⬇ SHARE CARD": makes the image on click (card() builds the contents then).
export default function ShareButton({ card, filename, label = '⬇ SHARE CARD' }) {
  const [msg, setMsg] = useState('')
  const go = async () => {
    setMsg('…')
    const r = await shareCard(card(), filename).catch(() => 'failed')
    setMsg(SHARE_DONE[r] ?? '')
    setTimeout(() => setMsg(''), 2500)
  }
  return <button type="button" className="btn-mini share-btn" onClick={go} title="Image for social media">{msg || label}</button>
}

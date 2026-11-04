import { IS_DESKTOP } from './desktop.js'

// Share cards: a 1200x630 pixel-style PNG (the size social sites preview), drawn on a canvas.
// card: { kicker, title, big, lines: [], color, foot }
const W = 1200
const H = 630
const SITE = 'PROJECT: MIDTERMS'

function fit(ctx, text, max, size, min = 18) {
  let s = size
  ctx.font = `${s}px "Press Start 2P", monospace`
  while (s > min && ctx.measureText(text).width > max) { s -= 2; ctx.font = `${s}px "Press Start 2P", monospace` }
  return s
}

export async function drawCard({ kicker, title, big, lines = [], color = '#ffd700', foot = 'Unofficial until certified' }) {
  try { await document.fonts?.load('20px "Press Start 2P"') } catch { /* system font fallback */ }
  const c = document.createElement('canvas')
  c.width = W
  c.height = H
  const ctx = c.getContext('2d')
  ctx.imageSmoothingEnabled = false
  ctx.fillStyle = '#050510'
  ctx.fillRect(0, 0, W, H)
  // scanlines + frame
  ctx.fillStyle = 'rgba(0,255,65,0.05)'
  for (let y = 0; y < H; y += 4) ctx.fillRect(0, y, W, 1)
  ctx.fillStyle = color
  ctx.fillRect(0, 0, W, 12)
  ctx.fillRect(0, H - 12, W, 12)
  ctx.strokeStyle = '#00ff41'
  ctx.lineWidth = 4
  ctx.strokeRect(28, 36, W - 56, H - 72)

  ctx.textBaseline = 'top'
  ctx.textAlign = 'center'
  ctx.fillStyle = '#ffd700'
  fit(ctx, kicker, W - 120, 26)
  ctx.fillText(kicker, W / 2, 80)
  ctx.fillStyle = '#ffffff'
  fit(ctx, title, W - 120, 40)
  ctx.fillText(title, W / 2, 140)
  if (big) {
    ctx.fillStyle = color
    fit(ctx, big, W - 120, 64, 24)
    ctx.fillText(big, W / 2, 230)
  }
  ctx.fillStyle = '#c8ffc8'
  lines.slice(0, 4).forEach((l, i) => {
    fit(ctx, l, W - 140, 22, 14)
    ctx.fillText(l, W / 2, 340 + i * 44)
  })
  ctx.fillStyle = '#5f9a5f'
  ctx.font = '16px "Press Start 2P", monospace'
  ctx.textAlign = 'left'
  ctx.fillText(SITE, 60, H - 92)
  ctx.textAlign = 'right'
  ctx.fillText(foot, W - 60, H - 92)
  return new Promise((ok) => c.toBlob(ok, 'image/png'))
}

// Share (phones), copy (desktop app), or download (browsers). Returns what happened.
export async function shareCard(card, filename = 'midterms-hq.png') {
  const blob = await drawCard(card)
  if (!blob) return 'failed'
  const file = typeof File !== 'undefined' ? new File([blob], filename, { type: 'image/png' }) : null
  try {
    if (file && navigator.canShare?.({ files: [file] }) && matchMedia('(pointer: coarse)').matches) {
      await navigator.share({ files: [file], title: card.title })
      return 'shared'
    }
  } catch (e) { if (e?.name === 'AbortError') return 'cancelled' }
  if (IS_DESKTOP) {
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
      return 'copied'
    } catch { /* fall through to download */ }
  }
  const url = URL.createObjectURL(blob)
  const a = Object.assign(document.createElement('a'), { href: url, download: filename })
  document.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 5000)
  return 'downloaded'
}

export const SHARE_DONE = { shared: 'SHARED ✓', copied: 'IMAGE COPIED ✓', downloaded: 'SAVED ✓', failed: 'COULD NOT MAKE IMAGE', cancelled: '' }

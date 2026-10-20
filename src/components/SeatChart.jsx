import { useMemo, useState } from 'react'
import { STATES } from '../data/wiki.js'
import { RATING_COLORS, raceTitle, resultColor } from '../lib/util.js'
import { Icon } from './Sprites.jsx'

const NOT_UP = { D: '#16307a', R: '#6e0d14' }

// Every seat in a chamber as one dot, ordered from most Democratic (left) to most
// Republican (right). Seats not on the ballot sit at the far ends.
function seatsFor(races, now, results) {
  const upD = races.filter((r) => r.incumbent?.party !== 'R').length
  const upR = races.length - upD
  const held = now ? { D: Math.max(0, now.D - upD), R: Math.max(0, now.R - upR) } : { D: 0, R: 0 }
  const seats = []
  for (let i = 0; i < held.D; i++) seats.push({ order: -9, color: NOT_UP.D, label: 'Democratic seat · not up in 2026', notUp: true })
  for (let i = 0; i < held.R; i++) seats.push({ order: 9, color: NOT_UP.R, label: 'Republican seat · not up in 2026', notUp: true })
  for (const r of races) {
    const name = raceTitle(r, STATES)
    if (results) {
      const p = r.result?.party
      seats.push({ race: r, order: p === 'D' ? -4 : p === 'R' ? 4 : p ? -3.5 : (r.consensus?.score ?? 0) / 10, color: resultColor(r.result), label: `${name} · ${r.result ? `${r.result.winner} (${p})${r.result.flip ? ' · FLIP' : ''}` : 'awaiting call'}` })
    } else {
      const label = r.consensus?.label || 'Tossup'
      seats.push({ race: r, order: r.consensus?.score ?? 0, color: RATING_COLORS[label] || RATING_COLORS.Tossup, label: `${name} · ${label}` })
    }
  }
  return seats.sort((a, b) => a.order - b.order)
}

// Parliament-style half circle: rows of dots, filled left to right by angle.
function layout(n, rows) {
  const R = 100
  const r0 = R * 0.42
  const radii = Array.from({ length: rows }, (_, i) => r0 + ((R - r0) * i) / Math.max(1, rows - 1))
  const total = radii.reduce((a, b) => a + b, 0)
  const per = radii.map((r) => Math.max(1, Math.round((n * r) / total)))
  per[rows - 1] += n - per.reduce((a, b) => a + b, 0)
  const pts = []
  radii.forEach((r, i) => {
    for (let j = 0; j < per[i]; j++) {
      const a = Math.PI - (Math.PI * j) / Math.max(1, per[i] - 1)
      pts.push({ x: 110 + r * Math.cos(a), y: 106 - r * Math.sin(a), a, r })
    }
  })
  pts.sort((p, q) => q.a - p.a || p.r - q.r)
  const gap = (R - r0) / Math.max(1, rows - 1)
  const arc = (Math.PI * R) / per[rows - 1]
  return { pts, dot: Math.min(gap, arc) * 0.42, r0 }
}

const ROWS = (n) => (n > 300 ? 11 : n > 80 ? 6 : 4)
const GAP = 6 // dx between the three tallies, in SVG units

// Largest font (max 9 units) that keeps the three tallies inside the arc's empty middle.
// Press Start 2P glyphs are 1em wide, so the width is just digits + gaps.
function tallySize(text, r0, dot) {
  const room = 2 * (r0 - dot * 1.6) * 0.92
  return Math.min(9, (room - 2 * GAP) / text.length)
}

export function SeatChart({ label, icon, races, now, results, need, onPick, wide }) {
  const seats = useMemo(() => seatsFor(races, now, results), [races, now, results])
  const { pts, dot, r0 } = useMemo(() => layout(seats.length, ROWS(seats.length)), [seats.length])
  const [hover, setHover] = useState(null)
  const count = (pred) => seats.filter(pred).length
  const d = count((s) => (results ? s.color === resultColor({ party: 'D' }) || (s.notUp && s.order < 0) : s.order < -0.35))
  const r = count((s) => (results ? s.color === resultColor({ party: 'R' }) || (s.notUp && s.order > 0) : s.order > 0.35))
  const mid = seats.length - d - r
  const size = tallySize(`${d}${mid}${r}`, r0, dot)
  return (
    <div className={`seat-chart ${wide ? 'wide' : ''}`}>
      <div className="power-head">
        <Icon name={icon} size={16} /> <span className="pixel">{label}</span>
        <span className="dim">{need}</span>
      </div>
      <svg viewBox="0 0 220 112" className="seat-svg" role="img" aria-label={`${label}: Democrats ${d}, ${results ? 'uncalled' : 'tossup'} ${mid}, Republicans ${r}`}>
        <line x1="110" y1="2" x2="110" y2="64" className="seat-majority" />
        {pts.map((p, i) => {
          const s = seats[i]
          if (!s) return null
          return (
            <circle
              key={i}
              cx={p.x}
              cy={p.y}
              r={hover === i ? dot * 1.5 : dot}
              fill={s.color}
              className={`seat ${s.notUp ? 'not-up' : ''} ${s.race ? 'live' : ''}`}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
              onClick={() => s.race && onPick(s.race)}
            >
              <title>{s.label}</title>
            </circle>
          )
        })}
        <text x="110" y="104" textAnchor="middle" className="seat-big" style={{ fontSize: size }}>
          <tspan className="party-d-fill">{d}</tspan>
          <tspan className="seat-mid-fill" dx={GAP}>{mid}</tspan>
          <tspan className="party-r-fill" dx={GAP}>{r}</tspan>
        </text>
      </svg>
      <div className="seat-hover">{hover != null && seats[hover] ? seats[hover].label : <span className="dim"><span className="hover-only">Hover a seat · click to open its race</span><span className="touch-only">Tap a seat to open its race</span></span>}</div>
    </div>
  )
}

export function SeatLegend({ results }) {
  const keys = results
    ? [['D won', resultColor({ party: 'D' })], ['Awaiting', resultColor(null)], ['R won', resultColor({ party: 'R' })]]
    : Object.entries(RATING_COLORS)
  return (
    <div className="seat-legend">
      <span><i style={{ background: NOT_UP.D }} /><i style={{ background: NOT_UP.R }} /> not up</span>
      {keys.map(([k, c]) => <span key={k}><i style={{ background: c }} />{k}</span>)}
      <span className="dim">│ line = majority</span>
    </div>
  )
}

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { geoPath } from 'd3-geo'
import { feature } from 'topojson-client'
import topo from 'us-atlas/states-albers-10m.json'
import { NAME_TO_ABBR, STATES } from '../data/wiki.js'
import { districtLabel } from '../lib/util.js'
import { StateDetailLayer, focusBox, useStateDetail } from './StateMap.jsx'

const geo = feature(topo, topo.objects.states)
const path = geoPath()
const SHAPES = geo.features
  .map((f) => ({ abbr: NAME_TO_ABBR[f.properties.name], d: path(f), c: path.centroid(f), area: path.area(f) }))
  .filter((s) => s.abbr)

// Small eastern states get their label pulled out to the Atlantic.
const CALLOUTS = { VT: [880, 70], NH: [905, 100], MA: [930, 140], RI: [935, 175], CT: [930, 205], NJ: [915, 240], DE: [905, 275], MD: [890, 305] }

const HOME = [-10, -10, 995, 630]
const ZOOM_MS = 700

// Smoothly glide the SVG viewBox toward `target`.
function useCamera(target) {
  const [vb, setVb] = useState(target)
  const from = useRef(target)
  const key = target.map((n) => n.toFixed(2)).join(' ')
  useEffect(() => {
    const start = from.current
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    let raf
    const t0 = performance.now()
    const step = (now) => {
      const p = reduce ? 1 : Math.min(1, (now - t0) / ZOOM_MS)
      const e = p < 0.5 ? 4 * p * p * p : 1 - (-2 * p + 2) ** 3 / 2
      const next = start.map((v, i) => v + (target[i] - v) * e)
      from.current = next
      setVb(next)
      if (p < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return vb
}

function useSize(ref) {
  const [size, setSize] = useState([800, 500])
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setSize([e.contentRect.width || 1, e.contentRect.height || 1]))
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref])
  return size
}

export default function UsMap({ fills, blips = {}, selected, onSelect, labels = {}, zoom, results }) {
  const [hover, setHover] = useState(null)
  const [detailHover, setDetailHover] = useState(null)
  const [mouse, setMouse] = useState([0, 0])
  const wrap = useRef(null)
  const [w, h] = useSize(wrap)

  const zoomed = !!selected && !!zoom
  const detail = useStateDetail(zoomed ? selected : null, zoom?.layer, zoom?.house)

  // Camera target: padded box around the state (or focused district), matched to panel aspect.
  let target = HOME
  const box = zoomed && focusBox(detail, zoom.district)
  if (box) {
    const [[x0, y0], [x1, y1]] = box
    let bw = (x1 - x0) * 1.15
    let bh = (y1 - y0) * 1.15
    if (bw / bh > w / h) bh = bw * (h / w)
    else bw = bh * (w / h)
    target = [(x0 + x1) / 2 - bw / 2, (y0 + y1) / 2 - bh / 2, bw, bh]
  }
  const vb = useCamera(target)
  const k = Math.max(vb[2] / w, vb[3] / h) // map units per screen pixel
  const z = (HOME[2] / vb[2]) // zoom factor vs. national view

  const tipBody = detailHover
    ? <><div className="pixel" style={{ fontSize: 9 }}>{detailHover.title}</div>{detailHover.sub && <div>{detailHover.sub}</div>}</>
    : hover && <><div className="pixel" style={{ fontSize: 9 }}>{STATES[hover]}</div><div>{labels[hover] || 'NO ACTIVE OPERATION'}</div></>
  const tip = tipBody && <div className="map-tip" style={{ left: mouse[0] + 14, top: mouse[1] + 10 }}>{tipBody}</div>

  const handlers = (abbr) => ({
    onMouseEnter: () => setHover(abbr),
    onMouseLeave: () => setHover(null),
    onClick: () => onSelect(abbr),
    onKeyDown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(abbr) } },
    tabIndex: 0,
    role: 'button',
    'aria-label': `${STATES[abbr]}: ${labels[abbr] || 'no race'}`,
  })

  const onMove = (e) => {
    const r = e.currentTarget.getBoundingClientRect()
    setMouse([e.clientX - r.left, e.clientY - r.top])
  }

  const focusedDistrict = zoomed && zoom.district && detail.districts.find((s) => s.race?.key === zoom.district)

  return (
    <div className="map-wrap" onMouseMove={onMove} ref={wrap}>
        <svg viewBox={vb.join(' ')} className={`map-svg ${zoomed ? 'zoomed' : ''}`} preserveAspectRatio="xMidYMid meet">
          <defs>
            <pattern id="pixgrid" width={6 * Math.min(1, k * 1.2)} height={6 * Math.min(1, k * 1.2)} patternUnits="userSpaceOnUse">
              <rect width={6 * Math.min(1, k * 1.2)} height={6 * Math.min(1, k * 1.2)} fill="none" stroke="rgba(0,0,0,0.35)" strokeWidth={k} />
            </pattern>
            <filter id="glow" filterUnits="userSpaceOnUse" x={vb[0]} y={vb[1]} width={vb[2]} height={vb[3]}>
              <feGaussianBlur stdDeviation={3 * k} result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
          </defs>
          {SHAPES.map((s) => (
            <path
              key={s.abbr}
              d={s.d}
              fill={fills[s.abbr] || '#0c1626'}
              className={`state ${selected === s.abbr ? 'sel' : ''} ${hover === s.abbr ? 'hov' : ''} ${zoomed && selected !== s.abbr ? 'dimmed' : ''}`}
              {...handlers(s.abbr)}
            />
          ))}
          <rect x={vb[0]} y={vb[1]} width={vb[2]} height={vb[3]} fill="url(#pixgrid)" pointerEvents="none" />

          {zoomed && (
            <StateDetailLayer
              abbr={selected}
              detail={detail}
              k={k}
              results={results}
              district={zoom.district}
              onPickDistrict={zoom.onPickDistrict}
              setHover={setDetailHover}
              hoverId={detailHover?.id}
            />
          )}
          {!zoomed && selected && SHAPES.find((s) => s.abbr === selected) && (
            <path d={SHAPES.find((s) => s.abbr === selected).d} className="state-sel-outline" filter="url(#glow)" pointerEvents="none" />
          )}

          {SHAPES.map((s) => {
            if (zoomed && s.abbr === selected) return null
            const call = !zoomed && CALLOUTS[s.abbr]
            const [x, y] = call || s.c
            const big = s.area * z * z > 1800
            return (
              <g key={`l-${s.abbr}`} pointerEvents="none" className={zoomed ? 'dimmed-label' : ''}>
                {call && <line x1={s.c[0]} y1={s.c[1]} x2={x - 10} y2={y - 4} className="callout" />}
                {(big || call) && <text x={x} y={y} className="state-label" style={{ fontSize: 9 * k, strokeWidth: 3 * k }} textAnchor={call ? 'start' : 'middle'}>{s.abbr}</text>}
                {!zoomed && blips[s.abbr] && <circle cx={s.c[0] + (call ? 0 : 12)} cy={s.c[1] - (call ? 0 : 10)} r="6" className="blip" />}
              </g>
            )
          })}
        </svg>

      {zoomed && (
        <div className="zoom-hud">
          <button type="button" className="btn-mini" onClick={() => onSelect(null)} title="Zoom back out (Esc)">◀ USA</button>
          <span className="sm-toggle" role="group" aria-label="Map layer">
            <button type="button" className={zoom.layer === 'counties' ? 'on' : ''} aria-pressed={zoom.layer === 'counties'} onClick={() => zoom.setLayer('counties')}>COUNTIES</button>
            <button type="button" className={zoom.layer === 'districts' ? 'on' : ''} aria-pressed={zoom.layer === 'districts'} disabled={!zoom.house?.length} onClick={() => zoom.setLayer('districts')}>
              {zoom.house?.length > 1 ? 'DISTRICTS' : 'AT-LARGE'}
            </button>
          </span>
        </div>
      )}
      {zoomed && (
        <div className="zoom-status">
          {detail.showDistricts
            ? `${detail.districts.length === 1 ? 'AT-LARGE DISTRICT' : `${detail.districts.length} DISTRICTS`} · 2026 LINES${focusedDistrict ? ` · ZOOM ${districtLabel(selected, focusedDistrict.n)}` : ''}`
            : `${detail.countyShapes.length} ${selected === 'LA' ? 'PARISHES' : selected === 'AK' ? 'BOROUGHS / AREAS' : 'COUNTIES'} · SHADED BY 2024 PRESIDENTIAL MARGIN`}
          {detail.loading && <span className="blink"> · ACQUIRING TERRAIN…</span>}
          {detail.error && <span className="sm-err"> · DISTRICT FEED DOWN ({detail.error})</span>}
        </div>
      )}
      {!zoomed && <div className="radar-sweep" aria-hidden="true" />}
      {tip}
    </div>
  )
}

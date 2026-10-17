import { useEffect, useMemo, useState } from 'react'
import { geoAlbersUsa, geoArea, geoPath } from 'd3-geo'
import { feature, mesh } from 'topojson-client'
import states from 'us-atlas/states-albers-10m.json'
import { NAME_TO_ABBR } from '../data/wiki.js'
import { districtShapes } from '../data/live.js'
import { districtLabel, fmtMargin, hash, incLabel, marginColor, ratingColor, resultColor } from '../lib/util.js'

// States/counties ship pre-projected (Albers USA, scale 1300) in the same space
// as the national map. District boundaries come back in lon/lat, so we project
// them with identical settings and everything overlays exactly.
const planar = geoPath()
const projected = geoPath(geoAlbersUsa().scale(1300).translate([487.5, 305]))

export const STATE_GEO = Object.fromEntries(
  feature(states, states.objects.states).features
    .filter((f) => NAME_TO_ABBR[f.properties.name])
    .map((f) => [NAME_TO_ABBR[f.properties.name], { fips: f.id, d: planar(f), bounds: planar.bounds(f) }]),
)

// The county map (~800 KB) and 2024 county results load on first zoom, not at startup.
let countyData
const loadCounties = () => (countyData ||= Promise.all([
  import('us-atlas/counties-albers-10m.json'),
  import('../data/county2024.json'),
]).then(([t, r]) => ({ topo: t.default, features: feature(t.default, t.default.objects.counties).features, results: r.default })))

// ArcGIS emits RFC 7946 (counter-clockwise) rings; d3 wants clockwise on the sphere.
function rewind(f) {
  const fix = (poly) => (geoArea({ type: 'Polygon', coordinates: poly }) > 2 * Math.PI ? poly.map((r) => [...r].reverse()) : poly)
  const g = f.geometry
  const coordinates = g.type === 'Polygon' ? fix(g.coordinates) : g.coordinates.map(fix)
  return { ...f, geometry: { ...g, coordinates } }
}

const districtNum = (cd) => (cd === '00' || cd === '98' ? 'AL' : +cd)
const countyWord = (abbr) => (abbr === 'LA' ? ' Parish' : abbr === 'AK' ? '' : ' County')
const fmtVotes = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}K` : String(n))

// Loads and projects the selected state's counties and (when asked) districts.
export function useStateDetail(abbr, layer, house) {
  const geo = abbr ? STATE_GEO[abbr] : null
  const [counties, setCounties] = useState(null)
  const [fetched, setFetched] = useState({ fips: null, list: null, error: null })
  const wantDistricts = layer === 'districts' && !!geo

  useEffect(() => {
    if (!geo || counties) return
    let live = true
    loadCounties().then((c) => live && setCounties(c))
    return () => { live = false }
  }, [geo, counties])

  useEffect(() => {
    if (!wantDistricts || fetched.fips === geo.fips) return
    let live = true
    districtShapes(geo.fips)
      .then((list) => live && setFetched({ fips: geo.fips, list, error: null }))
      .catch((e) => live && setFetched({ fips: geo.fips, list: null, error: e.message }))
    return () => { live = false }
  }, [wantDistricts, geo, fetched.fips])

  const countyShapes = useMemo(() => {
    if (!geo || !counties) return []
    return counties.features.filter((f) => String(f.id).startsWith(geo.fips)).map((f) => {
      const r = counties.results[f.id]
      return {
        id: f.id,
        name: `${f.properties.name}${countyWord(abbr)}`,
        d: planar(f),
        fill: r ? marginColor(r[0], r[1]) : '#1a2230',
        sub: r ? `2024 PRES: ${fmtMargin(r[0], r[1])} · ${fmtVotes(r[2])} votes` : '2024 county results not available',
        // slight per-county brightness jitter keeps the 8-bit texture
        shade: 0.78 + (hash(f.id) % 4) * 0.05,
      }
    })
  }, [geo, abbr, counties])

  const countyLines = useMemo(() => {
    if (!geo || !counties) return ''
    const inState = (o) => String(o.id).startsWith(geo.fips)
    return planar(mesh(counties.topo, counties.topo.objects.counties, (a, b) => a !== b && inState(a) && inState(b)))
  }, [geo, counties])

  const byDistrict = useMemo(() => Object.fromEntries((house || []).map((r) => [String(r.district), r])), [house])
  const list = geo && fetched.fips === geo.fips ? fetched.list : null
  const districts = useMemo(() => (list || []).map((f) => {
    const g = rewind(f)
    const n = districtNum(f.properties.CD120)
    return { n, d: projected(g), c: projected.centroid(g), area: projected.area(g), bounds: projected.bounds(g), race: byDistrict[String(n)] }
  }), [list, byDistrict])

  return {
    geo,
    countyShapes,
    countyLines,
    districts,
    showDistricts: wantDistricts && districts.length > 0,
    loading: (!!geo && !counties) || (wantDistricts && !list && !(fetched.fips === geo?.fips && fetched.error)),
    error: wantDistricts && fetched.fips === geo?.fips ? fetched.error : null,
  }
}

function districtSub(race, results) {
  if (!race) return 'No race data'
  if (results && race.result) return `CALLED: ${race.result.winner} (${race.result.party})${race.result.pct ? ` ${race.result.pct}%` : ''}${race.result.flip ? ' · FLIP' : ''}`
  return `${incLabel(race.incumbent)} · ${race.consensus?.label || 'unrated'}${results ? ' · AWAITING CALL' : ''}`
}

// SVG layer drawn inside the national map, on top of the selected state.
// k = map units per screen pixel (shrinks as we zoom in) so text stays readable.
export function StateDetailLayer({ abbr, detail, k, results, district, onPickDistrict, setHover, hoverId }) {
  const { geo, countyShapes, countyLines, districts, showDistricts } = detail
  if (!geo) return null

  return (
    <g className="detail-layer">
      <clipPath id="detail-clip"><path d={geo.d} /></clipPath>
      <path d={geo.d} fill="#050a14" />
      {!showDistricts && (
        <g>
          {countyShapes.map((c) => (
            <path
              key={c.id}
              d={c.d}
              fill={c.fill}
              fillOpacity={hoverId === c.id ? 1 : c.shade}
              className={`county ${hoverId === c.id ? 'hov' : ''}`}
              onMouseEnter={() => setHover({ id: c.id, title: c.name, sub: c.sub })}
              onMouseLeave={() => setHover(null)}
            />
          ))}
          <path d={countyLines} className="sm-county-line" />
        </g>
      )}
      {showDistricts && (
        <g clipPath="url(#detail-clip)">
          {districts.map((s) => {
            const pick = () => s.race && onPickDistrict(s.race.key)
            return (
              <path
                key={s.n}
                d={s.d}
                fill={results ? resultColor(s.race?.result) : ratingColor(s.race?.consensus?.label)}
                className={`sm-district ${district === s.race?.key ? 'sel' : ''} ${hoverId === s.n ? 'hov' : ''}`}
                onMouseEnter={() => setHover({ id: s.n, title: districtLabel(abbr, s.n), sub: districtSub(s.race, results) })}
                onMouseLeave={() => setHover(null)}
                onClick={pick}
                tabIndex={s.race ? 0 : -1}
                role={s.race ? 'button' : undefined}
                aria-label={`${districtLabel(abbr, s.n)}: ${districtSub(s.race, results)}`}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick() } }}
              />
            )
          })}
          {districts.length > 1 && districts.map((s) => {
            const w = (s.bounds[1][0] - s.bounds[0][0]) / k
            const h = (s.bounds[1][1] - s.bounds[0][1]) / k
            return w > 22 && h > 14 && (
              <text key={`t${s.n}`} x={s.c[0]} y={s.c[1]} className="sm-label" style={{ fontSize: 11 * k, strokeWidth: 3 * k }} textAnchor="middle" dominantBaseline="middle">
                {s.n}
              </text>
            )
          })}
        </g>
      )}
      <path d={geo.d} className="sm-outline" pointerEvents="none" />
    </g>
  )
}

// Box the camera should frame: the whole state, or a small district inside it.
export function focusBox(detail, district) {
  const { geo, districts, showDistricts } = detail
  if (!geo) return null
  const [[x0, y0], [x1, y1]] = geo.bounds
  const focus = showDistricts && district && districts.find((s) => s.race?.key === district)
  if (focus && focus.area < (x1 - x0) * (y1 - y0) * 0.2) {
    const [[a, b], [c, d]] = focus.bounds
    const span = Math.max(c - a, d - b, 12) * 1.8
    const cx = (a + c) / 2
    const cy = (b + d) / 2
    return [[cx - span / 2, cy - span / 2], [cx + span / 2, cy + span / 2]]
  }
  return geo.bounds
}

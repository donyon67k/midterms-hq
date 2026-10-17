import { hash } from '../lib/util.js'

// Renders an ASCII pixel grid as crisp SVG rects. '.' is transparent.
export function Pixel({ grid, palette, size = 32, className, title }) {
  const rows = grid.trim().split('\n').map((r) => r.trim())
  const h = rows.length
  const w = Math.max(...rows.map((r) => r.length))
  const rects = []
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const c = palette[row[x]]
      if (c) rects.push(<rect key={`${x}-${y}`} x={x} y={y} width={1.02} height={1.02} fill={c} />)
    }
  })
  return (
    <svg className={className} width={size} height={(size * h) / w} viewBox={`0 0 ${w} ${h}`} shapeRendering="crispEdges" role="img" aria-label={title}>
      {title && <title>{title}</title>}
      {rects}
    </svg>
  )
}

const DONKEY = `
..........kk...
.........kbbk..
........kbbbk..
..kkkkkkkbbbbk.
.kbbbbbbbbbwbbk
kbbbbbbbbbbbbbk
.kbbbbbbbbbkkk.
..kbbbbbbbbk...
..kbk.kbk.kbk..
..kbk.kbk.kbk..
..kk..kk..kk...`

const ELEPHANT = `
...kkkkkk......
..krrrrrrk.....
.krrrrrrrrkk...
krrwrrrrrrrrk..
krrrrrrrrrrrrk.
.krrrrrrrrrrrk.
.kkrrrrrrrrrk.k
.k.krrrrrrrk.kk
...krk.krk.krk.
...krk.krk.krk.
...kk..kk..kk..`

const STAR = `
.....k.....
....kyk....
....kyk....
kkkkyyykkkk
.kyyyyyyyk.
..kyyyyyk..
..kyykyyk..
.kyk...kyk.
.kk.....kk.`

export function PartySprite({ party, size = 28 }) {
  if (party === 'D') return <Pixel grid={DONKEY} palette={{ k: '#0a1a44', b: '#4488ff', w: '#fff' }} size={size} title="Democratic" />
  if (party === 'R') return <Pixel grid={ELEPHANT} palette={{ k: '#3a0808', r: '#ff4444', w: '#fff' }} size={size} title="Republican" />
  return <Pixel grid={STAR} palette={{ k: '#220833', y: party === 'L' ? '#ffd700' : party === 'G' ? '#33dd66' : '#bb44ff' }} size={size * 0.8} title="Independent / third party" />
}

export const ICONS = {
  senate: `
......gg......
.....gggg.....
....gggggg....
...gggggggg...
..gggggggggg..
.gggggggggggg.
gggggggggggggg
.g.g.g..g.g.g.
.g.g.g..g.g.g.
.g.g.g..g.g.g.
gggggggggggggg`,
  governor: `
.......g.......
......ggg......
.....ggggg.....
....ggggggg....
...ggggggggg...
..ggggggggggg..
.ggggggggggggg.
..g.g.ggg.g.g..
..g.g.g.g.g.g..
..g.g.g.g.g.g..
.ggggggggggggg.`,
  house: `
gggggggggggggg
g............g
g.gg.gg.gg.gg.g
g............g
g.gg.gg.gg.gg.g
g............g
g.gg.gg.gg.gg.g
g............g
gggggggggggggg`,
  measures: `
.gggggggggg..
g..........g.
g.gggggg...g.
g..........g.
g.ggggggg..g.
g..........g.
g.ggggg....g.
g..........g.
.gggggggggg..`,
  radar: `
....gggggg....
..gg......gg..
.g...gggg...g.
g...g....g...g
g..g..gg..g..g
g..g.gggg.g..g
g...g.gg.g...g
.g...gggg...g.
..gg......gg..
....gggggg....`,
}

export function Icon({ name, size = 18, color = '#00ff41' }) {
  return <Pixel grid={ICONS[name]} palette={{ g: color }} size={size} />
}

// Procedurally generated 8-bit "agent" avatar used when no photo is available.
export function AgentSprite({ name = '', party, size = 64 }) {
  const h = hash(name)
  const suit = { D: '#2a5bd8', R: '#d83232', L: '#c9a800', G: '#2aa84f' }[party] || '#8a2ad8'
  // Hologram-style: one neutral tint so the sprite never guesses at a real person's looks.
  const hair = ['#1d3a2a', '#2c5a40', '#0f2a1c'][h % 3]
  const skin = '#9fe8b8'
  const glasses = (h >> 6) % 3 === 0
  const hat = (h >> 8) % 5 === 0
  const grid = `
${hat ? '...hhhhhh...' : '............'}
${hat ? '..hhhhhhhh..' : '...HHHHHH...'}
..HHHHHHHH..
..HssssssH..
..s${glasses ? 'kkskks' : 'ekssek'}s..
..ssssssss..
...ssmmss...
....ssss....
..TTTwwTTT..
.TTTTtwTTTT.
.TTTTtwTTTT.
.TTTTTTTTTT.`
  return (
    <Pixel
      grid={grid}
      palette={{ h: '#111', H: hair, s: skin, e: '#111', k: '#111', m: '#2c5a40', T: suit, w: '#fff', t: '#ffd700' }}
      size={size}
      title={name}
    />
  )
}

// Wikitext parsing for MIDTERMS HQ.
// Pure functions with no DOM access so the same code runs in the browser
// (live refresh) and in Node (scripts/build-data.mjs snapshot builder).

export const STATES = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California',
  CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', FL: 'Florida', GA: 'Georgia',
  HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa',
  KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland',
  MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri',
  MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey',
  NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio',
  OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina',
  SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont',
  VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
}
export const NAME_TO_ABBR = Object.fromEntries(Object.entries(STATES).map(([k, v]) => [v, k]))

export const PAGES = {
  senate: '2026_United_States_Senate_elections',
  governor: '2026_United_States_gubernatorial_elections',
  house: '2026_United_States_House_of_Representatives_elections',
  houseRatings: '2026_United_States_House_of_Representatives_election_ratings',
  measures: '2026_United_States_ballot_measures',
}

// ---------- low-level text helpers ----------

function stripRefs(s) {
  return s
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<ref\b[^>]*\/>/gi, '') // self-closing, even when the name has a slash ("20/20 Insight")
    .replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, '')
}

// Replace innermost templates repeatedly so nesting resolves inside-out.
function expandTemplates(s) {
  let prev
  let guard = 0
  do {
    prev = s
    s = s.replace(/\{\{([^{}]*)\}\}/g, (_, body) => renderTemplate(body))
  } while (s !== prev && ++guard < 12)
  return s
}

function renderTemplate(body) {
  // split on pipes, but not the one inside a [[link|label]]
  const parts = body.split(/\|(?![^[]*\]\])/).map((p) => p.trim())
  const name = parts[0].toLowerCase().replace(/_/g, ' ')
  const args = parts.slice(1).filter((p) => !/^\w+\s*=/.test(p))
  if (name === 'sortname') return `${args[0] || ''} ${args[1] || ''}`.trim()
  if (name === 'nbsp' || name === 'snd' || name === 'spaced ndash') return ' '
  if (name === 'sdash' || name === 'ndash' || name === 'mdash' || name === 'n/a') return '–'
  if (['small', 'nowrap', 'nobr', 'big', 'abbr', 'tooltip', 'lang', 'nowrap begin'].includes(name)) return args[0] || ''
  if (name === 'ushr') return `${args[0]}-${args[1]}`
  if (name === 'shading pvi') return args[0] === 'EVEN' || args[0] === 'E' ? 'EVEN' : `${args[0]}+${args[1]}`
  if (name === 'usraceraterating' || name === 'usracerating') return `§R:${args.join('/')}§`
  if (name.startsWith('party stripe')) {
    const p = (args[0] || '').toLowerCase()
    return `§P:${p.includes('democrat') ? 'D' : p.includes('republican') ? 'R' : p.includes('libertarian') ? 'L' : p.includes('green') ? 'G' : 'I'}§`
  }
  if (name === 'plainlist' || name === 'endplainlist' || name === 'unbulleted list') return args.join('\n')
  if (name === 'efn' || name.startsWith('efn') || name === 'clear' || name === 'sticky header' || name.startsWith('cite') || name.startsWith('#invoke')) return ''
  if (name.startsWith('party shading/text/')) return cap(name.split('/')[2] || '')
  if (name.startsWith('party shading') || name.startsWith('party color') || name === 'hold' || name === 'loss') return ''
  if (name === 'percentage') return args[0] || ''
  if (name === 'flag' || name === 'flagu') return args[0] || ''
  return args[0] || ''
}

export function clean(s = '') {
  return expandTemplates(stripRefs(s))
    .replace(/\[\[(?:File|Image):[^\]]*\]\]/gi, '')
    .replace(/\[\[([^|\]]*)\|([^\]]*)\]\]/g, '$2')
    .replace(/\[\[([^\]]*)\]\]/g, '$1')
    .replace(/\[https?:\/\/\S+\s([^\]]+)\]/g, '$1')
    .replace(/'{2,}/g, '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<wbr\s*\/?>/gi, '')
    .replace(/<\/?[a-z][^>]*>/gi, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/§[RP]:[^§]*§/g, '')
    .replace(/[ \t]+/g, ' ')
    .trim()
}

// Keep rating/party markers produced by renderTemplate so callers can read them.
function cleanKeepMarkers(s = '') {
  return expandTemplates(stripRefs(s))
    .replace(/\[\[([^|\]]*)\|([^\]]*)\]\]/g, '$2')
    .replace(/\[\[([^\]]*)\]\]/g, '$1')
    .replace(/'{2,}/g, '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/?[a-z][^>]*>/gi, '')
    .trim()
}

function firstLink(s = '') {
  const m = stripRefs(s).match(/\[\[([^|\]#]+)(?:\|[^\]]*)?\]\]/)
  return m ? m[1].trim() : null
}

// ---------- sections & tables ----------

export function section(text, heading, level = null) {
  const lines = text.split('\n')
  const re = new RegExp(`^(={2,6})\\s*${heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\1\\s*$`)
  let start = -1
  let depth = 0
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(re)
    if (m && (level == null || m[1].length === level)) { start = i; depth = m[1].length; break }
  }
  if (start < 0) return ''
  const out = []
  for (let i = start + 1; i < lines.length; i++) {
    const m = lines[i].match(/^(={2,6})[^=].*\1\s*$/)
    if (m && m[1].length <= depth) break
    out.push(lines[i])
  }
  return out.join('\n')
}

export function headings(text, level) {
  const re = new RegExp(`^={${level}}\\s*([^=].*?)\\s*={${level}}\\s*$`, 'gm')
  return [...text.matchAll(re)].map((m) => m[1])
}

// Split a cell like `style="x" | content` into its content, ignoring pipes inside [[ ]] / {{ }}.
function cellContent(raw) {
  let depth = 0
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i]
    const n = raw[i + 1]
    if ((c === '[' && n === '[') || (c === '{' && n === '{')) { depth++; i++; continue }
    if ((c === ']' && n === ']') || (c === '}' && n === '}')) { depth--; i++; continue }
    if (c === '|' && depth === 0 && n !== '|') {
      const attr = raw.slice(0, i)
      // Only treat as attribute separator if the left side looks like html attrs or a shading template.
      if (/^\s*(\{\{[^}]*\}\}\s*)*([a-z-]+\s*=|\{\{|$)/i.test(attr) && !/\[\[/.test(attr)) return raw.slice(i + 1)
      return stripAttrs(raw)
    }
  }
  return stripAttrs(raw)
}

function stripAttrs(raw) {
  return raw.replace(/^\s*((rowspan|colspan|style|class|align|valign|data-sort-value|nowrap|scope|width)(\s*=\s*("[^"]*"|\S+))?\s+)+(?=\{\{|\[\[|\w|')/i, '')
}

function splitInline(line, sep) {
  // split on `||` / `!!` outside of links and templates
  const out = []
  let depth = 0
  let last = 0
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    const n = line[i + 1]
    if ((c === '[' && n === '[') || (c === '{' && n === '{')) { depth++; i++; continue }
    if ((c === ']' && n === ']') || (c === '}' && n === '}')) { depth--; i++; continue }
    if (depth === 0 && c === sep && n === sep) { out.push(line.slice(last, i)); last = i + 2; i++ }
  }
  out.push(line.slice(last))
  return out
}

// Returns array of tables; each table is { header: [str], rows: [[{raw, header}]] }.
export function tables(text) {
  const result = []
  const lines = text.replace(/<!--[\s\S]*?-->/g, '').split('\n')
  let i = 0
  while (i < lines.length) {
    if (!/^\s*\{\|/.test(lines[i])) { i++; continue }
    let depth = 1
    const body = []
    i++
    while (i < lines.length && depth > 0) {
      const l = lines[i]
      if (/^\s*\{\|/.test(l)) depth++
      if (/^\s*\|\}(?!\})/.test(l)) { depth--; if (depth === 0) break }
      body.push(l)
      i++
    }
    i++
    result.push(parseTableBody(body))
  }
  return result
}

function parseTableBody(lines) {
  const rows = []
  let row = null
  let cell = null
  const flush = () => { if (cell && row) row.push(cell); cell = null }
  // Lines inside a still-open template (e.g. {{collapsible list| ...) belong to the
  // current cell even when they start with "|".
  const openTemplates = (s) => (s.match(/\{\{/g) || []).length - (s.match(/\}\}/g) || []).length
  for (const line of lines) {
    if (cell && openTemplates(cell.raw) > 0) { cell.raw += '\n' + line; continue }
    if (/^\s*\|-/.test(line)) { flush(); if (row) rows.push(row); row = []; continue }
    if (/^\s*\|\+/.test(line)) continue
    const m = line.match(/^\s*([|!])(.*)$/)
    if (m) {
      flush()
      if (!row) row = []
      const isHeader = m[1] === '!'
      const parts = splitInline(m[2], isHeader ? '!' : '|')
      if (!isHeader && parts.length === 1) {
        // a `!!` row can also appear in a | row but rarely; ignore
      }
      parts.forEach((p, idx) => {
        const c = { raw: cellContent(p), attrs: p, header: isHeader }
        if (idx < parts.length - 1) row.push(c)
        else cell = c
      })
    } else if (cell) {
      cell.raw += '\n' + line
    }
  }
  flush()
  if (row && row.length) rows.push(row)
  return rows.filter((r) => r.length)
}

const span = (c, k) => {
  const m = c.attrs.match(new RegExp(`${k}\\s*=\\s*"?(\\d+)`, 'i'))
  return m ? +m[1] : 1
}

// Expand rowspans so each logical row has the same column positions.
function gridify(rows) {
  const carry = []
  return rows.map((r) => {
    const out = []
    let ci = 0
    let ri = 0
    while (ri < r.length || carry[ci]) {
      if (carry[ci] && carry[ci].left > 0) {
        out.push({ ...carry[ci].cell, carried: true })
        carry[ci].left--
        if (!carry[ci].left) carry[ci] = null
        ci++
        continue
      }
      const c = r[ri++]
      if (!c) break
      const rs = span(c, 'rowspan')
      const cs = span(c, 'colspan')
      for (let k = 0; k < cs; k++) {
        out.push(c)
        if (rs > 1) carry[ci] = { cell: c, left: rs - 1 }
        ci++
      }
    }
    return out
  })
}

// ---------- ratings ----------

const LEAN = { safe: 3, solid: 3, likely: 2, lean: 1, tilt: 0.5, tossup: 0 }

export function parseRating(raw) {
  const m = raw.match(/§R:([^§]*)§/) || [null, '']
  const parts = m[1].split('/').map((p) => p.trim().toLowerCase())
  if (!parts[0]) return null
  const lvl = parts[0] === 'toss-up' ? 'tossup' : parts[0]
  if (!(lvl in LEAN)) return null
  const party = (parts[1] || '').toUpperCase()
  const flip = parts.includes('flip')
  const score = lvl === 'tossup' ? 0 : LEAN[lvl] * (party === 'D' ? -1 : 1)
  return { label: lvl === 'tossup' ? 'Tossup' : `${cap(lvl === 'solid' ? 'safe' : lvl)} ${party}`, score, flip }
}
const cap = (s) => s[0].toUpperCase() + s.slice(1)

export function labelFor(score) {
  const a = Math.abs(score)
  if (a < 0.35) return 'Tossup'
  const side = score < 0 ? 'D' : 'R'
  if (a < 0.75) return `Tilt ${side}`
  if (a < 1.5) return `Lean ${side}`
  if (a < 2.5) return `Likely ${side}`
  return `Safe ${side}`
}

function consensus(ratings) {
  const vals = Object.values(ratings).filter(Boolean)
  if (!vals.length) return null
  const score = vals.reduce((a, r) => a + r.score, 0) / vals.length
  return { score: +score.toFixed(2), label: labelFor(score), flipVotes: vals.filter((r) => r.flip).length, n: vals.length }
}

function forecasterNames(headerRow) {
  return headerRow.map((c) => clean(c.raw).replace(/\s*(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s*\d.*$/i, '').trim())
}

// Parse a "Predictions"/ratings table keyed by state (or district).
function parseRatingsTable(tbl, keyFn) {
  const out = {}
  const headerRows = tbl.filter((r) => r.every((c) => c.header))
  const sub = headerRows[headerRows.length - 1] || []
  const names = forecasterNames(sub)
  const ratingStart = names.findIndex((n, i) => i >= 3 && !/last|pvi|incumbent|senator|governor|result|state|district/i.test(n))
  for (const row of tbl) {
    if (row.every((c) => c.header)) continue
    const key = keyFn(row[0])
    if (!key) continue
    const ratings = {}
    row.forEach((c, i) => {
      const r = parseRating(cleanKeepMarkers(c.raw))
      if (r) ratings[names[i] || `F${i}`] = r
    })
    const pvi = clean(row[1]?.raw || '')
    out[key] = { ratings, consensus: consensus(ratings), pvi: /[DR]\+\d|EVEN/.test(pvi) ? pvi : null, link: firstLink(row[0].raw) }
    if (ratingStart < 0) continue
  }
  return out
}

// One candidate per bullet. After the election Wikipedia marks the winner with
// {{Aye}} (or a tick) and appends the vote share: "* {{Aye}} [[Name]] (Party) 50.5%".
const WIN_MARK = /\{\{\s*(aye|y|yes|tick|ya|check ?mark|green ?tick|won)\s*(\|[^}]*)?\}\}/i
function parseCandidateList(raw) {
  const text = stripRefs(raw)
    .replace(/\{\{\s*(end ?plainlist|end ?flatlist)\s*\}\}/gi, '\n')
    .replace(/\{\{\s*(plainlist|flatlist)\s*\|?/gi, '\n')
    .replace(/\*\s*\{\{\s*Party stripe/gi, '\n*{{Party stripe')
  let lines = text.split('\n').filter((l) => /^\s*\*/.test(l))
  // Unopposed races list a single candidate without a bullet.
  if (!lines.length && /\[\[|Party stripe/i.test(text)) lines = [`*${text.replace(/\n/g, ' ').replace(/^\s*nowrap\s*\|?/i, '')}`]
  return lines.map((l) => {
    const marker = cleanKeepMarkers(l).match(/§P:(\w)§/)
    const link = firstLink(l.replace(/\{\{Party stripe[^}]*\}\}/i, ''))
    let txt = clean(l.replace(/^\s*\*/, '').replace(/\}\}\s*$/, ''))
    const vm = txt.match(/\s*(\d{1,3}(?:\.\d+)?)\s*%\s*$/)
    const pct = vm ? +vm[1] : null
    if (vm) txt = txt.slice(0, vm.index).trim()
    const pm = txt.match(/\(([^)]+)\)\s*$/)
    const partyName = pm ? pm[1] : ''
    const name = txt.replace(/\s*\([^)]*\)\s*$/, '').replace(/[{}|]+/g, '').trim()
    const party = partyCode(partyName) || (marker ? marker[1] : 'I')
    const c = { name, party, partyName: partyName || partyLong(party), link }
    if (WIN_MARK.test(l)) c.won = true
    if (pct != null) c.pct = pct
    return c
  })
    // ranked-choice tables add "First round:" / "Instant runoff:" header bullets
    .filter((c) => c.name && !/:$/.test(c.name))
    // a candidate listed in several rounds keeps the final round's entry
    .filter((c, i, all) => !all.slice(i + 1).some((x) => x.name === c.name))
}

// Result once a race is decided: winner, vote share, and whether the seat flipped.
function raceResult(candidates, status = '') {
  const w = candidates.find((c) => c.won)
  if (!w) return null
  return { winner: w.name, party: w.party, pct: w.pct ?? null, flip: /gain|flip/i.test(status) }
}

// "None (new seat)" / "Vacant" are seat states, not people.
function incumbentOf(nameRaw = '', partyRaw = '') {
  const name = clean(nameRaw).replace(/Redistricted from.*$/i, '').trim()
  if (/new seat|^none\b/i.test(name)) return { name: null, party: null, vacancy: 'new' }
  if (/^vacant/i.test(name)) return { name: null, party: partyCode(clean(partyRaw)), vacancy: 'vacant' }
  return { name, party: partyCode(clean(partyRaw)) }
}

export function partyCode(p = '') {
  const s = p.toLowerCase()
  if (s.includes('democratic') || s === 'd' || s.includes('dfl')) return 'D'
  if (s.includes('republican') || s === 'r') return 'R'
  if (s.includes('libertarian')) return 'L'
  if (s.includes('green')) return 'G'
  if (!s) return null
  return 'I'
}
const partyLong = (c) => ({ D: 'Democratic', R: 'Republican', L: 'Libertarian', G: 'Green' })[c] || 'Independent'

// Pull the infobox nominee image filenames (keyed by candidate link/name) from a section.
function infoboxImages(sec) {
  const out = {}
  for (let i = 1; i <= 6; i++) {
    const img = sec.match(new RegExp(`\\|\\s*image${i}\\s*=\\s*(?:File:|Image:)?([^\\n|]+)`, 'i'))
    const who = sec.match(new RegExp(`\\|\\s*(?:nominee|candidate)${i}\\s*=\\s*([^\\n]+)`, 'i'))
    if (img && who) {
      const file = img[1].trim()
      if (!file || /3x4\.svg|silhouette|placeholder|no image/i.test(file)) continue
      out[clean(who[1])] = file
      const l = firstLink(who[1])
      if (l) out[l] = file
    }
  }
  return out
}

function prose(sec) {
  const body = sec
    .split('\n')
    .filter((l) => !/^\s*[{|}!*:]/.test(l) && !/^\s*\{\{/.test(l) && !/^=/.test(l) && l.trim())
    .join('\n\n')
  return clean(body).replace(/\s+\./g, '.').slice(0, 1800)
}

// ---------- page parsers ----------

export function parseSenatePage(text) {
  const races = {}
  const pred = tables(section(text, 'Predictions', 2))[0] || []
  const ratings = parseRatingsTable(gridify(pred), (c) => {
    const s = clean(c.raw).replace(/\(.*\)/, '').trim()
    const st = NAME_TO_ABBR[s]
    if (!st) return null
    return /special/i.test(c.raw) ? `${st}-special` : st
  })

  const summRows = [
    ...gridify(tables(section(text, 'Special elections during the preceding Congress', 3))[0] || []),
    ...gridify(tables(section(text, 'Elections leading to the next Congress', 3))[0] || []),
  ]
  for (const row of summRows) {
    if (row.every((c) => c.header) || row.length < 6) continue
    const name = clean(row[0].raw).replace(/\(.*\)/, '').trim()
    const st = NAME_TO_ABBR[name]
    if (!st) continue
    const special = /special/i.test(row[0].raw)
    const key = special ? `${st}-special` : st
    const r = ratings[key] || ratings[st] || {}
    races[key] = {
      id: `senate-${key}`,
      type: 'senate',
      state: st,
      special,
      page: firstLink(row[0].raw),
      pvi: clean(row[1]?.raw) || r.pvi,
      incumbent: incumbentOf(row[2]?.raw, row[3]?.raw),
      lastRace: row.length >= 8 ? clean(row[5]?.raw) : clean(row[4]?.raw),
      status: clean(row[row.length - 2]?.raw),
      candidates: parseCandidateList(row[row.length - 1]?.raw || ''),
      ratings: r.ratings || {},
      consensus: r.consensus || null,
    }
    races[key].result = raceResult(races[key].candidates, races[key].status)
  }

  // narrative + photos from per-state sections
  for (const h of headings(text, 3)) {
    const nm = h.replace(/\(.*\)/, '').trim()
    const st = NAME_TO_ABBR[nm]
    if (!st) continue
    const key = /special/i.test(h) ? `${st}-special` : st
    const race = races[key]
    if (!race) continue
    const sec = section(text, h, 3)
    race.summary = prose(sec)
    race.images = infoboxImages(sec)
  }
  return races
}

export function parseGovernorPage(text) {
  const races = {}
  const pred = tables(section(text, 'Predictions', 2))[0] || []
  const ratings = parseRatingsTable(gridify(pred), (c) => NAME_TO_ABBR[clean(c.raw).trim()] || null)
  const summ = tables(section(text, 'States', 3))[0] || []
  for (const row of gridify(summ)) {
    if (row.every((c) => c.header)) continue
    const st = NAME_TO_ABBR[clean(row[0].raw).trim()]
    if (!st) continue
    const r = ratings[st] || {}
    races[st] = {
      id: `governor-${st}`,
      type: 'governor',
      state: st,
      page: firstLink(row[0].raw),
      pvi: r.pvi,
      incumbent: incumbentOf(row[1]?.raw, row[2]?.raw),
      firstElected: clean(row[3]?.raw),
      lastRace: clean(row[4]?.raw),
      status: clean(row[row.length - 2]?.raw),
      candidates: parseCandidateList(row[row.length - 1]?.raw || ''),
      ratings: r.ratings || {},
      consensus: r.consensus || null,
    }
    races[st].result = raceResult(races[st].candidates, races[st].status)
  }
  for (const h of headings(text, 2)) {
    const st = NAME_TO_ABBR[h.trim()]
    if (!st || !races[st]) continue
    const sec = section(text, h, 2)
    races[st].summary = prose(sec)
    races[st].images = infoboxImages(sec)
  }
  return races
}

export function parseHousePage(text, ratingsText) {
  const ratings = ratingsText
    ? parseRatingsTable(gridify(tables(section(ratingsText, 'Latest published ratings for competitive seats', 3))[0] || []), (c) => {
      const d = clean(c.raw).match(/^([A-Z]{2})-(\w+)/)
      return d ? `${d[1]}-${d[2] === 'AL' ? 'AL' : +d[2]}` : null
    })
    : {}
  const byState = {}
  for (const h of headings(text, 2)) {
    const st = NAME_TO_ABBR[h.trim()]
    if (!st) continue
    const tbl = tables(section(text, h, 2))[0] || []
    const seen = new Set()
    const list = []
    for (const row of gridify(tbl)) {
      if (!row[0]?.header || row.length < 4) continue
      const d = clean(row[0].raw).match(/^([A-Z]{2})-(\w+)/)
      if (!d) continue
      const dist = d[2] === 'AL' ? 'AL' : +d[2]
      const key = `${st}-${dist}`
      const isNew = /new seat/i.test(row[2]?.raw || '')
      const inc = isNew ? { name: null, party: null, vacancy: 'new' } : incumbentOf(row[2]?.raw, row[3]?.raw)
      const statusCell = isNew ? row[3] : row[5]
      const candCell = row[row.length - 1]
      if (seen.has(key)) {
        // additional incumbent in a merged district
        const prev = list.find((x) => x.key === key)
        if (prev && inc.name && !prev.incumbents.some((x) => x.name === inc.name)) prev.incumbents.push({ ...inc, status: clean(statusCell?.raw) })
        continue
      }
      seen.add(key)
      const r = ratings[key] || {}
      list.push({
        key,
        id: `house-${key}`,
        type: 'house',
        state: st,
        district: dist,
        pvi: clean(row[1]?.raw) || r.pvi,
        incumbents: [{ ...inc, status: clean(statusCell?.raw) }],
        incumbent: inc,
        status: clean(statusCell?.raw),
        candidates: parseCandidateList(candCell?.raw || ''),
        ratings: r.ratings || {},
        consensus: r.consensus || pviConsensus(clean(row[1]?.raw)),
        competitive: !!r.consensus,
      })
      list[list.length - 1].result = raceResult(list[list.length - 1].candidates, clean(statusCell?.raw))
    }
    byState[st] = list
  }
  return byState
}

// Seats not on any forecaster's competitive list are treated as safe for the PVI side.
function pviConsensus(pvi) {
  const m = (pvi || '').match(/([DR])\+(\d+)/)
  if (!m) return null
  const score = m[1] === 'D' ? -3 : 3
  return { score, label: labelFor(score), flipVotes: 0, n: 0, implied: true }
}

export function parseGenericBallot(text) {
  const tbl = tables(section(text, 'Generic congressional ballot aggregate polls', 2))[0] || []
  return gridify(tbl)
    .filter((r) => !r.every((c) => c.header))
    .map((r) => {
      const vals = r.map((c) => clean(c.raw))
      const avg = /average/i.test(vals[0])
      const off = avg ? 1 : 3
      return {
        source: avg ? 'Average' : vals[0],
        updated: vals[2],
        R: parseFloat(vals[off]),
        D: parseFloat(vals[off + 1]),
        margin: vals[vals.length - 1],
      }
    })
    .filter((r) => !Number.isNaN(r.R))
}

export function parseMeasuresPage(text) {
  const out = {}
  const by = section(text, 'By state', 2)
  for (const h of headings(by, 3)) {
    const st = NAME_TO_ABBR[h.trim()]
    if (!st) continue
    const tbl = tables(section(by, h, 3))[0] || []
    const rows = gridify(tbl).filter((r) => !r.every((c) => c.header))
    out[st] = rows.map((r) => {
      const v = r.map((c) => clean(c.raw))
      const raw = r.map((c) => c.raw)
      return {
        origin: v[0],
        status: v[1],
        title: v[2],
        description: v[3],
        date: v[4],
        yes: /awaiting/i.test(v[5]) ? null : v[5],
        no: /awaiting/i.test(v[5]) ? null : v[6],
        link: firstLink(raw[2] || ''),
      }
    }).filter((m) => m.title)
  }
  return out
}

// ---------- per-race page (on demand) ----------

// Parses the general-election polling + fundraising tables from an individual race page.
export function parseRacePage(text, district = null) {
  let scope = text
  if (district != null) {
    const d = section(text, `District ${district}`, 2) || section(text, 'At-large district', 2)
    if (d) scope = d
  }
  const gen = section(scope, 'General election', district != null ? 3 : 2) || scope
  const pollSec = section(gen, 'Polling', district != null ? 4 : 3) || section(gen, 'Polling', null)
  const finSec = section(gen, 'Fundraising', district != null ? 4 : 3) || section(gen, 'Fundraising', null)
  const polls = parsePolls(pollSec)
  const fundraising = parseFundraising(finSec)
  const predSec = section(gen, 'Predictions', district != null ? 4 : 3)
  const out = { ...polls, fundraising, hasPredictions: !!predSec }
  // Statewide pages (Senate, governor) carry the whole campaign story.
  if (district == null) {
    out.primaries = parsePrimaries(text)
    out.runningMates = parseTickets(text)
    out.debates = parseDebates(section(gen, 'Debates', 3) || section(gen, 'Debate', 3))
    out.endorsements = parseEndorsements(section(gen, 'Post-primary endorsements', 3) || section(gen, 'Endorsements', 3))
    const bg = section(text, 'Background', 2)
    out.background = bg ? prose(bg) : ''
  }
  return out
}

// Split on "|" at the top level only (not inside [[links]] or {{templates}}).
function splitTop(body) {
  const parts = []
  let depth = 0
  let cur = ''
  for (let i = 0; i < body.length; i++) {
    const two = body.slice(i, i + 2)
    if (two === '[[' || two === '{{') { depth++; cur += two; i++; continue }
    if ((two === ']]' || two === '}}') && depth > 0) { depth--; cur += two; i++; continue }
    if (body[i] === '|' && depth === 0) { parts.push(cur); cur = ''; continue }
    cur += body[i]
  }
  parts.push(cur)
  return parts
}

// Bodies of every {{template}} whose name matches, with nested templates kept intact.
function templateBodies(text, nameRe) {
  const out = []
  for (let i = text.indexOf('{{'); i >= 0; i = text.indexOf('{{', i + 2)) {
    if (!nameRe.test(text.slice(i + 2, i + 80))) continue
    let depth = 0
    for (let j = i; j < text.length - 1; j++) {
      if (text[j] === '{' && text[j + 1] === '{') { depth++; j++ } else if (text[j] === '}' && text[j + 1] === '}') {
        depth--; j++
        if (!depth) { out.push({ at: i, body: text.slice(i + 2, j - 1) }); break }
      }
    }
  }
  return out
}

function templateParams(body) {
  const params = {}
  const parts = splitTop(body)
  for (const part of parts.slice(1)) {
    const eq = part.indexOf('=')
    if (eq > 0) params[part.slice(0, eq).trim().toLowerCase()] = part.slice(eq + 1).trim()
  }
  return { name: parts[0].trim(), params }
}

// candidate=[[A]] or {{ubl|[[Governor]]|[[Running mate]]}}
function ticket(raw = '') {
  const ubl = raw.match(/^\{\{\s*(?:ubl|unbulleted list|plainlist)\s*\|([\s\S]*)\}\}$/i)
  const [name, mate] = ubl ? splitTop(ubl[1]).map((x) => clean(x)) : [clean(raw)]
  return { name: name.replace(/\s*\((incumbent|write-in)\)$/i, ''), mate: mate || null }
}

// Every results box on the page: primaries/runoffs, plus the general-election ticket.
function resultBoxes(text) {
  const plain = stripRefs(text)
  const begins = templateBodies(plain, /^\s*Election box begin/i)
  const cands = templateBodies(plain, /^\s*Election box (winning )?candidate/i)
  return begins.map((b, i) => {
    const next = begins[i + 1]?.at ?? Infinity
    const title = clean(templateParams(b.body).params.title || '')
    const list = cands.filter((c) => c.at > b.at && c.at < next).map((c) => {
      const { name, params: p } = templateParams(c.body)
      const t = ticket(p.candidate)
      return {
        ...t,
        votes: +String(p.votes || '').replace(/[^\d]/g, '') || null,
        pct: p.percentage ? +p.percentage.replace(/[^\d.]/g, '') || null : null,
        won: /winning/i.test(name),
        party: partyCode(clean(p.party || '')),
      }
    }).filter((c) => c.name && !/^(write-?ins?|none of these|other|blank)/i.test(c.name))
    return { title, cands: list }
  })
}

export function parsePrimaries(text) {
  return resultBoxes(text).filter((b) => /primary|caucus|convention/i.test(b.title) && b.cands.length).map(({ title, cands }) => {
    const total = cands.reduce((n, c) => n + (c.votes || 0), 0)
    for (const c of cands) if (c.pct == null && c.votes && total) c.pct = +((c.votes / total) * 100).toFixed(1)
    cands.sort((a, b) => (b.votes || b.pct || 0) - (a.votes || a.pct || 0))
    return { title: title.replace(/\s*results?$/i, ''), runoff: /runoff/i.test(title), cands }
  })
}

// Running mates listed on the general-election ballot: { "Katie Hobbs": "John Giles" }
export function parseTickets(text) {
  const general = resultBoxes(text).filter((b) => !/primary|caucus|convention/i.test(b.title))
  return Object.fromEntries(general.flatMap((b) => b.cands).filter((c) => c.mate).map((c) => [c.name, c.mate]))
}

// General-election debates: date, host and video link per row.
export function parseDebates(sec) {
  if (!sec) return []
  const out = []
  for (const t of tables(sec)) {
    const g = gridify(t)
    const head = (g.find((r) => r.every((c) => c.header)) || []).map((c) => clean(c.raw).toLowerCase())
    const di = head.findIndex((h) => /date/.test(h))
    const hi = head.findIndex((h) => /host|sponsor|organi[sz]er/.test(h))
    const li = head.findIndex((h) => /link/.test(h))
    if (di < 0) continue
    for (const r of g) {
      const date = clean(r[di]?.raw || '')
      if (!/\d{4}/.test(date) || r[di]?.header) continue
      const url = ((r[li]?.raw || '').match(/\[(https?:\/\/[^\s\]]+)/) || [])[1] || null
      out.push({ date, host: hi >= 0 ? clean(r[hi]?.raw || '').replace(/\s+/g, ' ') : '', url })
    }
  }
  return out
}

// Endorsements boxes: per candidate, a count plus the first few names by category.
export function parseEndorsements(sec) {
  if (!sec) return []
  return stripRefs(sec).split(/\{\{\s*Endorsements box/i).slice(1).map((box) => {
    const title = clean((box.match(/\|\s*title\s*=\s*([^\n|]*)/) || [])[1] || '')
    const groups = []
    let cur = null
    let count = 0
    for (const line of box.split('\n')) {
      const cat = line.match(/^;\s*(.+)/)
      if (cat) { cur = { cat: clean(cat[1]), names: [] }; groups.push(cur); continue }
      if (!/^\*/.test(line)) continue
      count++
      const name = clean(line.replace(/^\*+/, '')).split(/,|\(/)[0].trim()
      if (!cur) { cur = { cat: 'Endorsements', names: [] }; groups.push(cur) }
      if (name && cur.names.length < 4) cur.names.push(name)
      cur.n = (cur.n || 0) + 1
    }
    return { title, count, groups: groups.filter((x) => x.n) }
  }).filter((e) => e.title && e.count)
}

function pct(s) {
  const m = (s || '').match(/(\d+(?:\.\d+)?)\s*%/)
  return m ? +m[1] : null
}

function parsePolls(sec) {
  if (!sec) return { aggregates: [], polls: [], pollCandidates: [] }
  // drop hypothetical blocks
  const trimmed = sec.split(/\{\{hidden begin/i)[0]
  const tbls = tables(trimmed)
  let aggregates = []
  let polls = []
  let pollCandidates = []
  for (const t of tbls) {
    const g = gridify(t)
    const head = g.find((r) => r.every((c) => c.header)) || []
    const names = head.map((c) => clean(c.raw))
    if (!names.length) continue
    const isAgg = /aggregation/i.test(names[0])
    const isPoll = /poll source/i.test(names[0])
    if (!isAgg && !isPoll) continue
    const candIdx = names
      .map((n, i) => ({ n, i }))
      .filter(({ n, i }) => i >= (isAgg ? 3 : 4) && !/other|undecided|margin|lead/i.test(n))
    const candNames = candIdx.map(({ n }) => n.replace(/\s+/g, ' '))
    const rows = g.filter((r) => !r.every((c) => c.header))
    if (isAgg && !aggregates.length) {
      pollCandidates = candNames
      aggregates = rows.map((r) => {
        const v = r.map((c) => clean(c.raw))
        const avg = /average/i.test(v[0])
        return {
          source: avg ? 'Average' : v[0],
          dates: avg ? '' : v[1],
          values: candIdx.map(({ i }) => pct(v[avg ? i - 2 : i])),
          margin: v[v.length - 1],
        }
      }).filter((a) => a.values.some((x) => x != null))
    }
    if (isPoll && !polls.length) {
      if (!pollCandidates.length) pollCandidates = candNames
      let lastSource = null
      polls = rows.map((r) => {
        const v = r.map((c) => clean(c.raw))
        const src = v[0]
        const out = {
          source: src,
          dates: v[1],
          sample: v[2],
          moe: v[3],
          values: candIdx.map(({ i }) => pct(v[i])),
          dup: src === lastSource,
        }
        lastSource = src
        return out
      }).filter((p) => p.values.filter((x) => x != null).length >= 2 && !p.dup).slice(0, 12)
    }
  }
  return { aggregates, polls, pollCandidates }
}

function money(s) {
  const m = (s || '').replace(/,/g, '').match(/\$?\s*(-?\d+(?:\.\d+)?)/)
  return m ? +m[1] : null
}

function parseFundraising(sec) {
  if (!sec) return null
  const t = tables(sec)[0]
  if (!t) return null
  const g = gridify(t)
  const asOf = clean(g[0]?.[0]?.raw || '').replace(/^Campaign finance reports? as of\s*/i, '')
  const rows = g.filter((r) => !r.every((c) => c.header) && r.length >= 4)
  const list = rows.map((r) => {
    const v = r.map((c) => clean(c.raw))
    const pm = v[0].match(/\(([A-Z])\)/)
    return {
      name: v[0].replace(/\s*\([^)]*\)\s*$/, ''),
      party: pm ? pm[1] : null,
      raised: money(v[1]),
      spent: money(v[2]),
      cash: money(v[3]),
    }
  }).filter((r) => r.raised != null)
  return list.length ? { asOf, source: 'Campaign finance reports (Wikipedia, from FEC / state filings)', candidates: list } : null
}

// Pull issue positions out of a candidate article: a "Political positions"-style
// section if one exists, otherwise the issue subsections under "Tenure".
const NOT_ISSUE = /^(elections?|\d{4}.*|committee assignments|caucus memberships?|electoral history|impeachment.*|personal life|tenure|.*campaign)$/i

export function parsePositions(text) {
  const candidates = []
  for (const lvl of [2, 3]) {
    for (const h of headings(text, lvl)) {
      if (/position|political views|platform|stances|policy/i.test(h)) candidates.push([h, lvl, 0])
      else if (/^tenure/i.test(h.trim())) candidates.push([h, lvl, 1])
    }
  }
  candidates.sort((a, b) => a[2] - b[2])
  for (const [h, lvl] of candidates) {
    const sec = section(text, h, lvl)
    if (!sec) continue
    let subs = []
    for (const sl of [lvl + 1, lvl + 2]) {
      subs = headings(sec, sl).filter((x) => !NOT_ISSUE.test(clean(x).trim()))
      if (subs.length) {
        const items = subs.slice(0, 12).map((x) => ({ issue: clean(x), text: prose(section(sec, x, sl)).slice(0, 360) }))
        const intro = prose(sec.split(/\n={3,}/)[0]).slice(0, 600)
        return { intro, items }
      }
    }
    const intro = prose(sec).slice(0, 800)
    if (intro) return { intro, items: [] }
  }
  return null
}

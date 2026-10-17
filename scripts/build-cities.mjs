// Builds src/data/cities.json: places with 10K+ people, grouped by state and
// sorted biggest first, { ST: [[name, lon, lat, pop], ...] }, for map labels.
// Sources (public domain, U.S. Census Bureau):
//   2024 Gazetteer place file (names + internal points)
//   Vintage 2024 city & town population estimates
// Usage: npm run data:cities   (needs `unzip` on PATH)
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const UA = { 'User-Agent': 'MidtermsHQ-build/1.0 (+https://github.com/donyon67k/midterms-hq)' }
const GAZ = 'https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2024_Gazetteer/2024_Gaz_place_national.zip'
const POP = 'https://www2.census.gov/programs-surveys/popest/datasets/2020-2024/cities/totals/sub-est2024.csv'
const MIN_POP = 10000

const get = async (url) => {
  const res = await fetch(url, { headers: UA })
  if (!res.ok) throw new Error(`${url} ${res.status}`)
  return Buffer.from(await res.arrayBuffer())
}

// Population by state+place FIPS (summary level 162 = incorporated place).
const pop = {}
const [head, ...rows] = (await get(POP)).toString('latin1').trim().split(/\r?\n/)
const col = Object.fromEntries(head.split(',').map((h, i) => [h, i]))
for (const line of rows) {
  const c = line.split(',')
  if (c[col.SUMLEV] !== '162') continue
  pop[c[col.STATE] + c[col.PLACE]] = +c[col.POPESTIMATE2024]
}

// Hawaii has no incorporated places; its census-designated places get 2020 counts.
const HI_CDP = {
  'Urban Honolulu': 350964, 'East Honolulu': 50922, 'Pearl City': 45159, Hilo: 44186, Waipahu: 43485,
  Kailua: 40514, Kapolei: 21411, Kaneohe: 37430, 'Mililani Town': 28121, Kahului: 28219, 'Ewa Gentry': 25707,
  Kihei: 22414, 'Kailua-Kona': 22209, Makakilo: 20248, Wahiawa: 17598, Waianae: 15037, Lahaina: 12702,
}

const dir = mkdtempSync(join(tmpdir(), 'mhq-gaz-'))
let gaz
try {
  writeFileSync(join(dir, 'gaz.zip'), await get(GAZ))
  gaz = execFileSync('unzip', ['-p', join(dir, 'gaz.zip')], { maxBuffer: 64 << 20 }).toString('utf8')
} finally {
  rmSync(dir, { recursive: true, force: true })
}

// "Houston city" -> "Houston"; "Nashville-Davidson metropolitan government (balance)" -> "Nashville"
const TYPE = / (city and borough|city|town|village|borough|municipality|urban county|metro township|CDP|plantation|corporation|comunidad|zona urbana)$/
function clean(raw) {
  let n = raw.replace(/ \(balance\)$/, '')
  if (/government|urban county|[-/].* County$|-Silver Bow|-Deer Lodge/.test(n)) n = n.split(/[-/]/)[0]
  n = n.replace(/ (metropolitan|unified|consolidated) government$/, '').replace(TYPE, '')
  return n.replace(/^.* \((.+)\)$/, '$1') // "San Buenaventura (Ventura)" -> "Ventura"
    .replace(/^Boise City$/, 'Boise').replace(/^Urban Honolulu$/, 'Honolulu')
}

const out = {}
const [gHead, ...gRows] = gaz.trim().split(/\r?\n/)
const g = Object.fromEntries(gHead.split('\t').map((h, i) => [h.trim(), i]))
for (const line of gRows) {
  const c = line.split('\t').map((s) => s.trim())
  const st = c[g.USPS]
  const name = c[g.NAME]
  const people = st === 'HI' ? HI_CDP[name.replace(/ CDP$/, '')] : pop[c[g.GEOID]]
  if (!people || people < MIN_POP) continue
  ;(out[st] ||= []).push([clean(name), +(+c[g.INTPTLONG]).toFixed(4), +(+c[g.INTPTLAT]).toFixed(4), people])
}
for (const list of Object.values(out)) list.sort((a, b) => b[3] - a[3])
writeFileSync(new URL('../src/data/cities.json', import.meta.url), JSON.stringify(out))
const total = Object.values(out).reduce((n, l) => n + l.length, 0)
console.log(`cities written: ${total} places in ${Object.keys(out).length} states`)

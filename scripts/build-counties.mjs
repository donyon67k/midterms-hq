// Builds src/data/county2024.json: 2024 presidential margin per county,
// { fips: [demPct, gopPct, totalVotes] }, used to shade the county map.
// Source: github.com/tonmcg/US_County_Level_Election_Results_08-24
// Usage: npm run data:counties
import { writeFileSync } from 'node:fs'

const SRC = 'https://raw.githubusercontent.com/tonmcg/US_County_Level_Election_Results_08-24/master/2024_US_County_Level_Presidential_Results.csv'
const res = await fetch(SRC, { headers: { 'User-Agent': 'MidtermsHQ-build/1.0 (+https://github.com/donyon67k/midterms-hq)' } })
if (!res.ok) throw new Error(`county results ${res.status}`)
const [head, ...rows] = (await res.text()).trim().split('\n')
const col = Object.fromEntries(head.split(',').map((h, i) => [h, i]))

const out = {}
for (const line of rows) {
  // county names can contain commas inside quotes; the numeric tail is fixed-width
  const cells = line.match(/("[^"]*"|[^,]+)/g)
  const fips = cells[col.county_fips].padStart(5, '0')
  const dem = +cells[cells.length - 2]
  const gop = +cells[cells.length - 3]
  const total = +cells[cells.length - 5]
  if (!Number.isFinite(dem) || !Number.isFinite(gop)) continue
  out[fips] = [+(dem * 100).toFixed(1), +(gop * 100).toFixed(1), total]
}
writeFileSync(new URL('../src/data/county2024.json', import.meta.url), JSON.stringify(out))
console.log(`county results written: ${Object.keys(out).length} counties`)

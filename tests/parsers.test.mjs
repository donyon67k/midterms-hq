// Parser regression tests. Fixtures are saved copies of finished-election
// Wikipedia pages, so results parsing is checked against known real outcomes.
// Run: npm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parseGovernorPage, parseHousePage, parseSenatePage } from '../src/data/wiki.js'
import { healthCheck } from '../src/data/live.js'

const fixture = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')
const snapshot = JSON.parse(readFileSync(new URL('../src/data/snapshot.json', import.meta.url), 'utf8'))
const MARKUP = /[{}|[\]=]|plainlist/i

test('2024 Senate: every race called, real flips detected', () => {
  const races = Object.values(parseSenatePage(fixture('senate-2024.wiki')))
  assert.equal(races.length, 34)
  assert.equal(races.filter((r) => r.result).length, 34)
  const flips = races.filter((r) => r.result.flip).map((r) => r.state).sort()
  assert.deepEqual(flips, ['AZ', 'MT', 'OH', 'PA', 'WV'])
  const pa = races.find((r) => r.state === 'PA')
  assert.equal(pa.result.winner, 'Dave McCormick')
  assert.equal(pa.result.party, 'R')
  assert.equal(pa.result.pct, 48.8)
})

test('2024 House: all 435 seats, 215 D / 220 R', () => {
  const seats = Object.values(parseHousePage(fixture('house-2024.wiki'))).flat()
  assert.equal(seats.length, 435)
  assert.equal(seats.filter((r) => r.result?.party === 'D').length, 215)
  assert.equal(seats.filter((r) => r.result?.party === 'R').length, 220)
  const pa7 = seats.find((r) => r.key === 'PA-7')
  assert.deepEqual(pa7.result, { winner: 'Ryan Mackenzie', party: 'R', pct: 50.5, flip: true })
})

test('2024 House: unopposed winners and collapsible "Others" lists parse', () => {
  const seats = Object.values(parseHousePage(fixture('house-2024.wiki'))).flat()
  assert.equal(seats.find((r) => r.key === 'AL-3').result.winner, 'Mike Rogers')
  assert.equal(seats.filter((r) => r.state === 'NJ').length, 12)
  assert.ok(seats.every((r) => r.candidates.every((c) => !MARKUP.test(c.name))))
})

test('2022 governors: all 36 called, real flips detected', () => {
  const races = Object.values(parseGovernorPage(fixture('governor-2022.wiki')))
  assert.equal(races.length, 36)
  assert.equal(races.filter((r) => r.result).length, 36)
  assert.deepEqual(races.filter((r) => r.result.flip).map((r) => r.state).sort(), ['AZ', 'MA', 'MD', 'NV'])
})

test('2026 snapshot: complete and clean', () => {
  assert.deepEqual(healthCheck(snapshot), [])
  const seats = Object.values(snapshot.house).flat()
  // open seats are flagged, never shown as a person named "None (new seat)"
  assert.ok(seats.every((r) => !/new seat|^vacant/i.test(r.incumbent.name || '')))
  assert.ok(seats.some((r) => r.incumbent.vacancy === 'new'))
})

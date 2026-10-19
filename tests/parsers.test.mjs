// Parser regression tests. Fixtures are saved copies of finished-election
// Wikipedia pages, so results parsing is checked against known real outcomes.
// Run: npm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parseGovernorPage, parseHousePage, parseRacePage, parseSenatePage } from '../src/data/wiki.js'
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

test('Governor race page: primaries, runoff, debates, endorsements', () => {
  const r = parseRacePage(fixture('governor-race-ga-2026.wiki'))
  assert.deepEqual(r.primaries.map((p) => p.title), ['Republican primary', 'Republican primary runoff', 'Democratic primary'])
  const dem = r.primaries[2].cands[0]
  assert.deepEqual([dem.name, dem.pct, dem.votes, dem.won], ['Keisha Lance Bottoms', 56.2, 608264, true])
  assert.equal(r.primaries[1].cands[0].name, 'Rick Jackson')
  assert.equal(r.debates.length, 1)
  assert.match(r.debates[0].url, /youtube/)
  assert.deepEqual(r.endorsements.map((e) => e.title), ['Rick Jackson (R)', 'Keisha Lance Bottoms (D)'])
  assert.ok(r.background.length > 100)
})

test('Governor race page: running mates from {{ubl}} tickets', () => {
  const r = parseRacePage(fixture('governor-race-oh-2026.wiki'))
  assert.equal(r.runningMates['Amy Acton'], 'David Pepper')
  assert.equal(r.runningMates['Vivek Ramaswamy'], 'Rob McColley')
  assert.equal(r.primaries[0].cands[0].name, 'Vivek Ramaswamy')
})

test('Control file: junk is dropped, overrides layer onto races', async () => {
  const { sanitizeControl, applyControl } = await import('../src/data/control.js')
  const ctl = sanitizeControl({
    banner: { text: 'Polls closing', link: 'javascript:alert(1)' },
    ratings: { 'senate-GA': 'Lean R', 'senate-TX': 'Very Safe' },
    results: { 'senate-GA': { winner: 'Jon Ossoff', party: 'D', pct: 51.2 }, 'senate-NC': { winner: 'X', party: 'Q' } },
    notes: { 'senate-GA': 'Watch the suburbs', bad: 42 },
    featured: ['senate-GA', 7],
    minVersion: 'latest',
  })
  assert.equal(ctl.banner.link, null)
  assert.deepEqual(Object.keys(ctl.ratings), ['senate-GA'])
  assert.deepEqual(Object.keys(ctl.results), ['senate-GA'])
  assert.deepEqual(ctl.featured, ['senate-GA'])
  assert.equal(ctl.minVersion, null)
  const ga = applyControl(snapshot, ctl).senate.GA
  assert.equal(ga.consensus.label, 'Lean R')
  assert.equal(ga.result.winner, 'Jon Ossoff')
  assert.equal(ga.hqNote, 'Watch the suburbs')
  assert.equal(applyControl(snapshot, sanitizeControl(null)).senate.GA, snapshot.senate.GA)
})

test('news wire: feeds parsed, stories grouped across outlets, lean and races tagged', async () => {
  const { cluster, parseFeed, raceQuery, raceIndex, tagRaces } = await import('../src/data/news.js')
  const { balance, leanOf } = await import('../src/data/sources.js')

  const rss = `<rss><channel><item><title><![CDATA[Collins &amp; Jackson clash in Maine Senate debate]]></title>
    <link>https://example.com/a</link><pubDate>Sun, 18 Oct 2026 21:15:58 +0000</pubDate>
    <media:content url="https://example.com/a.jpg" medium="image"/></item></channel></rss>`
  const atom = '<feed><entry><title type="html">Ossoff&#8217;s lead grows</title><link rel="alternate" href="https://example.org/b"/><updated>2026-10-19T03:03:28Z</updated></entry></feed>'
  assert.deepEqual(parseFeed(rss, 'thehill.com'), [{ title: 'Collins & Jackson clash in Maine Senate debate', url: 'https://example.com/a', domain: 'thehill.com', at: '2026-10-18T21:15:58.000Z', image: 'https://example.com/a.jpg' }])
  assert.equal(parseFeed(atom, 'theguardian.com')[0].title, 'Ossoff’s lead grows')

  const art = (domain, at, title) => ({ url: `https://${domain}/a`, domain, at, title })
  const stories = cluster([
    art('washingtontimes.com', '2026-10-18T10:00:00Z', 'Massachusetts GOP lieutenant governor candidate suspends campaign after arrest in car crash'),
    art('abcnews.com', '2026-10-18T11:00:00Z', 'Massachusetts GOP lieutenant governor candidate suspends campaign after arrest in car crash'),
    art('thehill.com', '2026-10-18T12:00:00Z', 'Mass. GOP candidate for lieutenant governor suspends campaign after arrest | The Hill'),
    art('npr.org', '2026-10-18T12:30:00Z', 'Early voting surges across key battleground states'),
    art('foxnews.com', '2026-10-18T13:00:00Z', 'White House press secretary out after five days'),
  ])
  assert.equal(stories.length, 3)
  const mass = stories[0]
  assert.deepEqual(mass.outlets, ['washingtontimes.com', 'abcnews.com', 'thehill.com'])
  assert.equal(mass.domain, 'thehill.com') // a center outlet's headline leads
  assert.equal(mass.title, 'Mass. GOP candidate for lieutenant governor suspends campaign after arrest')
  assert.deepEqual([leanOf('www.foxnews.com'), leanOf('wsbtv.com'), leanOf('example.net')], [2, 'local', null])
  assert.equal(balance(['foxnews.com', 'breitbart.com', 'dailywire.com', 'reuters.com']).blindspot, 'left') // the left isn't covering it
  assert.equal(balance(['foxnews.com', 'breitbart.com', 'dailywire.com', 'nytimes.com']).blindspot, null)

  const ga = snapshot.senate.GA
  assert.equal(raceQuery(ga), '("Mike Collins" OR "Jon Ossoff") "Georgia"')
  const idx = raceIndex([ga, snapshot.senate.AK])
  assert.deepEqual(tagRaces('Ossoff, Collins spar in Georgia debate', idx).map((r) => r.id), ['senate-GA'])
  assert.deepEqual(tagRaces('Susan Collins says she will vote no', idx), [])
  assert.deepEqual(tagRaces('Jon Ossoff’s new ad', idx).map((r) => r.id), ['senate-GA'])
})

test('news search + HQ TILT: aggregator items keep the real outlet, coverage gets a plain verdict', async () => {
  const { parseFeed } = await import('../src/data/news.js')
  const { tilt, VERDICT, leanOf } = await import('../src/data/sources.js')
  const xml = `<rss><channel><item><title>Bennett outraises Kean in NJ-7 - New Jersey Globe</title>
    <link>https://news.google.com/rss/articles/abc?oc=5</link><pubDate>Thu, 15 Oct 2026 23:04:37 GMT</pubDate>
    <source url="https://newjerseyglobe.com">New Jersey Globe</source></item></channel></rss>`
  const [a] = parseFeed(xml, 'news.google.com')
  assert.equal(a.title, 'Bennett outraises Kean in NJ-7')
  assert.equal(a.domain, 'newjerseyglobe.com')

  assert.equal(tilt(['nytimes.com', 'reuters.com', 'foxnews.com']).verdict, 'balanced')
  assert.equal(tilt(['nytimes.com', 'npr.org', 'reuters.com']).verdict, 'leans-left')
  assert.equal(tilt(['foxnews.com', 'breitbart.com', 'dailywire.com']).verdict, 'heavy-right')
  assert.equal(tilt(['foxnews.com', 'breitbart.com', 'dailywire.com']).blindspot, 'left')
  assert.equal(tilt(['npr.org']).verdict, 'single')
  assert.equal(tilt(['wmur.com', 'newjerseymonitor.com']).verdict, 'local')
  assert.equal(VERDICT[tilt(['nytimes.com', 'nypost.com']).verdict], 'BALANCED')
  assert.equal(tilt(['nytimes.com', 'nypost.com']).score, 87)
  assert.deepEqual(tilt(['msnbc.com', 'npr.org', 'reuters.com', 'nypost.com', 'foxnews.com']).steps, [1, 1, 1, 1, 1])
  assert.equal(leanOf('newjersey.news12.com'), 'local')
  assert.equal(leanOf('nhpr.org'), 'local')
})

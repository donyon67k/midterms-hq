import { test } from 'node:test'
import assert from 'node:assert/strict'
import { applyScout, deskList, sanitizeScout } from '../src/data/scout.js'

test('sanitizeScout keeps good calls and counts, drops junk', () => {
  const sc = sanitizeScout({
    updatedAt: '2026-11-04T01:00:00Z',
    calls: {
      'senate-PA': { winner: 'Jane Doe', party: 'D', sources: [{ desk: 'AP', url: 'https://apnews.com/x' }, { desk: 'CNN', url: 'javascript:alert(1)' }] },
      bad: { winner: '', party: 'D' },
      worse: { winner: 'X', party: 'Q' },
    },
    counts: { 'senate-PA': { pctIn: 64, cands: [{ name: 'Jane Doe', party: 'D', votes: 100, pct: 51.2 }, { name: '' }], source: 'PA DOS', url: 'http://insecure' } },
    official: { PA: 'https://www.vote.pa.gov', pa: 'https://x.gov', TX: 'ftp://x' },
  })
  assert.deepEqual(Object.keys(sc.calls), ['senate-PA'])
  assert.deepEqual(sc.calls['senate-PA'].sources, [{ desk: 'AP', url: 'https://apnews.com/x' }])
  assert.equal(sc.counts['senate-PA'].cands.length, 1)
  assert.equal(sc.counts['senate-PA'].url, null)
  assert.deepEqual(sc.official, { PA: 'https://www.vote.pa.gov' })
})

test('applyScout puts the desk call and count on the race', () => {
  const race = { id: 'senate-PA', state: 'PA', result: null, candidates: [{ name: 'Jane Doe', party: 'D' }, { name: 'John Roe', party: 'R' }] }
  const sc = sanitizeScout({ calls: { 'senate-PA': { winner: 'Jane Doe', party: 'D', sources: [{ desk: 'AP', url: 'https://a.com' }] } }, counts: {}, official: {} })
  const out = applyScout({ senate: { PA: race }, governor: {}, house: {} }, sc).senate.PA
  assert.equal(out.result.winner, 'Jane Doe')
  assert.equal(out.result.scout, true)
  assert.deepEqual(out.candidates.map((c) => c.won), [true, false])
  assert.equal(deskList([{ desk: 'AP' }, { desk: 'CNN' }, { desk: 'NBC News' }, { desk: 'Fox News' }]), 'AP, CNN, NBC News +1')
})

test('matchMeasures: NBC results attach to the right Nov 3 measure by number and words', async () => {
  const { matchMeasures } = await import('../src/data/scout.js')
  const list = [
    { title: 'Missouri Amendment 1, Sales Tax for Parks Amendment', date: 'Aug 4', status: 'Approved' },
    { title: 'Missouri Amendment 3, Repeal Right to Abortion and Prohibit Gender Transition for Minors Amendment', date: 'Nov 3', status: 'On ballot' },
    { title: 'Missouri Referendum A, Congressional Redistricting Map Referendum', date: 'Nov 3', status: 'On ballot' },
  ]
  const nbc = [
    { name: 'A - Referendum on the 2025 congressional redistricting map', yes: 28, no: 72, yesVotes: 1000, noVotes: 2571, pctIn: 13, result: 'Rejected', url: 'https://www.nbcnews.com/x' },
    { name: '3 - Repeal right to abortion and prohibit gender transition for minors', yes: 30.6, no: 69.4, yesVotes: 100, noVotes: 227, pctIn: 13.5, result: null, url: 'https://www.nbcnews.com/y' },
  ]
  const out = matchMeasures(list, nbc)
  assert.equal(out[0].status, 'Approved') // August measure untouched
  assert.equal(out[1].status, 'On ballot')
  assert.equal(out[1].no, '227 69.4%')
  assert.equal(out[2].status, 'Rejected')
  assert.equal(out[2].live.source, 'NBC News')
})

test('stripCalls drops Wikipedia results for tonight\'s measures only', async () => {
  const { stripCalls } = await import('../src/lib/calls.js')
  const d = { senate: {}, governor: {}, house: {}, measures: { MO: [{ title: 'x', date: 'Nov 3', status: 'Approved', yes: '1', no: '2' }, { title: 'y', date: 'Aug 4', status: 'Approved', yes: '1', no: '2' }] } }
  const out = stripCalls(d).measures.MO
  assert.equal(out[0].status, 'On ballot')
  assert.equal(out[0].yes, null)
  assert.equal(out[1].status, 'Approved')
})

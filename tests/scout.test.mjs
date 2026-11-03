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

// money.json comes from the network: the sanitizer must keep good rows and drop junk.
// Run: npm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { STATE_PORTALS, sanitizeMoney } from '../src/data/money.js'

test('sanitizeMoney keeps valid outside spending and drops junk', () => {
  const m = sanitizeMoney({
    generatedAt: '2026-10-20T12:00:00Z',
    outside: {
      'senate-GA': {
        total: 1000,
        candidates: [{ id: 'S0GA00559', name: 'Jon Ossoff', party: 'D', support: 900, oppose: 100 }, { name: '' }],
        spenders: [{ id: 'C1', name: 'Some PAC', type: 'Super PAC', candidate: 'Jon Ossoff', cid: 'S0GA00559', so: 'O', total: 100 }, { name: 'Zero', total: 0 }],
      },
      'senate-XX': { total: 0 },
    },
    governor: { GA: { candidates: [{ name: 'A', raised: '5', url: 'javascript:alert(1)' }] }, bad: { candidates: [{ name: 'B', raised: 1 }] } },
  })
  assert.deepEqual(Object.keys(m.outside), ['senate-GA'])
  assert.equal(m.outside['senate-GA'].candidates.length, 1)
  assert.equal(m.outside['senate-GA'].spenders.length, 1)
  assert.equal(m.outside['senate-GA'].spenders[0].so, 'O')
  assert.deepEqual(Object.keys(m.governor), ['GA'])
  assert.equal(m.governor.GA.candidates[0].raised, 5)
  assert.equal(m.governor.GA.candidates[0].url, null)
})

test('sanitizeMoney survives missing or garbage input', () => {
  for (const raw of [undefined, null, 'x', [], { outside: [], governor: 7 }]) {
    const m = sanitizeMoney(raw)
    assert.deepEqual(m.outside, {})
    assert.deepEqual(m.governor, {})
  }
})

test('every 2026 governor race has an official state filing link', () => {
  const states = 'AL AK AZ AR CA CO CT FL GA HI ID IL IA KS ME MD MA MI MN NE NV NH NM NY OH OK OR PA RI SC SD TN TX VT WI WY'.split(' ')
  for (const st of states) assert.match(STATE_PORTALS[st]?.[1] || '', /^https:\/\//, st)
})

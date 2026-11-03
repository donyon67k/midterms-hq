import { test } from 'node:test'
import assert from 'node:assert/strict'
import { controlCalls, stripCalls } from '../src/lib/calls.js'
import { applyControl, sanitizeControl } from '../src/data/control.js'

const race = (id, result) => ({ id, type: 'senate', state: 'PA', result, candidates: [{ name: 'A', party: 'D', won: !!result }, { name: 'B', party: 'R' }] })
const data = (r) => ({ senate: { PA: r }, governor: {}, house: {} })
const call = { winner: 'A', party: 'D', pct: 51, flip: false }

test('Wikipedia winner marks never become calls', () => {
  const out = stripCalls(data(race('pa', call)))
  assert.equal(out.senate.PA.result, null)
  assert.equal(out.senate.PA.candidates[0].won, false)
  const plain = race('pa', null)
  assert.equal(stripCalls(data(plain)).senate.PA, plain) // untouched races keep their identity
})

test('HQ hold hides a Wikipedia call; HQ call wins', () => {
  const held = applyControl(data(race('pa', call)), sanitizeControl({ results: { pa: { hold: true } } }))
  assert.equal(held.senate.PA.result, null)
  assert.equal(held.senate.PA.hqHold, true)
  const hq = applyControl(data(race('pa', null)), sanitizeControl({ results: { pa: { winner: 'B', party: 'R' } } }))
  assert.equal(hq.senate.PA.result.hq, true)
})

test('chamber control needs 51 D / 50 R in the Senate and 218 in the House', () => {
  assert.deepEqual(controlCalls({ sen: { d: 50, r: 49 }, house: { d: 217, r: 200 } }), { senate: null, house: null })
  assert.deepEqual(controlCalls({ sen: { d: 50, r: 50 }, house: { d: 218, r: 200 } }), { senate: 'R', house: 'D' })
  assert.deepEqual(controlCalls({ sen: { d: 51, r: 49 }, house: { d: 100, r: 218 } }), { senate: 'D', house: 'R' })
})

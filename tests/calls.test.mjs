import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CONFIRM_MS, controlCalls, holdCalls } from '../src/lib/calls.js'
import { applyControl, sanitizeControl } from '../src/data/control.js'

const race = (id, result) => ({ id, type: 'senate', state: 'PA', result, candidates: [{ name: 'A', party: 'D', won: !!result }, { name: 'B', party: 'R' }] })
const data = (r) => ({ senate: { PA: r }, governor: {}, house: {} })
const call = { winner: 'A', party: 'D', pct: 51, flip: false }

test('calls already on Wikipedia at first load are accepted', () => {
  const seen = new Map()
  const out = holdCalls(data(race('pa', call)), seen, 1000, true)
  assert.equal(out.data.senate.PA.result.winner, 'A')
  assert.equal(out.pending.length, 0)
})

test('a new call waits CONFIRM_MS, then appears', () => {
  const seen = new Map()
  holdCalls(data(race('pa', null)), seen, 0, true)
  let out = holdCalls(data(race('pa', call)), seen, 10_000)
  assert.equal(out.data.senate.PA.result, null)
  assert.equal(out.data.senate.PA.candidates[0].won, false)
  assert.equal(out.pending.length, 1)
  out = holdCalls(data(race('pa', call)), seen, 10_000 + CONFIRM_MS)
  assert.equal(out.data.senate.PA.result.winner, 'A')
  assert.equal(out.pending.length, 0)
})

test('a reverted call never shows, and a changed winner restarts the hold', () => {
  const seen = new Map()
  holdCalls(data(race('pa', null)), seen, 0, true)
  holdCalls(data(race('pa', call)), seen, 1000)
  holdCalls(data(race('pa', null)), seen, 30_000)
  let out = holdCalls(data(race('pa', call)), seen, 40_000)
  assert.equal(out.data.senate.PA.result, null) // timer restarted at 40s
  out = holdCalls(data(race('pa', { ...call, winner: 'B', party: 'R' })), seen, 40_000 + CONFIRM_MS)
  assert.equal(out.data.senate.PA.result, null)
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

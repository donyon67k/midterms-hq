import { useState } from 'react'
import { STATES } from '../data/wiki.js'
import { raceTitle, ratingClass, resultColor } from '../lib/util.js'
import ShareButton from './ShareButton.jsx'

// Prediction game: pick the winner of the big races before they're called. A pick locks the
// moment the race is called (no picking after the fact) and scores itself. Kept on this device.
const KEY = 'mhq:picks'
const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {} } catch { return {} } }
const save = (p) => { try { localStorage.setItem(KEY, JSON.stringify(p)) } catch { /* private mode */ } }

const isKey = (r) => r.type !== 'house' || Math.abs(r.consensus?.score ?? 9) < 1
const two = (r) => ['D', 'R'].map((p) => r.candidates.find((c) => c.party === p)).filter(Boolean)

export function scorePicks(picks, races) {
  const byId = Object.fromEntries(races.map((r) => [r.id, r]))
  let right = 0
  let done = 0
  for (const [id, p] of Object.entries(picks)) {
    const r = byId[id]
    if (!r?.result) continue // (picks can only be made while a race is open, so every scored pick came first)
    done++
    if (p.party === r.result.party) right++
  }
  return { right, done, made: Object.keys(picks).length }
}

export default function Picks({ data, onPick }) {
  const [picks, setPicks] = useState(load)
  const races = [...Object.values(data.senate), ...Object.values(data.governor), ...Object.values(data.house).flat()].filter(isKey)
  const open = races.filter((r) => !r.result && two(r).length === 2)
  const called = races.filter((r) => r.result && picks[r.id])
  const score = scorePicks(picks, races)
  const choose = (r, party) => setPicks((p) => {
    const next = { ...p }
    if (next[r.id]?.party === party) delete next[r.id]
    else next[r.id] = { party, at: Date.now() }
    save(next)
    return next
  })

  return (
    <div className="picks">
      <div className="picks-score">
        <span className="pixel big">{score.right}/{score.done}</span>
        <span className="dim">CORRECT SO FAR · {score.made} PICKS MADE · {open.length} RACES STILL OPEN TO PICK</span>
        {score.done > 0 && (
          <ShareButton filename="my-midterm-picks.png" card={() => ({
            kicker: '★ MY ELECTION NIGHT CALLS ★',
            title: 'PROJECT: MIDTERMS PREDICTION GAME',
            big: `${score.right} OF ${score.done} RIGHT`,
            color: '#ffd700',
            lines: [`${Math.round((score.right / score.done) * 100)}% accuracy`, `${score.made} races picked before they were called`],
            foot: 'Think you can beat it?',
          })} />
        )}
      </div>
      <div className="dim" style={{ margin: '6px 0 10px' }}>
        Pick the winner of each Senate, Governor and close House race before the desks call it. A pick locks when the race is called. Your picks stay on this device.
      </div>

      {open.length > 0 && <h5 className="pixel picks-h">OPEN · PICK NOW</h5>}
      <div className="sim-list">
        {open.map((r) => (
          <div key={r.id} className="sim-row">
            <button type="button" className="sim-name" onClick={() => onPick(r)}>{raceTitle(r, STATES)}</button>
            <span className={ratingClass(r.consensus?.label)}>{r.consensus?.label || '—'}</span>
            <span className="sim-pick wide" role="group" aria-label={`Your pick for ${raceTitle(r, STATES)}`}>
              {two(r).map((c) => (
                <button key={c.party} type="button" className={`sp-${c.party} ${picks[r.id]?.party === c.party ? 'on' : ''}`} aria-pressed={picks[r.id]?.party === c.party} onClick={() => choose(r, c.party)}>
                  {c.name.split(' ').pop()} ({c.party})
                </button>
              ))}
            </span>
          </div>
        ))}
      </div>

      {called.length > 0 && <h5 className="pixel picks-h">CALLED · YOUR RESULTS</h5>}
      <div className="sim-list">
        {called.map((r) => {
          const hit = picks[r.id].party === r.result.party
          return (
            <div key={r.id} className="sim-row">
              <button type="button" className="sim-name" onClick={() => onPick(r)}>{raceTitle(r, STATES)}</button>
              <span className="result-chip" style={{ background: resultColor(r.result) }}>{r.result.winner.split(' ').pop()} ({r.result.party})</span>
              <span className={`pixel pick-mark ${hit ? 'hit' : 'miss'}`}>{hit ? '✓ YOU CALLED IT' : `✗ YOU PICKED ${picks[r.id].party}`}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

import { useEffect, useState } from 'react'
import { STATES } from '../data/wiki.js'
import { ELECTION_DAY, POLL_WAVES, isElectionWindow, ratingClass, raceTitle, resultColor, tallyResults } from '../lib/util.js'
import { GOV_NOW, PowerBar, SENATE_NOW, chamber } from './Overview.jsx'
import Block from './Block.jsx'
import { CONFIRM_MS, PARTY_NAME } from '../lib/calls.js'

// Election-night command center: poll closings, live scoreboard, call feed,
// and which battlegrounds report in each wave.
function useMinuteClock() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 15000); return () => clearInterval(t) }, [])
  return now
}

const until = (ms) => {
  const m = Math.max(0, Math.round(ms / 6e4))
  const d = Math.floor(m / 1440)
  const h = Math.floor((m % 1440) / 60)
  return d ? `${d}D ${h}H` : h ? `${h}H ${m % 60}M` : `${m}M`
}

function nightStatus(now, called, total) {
  const next = POLL_WAVES.find((w) => w.at > now)
  const closed = POLL_WAVES.filter((w) => w.at <= now).reduce((n, w) => n + w.states.length, 0)
  if (now < ELECTION_DAY) return { head: `POLLS OPEN IN ${until(ELECTION_DAY - now)}`, sub: `First polls close 7:00 PM ET on Nov 3 · ${total} races on the board` }
  if (!closed) return { head: 'POLLS ARE OPEN', sub: `First closings in ${until(next.at - now)} (${next.label})` }
  if (next) return { head: `${closed}/50 STATES CLOSED`, sub: `Next: ${next.states.length} state${next.states.length > 1 ? 's' : ''} at ${next.label} (in ${until(next.at - now)}) · ${called}/${total} races called` }
  return { head: 'ALL POLLS CLOSED', sub: `${called}/${total} races called · counting continues` }
}

// Uncalled race with a live count: who leads, by how much, and how much is in.
function leadOf(r) {
  const c = r.count?.cands?.filter((x) => x.pct != null).sort((a, b) => b.pct - a.pct)
  if (!c?.length) return null
  const m = c.length > 1 ? (c[0].pct - c[1].pct).toFixed(1) : null
  return <span className="lead-chip" style={{ '--rc': resultColor({ party: c[0].party }) }}>{c[0].party} +{m ?? '?'}{r.count.pctIn != null ? ` · ${Math.round(r.count.pctIn)}% IN` : ''}</span>
}

export default function Gameday({ data, onPick, onPickState, log, watch, pending = [], chambers = {}, bursts }) {
  const now = useMinuteClock()
  const senRaces = Object.values(data.senate)
  const govRaces = Object.values(data.governor)
  const houseRaces = Object.values(data.house).flat()
  const all = [...senRaces, ...govRaces, ...houseRaces]

  const sen = chamber(senRaces, SENATE_NOW, true)
  const gov = chamber(govRaces, GOV_NOW, true)
  const ht = tallyResults(houseRaces)
  const house = { d: ht.D, r: ht.R, toss: ht.uncalled + ht.I }
  const called = all.filter((r) => r.result).length
  const status = nightStatus(now, called, all.length)

  const key = (r) => (r.consensus && Math.abs(r.consensus.score) < 1) || watch.ids.includes(r.id)
  const byState = {}
  for (const r of all) if (key(r)) (byState[r.state] ||= []).push(r)
  for (const list of Object.values(byState)) list.sort((a, b) => Math.abs(a.consensus?.score ?? 9) - Math.abs(b.consensus?.score ?? 9))

  const calls = log.filter((l) => l.kind === 'call' || l.kind === 'withdraw')
  const flips = all.filter((r) => r.result?.flip)

  const RaceRow = ({ r }) => (
    <button type="button" className="watch" onClick={() => onPick(r)}>
      <span>{watch.ids.includes(r.id) ? '★ ' : ''}{raceTitle(r, STATES)}</span>
      {r.result
        ? <span className="result-chip" style={{ background: resultColor(r.result) }}>{r.result.party} {r.result.flip ? 'GAIN' : 'HOLD'}{r.result.pct ? ` ${r.result.pct}%` : ''}</span>
        : leadOf(r) || <span className={ratingClass(r.consensus?.label)}>{r.consensus?.label || 'AWAITING'}</span>}
    </button>
  )

  return (
    <aside className="dossier overview gameday" aria-label="Gameday">
      <div className="dossier-head">
        <div>
          <div className="stamp">GAMEDAY // NOV 3 · ELECTION NIGHT</div>
          <h2 className="pixel glow-amber">{status.head}</h2>
          <div className="dossier-meta">
            {status.sub}{isElectionWindow(now) ? ' · live refresh every 30s' : ''}
          </div>
        </div>
        {bursts && (
          <button type="button" className="btn-mini" onClick={bursts.toggle} aria-pressed={bursts.on} title="Celebration pop-ups when races are called">
            {bursts.on ? '✦ CALL BURSTS ON' : '✧ CALL BURSTS OFF'}
          </button>
        )}
      </div>
      <div className="dossier-body">
        {(chambers.senate || chambers.house) && (
          <div className="control-calls">
            {['senate', 'house'].filter((c) => chambers[c]).map((c) => (
              <div key={c} className="control-call pixel" style={{ '--rc': resultColor({ party: chambers[c] }) }}>
                ★ {c.toUpperCase()} CONTROL: {PARTY_NAME[chambers[c]]} ★
              </div>
            ))}
          </div>
        )}
        <PowerBar label="SENATE" icon="senate" total={100} control="D NEEDS 51 · R NEEDS 50 (VP TIEBREAK)" middle="UNCALLED" {...sen} />
        <PowerBar label="HOUSE" icon="house" total={435} control="218 FOR CONTROL" middle="UNCALLED" {...house} />
        <PowerBar label="GOVERNORS" icon="governor" total={50} middle="UNCALLED" {...gov} />

        {pending.length > 0 && (
          <Block title={<>⧗ CONFIRMING CALLS ({pending.length})</>}>
            <div className="dim" style={{ marginBottom: 6 }}>Being checked against other sources before going on the board.</div>
            <div className="log">{pending.map((p) => (
              <div key={p.race.id} className="log-line pending">
                <span className="dim">[~{Math.max(0, Math.ceil((p.at + CONFIRM_MS - now) / 1000))}s]</span> {raceTitle(p.race, STATES)}: {p.result.winner} ({p.result.party})
              </div>
            ))}</div>
          </Block>
        )}

        <Block title="▣ CALL FEED">
          {calls.length
            ? <div className="log">{calls.map((l, i) => (
              <div key={i} className={`log-line ${l.kind}`}><span className="dim">[{new Date(l.t).toLocaleTimeString()}]</span> {l.msg}</div>
            ))}</div>
            : <div className="dim">{called
              ? `${called} races already called before this session. New calls will stream in here.`
              : 'No races called yet. Calls stream in here (and as desktop alerts) as Wikipedia marks winners after polls close.'}</div>}
          <div className="dim call-source">
            HOW RACES ARE CALLED: the HQ call scout uses a strict method and never calls a race unless multiple sources agree on the result. Each call links its sources in the race file. Projections are unofficial until states certify.
          </div>
        </Block>

        {flips.length > 0 && (
          <Block title={<>⚑ SEATS THAT FLIPPED ({flips.length})</>}>
            <div className="watchlist">{flips.map((r) => <RaceRow key={r.id} r={r} />)}</div>
          </Block>
        )}

        <Block title="▣ POLL CLOSINGS · WHAT TO WATCH">
          <div className="dim" style={{ marginBottom: 8 }}>When the last polls close in each state (ET). Battleground and starred races listed under their wave.</div>
          {POLL_WAVES.map((w) => {
            const closed = w.at <= now
            const isNext = !closed && POLL_WAVES.find((x) => x.at > now) === w
            const races = w.states.flatMap((st) => byState[st] || [])
            const done = races.filter((r) => r.result).length
            return (
              <div key={w.label} className={`wave ${closed ? 'closed' : ''} ${isNext ? 'next' : ''}`}>
                <div className="wave-head">
                  <span className="pixel">{w.label}</span>
                  <span className="dim">{closed ? `CLOSED${races.length ? ` · ${done}/${races.length} KEY RACES CALLED` : ''}` : isNext ? `NEXT · IN ${until(w.at - now)}` : `${races.length} KEY RACE${races.length === 1 ? '' : 'S'}`}</span>
                </div>
                <div className="wave-states">
                  {w.states.map((st) => (
                    <button key={st} type="button" className={`wave-st ${byState[st] ? 'hot' : ''}`} onClick={() => onPickState(st)} title={STATES[st]}>{st}</button>
                  ))}
                </div>
                {races.length > 0 && <div className="watchlist">{races.slice(0, 12).map((r) => <RaceRow key={r.id} r={r} />)}</div>}
                {races.length > 12 && <div className="dim">+{races.length - 12} more in these states</div>}
              </div>
            )
          })}
        </Block>
      </div>
    </aside>
  )
}

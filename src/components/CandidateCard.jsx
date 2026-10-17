import { useEffect, useState } from 'react'
import { candidatePositions, candidateSummary, commonsThumb } from '../data/live.js'
import { partyBadge, partyColor, wikiUrl } from '../lib/util.js'
import { AgentSprite, PartySprite } from './Sprites.jsx'

export function Avatar({ src, name, party, size = 72 }) {
  const [failed, setFailed] = useState(false)
  if (!src || failed) {
    return (
      <div className="avatar" style={{ width: size, height: size, borderColor: partyColor(party) }}>
        <AgentSprite name={name} party={party} size={size - 8} />
      </div>
    )
  }
  return (
    <div className="avatar" style={{ width: size, height: size, borderColor: partyColor(party) }}>
      <img src={src} alt={name} onError={() => setFailed(true)} />
      <div className="avatar-scan" />
    </div>
  )
}

export default function CandidateCard({ cand, image, incumbent, money, leading, result }) {
  const [sum, setSum] = useState(null)
  const [pos, setPos] = useState(undefined)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    let live = true
    setSum(null)
    if (cand.link) candidateSummary(cand.link).then((s) => live && setSum(s)).catch(() => {})
    return () => { live = false }
  }, [cand.link])

  const loadPlatform = () => {
    setOpen((o) => !o)
    if (pos === undefined && cand.link) {
      setPos(null)
      candidatePositions(cand.link).then((p) => setPos(p || false)).catch(() => setPos(false))
    }
  }

  const photo = image ? commonsThumb(image, 40) : sum?.thumb ? sum.thumb.replace(/\/\d+px-/, '/40px-') : null
  const brief = sum?.extract ? sum.extract.split(/(?<=\.)\s/).slice(0, 3).join(' ') : null

  return (
    <div className={`cand-card ${result === 'lost' ? 'lost' : ''}`} style={{ '--pc': partyColor(cand.party) }}>
      <div className="cand-top">
        <Avatar src={photo} name={cand.name} party={cand.party} />
        <div className="cand-id">
          <div className="cand-name">
            {cand.name}
            {incumbent && <span className="tag-inc">INCUMBENT</span>}
            {leading && <span className="tag-lead">▲ POLL LEAD</span>}
            {result === 'won' && <span className="tag-won">✓ WINNER{cand.pct ? ` ${cand.pct}%` : ''}</span>}
            {result === 'lost' && cand.pct != null && <span className="tag-lost">{cand.pct}%</span>}
          </div>
          <div className="cand-party">
            <span className={partyBadge(cand.party)}>{cand.party}</span>
            <span>{cand.partyName}</span>
            <PartySprite party={cand.party} size={22} />
          </div>
          <div className="cand-desc">{sum?.description || (cand.link ? 'DECRYPTING…' : 'NO PUBLIC DOSSIER ON FILE')}</div>
        </div>
      </div>

      {brief && <p className="cand-brief">{brief}</p>}

      {money && (
        <div className="cand-money">
          <span>RAISED <b>{money.raised}</b></span>
          <span>SPENT <b>{money.spent}</b></span>
          <span>CASH <b>{money.cash}</b></span>
        </div>
      )}

      {cand.link && (
        <div className="cand-actions">
          <button type="button" className="btn-mini" onClick={loadPlatform} aria-expanded={open}>
            {open ? '▼' : '▶'} PLATFORM INTEL
          </button>
          <a className="btn-mini" href={sum?.url || wikiUrl(cand.link)} target="_blank" rel="noreferrer">FULL FILE ↗</a>
        </div>
      )}

      {open && (
        <div className="platform">
          {pos === null && <div className="loading">RETRIEVING POSITIONS<span className="blink">_</span></div>}
          {pos === false && <div className="dim">No “Political positions” section on file for this candidate. Check their full file.</div>}
          {pos && (
            <>
              {pos.intro && <p>{pos.intro}</p>}
              {pos.items.map((it) => (
                <details key={it.issue}>
                  <summary>{it.issue}</summary>
                  <p>{it.text || '—'}</p>
                </details>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  )
}

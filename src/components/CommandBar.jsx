import { useEffect, useMemo, useRef, useState } from 'react'
import { STATES } from '../data/wiki.js'
import { districtLabel, incLabel, partyColor, ratingClass } from '../lib/util.js'
import { Icon } from './Sprites.jsx'

const names = (r) => r.candidates.map((c) => c.name).join(' · ')

// Every state, race, candidate and measure as one searchable list.
function buildIndex(data) {
  const items = []
  for (const [abbr, name] of Object.entries(STATES)) {
    items.push({ id: `st-${abbr}`, icon: 'radar', label: name, sub: `State file · ${abbr}`, hay: `${name} ${abbr}`, go: { state: abbr } })
  }
  for (const r of Object.values(data.senate)) {
    items.push({
      id: r.id, icon: 'senate', race: r,
      label: `${STATES[r.state]} Senate${r.special ? ' (special)' : ''}`,
      sub: names(r) || incLabel(r.incumbent),
      hay: `${STATES[r.state]} ${r.state} senate ${r.special ? 'special' : ''} ${names(r)} ${r.incumbent.name || ''}`,
      go: { state: r.state, mode: 'senate', tab: r.id },
    })
  }
  for (const r of Object.values(data.governor)) {
    items.push({
      id: r.id, icon: 'governor', race: r,
      label: `${STATES[r.state]} Governor`,
      sub: names(r) || incLabel(r.incumbent),
      hay: `${STATES[r.state]} ${r.state} governor gov ${names(r)} ${r.incumbent.name || ''}`,
      go: { state: r.state, mode: 'governor', tab: r.id },
    })
  }
  for (const r of Object.values(data.house).flat()) {
    const label = districtLabel(r.state, r.district)
    items.push({
      id: r.id, icon: 'house', race: r,
      label,
      sub: `${incLabel(r.incumbent)} · ${r.candidates.filter((c) => c.party === 'D' || c.party === 'R').map((c) => c.name).join(' v ')}`,
      hay: `${label} ${r.state}${r.district} ${r.state}-${r.district} ${STATES[r.state]} house district ${names(r)} ${r.incumbent.name || ''}`,
      go: { state: r.state, mode: 'house', tab: 'house', district: r.key },
    })
  }
  for (const [st, list] of Object.entries(data.measures)) {
    list.forEach((m, i) => items.push({
      id: `m-${st}-${i}`, icon: 'measures',
      label: m.title, sub: `${STATES[st]} · ${m.status}`,
      hay: `${m.title} ${STATES[st]} ${st} measure proposition prop amendment ${m.description}`,
      go: { state: st, mode: 'measures', tab: 'measures' },
    }))
  }
  for (const it of items) it.hay = it.hay.toLowerCase()
  return items
}

function search(items, q) {
  const terms = q.toLowerCase().trim().split(/\s+/).filter(Boolean)
  if (!terms.length) return []
  const score = (it) => {
    const l = it.label.toLowerCase()
    if (l === q.toLowerCase().trim()) return 0
    if (l.startsWith(terms[0])) return 1
    if (it.race) return 2
    return 3
  }
  return items.filter((it) => terms.every((t) => it.hay.includes(t))).sort((a, b) => score(a) - score(b)).slice(0, 40)
}

export default function CommandBar({ data, open, onClose, onGo }) {
  const index = useMemo(() => buildIndex(data), [data])
  const [q, setQ] = useState('')
  const [cursor, setCursor] = useState(0)
  const input = useRef(null)
  const list = useRef(null)
  const hits = useMemo(() => search(index, q), [index, q])

  useEffect(() => { if (open) { setQ(''); setCursor(0); setTimeout(() => input.current?.focus(), 0) } }, [open])
  useEffect(() => { list.current?.querySelector('.on')?.scrollIntoView({ block: 'nearest' }) }, [cursor])

  if (!open) return null

  const pick = (it) => { if (it) { onGo(it.go); onClose() } }
  const onKey = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose() }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setCursor((c) => Math.min(hits.length - 1, c + 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setCursor((c) => Math.max(0, c - 1)) }
    else if (e.key === 'Enter') { e.preventDefault(); pick(hits[cursor]) }
  }

  return (
    <div className="cmd-backdrop" onMouseDown={onClose}>
      <div className="cmd" role="dialog" aria-label="Search" onMouseDown={(e) => e.stopPropagation()}>
        <div className="cmd-input">
          <span className="pixel">⌕</span>
          <input
            ref={input}
            value={q}
            onChange={(e) => { setQ(e.target.value); setCursor(0) }}
            onKeyDown={onKey}
            placeholder="Search states, races, districts (TX-28), candidates, measures…"
            aria-label="Search"
            role="combobox"
            aria-expanded={hits.length > 0}
            aria-controls="cmd-results"
          />
          <kbd>ESC</kbd>
        </div>
        <div className="cmd-results" id="cmd-results" role="listbox" ref={list}>
          {q && !hits.length && <div className="dim cmd-empty">NO MATCHING INTEL</div>}
          {!q && <div className="dim cmd-empty">Try “Talarico”, “GA governor”, “CA-22”, “abortion”, “Maine”.</div>}
          {hits.map((it, i) => (
            <button
              key={it.id}
              type="button"
              role="option"
              aria-selected={i === cursor}
              className={`cmd-hit ${i === cursor ? 'on' : ''}`}
              onMouseEnter={() => setCursor(i)}
              onClick={() => pick(it)}
            >
              <Icon name={it.icon} size={14} color={i === cursor ? '#050510' : '#00ff41'} />
              <span className="cmd-label">{it.label}</span>
              <span className="cmd-sub">{it.sub}</span>
              {it.race?.consensus && <span className={ratingClass(it.race.consensus.label)}>{it.race.consensus.label}</span>}
              {it.race?.result && <span className="result-chip" style={{ background: partyColor(it.race.result.party) }}>✓ {it.race.result.party}</span>}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

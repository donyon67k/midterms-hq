import { useEffect, useMemo, useState } from 'react'
import snapshot from '../data/snapshot.json'
import { STATES } from '../data/wiki.js'
import { EMPTY_CONTROL } from '../data/control.js'
import { raceTitle } from '../lib/util.js'

// Local admin page for the live control file. Served only by the dev server
// (npm run admin); SAVE writes live/control.json, PUBLISH pushes it to GitHub.
const LABELS = ['Safe D', 'Likely D', 'Lean D', 'Tilt D', 'Tossup', 'Tilt R', 'Lean R', 'Likely R', 'Safe R']
const api = (path, body) => fetch(`/__admin/${path}`, {
  method: body === undefined ? 'GET' : 'POST',
  headers: { 'X-MHQ-Admin': '1', 'Content-Type': 'application/json' },
  body: body === undefined ? undefined : JSON.stringify(body),
}).then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error || r.status); return j })

const RACES = [
  ...Object.values(snapshot.senate),
  ...Object.values(snapshot.governor),
  ...Object.values(snapshot.house).flat(),
].map((r) => ({ id: r.id, title: raceTitle(r, STATES), candidates: r.candidates, label: r.consensus?.label }))
const BY_ID = Object.fromEntries(RACES.map((r) => [r.id, r]))
const titleOf = (id) => BY_ID[id]?.title || id

function RacePicker({ value, onChange, placeholder = 'Type a race: "Georgia Governor", "TX-15"…' }) {
  const [q, setQ] = useState(value ? titleOf(value) : '')
  const match = RACES.find((r) => r.title.toLowerCase() === q.trim().toLowerCase())
  useEffect(() => { onChange(match?.id || null) }, [match?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <>
      <input list="races" value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} className={q && !match ? 'bad' : ''} />
      <datalist id="races">{RACES.map((r) => <option key={r.id} value={r.title} />)}</datalist>
    </>
  )
}

export default function Admin() {
  const [ctl, setCtl] = useState(null)
  const [saved, setSaved] = useState(null)
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api('control').then((c) => { const v = { ...EMPTY_CONTROL, ...c }; setCtl(v); setSaved(JSON.stringify(v)) })
      .catch((e) => setStatus(`Could not load: ${e.message}. Is this the dev server (npm run admin)?`))
  }, [])

  const dirty = ctl && JSON.stringify(ctl) !== saved
  const set = (patch) => setCtl((c) => ({ ...c, ...patch }))
  const setIn = (key, id, v) => setCtl((c) => {
    const next = { ...c[key] }
    if (v == null || v === '') delete next[id]
    else next[id] = v
    return { ...c, [key]: next }
  })

  const save = async () => {
    setBusy(true)
    try {
      const r = await api('control', ctl)
      const v = { ...ctl, updatedAt: r.updatedAt }
      setCtl(v); setSaved(JSON.stringify(v))
      setStatus('Saved locally. The dev app (npm run dev) previews it now; PUBLISH sends it to everyone.')
      return true
    } catch (e) { setStatus(`Save failed: ${e.message}`); return false } finally { setBusy(false) }
  }
  const publish = async () => {
    if (dirty && !(await save())) return
    setBusy(true)
    setStatus('Publishing…')
    try { setStatus((await api('publish', {})).output) } catch (e) { setStatus(`Publish failed: ${e.message}`) } finally { setBusy(false) }
  }

  // draft rows for "add" forms
  const [noteId, setNoteId] = useState(null)
  const [rateId, setRateId] = useState(null)
  const [resId, setResId] = useState(null)
  const [featId, setFeatId] = useState(null)
  const [head, setHead] = useState({ title: '', url: '' })
  const [headRace, setHeadRace] = useState(null)
  const [pickerKey, setPickerKey] = useState(0)
  const resetPickers = () => setPickerKey((k) => k + 1)

  const resultCands = useMemo(() => (resId ? BY_ID[resId]?.candidates || [] : []), [resId])

  if (!ctl) return <div className="admin"><h1 className="pixel">HQ ADMIN</h1><p>{status || 'Loading…'}</p></div>

  const b = ctl.banner || { text: '', level: 'info', link: '' }

  return (
    <div className="admin">
      <header>
        <h1 className="pixel glow">HQ ADMIN</h1>
        <p className="dim">
          Live control file · changes reach every installed copy ~5 min after PUBLISH, no app update needed.
          {ctl.updatedAt && <> Last saved {new Date(ctl.updatedAt).toLocaleString()}.</>}
        </p>
        <div className="bar">
          <button type="button" onClick={save} disabled={busy || !dirty}>{dirty ? 'SAVE DRAFT' : 'SAVED'}</button>
          <button type="button" className="go" onClick={publish} disabled={busy}>PUBLISH TO EVERYONE</button>
          <a href="/" target="_blank" rel="noreferrer">OPEN APP PREVIEW ↗</a>
        </div>
        {status && <pre className="status">{status}</pre>}
      </header>

      <section>
        <h2 className="pixel">◆ BROADCAST BANNER</h2>
        <p className="dim">Shown at the top of everyone's app until they dismiss it. Changing the text shows it again.</p>
        <textarea rows={2} maxLength={280} value={b.text} placeholder="e.g. Polls just closed in GA, VA, KY. First calls incoming." onChange={(e) => set({ banner: e.target.value ? { ...b, text: e.target.value, id: `b${Date.now()}` } : null })} />
        <div className="row">
          <select value={b.level} disabled={!b.text} onChange={(e) => set({ banner: { ...b, level: e.target.value } })}>
            <option value="info">Info (green)</option>
            <option value="alert">Alert (red)</option>
          </select>
          <input value={b.link || ''} disabled={!b.text} placeholder="Optional link (https://…)" onChange={(e) => set({ banner: { ...b, link: e.target.value } })} />
          {b.text && <button type="button" onClick={() => set({ banner: null })}>REMOVE</button>}
        </div>
      </section>

      <section>
        <h2 className="pixel">◆ HQ PICKS</h2>
        <p className="dim">Featured at the top of the Situation Room, in this order.</p>
        <ol className="list">
          {ctl.featured.map((id, i) => (
            <li key={id}>
              {titleOf(id)}
              <span>
                <button type="button" disabled={!i} onClick={() => { const f = [...ctl.featured]; [f[i - 1], f[i]] = [f[i], f[i - 1]]; set({ featured: f }) }}>▲</button>
                <button type="button" onClick={() => set({ featured: ctl.featured.filter((x) => x !== id) })}>✕</button>
              </span>
            </li>
          ))}
        </ol>
        <div className="row" key={`f${pickerKey}`}>
          <RacePicker onChange={setFeatId} />
          <button type="button" disabled={!featId || ctl.featured.includes(featId)} onClick={() => { set({ featured: [...ctl.featured, featId] }); resetPickers() }}>ADD</button>
        </div>
      </section>

      <section>
        <h2 className="pixel">◆ PINNED HEADLINES</h2>
        <p className="dim">Top of the News Desk (HQ BRIEFING), or at the top of one race's news wire if you pick a race.</p>
        <ol className="list">
          {ctl.news.map((n, i) => (
            <li key={n.url}>
              <span style={{ display: 'block' }}>{n.title} <span className="dim">· {n.race ? titleOf(n.race) : 'News Desk'}</span></span>
              <span>
                <button type="button" disabled={!i} onClick={() => { const f = [...ctl.news]; [f[i - 1], f[i]] = [f[i], f[i - 1]]; set({ news: f }) }}>▲</button>
                <button type="button" onClick={() => set({ news: ctl.news.filter((x) => x !== n) })}>✕</button>
              </span>
            </li>
          ))}
        </ol>
        <div className="row" key={`h${pickerKey}`}>
          <input value={head.title} maxLength={200} placeholder="Headline" onChange={(e) => setHead({ ...head, title: e.target.value })} />
          <input value={head.url} placeholder="https://… article link" className={head.url && !/^https:\/\/\S+$/.test(head.url) ? 'bad' : ''} onChange={(e) => setHead({ ...head, url: e.target.value.trim() })} />
          <RacePicker onChange={setHeadRace} placeholder="Optional race (blank = News Desk)" />
          <button type="button" disabled={!head.title.trim() || !/^https:\/\/\S+$/.test(head.url) || ctl.news.some((n) => n.url === head.url) || ctl.news.length >= 12} onClick={() => {
            set({ news: [...ctl.news, { title: head.title.trim(), url: head.url, race: headRace }] }); setHead({ title: '', url: '' }); resetPickers()
          }}>PIN</button>
        </div>
      </section>

      <section>
        <h2 className="pixel">◆ HQ NOTES</h2>
        <p className="dim">Your analysis, shown at the top of that race's file.</p>
        {Object.entries(ctl.notes).map(([id, text]) => (
          <div key={id} className="note">
            <div className="row"><b>{titleOf(id)}</b><button type="button" onClick={() => setIn('notes', id, null)}>DELETE</button></div>
            <textarea rows={3} maxLength={1200} value={text} onChange={(e) => setIn('notes', id, e.target.value)} />
          </div>
        ))}
        <div className="row" key={`n${pickerKey}`}>
          <RacePicker onChange={setNoteId} />
          <button type="button" disabled={!noteId || ctl.notes[noteId]} onClick={() => { setIn('notes', noteId, 'New note'); resetPickers() }}>ADD NOTE</button>
        </div>
      </section>

      <section>
        <h2 className="pixel">◆ RATING OVERRIDES</h2>
        <p className="dim">Replaces the forecaster consensus on the map and in the race file (marked “HQ rating”).</p>
        {Object.entries(ctl.ratings).map(([id, label]) => (
          <div key={id} className="row">
            <b>{titleOf(id)}</b> <span className="dim">consensus: {BY_ID[id]?.label || '—'}</span>
            <select value={label} onChange={(e) => setIn('ratings', id, e.target.value)}>{LABELS.map((l) => <option key={l}>{l}</option>)}</select>
            <button type="button" onClick={() => setIn('ratings', id, null)}>✕</button>
          </div>
        ))}
        <div className="row" key={`r${pickerKey}`}>
          <RacePicker onChange={setRateId} />
          <button type="button" disabled={!rateId || ctl.ratings[rateId]} onClick={() => { setIn('ratings', rateId, BY_ID[rateId]?.label || 'Tossup'); resetPickers() }}>ADD</button>
        </div>
      </section>

      <section>
        <h2 className="pixel">◆ RESULT OVERRIDES</h2>
        <p className="dim">Election night backup: call a race yourself if Wikipedia is slow or wrong. Remove it once Wikipedia catches up.</p>
        {Object.entries(ctl.results).map(([id, r]) => (
          <div key={id} className="row">
            <b>{titleOf(id)}</b>
            <select value={r.winner} onChange={(e) => {
              const c = BY_ID[id]?.candidates.find((x) => x.name === e.target.value)
              setIn('results', id, { ...r, winner: e.target.value, party: ['D', 'R'].includes(c?.party) ? c.party : 'I' })
            }}>
              {(BY_ID[id]?.candidates || []).map((c) => <option key={c.name} value={c.name}>{c.name} ({c.party})</option>)}
            </select>
            <input type="number" step="0.1" min="0" max="100" value={r.pct ?? ''} placeholder="%" style={{ width: 80 }} onChange={(e) => setIn('results', id, { ...r, pct: e.target.value === '' ? null : +e.target.value })} />
            <label><input type="checkbox" checked={r.flip} onChange={(e) => setIn('results', id, { ...r, flip: e.target.checked })} /> FLIP</label>
            <button type="button" onClick={() => setIn('results', id, null)}>✕</button>
          </div>
        ))}
        <div className="row" key={`x${pickerKey}`}>
          <RacePicker onChange={setResId} />
          <button type="button" disabled={!resId || ctl.results[resId] || !resultCands.length} onClick={() => {
            const c = resultCands.find((x) => x.party === 'D' || x.party === 'R') || resultCands[0]
            setIn('results', resId, { winner: c.name, party: ['D', 'R'].includes(c.party) ? c.party : 'I', pct: null, flip: false }); resetPickers()
          }}>CALL RACE</button>
        </div>
      </section>

      <section>
        <h2 className="pixel">◆ MINIMUM VERSION</h2>
        <p className="dim">Copies older than this show a red “update required” banner. Leave blank normally.</p>
        <input value={ctl.minVersion || ''} placeholder="e.g. 1.0.1" style={{ width: 160 }} onChange={(e) => set({ minVersion: e.target.value.trim() || null })} />
      </section>
    </div>
  )
}

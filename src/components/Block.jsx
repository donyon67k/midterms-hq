import { useEffect, useState } from 'react'
import { usePhone } from '../lib/phone.js'

// Open a folded Block from elsewhere (e.g. the breaking-news bar jumping to the wire).
export const openBlock = (id) => window.dispatchEvent(new CustomEvent('mhq:open-block', { detail: id }))

// A titled intel section. On computers it's a plain heading + content, exactly as before.
// On phones the heading becomes a tap-to-open bar that slides the content open 8-bit style;
// `closed` sections start folded so a long file reads as a menu of headings.
export default function Block({ title, closed = false, className = '', id, children }) {
  const phone = usePhone()
  const [open, setOpen] = useState(!closed)
  useEffect(() => {
    if (!id) return
    const f = (e) => { if (e.detail === id) setOpen(true) }
    window.addEventListener('mhq:open-block', f)
    return () => window.removeEventListener('mhq:open-block', f)
  }, [id])

  if (!phone) {
    return (
      <section className={`intel-block ${className}`} id={id}>
        <h4 className="pixel">{title}</h4>
        {children}
      </section>
    )
  }
  return (
    <section className={`intel-block fold ${open ? 'open' : ''} ${className}`} id={id}>
      <h4 className="pixel">
        <button type="button" className="fold-head" aria-expanded={open} onClick={() => setOpen(!open)}>
          <span>{title}</span><span className="fold-caret" aria-hidden="true">▾</span>
        </button>
      </h4>
      <div className="fold-body" inert={!open}><div className="fold-inner">{children}</div></div>
    </section>
  )
}

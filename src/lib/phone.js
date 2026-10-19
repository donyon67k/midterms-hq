import { useEffect, useState } from 'react'

// Phone layout breakpoint; matches the `max-width: 640px` block in App.css.
const PHONE = typeof window !== 'undefined' ? window.matchMedia('(max-width: 640px)') : null

export function usePhone() {
  const [on, setOn] = useState(() => !!PHONE?.matches)
  useEffect(() => {
    if (!PHONE) return
    const f = () => setOn(PHONE.matches)
    PHONE.addEventListener('change', f)
    return () => PHONE.removeEventListener('change', f)
  }, [])
  return on
}

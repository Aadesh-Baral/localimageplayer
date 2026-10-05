import { useEffect, useRef, useState } from 'react'

const supported =
  typeof navigator !== 'undefined' && 'wakeLock' in navigator

/**
 * Holds a screen wake lock while `enabled` is true, so the display doesn't
 * dim or sleep mid-slideshow.
 *
 * Two things the spec forces on us:
 *  - The lock is dropped automatically whenever the page stops being visible
 *    (tab switch, minimise, screen already locked), so we re-request it on
 *    every `visibilitychange` back to visible.
 *  - It requires a secure context. `localhost` counts, so dev works; if you
 *    serve the build from a plain http:// host on the LAN, it won't.
 *
 * Returns { active, supported, error }.
 */
export default function useWakeLock(enabled = true) {
  const [active, setActive] = useState(false)
  const [error, setError] = useState(null)
  const sentinelRef = useRef(null)

  useEffect(() => {
    if (!supported || !enabled) return

    let cancelled = false

    const acquire = async () => {
      if (document.visibilityState !== 'visible') return
      if (sentinelRef.current) return
      try {
        const sentinel = await navigator.wakeLock.request('screen')
        if (cancelled) {
          sentinel.release().catch(() => {})
          return
        }
        sentinelRef.current = sentinel
        setActive(true)
        setError(null)
        sentinel.addEventListener('release', () => {
          sentinelRef.current = null
          setActive(false)
        })
      } catch (e) {
        // Most often NotAllowedError: insecure context, or the OS refused
        // (battery saver on some laptops will deny it).
        setError(e?.message || String(e))
        setActive(false)
      }
    }

    const onVisibility = () => {
      if (document.visibilityState === 'visible') acquire()
    }

    acquire()
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVisibility)
      sentinelRef.current?.release().catch(() => {})
      sentinelRef.current = null
      setActive(false)
    }
  }, [enabled])

  return { active, supported, error }
}

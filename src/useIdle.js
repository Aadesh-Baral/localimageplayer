import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Returns { idle, wake } — `idle` flips true after `delay` ms with no pointer,
 * key, touch or wheel activity. Call `wake()` to reset the timer manually.
 */
export default function useIdle(delay = 2500, enabled = true) {
  const [idle, setIdle] = useState(false)
  const timer = useRef(null)

  const wake = useCallback(() => {
    setIdle(false)
    if (timer.current) clearTimeout(timer.current)
    if (enabled) {
      timer.current = setTimeout(() => setIdle(true), delay)
    }
  }, [delay, enabled])

  useEffect(() => {
    if (!enabled) {
      if (timer.current) clearTimeout(timer.current)
      setIdle(false)
      return
    }

    const events = [
      'mousemove',
      'mousedown',
      'keydown',
      'wheel',
      'touchstart',
      'touchmove',
    ]
    events.forEach((e) => window.addEventListener(e, wake, { passive: true }))
    wake()

    return () => {
      events.forEach((e) => window.removeEventListener(e, wake))
      if (timer.current) clearTimeout(timer.current)
    }
  }, [enabled, wake])

  return { idle, wake }
}

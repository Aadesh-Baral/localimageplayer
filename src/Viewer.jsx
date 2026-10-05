import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { displaySrc, fallbackSrc } from './media'
import useIdle from './useIdle'
import useWakeLock from './useWakeLock'
import Slide from './Slide'
import ViewerGroupMenu from './ViewerGroupMenu'

const INTERVALS = [2, 3, 5, 8, 15, 30]

export default function Viewer({ images, startIndex = 0, groupsApi, onExit, exitLabel = '← Library' }) {
  const [order, setOrder] = useState(() => images.map((_, i) => i))
  const [pos, setPos] = useState(() =>
    Math.min(Math.max(0, startIndex), Math.max(0, images.length - 1))
  )
  const [playing, setPlaying] = useState(false)
  const [interval, setIntervalSec] = useState(5)
  const [shuffle, setShuffle] = useState(false)
  const [loop, setLoop] = useState(true)
  const [showHelp, setShowHelp] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [keepAwake, setKeepAwake] = useState(true)
  const [groupMenuOpen, setGroupMenuOpen] = useState(false)
  const [toast, setToast] = useState(null)
  const containerRef = useRef(null)

  const { idle, wake } = useIdle(2500, !showHelp && !groupMenuOpen)
  const {
    active: awake,
    supported: wakeSupported,
    error: wakeError,
  } = useWakeLock(keepAwake)
  const controlsHidden = idle && !showHelp && !groupMenuOpen

  const current = images[order[pos]]
  const nextIdx = order[(pos + 1) % order.length]
  const prevIdx = order[(pos - 1 + order.length) % order.length]

  // ---- navigation ---------------------------------------------------------
  const go = useCallback(
    (delta) => {
      setPos((p) => {
        const n = p + delta
        if (n >= order.length) return loop ? 0 : p
        if (n < 0) return loop ? order.length - 1 : p
        return n
      })
    },
    [order.length, loop]
  )

  const next = useCallback(() => go(1), [go])
  const prev = useCallback(() => go(-1), [go])

  // ---- shuffle ------------------------------------------------------------
  // Whatever photo is on screen stays on screen when shuffle flips, so opening
  // a photo (or toggling shuffle mid-show) never jumps back to the first one.
  const currentIdxRef = useRef(order[pos])
  currentIdxRef.current = order[pos]
  const firstRun = useRef(true)

  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false
      return
    }
    const keep = currentIdxRef.current ?? 0
    const base = images.map((_, i) => i)
    if (!shuffle) {
      setOrder(base)
      setPos(Math.max(0, base.indexOf(keep)))
      return
    }
    const rest = base.filter((i) => i !== keep)
    for (let i = rest.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[rest[i], rest[j]] = [rest[j], rest[i]]
    }
    setOrder(images[keep] ? [keep, ...rest] : rest)
    setPos(0)
  }, [shuffle, images])

  // ---- toast --------------------------------------------------------------
  useEffect(() => {
    if (!toast) return
    const id = setTimeout(() => setToast(null), 1800)
    return () => clearTimeout(id)
  }, [toast])

  // ---- autoplay -----------------------------------------------------------
  useEffect(() => {
    if (!playing) return
    const id = setTimeout(() => {
      setPos((p) => {
        const n = p + 1
        if (n >= order.length) {
          if (loop) return 0
          setPlaying(false)
          return p
        }
        return n
      })
    }, interval * 1000)
    return () => clearTimeout(id)
  }, [playing, pos, interval, order.length, loop])

  // ---- fullscreen ---------------------------------------------------------
  const toggleFullscreen = useCallback(() => {
    const el = containerRef.current
    if (!document.fullscreenElement) {
      el?.requestFullscreen?.().catch(() => {})
    } else {
      document.exitFullscreen?.()
    }
  }, [])

  useEffect(() => {
    const onChange = () => setIsFullscreen(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])

  // ---- keyboard -----------------------------------------------------------
  useEffect(() => {
    const onKey = (e) => {
      if (e.target.closest?.('input, textarea, select')) return
      switch (e.key) {
        case 'ArrowRight':
        case 'PageDown':
          e.preventDefault()
          next()
          break
        case 'ArrowLeft':
        case 'PageUp':
          e.preventDefault()
          prev()
          break
        case ' ':
          e.preventDefault()
          setPlaying((p) => !p)
          break
        case 'f':
        case 'F':
          toggleFullscreen()
          break
        case 's':
        case 'S':
          setShuffle((s) => !s)
          break
        case 'l':
        case 'L':
          setLoop((l) => !l)
          break
        case 'w':
        case 'W':
          setKeepAwake((k) => !k)
          break
        case 'Home':
          setPos(0)
          break
        case 'End':
          setPos(order.length - 1)
          break
        case 'g':
        case 'G':
          if (groupsApi) setGroupMenuOpen((o) => !o)
          break
        case '?':
          setShowHelp((h) => !h)
          break
        case 'Escape':
          if (groupMenuOpen) setGroupMenuOpen(false)
          else if (showHelp) setShowHelp(false)
          else if (document.fullscreenElement) document.exitFullscreen?.()
          else onExit?.()
          break
        default:
          break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [next, prev, toggleFullscreen, onExit, order.length, showHelp, groupMenuOpen, groupsApi])

  // ---- preload neighbours -------------------------------------------------
  useEffect(() => {
    ;[nextIdx, prevIdx].forEach((i) => {
      const img = images[i]
      if (!img) return
      const pre = new Image()
      pre.src = displaySrc(img)
    })
  }, [nextIdx, prevIdx, images])

  const progress = useMemo(
    () => ((pos + 1) / order.length) * 100,
    [pos, order.length]
  )

  if (!current) return null

  return (
    <div
      ref={containerRef}
      className={`viewer ${controlsHidden ? 'idle' : ''}`}
      onMouseMove={wake}
      onDoubleClick={toggleFullscreen}
    >
      <div className="stage">
        {/* Keep a couple of slides mounted so the crossfade has something to
            fade from. Keyed by file id so React reuses the <img>. */}
        {[...new Set([prevIdx, order[pos], nextIdx])].map((idx) => {
          const img = images[idx]
          if (!img) return null
          return (
            <Slide
              key={img.id}
              src={displaySrc(img)}
              fallbackSrc={fallbackSrc(img)}
              alt={img.name}
              active={idx === order[pos]}
            />
          )
        })}
      </div>

      {/* Click zones — left third goes back, right third goes forward. */}
      <button
        className="zone zone-left"
        onClick={prev}
        aria-label="Previous image"
      />
      <button
        className="zone zone-right"
        onClick={next}
        aria-label="Next image"
      />

      <button className="arrow arrow-left" onClick={prev} aria-label="Previous">
        <svg viewBox="0 0 24 24" width="34" height="34" aria-hidden="true">
          <path
            d="M15 4 L7 12 L15 20"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      <button className="arrow arrow-right" onClick={next} aria-label="Next">
        <svg viewBox="0 0 24 24" width="34" height="34" aria-hidden="true">
          <path
            d="M9 4 L17 12 L9 20"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      <div className="topbar">
        <button className="chip" onClick={onExit} title="Back (Esc)">
          {exitLabel}
        </button>
        <span className="filename" title={current.name}>
          {current.name}
        </span>
        {groupsApi && (
          <ViewerGroupMenu
            photoId={current.id}
            groupsApi={groupsApi}
            open={groupMenuOpen}
            onOpenChange={setGroupMenuOpen}
            onNotify={setToast}
          />
        )}
        <span className="counter">
          {pos + 1} / {order.length}
        </span>
      </div>

      {toast && <div className="viewer-toast">{toast}</div>}

      <div className="controlbar">
        <button
          className="chip play"
          onClick={() => setPlaying((p) => !p)}
          title="Play / pause (Space)"
        >
          {playing ? '❚❚' : '▶'}
        </button>

        <label className="chip select-chip" title="Seconds per slide">
          <span>{interval}s</span>
          <select
            value={interval}
            onChange={(e) => setIntervalSec(Number(e.target.value))}
            aria-label="Slide interval in seconds"
          >
            {INTERVALS.map((s) => (
              <option key={s} value={s}>
                {s} seconds
              </option>
            ))}
          </select>
        </label>

        <button
          className={`chip toggle ${shuffle ? 'on' : ''}`}
          onClick={() => setShuffle((s) => !s)}
          title="Shuffle (S)"
        >
          Shuffle
        </button>

        <button
          className={`chip toggle ${loop ? 'on' : ''}`}
          onClick={() => setLoop((l) => !l)}
          title="Loop (L)"
        >
          Loop
        </button>

        {wakeSupported && (
          <button
            className={`chip toggle ${keepAwake && awake ? 'on' : ''}`}
            onClick={() => setKeepAwake((k) => !k)}
            title={
              wakeError
                ? `Keep display awake — blocked by the browser: ${wakeError}`
                : 'Keep the display awake (W)'
            }
          >
            {keepAwake && !awake && !wakeError ? 'Keep awake…' : 'Keep awake'}
            {wakeError && keepAwake ? ' ⚠' : ''}
          </button>
        )}

        <button
          className="chip"
          onClick={toggleFullscreen}
          title="Fullscreen (F)"
        >
          {isFullscreen ? 'Exit full screen' : 'Full screen'}
        </button>

        <button
          className="chip"
          onClick={() => setShowHelp((h) => !h)}
          title="Shortcuts (?)"
        >
          ?
        </button>
      </div>

      <div className="progress">
        <div className="progress-fill" style={{ width: `${progress}%` }} />
      </div>

      {showHelp && (
        <div className="help-overlay" onClick={() => setShowHelp(false)}>
          <div className="help-card" onClick={(e) => e.stopPropagation()}>
            <h3>Keyboard shortcuts</h3>
            <dl>
              <dt>← →</dt><dd>Previous / next image</dd>
              <dt>Space</dt><dd>Play / pause slideshow</dd>
              <dt>F</dt><dd>Toggle full screen</dd>
              <dt>S</dt><dd>Toggle shuffle</dd>
              <dt>L</dt><dd>Toggle loop</dd>
              <dt>W</dt><dd>Keep the display awake</dd>
              <dt>G</dt><dd>Add this photo to a group</dd>
              <dt>Home / End</dt><dd>First / last image</dd>
              <dt>?</dt><dd>Show or hide this panel</dd>
              <dt>Esc</dt><dd>Exit full screen, then back to library</dd>
            </dl>
            <p className="help-note">
              Controls fade out after a couple of seconds of no input — move the
              mouse to bring them back. Double-click the image for full screen.
            </p>
            {!wakeSupported && (
              <p className="help-note">
                This browser doesn’t support the Screen Wake Lock API, so the
                display may still sleep during a slideshow.
              </p>
            )}
            {wakeError && (
              <p className="help-note">
                Couldn’t hold the wake lock: {wakeError}. This usually means the
                page isn’t on a secure origin (use <code>localhost</code>, not a
                LAN IP over plain http), or battery saver is on.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

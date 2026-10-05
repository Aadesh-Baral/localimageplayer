import { useEffect, useState } from 'react'

/**
 * One image layer in the crossfade stack. Fades in once decoded, and falls
 * back to Drive's thumbnail host if the primary URL fails.
 */
export default function Slide({ src, fallbackSrc, alt, active }) {
  const [url, setUrl] = useState(src)
  const [loaded, setLoaded] = useState(false)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    setUrl(src)
    setLoaded(false)
    setFailed(false)
  }, [src])

  const handleError = () => {
    if (fallbackSrc && url !== fallbackSrc) setUrl(fallbackSrc)
    else setFailed(true)
  }

  return (
    <div
      className={`slide ${active ? 'active' : ''} ${loaded ? 'loaded' : ''}`}
      aria-hidden={!active}
    >
      {failed ? (
        <div className="slide-error">
          Couldn’t load <strong>{alt}</strong>
        </div>
      ) : (
        <img
          src={url}
          alt={alt}
          draggable={false}
          referrerPolicy="no-referrer"
          onLoad={() => setLoaded(true)}
          onError={handleError}
        />
      )}
      {active && !loaded && !failed && <div className="spinner" />}
    </div>
  )
}

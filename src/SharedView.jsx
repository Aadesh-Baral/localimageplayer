import { useCallback, useEffect, useMemo, useState } from 'react'
import PhotoGrid from './PhotoGrid'
import Viewer from './Viewer'
import GoogleButton from './GoogleButton'
import { useGoogleAuth } from './googleAuth'
import { viewShare } from './api'

/**
 * Read-only page for a shared collection (/s/<token>). No project data, no
 * editing — just the photos, a grid and the slideshow. Sign-in is only asked
 * for when the owner limited the link to specific Google accounts, and then
 * only for identity (no Drive access).
 */
export default function SharedView({ token }) {
  const auth = useGoogleAuth({ drive: false })
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)
  const [playlist, setPlaylist] = useState(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const m = document.createElement('meta')
    m.name = 'robots'
    m.content = 'noindex, nofollow'
    document.head.appendChild(m)
    return () => m.remove()
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const d = await viewShare(token)
      setData(d)
      setError(null)
      document.title = `${d.title} · Image Player`
    } catch (e) {
      setData(null)
      setError(e)
    } finally {
      setLoading(false)
    }
  }, [token])

  // Load now, and again once the viewer signs in.
  useEffect(() => {
    load()
  }, [load, auth.status])

  const photos = useMemo(
    () =>
      (data?.photos || []).map((p, i) => ({
        id: p.fileId,
        vendor: 'gdrive',
        fileId: p.fileId,
        name: `Photo ${i + 1}`,
      })),
    [data]
  )

  if (playlist) {
    return (
      <Viewer
        images={playlist.images}
        startIndex={playlist.startIndex}
        onExit={() => setPlaylist(null)}
        exitLabel="← Back"
      />
    )
  }

  const signIn = async () => {
    setBusy(true)
    try {
      await auth.signIn()
    } catch {
      /* shown via auth.error */
    } finally {
      setBusy(false)
    }
  }

  if (loading && !data) return <div className="boot">Loading…</div>

  if (error) {
    const needsSignIn = error.signIn && (error.status === 401 || error.status === 403)
    return (
      <div className="setup">
        <header className="setup-head">
          <h1>Shared collection</h1>
        </header>
        <section className="card signin-card">
          <p className={needsSignIn && error.status === 401 ? 'help-note' : 'error'}>{error.message}</p>
          {needsSignIn && auth.status !== 'misconfigured' && (
            <>
              <GoogleButton onClick={signIn} disabled={busy || !auth.ready}>
                {busy
                  ? 'Waiting for Google…'
                  : error.status === 403
                    ? 'Use a different Google account'
                    : 'Sign in with Google'}
              </GoogleButton>
              <p className="help-note">Only your name and email are shared with this page.</p>
            </>
          )}
          {auth.error && <p className="error">{auth.error}</p>}
        </section>
      </div>
    )
  }

  return (
    <div className="shared">
      <header className="shared-head">
        <div>
          <h1>{data.title}</h1>
          <p className="subtle">
            {data.count} photo{data.count === 1 ? '' : 's'}
            {auth.user?.email && ` · viewing as ${auth.user.email}`}
          </p>
        </div>
        <button
          className="btn primary-btn"
          onClick={() => setPlaylist({ images: photos, startIndex: 0 })}
          disabled={!photos.length}
        >
          ▶ Play slideshow
        </button>
      </header>

      <main className="shared-body">
        <PhotoGrid
          images={photos}
          onOpen={(i) => setPlaylist({ images: photos, startIndex: i })}
          empty="This collection is empty."
        />
      </main>

      <footer className="shared-foot subtle">Shared with Image Player · view only</footer>
    </div>
  )
}

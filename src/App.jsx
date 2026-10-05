import { useCallback, useEffect, useState } from 'react'
import Workspace from './Workspace'
import useDownloads from './useDownloads'
import useProjects from './useProjects'
import { readLegacy, LEGACY_IMPORTED, exportProject, readProjectFile } from './project'
import { useGoogleAuth, CLIENT_ID } from './googleAuth'
import GoogleButton from './GoogleButton'

const KEY_STORE = 'imageplayer.apiKey'

/** Sign-in gate. Everything else only mounts once Google says who you are. */
export default function App() {
  const auth = useGoogleAuth()
  const [busy, setBusy] = useState(false)

  const signIn = async () => {
    setBusy(true)
    try {
      await auth.signIn()
    } catch {
      /* error shown via auth.error */
    } finally {
      setBusy(false)
    }
  }

  if (auth.status === 'misconfigured') {
    return (
      <div className="setup">
        <header className="setup-head">
          <h1>Image Player</h1>
        </header>
        <section className="card">
          <p className="error">Google sign-in isn’t configured yet.</p>
          <p className="help-note">
            Set <code>VITE_GOOGLE_CLIENT_ID</code> in <code>.env.local</code> (and in Netlify’s
            environment variables), then restart the dev server. See “Google sign-in setup” in
            the README.
          </p>
        </section>
      </div>
    )
  }

  if (auth.status === 'loading') return <div className="boot">Loading…</div>

  if (auth.status === 'signed-out') {
    return (
      <div className="setup">
        <header className="setup-head">
          <h1>Image Player</h1>
          <p className="tagline">
            Group photos from Google Drive and local folders into projects, then play them full
            screen.
          </p>
        </header>
        <section className="card signin-card">
          <GoogleButton onClick={signIn} disabled={busy || !auth.ready}>
            {busy ? 'Waiting for Google…' : 'Sign in with Google'}
          </GoogleButton>
          <p className="help-note">
            Read-only access to your Google Drive lets photos load and download as you. Nothing in
            Drive is changed.
          </p>
          {auth.error && <p className="error">{auth.error}</p>}
        </section>
      </div>
    )
  }

  // signed-in or expired: keep the app mounted (unsaved edits stay in memory)
  return (
    <>
      {auth.status === 'expired' && (
        <div className="auth-banner" role="alert">
          <span>
            Your Google session expired{auth.user?.email ? ` (${auth.user.email})` : ''}. Saving and
            Drive loading are paused.
          </span>
          <GoogleButton onClick={signIn} disabled={busy}>
            {busy ? 'Waiting…' : 'Continue'}
          </GoogleButton>
          {auth.error && <span className="error">{auth.error}</span>}
        </div>
      )}
      <Main auth={auth} />
    </>
  )
}

function Main({ auth }) {
  const [apiKey, setApiKey] = useState(
    () => localStorage.getItem(KEY_STORE) || import.meta.env.VITE_GOOGLE_API_KEY || ''
  )
  useEffect(() => {
    try {
      if (apiKey) localStorage.setItem(KEY_STORE, apiKey)
    } catch {
      /* ignore */
    }
  }, [apiKey])

  const projectsApi = useProjects()
  const downloadsApi = useDownloads()
  const [legacy] = useState(() => readLegacy())
  const [newName, setNewName] = useState('')
  const [busy, setBusy] = useState(null)
  const [error, setError] = useState(null)

  const key = apiKey.trim()

  // When a lapsed session comes back: retry the save that failed, and finish
  // loading projects if that was what got interrupted.
  const { saveState, flush, boot, current } = projectsApi
  useEffect(() => {
    if (auth.status !== 'signed-in') return
    if (saveState === 'error' || saveState === 'pending') flush()
    if (!current) boot()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.status])

  const startDownload = useCallback(
    (photos, label) => downloadsApi.start(photos, key, label), // resolves to job id, or null if cancelled
    [downloadsApi, key]
  )

  const newProject = useCallback(
    async (nameArg) => {
      const name = nameArg ?? window.prompt('Name for the new project?', 'New project')
      if (!name?.trim()) return
      try {
        await projectsApi.create(name)
        setNewName('')
      } catch (e) {
        setError(e.message)
        window.alert?.(`Couldn’t create the project: ${e.message}`)
      }
    },
    [projectsApi]
  )

  const importLegacy = useCallback(async () => {
    setError(null)
    if (!readLegacy()) {
      window.alert('No data from the old version was found in this browser.')
      return
    }
    const already = localStorage.getItem(LEGACY_IMPORTED)
    if (
      already &&
      !window.confirm(
        'This browser’s old data was already imported once. Import it again as another new project?'
      )
    )
      return
    const k = key
    try {
      setBusy('Starting import…')
      const r = await projectsApi.importLegacy(k, setBusy)
      const notes = [
        `Imported ${r.groups} group${r.groups === 1 ? '' : 's'} and ${r.project.sources.gdrive.length} Drive link${r.project.sources.gdrive.length === 1 ? '' : 's'} into “${r.project.name}”.`,
        'Your old browser data was left in place as a backup.',
      ]
      if (r.unresolved)
        notes.push(`${r.unresolved} photo(s) couldn’t be matched to a folder and are listed under “unknown folder”.`)
      if (r.failures.length) notes.push(`Folders that couldn’t be listed: ${r.failures.join('; ')}`)
      window.alert(notes.join('\n\n'))
    } catch (e) {
      setError(`Import failed: ${e.message}`)
      window.alert(`Import failed: ${e.message}`)
    } finally {
      setBusy(null)
    }
  }, [key, projectsApi])

  /** Save the open project's metadata as a .json file. */
  const exportCurrent = useCallback(() => {
    const p = projectsApi.current
    if (!p) return
    const { filename, blob } = exportProject(p)
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 30_000)
  }, [projectsApi])

  /** Pick an exported .json and create a NEW project from it (never overwrites). */
  const importFile = useCallback(() => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json,application/json'
    input.onchange = async () => {
      const file = input.files?.[0]
      if (!file) return
      setError(null)
      try {
        const data = await readProjectFile(file)
        const taken = new Set((projectsApi.list || []).map((p) => p.name))
        let name = data.name
        if (taken.has(name)) name = `${name} (imported)`
        await projectsApi.create(name, { sources: data.sources, collections: data.collections })
        const locals = data.sources.local.length
        window.alert(
          `Imported “${name}”: ${data.sources.gdrive.length} Drive link(s), ${locals} local folder(s), ${Object.keys(data.collections).length} collection(s).` +
            (locals ? '\n\nLocal folders need to be chosen again on this computer — use “Choose folder…” on each.' : '')
        )
      } catch (e) {
        setError(`Import failed: ${e.message}`)
        window.alert(`Import failed: ${e.message}`)
      }
    }
    input.click()
  }, [projectsApi])

  const editApiKey = useCallback(() => {
    const next = window.prompt(
      'Optional Google API key — only used when you’re not signed in (stored in this browser only):',
      apiKey
    )
    if (next !== null) setApiKey(next.trim())
  }, [apiKey])

  // ---- loading / welcome -----------------------------------------------------
  if (projectsApi.list === null || (projectsApi.opening && !projectsApi.current)) {
    return <div className="boot">Loading projects…</div>
  }

  if (!projectsApi.current) {
    const others = projectsApi.list || []
    return (
      <div className="setup">
        <header className="setup-head">
          <h1>Image Player</h1>
          <p className="tagline">
            Group photos from Google Drive links and local folders into projects, then
            play them full screen.
          </p>
        </header>

        <section className="card">
          {projectsApi.listError && <p className="error">{projectsApi.listError}</p>}

          {others.length > 0 && (
            <div className="field">
              <span className="label">Open a project</span>
              <div className="project-list">
                {others.map((p) => (
                  <button key={p.id} className="btn" onClick={() => projectsApi.open(p.id)}>
                    {p.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          <form
            className="field"
            onSubmit={(e) => {
              e.preventDefault()
              newProject(newName || 'My photos')
            }}
          >
            <span className="label">New project</span>
            <div className="addbar">
              <input
                value={newName}
                placeholder="e.g. Wedding"
                onChange={(e) => setNewName(e.target.value)}
              />
              <button className="primary" type="submit">
                Create
              </button>
            </div>
          </form>

          {legacy && (
            <div className="legacy-box">
              <p>
                This browser has data from the previous version: {legacy.sources.length} Drive
                link{legacy.sources.length === 1 ? '' : 's'} and {legacy.groupCount} group
                {legacy.groupCount === 1 ? '' : 's'}.
              </p>
              <button className="btn primary-btn" onClick={importLegacy} disabled={!!busy}>
                {busy || 'Import into a new project'}
              </button>
            </div>
          )}

          <p className="help-note">
            Have an exported project file?{' '}
            <button className="link-btn" onClick={importFile}>
              Import project…
            </button>
          </p>

          {error && <p className="error">{error}</p>}
          <p className="help-note">
            Signed in as {auth.user?.email}.{' '}
            <button className="link-btn" onClick={auth.signOut}>
              Sign out
            </button>
          </p>
        </section>
      </div>
    )
  }

  return (
    <>
      <Workspace
        key={projectsApi.current.id}
        project={projectsApi.current}
        projectsApi={projectsApi}
        apiKey={key}
        downloadsApi={downloadsApi}
        onDownload={startDownload}
        onNewProject={() => newProject()}
        onImport={importLegacy}
        onExportProject={exportCurrent}
        onImportProject={importFile}
        onApiKey={editApiKey}
        hasLegacy={!!legacy}
        auth={auth}
      />
      {busy && <div className="queued-toast">{busy}</div>}
    </>
  )
}

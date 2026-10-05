import { useEffect, useRef, useState } from 'react'

const SAVE_LABEL = {
  saved: 'Saved',
  pending: 'Unsaved…',
  saving: 'Saving…',
  error: 'Save failed — retry',
}

/** Project switcher + project menu + save status, for the top nav. */
export default function ProjectBar({
  projectsApi,
  onNewProject,
  onImport,
  onApiKey,
  hasLegacy,
  auth,
}) {
  const { list, current, saveState, saveError, open, update, remove, flush } = projectsApi
  const [menu, setMenu] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    if (!menu) return
    const onDown = (e) => !ref.current?.contains(e.target) && setMenu(false)
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [menu])

  const rename = () => {
    setMenu(false)
    const name = window.prompt('Project name', current.name)
    if (name?.trim()) update((p) => ({ ...p, name: name.trim() }))
  }

  const del = () => {
    setMenu(false)
    if (
      window.confirm(
        `Delete project “${current.name}”? Its links, folder list and collections are removed. Photos in Drive and on disk are not touched.`
      )
    )
      remove(current.id).catch((e) => window.alert(e.message))
  }

  return (
    <div className="projectbar" ref={ref}>
      <select
        className="project-select"
        value={current.id}
        onChange={(e) => open(e.target.value)}
        aria-label="Project"
      >
        {(list || []).map((p) => (
          <option key={p.id} value={p.id}>
            {p.id === current.id ? current.name : p.name}
          </option>
        ))}
      </select>

      <div className="menu-wrap">
        <button className="btn small ghost" onClick={() => setMenu((m) => !m)} title="Project menu">
          ⋯
        </button>
        {menu && (
          <div className="menu menu-down menu-left">
            <button className="menu-item new" onClick={() => (setMenu(false), onNewProject())}>
              + New project…
            </button>
            <div className="menu-sep" />
            <button className="menu-item" onClick={rename}>
              Rename project…
            </button>
            <button className="menu-item" onClick={() => (setMenu(false), onImport())}>
              Import from browser storage{hasLegacy ? '' : ' (nothing found)'}
            </button>
            <button className="menu-item" onClick={() => (setMenu(false), onApiKey())}>
              Google API key (optional)…
            </button>
            <div className="menu-sep" />
            <button className="menu-item danger-item" onClick={del}>
              Delete project…
            </button>
            <div className="menu-sep" />
            <div className="menu-empty menu-user">{auth?.user?.email}</div>
            <button className="menu-item" onClick={() => (setMenu(false), auth?.signOut())}>
              Sign out
            </button>
          </div>
        )}
      </div>

      <button
        className={`save-state save-${saveState}`}
        onClick={saveState === 'error' ? flush : undefined}
        title={saveError || 'Changes save automatically'}
      >
        {SAVE_LABEL[saveState]}
      </button>
    </div>
  )
}

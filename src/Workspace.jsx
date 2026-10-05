import { useCallback, useEffect, useMemo, useState } from 'react'
import Viewer from './Viewer'
import Library from './Library'
import Collections from './Collections'
import Downloads from './Downloads'
import Sidebar from './Sidebar'
import useGroups from './useGroups'
import useSources from './useSources'
import * as G from './groups'
import { collectionsToGroups, groupsToCollections } from './project'

const VIEW_STORE = (pid) => `imageplayer.view.${pid}`

/** Everything for one open project. Keyed by project id, so switching remounts. */
export default function Workspace({
  project,
  projectsApi,
  apiKey,
  downloadsApi,
  onDownload,
  onNewProject,
  onImport,
  onApiKey,
  hasLegacy,
  auth,
}) {
  const { update } = projectsApi
  const [playlist, setPlaylist] = useState(null)
  const [toast, setToast] = useState(null)
  const [sideOpen, setSideOpen] = useState(false)

  // Which page is showing; remembered per project in this browser.
  const [view, setViewState] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(VIEW_STORE(project.id))) || { type: 'library' }
    } catch {
      return { type: 'library' }
    }
  })
  const setView = useCallback(
    (v) => {
      setViewState(v)
      try {
        const { add, ...keep } = v // don't remember one-off "focus the add box"
        localStorage.setItem(VIEW_STORE(project.id), JSON.stringify(keep))
      } catch {
        /* ignore */
      }
    },
    [project.id]
  )

  useEffect(() => {
    if (!toast) return
    const id = setTimeout(() => setToast(null), 4000)
    return () => clearTimeout(id)
  }, [toast])

  const download = useCallback(
    async (photos, label) => {
      try {
        if (!(await onDownload(photos, `${project.name} - ${label}`))) return
        setToast(`Downloading ${photos.length} photo${photos.length === 1 ? '' : 's'}`)
      } catch (e) {
        setToast(`Couldn’t start the download: ${e.message}`)
      }
    },
    [onDownload, project.name]
  )

  const updateSources = useCallback(
    (fn) => update((p) => ({ ...p, sources: fn(p.sources) })),
    [update]
  )
  // Seed once; afterwards the group tree is the source of truth for this session.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const initialGroups = useMemo(() => collectionsToGroups(project.collections), [])
  const onGroupsChange = useCallback(
    (groups) => update((p) => ({ ...p, collections: groupsToCollections(groups) })),
    [update]
  )

  const groupsApi = useGroups(initialGroups, onGroupsChange)
  const sourcesApi = useSources(project.id, project.sources, updateSources, apiKey)
  const { byId, sourceOf, reloadAll } = sourcesApi
  const { groups } = groupsApi

  // A deleted collection / removed source falls back to the library.
  useEffect(() => {
    if (view.type === 'collection' && !groups[view.id]) setView({ type: 'library' })
  }, [groups, view, setView])

  const createGroup = useCallback(
    (parentId) => {
      const name = window.prompt(
        parentId ? 'Name for the new sub-collection?' : 'Name for the new collection?',
        parentId ? 'New sub-collection' : 'New collection'
      )
      if (!name) return
      const id = groupsApi.createGroup(name, parentId)
      setView({ type: 'collection', id })
    },
    [groupsApi, setView]
  )

  const deleteGroup = useCallback(
    (id) => {
      const g = groups[id]
      if (!g) return
      const nested = G.descendantIds(groups, id).length
      const message = nested
        ? `Delete “${g.name}” and its ${nested} nested collection${nested === 1 ? '' : 's'}? The photos themselves aren’t touched.`
        : `Delete “${g.name}”? The photos themselves aren’t touched.`
      if (window.confirm(message)) groupsApi.deleteGroup(id)
    },
    [groups, groupsApi]
  )

  const addLocal = useCallback(async () => {
    try {
      const path = await sourcesApi.addLocalFolder()
      if (path) setToast(`Added local folder “${path}”`)
    } catch (e) {
      if (e.name !== 'AbortError') window.alert(e.message)
    }
  }, [sourcesApi])

  const play = useCallback((list, startIndex = 0) => {
    if (!list?.length) return
    setPlaylist({ images: list, startIndex })
  }, [])

  if (playlist) {
    return (
      <Viewer
        images={playlist.images}
        startIndex={playlist.startIndex}
        groupsApi={groupsApi}
        onExit={() => setPlaylist(null)}
      />
    )
  }

  const title =
    view.type === 'downloads'
      ? 'Downloads'
      : view.type === 'collection'
        ? groups[view.id]?.name || 'Collection'
        : view.type === 'source'
          ? 'Source'
          : 'Library'

  return (
    <div className="shell">
      <Sidebar
        view={view}
        onView={setView}
        projectsApi={projectsApi}
        sourcesApi={sourcesApi}
        groupsApi={groupsApi}
        downloadsApi={downloadsApi}
        onCreateGroup={createGroup}
        onDeleteGroup={deleteGroup}
        onNewProject={onNewProject}
        onImport={onImport}
        onApiKey={onApiKey}
        hasLegacy={hasLegacy}
        auth={auth}
        onReloadAll={() => reloadAll(apiKey)}
        onAddLocal={addLocal}
        open={sideOpen}
        onClose={() => setSideOpen(false)}
      />

      <main className="main">
        <div className="mobilebar">
          <button className="btn small ghost" onClick={() => setSideOpen(true)} aria-label="Menu">
            ☰
          </button>
          <span className="mobilebar-title">
            {project.name} · {title}
          </span>
        </div>

        {view.type === 'downloads' ? (
          <Downloads
            downloadsApi={downloadsApi}
            apiKey={apiKey}
            resolvePhoto={(p) => byId.get(p.id)}
          />
        ) : view.type === 'collection' ? (
          <Collections
            key={view.id}
            groupId={view.id}
            byId={byId}
            sourceOf={sourceOf}
            groupsApi={groupsApi}
            onPlay={play}
            onDownload={download}
          />
        ) : (
          <Library
            key={view.type === 'source' ? view.id : 'all'}
            sourcesApi={sourcesApi}
            apiKey={apiKey}
            groupsApi={groupsApi}
            onPlay={play}
            onDownload={download}
            onlySid={view.type === 'source' ? view.id : null}
            focusAdd={view.add || null}
          />
        )}
      </main>

      {toast && view.type !== 'downloads' && (
        <div className="queued-toast" role="status">
          <span>{toast}</span>
          {toast.startsWith('Downloading') && (
            <button
              className="btn small"
              onClick={() => {
                setToast(null)
                setView({ type: 'downloads' })
              }}
            >
              View
            </button>
          )}
        </div>
      )}
    </div>
  )
}

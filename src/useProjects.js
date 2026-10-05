import { useCallback, useEffect, useRef, useState } from 'react'
import * as API from './api'
import { emptyProject, sanitizeProject, readLegacy, LEGACY_IMPORTED, uid } from './project'
import { listFolderImages } from './drive'

const CURRENT = 'imageplayer.currentProject'
const SAVE_DELAY = 800

const ls = {
  get: (k) => {
    try {
      return localStorage.getItem(k)
    } catch {
      return null
    }
  },
  set: (k, v) => {
    try {
      localStorage.setItem(k, v)
    } catch {
      /* ignore */
    }
  },
}

/**
 * Projects live on the server (/api/projects → Netlify Blobs, or .data/ in
 * dev). One project is open at a time; edits go through `update(fn)` and are
 * saved after a short pause. saveState: saved | pending | saving | error
 */
export default function useProjects() {
  const [list, setList] = useState(null) // null = still loading
  const [listError, setListError] = useState(null)
  const [current, setCurrent] = useState(null)
  const [opening, setOpening] = useState(false)
  const [saveState, setSaveState] = useState('saved')
  const [saveError, setSaveError] = useState(null)

  const currentRef = useRef(null)
  currentRef.current = current
  const timer = useRef(null)
  const saving = useRef(false)
  const again = useRef(false)

  const refreshList = useCallback(async () => {
    try {
      setListError(null)
      const items = await API.listProjects()
      setList(items)
      return items
    } catch (e) {
      setListError(e.message)
      setList((l) => l || [])
      return []
    }
  }, [])

  const flush = useCallback(async () => {
    clearTimeout(timer.current)
    const p = currentRef.current
    if (!p) return
    if (saving.current) {
      again.current = true
      return
    }
    saving.current = true
    setSaveState('saving')
    try {
      const { updatedAt } = await API.saveProject(p)
      setSaveError(null)
      setList((l) =>
        (l || []).map((x) => (x.id === p.id ? { ...x, name: p.name, updatedAt } : x))
      )
      setSaveState(again.current ? 'pending' : 'saved')
    } catch (e) {
      setSaveError(e.message)
      setSaveState('error')
    } finally {
      saving.current = false
      if (again.current) {
        again.current = false
        flush()
      }
    }
  }, [])

  const schedule = useCallback(() => {
    setSaveState('pending')
    clearTimeout(timer.current)
    timer.current = setTimeout(flush, SAVE_DELAY)
  }, [flush])

  /** Change the open project; it's saved shortly after. */
  const update = useCallback(
    (fn) => {
      setCurrent((p) => {
        if (!p) return p
        const next = fn(p)
        currentRef.current = next
        return next
      })
      schedule()
    },
    [schedule]
  )

  const open = useCallback(
    async (id) => {
      if (currentRef.current && saveState !== 'saved') await flush()
      setOpening(true)
      try {
        const p = sanitizeProject(await API.getProject(id))
        currentRef.current = p
        setCurrent(p)
        setSaveState('saved')
        setSaveError(null)
        ls.set(CURRENT, id)
      } catch (e) {
        setListError(`Couldn’t open project: ${e.message}`)
      } finally {
        setOpening(false)
      }
    },
    [flush, saveState]
  )

  const create = useCallback(
    async (name, seed) => {
      const p = sanitizeProject({ ...emptyProject(name), ...(seed || {}) })
      await API.saveProject(p)
      await refreshList()
      currentRef.current = p
      setCurrent(p)
      setSaveState('saved')
      ls.set(CURRENT, p.id)
      return p
    },
    [refreshList]
  )

  const remove = useCallback(
    async (id) => {
      await API.deleteProject(id)
      const items = await refreshList()
      if (currentRef.current?.id === id) {
        currentRef.current = null
        setCurrent(null)
        if (items.length) open(items[0].id)
      }
    },
    [refreshList, open]
  )

  /**
   * Copy the old browser-only data (localStorage groups + folder links) into a
   * new project. The old data is left untouched as a backup. Old groups only
   * stored Drive file IDs, so each folder is listed once to learn which link a
   * photo belongs to.
   */
  const importLegacy = useCallback(
    async (apiKey, onStep) => {
      const legacy = readLegacy()
      if (!legacy) throw new Error('Nothing to import in this browser.')

      const gdrive = legacy.sources
        .filter((s) => s?.id)
        .map((s) => ({ link: s.link || s.id, folderId: s.id, name: s.name || null }))

      const linkOf = new Map()
      const failures = []
      for (let i = 0; i < gdrive.length; i++) {
        const s = gdrive[i]
        onStep?.(`Listing folder ${i + 1} of ${gdrive.length}…`)
        try {
          for (const f of await listFolderImages(s.folderId, apiKey)) {
            if (!linkOf.has(f.id)) linkOf.set(f.id, s.link)
          }
        } catch (e) {
          failures.push(`${s.name || s.folderId}: ${e.message}`)
        }
      }

      const UNRESOLVED = '(unknown folder — imported)'
      let unresolved = 0
      const collections = {}
      for (const g of Object.values(legacy.groups)) {
        if (!g || typeof g.name !== 'string') continue
        const images = { gdrive: {}, local: {} }
        for (const fileId of g.photoIds || []) {
          let link = linkOf.get(fileId)
          if (!link) {
            if (gdrive.length === 1) link = gdrive[0].link
            else {
              link = UNRESOLVED
              unresolved++
            }
          }
          ;(images.gdrive[link] ||= []).push(fileId)
        }
        collections[g.id || uid('g')] = {
          id: g.id,
          name: g.name,
          parentId: g.parentId ?? null,
          createdAt: g.createdAt || Date.now(),
          images,
        }
      }

      onStep?.('Saving project…')
      const p = await create(`Imported ${new Date().toISOString().slice(0, 10)}`, {
        sources: { gdrive, local: [] },
        collections,
      })
      ls.set(LEGACY_IMPORTED, p.id)
      return { project: p, unresolved, failures, groups: Object.keys(collections).length }
    },
    [create]
  )

  /** Load the list, then reopen the last project. */
  const boot = useCallback(async () => {
    const items = await refreshList()
    if (!items.length || currentRef.current) return
    const last = ls.get(CURRENT)
    await open(items.some((i) => i.id === last) ? last : items[0].id)
  }, [refreshList, open])

  useEffect(() => {
    boot()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Don't lose an edit made in the last ~second before closing the tab.
  useEffect(() => {
    if (saveState === 'saved') return
    const onBeforeUnload = (e) => {
      flush()
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [saveState, flush])

  return {
    list,
    listError,
    current,
    opening,
    saveState,
    saveError,
    update,
    open,
    create,
    remove,
    importLegacy,
    flush,
    refreshList,
    boot,
  }
}

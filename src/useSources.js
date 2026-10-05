import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { parseLinks, listFolderImages, fetchFileById, hasDriveAuth } from './drive'
import { photoKey, uid } from './project'
import * as LF from './localFolders'

/**
 * Sources for one project, both vendors.
 *
 * `saved` is the persisted project.sources ({ gdrive: [...], local: [...] });
 * `updateSaved(fn)` changes it (and so triggers a project save). Everything
 * fetched at runtime — image lists, statuses, local object URLs — lives here
 * and is rebuilt every session.
 *
 * Each runtime source: { sid, vendor, ref, name, images, status, error }
 *   sid  'g:<folderId>' | 'l:<localId>'
 *   ref  the Drive link as pasted, or the local path label
 * status: idle | loading | ready | error | needs-permission | disconnected | unsupported
 */
export default function useSources(projectId, saved, updateSaved, apiKey) {
  const [runtime, setRuntime] = useState({})
  const abortRefs = useRef(new Map())
  const apiKeyRef = useRef(apiKey)
  apiKeyRef.current = apiKey
  const urlsRef = useRef(new Map()) // sid → [objectURL] for local folders

  const collapsedKey = `imageplayer.collapsed.${projectId}`
  const [collapsed, setCollapsedState] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(collapsedKey) || '{}')
    } catch {
      return {}
    }
  })
  useEffect(() => {
    try {
      localStorage.setItem(collapsedKey, JSON.stringify(collapsed))
    } catch {
      /* ignore */
    }
  }, [collapsed, collapsedKey])

  const entries = useMemo(
    () => [
      ...saved.gdrive.map((s) => ({
        sid: `g:${s.folderId}`,
        vendor: 'gdrive',
        ref: s.link,
        folderId: s.folderId,
        savedName: s.name,
      })),
      ...saved.local.map((s) => ({
        sid: `l:${s.id}`,
        vendor: 'local',
        ref: s.path,
        localId: s.id,
        savedName: s.name,
      })),
    ],
    [saved]
  )
  const entriesRef = useRef(entries)
  entriesRef.current = entries

  const patch = useCallback((sid, changes) => {
    setRuntime((prev) => ({ ...prev, [sid]: { ...prev[sid], ...changes } }))
  }, [])

  const releaseUrls = useCallback((sid) => {
    for (const u of urlsRef.current.get(sid) || []) URL.revokeObjectURL(u)
    urlsRef.current.delete(sid)
  }, [])

  // ---- Google Drive ---------------------------------------------------------
  const loadDrive = useCallback(
    async (entry, key) => {
      const { sid, folderId, ref } = entry
      const k = (key ?? apiKeyRef.current ?? '').trim()
      if (!hasDriveAuth(k)) {
        patch(sid, {
          status: 'error',
          error: 'Your Google session expired — click Continue at the top, then ↻.',
        })
        return
      }
      abortRefs.current.get(sid)?.abort()
      const controller = new AbortController()
      abortRefs.current.set(sid, controller)
      patch(sid, { status: 'loading', error: null })

      try {
        let name = null
        try {
          name = (await fetchFileById(folderId, k))?.name || null
        } catch {
          /* non-fatal */
        }
        let files = await listFolderImages(folderId, k, { signal: controller.signal })
        if (files.length === 0) {
          try {
            const file = await fetchFileById(folderId, k)
            if (file?.mimeType?.startsWith('image/'))
              files = [{ id: file.id, name: file.name }]
          } catch {
            /* leave empty */
          }
        }
        if (controller.signal.aborted) return

        const images = files.map((f) => ({
          id: photoKey('gdrive', ref, f.id),
          vendor: 'gdrive',
          fileId: f.id,
          name: f.name,
          width: f.width,
          height: f.height,
          sid,
        }))
        patch(sid, {
          name,
          images,
          status: 'ready',
          error:
            images.length === 0
              ? 'No images here. Check the folder is shared as “Anyone with the link” — subfolders aren’t scanned.'
              : null,
        })
        if (name && name !== entry.savedName) {
          updateSaved((s) => ({
            ...s,
            gdrive: s.gdrive.map((g) => (g.folderId === folderId ? { ...g, name } : g)),
          }))
        }
      } catch (e) {
        if (e.name === 'AbortError') return
        patch(sid, { status: 'error', error: e.message })
      } finally {
        if (abortRefs.current.get(sid) === controller) abortRefs.current.delete(sid)
      }
    },
    [patch, updateSaved]
  )

  // ---- Local folders --------------------------------------------------------
  const loadLocal = useCallback(
    async (entry, { request = false, handle: given } = {}) => {
      const { sid, localId, ref } = entry
      if (!LF.supported()) {
        patch(sid, {
          status: 'unsupported',
          error: 'This browser can’t open local folders. Use Chrome or Edge on a computer.',
        })
        return
      }
      const handle = given || (await LF.loadHandle(projectId, localId))
      if (!handle) {
        patch(sid, {
          status: 'disconnected',
          images: [],
          error: 'Not connected in this browser. Choose the folder on this computer to link it.',
        })
        return
      }
      let state
      try {
        state = await LF.permission(handle, request)
      } catch (e) {
        state = 'prompt'
      }
      if (state !== 'granted') {
        patch(sid, {
          status: 'needs-permission',
          name: handle.name,
          error: 'The browser needs your OK to read this folder again.',
        })
        return
      }
      patch(sid, { status: 'loading', error: null, name: handle.name })
      try {
        const files = await LF.listImages(handle)
        releaseUrls(sid)
        const urls = []
        const images = files.map((f) => {
          const url = URL.createObjectURL(f.file)
          urls.push(url)
          return {
            id: photoKey('local', ref, f.name),
            vendor: 'local',
            name: f.name,
            file: f.file,
            url,
            sid,
          }
        })
        urlsRef.current.set(sid, urls)
        patch(sid, {
          images,
          status: 'ready',
          error: images.length === 0 ? 'No images directly in this folder.' : null,
        })
      } catch (e) {
        patch(sid, {
          status: 'error',
          error: `Couldn’t read the folder (${e.message}). It may have been moved or renamed — choose it again.`,
        })
      }
    },
    [projectId, patch, releaseUrls]
  )

  const loadSource = useCallback(
    (sid, key, opts) => {
      const entry = entriesRef.current.find((e) => e.sid === sid)
      if (!entry) return
      return entry.vendor === 'gdrive' ? loadDrive(entry, key) : loadLocal(entry, opts)
    },
    [loadDrive, loadLocal]
  )

  // First load for this project (the component is keyed by project id), and
  // teardown on leave. Safe under StrictMode's mount → unmount → mount.
  useEffect(() => {
    const aborts = abortRefs.current
    const urls = urlsRef.current
    for (const e of entriesRef.current) {
      if (e.vendor === 'gdrive') loadDrive(e) // reports "No API key set." itself
      else loadLocal(e)
    }
    return () => {
      aborts.forEach((c) => c.abort())
      aborts.clear()
      for (const list of urls.values()) list.forEach((u) => URL.revokeObjectURL(u))
      urls.clear()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /** Add Drive links. Already-added folders are skipped. */
  const addLinks = useCallback(
    (text, key) => {
      const parsed = parseLinks(text)
      if (!parsed.length) return { added: 0, duplicates: 0 }
      const known = new Set(entriesRef.current.filter((e) => e.vendor === 'gdrive').map((e) => e.folderId))
      const fresh = []
      let duplicates = 0
      for (const p of parsed) {
        if (known.has(p.id)) {
          duplicates++
          continue
        }
        known.add(p.id)
        fresh.push({ link: p.link, folderId: p.id, name: null })
      }
      if (fresh.length) {
        updateSaved((s) => ({ ...s, gdrive: [...s.gdrive, ...fresh] }))
        for (const f of fresh)
          loadDrive({ sid: `g:${f.folderId}`, vendor: 'gdrive', ref: f.link, folderId: f.folderId }, key)
      }
      return { added: fresh.length, duplicates }
    },
    [updateSaved, loadDrive]
  )

  /** Pick a folder and add it. Must run from a click. */
  const addLocalFolder = useCallback(async () => {
    const handle = await LF.pickFolder() // throws AbortError if dismissed
    const label = window.prompt(
      'Path or label for this folder (saved in the project so you can recognise it on other devices):',
      handle.name
    )
    if (label === null) return null
    const path = label.trim() || handle.name
    if (entriesRef.current.some((e) => e.vendor === 'local' && e.ref === path)) {
      throw new Error(`A local folder labelled “${path}” is already in this project.`)
    }
    const id = uid('l')
    await LF.saveHandle(projectId, id, handle)
    updateSaved((s) => ({ ...s, local: [...s.local, { id, path, name: handle.name }] }))
    loadLocal({ sid: `l:${id}`, vendor: 'local', ref: path, localId: id }, { handle, request: true })
    return path
  }, [projectId, updateSaved, loadLocal])

  /** Point an existing local source at a folder on this device. Click only. */
  const relinkLocal = useCallback(
    async (sid) => {
      const entry = entriesRef.current.find((e) => e.sid === sid)
      if (!entry || entry.vendor !== 'local') return
      const handle = await LF.pickFolder()
      await LF.saveHandle(projectId, entry.localId, handle)
      updateSaved((s) => ({
        ...s,
        local: s.local.map((l) => (l.id === entry.localId ? { ...l, name: handle.name } : l)),
      }))
      return loadLocal(entry, { handle, request: true })
    },
    [projectId, updateSaved, loadLocal]
  )

  const removeSource = useCallback(
    (sid) => {
      const entry = entriesRef.current.find((e) => e.sid === sid)
      if (!entry) return
      abortRefs.current.get(sid)?.abort()
      releaseUrls(sid)
      setRuntime((prev) => {
        const next = { ...prev }
        delete next[sid]
        return next
      })
      if (entry.vendor === 'gdrive') {
        updateSaved((s) => ({ ...s, gdrive: s.gdrive.filter((g) => g.folderId !== entry.folderId) }))
      } else {
        LF.forgetHandle(projectId, entry.localId)
        updateSaved((s) => ({ ...s, local: s.local.filter((l) => l.id !== entry.localId) }))
      }
    },
    [projectId, updateSaved, releaseUrls]
  )

  const reloadAll = useCallback(
    (key) => {
      for (const e of entriesRef.current) {
        if (e.vendor === 'gdrive') loadDrive(e, key)
        else loadLocal(e)
      }
    },
    [loadDrive, loadLocal]
  )

  const sources = useMemo(
    () =>
      entries.map((e) => {
        const r = runtime[e.sid] || {}
        return {
          id: e.sid,
          sid: e.sid,
          vendor: e.vendor,
          ref: e.ref,
          name: e.vendor === 'gdrive' ? r.name || e.savedName || null : e.ref,
          folderName: r.name || e.savedName || null,
          images: r.images || [],
          status: r.status || 'idle',
          error: r.error || null,
        }
      }),
    [entries, runtime]
  )

  const toggleCollapsed = useCallback(
    (sid) => setCollapsedState((p) => ({ ...p, [sid]: !p[sid] })),
    []
  )
  const setAllCollapsed = useCallback(
    (value) =>
      setCollapsedState(() => Object.fromEntries(entriesRef.current.map((e) => [e.sid, value]))),
    []
  )

  const allImages = useMemo(() => {
    const seen = new Set()
    const out = []
    for (const s of sources)
      for (const img of s.images) {
        if (seen.has(img.id)) continue
        seen.add(img.id)
        out.push(img)
      }
    return out
  }, [sources])

  const byId = useMemo(() => new Map(allImages.map((i) => [i.id, i])), [allImages])

  /** photo key → a short label of where it came from. */
  const sourceOf = useMemo(() => {
    const map = new Map()
    for (const s of sources)
      for (const img of s.images)
        if (!map.has(img.id)) map.set(img.id, s.name || s.ref)
    return map
  }, [sources])

  return {
    sources,
    allImages,
    byId,
    sourceOf,
    collapsed,
    loading: sources.some((s) => s.status === 'loading'),
    addLinks,
    addLocalFolder,
    relinkLocal,
    loadSource,
    removeSource,
    reloadAll,
    toggleCollapsed,
    setAllCollapsed,
  }
}

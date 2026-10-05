// Local folders via the File System Access API (Chrome / Edge).
//
// The browser never reveals a real path, so the project stores a path label
// (what you typed, defaulting to the folder name) plus file names. The actual
// folder handle is kept in this browser's IndexedDB, keyed by
// `<projectId>/<sourceId>`, so the same project on another device simply shows
// the folder as "not connected here" until you point it at a folder there.

const DB = 'imageplayer-local'
const STORE = 'handles'
const IMAGE_RE = /\.(jpe?g|png|gif|webp|avif|bmp|heic|heif|tiff?)$/i

export const supported = () =>
  typeof window !== 'undefined' && 'showDirectoryPicker' in window

function db() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function tx(mode, fn) {
  const d = await db()
  return new Promise((resolve, reject) => {
    const t = d.transaction(STORE, mode)
    const r = fn(t.objectStore(STORE))
    t.oncomplete = () => resolve(r?.result)
    t.onerror = () => reject(t.error)
  })
}

const hKey = (projectId, sourceId) => `${projectId}/${sourceId}`

export const saveHandle = (projectId, sourceId, handle) =>
  tx('readwrite', (s) => s.put(handle, hKey(projectId, sourceId)))
export const loadHandle = (projectId, sourceId) =>
  tx('readonly', (s) => s.get(hKey(projectId, sourceId))).catch(() => null)
export const forgetHandle = (projectId, sourceId) =>
  tx('readwrite', (s) => s.delete(hKey(projectId, sourceId))).catch(() => {})

/** Opens the folder picker. Must be called from a click. */
export async function pickFolder() {
  return window.showDirectoryPicker({ id: 'imageplayer', mode: 'read' })
}

/** 'granted' | 'prompt' | 'denied'. With request=true it may show a prompt (click only). */
export async function permission(handle, request = false) {
  const opts = { mode: 'read' }
  let state = await handle.queryPermission(opts)
  if (state !== 'granted' && request) state = await handle.requestPermission(opts)
  return state
}

/** Top-level image files only, natural name order. */
export async function listImages(handle) {
  const files = []
  for await (const entry of handle.values()) {
    if (entry.kind !== 'file' || !IMAGE_RE.test(entry.name)) continue
    files.push(entry)
  }
  files.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
  const out = []
  for (const entry of files) {
    const file = await entry.getFile()
    out.push({ name: file.name, file, size: file.size })
  }
  return out
}

// Project document — the one JSON blob saved per project.
//
// {
//   version: 1, id, name, createdAt, updatedAt,
//   sources: {
//     gdrive: [{ link, folderId, name }],          // link = the line you pasted
//     local:  [{ id, path, name }],                // path = what you typed/picked
//   },
//   collections: {
//     [id]: { id, name, parentId, createdAt,
//       images: {
//         gdrive: { [link]: [driveFileId, …] },
//         local:  { [path]: [fileName, …] },
//       } } }
// }
//
// In memory, every photo is addressed by a single string key that encodes
// vendor + source + item, so selection/groups/drag-and-drop keep working on
// plain strings. JSON-encoding the triple keeps it safe for any path or link.

export const VERSION = 1
export const VENDORS = ['gdrive', 'local']
export const VENDOR_LABEL = { gdrive: 'Google Drive', local: 'Local folder' }

export const photoKey = (vendor, ref, item) => JSON.stringify([vendor, ref, item])

export function parseKey(key) {
  try {
    const [vendor, ref, item] = JSON.parse(key)
    return { vendor, ref, item }
  } catch {
    return null
  }
}

export function uid(prefix = '') {
  return (
    prefix +
    Math.random().toString(36).slice(2, 10) +
    Date.now().toString(36).slice(-4)
  )
}

export function emptyProject(name) {
  const now = Date.now()
  return {
    version: VERSION,
    id: uid('p'),
    name: name?.trim() || 'Untitled project',
    createdAt: now,
    updatedAt: now,
    sources: { gdrive: [], local: [] },
    collections: {},
  }
}

/** Trust nothing that came over the wire. */
export function sanitizeProject(raw) {
  const p = raw && typeof raw === 'object' ? raw : {}
  const gdrive = Array.isArray(p.sources?.gdrive) ? p.sources.gdrive : []
  const local = Array.isArray(p.sources?.local) ? p.sources.local : []
  const collections = {}
  for (const [id, c] of Object.entries(p.collections || {})) {
    if (!c || typeof c.name !== 'string') continue
    const images = { gdrive: {}, local: {} }
    for (const v of VENDORS) {
      for (const [ref, items] of Object.entries(c.images?.[v] || {})) {
        if (Array.isArray(items) && items.length)
          images[v][ref] = [...new Set(items.map(String))]
      }
    }
    collections[id] = {
      id,
      name: c.name,
      parentId: c.parentId ?? null,
      createdAt: Number(c.createdAt) || 0,
      images,
    }
  }
  for (const c of Object.values(collections)) {
    if (c.parentId && !collections[c.parentId]) c.parentId = null
  }
  return {
    version: VERSION,
    id: String(p.id || uid('p')),
    name: String(p.name || 'Untitled project'),
    createdAt: Number(p.createdAt) || Date.now(),
    updatedAt: Number(p.updatedAt) || Date.now(),
    sources: {
      gdrive: gdrive
        .filter((s) => s && s.link && s.folderId)
        .map((s) => ({ link: String(s.link), folderId: String(s.folderId), name: s.name || null })),
      local: local
        .filter((s) => s && s.id && s.path)
        .map((s) => ({ id: String(s.id), path: String(s.path), name: s.name || null })),
    },
    collections,
  }
}

/** Saved collections → the in-memory group tree (photoIds are photo keys). */
export function collectionsToGroups(collections) {
  const groups = {}
  for (const c of Object.values(collections || {})) {
    const photoIds = []
    for (const v of VENDORS) {
      for (const [ref, items] of Object.entries(c.images?.[v] || {})) {
        for (const item of items) photoIds.push(photoKey(v, ref, item))
      }
    }
    groups[c.id] = {
      id: c.id,
      name: c.name,
      parentId: c.parentId,
      createdAt: c.createdAt,
      photoIds,
    }
  }
  return groups
}

/** In-memory group tree → the nested vendor / path-or-link / [items] shape. */
export function groupsToCollections(groups) {
  const out = {}
  for (const g of Object.values(groups || {})) {
    const images = { gdrive: {}, local: {} }
    for (const key of g.photoIds) {
      const k = parseKey(key)
      if (!k || !images[k.vendor]) continue
      ;(images[k.vendor][k.ref] ||= []).push(k.item)
    }
    out[g.id] = {
      id: g.id,
      name: g.name,
      parentId: g.parentId ?? null,
      createdAt: g.createdAt,
      images,
    }
  }
  return out
}

// ---- migration from the old browser-only version --------------------------

const LEGACY_SOURCES = 'imageplayer.sources'
const LEGACY_GROUPS = 'imageplayer.groups'
export const LEGACY_IMPORTED = 'imageplayer.legacyImportedTo'

export function readLegacy() {
  try {
    const sources = JSON.parse(localStorage.getItem(LEGACY_SOURCES) || '[]')
    const groups = JSON.parse(localStorage.getItem(LEGACY_GROUPS) || 'null')?.groups || {}
    const groupCount = Object.keys(groups).length
    if (!sources.length && !groupCount) return null
    return { sources, groups, groupCount }
  } catch {
    return null
  }
}

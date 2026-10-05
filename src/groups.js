// Group store: an arbitrarily-nested tree of photo collections. A group holds
// photo IDs and may have child groups; a photo can live in any number of groups.
//
// Shape:
//   { version: 2, groups: { [id]: { id, name, parentId, photoIds, createdAt } } }
//
// parentId === null means top level. We keep it flat and derive the tree so
// re-parenting is a single field write rather than a splice in two places.
//
// The store is global rather than per-folder: now that several Drive folders can
// be loaded at once, a single group is expected to mix photos from any of them.
// Drive file IDs are globally unique, so nothing needs namespacing.

const STORE = 'imageplayer.groups'
const LEGACY_PREFIX = 'imageplayer.groups.'
const MIGRATED_FLAG = 'imageplayer.groups.migrated'
export const VERSION = 2

export function uid() {
  return (
    Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4)
  )
}

export function emptyState() {
  return { version: VERSION, groups: {} }
}

/** Normalise whatever came out of storage into a trustworthy tree. */
function sanitise(parsed) {
  if (!parsed || typeof parsed !== 'object' || typeof parsed.groups !== 'object') {
    return emptyState()
  }
  const groups = {}
  for (const [id, g] of Object.entries(parsed.groups)) {
    if (!g || typeof g.name !== 'string') continue
    groups[id] = {
      id,
      name: g.name,
      parentId: g.parentId ?? null,
      photoIds: Array.isArray(g.photoIds) ? [...new Set(g.photoIds)] : [],
      createdAt: Number(g.createdAt) || 0,
    }
  }
  // Repair parent pointers to groups that no longer exist, and break any cycle
  // that somehow survived (a corrupted file shouldn't hang the tree walk).
  for (const g of Object.values(groups)) {
    if (g.parentId && !groups[g.parentId]) g.parentId = null
  }
  for (const g of Object.values(groups)) {
    const seen = new Set([g.id])
    let cur = g.parentId
    while (cur && groups[cur]) {
      if (seen.has(cur)) {
        g.parentId = null
        break
      }
      seen.add(cur)
      cur = groups[cur].parentId
    }
  }
  return { version: VERSION, groups }
}

/**
 * One-time merge of the old per-folder stores (`imageplayer.groups.<folderId>`)
 * into the global one. Group IDs are random, so folders can't collide; names
 * are left alone even if two folders happened to use the same one.
 */
export function migrateLegacy() {
  try {
    if (localStorage.getItem(MIGRATED_FLAG)) return null

    const merged = {}
    const legacyKeys = []
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (!key || !key.startsWith(LEGACY_PREFIX)) continue
      if (key === MIGRATED_FLAG) continue
      legacyKeys.push(key)
    }

    for (const key of legacyKeys) {
      try {
        const { groups } = sanitise(JSON.parse(localStorage.getItem(key)))
        Object.assign(merged, groups)
      } catch {
        /* skip unreadable legacy entry */
      }
    }

    localStorage.setItem(MIGRATED_FLAG, '1')
    if (!Object.keys(merged).length) return null

    // Fold into anything already in the global store rather than overwriting.
    const existing = sanitise(JSON.parse(localStorage.getItem(STORE) || 'null'))
    const next = { version: VERSION, groups: { ...merged, ...existing.groups } }
    localStorage.setItem(STORE, JSON.stringify(next))
    return next
  } catch {
    return null
  }
}

export function load() {
  try {
    migrateLegacy()
    const raw = localStorage.getItem(STORE)
    if (!raw) return emptyState()
    return sanitise(JSON.parse(raw))
  } catch {
    return emptyState()
  }
}

export function save(state) {
  try {
    localStorage.setItem(STORE, JSON.stringify(state))
  } catch {
    // Quota exceeded or storage disabled — groups just won't persist.
  }
}

// ---- tree helpers ---------------------------------------------------------

export function childrenOf(groups, parentId) {
  return Object.values(groups)
    .filter((g) => g.parentId === parentId)
    .sort((a, b) => a.createdAt - b.createdAt || a.name.localeCompare(b.name))
}

export function descendantIds(groups, id) {
  const out = []
  const stack = [id]
  while (stack.length) {
    const current = stack.pop()
    for (const g of Object.values(groups)) {
      if (g.parentId === current) {
        out.push(g.id)
        stack.push(g.id)
      }
    }
  }
  return out
}

/** True if `candidate` is `ancestor` itself or sits anywhere beneath it. */
export function isSelfOrDescendant(groups, candidate, ancestor) {
  if (candidate === ancestor) return true
  return descendantIds(groups, ancestor).includes(candidate)
}

export function ancestorIds(groups, id) {
  const out = []
  let cur = groups[id]?.parentId ?? null
  const guard = new Set()
  while (cur && groups[cur] && !guard.has(cur)) {
    guard.add(cur)
    out.push(cur)
    cur = groups[cur].parentId ?? null
  }
  return out
}

export function pathOf(groups, id) {
  const names = []
  let cur = groups[id]
  const guard = new Set()
  while (cur && !guard.has(cur.id)) {
    guard.add(cur.id)
    names.unshift(cur.name)
    cur = cur.parentId ? groups[cur.parentId] : null
  }
  return names
}

/** Photo IDs in a group, optionally including every descendant group. */
export function collectPhotoIds(groups, id, includeSubgroups = false) {
  const g = groups[id]
  if (!g) return []
  if (!includeSubgroups) return [...g.photoIds]
  const ids = [...g.photoIds]
  for (const d of descendantIds(groups, id)) {
    ids.push(...(groups[d]?.photoIds || []))
  }
  return [...new Set(ids)]
}

/** Depth-first flattening, for indented menus and the sidebar. */
export function flatten(groups, parentId = null, depth = 0, out = []) {
  for (const g of childrenOf(groups, parentId)) {
    out.push({ ...g, depth })
    flatten(groups, g.id, depth + 1, out)
  }
  return out
}

/** Which groups (if any) directly contain this photo. */
export function groupsContaining(groups, photoId) {
  return Object.values(groups).filter((g) => g.photoIds.includes(photoId))
}

// Google Drive helpers. Calls go out as the signed-in Google user when there's
// a token (works for anything you can open in Drive), else with the API key
// (link-shared files only).
import { getAccessToken } from './googleAuth'

/** Adds auth to a Drive request: Bearer token if signed in, else ?key=. */
export function driveAuth(params, apiKey) {
  const token = getAccessToken()
  if (token) return { params, headers: { Authorization: `Bearer ${token}` } }
  if (apiKey) return { params: { ...params, key: apiKey }, headers: {} }
  throw new Error('Sign in with Google (or add an API key) to load Drive photos.')
}

export const hasDriveAuth = (apiKey) => !!(getAccessToken() || (apiKey || '').trim())

const API = 'https://www.googleapis.com/drive/v3/files'

/**
 * Pull a Drive file or folder ID out of just about any Drive URL shape.
 * Supports:
 *   https://drive.google.com/drive/folders/<id>
 *   https://drive.google.com/drive/u/0/folders/<id>?usp=sharing
 *   https://drive.google.com/open?id=<id>
 *   https://drive.google.com/file/d/<id>/view
 *   https://drive.google.com/uc?id=<id>
 *   a bare <id>
 */
export function parseDriveId(input) {
  if (!input) return null
  const raw = input.trim()

  // Bare ID (Drive IDs are 25+ chars of [A-Za-z0-9_-])
  if (/^[A-Za-z0-9_-]{20,}$/.test(raw)) return raw

  let url
  try {
    url = new URL(raw)
  } catch {
    return null
  }

  const byQuery = url.searchParams.get('id')
  if (byQuery) return byQuery

  const patterns = [
    /\/folders\/([A-Za-z0-9_-]+)/,
    /\/file\/d\/([A-Za-z0-9_-]+)/,
    /\/d\/([A-Za-z0-9_-]+)/,
  ]
  for (const p of patterns) {
    const m = url.pathname.match(p)
    if (m) return m[1]
  }
  return null
}

/**
 * Pull every distinct Drive ID out of a blob of pasted text — newline, space
 * or comma separated. Junk lines are skipped rather than erroring, so pasting
 * a list with stray text still works.
 */
export function parseLinks(text) {
  const out = []
  const seen = new Set()
  for (const token of String(text || '').split(/[\s,]+/)) {
    const trimmed = token.trim()
    if (!trimmed) continue
    const id = parseDriveId(trimmed)
    if (id && !seen.has(id)) {
      seen.add(id)
      out.push({ id, link: trimmed })
    }
  }
  return out
}

function friendlyError(status, body) {
  const reason = body?.error?.message || `HTTP ${status}`
  if (status === 403) {
    return `Access denied by Google (${reason}). Check that the Drive API is enabled for your key, that any key restrictions allow this site, and that the folder is shared as "Anyone with the link".`
  }
  if (status === 404) {
    return `Folder not found (${reason}). Double-check the link, and that your Google account (or “Anyone with the link”) can open it.`
  }
  if (status === 400) {
    return `Google rejected the request (${reason}). The API key is probably malformed.`
  }
  return reason
}

/** Fetch metadata for a single file by ID. */
export async function fetchFileById(fileId, apiKey) {
  const auth = driveAuth(
    { fields: 'id,name,mimeType,imageMediaMetadata(width,height)', supportsAllDrives: 'true' },
    apiKey
  )
  const qs = new URLSearchParams(auth.params)
  const res = await fetch(`${API}/${fileId}?${qs}`, { headers: auth.headers })
  if (!res.ok) {
    let body = null
    try {
      body = await res.json()
    } catch {
      /* ignore */
    }
    throw new Error(friendlyError(res.status, body))
  }
  return res.json()
}

/**
 * List every image in a public Drive folder, following pagination.
 * Returns [{ id, name, width, height }] sorted by name (natural order).
 */
export async function listFolderImages(folderId, apiKey, { signal } = {}) {
  const images = []
  let pageToken

  do {
    const params = {
      q: `'${folderId}' in parents and mimeType contains 'image/' and trashed = false`,
      fields:
        'nextPageToken, files(id,name,mimeType,imageMediaMetadata(width,height))',
      pageSize: '1000',
      orderBy: 'name_natural',
      supportsAllDrives: 'true',
      includeItemsFromAllDrives: 'true',
    }
    if (pageToken) params.pageToken = pageToken

    const auth = driveAuth(params, apiKey)
    const qs = new URLSearchParams(auth.params)
    const res = await fetch(`${API}?${qs}`, { signal, headers: auth.headers })
    if (!res.ok) {
      let body = null
      try {
        body = await res.json()
      } catch {
        /* ignore */
      }
      throw new Error(friendlyError(res.status, body))
    }
    const data = await res.json()

    for (const f of data.files || []) {
      images.push({
        id: f.id,
        name: f.name,
        width: f.imageMediaMetadata?.width,
        height: f.imageMediaMetadata?.height,
      })
    }
    pageToken = data.nextPageToken
  } while (pageToken)

  return images
}

/**
 * Displayable URL for a Drive image.
 *
 * Google's `lh3.googleusercontent.com/d/<id>` endpoint serves public Drive
 * images with permissive CORS and honours a size hint, which makes it far more
 * reliable inside an <img> than the old `uc?export=view` redirect.
 * `size` is the longest edge in px; pass 0 for original.
 */
export function imageUrl(id, size = 2400) {
  return size
    ? `https://lh3.googleusercontent.com/d/${id}=s${size}`
    : `https://lh3.googleusercontent.com/d/${id}`
}

/** Fallback URL if the lh3 host fails for a given file. */
export function fallbackImageUrl(id) {
  return `https://drive.google.com/thumbnail?id=${id}&sz=w2400`
}

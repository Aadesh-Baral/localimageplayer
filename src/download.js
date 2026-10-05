import JSZip from 'jszip'
import { driveAuth } from './drive'

export function safeName(name, fallbackId) {
  // Names come from Drive, so treat them as untrusted: no path separators,
  // control characters, or dot-only names that could mean "parent folder"
  // when a zip is extracted.
  let cleaned = String(name || '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[/\\:*?"<>|]/g, '_')
    .trim()
    .slice(0, 200)
  if (!cleaned || /^\.+$/.test(cleaned)) cleaned = `${fallbackId}.jpg`
  if (cleaned.startsWith('.')) cleaned = `_${cleaned}`
  return cleaned
}

/** photo.jpg, photo (2).jpg, photo (3).jpg … */
export function dedupe(name, used) {
  if (!used.has(name)) {
    used.add(name)
    return name
  }
  const dot = name.lastIndexOf('.')
  const stem = dot > 0 ? name.slice(0, dot) : name
  const ext = dot > 0 ? name.slice(dot) : ''
  let n = 2
  let candidate = `${stem} (${n})${ext}`
  while (used.has(candidate)) {
    n += 1
    candidate = `${stem} (${n})${ext}`
  }
  used.add(candidate)
  return candidate
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

export function zipFilename(label) {
  const stamp = new Date().toISOString().slice(0, 10)
  const clean = (label || 'photos').replace(/[/\\:*?"<>|]/g, '_').trim()
  return `${clean || 'photos'} ${stamp}.zip`
}

const sleep = (ms, signal) =>
  new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms)
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(t)
        reject(new DOMException('Aborted', 'AbortError'))
      },
      { once: true }
    )
  })

// Google reasons worth waiting out rather than failing on straight away.
const TRANSIENT_REASONS = new Set([
  'userRateLimitExceeded',
  'rateLimitExceeded',
  'backendError',
  'internalError',
])

function describe(status, reason, message) {
  if (reason === 'downloadQuotaExceeded')
    return "Google's download limit for this file was hit (too many downloads recently). Try again in a few hours."
  if (reason === 'cannotDownloadAbusiveFile')
    return 'Google has flagged this file and blocks downloading it without sign-in.'
  if (status === 404)
    return "Not found — the file was moved or deleted, or your Google account can’t open it."
  if (status === 403 && /referer|referrer/i.test(message || ''))
    return "Blocked by the API key's website restriction. Allow this site's address on the key."
  if (status === 403 && /has not been used|disabled/i.test(message || ''))
    return 'The Drive API is disabled for this API key.'
  if (status === 403)
    return `Access denied by Google${reason ? ` (${reason})` : ''}${message ? `: ${message}` : ''}`
  return `${message || 'Request failed'}${reason ? ` (${reason})` : ''}`
}

/**
 * Fetch one photo's ORIGINAL bytes from the Drive API (never a resized copy).
 * Retries rate limits and server errors with backoff; anything else fails fast
 * with Google's own reason so the Downloads tab can show why.
 */
export async function fetchOriginal(photo, apiKey, { signal, attempts = 3 } = {}) {
  let lastError

  for (let attempt = 0; attempt < attempts; attempt++) {
    if (attempt > 0) await sleep(1500 * 2 ** (attempt - 1), signal)

    // Re-read auth each attempt: the token may have been renewed meanwhile.
    const auth = driveAuth({ alt: 'media', supportsAllDrives: 'true' }, apiKey)
    const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(
      photo.id
    )}?${new URLSearchParams(auth.params)}`

    let res
    try {
      res = await fetch(url, { signal, headers: auth.headers })
    } catch (e) {
      if (e.name === 'AbortError') throw e
      // fetch() only throws like this when the browser blocked or lost the
      // request before Google answered — CORS, offline, ad-blocker, etc.
      lastError = Object.assign(
        new Error(
          `Network error before Google replied (${e.message}). Often a CORS block, an ad/privacy blocker, or a dropped connection.`
        ),
        { status: 0 }
      )
      continue
    }

    if (res.ok) return res.blob()

    let body = null
    try {
      body = await res.json()
    } catch {
      /* not JSON */
    }
    const reason = body?.error?.errors?.[0]?.reason || body?.error?.status || ''
    const message = body?.error?.message || ''
    lastError = Object.assign(
      new Error(`HTTP ${res.status} — ${describe(res.status, reason, message)}`),
      { status: res.status, reason }
    )

    const transient =
      res.status === 429 || res.status >= 500 || TRANSIENT_REASONS.has(reason)
    if (!transient) break
  }

  throw lastError
}

/** Zip already-fetched originals (STORE — JPEGs don't compress) and save it. */
export async function saveZip(entries, label, onProgress) {
  const zip = new JSZip()
  const used = new Set()
  for (const { photo, blob } of entries) {
    zip.file(dedupe(safeName(photo.name, photo.fileId || 'photo'), used), blob)
  }
  const blob = await zip.generateAsync(
    { type: 'blob', compression: 'STORE' },
    (meta) => onProgress?.(Math.round(meta.percent))
  )
  const filename = zipFilename(label)
  triggerDownload(blob, filename)
  return filename
}

// ---- save straight into a folder (Chrome/Edge) ------------------------------

export const canSaveToFolder = () =>
  typeof window !== 'undefined' && 'showDirectoryPicker' in window

/** Ask where to save. Must be called directly from a click. */
export async function pickDownloadFolder() {
  return window.showDirectoryPicker({ id: 'imageplayer-downloads', mode: 'readwrite' })
}

/** Make sure we may still write there (re-asks if the browser forgot). */
export async function ensureWritable(dir) {
  const opts = { mode: 'readwrite' }
  if ((await dir.queryPermission(opts)) === 'granted') return true
  return (await dir.requestPermission(opts)) === 'granted'
}

/** A subfolder for this job: "<label> <date>", created if missing. */
export async function jobFolder(parent, label) {
  const name = zipFilename(label).replace(/\.zip$/, '')
  return parent.getDirectoryHandle(name, { create: true })
}

/** Write one file into `dir`, never clobbering a different photo of the same name. */
export async function writeFile(dir, photo, blob, used) {
  const name = dedupe(safeName(photo.name, photo.fileId || 'photo'), used)
  const fh = await dir.getFileHandle(name, { create: true })
  const w = await fh.createWritable()
  try {
    await w.write(blob)
    await w.close()
  } catch (e) {
    await w.abort?.().catch(() => {})
    throw e
  }
  return name
}

/** Zip parts are capped so the browser never has to hold gigabytes at once. */
export const ZIP_PART_BYTES = 500 * 1024 * 1024

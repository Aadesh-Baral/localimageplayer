import { useCallback, useEffect, useRef, useState } from 'react'
import {
  saveZip,
  canSaveToFolder,
  pickDownloadFolder,
  ensureWritable,
  jobFolder,
  writeFile,
  ZIP_PART_BYTES,
} from './download'
import { originalBlob } from './media'
import { hasDriveAuth } from './drive'
import { saveHandle, loadHandle, forgetHandle } from './localFolders'

const MODE_STORE = 'imageplayer.downloadMode'
const HISTORY_STORE = 'imageplayer.downloads.v1'
const HISTORY_MAX = 60
const HANDLE_NS = 'downloads' // IndexedDB key prefix for folder handles

// What a photo needs to be fetched again later (no File objects / object URLs).
const slim = (p) => ({ id: p.id, vendor: p.vendor, fileId: p.fileId, name: p.name })

/** History from earlier sessions. Anything mid-flight then is now "interrupted". */
function loadHistory() {
  try {
    const list = JSON.parse(localStorage.getItem(HISTORY_STORE) || '[]')
    return list.map((j) => {
      const live = j.status === 'running' || j.status === 'queued'
      return {
        ...j,
        phase: null,
        current: null,
        status: live ? 'interrupted' : j.status,
        items: j.items.map((it) =>
          it.status === 'pending' || it.status === 'fetching'
            ? { ...it, status: 'failed', error: 'Interrupted — the page was closed or reloaded.' }
            : it
        ),
      }
    })
  } catch {
    return []
  }
}

function saveHistory(jobs) {
  const data = jobs.slice(0, HISTORY_MAX).map((j) => ({
    ...j,
    items: j.items.map((it) => ({ photo: slim(it.photo), status: it.status, error: it.error })),
  }))
  try {
    localStorage.setItem(HISTORY_STORE, JSON.stringify(data))
  } catch {
    // Quota: keep the newest half rather than nothing.
    try {
      localStorage.setItem(HISTORY_STORE, JSON.stringify(data.slice(0, Math.ceil(data.length / 2))))
    } catch {
      /* give up quietly */
    }
  }
}

/**
 * App-wide download queue. Each job is one request (a selection or a group);
 * jobs run one at a time, photos inside a job run sequentially to stay under
 * Drive's rate limits. Every photo keeps its own status and error, so a job
 * can be retried for just the photos that failed.
 *
 * Two ways to save, so big jobs never sit in memory all at once:
 *   folder — (Chrome/Edge) each photo is written to disk the moment it arrives
 *   zip    — photos are bundled into parts of at most ~500 MB
 *
 * Job shape:
 *   { id, label, createdAt, status, attempt, phase, percent, current, mode,
 *     savedTo, zips: [filename], items: [{ photo, status, error }] }
 * status: queued | running | done | partial | failed | cancelled
 * item.status: pending | fetching | ok | failed
 */
export default function useDownloads() {
  const [jobs, setJobs] = useState(loadHistory)
  const jobsRef = useRef(jobs)
  jobsRef.current = jobs
  const queue = useRef([]) // [{ jobId, idxs, apiKey }]
  const controllers = useRef(new Map())
  const running = useRef(false)
  const targets = useRef(new Map()) // jobId → { parent, dir, used } for folder mode

  // Persist history (debounced; progress ticks don't each hit storage).
  useEffect(() => {
    const t = setTimeout(() => saveHistory(jobs), 600)
    return () => clearTimeout(t)
  }, [jobs])

  /** Folder handles for a job — from memory, or from IndexedDB after a reload. */
  const targetFor = useCallback(async (jobId) => {
    let t = targets.current.get(jobId)
    if (t) return t
    const saved = await loadHandle(HANDLE_NS, jobId)
    if (!saved?.parent) return null
    t = { parent: saved.parent, dir: saved.dir || null, used: new Set() }
    if (t.dir) {
      try {
        for await (const name of t.dir.keys()) t.used.add(name) // don't overwrite earlier files
      } catch {
        /* folder gone; it's recreated on write */
        t.dir = null
      }
    }
    targets.current.set(jobId, t)
    return t
  }, [])

  const [mode, setModeState] = useState(() => {
    let m = null
    try {
      m = localStorage.getItem(MODE_STORE)
    } catch {
      /* ignore */
    }
    return canSaveToFolder() ? m || 'folder' : 'zip'
  })
  const setMode = useCallback((m) => {
    setModeState(m)
    try {
      localStorage.setItem(MODE_STORE, m)
    } catch {
      /* ignore */
    }
  }, [])

  const patchJob = useCallback((id, fn) => {
    setJobs((list) => list.map((j) => (j.id === id ? { ...j, ...fn(j) } : j)))
  }, [])

  const patchItem = useCallback((id, idx, patch) => {
    setJobs((list) =>
      list.map((j) => {
        if (j.id !== id) return j
        const items = j.items.slice()
        items[idx] = { ...items[idx], ...patch }
        return { ...j, items }
      })
    )
  }, [])

  const pump = useCallback(async () => {
    if (running.current) return
    running.current = true
    try {
      while (queue.current.length) {
        const { jobId, idxs, apiKey } = queue.current.shift()
        const job = jobsRef.current.find((j) => j.id === jobId)
        if (!job || job.status === 'cancelled') continue

        const controller = new AbortController()
        controllers.current.set(jobId, controller)
        const { signal } = controller
        patchJob(jobId, () => ({ status: 'running', phase: 'fetching', percent: 0 }))

        let failed = 0
        let cancelled = false
        let saveError = null

        const label = job.attempt > 0 ? `${job.label} (retry ${job.attempt})` : job.label
        const target = targets.current.get(jobId)
        if (job.mode === 'folder') {
          try {
            if (!target || !(await ensureWritable(target.parent)))
              throw new Error('No permission to write to the chosen folder.')
          } catch (e) {
            saveError = e.message
          }
        }

        // zip mode: photos collect into a part until it nears the size cap
        let part = []
        let partBytes = 0
        let partNo = 0
        const newZips = []
        const flushPart = async (final) => {
          if (!part.length) return
          partNo++
          const name = !final || partNo > 1 ? `${label} part ${partNo}` : label
          patchJob(jobId, () => ({ phase: 'zipping', current: name }))
          const entries = part
          part = []
          partBytes = 0
          try {
            newZips.push(await saveZip(entries, name))
          } catch (e) {
            // Nothing from this part reached disk — make it retryable.
            for (const en of entries)
              patchItem(jobId, en.idx, { status: 'failed', error: `Couldn’t save zip: ${e.message}` })
            failed += entries.length
          }
          patchJob(jobId, () => ({ phase: 'fetching' }))
        }

        for (let n = 0; n < idxs.length && !saveError; n++) {
          const idx = idxs[n]
          const photo = job.items[idx].photo
          if (signal.aborted) {
            cancelled = true
            break
          }
          patchJob(jobId, () => ({
            current: photo.name,
            percent: Math.round((n / idxs.length) * 100),
          }))
          patchItem(jobId, idx, { status: 'fetching', error: null })
          try {
            if (photo.vendor !== 'local' && !hasDriveAuth(apiKey))
              throw new Error('Google session expired — click Continue at the top, then retry.')
            const blob = await originalBlob(photo, apiKey, { signal })
            if (job.mode === 'folder') {
              if (!target.dir) {
                target.dir = await jobFolder(target.parent, job.label)
                saveHandle(HANDLE_NS, jobId, { parent: target.parent, dir: target.dir }).catch(() => {})
              }
              await writeFile(target.dir, photo, blob, target.used)
              patchItem(jobId, idx, { status: 'ok', error: null })
            } else {
              part.push({ photo, blob, idx })
              partBytes += blob.size
              patchItem(jobId, idx, { status: 'ok', error: null })
              if (partBytes >= ZIP_PART_BYTES) await flushPart(false)
            }
          } catch (e) {
            if (e.name === 'AbortError') {
              cancelled = true
              patchItem(jobId, idx, { status: 'failed', error: 'Cancelled' })
              break
            }
            failed++
            patchItem(jobId, idx, { status: 'failed', error: e.message })
            console.warn('[imageplayer] download failed:', photo.name, e)
          }
        }
        if (job.mode !== 'folder') await flushPart(true)

        if (cancelled || saveError) {
          // Anything not reached counts as failed, so "Retry failed" picks it up.
          setJobs((list) =>
            list.map((j) =>
              j.id !== jobId
                ? j
                : {
                    ...j,
                    items: j.items.map((it, i) =>
                      idxs.includes(i) && (it.status === 'pending' || it.status === 'fetching')
                        ? { ...it, status: 'failed', error: saveError || 'Cancelled' }
                        : it
                    ),
                  }
            )
          )
        }

        controllers.current.delete(jobId)
        patchJob(jobId, (j) => {
          const okCount = j.items.filter((it) => it.status === 'ok').length
          const failCount = j.items.filter((it) => it.status === 'failed').length
          return {
            phase: null,
            current: null,
            percent: 100,
            zips: [...j.zips, ...newZips],
            savedTo: target?.dir ? `${target.parent.name}/${target.dir.name}` : j.savedTo,
            error: saveError,
            status: cancelled
              ? 'cancelled'
              : saveError || okCount === 0
                ? 'failed'
                : failCount
                  ? 'partial'
                  : 'done',
          }
        })
      }
    } finally {
      running.current = false
    }
  }, [patchJob, patchItem])

  /** Queue a new zip of `photos`. Returns the job id. */
  const start = useCallback(
    async (photos, apiKey, label) => {
      if (!photos?.length) return null
      let parent = null
      if (mode === 'folder') {
        try {
          parent = await pickDownloadFolder() // first await: still inside the click
        } catch (e) {
          if (e.name === 'AbortError') return null // picker dismissed
          throw e
        }
      }
      const id = `dl_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
      const job = {
        id,
        label: label || 'photos',
        createdAt: Date.now(),
        status: 'queued',
        attempt: 0,
        phase: null,
        percent: 0,
        current: null,
        error: null,
        zips: [],
        mode: parent ? 'folder' : 'zip',
        savedTo: null,
        items: photos.map((photo) => ({ photo, status: 'pending', error: null })),
      }
      if (parent) {
        targets.current.set(id, { parent, dir: null, used: new Set() })
        saveHandle(HANDLE_NS, id, { parent, dir: null }).catch(() => {})
      }
      jobsRef.current = [job, ...jobsRef.current]
      setJobs((list) => [job, ...list])
      queue.current.push({ jobId: id, idxs: photos.map((_, i) => i), apiKey })
      pump()
      return id
    },
    [pump, mode]
  )

  /**
   * Re-fetch only the failed photos of a job — into the same folder, or as a
   * "(retry N)" zip. `resolvePhoto` maps a saved photo back to the live one
   * (needed for local files after a reload).
   */
  const retryFailed = useCallback(
    async (jobId, apiKey, resolvePhoto) => {
      const job = jobsRef.current.find((j) => j.id === jobId)
      if (!job || job.status === 'running' || job.status === 'queued') return
      const idxs = job.items
        .map((it, i) => (it.status === 'failed' ? i : -1))
        .filter((i) => i !== -1)
      if (!idxs.length) return

      if (job.mode === 'folder') {
        const t = await targetFor(jobId)
        if (!t || !(await ensureWritable(t.parent))) {
          patchJob(jobId, () => ({
            error: 'Can’t write to the original download folder any more. Remove this job and download again.',
          }))
          return
        }
      }

      const next = {
        ...job,
        status: 'queued',
        attempt: job.attempt + 1,
        error: null,
        items: job.items.map((it, i) =>
          idxs.includes(i)
            ? { ...it, photo: resolvePhoto?.(it.photo) || it.photo, status: 'pending', error: null }
            : it
        ),
      }
      jobsRef.current = jobsRef.current.map((j) => (j.id === jobId ? next : j))
      setJobs((list) => list.map((j) => (j.id === jobId ? next : j)))
      queue.current.push({ jobId, idxs, apiKey })
      pump()
    },
    [pump, targetFor, patchJob]
  )

  const cancel = useCallback(
    (jobId) => {
      const c = controllers.current.get(jobId)
      if (c) {
        c.abort()
        return
      }
      // Still waiting in the queue — drop it.
      queue.current = queue.current.filter((q) => q.jobId !== jobId)
      patchJob(jobId, (j) => ({
        status: 'cancelled',
        items: j.items.map((it) =>
          it.status === 'pending' ? { ...it, status: 'failed', error: 'Cancelled' } : it
        ),
      }))
    },
    [patchJob]
  )

  const remove = useCallback((jobId) => {
    if (controllers.current.has(jobId)) return
    queue.current = queue.current.filter((q) => q.jobId !== jobId)
    setJobs((list) => list.filter((j) => j.id !== jobId))
  }, [])

  const clearFinished = useCallback(() => {
    setJobs((list) =>
      list.filter((j) => j.status === 'running' || j.status === 'queued')
    )
  }, [])

  // Warn before closing the tab mid-download — in-flight work lives in memory.
  const active = jobs.filter((j) => j.status === 'running' || j.status === 'queued').length
  useEffect(() => {
    if (!active) return
    const onBeforeUnload = (e) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [active])

  const failedJobs = jobs.filter((j) =>
    ['failed', 'partial', 'cancelled', 'interrupted'].includes(j.status)
  ).length

  const removeTarget = useCallback((jobId) => targets.current.delete(jobId), [])

  return {
    jobs,
    active,
    failedJobs,
    start,
    retryFailed,
    cancel,
    remove: (jobId) => {
      remove(jobId)
      removeTarget(jobId)
      forgetHandle(HANDLE_NS, jobId)
    },
    clearFinished: () => {
      for (const j of jobsRef.current)
        if (j.status !== 'running' && j.status !== 'queued') {
          removeTarget(j.id)
          forgetHandle(HANDLE_NS, j.id)
        }
      clearFinished()
    },
    mode,
    setMode,
    canSaveToFolder: canSaveToFolder(),
  }
}

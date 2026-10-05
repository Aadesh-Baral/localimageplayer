import { useState } from 'react'

const STATUS_LABEL = {
  queued: 'Waiting',
  running: 'Downloading',
  done: 'Done',
  partial: 'Some failed',
  failed: 'Failed',
  cancelled: 'Cancelled',
  interrupted: 'Interrupted',
}

function timeAgo(ts) {
  const s = Math.round((Date.now() - ts) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)} min ago`
  const d = new Date(ts)
  const today = new Date().toDateString() === d.toDateString()
  return today
    ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function JobCard({ job, onRetry, onCancel, onRemove }) {
  const [open, setOpen] = useState(['failed', 'partial', 'interrupted'].includes(job.status))
  const total = job.items.length
  const ok = job.items.filter((i) => i.status === 'ok').length
  const failed = job.items.filter((i) => i.status === 'failed')
  const active = job.status === 'running' || job.status === 'queued'

  // Group identical errors so 40 copies of the same 403 read as one line.
  const reasons = new Map()
  for (const f of failed) {
    const key = f.error || 'Unknown error'
    reasons.set(key, [...(reasons.get(key) || []), f.photo.name])
  }

  return (
    <article className={`job job-${job.status}`}>
      <header className="job-head">
        <div className="job-title">
          <strong title={job.label}>{job.label}</strong>
          <span className="subtle">
            {total} photo{total === 1 ? '' : 's'} · {timeAgo(job.createdAt)}
            {job.attempt > 0 && ` · retried ${job.attempt}×`}
          </span>
        </div>
        <span className={`job-pill pill-${job.status}`}>{STATUS_LABEL[job.status]}</span>
      </header>

      {active && (
        <div className="dl-status job-progress">
          <div className="dl-bar">
            <div className="dl-fill" style={{ width: `${job.percent || 0}%` }} />
          </div>
          <span className="dl-label">
            {job.status === 'queued'
              ? 'Waiting for the download ahead of it…'
              : job.phase === 'zipping'
                ? 'Building the zip…'
                : job.current
                  ? `Fetching ${job.current}`
                  : 'Starting…'}
          </span>
        </div>
      )}

      <div className="job-counts">
        <span className="ok-count">{ok} saved</span>
        {failed.length > 0 && <span className="fail-count">{failed.length} failed</span>}
        {total - ok - failed.length > 0 && (
          <span className="subtle">{total - ok - failed.length} to go</span>
        )}
      </div>

      {job.error && <p className="error">{job.error}</p>}

      {job.savedTo && <p className="job-zips subtle">Saved into folder: {job.savedTo}</p>}
      {job.zips.length > 0 && (
        <p className="job-zips subtle">
          Saved to your Downloads folder: {job.zips.join(', ')}
        </p>
      )}

      {failed.length > 0 && !active && (
        <div className="job-failures">
          <button className="link-btn" onClick={() => setOpen((o) => !o)}>
            {open ? '▾' : '▸'} Why {failed.length === 1 ? 'it' : 'they'} failed
          </button>
          {open && (
            <ul>
              {[...reasons].map(([reason, names]) => (
                <li key={reason}>
                  <div className="fail-reason">{reason}</div>
                  <div className="fail-names subtle">
                    {names.slice(0, 8).join(', ')}
                    {names.length > 8 && ` +${names.length - 8} more`}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <footer className="job-actions">
        {active ? (
          <button className="btn small ghost" onClick={onCancel}>
            Cancel
          </button>
        ) : (
          <>
            {failed.length > 0 && (
              <button className="btn small primary-btn" onClick={onRetry}>
                Retry {failed.length} failed
              </button>
            )}
            <button className="btn small ghost" onClick={onRemove}>
              Remove
            </button>
          </>
        )}
      </footer>
    </article>
  )
}

export default function Downloads({ downloadsApi, apiKey, resolvePhoto }) {
  const { jobs, retryFailed, cancel, remove, clearFinished, active, mode, setMode } =
    downloadsApi

  return (
    <div className="tab-body">
      <div className="tab-head">
        <div>
          <h2>Downloads</h2>
          <p className="subtle">
            Original files, never resized. Retries only fetch the photos that failed.
          </p>
        </div>
        <div className="tab-head-actions">
          <div className="seg" role="radiogroup" aria-label="Save downloads as">
            <button
              className={`seg-btn ${mode === 'folder' ? 'on' : ''}`}
              onClick={() => setMode('folder')}
              disabled={!downloadsApi.canSaveToFolder}
              title={
                downloadsApi.canSaveToFolder
                  ? 'Pick a folder; each photo is written as it arrives (best for big jobs)'
                  : 'Needs Chrome or Edge on a computer'
              }
            >
              Save to folder
            </button>
            <button
              className={`seg-btn ${mode === 'zip' ? 'on' : ''}`}
              onClick={() => setMode('zip')}
              title="ZIP files of up to ~500 MB each, into your Downloads folder"
            >
              ZIP files
            </button>
          </div>
          <button
            className="btn"
            onClick={() => {
              if (window.confirm('Clear all finished downloads from the history? Files already saved stay where they are.'))
                clearFinished()
            }}
            disabled={jobs.length === active}
          >
            Clear finished
          </button>
        </div>
      </div>

      {jobs.length === 0 ? (
        <div className="empty">
          No downloads yet. Select photos and choose <strong>Download ZIP</strong>, or
          use <strong>Download group</strong> in Collections.
        </div>
      ) : (
        <div className="jobs">
          {jobs.map((job) => (
            <JobCard
              key={job.id}
              job={job}
              onRetry={() => retryFailed(job.id, apiKey, resolvePhoto)}
              onCancel={() => cancel(job.id)}
              onRemove={() => remove(job.id)}
            />
          ))}
        </div>
      )}
      <p className="subtle jobs-note">
        History is kept in this browser (latest 60 jobs). Retrying after a reload still saves
        into the same folder.
      </p>
    </div>
  )
}

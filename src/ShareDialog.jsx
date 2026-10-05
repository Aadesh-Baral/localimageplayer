import { useEffect, useMemo, useState } from 'react'
import * as API from './api'
import { driveAuth, parseDriveId } from './drive'

const linkFor = (token) => `${window.location.origin}/s/${token}`

const parseEmails = (text) =>
  String(text || '')
    .split(/[\s,;]+/)
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)

/** Does Drive say this folder is "Anyone with the link"? true / false / null (couldn't tell). */
async function folderIsPublic(folderId, apiKey) {
  try {
    const auth = driveAuth({ fields: 'permissionIds', supportsAllDrives: 'true' }, apiKey)
    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(folderId)}?${new URLSearchParams(auth.params)}`,
      { headers: auth.headers }
    )
    if (!res.ok) return null
    const { permissionIds } = await res.json()
    if (!Array.isArray(permissionIds)) return null
    return permissionIds.includes('anyoneWithLink') || permissionIds.includes('anyone')
  } catch {
    return null
  }
}

function AccessEditor({ access, setAccess, emails, setEmails }) {
  return (
    <div className="share-access">
      <label className="radio">
        <input type="radio" checked={access === 'link'} onChange={() => setAccess('link')} />
        <span>
          <strong>Anyone with the link</strong>
          <small>No sign-in needed.</small>
        </span>
      </label>
      <label className="radio">
        <input type="radio" checked={access === 'accounts'} onChange={() => setAccess('accounts')} />
        <span>
          <strong>Only these Google accounts</strong>
          <small>Viewers sign in with Google; only these emails can open it.</small>
        </span>
      </label>
      {access === 'accounts' && (
        <textarea
          className="share-emails"
          rows={3}
          placeholder="name@gmail.com, other@example.com"
          value={emails}
          onChange={(e) => setEmails(e.target.value)}
        />
      )}
    </div>
  )
}

/**
 * Create / manage share links for one collection. Links are live: viewers see
 * the collection as it currently is. Only Drive photos are shared.
 */
export default function ShareDialog({ projectId, group, blocks, apiKey, flushProject, onClose }) {
  const [shares, setShares] = useState(null)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [access, setAccess] = useState('link')
  const [emails, setEmails] = useState('')
  const [editing, setEditing] = useState(null) // token being edited
  const [editAccess, setEditAccess] = useState('link')
  const [editEmails, setEditEmails] = useState('')
  const [copied, setCopied] = useState(null)
  const [folderCheck, setFolderCheck] = useState({}) // ref → true/false/null

  const driveCount = blocks.filter((b) => b.vendor === 'gdrive').reduce((n, b) => n + b.photos.length + b.missing, 0)
  const localCount = blocks.filter((b) => b.vendor === 'local').reduce((n, b) => n + b.photos.length + b.missing, 0)
  const driveRefs = useMemo(
    () => [...new Set(blocks.filter((b) => b.vendor === 'gdrive').map((b) => b.ref))],
    [blocks]
  )

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        await flushProject() // the server reads the saved project
        const list = await API.listShares(projectId, group.id)
        if (alive) setShares(list)
      } catch (e) {
        if (alive) setError(e.message)
      }
    })()
    ;(async () => {
      const out = {}
      for (const ref of driveRefs) {
        const id = parseDriveId(ref)
        out[ref] = id ? await folderIsPublic(id, apiKey) : null
      }
      if (alive) setFolderCheck(out)
    })()
    return () => {
      alive = false
    }
  }, [projectId, group.id, driveRefs, apiKey, flushProject])

  const copy = async (token) => {
    try {
      await navigator.clipboard.writeText(linkFor(token))
      setCopied(token)
      setTimeout(() => setCopied((c) => (c === token ? null : c)), 2000)
    } catch {
      window.prompt('Copy this link:', linkFor(token))
    }
  }

  const create = async () => {
    setBusy(true)
    setError(null)
    try {
      await flushProject()
      const s = await API.createShare({
        projectId,
        groupId: group.id,
        access,
        emails: access === 'accounts' ? parseEmails(emails) : [],
      })
      setShares((l) => [s, ...(l || [])])
      setEmails('')
      copy(s.token)
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  const saveEdit = async (token) => {
    setBusy(true)
    setError(null)
    try {
      const s = await API.updateShare(token, {
        access: editAccess,
        emails: editAccess === 'accounts' ? parseEmails(editEmails) : [],
      })
      setShares((l) => l.map((x) => (x.token === token ? s : x)))
      setEditing(null)
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  const revoke = async (token) => {
    if (!window.confirm('Revoke this link? Anyone using it loses access immediately.')) return
    setBusy(true)
    try {
      await API.revokeShare(token)
      setShares((l) => l.filter((x) => x.token !== token))
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  const privateFolders = driveRefs.filter((r) => folderCheck[r] === false)
  const unknownFolders = driveRefs.filter((r) => folderCheck[r] === null)

  return (
    <div className="modal-scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-label={`Share ${group.name}`}>
        <header className="modal-head">
          <h3>Share “{group.name}”</h3>
          <button className="btn small ghost" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>

        <div className="modal-body">
          <p className="subtle share-summary">
            Viewers can browse and play the slideshow — no editing or downloads. Links are live:
            they always show this collection (and its sub-collections) as it is now.
          </p>
          <ul className="share-facts">
            <li>
              <strong>{driveCount}</strong> Drive photo{driveCount === 1 ? '' : 's'} will be visible.
            </li>
            {localCount > 0 && (
              <li className="warn-text">
                {localCount} photo{localCount === 1 ? '' : 's'} from local folders can’t be shared and
                will be left out.
              </li>
            )}
            {privateFolders.map((r) => (
              <li key={r} className="warn-text">
                A Drive folder isn’t shared as “Anyone with the link”, so viewers won’t see its
                photos: <span className="mono">{r}</span>
              </li>
            ))}
            {unknownFolders.length > 0 && (
              <li className="subtle">
                Couldn’t check sharing on {unknownFolders.length} Drive folder
                {unknownFolders.length === 1 ? '' : 's'} — make sure they’re “Anyone with the link”.
              </li>
            )}
          </ul>

          <section className="share-new">
            <h4>New link</h4>
            <AccessEditor access={access} setAccess={setAccess} emails={emails} setEmails={setEmails} />
            {access === 'accounts' && (
              <p className="help-note">
                While your Google sign-in is in Testing mode, these people must also be added as
                test users in Google Cloud Console.
              </p>
            )}
            <button className="btn primary-btn" onClick={create} disabled={busy}>
              {busy ? 'Working…' : 'Create link & copy'}
            </button>
          </section>

          {error && <p className="error">{error}</p>}

          <section className="share-list">
            <h4>Active links</h4>
            {shares === null ? (
              <p className="subtle">Loading…</p>
            ) : shares.length === 0 ? (
              <p className="subtle">No links yet.</p>
            ) : (
              shares.map((s) => (
                <div className="share-item" key={s.token}>
                  <div className="share-item-top">
                    <span className="share-badge">
                      {s.access === 'link' ? 'Anyone with the link' : `${s.emails.length} account${s.emails.length === 1 ? '' : 's'}`}
                    </span>
                    <span className="mono share-url" title={linkFor(s.token)}>
                      {linkFor(s.token)}
                    </span>
                  </div>
                  {s.access === 'accounts' && editing !== s.token && (
                    <p className="subtle share-emails-line">{s.emails.join(', ')}</p>
                  )}
                  {editing === s.token ? (
                    <div className="share-edit">
                      <AccessEditor
                        access={editAccess}
                        setAccess={setEditAccess}
                        emails={editEmails}
                        setEmails={setEditEmails}
                      />
                      <div className="share-actions">
                        <button className="btn small ghost" onClick={() => setEditing(null)}>
                          Cancel
                        </button>
                        <button className="btn small primary-btn" onClick={() => saveEdit(s.token)} disabled={busy}>
                          Save
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="share-actions">
                      <span className="subtle">
                        Created {new Date(s.createdAt).toLocaleDateString()}
                      </span>
                      <button className="btn small" onClick={() => copy(s.token)}>
                        {copied === s.token ? 'Copied ✓' : 'Copy link'}
                      </button>
                      <button
                        className="btn small ghost"
                        onClick={() => {
                          setEditing(s.token)
                          setEditAccess(s.access)
                          setEditEmails(s.emails.join(', '))
                        }}
                      >
                        Edit access
                      </button>
                      <button className="btn small danger" onClick={() => revoke(s.token)} disabled={busy}>
                        Revoke
                      </button>
                    </div>
                  )}
                </div>
              ))
            )}
          </section>
        </div>
      </div>
    </div>
  )
}

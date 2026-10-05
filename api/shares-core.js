// Collection sharing. A share is a random, unguessable token that points at
// one collection in one owner's project. Views are LIVE: every request reads
// the owner's current project, so edits show up and deleting the collection
// (or the share) ends access.
//
// Storage (a key–value store, see the adapters in the function / dev server):
//   t/<token>              → share record
//   o/<ownerSub>/<token>   → ownership index (for listing / limits)
//
// Viewers only ever receive Drive file IDs and the collection's title — never
// folder links, local paths, other collections or the owner's other data.
import { randomBytes } from 'node:crypto'

const TOKEN_RE = /^[A-Za-z0-9_-]{20,64}$/
const PROJECT_RE = /^[A-Za-z0-9_-]{4,64}$/
const GROUP_RE = /^[A-Za-z0-9_-]{1,100}$/
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/
const MAX_SHARES = 100
const MAX_EMAILS = 50

const json = (status, body) => ({ status, body })
export const newToken = () => randomBytes(18).toString('base64url') // 144 bits

export function tokenFromPath(pathname, base) {
  const m = pathname.match(new RegExp(`/api/${base}/?([^/?#]*)`))
  return m && m[1] ? decodeURIComponent(m[1]) : null
}

function cleanEmails(list) {
  if (!Array.isArray(list)) return null
  const out = [...new Set(list.map((e) => String(e).trim().toLowerCase()).filter(Boolean))]
  if (out.length > MAX_EMAILS || out.some((e) => !EMAIL_RE.test(e))) return null
  return out
}

const publicShape = (s) => ({
  token: s.token,
  projectId: s.projectId,
  groupId: s.groupId,
  access: s.access,
  emails: s.emails,
  createdAt: s.createdAt,
  updatedAt: s.updatedAt,
})

/** Owner endpoints: list / create / update / revoke. `user` is already verified. */
export async function handleShares({ method, token, body, query, user }, { shares, projects }) {
  if (token != null && !TOKEN_RE.test(token)) return json(400, { error: 'Bad share id.' })
  const mine = async (t) => {
    const s = await shares.get(`t/${t}`)
    return s && s.ownerSub === user.sub ? s : null // someone else's share looks like no share
  }

  if (!token) {
    if (method === 'GET') {
      const keys = await shares.list(`o/${user.sub}/`)
      const out = []
      for (const k of keys) {
        const s = await shares.get(`t/${k.split('/').pop()}`)
        if (!s || s.ownerSub !== user.sub) continue
        if (query?.projectId && s.projectId !== query.projectId) continue
        if (query?.groupId && s.groupId !== query.groupId) continue
        out.push(publicShape(s))
      }
      out.sort((a, b) => b.createdAt - a.createdAt)
      return json(200, out)
    }
    if (method === 'POST') {
      const { projectId, groupId, access } = body || {}
      if (!PROJECT_RE.test(projectId || '') || !GROUP_RE.test(groupId || ''))
        return json(400, { error: 'Bad project or collection id.' })
      if (access !== 'link' && access !== 'accounts') return json(400, { error: 'Bad access type.' })
      const emails = cleanEmails(body.emails || [])
      if (!emails) return json(400, { error: `Up to ${MAX_EMAILS} valid email addresses.` })
      if (access === 'accounts' && !emails.length)
        return json(400, { error: 'Add at least one Google account email.' })
      const project = await projects.get(user.sub, projectId)
      if (!project?.collections?.[groupId]) return json(404, { error: 'Collection not found.' })
      if ((await shares.list(`o/${user.sub}/`)).length >= MAX_SHARES)
        return json(409, { error: `Share limit reached (${MAX_SHARES}). Revoke some first.` })
      const now = Date.now()
      const s = {
        token: newToken(),
        ownerSub: user.sub,
        ownerEmail: user.email,
        projectId,
        groupId,
        access,
        emails: access === 'accounts' ? emails : [],
        createdAt: now,
        updatedAt: now,
      }
      await shares.set(`t/${s.token}`, s)
      await shares.set(`o/${user.sub}/${s.token}`, { createdAt: now })
      return json(200, publicShape(s))
    }
    return json(405, { error: 'Method not allowed.' })
  }

  const s = await mine(token)
  if (!s) return json(404, { error: 'Share not found.' })
  if (method === 'PUT') {
    const access = body?.access ?? s.access
    if (access !== 'link' && access !== 'accounts') return json(400, { error: 'Bad access type.' })
    const emails = cleanEmails(body?.emails ?? s.emails)
    if (!emails) return json(400, { error: `Up to ${MAX_EMAILS} valid email addresses.` })
    if (access === 'accounts' && !emails.length)
      return json(400, { error: 'Add at least one Google account email.' })
    const next = { ...s, access, emails: access === 'accounts' ? emails : [], updatedAt: Date.now() }
    await shares.set(`t/${token}`, next)
    return json(200, publicShape(next))
  }
  if (method === 'DELETE') {
    await shares.del(`t/${token}`)
    await shares.del(`o/${user.sub}/${token}`)
    return json(200, { ok: true })
  }
  return json(405, { error: 'Method not allowed.' })
}

/**
 * Public viewer endpoint. `getViewer()` resolves the signed-in viewer (or
 * throws) and is only called for account-restricted shares.
 */
export async function handleView({ method, token, getViewer }, { shares, projects }) {
  if (method !== 'GET') return json(405, { error: 'Method not allowed.' })
  const gone = json(404, { error: 'This link isn’t available. It may have been revoked.' })
  if (!token || !TOKEN_RE.test(token)) return gone
  const s = await shares.get(`t/${token}`)
  if (!s) return gone

  if (s.access === 'accounts') {
    let viewer
    try {
      viewer = await getViewer()
    } catch {
      return json(401, { error: 'Sign in with Google to view this collection.', signIn: true })
    }
    if (viewer.sub !== s.ownerSub && !s.emails.includes(viewer.email))
      return json(403, { error: `${viewer.email} doesn’t have access to this collection.`, signIn: true })
  }

  const project = await projects.get(s.ownerSub, s.projectId)
  const cols = project?.collections || {}
  const root = cols[s.groupId]
  if (!root) return gone

  // The collection plus everything nested under it.
  const ids = [s.groupId]
  for (let i = 0; i < ids.length; i++)
    for (const c of Object.values(cols)) if (c.parentId === ids[i] && !ids.includes(c.id)) ids.push(c.id)

  const seen = new Set()
  const photos = []
  let localExcluded = 0
  for (const id of ids) {
    const img = cols[id]?.images || {}
    for (const list of Object.values(img.gdrive || {}))
      for (const fileId of list || [])
        if (typeof fileId === 'string' && /^[A-Za-z0-9_-]{10,200}$/.test(fileId) && !seen.has(fileId)) {
          seen.add(fileId)
          photos.push({ fileId })
        }
    for (const list of Object.values(img.local || {})) localExcluded += (list || []).length
  }

  return json(200, {
    title: String(root.name || 'Shared collection'),
    count: photos.length,
    photos,
    localExcluded,
    access: s.access,
    updatedAt: project.updatedAt || null,
  })
}

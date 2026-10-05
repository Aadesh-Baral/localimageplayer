// Shared request handler for /api/projects — used by the Netlify Function in
// production and by the Vite dev-server middleware locally, so both behave
// identically. `store` is a tiny adapter: { list(), get(id), set(id, v), del(id) },
// already scoped to the signed-in user, so one account never sees another's.

const ID_RE = /^[A-Za-z0-9_-]{4,64}$/
const MAX_BYTES = 4 * 1024 * 1024 // well under Netlify Blobs' per-object limit
const MAX_PROJECTS = 200 // per account — keeps storage use bounded

const json = (status, body) => ({ status, body })

/**
 * @param {{ method: string, id?: string|null, body?: any, user: {sub, email} }} req
 */
export async function handleProjects(req, store) {
  const { method, id, body, user } = req
  if (id != null && !ID_RE.test(id)) return json(400, { error: 'Bad project id.' })

  if (!id) {
    if (method !== 'GET') return json(405, { error: 'Method not allowed.' })
    const ids = await store.list()
    const items = []
    for (const pid of ids) {
      const p = await store.get(pid)
      if (!p) continue
      items.push({
        id: p.id,
        name: p.name,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
        counts: {
          gdrive: p.sources?.gdrive?.length || 0,
          local: p.sources?.local?.length || 0,
          collections: Object.keys(p.collections || {}).length,
        },
      })
    }
    items.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
    return json(200, items)
  }

  if (method === 'GET') {
    const p = await store.get(id)
    return p ? json(200, p) : json(404, { error: 'Project not found.' })
  }

  if (method === 'PUT') {
    if (!body || typeof body !== 'object' || Array.isArray(body))
      return json(400, { error: 'Expected a project object.' })
    if (body.id !== id) return json(400, { error: 'Project id mismatch.' })
    if (typeof body.name !== 'string' || !body.name.trim())
      return json(400, { error: 'Project needs a name.' })
    const size = JSON.stringify(body).length
    if (size > MAX_BYTES) return json(413, { error: `Project too large (${size} bytes).` })

    const existing = await store.get(id)
    if (!existing && (await store.list()).length >= MAX_PROJECTS)
      return json(409, { error: `Project limit reached (${MAX_PROJECTS}). Delete some first.` })
    const now = Date.now()
    const saved = {
      ...body,
      owner: user?.email || null,
      createdAt: existing?.createdAt || body.createdAt || now,
      updatedAt: now,
    }
    await store.set(id, saved)
    return json(200, { ok: true, updatedAt: now })
  }

  if (method === 'DELETE') {
    await store.del(id)
    return json(200, { ok: true })
  }

  return json(405, { error: 'Method not allowed.' })
}

/** Pull the project id out of /api/projects[/<id>]. */
export function projectIdFromPath(pathname) {
  const m = pathname.match(/\/api\/projects\/?([^/?#]*)/)
  return m && m[1] ? decodeURIComponent(m[1]) : null
}

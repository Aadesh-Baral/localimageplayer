import { getStore } from '@netlify/blobs'
import { handleProjects, projectIdFromPath } from '../../api/projects-core.js'
import { authConfig, verifyRequest } from '../../api/auth.js'

// Netlify Function (v2) backing /api/projects. Requests must carry a Google
// access token; each account's projects live under its own "<googleSub>/"
// prefix in the "imageplayer-projects" blob store.
//
// Env: VITE_GOOGLE_CLIENT_ID (or GOOGLE_CLIENT_ID), ALLOWED_EMAILS (required).
export default async (request) => {
  let user
  try {
    user = await verifyRequest(
      request.headers.get('authorization'),
      authConfig(process.env, { requireAllowlist: true })
    )
  } catch (e) {
    return Response.json({ error: e.message }, { status: e.status || 401 })
  }

  const store = getStore({ name: 'imageplayer-projects', consistency: 'strong' })
  const prefix = `${user.sub}/`
  const adapter = {
    async list() {
      const { blobs } = await store.list({ prefix })
      return blobs.map((b) => b.key.slice(prefix.length))
    },
    get: (id) => store.get(prefix + id, { type: 'json' }),
    set: (id, v) => store.setJSON(prefix + id, v),
    del: (id) => store.delete(prefix + id),
  }

  let body = null
  if (request.method === 'PUT') {
    try {
      body = await request.json()
    } catch {
      return Response.json({ error: 'Invalid JSON.' }, { status: 400 })
    }
  }

  const { status, body: out } = await handleProjects(
    {
      method: request.method,
      id: projectIdFromPath(new URL(request.url).pathname),
      body,
      user,
    },
    adapter
  )
  return Response.json(out, { status, headers: { 'cache-control': 'no-store' } })
}

export const config = { path: ['/api/projects', '/api/projects/*'] }

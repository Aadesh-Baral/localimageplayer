import { getStore } from '@netlify/blobs'
import { handleShares, tokenFromPath } from '../../api/shares-core.js'
import { authConfig, verifyRequest } from '../../api/auth.js'

// Owner side of collection sharing: /api/shares (list, create) and
// /api/shares/<token> (update, revoke). Same sign-in + ALLOWED_EMAILS rules
// as /api/projects.
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

  const kv = getStore({ name: 'imageplayer-shares', consistency: 'strong' })
  const projectStore = getStore({ name: 'imageplayer-projects', consistency: 'strong' })
  const shares = {
    get: (k) => kv.get(k, { type: 'json' }),
    set: (k, v) => kv.setJSON(k, v),
    del: (k) => kv.delete(k),
    list: async (prefix) => (await kv.list({ prefix })).blobs.map((b) => b.key),
  }
  const projects = { get: (sub, id) => projectStore.get(`${sub}/${id}`, { type: 'json' }) }

  let body = null
  if (request.method === 'POST' || request.method === 'PUT') {
    try {
      body = await request.json()
    } catch {
      return Response.json({ error: 'Invalid JSON.' }, { status: 400 })
    }
  }
  const url = new URL(request.url)
  const { status, body: out } = await handleShares(
    {
      method: request.method,
      token: tokenFromPath(url.pathname, 'shares'),
      body,
      query: Object.fromEntries(url.searchParams),
      user,
    },
    { shares, projects }
  )
  return Response.json(out, { status, headers: { 'cache-control': 'no-store' } })
}

export const config = { path: ['/api/shares', '/api/shares/*'] }

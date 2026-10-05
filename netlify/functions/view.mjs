import { getStore } from '@netlify/blobs'
import { handleView, tokenFromPath } from '../../api/shares-core.js'
import { viewerConfig, verifyRequest } from '../../api/auth.js'

// Public, read-only view of a shared collection: /api/view/<token>.
// "Anyone with the link" shares need no sign-in. Account-restricted shares
// need a Google token from THIS app, and the email must be on the share's
// list — ALLOWED_EMAILS doesn't apply to viewers.
export default async (request) => {
  const kv = getStore({ name: 'imageplayer-shares', consistency: 'strong' })
  const projectStore = getStore({ name: 'imageplayer-projects', consistency: 'strong' })
  const { status, body } = await handleView(
    {
      method: request.method,
      token: tokenFromPath(new URL(request.url).pathname, 'view'),
      getViewer: () => verifyRequest(request.headers.get('authorization'), viewerConfig(process.env)),
    },
    {
      shares: { get: (k) => kv.get(k, { type: 'json' }) },
      projects: { get: (sub, id) => projectStore.get(`${sub}/${id}`, { type: 'json' }) },
    }
  )
  return Response.json(body, {
    status,
    headers: { 'cache-control': 'no-store', 'x-robots-tag': 'noindex' },
  })
}

export const config = { path: '/api/view/*' }

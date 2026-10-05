// Client for /api/projects. Every call carries the Google access token.
import { getAccessToken, markExpired } from './googleAuth'

async function call(method, path, body) {
  const token = getAccessToken()
  if (!token) {
    markExpired()
    throw new Error('Your Google session expired — click Continue to sign in again.')
  }
  const res = await fetch(`/api/projects${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  let data = null
  try {
    data = await res.json()
  } catch {
    /* empty or non-JSON */
  }
  if (res.status === 401) markExpired()
  if (!res.ok) throw Object.assign(new Error(data?.error || `Server error (HTTP ${res.status})`), { status: res.status })
  return data
}

export const listProjects = () => call('GET', '')
export const getProject = (id) => call('GET', `/${encodeURIComponent(id)}`)
export const saveProject = (p) => call('PUT', `/${encodeURIComponent(p.id)}`, p)
export const deleteProject = (id) => call('DELETE', `/${encodeURIComponent(id)}`)

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

// ---- sharing (owner) ----
async function shareCall(method, path, body) {
  const token = getAccessToken()
  if (!token) {
    markExpired()
    throw new Error('Your Google session expired — click Continue to sign in again.')
  }
  const res = await fetch(`/api/shares${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const data = await res.json().catch(() => null)
  if (res.status === 401) markExpired()
  if (!res.ok) throw new Error(data?.error || `Server error (HTTP ${res.status})`)
  return data
}
export const listShares = (projectId, groupId) =>
  shareCall('GET', `?${new URLSearchParams({ projectId, groupId })}`)
export const createShare = (s) => shareCall('POST', '', s)
export const updateShare = (token, s) => shareCall('PUT', `/${encodeURIComponent(token)}`, s)
export const revokeShare = (token) => shareCall('DELETE', `/${encodeURIComponent(token)}`)

// ---- sharing (viewer; sign-in optional) ----
export async function viewShare(token) {
  const t = getAccessToken()
  const res = await fetch(`/api/view/${encodeURIComponent(token)}`, {
    headers: t ? { authorization: `Bearer ${t}` } : {},
  })
  const data = await res.json().catch(() => null)
  if (!res.ok) throw Object.assign(new Error(data?.error || `HTTP ${res.status}`), { status: res.status, signIn: !!data?.signIn })
  return data
}
export const getProject = (id) => call('GET', `/${encodeURIComponent(id)}`)
export const saveProject = (p) => call('PUT', `/${encodeURIComponent(p.id)}`, p)
export const deleteProject = (id) => call('DELETE', `/${encodeURIComponent(id)}`)

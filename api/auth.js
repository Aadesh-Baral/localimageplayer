// Verifies the Google access token the browser sends as `Authorization: Bearer`.
// Google's tokeninfo endpoint tells us which OAuth client the token was issued
// to (must be ours — otherwise any app's token would work) and whose it is.

const cache = new Map() // token → { user, until }

export class AuthError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

/**
 * `requireAllowlist` (production): with no ALLOWED_EMAILS set, refuse everyone
 * rather than admit every Google account — unless ALLOW_ANY_GOOGLE_ACCOUNT=true
 * is set deliberately.
 */
export function authConfig(env, { requireAllowlist = false } = {}) {
  return {
    requireAllowlist: requireAllowlist && env.ALLOW_ANY_GOOGLE_ACCOUNT !== 'true',
    clientId: env.GOOGLE_CLIENT_ID || env.VITE_GOOGLE_CLIENT_ID || '',
    allowed: (env.ALLOWED_EMAILS || '')
      .split(/[\s,]+/)
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  }
}

/** → { sub, email }, or throws AuthError. */
export async function verifyRequest(authorization, { clientId, allowed, requireAllowlist }) {
  if (!clientId) throw new AuthError(500, 'Server is missing GOOGLE_CLIENT_ID.')
  if (requireAllowlist && !allowed.length)
    throw new AuthError(500, 'Server is missing ALLOWED_EMAILS — nobody can sign in until it is set.')
  const token = /^Bearer\s+([A-Za-z0-9._~+/=-]{20,4096})$/i.exec(authorization || '')?.[1]
  if (!token) throw new AuthError(401, 'Sign in with Google first.')

  const hit = cache.get(token)
  if (hit && hit.until > Date.now()) return checkAllowed(hit.user, allowed)

  const res = await fetch(
    `https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(token)}`
  )
  if (!res.ok) throw new AuthError(401, 'Your Google session expired. Sign in again.')
  const info = await res.json()

  if (info.aud !== clientId && info.azp !== clientId)
    throw new AuthError(401, 'Token was issued to a different app.')
  if (!info.sub || !info.email || String(info.email_verified) !== 'true')
    throw new AuthError(401, 'Google account email is not verified.')

  const user = { sub: String(info.sub), email: String(info.email).toLowerCase() }
  const expMs = Number(info.exp) * 1000 || Date.now() + 60_000
  cache.set(token, { user, until: Math.min(expMs, Date.now() + 5 * 60_000) })
  if (cache.size > 500) cache.delete(cache.keys().next().value)
  return checkAllowed(user, allowed)
}

function checkAllowed(user, allowed) {
  if (allowed.length && !allowed.includes(user.email))
    throw new AuthError(403, `${user.email} isn’t allowed to use this Image Player.`)
  return user
}

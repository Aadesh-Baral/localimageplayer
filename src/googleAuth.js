// Google sign-in via Google Identity Services (token model).
//
// One popup gives an access token that both (a) proves who you are to
// /api/projects and (b) authorises Drive API calls as you — so downloads count
// against your account rather than anonymous API-key traffic, and folders only
// shared with you work too. Tokens last ~1 hour; renewing needs one click.

import { useCallback, useEffect, useRef, useState } from 'react'

export const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || ''
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.readonly'
const BASE_SCOPES = 'openid email profile'
const SCOPES = `${BASE_SCOPES} ${DRIVE_SCOPE}`
const SESSION = 'imageplayer.googleSession' // sessionStorage: survives reloads, not tab close

// ---- module-level token, readable from non-React code (api.js, drive.js) ---
let current = null // { token, exp, user }
const listeners = new Set()

export function getAccessToken() {
  return current && current.exp - 30_000 > Date.now() ? current.token : null
}

function setCurrent(next) {
  current = next
  try {
    if (next) sessionStorage.setItem(SESSION, JSON.stringify(next))
    else sessionStorage.removeItem(SESSION)
  } catch {
    /* ignore */
  }
  listeners.forEach((fn) => fn(next))
}

/** api.js calls this on a 401 so the UI can offer "Continue". */
export function markExpired() {
  if (current) setCurrent({ ...current, exp: 0 })
}

try {
  const saved = JSON.parse(sessionStorage.getItem(SESSION) || 'null')
  if (saved?.token && saved.exp > Date.now() + 30_000) current = saved
  else if (saved?.user) current = { ...saved, token: null, exp: 0 } // remember who, ask to continue
} catch {
  /* ignore */
}

let gisPromise = null
function loadGis() {
  if (window.google?.accounts?.oauth2) return Promise.resolve()
  gisPromise ||= new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = 'https://accounts.google.com/gsi/client'
    s.async = true
    s.onload = () => resolve()
    s.onerror = () => {
      gisPromise = null
      reject(new Error('Couldn’t load Google sign-in. Check your connection or ad-blocker.'))
    }
    document.head.appendChild(s)
  })
  return gisPromise
}

/**
 * status: misconfigured | loading | signed-out | signed-in | expired
 */
/** `drive: false` — identity only (people viewing a shared collection). */
export function useGoogleAuth({ drive = true } = {}) {
  const scope = drive ? SCOPES : BASE_SCOPES
  const [session, setSession] = useState(current)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState(null)
  const clientRef = useRef(null)
  const pending = useRef(null)

  useEffect(() => {
    listeners.add(setSession)
    return () => listeners.delete(setSession)
  }, [])

  useEffect(() => {
    if (!CLIENT_ID) return
    let alive = true
    loadGis()
      .then(() => {
        if (!alive) return
        clientRef.current = window.google.accounts.oauth2.initTokenClient({
          client_id: CLIENT_ID,
          scope,
          callback: async (resp) => {
            const done = pending.current
            pending.current = null
            if (resp.error) {
              setError(resp.error_description || resp.error)
              done?.reject(new Error(resp.error))
              return
            }
            if (drive && !window.google.accounts.oauth2.hasGrantedAllScopes(resp, DRIVE_SCOPE)) {
              setError('Drive access wasn’t granted — tick the Google Drive box so photos can load.')
            }
            try {
              const info = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
                headers: { Authorization: `Bearer ${resp.access_token}` },
              }).then((r) => r.json())
              setError(null)
              setCurrent({
                token: resp.access_token,
                exp: Date.now() + Number(resp.expires_in || 3600) * 1000,
                user: { email: info.email, name: info.name, picture: info.picture },
              })
              done?.resolve()
            } catch (e) {
              setError(e.message)
              done?.reject(e)
            }
          },
          error_callback: (err) => {
            const done = pending.current
            pending.current = null
            if (err?.type !== 'popup_closed') setError(err?.message || 'Sign-in failed.')
            done?.reject(new Error(err?.type || 'sign-in failed'))
          },
        })
        setReady(true)
      })
      .catch((e) => alive && setError(e.message))
    return () => {
      alive = false
    }
  }, [])

  /** Opens Google's popup — call from a click. */
  const signIn = useCallback(() => {
    if (!clientRef.current) return Promise.reject(new Error('Google sign-in is still loading.'))
    return new Promise((resolve, reject) => {
      pending.current = { resolve, reject }
      clientRef.current.requestAccessToken({
        prompt: current?.user ? '' : 'select_account',
        hint: current?.user?.email,
      })
    })
  }, [])

  const signOut = useCallback(() => {
    const t = current?.token
    if (t && window.google?.accounts?.oauth2) window.google.accounts.oauth2.revoke(t, () => {})
    setCurrent(null)
  }, [])

  // Flip to "expired" on time even if no request has failed yet.
  useEffect(() => {
    if (!session?.token) return
    const ms = session.exp - 30_000 - Date.now()
    const t = setTimeout(markExpired, Math.max(0, ms))
    return () => clearTimeout(t)
  }, [session])

  const status = !CLIENT_ID
    ? 'misconfigured'
    : session?.token && session.exp - 30_000 > Date.now()
      ? 'signed-in'
      : session?.user
        ? 'expired'
        : ready
          ? 'signed-out'
          : 'loading'

  return { status, user: session?.user || null, error, ready, signIn, signOut }
}

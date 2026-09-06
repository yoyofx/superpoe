export interface AuthUser {
  id: string
  username: string
  display_name: string
  /** Returned only for the authenticated user's own session profile. */
  email?: string
  email_verified: boolean
  email_verification_pending: boolean
}

export interface AuthSessionTokens {
  access_token: string
  refresh_token: string
  access_expires_at: string
  refresh_expires_at: string
  session_id: string
}

export interface AuthSession {
  user: AuthUser
  session: AuthSessionTokens
}

interface PersistedAuthSession extends AuthSession {
  /** Local convenience window; this is not a server authorization expiry. */
  remembered_until?: string
}

export interface AuthStorage {
  load(): Promise<string | null>
  save(value: string): Promise<void>
  clear(): Promise<void>
}

export class AuthApiError extends Error {
  readonly status: number
  readonly code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.name = 'AuthApiError'
    this.status = status
    this.code = code
  }
}

const AUTH_STORAGE_KEY = 'superpoe-auth-session-v1'
const DEVICE_ID_KEY = 'superpoe-auth-device-id-v1'
const LOCAL_REMEMBER_WINDOW_MS = 7 * 24 * 60 * 60 * 1000
const configuredBaseUrl = typeof import.meta.env.VITE_SUPERPOE_AUTH_URL === 'string'
  ? import.meta.env.VITE_SUPERPOE_AUTH_URL.trim()
  : ''
export const AUTH_BASE_URL = (configuredBaseUrl || 'http://api.superpoe2.vip').replace(/\/+$/, '')

// The renderer is mounted under React.StrictMode during development, which
// intentionally runs effects twice. Refresh tokens are rotated by the server
// and can only be consumed once, so concurrent restore/refresh calls must
// share the same in-flight request instead of racing each other.
let restoreInFlight: Promise<AuthSession | null> | null = null
const refreshInFlight = new Map<string, Promise<AuthSession>>()

function browserStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

function getDeviceId(): string {
  const storage = browserStorage()
  const existing = storage?.getItem(DEVICE_ID_KEY)
  if (existing) return existing
  const generated = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`
  try { storage?.setItem(DEVICE_ID_KEY, generated) } catch { /* best effort */ }
  return generated
}

function getDesktopStorage(): AuthStorage | null {
  try {
    return typeof window !== 'undefined' ? window.pob2Desktop?.authStorage || null : null
  } catch {
    return null
  }
}

async function loadStoredSession(): Promise<PersistedAuthSession | null> {
  const desktopStorage = getDesktopStorage()
  const raw = desktopStorage
    ? await desktopStorage.load()
    : browserStorage()?.getItem(AUTH_STORAGE_KEY) || null
  if (!raw) return null
  try {
    const value = JSON.parse(raw) as Partial<AuthSession>
    if (!value.user || !value.session || typeof value.session.access_token !== 'string' || typeof value.session.refresh_token !== 'string') return null
    return value as PersistedAuthSession
  } catch {
    return null
  }
}

function nextRememberedUntil(): string {
  return new Date(Date.now() + LOCAL_REMEMBER_WINDOW_MS).toISOString()
}

function rememberedUntil(session: PersistedAuthSession | AuthSession): string | undefined {
  const value = (session as PersistedAuthSession).remembered_until
  return typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? value : undefined
}

function isLocallyRemembered(session: PersistedAuthSession): boolean {
  const expiresAt = rememberedUntil(session)
  return Boolean(expiresAt && Date.parse(expiresAt) > Date.now())
}

async function saveStoredSession(session: AuthSession, rememberUntil = rememberedUntil(session) || nextRememberedUntil()): Promise<void> {
  const persisted: PersistedAuthSession = { ...session, remembered_until: rememberUntil }
  const raw = JSON.stringify(persisted)
  const desktopStorage = getDesktopStorage()
  if (desktopStorage) {
    try {
      await desktopStorage.save(raw)
    } catch {
      // A desktop without a system secret store can still use the session for
      // this run; never fall back to plaintext token storage in that case.
      console.warn('[Auth] secure session persistence is unavailable; session will last only for this run')
    }
    return
  }
  try { browserStorage()?.setItem(AUTH_STORAGE_KEY, raw) } catch { /* session remains in memory */ }
}

async function clearStoredSession(): Promise<void> {
  const desktopStorage = getDesktopStorage()
  if (desktopStorage) {
    await desktopStorage.clear()
    return
  }
  try { browserStorage()?.removeItem(AUTH_STORAGE_KEY) } catch { /* best effort */ }
}

function sessionFromResponse(value: unknown): AuthSession {
  if (!value || typeof value !== 'object') throw new Error('The server returned an invalid session.')
  const response = value as Partial<AuthSession>
  if (!response.user || !response.session) throw new Error('The server returned an invalid session.')
  const session = response.session as Partial<AuthSessionTokens>
  if (typeof session.access_token !== 'string' || typeof session.refresh_token !== 'string' || typeof session.session_id !== 'string') {
    throw new Error('The server returned an invalid session.')
  }
  return { user: response.user as AuthUser, session: session as AuthSessionTokens }
}

function isTransientAuthError(error: unknown): boolean {
  return error instanceof AuthApiError && (error.status === 0 || error.status >= 500)
}

function authErrorSummary(error: unknown): string {
  if (error instanceof AuthApiError) return `${error.status}/${error.code}`
  return error instanceof Error ? error.message : String(error)
}

async function request(path: string, init: RequestInit = {}, accessToken?: string): Promise<unknown> {
  const headers = new Headers(init.headers)
  headers.set('Content-Type', 'application/json')
  if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`)
  let response: Response
  try {
    response = await fetch(`${AUTH_BASE_URL}${path}`, { ...init, headers })
  } catch {
    throw new AuthApiError(0, 'network_error', 'The authentication service is unreachable.')
  }
  let body: unknown = null
  try { body = await response.json() } catch { /* empty response */ }
  if (!response.ok) {
    const error = body && typeof body === 'object' ? (body as { error?: { code?: unknown; message?: unknown } }).error : undefined
    throw new AuthApiError(response.status, typeof error?.code === 'string' ? error.code : 'request_failed', typeof error?.message === 'string' ? error.message : `Request failed (${response.status}).`)
  }
  return body
}

export async function login(username: string, password: string): Promise<AuthSession> {
  const result = sessionFromResponse(await request('/api/auth/password/login', {
    method: 'POST',
    body: JSON.stringify({ username, password, device_id: getDeviceId() }),
  }))
  await saveStoredSession(result)
  return result
}

export async function register(username: string, email: string, password: string, displayName?: string): Promise<AuthSession> {
  const result = sessionFromResponse(await request('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ username, email, password, display_name: displayName || undefined, device_id: getDeviceId() }),
  }))
  await saveStoredSession(result)
  return result
}

export async function getCurrentUser(session: AuthSession): Promise<AuthUser> {
  const result = await request('/api/auth/me', {}, session.session.access_token) as { user?: AuthUser }
  if (!result?.user) throw new Error('The server returned an invalid user.')
  return result.user
}

async function refreshSessionRequest(session: AuthSession): Promise<AuthSession> {
  const result = await request('/api/auth/session/refresh', {
    method: 'POST',
    body: JSON.stringify({ refresh_token: session.session.refresh_token }),
  }) as { session?: AuthSessionTokens }
  if (!result?.session) throw new AuthApiError(401, 'session_invalid', 'The session is invalid or expired.')
  // The server rotates the refresh token before /me is called. Persist the
  // rotated token immediately so a transient /me failure cannot leave the
  // client with a refresh token that the server has already consumed.
  const refreshed = { user: session.user, session: result.session }
  await saveStoredSession(refreshed, rememberedUntil(session) || nextRememberedUntil())
  try {
    const user = await getCurrentUser(refreshed)
    const current = { user, session: result.session }
    await saveStoredSession(current, rememberedUntil(session) || nextRememberedUntil())
    return current
  } catch (error) {
    if (isTransientAuthError(error)) return refreshed
    throw error
  }
}

export function refreshSession(session: AuthSession): Promise<AuthSession> {
  const key = session.session.session_id || session.session.refresh_token
  const existing = refreshInFlight.get(key)
  if (existing) return existing

  const pending = refreshSessionRequest(session)
  refreshInFlight.set(key, pending)
  void pending.then(
    () => { if (refreshInFlight.get(key) === pending) refreshInFlight.delete(key) },
    () => { if (refreshInFlight.get(key) === pending) refreshInFlight.delete(key) },
  )
  return pending
}

export async function changePassword(session: AuthSession, currentPassword: string, newPassword: string): Promise<void> {
  await request('/api/auth/password/change', {
    method: 'POST',
    body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
  }, session.session.access_token)
}

export async function requestPasswordReset(email: string): Promise<void> {
  await request('/api/auth/password/reset/request', {
    method: 'POST',
    body: JSON.stringify({ email }),
  })
}

export async function confirmPasswordReset(email: string, code: string, newPassword: string): Promise<void> {
  await request('/api/auth/password/reset/confirm', {
    method: 'POST',
    body: JSON.stringify({ email, code, new_password: newPassword }),
  })
}

export async function logout(session: AuthSession): Promise<void> {
  try {
    await request('/api/auth/logout', { method: 'POST' }, session.session.access_token)
  } finally {
    await clearStoredSession()
  }
}

async function restoreSessionRequest(): Promise<AuthSession | null> {
  const stored = await loadStoredSession()
  if (!stored) {
    console.info('[Auth] restore no valid stored session')
    return null
  }
  console.info(`[Auth] restore stored session session_id=${stored.session.session_id}`)
  if (isLocallyRemembered(stored)) {
    console.info('[Auth] restore local session accepted within seven-day remember window')
    return stored
  }
  try {
    const user = await getCurrentUser(stored)
    const current = { ...stored, user }
    await saveStoredSession(current, nextRememberedUntil())
    console.info('[Auth] restore access token accepted')
    return current
  } catch (error) {
    console.warn(`[Auth] restore access token failed error=${authErrorSummary(error)}`)
    if (!(error instanceof AuthApiError) || error.status !== 401) {
      throw error
    }
    try {
      const refreshed = await refreshSession(stored)
      console.info('[Auth] restore refresh succeeded')
      return refreshed
    } catch (error) {
      console.warn(`[Auth] restore refresh failed error=${authErrorSummary(error)}`)
      // Keep a valid local session across temporary API outages. It will be
      // retried on the next app start instead of forcing a new login now.
      if (isTransientAuthError(error)) return stored
      await clearStoredSession()
      return null
    }
  }
}

export function restoreSession(): Promise<AuthSession | null> {
  if (restoreInFlight) return restoreInFlight

  const pending = restoreSessionRequest()
  restoreInFlight = pending
  void pending.then(
    () => { if (restoreInFlight === pending) restoreInFlight = null },
    () => { if (restoreInFlight === pending) restoreInFlight = null },
  )
  return pending
}

export async function clearSession(): Promise<void> {
  await clearStoredSession()
}

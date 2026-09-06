import { afterEach, describe, expect, it, vi } from 'vitest'

const session = {
  user: {
    id: 'user-1',
    username: 'tester',
    display_name: 'Tester',
    email: 'tester@example.com',
    email_verified: true,
    email_verification_pending: false,
  },
  session: {
    access_token: 'access-token-1',
    refresh_token: 'refresh-token-1',
    access_expires_at: '2026-09-05T00:00:00Z',
    refresh_expires_at: '2026-10-05T00:00:00Z',
    session_id: 'session-1',
  },
}

function response(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.resetModules()
})

describe('auth session persistence', () => {
  it('restores a locally remembered session for seven days without a network validation', async () => {
    const stored = JSON.stringify({ ...session, remembered_until: '2099-01-01T00:00:00.000Z' })
    const storage = {
      load: vi.fn(async () => stored),
      save: vi.fn(async () => undefined),
      clear: vi.fn(async () => undefined),
    }
    const fetchMock = vi.fn()
    vi.stubGlobal('window', { pob2Desktop: { authStorage: storage } })
    vi.stubGlobal('fetch', fetchMock)

    const { restoreSession } = await import('./authClient')
    await expect(restoreSession()).resolves.toMatchObject({ session: session.session, user: session.user })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(storage.clear).not.toHaveBeenCalled()
  })

  it('coalesces concurrent restores so a rotated refresh token is consumed once', async () => {
    let stored = JSON.stringify(session)
    const storage = {
      load: vi.fn(async () => stored),
      save: vi.fn(async (value: string) => { stored = value }),
      clear: vi.fn(async () => { stored = '' }),
    }
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/api/auth/me') && fetchMock.mock.calls.length === 1) {
        return response(401, { error: { code: 'session_invalid', message: 'expired' } })
      }
      if (url.endsWith('/api/auth/session/refresh')) {
        return response(200, {
          session: {
            ...session.session,
            access_token: 'access-token-2',
            refresh_token: 'refresh-token-2',
          },
        })
      }
      if (url.endsWith('/api/auth/me')) return response(200, { user: session.user })
      throw new Error(`Unexpected request: ${url}`)
    })
    vi.stubGlobal('window', { pob2Desktop: { authStorage: storage } })
    vi.stubGlobal('fetch', fetchMock)

    const { restoreSession } = await import('./authClient')
    const first = restoreSession()
    const second = restoreSession()
    expect(first).toBe(second)
    await expect(first).resolves.toMatchObject({ session: { refresh_token: 'refresh-token-2' } })
    expect(fetchMock.mock.calls.filter(([input]) => String(input).endsWith('/api/auth/session/refresh'))).toHaveLength(1)
    expect(storage.clear).not.toHaveBeenCalled()
  })
})

import { safeStorage, type Cookie, type Cookies } from 'electron'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

export type TradeRealm = 'cn' | 'global'

interface StoredTradeCookie {
  name: 'POESESSID'
  value: string
  domain: string
  path: string
  secure: boolean
  httpOnly: boolean
  sameSite?: Cookie['sameSite']
}

interface CredentialFile {
  version: 1
  realms: Partial<Record<TradeRealm, string>>
}

const COOKIE_NAME = 'POESESSID'

function emptyCredentialFile(): CredentialFile {
  return { version: 1, realms: {} }
}

function normalizeDomain(domain: string | undefined): string {
  return (domain || '').trim().replace(/^\./, '').toLowerCase()
}

function isRealmCookie(realm: TradeRealm, cookie: Pick<Cookie, 'name' | 'domain'>): boolean {
  if (cookie.name !== COOKIE_NAME) return false
  const domain = normalizeDomain(cookie.domain)
  return realm === 'cn'
    ? domain === 'game.qq.com' || domain.endsWith('.game.qq.com')
    : domain === 'pathofexile.com' || domain.endsWith('.pathofexile.com')
}

function parseStoredCookie(value: string, realm: TradeRealm): StoredTradeCookie | null {
  try {
    const parsed = JSON.parse(value) as Partial<StoredTradeCookie>
    if (parsed.name !== COOKIE_NAME || typeof parsed.value !== 'string' || !parsed.value
      || typeof parsed.domain !== 'string' || typeof parsed.path !== 'string'
      || typeof parsed.secure !== 'boolean' || typeof parsed.httpOnly !== 'boolean') return null
    if (!isRealmCookie(realm, { name: parsed.name, domain: parsed.domain })) return null
    return parsed as StoredTradeCookie
  } catch {
    return null
  }
}

export class TradeCredentialStore {
  constructor(private readonly filePath: string) {}

  matches(realm: TradeRealm, cookie: Pick<Cookie, 'name' | 'domain'>): boolean {
    return isRealmCookie(realm, cookie)
  }

  save(realm: TradeRealm, cookie: Cookie): void {
    if (!isRealmCookie(realm, cookie) || !safeStorage.isEncryptionAvailable()) return
    const stored: StoredTradeCookie = {
      name: COOKIE_NAME,
      value: cookie.value,
      domain: cookie.domain || '',
      path: cookie.path || '/',
      secure: cookie.secure ?? true,
      httpOnly: cookie.httpOnly ?? true,
      ...(cookie.sameSite ? { sameSite: cookie.sameSite } : {}),
    }
    try {
      const file = this.readFile()
      file.realms[realm] = safeStorage.encryptString(JSON.stringify(stored)).toString('base64')
      this.writeFile(file)
    } catch {
      // Authentication remains usable for this process even if secure persistence is unavailable.
    }
  }

  remove(realm: TradeRealm): void {
    try {
      const file = this.readFile()
      if (!file.realms[realm]) return
      delete file.realms[realm]
      this.writeFile(file)
    } catch {
      // A later successful cookie update will replace the stale encrypted entry.
    }
  }

  async restore(realm: TradeRealm, cookies: Cookies): Promise<boolean> {
    if (!safeStorage.isEncryptionAvailable()) return false
    const encrypted = this.readFile().realms[realm]
    if (!encrypted) return false
    try {
      const stored = parseStoredCookie(safeStorage.decryptString(Buffer.from(encrypted, 'base64')), realm)
      if (!stored) {
        this.remove(realm)
        return false
      }
      const domain = normalizeDomain(stored.domain)
      await cookies.set({
        url: `${stored.secure ? 'https' : 'http'}://${domain}${stored.path || '/'}`,
        name: stored.name,
        value: stored.value,
        domain: stored.domain,
        path: stored.path || '/',
        secure: stored.secure,
        httpOnly: stored.httpOnly,
        ...(stored.sameSite ? { sameSite: stored.sameSite } : {}),
      })
      return true
    } catch {
      this.remove(realm)
      return false
    }
  }

  private readFile(): CredentialFile {
    try {
      const parsed = JSON.parse(readFileSync(this.filePath, 'utf8')) as Partial<CredentialFile>
      if (parsed.version !== 1 || !parsed.realms || typeof parsed.realms !== 'object') return emptyCredentialFile()
      return { version: 1, realms: parsed.realms }
    } catch {
      return emptyCredentialFile()
    }
  }

  private writeFile(file: CredentialFile): void {
    const directory = path.dirname(this.filePath)
    mkdirSync(directory, { recursive: true })
    writeFileSync(this.filePath, JSON.stringify(file), { encoding: 'utf8', mode: 0o600 })
  }
}

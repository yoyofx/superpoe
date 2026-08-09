import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { MarketRealm } from '../../src/types/market.js'
import type { CurrencyMarketSnapshot, CurrencyMarketState } from '../../src/types/currencyMarket.js'
import { normalizePoecurrencySummary, normalizePoe2ScoutSnapshot, selectCurrentSoftcoreLeague } from '../../src/engine/currencyMarketAdapters.js'
import { desktopText, type UiLanguage } from '../uiLocale.js'

const FRESH_MS = 10 * 60_000
const MAX_STALE_MS = 24 * 60 * 60_000
const MAX_RESPONSE_BYTES = 8_000_000
const REQUEST_TIMEOUT_MS = 15_000

type Fetcher = (input: string, init?: RequestInit) => Promise<Response>

function isSnapshot(value: unknown, realm: MarketRealm): value is CurrencyMarketSnapshot {
  if (!value || typeof value !== 'object') return false
  const snapshot = value as Partial<CurrencyMarketSnapshot>
  return snapshot.schemaVersion === 1 && snapshot.realm === realm
    && (snapshot.source === 'poecurrency' || snapshot.source === 'poe2scout')
    && typeof snapshot.fetchedAt === 'string' && Array.isArray(snapshot.items)
}

function errorMessage(error: unknown, language: UiLanguage): string {
  if (error instanceof Error) {
    if (error.name === 'TimeoutError' || error.name === 'AbortError') return desktopText(language, 'Currency market request timed out', '行情服务请求超时', '行情服務請求逾時', '통화 시세 요청 시간 초과')
    return error.message
  }
  return String(error)
}

export class CurrencyMarketService {
  private readonly memory = new Map<MarketRealm, CurrencyMarketSnapshot>()
  private readonly pending = new Map<MarketRealm, Promise<CurrencyMarketSnapshot>>()

  constructor(
    private readonly cacheDirectory: string,
    private readonly fetcher: Fetcher,
    private readonly onChanged?: (state: CurrencyMarketState) => void,
    private readonly getLanguage: () => UiLanguage = () => 'en',
  ) {}

  async get(realm: MarketRealm, forceRefresh = false): Promise<CurrencyMarketState> {
    const cached = this.getCached(realm)
    if (!forceRefresh && cached && this.age(cached) <= FRESH_MS) {
      return { snapshot: structuredClone(cached), cacheStatus: 'fresh' }
    }
    if (!forceRefresh && cached) {
      void this.refresh(realm).catch((error) => {
        this.onChanged?.({ snapshot: structuredClone(cached), cacheStatus: 'stale', error: errorMessage(error, this.getLanguage()) })
      })
      return { snapshot: structuredClone(cached), cacheStatus: 'stale' }
    }
    try {
      const snapshot = await this.refresh(realm)
      return { snapshot: structuredClone(snapshot), cacheStatus: 'fresh' }
    } catch (error) {
      if (cached) return { snapshot: structuredClone(cached), cacheStatus: 'stale', error: errorMessage(error, this.getLanguage()) }
      throw error
    }
  }

  private refresh(realm: MarketRealm): Promise<CurrencyMarketSnapshot> {
    const existing = this.pending.get(realm)
    if (existing) return existing
    const request = this.fetchRealm(realm).then((snapshot) => {
      this.memory.set(realm, snapshot)
      this.save(realm, snapshot)
      this.onChanged?.({ snapshot: structuredClone(snapshot), cacheStatus: 'fresh' })
      return snapshot
    }).finally(() => this.pending.delete(realm))
    this.pending.set(realm, request)
    return request
  }

  private async fetchRealm(realm: MarketRealm): Promise<CurrencyMarketSnapshot> {
    const fetchedAt = new Date().toISOString()
    if (realm === 'cn') {
      const payload = await this.getJson('https://poecurrency.top/api/summary?version=2')
      return normalizePoecurrencySummary(payload, fetchedAt)
    }
    const leagues = await this.getJson('https://api.poe2scout.com/poe2/Leagues')
    const current = selectCurrentSoftcoreLeague(leagues)
    const shortName = String(current.ShortName)
    if (!/^[a-z0-9-]{1,40}$/i.test(shortName)) throw new Error(desktopText(this.getLanguage(), 'poe2scout returned an invalid league identifier', 'poe2scout 返回了无效的赛季标识', 'poe2scout 傳回無效的賽季識別碼', 'poe2scout가 잘못된 리그 식별자를 반환했습니다'))
    const base = `https://api.poe2scout.com/poe2/Leagues/${encodeURIComponent(shortName)}`
    const [references, pairs] = await Promise.all([
      this.getJson(`${base}/ReferenceCurrencies`),
      this.getJson(`${base}/SnapshotPairs`),
    ])
    return normalizePoe2ScoutSnapshot(leagues, references, pairs, fetchedAt)
  }

  private async getJson(url: string): Promise<unknown> {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:' || !['poecurrency.top', 'api.poe2scout.com'].includes(parsed.hostname)) {
      throw new Error(desktopText(this.getLanguage(), 'Currency market host is not allowed', '不允许访问该通货行情主机', '不允許存取該通貨行情主機', '허용되지 않은 통화 시세 호스트입니다'))
    }
    const response = await this.fetcher(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    if (!response.ok) throw new Error(`${desktopText(this.getLanguage(), 'Currency market service returned HTTP', '行情服务返回 HTTP', '行情服務傳回 HTTP', '통화 시세 서비스 HTTP 응답')} ${response.status}`)
    const contentLength = Number(response.headers.get('content-length') || 0)
    if (contentLength > MAX_RESPONSE_BYTES) throw new Error(desktopText(this.getLanguage(), 'Currency market response is too large', '行情服务响应过大', '行情服務回應過大', '통화 시세 응답이 너무 큽니다'))
    const body = await response.text()
    if (body.length > MAX_RESPONSE_BYTES) throw new Error(desktopText(this.getLanguage(), 'Currency market response is too large', '行情服务响应过大', '行情服務回應過大', '통화 시세 응답이 너무 큽니다'))
    try { return JSON.parse(body) as unknown } catch { throw new Error(desktopText(this.getLanguage(), 'Currency market service returned invalid data', '行情服务返回了无效数据', '行情服務傳回無效數據', '통화 시세 서비스가 잘못된 데이터를 반환했습니다')) }
  }

  private getCached(realm: MarketRealm): CurrencyMarketSnapshot | undefined {
    const memory = this.memory.get(realm)
    if (memory && this.age(memory) <= MAX_STALE_MS) return memory
    const filePath = this.filePath(realm)
    if (!existsSync(filePath)) return undefined
    try {
      const raw = readFileSync(filePath, 'utf8')
      if (raw.length > MAX_RESPONSE_BYTES) return undefined
      const parsed = JSON.parse(raw) as unknown
      if (!isSnapshot(parsed, realm) || this.age(parsed) > MAX_STALE_MS) return undefined
      this.memory.set(realm, parsed)
      return parsed
    } catch {
      return undefined
    }
  }

  private save(realm: MarketRealm, snapshot: CurrencyMarketSnapshot): void {
    mkdirSync(this.cacheDirectory, { recursive: true })
    const filePath = this.filePath(realm)
    const temporaryPath = `${filePath}.tmp`
    writeFileSync(temporaryPath, JSON.stringify(snapshot), { encoding: 'utf8', mode: 0o600, flush: true })
    renameSync(temporaryPath, filePath)
  }

  private filePath(realm: MarketRealm): string {
    return path.join(this.cacheDirectory, `${realm}.v1.json`)
  }

  private age(snapshot: CurrencyMarketSnapshot): number {
    const timestamp = Date.parse(snapshot.fetchedAt)
    return Number.isFinite(timestamp) ? Math.max(0, Date.now() - timestamp) : Number.POSITIVE_INFINITY
  }
}

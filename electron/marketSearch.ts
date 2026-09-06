import { createHash } from 'node:crypto'
import type {
  MarketRealm,
  MarketSearchReference,
  SavedSearchCaptureSource,
  SavedSearchQuerySnapshot,
} from '../src/types/market.js'

// PoE2 can encode a complete, user-created query directly in the URL. These
// compressed search codes are considerably longer than API result IDs.
export const MAX_SEARCH_CODE_LENGTH = 8_192
export const SEARCH_CODE_PATTERN = new RegExp(`^[A-Za-z0-9_-]{1,${MAX_SEARCH_CODE_LENGTH}}$`)
const MAX_LEAGUE_LENGTH = 128
const MAX_QUERY_BYTES = 500_000
const MAX_QUERY_DEPTH = 16
const MAX_QUERY_NODES = 20_000
const FORBIDDEN_QUERY_KEYS = /^(?:cookie|cookies|authorization|headers?|password|token|csrf|session)$/i

function canonicalHost(realm: MarketRealm): string {
  return realm === 'cn' ? 'poe.game.qq.com' : 'www.pathofexile.com'
}

function isRealmHost(url: URL, realm: MarketRealm): boolean {
  if (realm === 'cn') return url.hostname === 'poe.game.qq.com'
  return url.hostname === 'www.pathofexile.com' || url.hostname === 'pathofexile.com'
}

function decodeSegment(value: string): string | null {
  try {
    return decodeURIComponent(value)
  } catch {
    return null
  }
}

export function parseOfficialSearchUrl(value: string, realm: MarketRealm): MarketSearchReference | null {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' || !isRealmHost(url, realm)) return null
  const match = url.pathname.match(/^\/trade2\/search\/poe2\/([^/]+)\/([^/]+)\/?$/)
  if (!match) return null
  const leagueId = decodeSegment(match[1])
  const searchCode = decodeSegment(match[2])
  if (!leagueId || leagueId.length > MAX_LEAGUE_LENGTH || /[\u0000-\u001f/?#\\]/.test(leagueId)) return null
  if (!searchCode || !SEARCH_CODE_PATTERN.test(searchCode)) return null
  return {
    realm,
    leagueId,
    searchCode,
    canonicalUrl: `https://${canonicalHost(realm)}/trade2/search/poe2/${encodeURIComponent(leagueId)}/${encodeURIComponent(searchCode)}`,
    captureSource: 'code-only',
  }
}

export function isValidSearchCode(value: string): boolean {
  return SEARCH_CODE_PATTERN.test(value)
}

function sanitizeJson(value: unknown, state: { nodes: number }, depth: number): unknown {
  if (depth > MAX_QUERY_DEPTH || ++state.nodes > MAX_QUERY_NODES) throw new Error('Trade query is too complex')
  if (value == null || typeof value === 'boolean' || typeof value === 'string') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Trade query contains an invalid number')
    return value
  }
  if (Array.isArray(value)) return value.map((entry) => sanitizeJson(entry, state, depth + 1))
  if (typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) throw new Error('Trade query must contain JSON data only')
  const result: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (!key || key.length > 128 || FORBIDDEN_QUERY_KEYS.test(key) || key === '__proto__' || key === 'constructor' || key === 'prototype') continue
    result[key] = sanitizeJson(entry, state, depth + 1)
  }
  return result
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`).join(',')}}`
  }
  return JSON.stringify(value)
}

export function createSearchQuerySnapshot(
  body: unknown,
  source: Exclude<SavedSearchCaptureSource, 'code-only'>,
  capturedAt = new Date().toISOString(),
): SavedSearchQuerySnapshot {
  const sanitized = sanitizeJson(body, { nodes: 0 }, 0)
  if (!sanitized || typeof sanitized !== 'object' || Array.isArray(sanitized) || !('query' in sanitized)) {
    throw new Error('Invalid official trade search query')
  }
  const serialized = stableJson(sanitized)
  if (Buffer.byteLength(serialized, 'utf8') > MAX_QUERY_BYTES) throw new Error('Trade query is too large')
  return {
    source,
    body: sanitized,
    hash: createHash('sha256').update(serialized).digest('hex'),
    capturedAt,
  }
}

export function withSearchSnapshot(reference: MarketSearchReference, snapshot?: SavedSearchQuerySnapshot): MarketSearchReference {
  return snapshot ? { ...reference, captureSource: snapshot.source, querySnapshot: snapshot } : reference
}

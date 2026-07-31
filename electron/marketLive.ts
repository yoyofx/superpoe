const LIVE_ID = /^[A-Za-z0-9_-]{1,128}$/
const LIVE_TOKEN = /^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+){2}$/

export interface ParsedLiveResult {
  listingIds: string[]
  resultTokens: string[]
}

export function parseLiveResult(payload: unknown): ParsedLiveResult {
  if (!payload || typeof payload !== 'object') return { listingIds: [], resultTokens: [] }
  const message = payload as { new?: unknown; result?: unknown; count?: unknown }
  const resultTokens = Number(message.count) > 0 && typeof message.result === 'string'
    && message.result.length <= 4_096 && LIVE_TOKEN.test(message.result) ? [message.result] : []
  const liveResult = Number(message.count) > 0 && Array.isArray(message.result) ? message.result : []
  const source = liveResult.length ? liveResult
    : typeof message.new === 'string' ? [message.new]
      : Array.isArray(message.new) ? message.new : []
  return {
    listingIds: [...new Set(source.filter((id): id is string => typeof id === 'string' && LIVE_ID.test(id)))].slice(0, 500),
    resultTokens,
  }
}

export function parseLiveListingIds(payload: unknown): string[] {
  return parseLiveResult(payload).listingIds
}

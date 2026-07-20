const POE2DB_BASE_URL = 'https://poe2db.tw/cn/'
const POE2DB_API_URL = 'https://poe2db.tw/api/requestShareCode'
const FETCH_TIMEOUT_MS = 20_000

type FetchLike = typeof fetch

export interface Poe2dbImportResult {
  code: string
  sourceUrl: string
}

export class Poe2dbImportError extends Error {
  constructor(message: string, readonly statusCode = 502) {
    super(message)
    this.name = 'Poe2dbImportError'
  }
}

export function parseWeGameShareCode(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Poe2dbImportError('A WeGame share link is required', 400)
  }

  let parsed: URL
  try {
    parsed = new URL(value.trim())
  } catch {
    throw new Poe2dbImportError('Invalid WeGame share link', 400)
  }

  if (parsed.origin !== 'https://www.wegame.com.cn' || parsed.pathname !== '/helper/poe2/') {
    throw new Poe2dbImportError('Only WeGame PoE2 share links are supported', 400)
  }

  const match = parsed.hash.match(/^#\/share\/([A-Za-z0-9_-]{64})$/)
  if (!match) throw new Poe2dbImportError('Invalid WeGame share code', 400)
  return match[1]
}

function decodeHtmlAttribute(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
}

export function extractPobCode(html: string): string {
  const input = html.match(/<input\b[^>]*\bid=["']pobCode["'][^>]*>/i)?.[0]
  const value = input?.match(/\bvalue=["']([^"']+)["']/i)?.[1]
  const code = value ? decodeHtmlAttribute(value).trim() : ''
  if (!/^[A-Za-z0-9_-]+={0,2}$/.test(code)) {
    throw new Poe2dbImportError('PoE2DB did not return a valid PoB build code')
  }
  return code
}

function requirePoe2dbBuildUrl(location: unknown): URL {
  if (typeof location !== 'string' || !location) {
    throw new Poe2dbImportError('PoE2DB did not return a build location')
  }

  const url = new URL(location, POE2DB_BASE_URL)
  if (url.origin !== 'https://poe2db.tw' || url.pathname !== '/cn/qq_build' || !url.searchParams.get('name')) {
    throw new Poe2dbImportError('PoE2DB returned an unexpected build location')
  }
  return url
}

async function fetchWithTimeout(fetchImpl: FetchLike, url: string): Promise<Response> {
  try {
    return await fetchImpl(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), redirect: 'error' })
  } catch {
    throw new Poe2dbImportError('PoE2DB request timed out or could not be reached', 504)
  }
}

export async function requestPoe2dbBuild(shareCode: string, fetchImpl: FetchLike = fetch): Promise<Poe2dbImportResult> {
  const conversionUrl = new URL(POE2DB_API_URL)
  conversionUrl.searchParams.set('share_code', shareCode)
  const conversionResponse = await fetchWithTimeout(fetchImpl, conversionUrl.toString())
  if (!conversionResponse.ok) throw new Poe2dbImportError('PoE2DB could not convert this WeGame share link')

  let conversion: { code?: unknown; location?: unknown }
  try {
    conversion = await conversionResponse.json() as { code?: unknown; location?: unknown }
  } catch {
    throw new Poe2dbImportError('PoE2DB returned an invalid conversion response')
  }
  if (conversion.code !== 200) throw new Poe2dbImportError('PoE2DB could not convert this WeGame share link')

  const buildUrl = requirePoe2dbBuildUrl(conversion.location)
  const buildResponse = await fetchWithTimeout(fetchImpl, buildUrl.toString())
  if (!buildResponse.ok) throw new Poe2dbImportError('PoE2DB build page could not be loaded')

  return {
    code: extractPobCode(await buildResponse.text()),
    sourceUrl: buildUrl.toString(),
  }
}

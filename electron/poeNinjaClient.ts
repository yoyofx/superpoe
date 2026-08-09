const POE_NINJA_ORIGINS = new Set(['https://poe.ninja', 'https://www.poe.ninja'])
const POE_NINJA_API_ORIGIN = 'https://poe.ninja'
const FETCH_TIMEOUT_MS = 20_000

export interface PoeNinjaImportResult {
  code: string
  sourceUrl: string
  suggestedName: string
}

export interface PoeNinjaCharacterRef {
  account: string
  league: string
  character: string
}

export class PoeNinjaImportError extends Error {
  constructor(message: string, readonly statusCode = 502) {
    super(message)
    this.name = 'PoeNinjaImportError'
  }
}

function decodeSegment(value: string, name: string): string {
  try {
    const decoded = decodeURIComponent(value)
    if (!decoded || decoded.includes('/')) throw new Error()
    return decoded
  } catch {
    throw new PoeNinjaImportError(`Invalid poe.ninja ${name}`, 400)
  }
}

export function parsePoeNinjaCharacterUrl(value: unknown): PoeNinjaCharacterRef & { sourceUrl: string } {
  if (typeof value !== 'string' || !value.trim()) {
    throw new PoeNinjaImportError('A poe.ninja character link is required', 400)
  }

  let parsed: URL
  try {
    parsed = new URL(value.trim())
  } catch {
    throw new PoeNinjaImportError('Invalid poe.ninja character link', 400)
  }

  if (parsed.protocol !== 'https:' || !POE_NINJA_ORIGINS.has(parsed.origin)) {
    throw new PoeNinjaImportError('Only HTTPS poe.ninja links are supported', 400)
  }

  const segments = parsed.pathname.split('/').filter(Boolean)
  if (segments[0] !== 'poe2') {
    throw new PoeNinjaImportError('Only poe.ninja PoE2 character links are supported', 400)
  }

  const hasPassiveTreeSuffix = segments.length === 7 && segments[6] === 'passive-tree'
  const isProfileCharacter = (segments.length === 6 || hasPassiveTreeSuffix) && segments[1] === 'profile' && segments[4] === 'character'
  const isBuildCharacter = (segments.length === 6 || hasPassiveTreeSuffix) && segments[1] === 'builds' && segments[3] === 'character'
  if (!isProfileCharacter && !isBuildCharacter) {
    throw new PoeNinjaImportError('Only poe.ninja PoE2 character links are supported', 400)
  }

  const accountSegment = isProfileCharacter ? segments[2] : segments[4]
  const leagueSegment = isProfileCharacter ? segments[3] : segments[2]
  const characterSegment = segments[5]

  return {
    account: decodeSegment(accountSegment, 'account'),
    league: decodeSegment(leagueSegment, 'league'),
    character: decodeSegment(characterSegment, 'character'),
    sourceUrl: parsed.toString(),
  }
}

async function fetchWithTimeout(fetchImpl: typeof fetch, url: string): Promise<Response> {
  try {
    return await fetchImpl(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), redirect: 'error' })
  } catch {
    throw new PoeNinjaImportError('poe.ninja request timed out or could not be reached', 504)
  }
}

export async function requestPoeNinjaBuild(value: unknown, fetchImpl: typeof fetch = fetch): Promise<PoeNinjaImportResult> {
  const ref = parsePoeNinjaCharacterUrl(value)
  const apiUrl = `${POE_NINJA_API_ORIGIN}/poe2/api/profile/characters/${encodeURIComponent(ref.account)}/${encodeURIComponent(ref.league)}/${encodeURIComponent(ref.character)}/model/0`
  const response = await fetchWithTimeout(fetchImpl, apiUrl)
  if (!response.ok) throw new PoeNinjaImportError('poe.ninja could not load this character')

  let payload: { type?: unknown; charModel?: { name?: unknown; pathOfBuildingExport?: unknown } }
  try {
    payload = await response.json() as typeof payload
  } catch {
    throw new PoeNinjaImportError('poe.ninja returned invalid character data')
  }

  const model = payload.type === 'found' ? payload.charModel : undefined
  const code = typeof model?.pathOfBuildingExport === 'string' ? model.pathOfBuildingExport.trim() : ''
  if (!/^[A-Za-z0-9_-]+={0,2}$/.test(code)) {
    throw new PoeNinjaImportError('This poe.ninja character has no usable Path of Building code')
  }

  const suggestedName = typeof model?.name === 'string' && model.name.trim() ? model.name.trim() : ref.character
  return { code, sourceUrl: ref.sourceUrl, suggestedName }
}

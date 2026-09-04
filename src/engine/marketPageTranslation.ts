export type MarketTranslationLanguage = 'en' | 'zh-rCN' | 'zh-rTW' | 'ko-KR'

export type MarketTranslationPair = readonly [source: string, target: string]

export type MarketTranslationSuggestionScope = 'all' | 'items' | 'filters'

export interface MarketPageTranslationPayload {
  schemaVersion: 1
  language: MarketTranslationLanguage
  enabled: boolean
  source: string
  uiPairs: MarketTranslationPair[]
  gamePairs: MarketTranslationPair[]
  /** Candidates shown by the official item-name/base-type selector. */
  itemPairs?: MarketTranslationPair[]
  /** Candidates shown by the official stat/modifier selector. */
  filterPairs?: MarketTranslationPair[]
}

interface CompiledTemplate {
  pattern: RegExp
  target: string
  placeholders: Array<'hash' | number>
  literalLength: number
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  apos: "'",
  gt: '>',
  hellip: '…',
  lt: '<',
  nbsp: ' ',
  ndash: '–',
  quot: '"',
}

function decodeEntities(value: string): string {
  return value
    .replace(/&([a-z]+);/gi, (match, name: string) => NAMED_ENTITIES[name.toLowerCase()] ?? match)
    .replace(/&#(x[\da-f]+|\d+);/gi, (match, code: string) => {
      const value = code.toLowerCase().startsWith('x')
        ? Number.parseInt(code.slice(1), 16)
        : Number.parseInt(code, 10)
      return Number.isFinite(value) && value >= 0 && value <= 0x10ffff ? String.fromCodePoint(value) : match
    })
}

export function normalizeMarketText(value: string): string {
  return decodeEntities(value).replace(/[\s\u3000]+/g, ' ').trim()
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function compileTemplate(source: string, target: string): CompiledTemplate | null {
  let pattern = '^'
  let cursor = 0
  let literalLength = 0
  const placeholders: Array<'hash' | number> = []
  const matcher = /#|\{(\d+)\}/g
  for (const match of source.matchAll(matcher)) {
    const start = match.index || 0
    const literal = source.slice(cursor, start)
    pattern += escapeRegExp(literal)
    literalLength += literal.length
    if (match[0] === '#') {
      // Xiletrade's `#` is the numeric value only; a following percent sign
      // remains part of the literal text in the source template.
      pattern += '([-+]?\\d+(?:[.,]\\d+)?)'
      placeholders.push('hash')
    } else {
      pattern += '(.+?)'
      placeholders.push(Number(match[1]))
    }
    cursor = start + match[0].length
  }
  if (!placeholders.length) return null
  const tail = source.slice(cursor)
  pattern += escapeRegExp(tail)
  literalLength += tail.length
  const targetPlaceholders = [...target.matchAll(/#|\{(\d+)\}/g)]
  // Never drop a live value when a locale catalog contains a static label for
  // a parameterized English string. The exact entry can still translate the
  // catalog's literal form, while dynamic values safely remain in English.
  if (targetPlaceholders.length !== placeholders.length) return null
  return {
    pattern: new RegExp(`${pattern}$`, 'i'),
    target,
    placeholders,
    literalLength,
  }
}

function templateBucket(value: string): string {
  return /^(?:#|\{\d+\})/.test(value) ? '*' : value.slice(0, 1).toLocaleLowerCase() || '*'
}

function preserveWhitespace(source: string, translated: string): string {
  const leading = source.match(/^\s*/)?.[0] || ''
  const trailing = source.match(/\s*$/)?.[0] || ''
  return leading + translated + trailing
}

function addPair(
  exact: Map<string, string>,
  templates: Map<string, CompiledTemplate[]>,
  source: string,
  target: string,
): void {
  const normalizedSource = normalizeMarketText(source)
  const normalizedTarget = normalizeMarketText(target)
  if (!normalizedSource || !normalizedTarget || normalizedSource === normalizedTarget) return
  if (!/[A-Za-z]/.test(normalizedSource)) return
  const key = normalizedSource.toLocaleLowerCase()
  if (!exact.has(key)) exact.set(key, normalizedTarget)
  const compiled = compileTemplate(normalizedSource, normalizedTarget)
  if (compiled) {
    const bucket = templateBucket(normalizedSource)
    const list = templates.get(bucket) || []
    list.push(compiled)
    templates.set(bucket, list)
  }
}

function matchTemplate(
  value: string,
  templates: Map<string, CompiledTemplate[]>,
): string | undefined {
  const normalized = normalizeMarketText(value)
  const key = normalized.toLocaleLowerCase()
  const bucket = templateBucket(normalized)
  const candidates = [
    ...(templates.get(bucket) || []),
    ...(bucket === '*' ? [] : templates.get('*') || []),
  ].sort((left, right) => right.literalLength - left.literalLength)
  for (const template of candidates) {
    const match = key.match(template.pattern)
    if (!match) continue
    const values = match.slice(1)
    const hashCaptureIndexes = template.placeholders.flatMap((value, index) => value === 'hash' ? [index] : [])
    let hashOrdinal = 0
    const translated = template.target.replace(/#|\{(\d+)\}/g, (placeholder, index: string | undefined) => {
      const captureIndex = placeholder === '#'
        ? hashCaptureIndexes[hashOrdinal++] ?? -1
        : template.placeholders.findIndex((value) => value === Number(index))
      return captureIndex >= 0 ? values[captureIndex] || placeholder : placeholder
    })
    return translated
  }
  return undefined
}

function addPairs(
  exact: Map<string, string>,
  templates: Map<string, CompiledTemplate[]>,
  pairs: readonly MarketTranslationPair[] | undefined,
): void {
  for (const pair of pairs || []) {
    if (!Array.isArray(pair) || pair.length < 2 || typeof pair[0] !== 'string' || typeof pair[1] !== 'string') continue
    addPair(exact, templates, pair[0], pair[1])
  }
  for (const list of templates.values()) list.sort((left, right) => right.literalLength - left.literalLength)
}

function addReversePair(
  exact: Map<string, MarketTranslationPair[]>,
  source: string,
  target: string,
): void {
  const normalizedTarget = normalizeMarketText(target)
  const normalizedSource = normalizeMarketText(source)
  if (!normalizedTarget || !normalizedSource) return
  const key = normalizedTarget.toLocaleLowerCase()
  const pairs = exact.get(key) || []
  if (!pairs.some(([candidate]) => candidate === source)) pairs.push([source, target])
  exact.set(key, pairs)
}

function addReversePairs(
  exact: Map<string, MarketTranslationPair[]>,
  pairs: readonly MarketTranslationPair[] | undefined,
): void {
  for (const pair of pairs || []) {
    if (!Array.isArray(pair) || pair.length < 2 || typeof pair[0] !== 'string' || typeof pair[1] !== 'string') continue
    addReversePair(exact, pair[0], pair[1])
  }
}

function matchReverseTemplate(
  value: string,
  pairs: readonly MarketTranslationPair[],
): MarketTranslationPair | undefined {
  const normalized = normalizeMarketText(value)
  const key = normalized.toLocaleLowerCase()
  const candidates = pairs
    .map(([source, target]) => {
      const compiled = compileTemplate(target, source)
      return compiled ? { source, target, compiled } : undefined
    })
    .filter((candidate): candidate is { source: string; target: string; compiled: CompiledTemplate } => Boolean(candidate))
    .sort((left, right) => right.compiled.literalLength - left.compiled.literalLength)
  for (const candidate of candidates) {
    const match = key.match(candidate.compiled.pattern)
    if (!match) continue
    const values = match.slice(1)
    const hashCaptureIndexes = candidate.compiled.placeholders.flatMap((placeholder, index) => placeholder === 'hash' ? [index] : [])
    let hashOrdinal = 0
    const source = candidate.source.replace(/#|\{(\d+)\}/g, (placeholder, index: string | undefined) => {
      const captureIndex = placeholder === '#'
        ? hashCaptureIndexes[hashOrdinal++] ?? -1
        : candidate.compiled.placeholders.findIndex((placeholder) => placeholder === Number(index))
      return captureIndex >= 0 ? values[captureIndex] || placeholder : placeholder
    })
    return [source, candidate.target]
  }
  return undefined
}

function compactLocalizedText(value: string): string {
  return normalizeMarketText(value).replace(/[\s\u3000]+/g, '').toLocaleLowerCase()
}

function localizedQueryTokens(value: string): string[] {
  return normalizeMarketText(value).toLocaleLowerCase().split(/\s+/u).filter(Boolean)
}

function isLocalizedSubsequence(query: string, target: string): boolean {
  if (!query || query.length > target.length) return false
  let queryIndex = 0
  for (const character of target) {
    if (character === query[queryIndex]) queryIndex += 1
    if (queryIndex === query.length) return true
  }
  return false
}

interface LocalizedMatchScore {
  kind: 0 | 1 | 2 | 3
  span: number
  gap: number
}

function scoreLocalizedMatch(query: string, target: string): LocalizedMatchScore | undefined {
  const normalizedQuery = normalizeMarketText(query).toLocaleLowerCase()
  const normalizedTarget = normalizeMarketText(target).toLocaleLowerCase()
  const compactQuery = compactLocalizedText(query)
  const compactTarget = compactLocalizedText(target)
  if (!compactQuery || !compactTarget) return undefined

  const directIndex = compactTarget.indexOf(compactQuery)
  if (directIndex >= 0) {
    return { kind: normalizedQuery === normalizedTarget ? 0 : 1, span: compactQuery.length, gap: directIndex }
  }

  const tokens = localizedQueryTokens(query).map(compactLocalizedText).filter(Boolean)
  if (tokens.length > 1 && tokens.every((token) => compactTarget.includes(token))) {
    const span = tokens.reduce((total, token) => total + token.length, 0)
    const gap = tokens.reduce((total, token) => total + Math.max(0, compactTarget.indexOf(token)), 0)
    return { kind: 2, span, gap }
  }

  // Chinese users commonly omit the semantic separator: "物锤" should still
  // match "物理大锤". Keep this fallback character-ordered and require at
  // least two query characters so a one-character search does not explode.
  if (compactQuery.length >= 2 && isLocalizedSubsequence(compactQuery, compactTarget)) {
    return { kind: 3, span: compactQuery.length, gap: compactTarget.length - compactQuery.length }
  }
  return undefined
}

/**
 * Display-only translator used by the official trade page preload. It never
 * knows about query IDs or form values; callers decide whether game-content
 * pairs are allowed for a particular DOM context.
 */
export class MarketPageTranslator {
  private readonly uiExact = new Map<string, string>()
  private readonly gameExact = new Map<string, string>()
  private readonly uiTemplates = new Map<string, CompiledTemplate[]>()
  private readonly gameTemplates = new Map<string, CompiledTemplate[]>()
  private readonly uiReverse = new Map<string, MarketTranslationPair[]>()
  private readonly gameReverse = new Map<string, MarketTranslationPair[]>()
  private readonly allUiPairs: MarketTranslationPair[]
  private readonly allGamePairs: MarketTranslationPair[]
  private readonly allItemPairs: MarketTranslationPair[]
  private readonly allFilterPairs: MarketTranslationPair[]

  constructor(payload: MarketPageTranslationPayload) {
    this.allUiPairs = (Array.isArray(payload.uiPairs) ? payload.uiPairs : [])
      .filter((pair): pair is MarketTranslationPair => Array.isArray(pair) && pair.length >= 2)
    this.allGamePairs = (Array.isArray(payload.gamePairs) ? payload.gamePairs : [])
      .filter((pair): pair is MarketTranslationPair => Array.isArray(pair) && pair.length >= 2)
    // Older payloads did not carry scoped candidate lists. Falling back to the
    // complete game list keeps those payloads functional while new payloads
    // can prevent item and stat suggestions from bleeding into each other.
    this.allItemPairs = (Array.isArray(payload.itemPairs) ? payload.itemPairs : this.allGamePairs)
      .filter((pair): pair is MarketTranslationPair => Array.isArray(pair) && pair.length >= 2)
    this.allFilterPairs = (Array.isArray(payload.filterPairs) ? payload.filterPairs : this.allGamePairs)
      .filter((pair): pair is MarketTranslationPair => Array.isArray(pair) && pair.length >= 2)
    addPairs(this.uiExact, this.uiTemplates, payload.uiPairs)
    addPairs(this.gameExact, this.gameTemplates, payload.gamePairs)
    addReversePairs(this.uiReverse, this.allUiPairs)
    addReversePairs(this.gameReverse, this.allGamePairs)
  }

  translate(value: string, includeGame = false): string {
    if (!value || !/[A-Za-z]/.test(value)) return value
    const normalized = normalizeMarketText(value).toLocaleLowerCase()
    const exact = this.uiExact.get(normalized) || (includeGame ? this.gameExact.get(normalized) : undefined)
    if (exact) return preserveWhitespace(value, exact)
    const uiTemplate = matchTemplate(value, this.uiTemplates)
    if (uiTemplate) return preserveWhitespace(value, uiTemplate)
    if (includeGame) {
      const gameTemplate = matchTemplate(value, this.gameTemplates)
      if (gameTemplate) return preserveWhitespace(value, gameTemplate)
    }
    return value
  }

  /**
   * Resolves a localized filter value back to the canonical English value.
   * This is intentionally separate from `translate`: the official trade page
   * must continue receiving its original English text and option values.
   */
  findSource(value: string, includeGame = false): string | undefined {
    if (!value || !/[\u0080-\uFFFF]/.test(value)) return undefined
    const normalized = normalizeMarketText(value).toLocaleLowerCase()
    const exact = this.uiReverse.get(normalized)?.[0]
      || (includeGame ? this.gameReverse.get(normalized)?.[0] : undefined)
    if (exact) return exact[0]
    const template = matchReverseTemplate(value, this.allUiPairs)
      || (includeGame ? matchReverseTemplate(value, this.allGamePairs) : undefined)
    return template?.[0]
  }

  /**
   * Returns localized candidates for a filter query. Exact matches are first;
   * substring matches make partial Chinese item/stat searches useful without
   * changing the official query semantics.
   */
  findMatches(
    value: string,
    includeGame = false,
    limit = 40,
    scope: MarketTranslationSuggestionScope = 'all',
  ): MarketTranslationPair[] {
    if (!value || !/[\u0080-\uFFFF]/.test(value)) return []
    const normalized = normalizeMarketText(value).toLocaleLowerCase()
    if (!normalized) return []
    const scopedGamePairs = scope === 'items' ? this.allItemPairs
      : scope === 'filters' ? this.allFilterPairs
        : this.allGamePairs
    const sourcePairs = !includeGame ? this.allUiPairs
      : scope === 'all' ? [...this.allUiPairs, ...scopedGamePairs]
        : scopedGamePairs
    const seen = new Set<string>()
    const result: MarketTranslationPair[] = []
    const add = (pair: MarketTranslationPair) => {
      const key = `${pair[0]}\u0000${pair[1]}`
      if (seen.has(key) || result.length >= limit) return
      seen.add(key)
      result.push(pair)
    }
    const candidates = sourcePairs
      .map((pair, index) => ({
        pair,
        index,
        score: scoreLocalizedMatch(value, pair[1]),
      }))
      .filter((candidate): candidate is { pair: MarketTranslationPair; index: number; score: LocalizedMatchScore } => Boolean(candidate.score))
      .sort((left, right) => {
        return left.score.kind - right.score.kind
          || right.score.span - left.score.span
          || left.score.gap - right.score.gap
          || left.pair[0].length - right.pair[0].length
          || left.index - right.index
      })
    for (const { pair } of candidates) add(pair)
    return result
  }

  findPairByTarget(value: string, includeGame = false): MarketTranslationPair | undefined {
    if (!value) return undefined
    const normalized = normalizeMarketText(value).toLocaleLowerCase()
    return this.uiReverse.get(normalized)?.[0]
      || (includeGame ? this.gameReverse.get(normalized)?.[0] : undefined)
      || matchReverseTemplate(value, this.allUiPairs)
      || (includeGame ? matchReverseTemplate(value, this.allGamePairs) : undefined)
  }
}

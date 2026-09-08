import { normalizeMarketText, type MarketTranslationPair } from './marketPageTranslation.js'

export interface OfficialMarketSuggestionCatalog {
  itemPairs: MarketTranslationPair[]
  filterPairsById: Map<string, MarketTranslationPair[]>
  filterLabelsById: Map<string, string>
  statPairs: MarketTranslationPair[]
}

type LocalizeOfficialText = (source: string) => string

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function resultGroups(value: unknown): Record<string, unknown>[] {
  const root = asRecord(value)
  const result = Array.isArray(root?.result) ? root.result : []
  return result.map(asRecord).filter((group): group is Record<string, unknown> => Boolean(group))
}

function addPair(
  target: MarketTranslationPair[],
  source: unknown,
  localize: LocalizeOfficialText,
  seen: Set<string>,
): void {
  const sourceText = stringValue(source)
  if (!sourceText) return
  const sourceKey = normalizeMarketText(sourceText).toLocaleLowerCase()
  if (seen.has(sourceKey)) return
  seen.add(sourceKey)
  const targetText = localize(sourceText) || sourceText
  if (!targetText) return
  target.push([sourceText, targetText])
}

function optionPairs(
  option: unknown,
  localize: LocalizeOfficialText,
): MarketTranslationPair[] {
  const optionRecord = asRecord(option)
  const options = Array.isArray(optionRecord?.options) ? optionRecord.options : []
  const pairs: MarketTranslationPair[] = []
  const seen = new Set<string>()
  for (const entry of options) addPair(pairs, asRecord(entry)?.text, localize, seen)
  return pairs
}

export function buildOfficialMarketSuggestionCatalog(
  itemsData: unknown,
  filtersData: unknown,
  statsData: unknown,
  localize: LocalizeOfficialText,
): OfficialMarketSuggestionCatalog {
  const itemPairs: MarketTranslationPair[] = []
  const seenItems = new Set<string>()
  for (const group of resultGroups(itemsData)) {
    const entries = Array.isArray(group.entries) ? group.entries : []
    for (const entry of entries) {
      const item = asRecord(entry)
      addPair(itemPairs, item?.type, localize, seenItems)
      addPair(itemPairs, item?.text, localize, seenItems)
      addPair(itemPairs, item?.name, localize, seenItems)
    }
  }

  const filterPairsById = new Map<string, MarketTranslationPair[]>()
  const filterLabelsById = new Map<string, string>()
  for (const group of resultGroups(filtersData)) {
    const filters = Array.isArray(group.filters) ? group.filters : []
    for (const filter of filters) {
      const filterRecord = asRecord(filter)
      const id = stringValue(filterRecord?.id)
      if (!id) continue
      const label = stringValue(filterRecord?.text || filterRecord?.label)
      if (label) filterLabelsById.set(id, label)
      const pairs = optionPairs(filterRecord?.option, localize)
      if (!pairs.length) continue
      filterPairsById.set(id, pairs)
    }
  }

  const statPairs: MarketTranslationPair[] = []
  const seenStats = new Set<string>()
  for (const group of resultGroups(statsData)) {
    const entries = Array.isArray(group.entries) ? group.entries : []
    for (const entry of entries) addPair(statPairs, asRecord(entry)?.text, localize, seenStats)
  }

  return { itemPairs, filterPairsById, filterLabelsById, statPairs }
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

/**
 * Builds the same official-only catalog as the synchronous helper, but yields
 * between batches so a large item/stat catalog cannot block the market page.
 */
export async function buildOfficialMarketSuggestionCatalogAsync(
  itemsData: unknown,
  filtersData: unknown,
  statsData: unknown,
  localize: LocalizeOfficialText,
  batchSize = 200,
): Promise<OfficialMarketSuggestionCatalog> {
  const itemPairs: MarketTranslationPair[] = []
  const seenItems = new Set<string>()
  let work = 0
  const checkpoint = async (): Promise<void> => {
    work += 1
    if (work % batchSize === 0) await yieldToEventLoop()
  }

  for (const group of resultGroups(itemsData)) {
    const entries = Array.isArray(group.entries) ? group.entries : []
    for (const entry of entries) {
      const item = asRecord(entry)
      addPair(itemPairs, item?.type, localize, seenItems)
      addPair(itemPairs, item?.text, localize, seenItems)
      addPair(itemPairs, item?.name, localize, seenItems)
      await checkpoint()
    }
  }

  const filterPairsById = new Map<string, MarketTranslationPair[]>()
  const filterLabelsById = new Map<string, string>()
  for (const group of resultGroups(filtersData)) {
    const filters = Array.isArray(group.filters) ? group.filters : []
    for (const filter of filters) {
      const filterRecord = asRecord(filter)
      const id = stringValue(filterRecord?.id)
      if (!id) continue
      const label = stringValue(filterRecord?.text || filterRecord?.label)
      if (label) filterLabelsById.set(id, label)
      const pairs = optionPairs(filterRecord?.option, localize)
      if (pairs.length) filterPairsById.set(id, pairs)
      await checkpoint()
    }
  }

  const statPairs: MarketTranslationPair[] = []
  const seenStats = new Set<string>()
  for (const group of resultGroups(statsData)) {
    const entries = Array.isArray(group.entries) ? group.entries : []
    for (const entry of entries) {
      addPair(statPairs, asRecord(entry)?.text, localize, seenStats)
      await checkpoint()
    }
  }

  return { itemPairs, filterPairsById, filterLabelsById, statPairs }
}

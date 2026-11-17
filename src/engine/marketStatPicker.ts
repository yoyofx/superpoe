import type { OfficialMarketCandidate } from './marketOfficialSuggestions.js'
import type { MarketStatScopeData } from './marketStatScope.js'

export type MarketStatAffix = 'prefix' | 'suffix'

export interface MarketStatPickerData {
  /** Official ID, canonical English text, localized text. */
  entries: Array<[string, string, string]>
  affixes: Array<[string, MarketStatAffix[]]>
  scopes?: MarketStatScopeData
  scopeError?: boolean
}

/** PoB exports the actual trade hashes alongside each modifier's generation type. */
export function buildMarketStatAffixIndex(sources: readonly string[]): MarketStatPickerData['affixes'] {
  const kinds = new Map<string, Set<MarketStatAffix>>()
  for (const source of sources) {
    for (const line of source.split(/\r?\n/)) {
      const type = line.match(/\btype\s*=\s*"(Prefix|Suffix)"/)?.[1]
      const start = line.indexOf('tradeHashes')
      if (!type || start < 0) continue
      for (const match of line.slice(start).matchAll(/\[(\d+)\]\s*=/g)) {
        const values = kinds.get(match[1]) || new Set<MarketStatAffix>()
        values.add(type === 'Prefix' ? 'prefix' : 'suffix')
        kinds.set(match[1], values)
      }
    }
  }
  return [...kinds].map(([id, values]) => [id, (['prefix', 'suffix'] as const).filter((kind) => values.has(kind))])
}

/** Only enrich currently selectable official rows; never manufacture a query ID. */
export function enrichMarketStatCandidates(candidates: readonly OfficialMarketCandidate[], data: MarketStatPickerData,
  localize: (source: string) => string): OfficialMarketCandidate[] {
  const labels = new Map(data.entries.map(([id, source, text]) => [id, { source, text }]))
  const affixes = new Map(data.affixes)
  return candidates.map((candidate) => {
    if (candidate.field !== 'stats') return candidate
    const id = String(candidate.value ?? '')
    const label = labels.get(id)
    // Implicits, runes and pseudo totals do not acquire a generation type just
    // because they share a hash/text with an explicit affix.
    const hash = id.match(/^(?:explicit|fractured|crafted|desecrated)\.stat_(\d+)$/)?.[1]
    return { ...candidate, text: label?.text || localize(candidate.source),
      aliases: label ? [label.source, label.text] : [], affixes: hash ? affixes.get(hash) || [] : [] }
  })
}

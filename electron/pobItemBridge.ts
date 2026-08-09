import type { CanonicalEquipmentItem, CanonicalItemView, LibraryItemSnapshot, MarketRealm } from '../src/types/market.js'
import type { PobLuaService } from './pobLuaService.js'

export interface NormalizedPobItem {
  item: CanonicalEquipmentItem
  view: CanonicalItemView
}

export class PobItemBridge {
  constructor(private readonly lua: PobLuaService) {}

  async normalize(raw: string): Promise<NormalizedPobItem> {
    if (typeof raw !== 'string' || !raw.trim() || raw.length > 100_000) {
      throw new Error('Invalid PoB item raw')
    }
    const result = await this.lua.normalizeItem(raw.trim())
    if (!result.success || !result.item || !result.view) {
      throw new Error(result.error || 'PoB Item normalization failed')
    }
    return { item: result.item, view: result.view }
  }
}

export function canonicalToLegacySnapshot(normalized: NormalizedPobItem, view: CanonicalItemView = normalized.view, realm?: MarketRealm): LibraryItemSnapshot {
  return {
    rarity: view.rarity,
    name: view.name,
    baseType: view.baseType,
    itemLevel: view.itemLevel,
    quality: view.quality,
    sockets: view.sockets,
    corrupted: view.corrupted,
    identified: view.identified,
    iconUrl: view.iconUrl,
    localized: view.localized,
    tradeCategory: view.tradeCategory,
    properties: view.properties,
    requirements: view.requirements,
    rawText: normalized.item.raw,
    modifiers: view.modifiers.map((modifier) => {
      const queryStatId = modifier.tradeStatIds.length === 1 ? modifier.tradeStatIds[0] : undefined
      const [baseStatId, optionId] = queryStatId?.split('|') || []
      // ExtraSkill mods keep the granted level in the canonical text rather
      // than returning it as tradeValue. The official skill stat is numeric,
      // so preserve that level for the price-check Min/Max controls.
      const grantedSkillLevel = modifier.text.match(/^Grants Skill:\s*Level\s+(\d+)/i)?.[1]
      const inferredTradeValue = modifier.tradeValue ?? (grantedSkillLevel ? Number(grantedSkillLevel) : undefined)
      const valueMode = optionId ? 'fixed-option' : inferredTradeValue == null ? 'presence' : 'numeric'
      return {
        id: modifier.id,
        displayOrder: modifier.displayOrder,
        group: modifier.group,
        sourceTags: modifier.sourceTags,
        original: { locale: 'en' as const, lines: [modifier.text], displayText: modifier.text },
        localized: modifier.localized ? Object.fromEntries(Object.entries(modifier.localized).map(([locale, text]) => [locale, { lines: [text], displayText: text }])) : undefined,
        valueMode,
        currentValues: inferredTradeValue == null ? [] : [modifier.tradeValueNegated ? -inferredTradeValue : inferredTradeValue],
        tierRanges: [],
        tradeResolutions: realm ? [{
          realm,
          queryStatId,
          baseStatId,
          optionId,
          candidateStatIds: modifier.tradeStatIds,
          source: modifier.group,
          valueMode,
          valueTransform: modifier.tradeValueNegated ? 'negate' as const : 'identity' as const,
          resolvedBy: 'exact-text' as const,
          status: queryStatId ? 'resolved' as const : modifier.tradeStatIds.length ? 'ambiguous' as const : 'unresolved' as const,
        }] : [],
      }
    }),
  }
}

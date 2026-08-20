import type { CanonicalEquipmentItem, CanonicalItemView, LibraryItemSnapshot, MarketRealm } from '../src/types/market.js'
import type { PobLuaService } from './pobLuaService.js'
import { XiletradeDataCatalog, XiletradeModifierMatcher } from './xiletradeDataCatalog.js'

export interface NormalizedPobItem {
  item: CanonicalEquipmentItem
  view: CanonicalItemView
}

export class PobItemBridge {
  constructor(private readonly lua: PobLuaService, private readonly xiletrade?: XiletradeDataCatalog) {}

  get tradeDataVersion(): string | undefined {
    return this.xiletrade ? `xiletrade:${this.xiletrade.get('en-US').upstreamCommit}` : undefined
  }

  async normalize(raw: string): Promise<NormalizedPobItem> {
    if (typeof raw !== 'string' || !raw.trim() || raw.length > 100_000) {
      throw new Error('Invalid PoB item raw')
    }
    const canonicalRaw = normalizePobItemForLua(raw)
    const result = await this.lua.normalizeItem(canonicalRaw)
    if (!result.success || !result.item || !result.view) {
      throw new Error(result.error || 'PoB Item normalization failed')
    }
    const view = { ...result.view, normalizationKnown: Array.isArray(result.item.modifierSupport) }
    if (this.xiletrade) {
      const context = this.xiletrade.resolveItemContext('en', {
        itemClass: view.itemClass || result.item.itemClass,
        tradeCategory: view.tradeCategory || result.item.tradeCategory,
        rarity: view.rarity,
        name: view.name,
        baseType: view.baseType,
      })
      const matcher = new XiletradeModifierMatcher(this.xiletrade.bundle('en'))
      view.itemClass = context.itemClass
      view.tradeCategory = context.tradeCategory
      view.modifiers = view.modifiers.map((modifier) => {
        const match = matcher.match(modifier.text, modifier.group, context)
        const valueText = match?.canonicalText || modifier.text
        const currentValue = [...valueText
          .replace(/\s*\(\s*[-+]?\d+(?:\.\d+)?\s*-\s*[-+]?\d+(?:\.\d+)?\s*\)/g, '')
          .matchAll(/[-+]?\d+(?:\.\d+)?/g)]
          .map((candidate) => Number(candidate[0]))
          .find(Number.isFinite)
        return {
          ...modifier,
          tradeStatIds: match?.queryStatId ? [match.queryStatId] : match?.candidateStatIds || [],
          ...(currentValue != null ? { tradeValue: currentValue, tradeValueNegated: false } : {}),
        }
      })
    }
    const item = {
      ...result.item,
      itemClass: view.itemClass,
      tradeCategory: view.tradeCategory,
      modifierSnapshots: structuredClone(view.modifiers),
      ...(this.tradeDataVersion ? { tradeDataVersion: this.tradeDataVersion } : {}),
    }
    return {
      item,
      view,
    }
  }
}

/**
 * Normalize every item entry point before PoB parses it. The game and older
 * translation rows still emit a few valid-but-legacy spell/defence forms;
 * PoB's current item parser expects the canonical wording below.
 */
export function normalizePobItemForLua(raw: string): string {
  const normalized = raw.trim().split(/(\r\n|\n|\r)/).map((part, index) => {
    if (index % 2 === 1) return part
    const marker = part.match(/^(?:(?:\{[^}\r\n]+\})+)/)?.[0] || ''
    let body = part.slice(marker.length)
    let match = body.match(/^(Fire|Cold|Lightning|Chaos) Resistance is ([+\-]?\d+(?:\.\d+)?)%$/)
    if (match) body = `${match[2]}% to ${match[1]} Resistance`
    match = body.match(/^([+\-]?\d+(?:\.\d+)?) to maximum Runic Ward$/)
    if (match) body = `${match[1]} to maximum Ward`
    match = body.match(/^(\d+(?:\.\d+)?)% increased Runic Ward$/)
    if (match) body = `${match[1]}% increased Ward`
    body = body.replace(/Critical Strike Chance for Spells/gi, 'Critical Hit Chance for Spells')
    return marker + body
  }).join('')
  return normalized
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
    itemClass: view.itemClass,
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
        ...(modifier.unsupported !== undefined ? { unsupported: modifier.unsupported } : {}),
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

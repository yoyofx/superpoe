import { describe, expect, it } from 'vitest'
import path from 'node:path'
import { MarketPageTranslator, type MarketPageTranslationPayload } from './marketPageTranslation'
import { buildMarketPageTranslation } from '../../electron/marketPageTranslationCatalog'
import { ItemTranslationIndex } from '../../electron/itemTranslationIndex'
import { XiletradeDataCatalog } from '../../electron/xiletradeDataCatalog'

function payload(
  uiPairs: Array<readonly [string, string]> = [],
  gamePairs: Array<readonly [string, string]> = [],
  itemPairs?: Array<readonly [string, string]>,
  filterPairs?: Array<readonly [string, string]>,
): MarketPageTranslationPayload {
  return {
    schemaVersion: 1,
    language: 'zh-rCN',
    enabled: true,
    source: 'test',
    uiPairs,
    gamePairs,
    ...(itemPairs ? { itemPairs } : {}),
    ...(filterPairs ? { filterPairs } : {}),
  }
}

describe('market page display translator', () => {
  it('translates exact UI text while preserving surrounding whitespace', () => {
    const translator = new MarketPageTranslator(payload([['Search', '搜索']]))

    expect(translator.translate(' Search ')).toBe(' 搜索 ')
    expect(translator.translate('Search')).toBe('搜索')
  })

  it('keeps game catalog text opt-in so user content is not changed accidentally', () => {
    const translator = new MarketPageTranslator(payload([], [['Ring', '戒指']]))

    expect(translator.translate('Ring')).toBe('Ring')
    expect(translator.translate('Ring', true)).toBe('戒指')
  })

  it('translates numeric templates without changing the numeric value', () => {
    const translator = new MarketPageTranslator(payload([], [['+#% increased Fire Damage', '+#% 火焰伤害']]))

    expect(translator.translate('+25% increased Fire Damage', true)).toBe('+25% 火焰伤害')
  })

  it('keeps every value when a template contains multiple placeholders', () => {
    const translator = new MarketPageTranslator(payload([], [[
      '+#% to maximum Life and +#% to maximum Mana',
      '+#% 最大生命与+#% 最大魔力',
    ]]))

    expect(translator.translate('+20% to maximum Life and +30% to maximum Mana', true))
      .toBe('+20% 最大生命与+30% 最大魔力')
  })

  it('supports indexed placeholders used by item descriptions', () => {
    const translator = new MarketPageTranslator(payload([], [[
      'Adds {0} to {1} Fire Damage',
      '附加 {0} 至 {1} 火焰伤害',
    ]]))

    expect(translator.translate('Adds 10 to 20 Fire Damage', true))
      .toBe('附加 10 至 20 火焰伤害')
  })

  it('does not drop a value when a target template has no placeholder', () => {
    const translator = new MarketPageTranslator(payload([], [['# Desecrated Modifiers', '渎灵词缀']]))

    expect(translator.translate('3 Desecrated Modifiers', true)).toBe('3 Desecrated Modifiers')
  })

  it('decodes entities before matching display text', () => {
    const translator = new MarketPageTranslator(payload([['Online & available', '在线且可用']]))

    expect(translator.translate('Online &amp; available')).toBe('在线且可用')
  })

  it('resolves localized filter text back to the canonical English value', () => {
    const translator = new MarketPageTranslator(payload([], [
      ['Fire Damage', '火焰伤害'],
      ['+#% increased Fire Damage', '+#% 火焰伤害'],
    ]))

    expect(translator.findSource('火焰伤害', true)).toBe('Fire Damage')
    expect(translator.findSource('+25% 火焰伤害', true)).toBe('+25% increased Fire Damage')
  })

  it('returns localized candidates for partial filter input', () => {
    const translator = new MarketPageTranslator(payload([], [
      ['Fire Damage', '火焰伤害'],
      ['Lightning Damage', '闪电伤害'],
    ]))

    expect(translator.findMatches('火焰', true)).toEqual([['Fire Damage', '火焰伤害']])
    expect(translator.findMatches('伤害', true)).toHaveLength(2)
  })

  it('supports spaced and unspaced Chinese fuzzy queries', () => {
    const translator = new MarketPageTranslator(payload([], [
      ['Two-Handed Mace', '双手物理大锤'],
      ['One-Handed Mace', '单手锤'],
      ['Two-Handed Axe', '双手斧'],
    ]))

    expect(translator.findMatches('物 锤', true)).toEqual([
      ['Two-Handed Mace', '双手物理大锤'],
    ])
    expect(translator.findMatches('物锤', true)).toEqual([
      ['Two-Handed Mace', '双手物理大锤'],
    ])
  })

  it('keeps item and stat candidates in their respective input scopes', () => {
    const translator = new MarketPageTranslator(payload([], [
      ['Physical Greathammer', '物理大锤'],
      ['Mace Damage', '物理锤类伤害'],
    ], [
      ['Physical Greathammer', '物理大锤'],
    ], [
      ['Mace Damage', '物理锤类伤害'],
    ]))

    expect(translator.findMatches('物 锤', true, 40, 'items')).toEqual([
      ['Physical Greathammer', '物理大锤'],
    ])
    expect(translator.findMatches('物 锤', true, 40, 'filters')).toEqual([
      ['Mace Damage', '物理锤类伤害'],
    ])
  })
})

describe('market page translation catalog', () => {
  const catalog = new XiletradeDataCatalog(path.join(process.cwd(), 'public', 'data', 'xiletrade'))

  it('only enables display translation for the two Chinese UI languages', () => {
    expect(buildMarketPageTranslation(catalog, 'en').enabled).toBe(false)
    expect(buildMarketPageTranslation(catalog, 'ko-KR').enabled).toBe(false)
    expect(buildMarketPageTranslation(catalog, 'zh-rCN').enabled).toBe(true)
    expect(buildMarketPageTranslation(catalog, 'zh-rTW').enabled).toBe(true)
  })

  it('includes static UI, currency, and localized game-content pairs', () => {
    const simplified = buildMarketPageTranslation(catalog, 'zh-rCN', {
      translateItem: (source) => source === 'Crimson Amulet' ? '赤红项链' : undefined,
    })
    const translator = new MarketPageTranslator(simplified)

    expect(translator.translate('Search')).toBe('搜索')
    expect(translator.translate('Type Filters')).toBe('类型筛选')
    expect(translator.translate('Item Category')).toBe('物品类别')
    expect(translator.translate('Item Quality')).toBe('物品品质')
    expect(translator.translate('Equipment Filters')).toBe('装备筛选')
    expect(translator.translate('Attacks per Second')).toBe('每秒攻击次数')
    expect(translator.translate('Physical DPS')).toBe('物理DPS')
    expect(translator.translate('Waystone Packsize')).toBe('引路石怪物群大小')
    expect(translator.translate('Ultimatum Trial')).toBe('最后通牒试炼')
    expect(translator.translate('Gem Level')).toBe('宝石等级')
    expect(translator.translate('Stack Size')).toBe('堆叠数量')
    expect(translator.translate('Other')).toBe('其他')
    expect(translator.translate('Twice Corrupted')).toBe('双重腐化')
    expect(translator.translate('Cultivated Vaal Orb')).toBe('培育瓦尔宝珠')
    expect(translator.translate('Unidentified Tier')).toBe('未鉴定阶级')
    expect(translator.translate('Trade Filters')).toBe('交易筛选')
    expect(translator.translate('Seller Account')).toBe('卖家账号')
    expect(translator.translate('Any Time')).toBe('任意时间')
    expect(translator.translate('Buyout or Fixed Price')).toBe('一口价或固定价格')
    expect(translator.translate('Exalted Orb Equivalent')).toBe('崇高石等价')
    expect(translator.translate('Any One-Handed Melee Weapon')).toBe('任意单手近战武器')
    expect(translator.translate('Crimson Amulet', true)).toBe('赤红项链')
    expect(translator.translate('Accessories', true)).toBe('配饰')
    expect(translator.translate('Scroll of Wisdom', true)).toBe('知识卷轴')
    expect(translator.translate('Andvarius', true)).toBe('贪欲之记')
    expect(simplified.gamePairs.length).toBeGreaterThan(1_000)
    expect(simplified.gamePairs.every((pair) => Array.isArray(pair) && pair.length === 2)).toBe(true)
    expect(simplified.itemPairs?.length).toBeGreaterThan(1_000)
    expect(simplified.filterPairs?.length).toBeGreaterThan(1_000)
  })

  it('keeps values in localized numeric templates', () => {
    const traditional = buildMarketPageTranslation(catalog, 'zh-rTW')
    const translator = new MarketPageTranslator(traditional)
    const source = traditional.gamePairs.find(([value]) => value === '#% increased Movement Speed')

    expect(source).toBeDefined()
    expect(translator.translate('30% increased Movement Speed', true)).toBe('30% 增加移動速度')
  })

  it('composes unique item labels from translated name and base type', () => {
    const index = new ItemTranslationIndex(path.join(process.cwd(), 'public', 'data', 'Translate', 'zh-rCN'))
    const payload = buildMarketPageTranslation(catalog, 'zh-rCN', {
      translateItem: (source) => index.toChinese(source),
    })
    const translator = new MarketPageTranslator(payload)

    expect(translator.translate('The Hammer of Faith Giant Maul', true))
      .toBe('信仰之锤 伟岸巨锤')
  })
})

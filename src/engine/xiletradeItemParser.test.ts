import { describe, expect, it } from 'vitest'
import { applyXiletradeParseEvidence, applyXiletradeParsingRules, parseXiletradeItemText } from '../../electron/xiletradeItemParser'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { ItemTranslationIndex } from '../../electron/itemTranslationIndex'
import { XiletradeDataCatalog, XiletradeModifierMatcher } from '../../electron/xiletradeDataCatalog'

const language = {
  locale: 'zh-CN' as const,
  toEnglish(value: string) {
    return ({ '仇恨 神力': 'Hate Power', '符文宏伟护腕': 'Runed Grand Bracers' } as Record<string, string>)[value]
  },
  statToEnglish() { return undefined },
}

describe('Xiletrade-compatible game item parser', () => {
  it('resolves the real CN sceptre with the vendored Xiletrade FiltersTwo catalog', () => {
    const catalog = new XiletradeDataCatalog(path.join(process.cwd(), 'public', 'data', 'xiletrade'))
    const matcher = new XiletradeModifierMatcher(catalog.bundle('zh-CN'))
    const raw = readFileSync(path.join(process.cwd(), 'docs', 'price-check-fixtures', 'zh-CN', '01-rare-sceptre.txt'), 'utf8')
    const result = parseXiletradeItemText(raw, {
      language: { locale: 'zh-CN', toEnglish: () => 'Translated', statToEnglish: () => undefined },
      canonicalizeStat: (text, group, itemClass, nextLine) => matcher.match(text, group, itemClass, nextLine),
      parsingRules: catalog.get('zh-CN').rules,
      upstreamCommit: catalog.get('zh-CN').upstreamCommit,
    })

    expect(result.unresolved).toEqual([])
    expect(result.evidence.modifiers).toHaveLength(9)
    expect(result.evidence.modifiers.find((modifier) => modifier.original.displayText.includes('攻击速度'))?.queryStatId)
      .toBe('explicit.stat_210067635')
    expect(result.evidence.modifiers.every((modifier) => modifier.status === 'resolved')).toBe(true)
  })

  it('normalizes bracket tags and reduced stats using Xiletrade matching rules', () => {
    const matcher = new XiletradeModifierMatcher({
      display: {
        locale: 'en-US', upstreamCommit: 'test', rules: [],
        entries: [{ id: 'explicit.stat_test', text: '#% increased Test Effect', type: 'explicit' }],
      },
      canonical: {
        locale: 'en-US', upstreamCommit: 'test', rules: [],
        entries: [{ id: 'explicit.stat_test', text: '#% increased Test Effect', type: 'explicit' }],
      },
    })
    const match = matcher.match('10% reduced [Test|Test] Effect', 'explicit')
    expect(match).toMatchObject({ queryStatId: 'explicit.stat_test', canonicalText: '-10% increased Test Effect' })
  })

  it('removes Xiletrade unscalable-value tails before matching the stat catalog', () => {
    const catalog = new XiletradeDataCatalog(path.join(process.cwd(), 'public', 'data', 'xiletrade'))
    const matcher = new XiletradeModifierMatcher(catalog.bundle('zh-CN'))

    expect(matcher.match('后缀效果提高 43 (40-60)% — 数值不可调整', 'explicit')).toMatchObject({
      queryStatId: 'explicit.stat_2475221757',
      canonicalText: '43% increased Effect of Suffixes',
    })
  })

  it('removes granted-skill level-cap annotations before matching the skill stat', () => {
    const catalog = new XiletradeDataCatalog(path.join(process.cwd(), 'public', 'data', 'xiletrade'))
    const matcher = new XiletradeModifierMatcher(catalog.bundle('zh-CN'))

    expect(matcher.match('获得技能: 等级 19 大法师（最高等级 20）', 'explicit')).toMatchObject({
      queryStatId: 'skill.archmage',
      canonicalText: 'Grants Skill: Level 19 Archmage',
    })
  })

  it('uses item and unique context to disambiguate duplicate PoE2 stat IDs', () => {
    const catalog = new XiletradeDataCatalog(path.join(process.cwd(), 'public', 'data', 'xiletrade'))
    const matcher = new XiletradeModifierMatcher(catalog.bundle('en'))

    expect(matcher.match('+112 to Spirit', 'explicit', {
      itemClass: 'Helmet', rarity: 'UNIQUE', name: 'The Unborn Lich', baseType: 'Ravenous Staff',
    })?.queryStatId).toBe('explicit.stat_2704225257')
    expect(matcher.match('+112 to Spirit', 'explicit', {
      itemClass: 'Helmet', rarity: 'RARE', name: 'Hate Power', baseType: 'Runemastered Armoured Cap',
    })?.queryStatId).toBe('explicit.stat_3981240776')
    expect(matcher.match('25% increased Attack Speed', 'explicit', {
      itemClass: 'Quarterstaff', rarity: 'RARE', name: 'Empyrean Cry', baseType: 'Sinister Quarterstaff',
    })?.queryStatId).toBe('explicit.stat_210067635')
  })

  it('derives trade category and flags from the Xiletrade base catalog', () => {
    const catalog = new XiletradeDataCatalog(path.join(process.cwd(), 'public', 'data', 'xiletrade'))
    expect(catalog.resolveItemContext('en', {
      rarity: 'RARE', name: 'Empyrean Cry', baseType: 'Sinister Quarterstaff',
    })).toMatchObject({ tradeCategory: 'weapon.warstaff', flags: { weapon: true, armourPiece: false } })
    expect(catalog.resolveItemContext('en', {
      rarity: 'RARE', name: 'Hate Power', baseType: 'Runemastered Armoured Cap',
    })).toMatchObject({ tradeCategory: 'armour.helmet', flags: { weapon: false, armourPiece: true } })
  })

  it('resolves Traditional Chinese base names from the Xiletrade base catalog', () => {
    const catalog = new XiletradeDataCatalog(path.join(process.cwd(), 'public', 'data', 'xiletrade'))
    expect(catalog.resolveBaseType('zh-TW', '黃金塔盾')).toBe('Goldworked Tower Shield')
    expect(catalog.resolveBaseType('zh-TW', '響聲紋章盾')).toBe('Jingling Crest Shield')
    expect(catalog.resolveBaseType('zh-CN', '響聲紋章盾')).toBe('Jingling Crest Shield')

    const result = parseXiletradeItemText([
      '物品類別: 盾牌', '稀有度: 稀有', '蒼空 守護', '黃金塔盾', '--------',
      '物品等級: 84', '--------', '{ 後綴屬性 }', '火焰抗性 +20%',
    ].join('\n'), {
      language: { locale: 'zh-TW', toEnglish: () => undefined, statToEnglish: () => undefined },
      resolveBaseType: (value) => catalog.resolveBaseType('zh-TW', value),
    })

    expect(result.localized.baseType).toBe('黃金塔盾')
    expect(result.raw).toContain('Goldworked Tower Shield')
  })

  it('recognizes the Traditional Chinese 物品種類 clipboard field and canonicalizes its shield base', () => {
    const catalog = new XiletradeDataCatalog(path.join(process.cwd(), 'public', 'data', 'xiletrade'))
    const matcher = new XiletradeModifierMatcher(catalog.bundle('zh-TW'))
    const translations = new ItemTranslationIndex(path.join(process.cwd(), 'public', 'data', 'Translate', 'zh-rTW'))
    const raw = [
      '物品種類: 盾', '稀有度: 傳奇', '阿杜拉之冠', '響聲紋章盾', '--------',
      '格擋機率: 25%', '護甲值: 106 (augmented)', '能量護盾: 34 (augmented)', '--------',
      '需求: 等級 28, 21 (augmented) 力量, 21 (augmented) 智慧', '--------',
      '物品等級: 67', '--------', '賦予技能: 舉盾', '--------',
      '{ 傳奇詞綴 — 護甲,能量護盾 }', '增加100(60-100)%護甲值和能量護盾',
      '{ 傳奇詞綴 — 魔力 }', '增加39(30-50)%魔力回復率',
      '{ 傳奇詞綴 — 能力 }', '+10(10-20)點智慧',
      '{ 傳奇詞綴 }', '增加50(30-50)%冷卻時間恢復率',
    ].join('\n')
    const result = parseXiletradeItemText(raw, {
      language: {
        locale: 'zh-TW',
        toEnglish: (value) => translations.toEnglish(value),
        statToEnglish: (value) => translations.statToEnglish(value),
      },
      resolveBaseType: (value) => catalog.resolveBaseType('zh-TW', value),
      canonicalizeStat: (text, group, context, nextLine) => matcher.match(text, group, context, nextLine),
      parsingRules: catalog.get('zh-TW').rules,
    })

    expect(result.localized).toEqual({ name: '阿杜拉之冠', baseType: '響聲紋章盾' })
    expect(result.raw).toContain('Jingling Crest Shield')
    expect(result.raw).not.toContain('響聲紋章盾')
  })

  it('ports Xiletrade PoE2 unique-name disambiguation rules', () => {
    const catalog = new XiletradeDataCatalog(path.join(process.cwd(), 'public', 'data', 'xiletrade'))
    const bundle = catalog.bundle('en')
    const matcher = new XiletradeModifierMatcher(bundle)
    const sourceFor = (id: string) => bundle.display.entries.find((entry) => entry.id === id)?.text.replace(/#/g, '10') || ''
    const cases = [
      ['explicit.stat_2704225257', 'The Unborn Lich', 'explicit.stat_2704225257'],
      ['explicit.stat_2704225257', 'Other Item', 'explicit.stat_3981240776'],
      ['explicit.stat_1416406066', 'Grip of Kulemak', 'explicit.stat_1416406066'],
      ['explicit.stat_1416406066', 'Other Item', 'explicit.stat_3984865854'],
      ['explicit.stat_1315418254', "Geofri's Sanctuary", 'explicit.stat_1315418254'],
      ['explicit.stat_1315418254', 'Other Item', 'explicit.stat_3831171903|33'],
      ['explicit.stat_2257118425', "Atziri's Acuity", 'explicit.stat_2257118425'],
      ['explicit.stat_2257118425', 'Other Item', 'explicit.stat_3831171903|20'],
      ['explicit.stat_2933846633', "Nazir's Judgement", 'explicit.stat_2933846633'],
      ['explicit.stat_1157523820', "Hrimnor's Hymn", 'explicit.stat_2045949233'],
      ['explicit.stat_2625554454', 'The Hammer of Faith', 'explicit.stat_2879778895'],
      ['explicit.stat_2582079000', 'Elevore', 'explicit.stat_554899692'],
      ['skill.corpse_cloud_triggered', 'Corpsewade', 'skill.corpse_cloud_triggered'],
      ['explicit.stat_3831171903|7', 'Flesh Crucible', 'explicit.stat_3831171903|7'],
      ['explicit.stat_3831171903|7', 'Other Item', 'explicit.stat_98977150'],
    ] as const
    for (const [sourceId, name, expected] of cases) {
      expect(matcher.match(sourceFor(sourceId), 'explicit', { rarity: 'UNIQUE', name, baseType: 'Diamond' })?.queryStatId)
        .toBe(expected)
    }
  })

  it('parses the CN From Nothing jewel with an empty modifier placeholder', () => {
    const catalog = new XiletradeDataCatalog(path.join(process.cwd(), 'public', 'data', 'xiletrade'))
    const matcher = new XiletradeModifierMatcher(catalog.bundle('zh-CN'))
    const translations = new ItemTranslationIndex(path.join(process.cwd(), 'public', 'data', 'Translate', 'zh-rCN'))
    const raw = [
      '物品类别: 珠宝', '稀有度: 传奇', '无根之源', '宝钻', '--------',
      '仅限: 1', '范围: 小', '--------', '物品等级: 82', '--------',
      '{ 传奇属性 }',
      '异能魔力 ()范围内的天赋可以在',
      '未连结至天赋树的情况下配置 — 数值不可调整',
      '--------', '被腐化',
    ].join('\n')

    const result = parseXiletradeItemText(raw, {
      language: {
        locale: 'zh-CN',
        toEnglish: (value) => translations.toEnglish(value),
        statToEnglish: (value) => translations.statToEnglish(value),
      },
      canonicalizeStat: (text, group, context, nextLine) => matcher.match(text, group, context || {}, nextLine),
      parsingRules: catalog.get('zh-CN').rules,
    })

    expect(result.unresolved).toEqual([])
    expect(result.raw).toContain('From Nothing\nDiamond')
    expect(result.raw).toContain('Radius: Small')
    expect(result.raw).toContain('Passives in Radius of Eldritch Battery can be Allocated')
    expect(result.evidence.modifiers).toMatchObject([{
      queryStatId: 'explicit.stat_2422708892|57513',
      status: 'resolved',
    }])
  })

  it('parses the separator-free CN clipboard format and keeps jewel radius metadata', () => {
    const catalog = new XiletradeDataCatalog(path.join(process.cwd(), 'public', 'data', 'xiletrade'))
    const matcher = new XiletradeModifierMatcher(catalog.bundle('zh-CN'))
    const translations = new ItemTranslationIndex(path.join(process.cwd(), 'public', 'data', 'Translate', 'zh-rCN'))
    const raw = [
      '物品类别: 珠宝', '稀有度: 传奇', '无根之源', '宝钻', '仅限: 1', '范围: 小', '物品等级: 82',
      '{ 传奇属性 }', '异能魔力 ()范围内的天赋可以在', '未连结至天赋树的情况下配置 — 数值不可调整',
      '它们在不曾存在的深渊中挣扎着爬行，', '为一缕意义的光辉而欢欣鼓舞。',
      '放置到一个天赋树的珠宝插槽中以产生效果。右键点击以移出插槽。', '被腐化', '引路石掉落',
    ].join('\n')

    const result = parseXiletradeItemText(raw, {
      language: {
        locale: 'zh-CN',
        toEnglish: (value) => translations.toEnglish(value),
        statToEnglish: (value) => translations.statToEnglish(value),
      },
      canonicalizeStat: (text, group, context, nextLine) => matcher.match(text, group, context || {}, nextLine),
      parsingRules: catalog.get('zh-CN').rules,
    })

    expect(result.unresolved).toEqual([])
    expect(result.localized).toEqual({ name: '无根之源', baseType: '宝钻' })
    expect(result.raw).toContain('Item Level: 82')
    expect(result.raw).toContain('Radius: Small')
    expect(result.raw).toContain('Limited to: 1')
    expect(result.raw).toContain('Passives in Radius of Eldritch Battery can be Allocated')
  })

  it('recognizes the short CN enhance descriptor and resolves an allocated passive enchant', () => {
    const catalog = new XiletradeDataCatalog(path.join(process.cwd(), 'public', 'data', 'xiletrade'))
    const matcher = new XiletradeModifierMatcher(catalog.bundle('zh-CN'))
    const raw = [
      '物品类别: 项链', '稀有度: 稀有', '苍空 安魂符', '失神项链', '--------',
      '物品等级: 80', '--------', '{ 强化 }', '配置 典范 — 数值不可调整',
    ].join('\n')
    const result = parseXiletradeItemText(raw, {
      language: { locale: 'zh-CN', toEnglish: () => 'Translated', statToEnglish: () => undefined },
      canonicalizeStat: (text, group, itemClass, nextLine) => matcher.match(text, group, itemClass, nextLine),
      parsingRules: catalog.get('zh-CN').rules,
    })

    expect(result.evidence.modifiers[0]).toMatchObject({
      group: 'enchant',
      sourceTags: ['enchant'],
      queryStatId: 'enchant.stat_2954116742|20686',
      canonicalText: 'Allocates Paragon',
      status: 'resolved',
    })
  })

  it('cleans spacing artifacts left by tier ranges before exact stat matching', () => {
    const matcher = new XiletradeModifierMatcher({
      display: {
        locale: 'zh-CN', upstreamCommit: 'test', rules: [],
        entries: [{ id: 'explicit.stat_critical', text: '暴击率提高 #%', type: 'explicit' }],
      },
      canonical: {
        locale: 'en-US', upstreamCommit: 'test', rules: [],
        entries: [{ id: 'explicit.stat_critical', text: '#% increased Critical Hit Chance', type: 'explicit' }],
      },
    })

    expect(matcher.match('暴击率提高 14 (10-20)\u3000%', 'explicit')).toMatchObject({
      queryStatId: 'explicit.stat_critical',
      canonicalText: '14% increased Critical Hit Chance',
    })
  })

  it('parses the committed real CN sceptre fixture through the project translation fallback', () => {
    const translations = new ItemTranslationIndex(path.join(process.cwd(), 'public', 'data', 'Translate', 'zh-rCN'))
    const raw = readFileSync(path.join(process.cwd(), 'docs', 'price-check-fixtures', 'zh-CN', '01-rare-sceptre.txt'), 'utf8')
    const result = parseXiletradeItemText(raw, {
      language: {
        locale: 'zh-CN',
        toEnglish: (value) => translations.toEnglish(value),
        statToEnglish: (value) => translations.statToEnglish(value),
      },
    })

    expect(result.unresolved).toEqual([])
    expect(result.evidence.modifiers).toHaveLength(9)
    expect(result.evidence.modifiers.find((modifier) => modifier.original.displayText.includes('攻击速度'))?.sourceTags)
      .toEqual(['fractured', 'crafted'])
    expect(result.raw).toContain('Adds 2 to 334 Lightning Damage')
  })

  it('applies Xiletrade equals and contains rules while carrying numeric placeholders', () => {
    expect(applyXiletradeParsingRules('8% Chance to Block', [{
      replace: 'equals', old: '#% Chance to Block', new: '#% Chance to Block (Shields)',
    }])).toBe('8% Chance to Block (Shields)')
    expect(applyXiletradeParsingRules('Map Bosses drop 2 additional Items', [{
      replace: 'contains', old: 'Map Bosses drop', new: 'Unique Boss drops',
    }])).toBe('Unique Boss drops 2 additional Items')
  })

  it('keeps source, values, tier ranges and official stat IDs as persistent evidence', () => {
    const raw = [
      '物品类别: 手套', '稀有度: 稀有', '仇恨 神力', '符文宏伟护腕', '--------',
      '品质: +20% (augmented)', '闪避值: 759 (augmented)', '符文结界: 76 (augmented)', '--------',
      '需求： 等级 70, 84 (augmented) 敏捷', '--------', '插槽: S J', '--------',
      '物品等级: 83', '--------',
      '{ 前缀属性 "梦魇的" (等阶：2) — 闪避 }', '闪避值提高 90 (80-91)%',
      '{ 打造的 后缀属性 "哈斯特之" (等阶：1) — 元素, 冰霜, 抗性 }', '冰霜抗性 +45 (41-45)%',
    ].join('\n')
    const result = parseXiletradeItemText(raw, {
      language,
      now: () => '2026-08-14T00:00:00.000Z',
      canonicalizeStat(text) {
        if (text === '闪避值提高 90 (80-91)%') return { canonicalText: '90% increased Evasion Rating', queryStatId: 'explicit.stat_evasion' }
        if (text === '冰霜抗性 +45 (41-45)%') return { canonicalText: '+45% to Cold Resistance', queryStatId: 'explicit.stat_cold' }
        return undefined
      },
    })

    expect(result.raw).toContain('Hate Power\nRuned Grand Bracers')
    expect(result.raw).toContain('Sockets: S J')
    expect(result.raw).toContain('Evasion: 759')
    expect(result.raw).toContain('Ward: 76')
    expect(result.evidence).toMatchObject({
      parser: 'xiletrade-compatible',
      upstreamCommit: 'c16c145f30aced5aa667456dd5f6897a2af3af3b',
      locale: 'zh-CN',
    })
    expect(result.evidence.modifiers).toMatchObject([
      { currentValues: [90], tierRanges: [{ min: 80, max: 91 }], queryStatId: 'explicit.stat_evasion', status: 'resolved' },
      { sourceTags: ['crafted'], currentValues: [45], tierRanges: [{ min: 41, max: 45 }], queryStatId: 'explicit.stat_cold', status: 'resolved' },
    ])
  })

  it('recognizes a multi-line affix as one official stat and preserves unresolved lines', () => {
    const raw = [
      '物品类别: 手套', '稀有度: 稀有', '仇恨 神力', '符文宏伟护腕', '--------',
      '物品等级: 83', '--------',
      '{ 亵渎的 前缀属性 "牡鹿的" (等阶：1) — 生命, 闪避 }',
      '闪避值提高 40 (39-42)%', '+44 (42-49) 生命上限', '--------',
      '{ 后缀属性 }', '无法识别的国服词缀 12%',
    ].join('\n')
    const result = parseXiletradeItemText(raw, {
      language,
      canonicalizeStat(text) {
        return text.includes('\n') ? {
          canonicalText: '40% increased Evasion Rating\n+44 to maximum Life',
          queryStatId: 'explicit.stat_hybrid',
        } : undefined
      },
    })

    expect(result.evidence.modifiers[0]).toMatchObject({
      sourceTags: ['desecrated'], queryStatId: 'explicit.stat_hybrid', currentValues: [40, 44],
    })
    expect(result.evidence.modifiers[1]).toMatchObject({
      original: { displayText: '无法识别的国服词缀 12%' }, status: 'unresolved', currentValues: [12],
    })
    expect(result.unresolved).toEqual(['无法识别的国服词缀 12%'])
  })

  it('keeps modifiers that share their final section with a footer marker', () => {
    const raw = [
      '物品类别: 手套', '稀有度: 稀有', '仇恨 神力', '符文宏伟护腕', '--------',
      '物品等级: 83', '--------',
      '{ 后缀属性 }', '冰霜抗性 +45 (41-45)%', '被腐化',
    ].join('\n')
    const result = parseXiletradeItemText(raw, {
      language,
      canonicalizeStat: () => ({ canonicalText: '+45% to Cold Resistance', queryStatId: 'explicit.stat_cold' }),
    })

    expect(result.raw).toContain('+45% to Cold Resistance')
    expect(result.raw).toContain('Corrupted')
    expect(result.evidence.modifiers).toHaveLength(1)
  })

  it('merges resolved stat IDs and localized evidence into the Lua view', () => {
    const parsed = parseXiletradeItemText([
      '物品类别: 手套', '稀有度: 稀有', '仇恨 神力', '符文宏伟护腕', '--------',
      '物品等级: 83', '--------', '{ 后缀属性 }', '冰霜抗性 +45 (41-45)%',
    ].join('\n'), {
      language,
      canonicalizeStat: () => ({ canonicalText: '+45% to Cold Resistance', queryStatId: 'explicit.stat_cold' }),
    })
    const view = {
      rarity: 'RARE', name: 'Hate Power', baseType: 'Runed Grand Bracers',
      modifiers: [{
        id: 'explicit-0', displayOrder: 0, group: 'explicit' as const,
        sourceTags: ['explicit' as const], text: '+45% to Cold Resistance', tradeStatIds: [],
      }],
    }

    applyXiletradeParseEvidence(view, parsed.evidence)

    expect(view.modifiers[0]).toMatchObject({
      tradeStatIds: ['explicit.stat_cold'], tradeValue: 45,
      localized: { 'zh-CN': '冰霜抗性 +45 (41-45)%' },
    })
  })

  it('preserves repeated identical rune modifiers for socketed-item calculation', () => {
    const raw = [
      '物品类别: 法杖', '稀有度: 稀有', '仇恨 神力', '符文宏伟护腕', '--------',
      '物品等级: 83', '--------',
      '附加 3 - 120 闪电伤害 (rune)',
      '附加 3 - 120 闪电伤害 (rune)',
      '附加 3 - 120 闪电伤害 (rune)',
    ].join('\n')
    const result = parseXiletradeItemText(raw, {
      language,
      canonicalizeStat: (text) => text.includes('\n') ? undefined : ({ canonicalText: 'Adds 3 to 120 Lightning Damage', queryStatId: 'rune.stat_lightning' }),
    })

    expect(result.evidence.modifiers).toHaveLength(3)
    expect(result.raw.match(/Adds 3 to 120 Lightning Damage/g)).toHaveLength(3)
  })

  it('keeps an item and its evidence when every modifier is unresolved', () => {
    const result = parseXiletradeItemText([
      '物品类别: 手套', '稀有度: 稀有', '仇恨 神力', '符文宏伟护腕', '--------',
      '物品等级: 83', '--------', '{ 后缀属性 }', '全新未知词缀 12%',
    ].join('\n'), { language })

    expect(result.raw).toContain('Implicits: 0')
    expect(result.unresolved).toEqual(['全新未知词缀 12%'])
    expect(result.evidence.modifiers[0]).toMatchObject({ status: 'unresolved', currentValues: [12] })
  })
})

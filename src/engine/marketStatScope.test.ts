import { describe, expect, it } from 'vitest'
import { buildMarketStatScopeData, marketModSpawnWeight, resolveMarketStatScope, scopeMarketStatCandidates,
  type MarketStatScopeData, type PobScopeMod, type PobScopeSource } from './marketStatScope'
import { loadMarketStatScopes } from '../../electron/marketStatScopeCatalog'
import { XiletradeDataCatalog } from '../../electron/xiletradeDataCatalog'
import { ItemTranslationIndex } from '../../electron/itemTranslationIndex'
import { resolveMarketStatTiers } from './marketStatTiers'
import type { OfficialMarketCandidate } from './marketOfficialSuggestions'

const mod = (keys: string[], weights: number[], hashes: string[], lines = ['test']): PobScopeMod =>
  ({ weightKey: keys, weightVal: weights, hashes, lines })
const row = (id: string): OfficialMarketCandidate => ({ key: id, field: 'stats', value: id, source: 'same', text: 'same', group: id.split('.')[0] })
const context = (type: string, name?: string) => ({ category: '', rarity: '', item: { type, name, unique: Boolean(name) } })

describe('market item to official stat scope', () => {
  it('honours ordered zero exclusions and weight multipliers', () => {
    const base = { tags: { wand: true, no_fire: true, default: true } }
    expect(marketModSpawnWeight(base, mod(['no_fire', 'wand', 'default'], [0, 1, 0], []))).toBe(0)
    expect(marketModSpawnWeight(base, { ...mod(['wand'], [2], []), weightMultiplierKey: ['default'], weightMultiplierVal: [50] })).toBe(1)
  })

  it('joins full IDs, keeps implicit and explicit distinct and never guesses ambiguous text', () => {
    const source: PobScopeSource = {
      bases: { 'Test Amulet': { type: 'Amulet', tags: { amulet: true }, implicit: '+(5-7) to all Attributes' } },
      mods: { ModItem: [mod(['amulet'], [1], ['100'], ['+(10-20) to Life'])] },
      exclusive: [mod([], [], ['200'], ['+(5-7) to all Attributes']), mod([], [], ['300'], ['+(50-100) to all Attributes'])],
      uniques: ['Test Unique\nTest Amulet\nImplicits: 1\n+(5-7) to all Attributes\n+(50-100) to all Attributes\n10% increased mystery'],
    }
    const data = buildMarketStatScopeData(source, [['explicit.stat_400', '#% increased mystery'], ['explicit.stat_401', '#% increased mystery']],
      [(name) => name === 'Test Amulet' ? '测试项链' : name === 'Test Unique' ? '测试暗金' : name])
    expect(data.uniques[0].ids).toEqual(['implicit.stat_200', 'explicit.stat_300'])
    expect(data.uniques[0].complete).toBe(false)
    const scope = resolveMarketStatScope(context('测试项链', '测试暗金'), data)
    expect(scope.kind).toBe('unique')
    const rows = ['implicit.stat_200', 'explicit.stat_200', 'explicit.stat_300', 'explicit.stat_400'].map(row)
    expect(scopeMarketStatCandidates(rows, scope).map((entry) => entry.value)).toEqual(['implicit.stat_200', 'explicit.stat_300'])
    expect(scopeMarketStatCandidates(rows, scope, true)).toEqual(rows)
    expect(rows).toHaveLength(4)
  })

  it('uses category unions and falls back to all for unknown identities', () => {
    const data: MarketStatScopeData = { aliases: [], uniques: [], bases: [
      { name: 'Wand', category: 'weapon.wand', ids: ['explicit.stat_1'], complete: true },
      { name: 'Sceptre', category: 'weapon.sceptre', ids: ['explicit.stat_2'], complete: true },
      { name: 'Belt', category: 'accessory.belt', ids: ['explicit.stat_3'], complete: true },
    ] }
    expect(resolveMarketStatScope({ category: 'weapon.caster', rarity: '' }, data).ids).toEqual(['explicit.stat_1', 'explicit.stat_2'])
    expect(resolveMarketStatScope(context('Unknown'), data).kind).toBe('unknown')
    expect(scopeMarketStatCandidates([row('explicit.stat_3')], resolveMarketStatScope(context('Unknown'), data))).toHaveLength(1)
    expect(resolveMarketStatScope(context('Wand'), data).ids).toEqual(['explicit.stat_1'])
    expect(resolveMarketStatScope({ ...context('Wand'), rarity: 'normal' }, data).ids).toEqual([])
  })

  it('selects current variants and matches multiline properties through their own trade hash descriptions', () => {
    const data = buildMarketStatScopeData({
      bases: { Diamond: { type: 'Jewel', tags: { jewel: true } } },
      mods: {},
      exclusive: [{ ...mod([], [], ['10', '20'], ['first line', 'second line']), descriptions: [['10', ['first line']], ['20', ['second line']]] },
        mod([], [], ['30'], ['(0-150)% increased Effect\ncontaining Magic Jewels'])],
      uniques: ['Current Jewel\nDiamond\nVariant: Pre 0.4.0\nVariant: Current\n{variant:1}Unmatched legacy line\n{variant:2}first line',
        'Multiline Jewel\nDiamond\n(0-150)% increased Effect\ncontaining Magic Jewels'],
    }, [])
    expect(data.uniques[0].ids).toEqual(['explicit.stat_10'])
    expect(data.uniques[0].complete).toBe(true)
    expect(data.uniques[1].ids).toEqual(['explicit.stat_30'])
    expect(data.uniques[1].complete).toBe(true)
  })

  it('associates runic uniques strictly by original base, preserves actual fixed stats and prefers exact records', () => {
    const base = { type: 'Amulet', tags: { amulet: true } }
    const rune = { ...base, tags: { amulet: true, runeforged: true }, implicit: '+(7-9) to Strength' }
    const data = buildMarketStatScopeData({
      bases: { Amber: { ...base, implicit: '+(5-7) to Strength' },
        'Runeforged Amber': rune, 'Runemastered Amber': rune, Other: base },
      baseVariants: { 'Runemastered Amber': [rune, { ...rune, implicit: '+(10-15) to Dexterity' }] },
      mods: { ModItem: [mod(['runeforged', 'amulet'], [1, 0], ['999'])] },
      exclusive: [mod([], [], ['10'], ['+(5-7) to Strength']), mod([], [], ['20'], ['+(7-9) to Strength']),
        mod([], [], ['30'], ['+(10-15) to Dexterity']), mod([], [], ['40'], ['+(50-100) to maximum Life'])],
      uniques: ['Golden\nAmber\nImplicits: 2\n+(5-7) to Strength\nGrants Skill: Level (1-20) Test Skill\n+(50-100) to maximum Life',
        'Exact\nAmber\n+(50-100) to maximum Life', 'Exact\nRuneforged Amber\n+(10-15) to Dexterity'],
    }, [['skill.test', 'Grants Skill: Level # Test Skill']], [(name) => ({
      'Runemastered Amber': '符文师匠琥珀', Golden: '黄金',
    })[name] || name])
    const scope = resolveMarketStatScope(context('符文师匠琥珀', '黄金'), data)
    expect(scope.kind).toBe('unique')
    expect(scope.complete).toBe(true)
    expect(new Set(scope.ids)).toEqual(new Set(['explicit.stat_40', 'skill.test', 'implicit.stat_20', 'implicit.stat_30']))
    expect(scope.ids).not.toContain('explicit.stat_999')
    expect(resolveMarketStatScope(context('Runeforged Amber', 'Golden'), data).ids).toContain('implicit.stat_20')
    expect(resolveMarketStatScope(context('Runeforged Amber', 'Exact'), data).ids).toEqual(['explicit.stat_30'])
    expect(resolveMarketStatScope(context('Other', 'Golden'), data).kind).toBe('unknown')
    expect(resolveMarketStatScope(context('Runemastered Other', 'Golden'), data).kind).toBe('unknown')
    const legacy = resolveMarketStatScope(context('Runemastered Amber', 'Golden'), { ...data,
      bases: data.bases.filter((entry) => entry.name !== 'Runemastered Amber') })
    expect(legacy.kind).toBe('unique')
    expect(legacy.complete).toBe(false)
    expect(legacy.ids).toContain('explicit.stat_40')
    expect(resolveMarketStatScope(context('Runemastered Amber', 'Unknown'), data).kind).toBe('unknown')
    expect(resolveMarketStatScope({ ...context('Runemastered Amber'), rarity: 'unique' }, data).ids).toContain('explicit.stat_40')
    expect(resolveMarketStatScope(context('Runemastered Amber'), data).ids).toContain('explicit.stat_999')
    expect(resolveMarketStatScope({ ...context('Runemastered Amber'), rarity: 'normal' }, data).ids).toEqual(['implicit.stat_20', 'implicit.stat_30'])
  })

  it('resolves the current base of uniques with variant-tagged base lines', () => {
    const data = buildMarketStatScopeData({ bases: {
      Old: { type: 'One Hand Mace', tags: {} }, Current: { type: 'One Hand Mace', tags: {} },
    }, mods: {}, exclusive: [mod([], [], ['10'], ['current property'])],
    uniques: ['Stars\nVariant: Legacy\nVariant: Current\n{variant:1}Old\n{variant:2}Current\n{variant:1}old property\n{variant:2}current property'],
    }, [])
    expect(data.uniques).toEqual([{ name: 'Stars', base: 'Current', category: 'weapon.onemace', ids: ['explicit.stat_10'], complete: true }])
  })

  it('evaluates production PoB data and reproduces the researched base/unique mappings', async () => {
    const catalog = new XiletradeDataCatalog('public/data/xiletrade')
    const descriptors = catalog.get('en-US').entries.map((entry): [string,string] => [entry.id, entry.text])
    const translations = new ItemTranslationIndex('public/data/Translate/zh-rCN')
    const data = await loadMarketStatScopes('public/pob-lua/Data', descriptors, [(name) => translations.toChinese(name) || name])
    const counts: Record<string, number> = { 'Amber Amulet': 32, 'Azure Amulet': 32, 'Rusted Cuirass': 17,
      'Leather Vest': 17, 'Tattered Robe': 17, 'Withered Wand': 17, 'Bone Wand': 17, 'Attuned Wand': 28 }
    for (const [name, count] of Object.entries(counts)) {
      expect(data.bases.find((entry) => entry.name === name)?.ids.filter((id) => id.startsWith('explicit.')), name).toHaveLength(count)
    }
    const life = 'explicit.stat_3299347043'
    const beltContext = { ...context('Heavy Belt'), rarity: 'rare' }
    const beltTiers = resolveMarketStatTiers(beltContext, resolveMarketStatScope(beltContext, data), data, 'explicit.stat_4080418644')
    expect(beltTiers[0]).toMatchObject({ tier: 1, min: 34, max: 36, level: 81 })
    expect(beltTiers[1]).toMatchObject({ tier: 2, min: 31, max: 33, level: 74 })
    const amuletContext = { ...context('Amber Amulet'), rarity: 'rare' }
    expect(resolveMarketStatTiers(amuletContext, resolveMarketStatScope(amuletContext, data), data, 'explicit.stat_4080418644')[0])
      .toMatchObject({ tier: 1, min: 31, max: 33, level: 74 })
    const hunter = resolveMarketStatScope(context('Heavy Belt', 'Headhunter'), data)
    expect(hunter.ids).toHaveLength(6)
    expect(hunter.ids).toContain(life)
    expect(resolveMarketStatScope(context('Crude Bow', 'Widowhail'), data).ids).toEqual(['explicit.stat_1200678966'])
    const astramentis = resolveMarketStatScope(context('Stellar Amulet', 'Astramentis'), data)
    expect(astramentis.ids).toContain('explicit.stat_1379411836')
    expect(astramentis.ids).not.toContain('explicit.stat_2897413282')
    const anvil = resolveMarketStatScope(context('Bloodstone Amulet', 'The Anvil'), data)
    expect(anvil.ids).toContain('explicit.stat_2866361420')
    expect(anvil.ids).not.toContain('explicit.stat_1062208444')
    // Bundled official descriptors are the reproducible baseline.
    const official = new Set(descriptors.map(([id]) => id))
    for (const name of ['Headhunter', 'Widowhail', 'Astramentis', 'The Anvil']) {
      for (const id of data.uniques.find((entry) => entry.name === name)!.ids) expect(official.has(id), `${name}: ${id}`).toBe(true)
    }
    const twister = resolveMarketStatScope(context('符文师匠畸变巨锤', '扭曲天穹'), data)
    expect(twister.kind).toBe('unique')
    expect(twister.complete).toBe(true)
    expect(twister.ids).toContain('skill.starborn_onslaught')
    expect(twister.ids).toContain('implicit.stat_2544540062') // additional Fissure
    expect(twister.ids).toContain('implicit.stat_473429811') // Freeze Buildup
    expect(twister.ids).toContain('explicit.stat_1683568809')
    expect(twister.ids!.filter((id) => id.startsWith('explicit.'))).toHaveLength(7)
    const enItems = (catalog.get('en-US').items || []).flatMap((group) => group.entries)
    const samples = ['Twisted Empyrean', 'Waistgate', 'Blackbraid', "Atziri's Acuity", "Alpha's Howl", 'Seeing Stars',
      'Hand of Wisdom and Action', 'Pillar of the Caged God', 'Matsya']
    for (const name of samples) {
      const items = enItems.filter((item) => item.name === name && /^(Runeforged|Runemastered) /.test(item.type))
      expect(items.length, name).toBeGreaterThan(0)
      for (const item of items) {
        const scope = resolveMarketStatScope(context(item.type, name), data)
        expect(scope.kind, `${name} ${item.type}`).toBe('unique')
        const chineseScope = resolveMarketStatScope(context(translations.toChinese(item.type) || item.type,
          translations.toChinese(name) || name), data)
        expect(chineseScope.ids, `Chinese identity: ${name} ${item.type}`).toEqual(scope.ids)
        const original = resolveMarketStatScope(context(item.type.replace(/^(Runeforged|Runemastered) /, ''), name), data)
        expect(scope.ids!.filter((id) => id.startsWith('explicit.'))).toEqual(original.ids!.filter((id) => id.startsWith('explicit.')))
        for (const locale of ['en-US', 'zh-CN'] as const) {
          const rows = catalog.get(locale).entries.map((entry) => row(entry.id))
          expect(scopeMarketStatCandidates(rows, scope).length, `${locale} ${name}`).toBeGreaterThan(0)
        }
      }
    }
    const runic = enItems.filter((item) => item.name && /^(Runeforged|Runemastered) /.test(item.type))
    const unresolved = runic.filter((item) => resolveMarketStatScope(context(item.type, item.name), data).kind === 'unknown')
    expect(unresolved.length).toBeLessThanOrEqual(6)
  })
})

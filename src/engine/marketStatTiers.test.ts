import { describe, expect, it } from 'vitest'
import { buildMarketStatTiers, marketStatRollRange, resolveMarketStatTiers } from './marketStatTiers'
import { buildMarketStatScopeData, resolveMarketStatScope, type PobScopeMod } from './marketStatScope'

describe('market stat tier range shortcuts', () => {
  it('extracts numeric placeholders, signs, inverse wording and damage averages without treating fixed numbers as rolls', () => {
    expect(marketStatRollRange('+(34-36) to Strength', '+# to Strength')).toEqual({ min: 34, max: 36, average: false, rolls: [{ min: 34, max: 36 }] })
    expect(marketStatRollRange('(10-20)% reduced Attribute Requirements', '#% increased Attribute Requirements')).toEqual({ min: -20, max: -10, average: false, rolls: [{ min: -20, max: -10 }] })
    expect(marketStatRollRange('-(5-10)% to Fire Resistance', '+#% to Fire Resistance')).toEqual({ min: -10, max: -5, average: false, rolls: [{ min: -10, max: -5 }] })
    expect(marketStatRollRange('(-20--10)% to Fire Resistance', '+#% to Fire Resistance')).toEqual({ min: -20, max: -10, average: false, rolls: [{ min: -20, max: -10 }] })
    expect(marketStatRollRange('Adds (2-3) to (4-6) Physical Damage', 'Adds # to # Physical Damage')).toEqual({ min: 3, max: 4.5, average: true, rolls: [{ min: 2, max: 3 }, { min: 4, max: 6 }] })
    expect(marketStatRollRange('Adds 1 to (4-6) Physical Damage', 'Adds # to # Physical Damage')).toEqual({ min: 2.5, max: 3.5, average: true, rolls: [{ min: 1, max: 1 }, { min: 4, max: 6 }] })
    expect(marketStatRollRange('(1-2)% increased Damage per 10 Strength', '#% increased Damage per 10 Strength')).toEqual({ min: 1, max: 2, average: false, rolls: [{ min: 1, max: 2 }] })
    expect(marketStatRollRange('Grants a Special Effect', 'Grants a Special Effect')).toBeUndefined()
    expect(marketStatRollRange('(1-2)% increased Damage per 20 Strength', '#% increased Damage per 10 Strength')).toBeUndefined()
    expect(marketStatRollRange('Adds (1-2) Fire, (3-4) Cold and (5-6) Lightning Damage', 'Adds # Fire, # Cold and # Lightning Damage')).toBeUndefined()
  })

  const mod = (id: string, level: number, text: string, extra: Partial<PobScopeMod> = {}): PobScopeMod => ({
    id, level, type: 'Suffix', group: 'Strength', statOrder: [1], affix: id, hashes: ['1'], lines: [text],
    weightKey: ['belt', 'amulet'], weightVal: [1, 1], descriptions: [['1', [text]]], ...extra,
  })
  const descriptors: Array<[string, string]> = [['explicit.stat_1', '+# to Strength']]
  it('ranks actual spawnable sequences per base and keeps ambiguous category ranges unavailable', () => {
    const data = buildMarketStatScopeData({ bases: {
      Belt: { type: 'Belt', tags: { belt: true } }, Amulet: { type: 'Amulet', tags: { amulet: true } },
    }, mods: { ModItem: [mod('low', 1, '+(5-8) to Strength'), mod('medium', 74, '+(31-33) to Strength'),
      mod('high', 81, '+(34-36) to Strength', { weightKey: ['belt', 'default'], weightVal: [1, 0] })] }, exclusive: [], uniques: [] }, descriptors)
    const tiers = (type: string) => {
      const context = { item: { type }, category: '', rarity: 'rare' }
      return resolveMarketStatTiers(context, resolveMarketStatScope(context, data), data, 'explicit.stat_1')
    }
    expect(tiers('Belt').map(({ tier, min, max, level }) => [tier, min, max, level])).toEqual([[1, 34, 36, 81], [2, 31, 33, 74], [3, 5, 8, 1]])
    expect(tiers('Amulet')[0]).toMatchObject({ tier: 1, min: 31, max: 33, level: 74 })
    const category = { category: 'accessory', rarity: 'rare' }
    expect(resolveMarketStatTiers(category, resolveMarketStatScope(category, data), data, 'explicit.stat_1')).toEqual([])
    const belt = { category: 'accessory.belt', rarity: 'rare' }
    expect(resolveMarketStatTiers(belt, resolveMarketStatScope(belt, data), data, 'explicit.stat_1')).toEqual(tiers('Belt'))
    expect(resolveMarketStatTiers({ ...belt, rarity: 'unique' }, resolveMarketStatScope(belt, data), data, 'explicit.stat_1')).toEqual([])
    expect(resolveMarketStatTiers(belt, resolveMarketStatScope(belt, data), data, 'pseudo.stat_1')).toEqual([])
  })

  it('uses a conservative lower bound when projected two-value tiers overlap', () => {
    const data = buildMarketStatScopeData({ bases: {
      Ring: { type: 'Ring', tags: { ring: true } },
    }, mods: { ModItem: [
      mod('top', 75, 'Adds (1-4) to (60-71) Lightning Damage', { group: 'LightningDamage', weightKey: ['ring'], weightVal: [1] }),
      mod('lower', 65, 'Adds (1-3) to (48-59) Lightning Damage', { group: 'LightningDamage', weightKey: ['ring'], weightVal: [1] }),
    ] }, exclusive: [], uniques: [] }, [['explicit.stat_1', 'Adds # to # Lightning Damage']])
    const context = { item: { type: 'Ring' }, category: '', rarity: 'rare' }
    const tiers = resolveMarketStatTiers(context, resolveMarketStatScope(context, data), data, 'explicit.stat_1')
    expect(tiers[0]).toMatchObject({ min: 30.5, max: 37.5, searchMin: 31.01, searchMax: 37.5 })
    expect(tiers[1]).toMatchObject({ min: 24.5, max: 31, searchMin: 24.5, searchMax: 31 })
  })

  it('keeps hybrid sequences separate and does not renumber after a property fails to map', () => {
    const tiers = buildMarketStatTiers([mod('top', 81, '+(34-36) to Strength'), mod('unmapped', 74, 'unknown line'),
      mod('low', 1, '+(5-8) to Strength'), mod('hybrid', 60, '+(10-20) to Strength', { statOrder: [1, 2], group: 'Hybrid',
        lines: ['+(10-20) to Strength', '(10-15)% increased Armour'] })], new Map(descriptors))
    expect(tiers.map(({ id, tier }) => [id, tier])).toEqual([['top', 1], ['low', 3], ['hybrid', 1]])
    expect(tiers[0].series).not.toBe(tiers[2].series)
    expect(buildMarketStatTiers([mod('a', 1, '+(5-8) to Strength'), mod('b', 1, '+(9-10) to Strength')], new Map(descriptors))).toEqual([])
  })
})

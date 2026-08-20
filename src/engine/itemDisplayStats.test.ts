import { describe, expect, it } from 'vitest'
import { deriveItemDisplayRequirements, deriveItemDisplayStats, deriveWeaponComparisonStats, deriveWeaponComparisonStatsFromRaw } from './itemDisplayStats'
import type { EquipmentItem } from '@/types/equipment'

describe('deriveItemDisplayStats', () => {
  it('reproduces the visible weapon properties from base data and local modifiers', () => {
    const lines = [
      '25% increased Attack Speed',
      'Adds 147 to 220 Fire Damage',
      '136% increased Elemental Damage with Attacks',
      '+4.79% to Critical Hit Chance',
      'Adds 2 to 334 Lightning Damage',
      '+3 to Level of all Attack Skills',
    ]
    const item: EquipmentItem = {
      id: '12', rarity: 'RARE', name: 'Empyrean Cry', baseType: 'Sinister Quarterstaff',
      quality: '+20%', socketCount: 3, runes: [], lines,
      modifiers: lines.map((text) => ({ text, tags: [], group: 'explicit' })), raw: '',
    }
    const base = {
      weapon: { PhysicalMin: 55, PhysicalMax: 91, CritChanceBase: 12, AttackRateBase: 1.4, Range: 14 },
      requirements: { level: 67, dex: 104, int: 41 },
    }
    const stats = deriveItemDisplayStats(item, base)

    expect(stats).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'quality', value: '+20%', augmented: true }),
      expect.objectContaining({ key: 'physicalDamage', value: '66-109' }),
      expect.objectContaining({
        key: 'elementalDamage',
        value: '147-220, 2-334',
        segments: [
          { value: '147-220', tone: 'fire' },
          { value: '2-334', tone: 'lightning' },
        ],
      }),
      expect.objectContaining({ key: 'criticalHitChance', value: '16.79%' }),
      expect.objectContaining({ key: 'attacksPerSecond', value: '1.75' }),
    ]))
    expect(stats.some((stat) => stat.key === 'weaponRange')).toBe(false)
    expect(deriveItemDisplayRequirements(item, base)).toEqual({ dex: 96, int: 38 })
    expect(deriveWeaponComparisonStats(item, base)).toEqual([
      { key: 'APS', value: '1.75' },
      { key: 'DPS', value: '768.3' },
      { key: 'pDPS', value: '153.1' },
      { key: 'eDPS', value: '615.1' },
    ])
  })

  it('only derives comparison stats for combat weapons and omits absent damage types', () => {
    const item: EquipmentItem = {
      id: '11', rarity: 'NORMAL', name: 'Dull Hatchet', baseType: 'Dull Hatchet',
      socketCount: 0, runes: [], lines: [], raw: '',
    }

    expect(deriveWeaponComparisonStats(item, {
      type: 'One Hand Axe',
      weapon: { PhysicalMin: 4, PhysicalMax: 10, AttackRateBase: 1.5 },
    })).toEqual([
      { key: 'APS', value: '1.50' },
      { key: 'DPS', value: '10.5' },
      { key: 'pDPS', value: '10.5' },
    ])
    expect(deriveWeaponComparisonStats(item, {
      type: 'Fishing Rod',
      weapon: { PhysicalMin: 8, PhysicalMax: 12, AttackRateBase: 1.2 },
    })).toEqual([])
    expect(deriveWeaponComparisonStats(item, { type: 'Wand' })).toEqual([])
  })

  it('does not include chaos damage in elemental DPS', () => {
    const lines = ['Adds 10 to 20 Chaos Damage', 'Adds 5 to 15 Cold Damage']
    const item: EquipmentItem = {
      id: '12', rarity: 'RARE', name: 'Test Weapon', baseType: 'Test Weapon',
      socketCount: 0, runes: [], lines,
      modifiers: lines.map((text) => ({ text, tags: [], group: 'explicit' })), raw: '',
    }

    expect(deriveWeaponComparisonStats(item, {
      type: 'One Hand Sword',
      weapon: { AttackRateBase: 2 },
    })).toEqual([
      { key: 'APS', value: '2' },
      { key: 'DPS', value: '50.0' },
      { key: 'eDPS', value: '20.0' },
    ])
    expect(deriveItemDisplayStats(item, {
      type: 'One Hand Sword',
      weapon: { AttackRateBase: 2 },
    })).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'elementalDamage', value: '5-15' }),
      expect.objectContaining({ key: 'chaosDamage', value: '10-20' }),
    ]))
  })

  it('derives library weapon metrics from standalone PoB item text', () => {
    const raw = [
      'Rarity: RARE',
      'Storm Edge',
      'Dull Hatchet',
      'Quality: +20%',
      'Adds 10 to 20 Fire Damage',
      '25% increased Attack Speed',
    ].join('\n')

    expect(deriveWeaponComparisonStatsFromRaw(raw, {
      'Dull Hatchet': {
        type: 'One Hand Axe',
        weapon: { PhysicalMin: 4, PhysicalMax: 10, AttackRateBase: 1.5 },
      },
    })).toEqual([
      { key: 'APS', value: '1.88' },
      { key: 'DPS', value: '44.1' },
      { key: 'pDPS', value: '15.9' },
      { key: 'eDPS', value: '28.1' },
    ])
  })

  it('reproduces runeforged glove defences and quality-adjusted requirements', () => {
    const lines = [
      '+166 to Evasion Rating',
      '90% increased Evasion Rating',
      '40% increased Evasion Rating',
      '+44 to maximum Life',
    ]
    const item: EquipmentItem = {
      id: '5', rarity: 'RARE', name: 'Hate Hold', baseType: 'Runeforged Grand Bracers',
      quality: '+20%', socketCount: 2, runes: [], lines,
      modifiers: lines.map((text) => ({ text, tags: [], group: 'explicit' })), raw: '',
    }
    const base = {
      armour: { Evasion: 109, Ward: 63 },
      requirements: { level: 70, dex: 87 },
    }

    expect(deriveItemDisplayStats(item, base)).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'evasion', value: '759', augmented: true }),
      expect.objectContaining({ key: 'runicWard', value: '76', augmented: true }),
    ]))
    expect(deriveItemDisplayRequirements(item, base)).toEqual({ dex: 80 })
  })

  it('applies combined local defence modifiers to every named defence', () => {
    const lines = ['136% increased Armour and Energy Shield']
    const item: EquipmentItem = {
      id: '10', rarity: 'UNIQUE', name: 'Reverie', baseType: 'Shaman Mantle',
      quality: '+20%', socketCount: 0, runes: [], lines,
      modifiers: lines.map((text) => ({ text, tags: [], group: 'explicit' })), raw: '',
    }

    const stats = deriveItemDisplayStats(item, {
      armour: { Armour: 129, EnergyShield: 41 },
    })

    expect(stats).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'armour', value: '365', augmented: true }),
      expect.objectContaining({ key: 'energyShield', value: '116', augmented: true }),
    ]))
  })
})

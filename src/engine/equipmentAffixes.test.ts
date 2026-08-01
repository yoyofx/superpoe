import { describe, expect, it } from 'vitest'
import { aggregateEquipmentAffixes, categorizeEquipmentAffix } from '@/engine/equipmentAffixes'
import type { EquipmentItem, EquipmentSlot } from '@/types/equipment'

function item(id: string, name: string, lines: string[]): EquipmentItem {
  return { id, name, baseType: name, rarity: 'RARE', socketCount: 0, runes: [], lines, raw: '' }
}

describe('equipment affix aggregation', () => {
  it('sums matching values and ranges while preserving their scope', () => {
    const items = {
      a: item('a', 'Ring A', ['+32 to maximum Life', 'Fire Resistance is +20%', 'Adds 7 to 14 Physical Damage to Attacks', '+2 to Level of all Spell Skills']),
      b: item('b', 'Ring B', ['+68 to maximum Life', '+13% to all Elemental Resistances', 'Adds 3 to 6 Physical Damage to Attacks', '+1 to Level of all Spell Skills']),
    }
    const slots: EquipmentSlot[] = [
      { name: 'Ring 1', itemId: 'a', active: true },
      { name: 'Ring 2', itemId: 'b', active: true },
    ]

    const result = aggregateEquipmentAffixes(slots, items)
    expect(result.find((entry) => entry.text === '+100 to maximum Life')?.sources).toHaveLength(2)
    expect(result.find((entry) => entry.text === 'Adds 10 to 20 Physical Damage to Attacks')?.sources).toHaveLength(2)
    expect(result.find((entry) => entry.text === '+3 to Level of all Spell Skills')?.sources).toHaveLength(2)
    expect(result.some((entry) => entry.text === 'Fire Resistance is +20%')).toBe(true)
    expect(result.some((entry) => entry.text === '+13% to all Elemental Resistances')).toBe(true)
  })

  it('tracks rune sources and leaves conditional text unchanged', () => {
    const items = {
      body: item('body', 'Body Armour', ['{enchant}{rune}+20 to maximum Life', 'When you kill a Rare monster, you gain its Modifiers for 60 seconds', 'Corrupted']),
    }
    const result = aggregateEquipmentAffixes([{ name: 'Body Armour', itemId: 'body', active: true }], items)
    expect(result.find((entry) => entry.text === '+20 to maximum Life')?.sources[0].rune).toBe(true)
    expect(result.some((entry) => entry.text.includes('60 seconds'))).toBe(true)
    expect(result.find((entry) => entry.text === 'Corrupted')?.category).toBe('special')
  })

  it('categorizes common offensive equipment modifiers', () => {
    expect(categorizeEquipmentAffix('Adds 7 to 14 Physical Damage to Attacks')).toBe('addedDamage')
    expect(categorizeEquipmentAffix('+3 to Level of all Spell Skills')).toBe('skillLevels')
    expect(categorizeEquipmentAffix('Grants Skill: Level 14 Sigil of Power')).toBe('special')
    expect(categorizeEquipmentAffix('23% increased Cast Speed')).toBe('offence')
    expect(categorizeEquipmentAffix('30% reduced Attribute Requirements')).toBe('utility')
    expect(categorizeEquipmentAffix('36% increased Armour, Evasion and Energy Shield')).toBe('defences')
    expect(categorizeEquipmentAffix('Also grants 107 Guard')).toBe('defences')
    expect(categorizeEquipmentAffix('29% increased Stun Threshold')).toBe('defences')
    expect(categorizeEquipmentAffix('增加 29% 晕眩阈值')).toBe('defences')
    expect(categorizeEquipmentAffix('29% reduced Enemy Stun Threshold')).toBe('special')
  })

  it('keeps flask and charm modifiers separate from matching gear modifiers', () => {
    const items = {
      flask: item('flask', 'Life Flask', ['+20 to maximum Life']),
      charm: item('charm', 'Charm', ['+10 to maximum Life']),
      ring: item('ring', 'Ring', ['+30 to maximum Life']),
    }
    const result = aggregateEquipmentAffixes([
      { name: 'Flask 1', itemId: 'flask', active: true },
      { name: 'Charm 1', itemId: 'charm', active: true },
      { name: 'Ring 1', itemId: 'ring', active: true },
    ], items)
    expect(result.map((entry) => entry.text)).toEqual(['+20 to maximum Life', '+10 to maximum Life', '+30 to maximum Life'])
  })
})

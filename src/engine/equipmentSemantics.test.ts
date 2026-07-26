import { describe, expect, it } from 'vitest'
import { aggregateEquipmentSemantics } from '@/engine/equipmentSemantics'
import type { EquipmentItem, EquipmentSlot } from '@/types/equipment'
import type { EquipmentItemSemantics, EquipmentSemanticModifier } from '@/types/equipmentSemantics'

function item(id: string, name: string): EquipmentItem {
  return { id, name, baseType: name, rarity: 'RARE', socketCount: 0, runes: [], lines: [], raw: name }
}

function modifier(overrides: Partial<EquipmentSemanticModifier>): EquipmentSemanticModifier {
  return {
    name: 'Life',
    type: 'BASE',
    value: 0,
    flags: [],
    keywordFlags: [],
    tags: [],
    scope: 'global',
    line: '',
    group: 'explicit',
    ...overrides,
  }
}

function semantics(text: string, mods: EquipmentSemanticModifier[]): EquipmentItemSemantics {
  return { lines: [{ text, group: 'explicit', parsed: true, modifiers: mods }] }
}

describe('equipment semantic aggregation', () => {
  const slots: EquipmentSlot[] = [
    { name: 'Ring 1', itemId: 'a', active: true },
    { name: 'Ring 2', itemId: 'b', active: true },
  ]
  const items = { a: item('a', 'Ring A'), b: item('b', 'Ring B') }

  it('aggregates matching global defence modifiers by semantic identity', () => {
    const result = aggregateEquipmentSemantics(slots, items, {
      a: semantics('+30 to maximum Life', [modifier({ value: 30, line: '+30 to maximum Life' })]),
      b: semantics('+40 to maximum Life', [modifier({ value: 40, line: '+40 to maximum Life' })]),
    }, 'defence')

    expect(result).toHaveLength(1)
    expect(result[0].text).toBe('+70 to maximum Life')
    expect(result[0].sources).toHaveLength(2)
  })

  it('keeps attack and spell scopes separate', () => {
    const result = aggregateEquipmentSemantics(slots, items, {
      a: semantics('20% increased Attack Damage', [modifier({ name: 'Damage', type: 'INC', value: 20, flags: ['Attack'] })]),
      b: semantics('20% increased Spell Damage', [modifier({ name: 'Damage', type: 'INC', value: 20, flags: ['Spell'] })]),
    }, 'offence')

    expect(result).toHaveLength(2)
  })

  it('excludes local item modifiers from equipment contribution views', () => {
    const result = aggregateEquipmentSemantics(slots.slice(0, 1), items, {
      a: semantics('25% increased Attack Speed', [modifier({ name: 'Speed', type: 'INC', value: 25, flags: ['Attack'], scope: 'local' })]),
    }, 'offence')

    expect(result).toEqual([])
  })
})

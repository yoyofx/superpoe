import { describe, expect, it } from 'vitest'
import { resolveRuneVariant, type RuneDetail } from '@/engine/runeDetails'
import type { EquipmentItem } from '@/types/equipment'

const item: EquipmentItem = {
  id: '1',
  rarity: 'RARE',
  name: 'Test Item',
  baseType: 'Test Base',
  socketCount: 1,
  runes: ['Test Rune'],
  lines: [],
  raw: '',
}

const detail: RuneDetail = {
  name: 'Test Rune',
  variants: {
    weapon: { type: 'Rune', stats: ['Weapon stat'] },
    boots: { type: 'Rune', stats: ['Boot stat'] },
    armour: { type: 'Rune', stats: ['Armour stat'] },
  },
}

describe('rune details', () => {
  it('uses the modifier variant matching the equipped slot', () => {
    expect(resolveRuneVariant(detail, item, 'Weapon 1')).toEqual({
      category: 'weapon',
      variant: detail.variants.weapon,
    })
    expect(resolveRuneVariant(detail, item, 'Boots')).toEqual({
      category: 'boots',
      variant: detail.variants.boots,
    })
    expect(resolveRuneVariant(detail, item, 'Helmet')).toEqual({
      category: 'armour',
      variant: detail.variants.armour,
    })
  })
})

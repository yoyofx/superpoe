import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { normalizeItemIconIndex, resolveItemIcon, resolveItemIconName } from '@/engine/itemIcons'
import type { EquipmentItem } from '@/types/equipment'

const index = {
  lookup: {
    legionstride: '/assets/items/Legionstride.webp',
    roughgreaves: '/assets/items/RoughGreaves.webp',
  },
}

function item(overrides: Partial<EquipmentItem>): EquipmentItem {
  return { id: '1', rarity: 'RARE', name: 'Rare Item', baseType: 'Rough Greaves', socketCount: 0, runes: [], lines: [], raw: '', ...overrides }
}

describe('item icon resolver', () => {
  it('rejects malformed indexes and filters invalid paths', () => {
    expect(normalizeItemIconIndex({ entries: {} })).toBeNull()
    expect(normalizeItemIconIndex({ lookup: { valid: '/valid.webp', invalid: 7 } })).toEqual({
      lookup: { valid: '/valid.webp' },
    })
  })

  it('uses a supplied exact image before the local fallback index', () => {
    expect(resolveItemIcon(item({ imageUrl: 'https://cdn.example/item.png' }), index)).toBe('https://cdn.example/item.png')
  })

  it('uses a unique item name before its base type', () => {
    expect(resolveItemIcon(item({ rarity: 'UNIQUE', name: 'Legionstride' }), index)).toBe('/assets/items/Legionstride.webp')
  })

  it('uses the base type for normal and rare equipment', () => {
    expect(resolveItemIcon(item({ name: 'Dread Track', baseType: 'Rough Greaves' }), index)).toBe('/assets/items/RoughGreaves.webp')
  })

  it('finds a flask base inside an affixed magic item name', () => {
    const flaskIndex = {
      lookup: {
        ultimatelifeflask: '/assets/items/UltimateLifeFlask.webp',
        ultimatemanaflask: '/assets/items/UltimateManaFlask.webp',
      },
    }
    expect(resolveItemIcon(item({
      rarity: 'MAGIC',
      name: 'Sapping Ultimate Life Flask of the Brewer',
      baseType: 'Sapping Ultimate Life Flask of the Brewer',
    }), flaskIndex)).toBe('/assets/items/UltimateLifeFlask.webp')
  })

  it('keeps every alias when several PoE2DB catalogues share an icon', () => {
    const generatedIndex = JSON.parse(readFileSync('public/data/item-icons.json', 'utf8'))
    const bases = ['Drakeskin Boots', 'Soaring Spear', 'Sinister Quarterstaff']

    for (const baseType of bases) {
      const path = resolveItemIcon(item({ name: 'Rare Item', baseType }), generatedIndex)
      expect(path, baseType).toMatch(/^\/assets\/items\/poe2db\//)
      expect(existsSync(`public${path}`), baseType).toBe(true)
    }
  })

  it('resolves equipment-granted skills used as socket contents', () => {
    const generatedIndex = JSON.parse(readFileSync('public/data/item-icons.json', 'utf8'))
    const path = resolveItemIconName('Spear Throw', generatedIndex)

    expect(path).toMatch(/^\/assets\/items\/poe2db\/.*\/SkillIcons\//i)
    expect(existsSync(`public${path}`)).toBe(true)
  })
})

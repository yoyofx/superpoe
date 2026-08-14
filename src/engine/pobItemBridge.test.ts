import { describe, expect, it } from 'vitest'
import { canonicalToLegacySnapshot, normalizePobItemForLua, PobItemBridge, type NormalizedPobItem } from '../../electron/pobItemBridge'
import { XiletradeDataCatalog } from '../../electron/xiletradeDataCatalog'
import path from 'node:path'
import type { PobLuaService } from '../../electron/pobLuaService'

function normalized(text: string): NormalizedPobItem {
  return {
    item: { format: 'pob2-item', raw: text },
    view: {
      rarity: 'UNIQUE',
      name: 'Runeseeker\'s Call',
      baseType: 'Runic Fork',
      modifiers: [{
        id: 'implicit-0',
        displayOrder: 0,
        group: 'implicit',
        sourceTags: ['implicit'],
        text,
        tradeStatIds: ['skill.the_stars_answer'],
      }],
    },
  }
}

describe('PoB item trade snapshot conversion', () => {
  it('projects Lua-normalized PoB modifiers through Xiletrade', async () => {
    const lua = {
      normalizeItem: async () => ({
        success: true,
        item: { format: 'pob2-item' as const, raw: 'Rarity: RARE\nEmpyrean Cry\nSinister Quarterstaff' },
        view: {
          rarity: 'RARE', name: 'Empyrean Cry', baseType: 'Sinister Quarterstaff', itemClass: 'Quarterstaff',
          modifiers: [{
            id: 'explicit-0', displayOrder: 0, group: 'explicit' as const, sourceTags: [],
            text: '25% increased Attack Speed', tradeStatIds: [],
          }],
        },
      }),
    } as unknown as PobLuaService
    const catalog = new XiletradeDataCatalog(path.join(process.cwd(), 'public', 'data', 'xiletrade'))
    const result = await new PobItemBridge(lua, catalog).normalize('Rarity: RARE\nEmpyrean Cry\nSinister Quarterstaff')

    expect(result.view).toMatchObject({ itemClass: 'Quarterstaff', tradeCategory: 'weapon.warstaff' })
    expect(result.view.modifiers[0]).toMatchObject({ tradeStatIds: ['explicit.stat_210067635'], tradeValue: 25 })
    expect(result.item.tradeDataVersion).toMatch(/^xiletrade:/)
  })

  it('normalizes legacy item wording before Lua parsing', () => {
    const raw = [
      'Rarity: MAGIC',
      'Arcane',
      'Diamond',
      'Implicits: 0',
      'Cold Resistance is +10%',
      '16% increased Critical Strike Chance for Spells',
    ].join('\n')

    expect(normalizePobItemForLua(raw)).toContain('+10% to Cold Resistance')
    expect(normalizePobItemForLua(raw)).toContain('16% increased Critical Hit Chance for Spells')
    expect(normalizePobItemForLua(raw)).not.toContain('Critical Strike Chance for Spells')
  })

  it('infers granted skill levels as numeric price-check values', () => {
    const snapshot = canonicalToLegacySnapshot(normalized('Grants Skill: Level 19 The Stars Answer'), undefined, 'cn')
    expect(snapshot.modifiers[0]).toMatchObject({
      valueMode: 'numeric',
      currentValues: [19],
    })
    expect(snapshot.modifiers[0].tradeResolutions[0].valueMode).toBe('numeric')
  })

  it('keeps granted skills without a level as presence-only values', () => {
    const snapshot = canonicalToLegacySnapshot(normalized('Grants Skill: Raise Shield'), undefined, 'cn')
    expect(snapshot.modifiers[0]).toMatchObject({ valueMode: 'presence', currentValues: [] })
  })
})

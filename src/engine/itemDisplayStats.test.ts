import { describe, expect, it } from 'vitest'
import { deriveItemDisplayStats } from './itemDisplayStats'
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
    const stats = deriveItemDisplayStats(item, {
      weapon: { PhysicalMin: 55, PhysicalMax: 91, CritChanceBase: 12, AttackRateBase: 1.4, Range: 14 },
    })

    expect(stats).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'physicalDamage', value: '66-109' }),
      expect.objectContaining({ key: 'fireDamage', value: '147-220' }),
      expect.objectContaining({ key: 'lightningDamage', value: '2-334' }),
      expect.objectContaining({ key: 'criticalHitChance', value: '16.79%' }),
      expect.objectContaining({ key: 'attacksPerSecond', value: '1.75' }),
    ]))
  })
})

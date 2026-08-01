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
    recipient: 'player',
    line: '',
    group: 'explicit',
    ...overrides,
  }
}

function semantics(text: string, mods: EquipmentSemanticModifier[]): EquipmentItemSemantics {
  return { isWeapon: false, isArmour: false, lines: [{ text, group: 'explicit', parsed: true, modifiers: mods }] }
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
    expect(result[0].semanticGroup).toBeUndefined()
    expect(result[0].category).toBe('resources')
    expect(result[0].sources).toHaveLength(2)
  })

  it('keeps attack and spell scopes separate', () => {
    const result = aggregateEquipmentSemantics(slots, items, {
      a: semantics('20% increased Attack Damage', [modifier({ name: 'Damage', type: 'INC', value: 20, flags: ['Attack'] })]),
      b: semantics('20% increased Spell Damage', [modifier({ name: 'Damage', type: 'INC', value: 20, flags: ['Spell'] })]),
    }, 'offence')

    expect(result).toHaveLength(2)
  })

  it('keeps flat and increased Runic Ward values separate', () => {
    const result = aggregateEquipmentSemantics(slots, items, {
      a: semantics('+985 to maximum Runic Ward', [modifier({ name: 'Ward', type: 'BASE', value: 985 })]),
      b: semantics('10% increased maximum Runic Ward', [modifier({ name: 'Ward', type: 'INC', value: 10 })]),
    }, 'defence')

    expect(result).toHaveLength(2)
    expect(result.map((entry) => entry.text)).toEqual(expect.arrayContaining([
      '+985 to maximum Runic Ward',
      '10% increased maximum Runic Ward',
    ]))
  })

  it('classifies physical and critical-hit damage reduction as defence', () => {
    const semanticByItem = {
      a: semantics('15% additional Physical Damage Reduction', [
        modifier({ name: 'PhysicalDamageReduction', type: 'BASE', value: 15 }),
      ]),
      b: semantics('Take no Extra Damage from Critical Hits', [
        modifier({ name: 'ReduceCritExtraDamage', type: 'BASE', value: 100 }),
      ]),
    }

    const defence = aggregateEquipmentSemantics(slots, items, semanticByItem, 'defence')
    const offence = aggregateEquipmentSemantics(slots, items, semanticByItem, 'offence')

    expect(defence).toHaveLength(2)
    expect(defence.map((entry) => entry.text)).toEqual(expect.arrayContaining([
      '15% additional Physical Damage Reduction',
      'Take no Extra Damage from Critical Hits',
    ]))
    expect(offence).toEqual([])
  })

  it('fills in defensive resistance lines that Lua cannot parse', () => {
    const resistanceItems = {
      a: item('a', 'Ring A'),
      b: item('b', 'Ring B'),
    }
    resistanceItems.a.lines = ['Fire Resistance is +21%', 'Cold Resistance is +39%', '10% increased Movement Speed when on Low Life']
    resistanceItems.b.lines = ['Lightning Resistance is +45%', '+23% to Chaos Resistance', 'Enemies have -10% to Fire Resistance']
    const result = aggregateEquipmentSemantics(slots, resistanceItems, {
      a: semantics('Fire Resistance is +21%', []),
      b: semantics('Lightning Resistance is +45%', []),
    }, 'defence')

    expect(result.map((entry) => entry.text)).toEqual(expect.arrayContaining([
      'Fire Resistance is +21%',
      'Cold Resistance is +39%',
      'Lightning Resistance is +45%',
      '+23% to Chaos Resistance',
    ]))
    expect(result.every((entry) => entry.category === 'resistances')).toBe(true)
    expect(result.some((entry) => /Movement Speed|Enemies/.test(entry.text))).toBe(false)
  })

  it('keeps resistance effects applied to enemies in offence', () => {
    const semanticByItem = {
      a: semantics('Enemies in your Presence Resist Elemental Damage based on their Lowest Resistance', [
        modifier({ name: 'ElementalResist', value: 0 }),
      ]),
    }

    const defence = aggregateEquipmentSemantics(slots.slice(0, 1), items, semanticByItem, 'defence')
    const offence = aggregateEquipmentSemantics(slots.slice(0, 1), items, semanticByItem, 'offence')

    expect(defence).toEqual([])
    expect(offence).toEqual([expect.objectContaining({ semanticGroup: 'accuracyPenetration' })])
  })

  it('shows local offensive modifiers', () => {
    const result = aggregateEquipmentSemantics(slots.slice(0, 1), items, {
      a: semantics('25% increased Attack Speed', [modifier({ name: 'Speed', type: 'INC', value: 25, flags: ['Attack'], scope: 'local' })]),
    }, 'offence')

    expect(result).toEqual([expect.objectContaining({ text: '25% increased Attack Speed' })])
  })

  it('aggregates local damage from different equipped weapons in the summary view', () => {
    const weaponSlots: EquipmentSlot[] = [
      { name: 'Weapon 1', itemId: 'a', active: true },
      { name: 'Weapon 2', itemId: 'b', active: true },
    ]
    const result = aggregateEquipmentSemantics(weaponSlots, items, {
      a: { ...semantics('Adds 10 to 20 Fire Damage', [
          modifier({ name: 'FireMin', value: 10, scope: 'local' }),
          modifier({ name: 'FireMax', value: 20, scope: 'local' }),
        ]), isWeapon: true },
      b: { ...semantics('Adds 10 to 20 Fire Damage', [
          modifier({ name: 'FireMin', value: 10, scope: 'local' }),
          modifier({ name: 'FireMax', value: 20, scope: 'local' }),
        ]), isWeapon: true },
    }, 'offence')

    expect(result).toHaveLength(1)
    expect(result[0].text).toBe('Adds 20 to 40 Fire Damage to Attacks')
    expect(result[0].sources).toHaveLength(2)
  })

  it('aggregates global modifiers from non-weapon items even if Lua locality matching is inconclusive', () => {
    const result = aggregateEquipmentSemantics(slots, items, {
      a: semantics('10% increased Attack Speed', [modifier({ name: 'Speed', type: 'INC', value: 10, flags: ['Attack'], scope: 'local' })]),
      b: semantics('6% increased Attack Speed', [modifier({ name: 'Speed', type: 'INC', value: 6, flags: ['Attack'], scope: 'global' })]),
    }, 'offence')

    expect(result).toHaveLength(1)
    expect(result[0].text).toBe('16% increased Attack Speed')
  })

  it('combines global attack damage from a ring with local weapon damage', () => {
    const result = aggregateEquipmentSemantics(slots, items, {
      a: { ...semantics('Adds 2 to 334 Lightning Damage', [
          modifier({ name: 'LightningMin', value: 2, scope: 'local' }),
          modifier({ name: 'LightningMax', value: 334, scope: 'local' }),
        ]), isWeapon: true },
      b: semantics('Adds 2 to 73 Lightning Damage to Attacks', [
        modifier({ name: 'LightningMin', value: 2, keywordFlags: ['Attack'] }),
        modifier({ name: 'LightningMax', value: 73, keywordFlags: ['Attack'] }),
      ]),
    }, 'offence')

    expect(result).toHaveLength(1)
    expect(result[0]).toEqual(expect.objectContaining({
      semanticGroup: 'flatDamage',
      text: 'Adds 4 to 407 Lightning Damage to Attacks',
    }))
    expect(result[0].sources).toHaveLength(2)
  })

  it('classifies skill speed as speed rather than skill levels', () => {
    const result = aggregateEquipmentSemantics(slots.slice(0, 1), items, {
      a: semantics('8% increased Skill Speed', [modifier({ name: 'SkillSpeed', type: 'INC', value: 8 })]),
    }, 'offence')

    expect(result).toEqual([expect.objectContaining({ semanticGroup: 'speed' })])
  })

  it('aggregates attack speed when equivalent scope is stored in flags or keyword flags', () => {
    const result = aggregateEquipmentSemantics(slots, items, {
      a: semantics('44% increased Attack Speed', [modifier({ name: 'Speed', type: 'INC', value: 44, flags: ['Attack'] })]),
      b: semantics('10% increased Attack Speed', [modifier({ name: 'Speed', type: 'INC', value: 10, keywordFlags: ['Attack'] })]),
    }, 'offence')

    expect(result).toHaveLength(1)
    expect(result[0]).toEqual(expect.objectContaining({
      semanticGroup: 'speed',
      text: '54% increased Attack Speed',
    }))
    expect(result[0].sources).toHaveLength(2)
  })

  it('groups gain-as-extra lines even when PoB uses elemental damage modifier names', () => {
    const result = aggregateEquipmentSemantics(slots.slice(0, 1), items, {
      a: semantics('Gain 5% of Damage as Extra Damage of all Elements', [
        modifier({ name: 'PhysicalDamageGainAsElemental', value: 5 }),
      ]),
    }, 'offence')

    expect(result).toEqual([expect.objectContaining({ semanticGroup: 'gain' })])
  })

  it('uses the Lua MORE type to place more and less damage in its own group', () => {
    const result = aggregateEquipmentSemantics(slots.slice(0, 1), items, {
      a: semantics('20% more Attack Damage', [modifier({ name: 'Damage', type: 'MORE', value: 20, flags: ['Attack'] })]),
    }, 'offence')

    expect(result).toEqual([expect.objectContaining({ semanticGroup: 'moreLess' })])
  })

  it('separates granted equipment skills from skill level bonuses', () => {
    const result = aggregateEquipmentSemantics(slots, items, {
      a: semantics('Grants Skill: Level 18 Impurity', [
        modifier({ name: 'ExtraSkill', type: 'LIST', value: 'Impurity' }),
      ]),
      b: semantics('+3 to Level of all Attack Skills', [
        modifier({ name: 'AttackSkillLevel', value: 3, flags: ['Attack'] }),
      ]),
    }, 'offence')

    expect(result).toEqual(expect.arrayContaining([
      expect.objectContaining({ semanticGroup: 'grantedSkills', text: 'Grants Skill: Level 18 Impurity' }),
      expect.objectContaining({ semanticGroup: 'skillLevels', text: '+3 to Level of all Attack Skills' }),
    ]))
  })

  it('aggregates matching minion damage without mixing player or ally damage', () => {
    const result = aggregateEquipmentSemantics([
      ...slots,
      { name: 'Amulet', itemId: 'c', active: true },
      { name: 'Helmet', itemId: 'd', active: true },
    ], {
      ...items,
      c: item('c', 'Amulet C'),
      d: item('d', 'Helmet D'),
    }, {
      a: semantics('Minions deal 20% increased Damage', [modifier({ name: 'Damage', type: 'INC', value: 20, recipient: 'minion' })]),
      b: semantics('Minions deal 30% increased Damage', [modifier({ name: 'Damage', type: 'INC', value: 30, recipient: 'minion' })]),
      c: semantics('20% increased Damage', [modifier({ name: 'Damage', type: 'INC', value: 20 })]),
      d: semantics('Allies in your Presence deal 20% increased Damage', [modifier({ name: 'Damage', type: 'INC', value: 20, recipient: 'ally' })]),
    }, 'offence')

    expect(result).toHaveLength(3)
    expect(result).toEqual(expect.arrayContaining([
      expect.objectContaining({ recipient: 'minion', text: 'Minions deal 50% increased Damage', sources: expect.arrayContaining([expect.anything(), expect.anything()]) }),
      expect.objectContaining({ recipient: 'player', text: '20% increased Damage' }),
      expect.objectContaining({ recipient: 'ally', text: 'Allies in your Presence deal 20% increased Damage' }),
    ]))
  })

  it('keeps player, minion and companion flat damage in separate totals', () => {
    const result = aggregateEquipmentSemantics(slots, items, {
      a: semantics('Minions deal 2 to 10 added Attack Fire Damage', [
        modifier({ name: 'FireMin', value: 2, keywordFlags: ['Attack'], recipient: 'minion' }),
        modifier({ name: 'FireMax', value: 10, keywordFlags: ['Attack'], recipient: 'minion' }),
      ]),
      b: semantics('Companions deal 3 to 12 added Attack Fire Damage', [
        modifier({ name: 'FireMin', value: 3, keywordFlags: ['Attack'], recipient: 'companion' }),
        modifier({ name: 'FireMax', value: 12, keywordFlags: ['Attack'], recipient: 'companion' }),
      ]),
    }, 'offence')

    expect(result).toHaveLength(2)
    expect(result).toEqual(expect.arrayContaining([
      expect.objectContaining({ recipient: 'minion', text: 'Adds 2 to 10 Fire Damage to Attacks' }),
      expect.objectContaining({ recipient: 'companion', text: 'Adds 3 to 12 Fire Damage to Attacks' }),
    ]))
  })

  it('groups all skill level scopes together while only summing matching keywords', () => {
    const result = aggregateEquipmentSemantics([
      ...slots,
      { name: 'Amulet', itemId: 'c', active: true },
      { name: 'Helmet', itemId: 'd', active: true },
    ], {
      ...items,
      c: item('c', 'Amulet C'),
      d: item('d', 'Helmet D'),
    }, {
      a: semantics('+1 to Level of all Attack Skills', [modifier({
        name: 'SkillLevel', value: 1, wrapper: 'GemProperty', tags: [{ type: 'SkillLevel', keyword: 'attack' }],
      })]),
      b: semantics('+3 to Level of all Attack Skills', [modifier({
        name: 'SkillLevel', value: 3, wrapper: 'GemProperty', tags: [{ type: 'SkillLevel', keyword: 'attack' }],
      })]),
      c: semantics('+2 to Level of all Spell Skills', [modifier({
        name: 'SkillLevel', value: 2, wrapper: 'GemProperty', tags: [{ type: 'SkillLevel', keyword: 'spell' }],
      })]),
      d: semantics('+2 to Level of all Minion Skills', [modifier({
        name: 'SkillLevel', value: 2, recipient: 'minion', wrapper: 'GemProperty', tags: [{ type: 'SkillLevel', keyword: 'minion' }],
      })]),
    }, 'offence')

    expect(result).toHaveLength(3)
    expect(result).toEqual(expect.arrayContaining([
      expect.objectContaining({ semanticGroup: 'skillLevels', recipient: 'player', text: '+4 to Level of all Attack Skills' }),
      expect.objectContaining({ semanticGroup: 'skillLevels', recipient: 'player', text: '+2 to Level of all Spell Skills' }),
      expect.objectContaining({ semanticGroup: 'skillLevels', recipient: 'minion', text: '+2 to Level of all Minion Skills' }),
    ]))
  })
})

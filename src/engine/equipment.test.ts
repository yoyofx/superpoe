import { describe, expect, it } from 'vitest'
import { parseEquipmentXml } from '@/engine/equipment'
import { getTranslations } from '@/i18n/useTranslation'
import type { Language } from '@/i18n/translationLoader'

describe('equipment XML parser', () => {
  it('maps items to the active item set', () => {
    const result = parseEquipmentXml(`<PathOfBuilding2><Items activeItemSet="2">
      <Item id="7">Rarity: UNIQUE\nThe Vertex\nTribal Mask\nItem Level: 83\nLevelReq: 50\nQuality: +20%\nImplicits: 1\n+16% to Chaos Resistance</Item>
      <ItemSet id="2" title="Bossing"><Slot name="Helmet" itemId="7"/></ItemSet>
    </Items></PathOfBuilding2>`)

    expect(result?.activeItemSetId).toBe('2')
    expect(result?.itemSets[0].title).toBe('Bossing')
    expect(result?.itemsById['7']).toMatchObject({
      rarity: 'UNIQUE', name: 'The Vertex', baseType: 'Tribal Mask', itemLevel: '83', levelReq: '50',
    })
    expect(result?.itemsById['7'].lines).toEqual(['+16% to Chaos Resistance'])
    expect(result?.itemsById['7'].modifiers).toEqual([
      { text: '+16% to Chaos Resistance', tags: [], group: 'implicit' },
    ])
  })

  it('returns null when the build has no items section', () => {
    expect(parseEquipmentXml('<PathOfBuilding2><Tree/></PathOfBuilding2>')).toBeNull()
  })

  it('preserves PoB modifier groups and style tags', () => {
    const result = parseEquipmentXml(`<PathOfBuilding2><Items>
      <Item id="12">Rarity: RARE\nEmpyrean Cry\nSinister Quarterstaff\nImplicits: 2\n{enchant}{rune}+20 to maximum Life\nGrants Skill: Test\n{crafted}+8 to Strength</Item>
    </Items></PathOfBuilding2>`)

    expect(result?.itemsById['12'].modifiers).toEqual([
      { text: '+20 to maximum Life', tags: ['enchant', 'rune'], group: 'rune' },
      { text: 'Grants Skill: Test', tags: [], group: 'implicit' },
      { text: '+8 to Strength', tags: ['crafted'], group: 'explicit' },
    ])
  })

  it('keeps equipment sockets and their rune order separate from skill groups', () => {
    const result = parseEquipmentXml(`<PathOfBuilding2><Items>
      <Item id="9">Rarity: RARE\nRune Vessel\nVile Robe\nSockets: S S\nRune: Greater Iron Rune\nRune: Soul Core of Tacati\nImplicits: 0</Item>
    </Items></PathOfBuilding2>`)

    expect(result?.itemsById['9']).toMatchObject({
      socketCount: 2,
      runes: ['Greater Iron Rune', 'Soul Core of Tacati'],
    })
  })

  it('uses the actual base type for magic items emitted by the game export', () => {
    const result = parseEquipmentXml(`<PathOfBuilding2><Items>
      <Item id="8">Rarity: MAGIC\nMAGIC Ultimate Mana Flask 764afbd0\nUnique ID: test\nItem Level: 66</Item>
    </Items></PathOfBuilding2>`)

    expect(result?.itemsById['8']).toMatchObject({ name: 'Ultimate Mana Flask', baseType: 'Ultimate Mana Flask' })
  })

  it('handles affixed magic flasks without a separate base-type line', () => {
    const result = parseEquipmentXml(`<PathOfBuilding2><Items>
      <Item id="8">Rarity: MAGIC\nTurbid Ultimate Mana Flask of the Practitioner\nUnique ID: test\nItem Level: 80</Item>
    </Items></PathOfBuilding2>`)

    expect(result?.itemsById['8']).toMatchObject({
      name: 'Turbid Ultimate Mana Flask of the Practitioner',
      baseType: 'Turbid Ultimate Mana Flask of the Practitioner',
    })
  })

  it('counts augment and jewel sockets across repeated socket lines', () => {
    const result = parseEquipmentXml(`<PathOfBuilding2><Items>
      <Item id="3">Rarity: RARE\nWrath Palm\nRuneforged Barbed Bracers\nSockets: S\nRune: Cadigan's Epiphany\nSockets: J\nImplicits: 0</Item>
    </Items></PathOfBuilding2>`)

    expect(result?.itemsById['3']).toMatchObject({
      sockets: 'S J',
      socketCount: 2,
      runes: ["Cadigan's Epiphany"],
    })
  })

  it('uses the jewel base for opaque rare names emitted by game exports', () => {
    const result = parseEquipmentXml(`<PathOfBuilding2><Items>
      <Item id="17">Rarity: RARE\nRARE EHNQhgOm\nEmerald\nItem Level: 79\nImplicits: 1\n{crafted}+10% to Lightning Resistance\n22% increased Critical Damage Bonus for Attack Damage</Item>
      <ItemSet id="1"><Slot name="Gloves Abyssal Socket 1" itemId="17"/></ItemSet>
    </Items></PathOfBuilding2>`)

    expect(result?.itemsById['17']).toMatchObject({
      name: 'Emerald',
      baseType: 'Emerald',
      lines: [
        '{crafted}+10% to Lightning Resistance',
        '22% increased Critical Damage Bonus for Attack Damage',
      ],
    })
    expect(result?.itemSets[0].slots[0].name).toBe('Gloves Abyssal Socket 1')
  })

  it('preserves both primary and swap weapon slots', () => {
    const result = parseEquipmentXml(`<PathOfBuilding2><Items activeItemSet="1">
      <Item id="1">Rarity: NORMAL\nQuarterstaff</Item>
      <Item id="2">Rarity: NORMAL\nSceptre</Item>
      <Item id="3">Rarity: NORMAL\nBow</Item>
      <Item id="4">Rarity: NORMAL\nQuiver</Item>
      <ItemSet id="1"><Slot name="Weapon 1" itemId="1"/><Slot name="Weapon 2" itemId="2"/><Slot name="Weapon 1 Swap" itemId="3"/><Slot name="Weapon 2 Swap" itemId="4"/></ItemSet>
    </Items></PathOfBuilding2>`)

    expect(result?.itemSets[0].slots.map((slot) => slot.name)).toEqual([
      'Weapon 1', 'Weapon 2', 'Weapon 1 Swap', 'Weapon 2 Swap',
    ])
  })

  it('defines equipment UI strings in every supported language', () => {
    const languages: Language[] = ['en', 'zh-rCN', 'zh-rTW', 'ko-KR']
    const requiredKeys = [
      'toolbar.equipment', 'equipment.title', 'equipment.importHint',
      'equipment.itemLevel', 'equipment.slot.weapon1', 'equipment.slot.flask2',
    ]
    for (const language of languages) {
      const translations = getTranslations(language)
      for (const key of requiredKeys) expect(translations[key], `${language}: ${key}`).toBeTruthy()
    }
  })
})

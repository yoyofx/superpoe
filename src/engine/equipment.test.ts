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
  })

  it('returns null when the build has no items section', () => {
    expect(parseEquipmentXml('<PathOfBuilding2><Tree/></PathOfBuilding2>')).toBeNull()
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

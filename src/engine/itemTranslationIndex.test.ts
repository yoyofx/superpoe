import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { ItemTranslationIndex } from '../../electron/itemTranslationIndex'

describe('CN item translation index', () => {
  it('reverses item names and parameterized stat lines to PoB English', () => {
    const index = new ItemTranslationIndex(path.join(process.cwd(), 'public', 'data', 'Translate', 'zh-rCN'))

    expect(index.toEnglish('懦夫护甲')).toBe('Dastard Armour')
    expect(index.statToEnglish('药剂的魔力回复提高 20%')).toBe('20% increased Mana Recovery from Flasks')
    expect(index.statToEnglish('+128 护甲')).toBe('+128 to Armour')
    expect(index.toChinese('Dastard Armour')).toBe('懦夫护甲')
    expect(index.statToChinese('+128 to Armour')).toBe('128 护甲')
    expect(index.toChinese('Runemastered Crucible Tower Shield')).toBe('符文师匠熔铸塔盾')
    expect(index.statToChinese('Grants Skill: Raise Shield')).toBe('获得技能: 架盾')
    expect(index.statToChinese('Grants Skill: Level 20 Cast on Block')).toBe('获得技能: 20 级格挡时施放')
  })

  it('reconstructs a PoB English rare name from localized word parts', () => {
    const index = new ItemTranslationIndex(path.join(process.cwd(), 'public', 'data', 'Translate', 'zh-rCN'))

    expect(index.toEnglish('\u66b4\u6012 \u4e4b\u672f')).toBe('Wrath Spell')
    expect(index.toChinese('Wrath Spell')).toBe('\u66b4\u6012 \u4e4b\u672f')
  })
})

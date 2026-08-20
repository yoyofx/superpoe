import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { detectItemRawLanguage, ItemTranslationIndex } from '../../electron/itemTranslationIndex'

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

  it('normalizes advanced Chinese unique modifiers and granted skills', () => {
    const index = new ItemTranslationIndex(path.join(process.cwd(), 'public', 'data', 'Translate', 'zh-rCN'))

    expect(index.statToEnglish('属性需求降低 15 (20-10)%')).toBe('15% reduced Attribute Requirements')
    expect(index.statToEnglish('获得技能: 等级 19 群星召唤')).toBe("Grants Skill: Level 19 The Stars Answer")
    expect(index.statToEnglish('获得技能: 等级 19 大法师（最高等级 20）')).toBe('Grants Skill: Level 19 Archmage')
    expect(index.statToEnglish('该物品仅能镶嵌符文 — 数值不可调整')).toBe('Only Runes can be Socketed in this item')
    expect(index.statToEnglish('镶嵌的符文效果提高 200% — 数值不可调整')).toBe('200% increased effect of Socketed Runes')
    expect(index.statToEnglish('+112 (100) 精魂')).toBe('+112 to Spirit')
    expect(index.statToEnglish('附加 147 (135-156) - 220 (205-236) 火焰伤害')).toBe('Adds 147 to 220 Fire Damage')
    expect(index.statToEnglish('附加 2 (1-19) - 334 (310-358) 闪电伤害')).toBe('Adds 2 to 334 Lightning Damage')
    expect(index.statToEnglish('羁绊： 所有技能品质 +5%')).toBe('+5% to Quality of all Skills')
    expect(index.statToEnglish('白银 继承')).toBe('Legacy of Silver')
    // Variant options are supplied by the official trade catalog at runtime;
    // the translation index itself must not contain a hand-maintained alias list.
    index.registerStatTranslation('钻石 继承', 'Legacy of Diamond')
    expect(index.statToEnglish('钻石 继承')).toBe('Legacy of Diamond')
    expect(index.statToEnglish('水银 继承')).toBe('Legacy of Quicksilver')
    expect(index.statToEnglish('灰岩 继承')).toBe('Legacy of Bismuth')
    expect(index.statToEnglish('硫磺 继承')).toBe('Legacy of Sulphur')
    expect(index.statToEnglish('宝钻 继承')).toBe('Legacy of Diamond')
    expect(index.statToChinese('Legacy of Diamond')).toBe('钻石 继承')
    expect(index.statToChinese('Allocates Efficient Inscriptions')).toBe('配置 高效铭文')
    expect(index.statToChinese('Allocates Paragon')).toBe('配置 典范')
    expect(index.statToChinese('Limited to: 1')).toBe('仅限: 1')
    expect(index.statToEnglish('配置 高效铭文')).toBe('Allocates Efficient Inscriptions')
    expect(index.statToEnglish('配置 典范')).toBe('Allocates Paragon')
    expect(index.statToEnglish('仅限: 1')).toBe('Limited to: 1')
  })

  it('identifies supported game clipboard languages without using UI language', () => {
    expect(detectItemRawLanguage('物品类别: 法杖\n稀有度: 传奇')).toBe('zh-rCN')
    expect(detectItemRawLanguage('物品類別: 法杖\n稀有度: 傳奇')).toBe('zh-rTW')
    expect(detectItemRawLanguage('아이템 종류: 지팡이\n희귀도: 고유')).toBe('ko-KR')
    expect(detectItemRawLanguage('Rarity: UNIQUE\nDoom Branch')).toBe('en')
  })

  it('loads the same canonical stat catalog for Traditional Chinese and Korean', () => {
    const traditional = new ItemTranslationIndex(path.join(process.cwd(), 'public', 'data', 'Translate', 'zh-rTW'))
    const korean = new ItemTranslationIndex(path.join(process.cwd(), 'public', 'data', 'Translate', 'ko-KR'))

    expect(traditional.statToEnglish('鑲嵌的符文增加200%效果')).toBe('200% increased effect of Socketed Runes')
    expect(korean.statToEnglish('장착된 룬의 효과 200% 증가')).toBe('200% increased effect of Socketed Runes')
  })
})

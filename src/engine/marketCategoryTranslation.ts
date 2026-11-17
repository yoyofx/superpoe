/** Official trade2 category IDs; labels are display-only and never replace query values. */
export const MARKET_CATEGORY_TRANSLATIONS: ReadonlyArray<readonly [id: string | null, en: string, cn: string, tw: string, ...aliases: string[]]> = [
  [null, 'Any', '全部', '全部', 'Any Item'],
  ['weapon', 'Any Weapon', '任意武器', '任意武器'],
  ['weapon.onemelee', 'Any One-Handed Melee Weapon', '任意单手近战武器', '任意單手近戰武器'],
  ['weapon.unarmed', 'Unarmed', '徒手', '徒手'],
  ['weapon.claw', 'Claw', '爪', '爪', 'Claws'],
  ['weapon.dagger', 'Dagger', '匕首', '匕首', 'Daggers'],
  ['weapon.onesword', 'One-Handed Sword', '单手剑', '單手劍', 'One Hand Sword', 'One Hand Swords'],
  ['weapon.oneaxe', 'One-Handed Axe', '单手斧', '單手斧', 'One Hand Axe', 'One Hand Axes'],
  ['weapon.onemace', 'One-Handed Mace', '单手锤', '單手錘', 'One Hand Mace', 'One Hand Maces'],
  ['weapon.spear', 'Spear', '战矛', '戰矛', 'Spears'],
  ['weapon.flail', 'Flail', '连枷', '連枷', 'Flails'],
  ['weapon.twomelee', 'Any Two-Handed Melee Weapon', '任意双手近战武器', '任意雙手近戰武器'],
  ['weapon.twosword', 'Two-Handed Sword', '双手剑', '雙手劍', 'Two Hand Sword', 'Two Hand Swords'],
  ['weapon.twoaxe', 'Two-Handed Axe', '双手斧', '雙手斧', 'Two Hand Axe', 'Two Hand Axes'],
  ['weapon.twomace', 'Two-Handed Mace', '双手锤', '雙手錘', 'Two Hand Mace', 'Two Hand Maces'],
  ['weapon.warstaff', 'Quarterstaff', '节杖', '細杖', 'Quarterstaves'],
  ['weapon.talisman', 'Talisman', '魔符', '魔符', 'Talismans'],
  ['weapon.ranged', 'Any Ranged Weapon', '任意远程武器', '任意遠程武器'],
  ['weapon.bow', 'Bow', '弓', '弓', 'Bows'],
  ['weapon.crossbow', 'Crossbow', '战弩', '弩', 'Crossbows'],
  ['weapon.caster', 'Any Caster Weapon', '任意施法武器', '任意施法武器'],
  ['weapon.wand', 'Wand', '法杖', '法杖', 'Wands'],
  ['weapon.sceptre', 'Sceptre', '短杖', '權杖', 'Sceptres'],
  ['weapon.staff', 'Staff', '长杖', '長杖', 'Staves'],
  ['weapon.rod', 'Fishing Rod', '鱼竿', '釣竿', 'Fishing Rods'],
  ['armour', 'Any Armour', '任意护甲', '任意護甲'],
  ['armour.helmet', 'Helmet', '头盔', '頭盔', 'Helmets'],
  ['armour.chest', 'Body Armour', '胸甲', '胸甲', 'Body Armours'],
  ['armour.gloves', 'Gloves', '手套', '手套'],
  ['armour.boots', 'Boots', '鞋子', '鞋子'],
  ['armour.quiver', 'Quiver', '箭袋', '箭袋', 'Quivers'],
  ['armour.shield', 'Shield', '盾牌', '盾牌', 'Shields'],
  ['armour.focus', 'Focus', '法器', '法器', 'Foci', 'Focuses'],
  ['armour.buckler', 'Buckler', '轻盾', '輕盾', 'Bucklers'],
  ['accessory', 'Any Accessory', '任意饰品', '任意飾品', 'Accessories'],
  ['accessory.amulet', 'Amulet', '项链', '項鍊', 'Amulets'],
  ['accessory.belt', 'Belt', '腰带', '腰帶', 'Belts'],
  ['accessory.ring', 'Ring', '戒指', '戒指', 'Rings'],
  ['gem', 'Any Gem', '任意宝石', '任意寶石', 'Gems'],
  ['gem.activegem', 'Skill Gem', '技能宝石', '技能寶石', 'Skill Gems', 'Active Skill Gem', 'Active Skill Gems'],
  ['gem.supportgem', 'Support Gem', '辅助宝石', '輔助寶石', 'Support Gems'],
  ['gem.metagem', 'Meta Gem', '非凡宝石', '特殊寶石', 'Meta Gems', 'Spirit Gem', 'Spirit Gems'],
  ['jewel', 'Any Jewel', '任意珠宝', '任意珠寶', 'Jewel', 'Jewels'],
  ['flask', 'Any Flask', '任意药剂', '任意藥劑', 'Flask', 'Flasks'],
  ['flask.life', 'Life Flask', '生命药剂', '生命藥劑', 'Life Flasks'],
  ['flask.mana', 'Mana Flask', '魔力药剂', '魔力藥劑', 'Mana Flasks'],
  ['flask.charm', 'Charm', '咒符', '咒符', 'Charms'],
  ['map', 'Any Endgame Item', '任意终局物品', '任意終局物品', 'Endgame Items', 'Any Map'],
  ['map.waystone', 'Waystone', '引路石', '引路石', 'Waystones'],
  ['map.fragment', 'Map Fragment', '地图碎片', '地圖碎片', 'Map Fragments'],
  ['map.logbook', 'Expedition Logbook', '日志', '探險日誌', 'Expedition Logbooks', 'Logbook'],
  ['map.breachstone', 'Breachstone', '裂隙石', '裂痕石', 'Breachstones'],
  ['map.barya', 'Djinn Barya', '巨灵币', '巨靈之幣', 'Trial Coin', 'Trial Coins'],
  ['map.bosskey', 'Pinnacle Key', '巅峰钥匙', '巔峰鑰匙', 'Pinnacle Keys', 'Boss Key', 'Boss Keys'],
  ['map.ultimatum', 'Ultimatum Key', '致命贪婪钥匙', '最後通牒鑰匙', 'Ultimatum Keys', 'Inscribed Ultimatum'],
  ['map.tablet', 'Tablet', '石板', '碑牌', 'Tablets', 'Precursor Tablet', 'Precursor Tablets'],
  ['card', 'Divination Card', '命运卡', '命運卡', 'Divination Cards'],
  ['sanctum.relic', 'Relic', '遗物', '聖物', 'Relics', 'Any Relic'],
  ['currency', 'Any Currency', '任意通货', '任意通貨'],
  ['currency.omen', 'Omen', '预兆', '預兆', 'Omens'],
  ['currency.socketable', 'Any Socketable', '任意增幅器', '任意增幅物', 'Socketable', 'Socketables', 'Augment', 'Augments', 'Any Augment'],
  ['currency.rune', 'Rune', '符文', '符文', 'Runes'],
  ['currency.soulcore', 'Soul Core', '灵核', '靈魂核心', 'Soul Cores'],
  ['currency.idol', 'Idol', '魔偶', '魔偶', 'Idols'],
]

type LocalizedText = (en: string, cn: string, tw: string, ko: string) => string

export function localizeMarketCategory(id: string | number | null, source: string, text: LocalizedText): string {
  const row = MARKET_CATEGORY_TRANSLATIONS.find(([value]) => value === id)
  return row ? text(source, row[2], row[3], source) : source
}

export function marketCategoryTranslationPairs(language: 'zh-rCN' | 'zh-rTW'): Array<readonly [string, string]> {
  return MARKET_CATEGORY_TRANSLATIONS.flatMap(([, en, cn, tw, ...aliases]) => {
    const target = language === 'zh-rCN' ? cn : tw
    return [en, ...aliases].flatMap((source): Array<readonly [string, string]> => {
      if (source.startsWith('Any ')) return [[source, target]]
      const label = en.startsWith('Any ') ? target.replace(/^任意/u, '') : target
      return [[source, label], [`Any ${source}`, `任意${label}`]]
    })
  })
}

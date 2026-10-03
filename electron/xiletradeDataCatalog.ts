import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import type { LibraryModifierGroup, LibraryTextLocale } from '../src/types/market.js'
import type { CanonicalStatMatch, XiletradeParsingRule } from './xiletradeItemParser.js'

export type XiletradeLocale = 'en-US' | 'zh-CN' | 'zh-TW' | 'ko-KR'

export interface XiletradeFilterEntry {
  id: string
  text: string
  type: string
  part?: string
  option?: { options?: Array<{ id: string | number; text: string }> }
}

export interface XiletradeCatalog {
  locale: XiletradeLocale
  upstreamCommit: string
  entries: XiletradeFilterEntry[]
  rules: XiletradeParsingRule[]
  bases?: XiletradeBaseEntry[]
  words?: XiletradeWordEntry[]
  items?: XiletradeItemGroup[]
  itemClasses?: XiletradeItemClassEntry[]
  mods?: Array<Record<string, unknown>>
  currencies?: XiletradeCurrencyEntry[]
}

export interface XiletradeBaseEntry {
  id: string
  name_en: string
  name: string
  id_class?: number
  inherits_from?: string
}

export interface XiletradeWordEntry { id?: string | number; name_en: string; name: string }
export interface XiletradeItemEntry { type: string; text?: string; name?: string; flags?: { unique?: boolean } }
export interface XiletradeItemGroup { id: string; label?: string; entries: XiletradeItemEntry[] }
export interface XiletradeItemClassEntry { id: number; id_origin: string; name: string; name_en: string }
export interface XiletradeCurrencyEntry {
  id: string
  text: string
  name_en?: string
  name?: string
  groupId?: string
  image?: string
  [key: string]: unknown
}

export interface XiletradeItemContextInput {
  itemClass?: string
  /** Stable Xiletrade ItemClassTwo id_origin, retained across localization. */
  itemClassOrigin?: string
  tradeCategory?: string
  rarity?: string
  name?: string
  baseType?: string
  identified?: boolean
  exchangeCurrency?: boolean
  foilVariant?: boolean
  unidentified?: boolean
  uncutGem?: boolean
  area?: boolean
}

export interface XiletradeItemFlags {
  unique: boolean
  normal: boolean
  currency: boolean
  divcard: boolean
  foilVariant: boolean
  unidentified: boolean
  map: boolean
  mapFragment: boolean
  miscMapItems: boolean
  capturedBeast: boolean
  watchstone: boolean
  invitation: boolean
  chargedCompass: boolean
  voidstone: boolean
  logbook: boolean
  exchangeCurrency: boolean
  incubator: boolean
  wombgift: boolean
  weapon: boolean
  armourPiece: boolean
  shield: boolean
  jewel: boolean
  flask: boolean
  charm: boolean
  amulet: boolean
  tablet: boolean
  waystone: boolean
  gems: boolean
  uncutGem: boolean
  area: boolean
  /** PoE2 wand/staff/sceptre branch forced by FormViewModel. */
  skillWeapon: boolean
  /** ItemState.SpecialBase branch forced by FormViewModel. */
  specialBase: boolean
  byType: boolean
  byBase: boolean
  useItemLevel: boolean
}

/**
 * Query routing reproduced from Xiletrade's ItemFlag and JsonDataTwoFactory.
 * This is deliberately a closed set: a new game item class must be added from
 * the upstream rule before it can change query shape.
 */
export interface XiletradeItemQueryRouting {
  tradeCategory?: string
  unique: boolean
  normal: boolean
  currency: boolean
  divcard: boolean
  foilVariant: boolean
  unidentified: boolean
  map: boolean
  mapFragment: boolean
  miscMapItems: boolean
  capturedBeast: boolean
  watchstone: boolean
  invitation: boolean
  chargedCompass: boolean
  voidstone: boolean
  logbook: boolean
  exchangeCurrency: boolean
  incubator: boolean
  wombgift: boolean
  weapon: boolean
  armourPiece: boolean
  shield: boolean
  jewel: boolean
  flask: boolean
  charm: boolean
  amulet: boolean
  tablet: boolean
  waystone: boolean
  gems: boolean
  uncutGem: boolean
  area: boolean
  /** PoE2 wand/staff/sceptre branch forced by FormViewModel. */
  skillWeapon: boolean
  /** ItemState.SpecialBase branch forced by FormViewModel. */
  specialBase: boolean
  byType: boolean
  byBase: boolean
  useItemLevel: boolean
}

export interface XiletradeItemContext extends XiletradeItemContextInput {
  canonicalName: string
  canonicalBaseType: string
  flags: XiletradeItemFlags
}

export interface XiletradeCatalogBundle {
  display: XiletradeCatalog
  canonical: XiletradeCatalog
}

interface Manifest {
  schemaVersion: number
  upstreamCommit: string
}

const localeMap: Record<LibraryTextLocale, XiletradeLocale> = {
  en: 'en-US',
  'zh-CN': 'zh-CN',
  'zh-TW': 'zh-TW',
  'ko-KR': 'ko-KR',
  unknown: 'en-US',
}

function parseJson<T>(file: string): T {
  return JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, '')) as T
}

function normalizeSpace(value: string): string {
  return value
    .replace(/\r\n?/g, '\n')
    .replace(/&apos;|&#39;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/&amp;/gi, '&')
    .replace(/\[([^\]|]*\|)?([^\]]+)\]/g, '$2')
    .replace(/[ \t\u3000]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .trim()
}

/** Isolated compatibility projection for canonical text emitted by older PoB2 data. */
function normalizeLegacyPobTradeText(value: string): string {
  return value
    .replace(/Cooldown Recovery Speed/gi, 'Cooldown Recovery Rate')
    .replace(/Elemental Damage with Attack Skills/gi, 'Elemental Damage with Attacks')
}

function stripTierRanges(value: string): string {
  return value
    .replace(/\s*\(\s*[-+]?\d+(?:\.\d+)?\s*-\s*[-+]?\d+(?:\.\d+)?\s*\)/g, '')
    .replace(/\s*\(\s*[-+]?\d+(?:\.\d+)?\s*\)/g, '')
    .replace(/\s+(?=[%％])/g, '')
}

export function stripXiletradePresentationSuffixes(value: string): string {
  return value.split('\n').map((line) => {
    const separator = line.indexOf('—')
    const withoutUnscalable = separator < 0 ? line : line.slice(0, separator).trimEnd()
    return withoutUnscalable.replace(
      /\s*[（(]\s*(?:(?:最高等级|最高等級)\s*\d+|(?:max(?:imum)?\s+level)\s*\d+|(?:최대|최고)\s*레벨\s*\d+)\s*[）)]\s*$/iu,
      '',
    ).trimEnd()
  }).join('\n')
}

function templateKind(value: string): string {
  return normalizeSpace(stripTierRanges(value))
    .replace(/[-+]?\d+(?:\.\d+)?/g, '#')
    .replace(/\+(?=#)/g, '')
    .toLocaleLowerCase()
}

function values(value: string): number[] {
  return [...stripTierRanges(value).matchAll(/[-+]?\d+(?:\.\d+)?/g)].map((match) => Number(match[0]))
}

function fillTemplate(template: string, source: string): string {
  const sourceValues = values(source)
  let index = 0
  return template.replace(/#/g, (placeholder, offset) => {
    let current = sourceValues[index++]?.toString()
    if (current == null) return placeholder
    if ((template[offset - 1] === '+' || template[offset - 1] === '-') && current.startsWith(template[offset - 1])) {
      current = current.slice(1)
    }
    return current
  })
}

function scopeFor(group: LibraryModifierGroup): string {
  return group === 'rune' ? 'rune' : group === 'enchant' ? 'enchant' : group === 'implicit' ? 'implicit' : 'explicit'
}

function applyRules(value: string, rules: XiletradeParsingRule[]): string {
  let result = value
  for (const rule of rules) {
    if (rule.disabled || !rule.old || !rule.new) continue
    let captureCount = 0
    const escaped = rule.old.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/#/g, () => {
      captureCount += 1
      return '([-+]?\\d+(?:\\.\\d+)?)'
    })
    const expression = new RegExp(rule.replace === 'equals' ? `^${escaped}$` : escaped, 'iu')
    const match = result.match(expression)
    if (!match) continue
    let capture = 1
    const replacement = rule.new.replace(/#/g, () => capture <= captureCount ? match[capture++] : '#')
    result = rule.replace === 'equals' ? replacement : result.replace(expression, replacement)
  }
  return result
}

function negativeIncreasedVariant(value: string, locale: XiletradeLocale): { matchText: string; valueText: string } | undefined {
  const [reduced, increased] = locale === 'zh-CN' ? ['降低', '提高']
    : locale === 'zh-TW' ? ['減少', '增加']
      : locale === 'ko-KR' ? ['감소', '증가']
        : ['reduced', 'increased']
  if (!value.toLocaleLowerCase().includes(reduced.toLocaleLowerCase())) return undefined
  const matchText = value.replace(new RegExp(reduced, 'iu'), increased)
  const valueText = stripTierRanges(matchText).replace(/[-+]?\d+(?:\.\d+)?/g, (number) => String(-Math.abs(Number(number))))
  return { matchText, valueText }
}

function localCandidateKinds(kind: string, itemClass: string, locale: XiletradeLocale): string[] {
  const classes = itemClass.toLocaleLowerCase()
  const weapon = /weapon|bow|crossbow|staff|stave|wand|sceptre|mace|axe|sword|dagger|claw|spear|flail|quarterstaff|warstaff|法杖|节杖|權杖|弓|弩|杖|锤|錘|斧|剑|劍|匕首|爪|矛|连枷|連枷|무기|활|석궁|지팡이|철퇴|도끼|검|단검|클로|창/u.test(classes)
  const armour = /armour|helmet|gloves|boots|shield|buckler|focus|quiver|body armour|头盔|頭盔|手套|鞋|盾|胸甲|护甲|護甲|箭袋|방어구|투구|장갑|장화|방패/u.test(classes)
  if (!weapon && !armour) return [kind]
  const suffix = locale === 'zh-CN' ? ' (区域)'
    : locale === 'zh-TW' ? ' (部分)'
      : locale === 'ko-KR' ? '(특정)'
        : ' (local)'
  return [`${kind}${suffix}`, kind]
}

function normalizedKey(value: string | undefined): string {
  return normalizeSpace(value || '').toLocaleLowerCase()
}

const ITEM_CLASS_CATEGORIES: Record<string, string> = {
  // ItemFlag.GetItemCategoryApi()
  sceptres: 'weapon.sceptre', sceptre: 'weapon.sceptre', quarterstaves: 'weapon.warstaff', quarterstaff: 'weapon.warstaff',
  warstaves: 'weapon.warstaff', warstaff: 'weapon.warstaff', staves: 'weapon.staff', stave: 'weapon.staff', wands: 'weapon.wand', wand: 'weapon.wand',
  spears: 'weapon.spear', 'thrusting one hand swords': 'weapon.rapier', 'one hand swords': 'weapon.onesword',
  'one hand axes': 'weapon.oneaxe', 'one hand maces': 'weapon.onemace', 'two hand axes': 'weapon.twoaxe',
  'two hand maces': 'weapon.twomace', 'two hand swords': 'weapon.twosword', claws: 'weapon.claw',
  'rune daggers': 'weapon.runedagger', daggers: 'weapon.basedagger', bows: 'weapon.bow',
  'fishing rods': 'weapon.rod', crossbows: 'weapon.crossbow', traps: 'weapon.trap', flails: 'weapon.flail',
  talismans: 'weapon.talisman', weapon: 'weapon',
  'body armours': 'armour.chest', helmets: 'armour.helmet', boots: 'armour.boots', gloves: 'armour.gloves',
  shields: 'armour.shield', shield: 'armour.shield', bucklers: 'armour.buckler', foci: 'armour.focus', focus: 'armour.focus', quivers: 'armour.quiver', armour: 'armour',
  amulets: 'accessory.amulet', rings: 'accessory.ring', belts: 'accessory.belt', trinkets: 'accessory.trinket',
  tablet: 'map.tablet', waystones: 'map.waystone', 'trial coins': 'map.barya', chart: 'chart', 'map fragment': 'map.fragment', 'map fragments': 'map.fragment', maps: 'map', map: 'map',
  'cluster jewel': 'jewel.cluster', 'abyss jewels': 'jewel', 'abyss jewel': 'jewel', jewels: 'jewel', jewel: 'jewel', 'divination card': 'card', 'divination cards': 'card', memories: 'memoryline', memoryline: 'memoryline',
  'captured beast': 'monster.beast', 'captured beasts': 'monster.beast',
  flasks: 'flask', flask: 'flask', 'utility flasks': 'flask', 'life flasks': 'flask', 'mana flasks': 'flask', 'hybrid flasks': 'flask',
  gems: 'gem', 'skill gems': 'gem', 'support gems': 'gem', sentinel: 'sentinel', tinctures: 'tincture', tincture: 'tincture',
  relics: 'sanctum.relic', 'sanctum relic': 'sanctum.relic', 'sanctum research': 'sanctum.research', corpses: 'corpse', corpse: 'corpse',
  graft: 'graft', wombgift: 'wombgift', blueprints: 'heistmission.blueprint', contracts: 'heistmission.contract',
  pieces: 'currency.piece', currency: 'currency', 'stackable currency': 'currency',
  // Xiletrade intentionally returns an empty category for these classes.
  'embers of the allflame': '', allflame: '', 'metamorph samples': '', chronicle: '', 'filled coffin': '', 'facetor lens': '', rune: '',
  'charged compass': '', incubators: '', 'small relics': '', 'medium relics': '', 'large relics': '', 'sanctified relics': '',
  breachstones: '', shards: '', 'shard hearts': '', 'quest items': '', 'heist gear': '', 'heist tools': '', 'heist cloaks': '',
  'heist brooches': '', 'heist targets': '', 'incursion items': '', leaguestones: '', gold: '', idols: '', 'hidden items': '',
  'atlas upgrade items': '', 'misc map items': '', 'expedition logbooks': '', 'expedition logbook': '', logbook: '', charms: '', charm: '', ultimatum: '', 'inscribed ultimatum': '',
  'uncut gem': '', 'uncut gems': '', 'uncut skill gem': '', 'uncut skill gems': '', 'uncut support gem': '', 'uncut support gems': '', 'uncut spirit gem': '', 'uncut spirit gems': '',
  omen: '', socketable: '', 'delve stackable socketable currency': '', 'pinnacle keys': '', 'vault keys': '', 'mercenary warrant': '', 'mercenary warrants': '',
}

const LOCALIZED_ITEM_CLASS_CATEGORIES: Record<string, string> = {
  武器: 'weapon', weapon: 'weapon', 护甲: 'armour.chest', 護甲: 'armour.chest',
  法杖: 'weapon.wand', 魔杖: 'weapon.wand', 长杖: 'weapon.staff', 長杖: 'weapon.staff',
  权杖: 'weapon.sceptre', 權杖: 'weapon.sceptre', 节杖: 'weapon.warstaff', 弓: 'weapon.bow', 弩: 'weapon.crossbow',
  战弩: 'weapon.crossbow', 矛: 'weapon.spear', 战矛: 'weapon.spear', 长矛: 'weapon.spear', 長矛: 'weapon.spear', 匕首: 'weapon.basedagger',
  符文匕首: 'weapon.runedagger', 爪: 'weapon.claw', 连枷: 'weapon.flail', 連枷: 'weapon.flail',
  剑: 'weapon.onesword', 劍: 'weapon.onesword', 斧: 'weapon.oneaxe', 锤: 'weapon.onemace', 錘: 'weapon.onemace',
  头盔: 'armour.helmet', 頭盔: 'armour.helmet', 头部: 'armour.helmet', 手套: 'armour.gloves', 鞋子: 'armour.boots', 鞋: 'armour.boots',
  盾牌: 'armour.shield', 盾: 'armour.shield', 轻盾: 'armour.buckler', 法器: 'armour.focus', 箭袋: 'armour.quiver',
  项链: 'accessory.amulet', 項鍊: 'accessory.amulet', 戒指: 'accessory.ring', 腰带: 'accessory.belt', 腰帶: 'accessory.belt',
  珠宝: 'jewel', 珠寶: 'jewel', 深渊珠宝: 'jewel', 深淵珠寶: 'jewel', 灵柩: 'corpse', 近卫: 'sentinel', 酊剂: 'tincture', 遗物: 'sanctum.relic',
  药剂: 'flask', 藥劑: 'flask', 功能药剂: 'flask', 生命药剂: 'flask', 魔力药剂: 'flask',
  短杖: 'weapon.sceptre', 战杖: 'weapon.warstaff', 魔符: 'weapon.talisman',
  技能宝石: 'gem', 辅助宝石: 'gem', 辅助技能宝石: 'gem', 灵魂宝石: 'gem',
  引路石: 'map.waystone', 碑牌: 'map.tablet', 地图: 'map', 异界地图: 'map.waystone', 地圖: 'map', 異界地圖: 'map.waystone', 地图碎片: 'map.fragment', 地圖碎片: 'map.fragment', 海图: 'chart', 海圖: 'chart', 卡片: 'card',
  禁域研究: 'sanctum.research', 咒符: '', 护符: '', 護符: '', 不灭余烬: '', 灾变样本: '',
  异界升级物品: '', 異界升級物品: '', 裂隙之石: '', 先祖秘藏日志: '', omen: '', socketable: '', 宝库钥匙: '',
  货币: 'currency', 貨幣: 'currency',
}

/**
 * ItemClassTwo is the stable class vocabulary used by Xiletrade. The text in
 * Item Class is localized and can change, while id_origin is the value that
 * survives localization and is used by the upstream flag logic.
 */
const ITEM_CLASS_ORIGIN_CATEGORIES: Record<string, string> = {
  LifeFlask: 'flask', ManaFlask: 'flask', Currency: 'currency',
  Amulet: 'accessory.amulet', Ring: 'accessory.ring', Belt: 'accessory.belt', Trinket: 'accessory.trinket',
  Claw: 'weapon.claw', Dagger: 'weapon.basedagger', Wand: 'weapon.wand', Sceptre: 'weapon.sceptre',
  Staff: 'weapon.staff', Warstaff: 'weapon.warstaff', 'One Hand Sword': 'weapon.onesword',
  'Two Hand Sword': 'weapon.twosword', 'One Hand Axe': 'weapon.oneaxe', 'Two Hand Axe': 'weapon.twoaxe',
  'One Hand Mace': 'weapon.onemace', 'Two Hand Mace': 'weapon.twomace', Spear: 'weapon.spear',
  Bow: 'weapon.bow', Crossbow: 'weapon.crossbow', FishingRod: 'weapon.rod', TrapTool: 'weapon.trap',
  Flail: 'weapon.flail', Talisman: 'weapon.talisman', Quiver: 'armour.quiver',
  'Body Armour': 'armour.chest', Helmet: 'armour.helmet', Boots: 'armour.boots', Gloves: 'armour.gloves',
  Shield: 'armour.shield', Buckler: 'armour.buckler', Focus: 'armour.focus',
  Tablet: 'map.tablet', TowerAugmentation: 'map.tablet', Map: 'map.waystone', TrialCoins: 'map.barya', ItemisedSanctum: 'map.barya', Chart: 'chart', MapFragment: 'map.fragment',
  HeistContract: 'heistmission.contract', HeistBlueprint: 'heistmission.blueprint',
  Jewel: 'jewel', AbyssJewel: 'jewel', DivinationCard: 'card', MemoryLine: 'memoryline',
  Flask: 'flask', 'Active Skill Gem': 'gem', 'Support Skill Gem': 'gem', SentinelDrone: 'sentinel',
  Tincture: 'tincture', Relic: 'sanctum.relic', SanctumSpecialRelic: 'sanctum.relic',
  SanctumResearch: 'sanctum.research', Wombgift: 'wombgift', BrequelFruit: 'wombgift', Graft: 'graft',
  Pieces: 'currency.piece', UniqueFragment: 'currency.piece', StackableCurrency: 'currency',
  UtilityFlask: 'flask',
  // These classes intentionally have no category in ItemFlag.GetItemCategoryApi.
  MercenaryWarrant: '', MiscMapItem: '', UltimatumKey: '', ExpeditionLogbook: '',
  Expedition2Logbooks: '', Charm: '', Omen: '', UncutSkillGemStackable: '',
  UncutSupportGemStackable: '', UncutReservationGemStackable: '', VaultKey: '', PinnacleKeyStackable: '',
  AtlasUpgradeItem: '', Incubator: '', Breachstone: '', SmallRelic: '', MediumRelic: '', LargeRelic: '',
  DelveSocketableCurrency: '', DelveStackableSocketableCurrency: '', UniqueShard: '', UniqueShardBase: '',
  QuestItem: '', Leaguestone: '', PantheonSoul: '', IncursionItem: '', HiddenItem: '',
  HeistEquipmentWeapon: '', HeistEquipmentTool: '', HeistEquipmentUtility: '', HeistEquipmentReward: '',
  HeistObjective: '', ArchnemesisMod: '', InstanceLocalItem: '', HideoutDoodad: '', Microtransaction: '',
  SanctifiedRelic: '', SoulCore: '', IncursionArm: '', IncursionLeg: '', DONOTUSE5: '',
}

// ItemClassTwo has one known data error in the upstream payload: its
// UtilityFlask row is labelled "Charms". ItemFlag does not use that payload
// for the class checks; it compares the localized resource strings instead.
// Resolve those resource strings first so the stable origin cannot inherit the
// wrong class from the display data.
const ITEM_CLASS_RESOURCE_ORIGIN_ALIASES: ReadonlyArray<readonly [string, readonly string[]]> = [
  ['Charm', ['Charms', '咒符', '护符', '護符', '부적']],
  ['UtilityFlask', ['Utility Flasks', '功能药剂', '功能藥劑', '특수 플라스크']],
  ['TowerAugmentation', ['Tablet', '碑牌', '面板', '서판']],
  ['Map', ['Waystones', '换界石', '換界石', '경로석', '异界地图', '異界地圖']],
  ['ExpeditionLogbook', ['Expedition Logbooks', '先祖秘藏日志', '探险日志', '探險日誌', '탐험 일지']],
  ['Active Skill Gem', ['Skill Gems', '技能宝石', '技能寶石', '스킬 젬']],
  ['Support Skill Gem', ['Support Gems', '辅助宝石', '輔助寶石', '보조 젬']],
  ['Tincture', ['Tinctures', '酊剂', '萃取物', '팅크']],
  ['Graft', ['Grafts', '嫁接物', '接肢', '기생체']],
  ['BrequelFruit', ['Wombgifts', '孕育赠礼', '胎贈', '생명의 결실']],
  ['ItemisedSanctum', ['Trial Coins', '试炼代币', '試煉代幣', '시련 주화']],
  ['SentinelDrone', ['Sentinels', '近卫', '守望号令', '守望號令', '파수꾼']],
  ['SanctumResearch', ['Sanctum Research', '禁域研究', '聖域研究', '성역 연구']],
  ['MemoryLine', ['Memories', '记忆', '記憶']],
]

function itemClassOriginFromCatalog(bundle: XiletradeCatalogBundle, value: string | undefined): string | undefined {
  const key = normalizedKey(value)
  if (!key) return undefined
  const resourceAlias = ITEM_CLASS_RESOURCE_ORIGIN_ALIASES.find(([, aliases]) => aliases.some((alias) => normalizedKey(alias) === key))
  if (resourceAlias) return resourceAlias[0]
  for (const catalog of [bundle.display, bundle.canonical]) {
    const entry = catalog.itemClasses?.find((candidate) => (
      normalizedKey(candidate.id_origin) === key
      || normalizedKey(candidate.name) === key
      || normalizedKey(candidate.name_en) === key
    ))
    if (entry) return entry.id_origin
  }
  return undefined
}

function categoryFromItemClassOrigin(value: string | undefined): string | undefined {
  if (!value) return undefined
  const key = Object.keys(ITEM_CLASS_ORIGIN_CATEGORIES).find((candidate) => normalizedKey(candidate) === normalizedKey(value))
  return key ? ITEM_CLASS_ORIGIN_CATEGORIES[key] : undefined
}

function categoryFromItemClass(value: string | undefined, itemClassOrigin?: string): string | undefined {
  const key = normalizedKey(value)
  const originCategory = categoryFromItemClassOrigin(itemClassOrigin)
  if (originCategory !== undefined) return originCategory
  if (Object.prototype.hasOwnProperty.call(ITEM_CLASS_CATEGORIES, key)) return ITEM_CLASS_CATEGORIES[key]
  if (Object.prototype.hasOwnProperty.call(LOCALIZED_ITEM_CLASS_CATEGORIES, key)) return LOCALIZED_ITEM_CLASS_CATEGORIES[key]

  // ItemFlag uses StartWith/Contain for its resource-backed class checks.
  // Keep that behavior for harmless suffixes while avoiding broad substring
  // guesses that could classify an unrelated class.
  const noCategoryPrefixes = [
    'atlas upgrade items', 'misc map items', 'delve stackable socketable currency', 'expedition logbooks', 'logbook',
    'chronicle', 'filled coffin', 'facetor lens', 'rune', 'charged compass', 'incubators', 'small relics', 'medium relics',
    'large relics', 'sanctified relics', 'breachstones', 'shards', 'shard hearts', 'quest items', 'heist gear', 'heist tools',
    'heist cloaks', 'heist brooches', 'heist targets', 'incursion items', 'leaguestones', 'gold', 'idols', 'hidden items',
    'charms', 'charm', 'ultimatum', 'inscribed ultimatum', 'uncut gem', 'uncut gems', 'omen', 'socketable',
    'pinnacle keys', 'vault keys', 'mercenary warrant', 'mercenary warrants', 'embers of the allflame', 'allflame', 'metamorph samples', '未切割',
    '异界升级物品', '異界升級物品', '裂隙之石', '先祖秘藏日志', '咒符', '护符', '護符', '不灭余烬', '灾变样本', '宝库钥匙',
  ]
  if (noCategoryPrefixes.some((prefix) => key === prefix || key.startsWith(`${prefix} `))) return ''

  const startsWith: Array<[string, string]> = [
    ['body armours', 'armour.chest'], ['helmets', 'armour.helmet'], ['boots', 'armour.boots'], ['gloves', 'armour.gloves'],
    ['shields', 'armour.shield'], ['bucklers', 'armour.buckler'], ['foci', 'armour.focus'], ['quivers', 'armour.quiver'],
    ['amulets', 'accessory.amulet'], ['rings', 'accessory.ring'], ['belts', 'accessory.belt'], ['trinkets', 'accessory.trinket'],
    ['sceptres', 'weapon.sceptre'], ['quarterstaves', 'weapon.warstaff'], ['warstaves', 'weapon.warstaff'], ['staves', 'weapon.staff'],
    ['wands', 'weapon.wand'], ['spears', 'weapon.spear'], ['bows', 'weapon.bow'], ['crossbows', 'weapon.crossbow'],
    ['flails', 'weapon.flail'], ['daggers', 'weapon.basedagger'], ['rune daggers', 'weapon.runedagger'], ['claws', 'weapon.claw'],
    ['fishing rods', 'weapon.rod'], ['traps', 'weapon.trap'], ['thrusting one hand swords', 'weapon.rapier'],
    ['one hand swords', 'weapon.onesword'], ['two hand swords', 'weapon.twosword'], ['one hand axes', 'weapon.oneaxe'],
    ['two hand axes', 'weapon.twoaxe'], ['one hand maces', 'weapon.onemace'], ['two hand maces', 'weapon.twomace'],
    ['cluster jewel', 'jewel.cluster'], ['jewels', 'jewel'], ['map fragments', 'map.fragment'], ['maps', 'map'],
    ['tablet', 'map.tablet'], ['waystones', 'map.waystone'], ['blueprints', 'heistmission.blueprint'], ['contracts', 'heistmission.contract'],
    ['pieces', 'currency.piece'], ['stackable currency', 'currency'], ['utility flasks', 'flask'], ['life flasks', 'flask'],
    ['mana flasks', 'flask'], ['hybrid flasks', 'flask'], ['flasks', 'flask'], ['tinctures', 'tincture'], ['relics', 'sanctum.relic'],
    ['sanctum research', 'sanctum.research'], ['corpses', 'corpse'], ['sentinel', 'sentinel'], ['grafts', 'graft'], ['wombgifts', 'wombgift'],
  ]
  const startsWithMatch = startsWith.find(([prefix]) => key === prefix || key.startsWith(`${prefix} `))
  if (startsWithMatch) return startsWithMatch[1]

  const contains: Array<[string, string]> = [
    ['captured beast', 'monster.beast'], ['memory', 'memoryline'], ['abyss jewel', 'jewel'],
    ['utility flask', 'flask'], ['life flask', 'flask'], ['mana flask', 'flask'], ['hybrid flask', 'flask'],
  ]
  const containsMatch = contains.find(([part]) => key.includes(part))
  if (containsMatch) return containsMatch[1]
  return undefined
}

const AREA_CLASSES = new Set([
  'chronicle', 'ultimatum', 'inscribed ultimatum', 'logbook', 'expedition logbooks', 'sanctum research', 'trial coins', 'mirrored tablet',
  '禁域研究', '聖域研究', '先祖秘藏日志', '探险日志', '探險日誌',
])
const UNCUT_GEM_CLASSES = new Set([
  'uncut gem', 'uncut gems', 'uncut skill gem', 'uncut skill gems', 'uncut support gem', 'uncut support gems',
  'uncut spirit gem', 'uncut spirit gems',
])
// Xiletrade marks these named bases as special even when their item rarity
// would otherwise use the category-only path.
const SPECIAL_BASE_TYPES = new Set([
  'stygian vise', 'crystal belt', 'sacrificial garb', 'basemetal treads', 'darksteel treads',
  'brimstone treads', 'cloudwhisper boots', 'windbreak boots', 'stormrider boots', 'duskwalk slippers',
  'nightwind slippers', 'dreamquest slippers', 'taxing gauntlets', 'gruelling gauntlets',
  'debilitation gauntlets', 'spiked gloves', 'gauche gloves', 'southswing gloves', 'gripped gloves',
  'sinistral gloves', 'leyline gloves', 'aetherwind gloves', 'fingerless silk gloves',
  'nexus gloves', "apothecary's gloves", 'sorrow mask', 'atonement mask', 'penitent mask', 'imp crown', 'demon crown',
  'bone helmet', 'archdemon crown', 'gale crown', 'winter crown', 'blizzard crown',
  'exothermic tower shield', 'magmatic tower shield', 'heat-attuned tower shield', 'endothermic buckler',
  'polar buckler', 'cold-attuned buckler', 'exhausting spirit shield', 'subsuming spirit shield',
  'transfer-attuned spirit shield', 'oscillating sceptre', 'stabilising sceptre', 'alternating sceptre',
  'flare mace', 'crack mace', 'boom mace', 'blunt force condenser', 'crushing force magnifier',
  'impact force propagator', 'maltreatment axe', 'disapprobation axe', 'psychotic axe', 'vaal axe',
  'apex cleaver', 'fleshripper', 'fickle spiritblade', 'capricious spiritblade', 'anarchic spiritblade',
  'rebuking blade', 'blasting blade', 'banishing blade', 'exquisite blade', 'hedron bow', 'foundry bow',
  'solarine bow', 'shadow fangs', 'malign fangs', 'void fangs', 'hollowpoint dagger',
  'pressurised dagger', 'pneumatic dagger', 'flickerflame blade', 'flashfire blade', 'infernal blade',
  'transformer staff', 'reciprocation staff', 'battery staff', 'capacity rod', 'potentiality rod',
  'eventuality rod', 'assembler wand', 'congregator wand', 'accumulator wand', 'convoking wand',
])

function categoryFromCurrencyGroup(groupId: string | undefined): string | undefined {
  const value = normalizedKey(groupId)
  if (!value) return undefined
  if (/waystone/u.test(value)) return 'map.waystone'
  if (/tablet/u.test(value)) return 'map.tablet'
  return undefined
}

function findCurrency(currencies: XiletradeCurrencyEntry[] | undefined, value: string | undefined): XiletradeCurrencyEntry | undefined {
  const normalized = normalizedKey(value)
  if (!normalized) return undefined
  return currencies?.find((entry) => normalizedKey(entry.text) === normalized || normalizedKey(entry.id) === normalized)
}

/** Mirrors ItemFlag.GetItemCategoryApi, ByType, ByBase, Area, and useIlvl. */
export function resolveXiletradeItemQueryRouting(input: XiletradeItemContextInput): XiletradeItemQueryRouting {
  const itemClass = normalizedKey(input.itemClass)
  // ItemFlag receives the item's base/type line here, not the unique name.
  // Keep the name as a fallback for legacy snapshots that did not retain it.
  const itemType = normalizedKey(input.baseType || input.name || '')
  const itemClassOrigin = normalizedKey(input.itemClassOrigin || input.itemClass)
  const originIs = (...values: string[]) => values.some((value) => normalizedKey(value) === itemClassOrigin)
  const itemClassCategory = categoryFromItemClass(input.itemClass, input.itemClassOrigin)
  const classStartsWith = (prefix: string) => itemClass === prefix || itemClass.startsWith(`${prefix} `)
  const waystoneByType = /(?:^|[\s(])waystone(?:\s+\(\s*tier|\b)|引路石/u.test(itemType)
  const clusterByType = /cluster jewel|集群珠宝|集群珠寶|클러스터 주얼/u.test(itemType)
  // ItemFlag.GetItemCategoryApi is the source of truth. Once an item class is
  // present, an unrecognized class has the same empty category as Xiletrade;
  // a persisted tradeCategory is only valid for legacy snapshots without a
  // parsed item class.
  const categoryCandidate = itemClass
    ? itemClassCategory ?? ''
    : itemClassOrigin
      ? categoryFromItemClassOrigin(itemClassOrigin) ?? ''
      : input.tradeCategory?.trim() || undefined
  const category = clusterByType
    ? 'jewel.cluster'
    : waystoneByType && categoryCandidate === 'map' ? 'map.waystone' : categoryCandidate
  const unique = normalizedKey(input.rarity) === 'unique'
  const normal = normalizedKey(input.rarity) === 'normal'
  const foilVariant = input.foilVariant === true || normalizedKey(input.rarity) === 'uniquefoil'
  const currency = normalizedKey(input.rarity) === 'currency'
  const unidentified = input.unidentified === true || input.identified === false || itemClass === 'unidentified'
  const mapFragment = category === 'map.fragment' || classStartsWith('map fragments') || originIs('MapFragment')
  const map = category === 'map' || itemClass === 'maps' || originIs('Map') && category !== 'map.waystone'
  const miscMapItems = classStartsWith('misc map items') || originIs('MiscMapItem')
  const divcard = category === 'card' || itemClass === 'divination card' || itemClass === 'divination cards'
    || normalizedKey(input.rarity) === 'divination card' || originIs('DivinationCard')
  const capturedBeast = category === 'monster.beast' || classStartsWith('captured beast')
  const watchstone = /watchstone|守望石/u.test(itemType)
  const invitation = /invitation|邀请|邀請/u.test(itemType)
  const chargedCompass = /charged compass|充能罗盘|充能羅盤/u.test(itemType)
  const voidstone = classStartsWith('atlas upgrade items') || classStartsWith('异界升级物品') || classStartsWith('異界升級物品')
    || /voidstone|虚空石|虛空石/u.test(itemType) || originIs('AtlasUpgradeItem')
  const logbook = classStartsWith('logbook') || classStartsWith('expedition logbooks') || classStartsWith('expedition logbook')
    || /logbook|秘藏日志|秘藏日誌|先祖秘藏日志/u.test(`${itemClass} ${itemType}`)
    || originIs('ExpeditionLogbook', 'Expedition2Logbooks')
  const incubator = /incubator|孵化器/u.test(itemType) || originIs('Incubator')
  const wombgift = category === 'wombgift' || itemClass === 'wombgifts' || /wombgift/u.test(itemType)
    || originIs('Wombgift', 'BrequelFruit')
  const weapon = /^weapon(?:\.|$)/u.test(category || '')
  const armourPiece = /^(?:armour\.(?:chest|helmet|boots|gloves|shield|buckler|focus)|armour)$/u.test(category || '')
  const shield = category === 'armour.shield' || category === 'armour.buckler'
  const jewel = /^jewel(?:\.|$)/u.test(category || '')
  const flask = category === 'flask'
    || /^(?:utility|life|mana|hybrid )?flasks?$/u.test(itemClass)
    || ['功能药剂', '生命药剂', '魔力药剂'].includes(itemClass)
    || originIs('LifeFlask', 'ManaFlask', 'Flask', 'UtilityFlask')
  const charm = classStartsWith('charm') || classStartsWith('charms') || ['咒符', '护符', '護符'].includes(itemClass)
    || originIs('Charm')
  const amulet = category === 'accessory.amulet'
  const tablet = category === 'map.tablet' || itemClass === 'tablet' || originIs('TowerAugmentation')
  const waystone = category === 'map.waystone' || itemClass === 'waystones' || itemClass === '引路石' || waystoneByType || originIs('Map')
  const uncutGem = input.uncutGem === true || UNCUT_GEM_CLASSES.has(itemClass)
    || /uncut (?:spirit|skill|support) gem|未切割/u.test(itemClass)
    || originIs('UncutSkillGemStackable', 'UncutSupportGemStackable', 'UncutReservationGemStackable')
  const gems = !uncutGem && (category === 'gem' || itemClass === 'gems' || itemClass === 'skill gems' || itemClass === 'support gems'
    || originIs('Active Skill Gem', 'Support Skill Gem'))
  const area = input.area === true || AREA_CLASSES.has(itemClass) || category === 'map.barya'
    || classStartsWith('chronicle') || classStartsWith('ultimatum') || classStartsWith('logbook')
    || classStartsWith('sanctum research') || classStartsWith('trial coins') || classStartsWith('mirrored tablet')
    || /chronicle|ultimatum|logbook|sanctum research|trial coins|mirrored tablet|编年史|编年史|终局试炼|禁域研究/u.test(itemType)
    || originIs('ExpeditionLogbook', 'Expedition2Logbooks', 'TrialCoins', 'ItemisedSanctum', 'SanctumResearch')
  const jewellery = category === 'accessory.amulet' || category === 'accessory.ring' || category === 'accessory.belt' || category === 'accessory.trinket'
  const itemSocketable = weapon || armourPiece || category === 'armour.quiver'
  const byType = jewellery || itemSocketable
  const tincture = category === 'tincture' || itemClass === 'tinctures' || itemClass === 'tincture' || itemClass === '酊剂'
  const graft = category === 'graft' || itemClass === 'grafts' || itemClass === 'graft'
  const currencyClass = classStartsWith('currency') || classStartsWith('stackable currency')
    || classStartsWith('delve stackable socketable currency') || classStartsWith('pieces')
    || classStartsWith('可堆叠通货') || classStartsWith('可堆疊通貨') || classStartsWith('片段')
    || originIs('Currency', 'StackableCurrency', 'UniqueFragment', 'Pieces', 'DelveStackableSocketableCurrency')
  const exchangeCurrency = !unidentified && !map && !waystone && !tablet && !capturedBeast && !wombgift && !incubator && !invitation
    && (input.exchangeCurrency === true
      || currencyClass)
  // FormViewModel also forces base mode for PoE2 skill weapons and the
  // named special bases list. The app only targets PoE2, so both are active.
  const skillWeapon = ['weapon.wand', 'weapon.staff', 'weapon.warstaff', 'weapon.sceptre'].includes(category || '')
  const specialBase = SPECIAL_BASE_TYPES.has(normalizedKey(input.baseType))
  const byBase = unique || foilVariant || normal || currency || map || waystone || divcard || capturedBeast || gems || flask
    || category === 'chart'
    || tincture || invitation || logbook || tablet || charm || graft || unidentified
    || skillWeapon || specialBase
  // JsonDataTwoFactory only places the common level control in ilvl for
  // weapons, armour, jewellery slots and uncut gems. Skill gems and area
  // items use their dedicated misc_filters controls instead.
  const belt = category === 'accessory.belt'
  const ring = category === 'accessory.ring'
  const quiver = category === 'armour.quiver'
  const useItemLevel = weapon || armourPiece || amulet || belt || ring || quiver || uncutGem
  return {
    tradeCategory: category,
    unique, normal, currency, divcard, foilVariant, unidentified, map, mapFragment, miscMapItems, capturedBeast,
    watchstone, invitation, chargedCompass, voidstone, logbook, exchangeCurrency, incubator, wombgift,
    weapon, armourPiece, shield, jewel, flask, charm, amulet, tablet, waystone, gems, uncutGem, area,
    skillWeapon, specialBase,
    byType, byBase, useItemLevel,
  }
}

function resolveItemContext(bundle: XiletradeCatalogBundle, input: XiletradeItemContextInput): XiletradeItemContext {
  const displayBases = bundle.display.bases || []
  const canonicalBases = bundle.canonical.bases || []
  const displayWords = bundle.display.words || []
  const canonicalWords = bundle.canonical.words || []
  const displayItems = bundle.display.items || []
  const canonicalItems = bundle.canonical.items || []
  const displayCurrency = findCurrency(bundle.display.currencies, input.baseType) || findCurrency(bundle.canonical.currencies, input.baseType)
  const canonicalCurrency = displayCurrency
    ? findCurrency(bundle.canonical.currencies, displayCurrency.id) || displayCurrency
    : undefined
  const displayBase = displayBases.find((entry) => normalizedKey(entry.name) === normalizedKey(input.baseType)
    || normalizedKey(entry.name_en) === normalizedKey(input.baseType))
  const canonicalBase = displayBase
    ? canonicalBases.find((entry) => entry.id === displayBase.id) || displayBase
    : canonicalBases.find((entry) => normalizedKey(entry.name_en) === normalizedKey(input.baseType))
  const baseItemClass = canonicalBase?.id_class == null
    ? undefined
    : bundle.canonical.itemClasses?.find((entry) => entry.id === canonicalBase.id_class)
  let canonicalName = input.name || ''
  const displayWord = displayWords.find((entry) => normalizedKey(entry.name) === normalizedKey(input.name))
  if (displayWord) {
    canonicalName = canonicalWords.find((entry) => String(entry.id) === String(displayWord.id))?.name_en || displayWord.name_en || canonicalName
  }
  let broadCategory = ''
  let canonicalItemType: string | undefined
  for (let groupIndex = 0; groupIndex < displayItems.length; groupIndex += 1) {
    const group = displayItems[groupIndex]
    const entryIndex = group.entries.findIndex((entry) => normalizedKey(entry.type) === normalizedKey(input.baseType)
      || (entry.name && normalizedKey(entry.name) === normalizedKey(input.name)))
    if (entryIndex < 0) continue
    broadCategory = group.id
    // ItemsTwo has no stable ID for ordinary base entries and its localized
    // arrays are not guaranteed to have the same order. Only use it as a
    // category source; canonical identity must come from BasesTwo or
    // CurrencyTwo. The canonical catalog itself is safe because it is the
    // same locale here.
    if (bundle.display.locale === 'en-US') {
      const canonicalEntry = canonicalItems.find((candidate) => candidate.id === group.id)?.entries[entryIndex]
      canonicalItemType = canonicalEntry?.type
      if (canonicalEntry?.name) canonicalName = canonicalEntry.name
    }
    break
  }
  const hasExplicitItemClass = Boolean(normalizedKey(input.itemClass) || normalizedKey(input.itemClassOrigin))
  const itemClassOrigin = input.itemClassOrigin
    || itemClassOriginFromCatalog(bundle, input.itemClass)
    || (!hasExplicitItemClass ? baseItemClass?.id_origin : undefined)
  const itemClassCategory = categoryFromItemClass(input.itemClass, itemClassOrigin)
  const resolvedClassCategory = itemClassCategory ?? categoryFromItemClassOrigin(itemClassOrigin)
  const groupCategory = broadCategory === 'weapon' || broadCategory === 'armour' || broadCategory === 'map'
    ? broadCategory
    : broadCategory === 'currency' ? 'currency'
      : broadCategory === 'flask' ? 'flask'
        : broadCategory === 'gem' ? 'gem'
          : broadCategory === 'jewel' ? 'jewel'
            : broadCategory === 'wombgift' ? 'wombgift' : undefined
  const canonicalBaseType = canonicalCurrency?.text || canonicalItemType || canonicalBase?.name_en || input.baseType || ''
  // This mirrors GetItemCategoryApi: an explicit item class is authoritative
  // even when Xiletrade returns an empty category for that class. For older
  // snapshots without an item class, BasesTwo.id_class is the only supported
  // base-derived source. The old base-name regex fallback was intentionally
  // removed because it could route unrelated items into the wrong category.
  const tradeCategory = hasExplicitItemClass || baseItemClass
    ? resolvedClassCategory ?? ''
    : input.tradeCategory?.trim()
      || categoryFromCurrencyGroup(canonicalCurrency?.groupId || displayCurrency?.groupId)
      || groupCategory
  // ItemState.SpecialBase and the PoE2 skill-weapon exception are evaluated
  // against the canonical base identity, including when the clipboard was
  // localized. Do not route a Chinese base using its display text.
  const routingInput = {
    ...input,
    ...(itemClassOrigin ? { itemClassOrigin } : {}),
    name: canonicalName || input.name,
    baseType: canonicalBaseType || input.baseType,
    tradeCategory,
  }
  const preliminaryRouting = resolveXiletradeItemQueryRouting(routingInput)
  const exchangeCurrency = Boolean(displayCurrency)
    && !preliminaryRouting.unidentified
    && !preliminaryRouting.map
    && !preliminaryRouting.waystone
    && !preliminaryRouting.tablet
    && !preliminaryRouting.capturedBeast
    && !preliminaryRouting.wombgift
    && !preliminaryRouting.incubator
    && !preliminaryRouting.invitation
  const routing = resolveXiletradeItemQueryRouting({ ...routingInput, exchangeCurrency })
  const flags: XiletradeItemFlags = {
    unique: routing.unique,
    normal: routing.normal,
    currency: routing.currency,
    divcard: routing.divcard,
    foilVariant: routing.foilVariant,
    unidentified: routing.unidentified,
    map: routing.map,
    mapFragment: routing.mapFragment,
    miscMapItems: routing.miscMapItems,
    capturedBeast: routing.capturedBeast,
    watchstone: routing.watchstone,
    invitation: routing.invitation,
    chargedCompass: routing.chargedCompass,
    voidstone: routing.voidstone,
    logbook: routing.logbook,
    exchangeCurrency: routing.exchangeCurrency,
    incubator: routing.incubator,
    wombgift: routing.wombgift,
    weapon: routing.weapon,
    armourPiece: routing.armourPiece,
    shield: routing.shield,
    jewel: routing.jewel,
    flask: routing.flask,
    charm: routing.charm,
    amulet: routing.amulet,
    tablet: routing.tablet,
    waystone: routing.waystone,
    gems: routing.gems,
    uncutGem: routing.uncutGem,
    area: routing.area,
    skillWeapon: routing.skillWeapon,
    specialBase: routing.specialBase,
    byType: routing.byType,
    byBase: routing.byBase,
    useItemLevel: routing.useItemLevel,
  }
  return {
    ...input,
    itemClass: input.itemClass,
    ...(itemClassOrigin ? { itemClassOrigin } : {}),
    tradeCategory: routing.tradeCategory,
    exchangeCurrency,
    canonicalName,
    canonicalBaseType,
    flags,
  }
}

const POE2 = {
  recoverMana: ['explicit.stat_1030153674', 'explicit.stat_1604736568'],
  incArmour: ['explicit.stat_1062208444', 'explicit.stat_2866361420'],
  incEvasion: ['explicit.stat_124859000', 'explicit.stat_2106365538'],
  duration: ['explicit.stat_1256719186', 'explicit.stat_2541588185'],
  charmSlotLocal: ['explicit.stat_1416292992', 'explicit.stat_554899692'],
  charmSlotUnique: ['explicit.stat_2582079000', 'explicit.stat_554899692'],
  attackSpeed: ['explicit.stat_210067635', 'explicit.stat_681332047'],
  evasion: ['explicit.stat_53045048', 'explicit.stat_2144192055'],
  block: ['explicit.stat_2481353198', 'explicit.stat_4147897060'],
  armour: ['explicit.stat_3484657501', 'explicit.stat_809229260'],
  energyShield: ['explicit.stat_4052037485', 'explicit.stat_3489782002'],
  xp: ['explicit.stat_3666934677', 'explicit.stat_57434274'],
  poison: ['explicit.stat_3885634897', 'explicit.stat_795138349'],
  accuracy: ['explicit.stat_691932474', 'explicit.stat_803737631'],
  delirium: ['explicit.stat_1174954559', 'explicit.stat_3226351972'],
  armourEnchant: ['enchant.stat_1062208444', 'enchant.stat_2866361420'],
  evasionEnchant: ['enchant.stat_124859000', 'enchant.stat_2106365538'],
  shrineTablet: ['explicit.stat_3042527515', 'explicit.stat_1468737867'],
  essenceTablet: ['explicit.stat_2162684861', 'explicit.stat_395808938'],
} as const

function choosePair(ids: string[], pair: readonly [string, string], first: boolean): string[] {
  if (!ids.some((id) => pair.includes(id as never))) return ids
  return [first ? pair[0] : pair[1]]
}

function chooseSuffixPair(ids: string[], pair: readonly [string, string], first: boolean): string[] {
  const source = ids.find((id) => id.endsWith(pair[0]) || id.endsWith(pair[1]))
  if (!source) return ids
  const prefix = source.slice(0, source.lastIndexOf('.') + 1)
  return [`${prefix}${first ? pair[0] : pair[1]}`]
}

function disambiguatePoe2(ids: string[], context: XiletradeItemContext): string[] {
  const { flags } = context
  const name = normalizedKey(context.canonicalName)
  const named = (...values: string[]) => values.some((value) => name === normalizedKey(value))
  let result = [...ids]
  result = choosePair(result, POE2.xp, !(flags.waystone || flags.tablet))
  result = choosePair(result, POE2.delirium, !(flags.waystone || flags.tablet))
  if (flags.flask) result = choosePair(result, POE2.duration, true)
  if (flags.charm) result = choosePair(result, POE2.duration, false)
  result = choosePair(result, ['skill.lightning_bolt', 'skill.unique_breach_lightning_bolt'], !(flags.unique && flags.amulet))
  result = choosePair(result, POE2.recoverMana, !flags.jewel)
  result = choosePair(result, POE2.block, flags.shield)
  result = choosePair(result, POE2.attackSpeed, flags.weapon)
  result = choosePair(result, POE2.accuracy, flags.weapon)
  result = choosePair(result, POE2.poison, flags.weapon)
  result = choosePair(result, POE2.incArmour, flags.armourPiece)
  result = choosePair(result, POE2.incEvasion, flags.armourPiece)
  result = choosePair(result, POE2.evasion, flags.armourPiece)
  result = choosePair(result, POE2.armour, flags.armourPiece)
  result = choosePair(result, POE2.energyShield, flags.armourPiece)
  result = choosePair(result, POE2.armourEnchant, flags.armourPiece)
  result = choosePair(result, POE2.evasionEnchant, flags.armourPiece)
  result = choosePair(result, POE2.charmSlotLocal, !flags.armourPiece)
  if (flags.weapon && result.some((id) => ['explicit.stat_720908147', 'explicit.stat_889691035', 'explicit.stat_2241560081'].includes(id))) result = ['explicit.stat_889691035']
  else if (!flags.weapon && result.some((id) => ['explicit.stat_720908147', 'explicit.stat_889691035', 'explicit.stat_2241560081'].includes(id))) result = ['explicit.stat_720908147']
  result = chooseSuffixPair(result, ['stat_1379411836', 'stat_2897413282'], !flags.weapon)
  const overseer = normalizedKey(context.canonicalBaseType) === 'overseer tablet'
  result = choosePair(result, POE2.shrineTablet, overseer)
  result = choosePair(result, POE2.essenceTablet, overseer)
  result = chooseSuffixPair(result, ['stat_2704225257', 'stat_3981240776'], named('The Unborn Lich'))
  result = chooseSuffixPair(result, ['stat_1416406066', 'stat_3984865854'], named('Grip of Kulemak', 'Idol of Uldurn'))
  result = chooseSuffixPair(result, ['stat_774059442', 'stat_3336230913'], named('Svalinn'))
  result = choosePair(result, ['explicit.stat_1315418254', 'explicit.stat_3831171903|33'], named("Geofri's Sanctuary"))
  result = choosePair(result, ['explicit.stat_2080373320', 'explicit.stat_1464727508'], named('Vestige of Darkness'))
  if (flags.unique && result.some((id) => ['explicit.stat_2261942307', 'explicit.stat_1602191394', 'explicit.stat_3917489142'].includes(id))) {
    result = [named('Loreweave') ? 'explicit.stat_2261942307' : named('Gravebind') ? 'explicit.stat_1602191394' : 'explicit.stat_3917489142']
  }
  result = choosePair(result, ['explicit.stat_2257118425', 'explicit.stat_3831171903|20'], named("Atziri's Acuity"))
  result = choosePair(result, ['explicit.stat_2933846633', 'explicit.stat_3146310524'], named("Nazir's Judgement"))
  result = choosePair(result, ['explicit.stat_1157523820', 'explicit.stat_2045949233'], !named("Hrimnor's Hymn"))
  result = choosePair(result, ['explicit.stat_2625554454', 'explicit.stat_2879778895'], !named('The Hammer of Faith'))
  result = choosePair(result, POE2.charmSlotUnique, !named('Elevore'))
  result = choosePair(result, ['skill.corpse_cloud_triggered', 'skill.corpse_cloud'], named('Corpsewade'))
  if (result.includes('explicit.stat_448592698|160')) result = ['explicit.stat_448592698|161']
  if (result.includes('explicit.stat_448592698|186')) result = ['explicit.stat_448592698|199']
  if (result.includes('explicit.stat_448592698|193')) result = ['explicit.stat_448592698|201']
  const flesh = named('Flesh Crucible')
  for (const pair of [
    ['explicit.stat_3831171903|7', 'explicit.stat_98977150'],
    ['explicit.stat_3831171903|2', 'explicit.stat_1875158664'],
    ['explicit.stat_3831171903|3', 'explicit.stat_1683578560'],
    ['explicit.stat_3831171903|9', 'explicit.stat_2262736444'],
    ['explicit.stat_3831171903|5', 'explicit.stat_2801937280'],
    ['explicit.stat_3831171903|21', 'explicit.stat_326965591'],
    ['explicit.stat_3831171903|22', 'explicit.stat_4266776872'],
  ] as const) result = choosePair(result, pair, flesh)
  return [...new Set(result)]
}

/**
 * Xiletrade changes the generic pseudo "adds damage" ID to its
 * `_to_attacks` variant for weapons before looking it up in FiltersTwo.
 * Keep that distinction here so weapon price checks do not search the spell
 * version of the same pseudo stat.
 */
function selectWeaponPseudoStats(ids: string[], context: XiletradeItemContext, availableIds: ReadonlySet<string>): string[] {
  if (!context.flags.weapon) return ids
  return [...new Set(ids.map((id) => {
    if (!/^pseudo\.pseudo_adds_[a-z]+_damage$/u.test(id)) return id
    const attackId = `${id}_to_attacks`
    return availableIds.has(attackId) ? attackId : id
  }))]
}

export class XiletradeDataCatalog {
  private readonly catalogs = new Map<XiletradeLocale, XiletradeCatalog>()
  private readonly manifest: Manifest

  constructor(private readonly root: string) {
    this.manifest = parseJson<Manifest>(path.join(root, 'manifest.json'))
    if (this.manifest.schemaVersion !== 2 || !this.manifest.upstreamCommit) throw new Error('Unsupported Xiletrade data manifest')
  }

  get(locale: LibraryTextLocale | XiletradeLocale): XiletradeCatalog {
    const key = locale in localeMap ? localeMap[locale as LibraryTextLocale] : locale as XiletradeLocale
    const existing = this.catalogs.get(key)
    if (existing) return existing
    const filters = parseJson<{ result?: Array<{ entries?: XiletradeFilterEntry[] }> }>(path.join(this.root, key, 'FiltersTwo.json'))
    const parsing = parseJson<{ mods?: XiletradeParsingRule[] }>(path.join(this.root, key, 'ParsingRules.json'))
    const bases = parseJson<{ result?: Array<{ data?: XiletradeBaseEntry[] }> }>(path.join(this.root, key, 'BasesTwo.json'))
    const words = parseJson<{ result?: Array<{ data?: XiletradeWordEntry[] }> }>(path.join(this.root, key, 'WordsTwo.json'))
    const items = parseJson<{ result?: XiletradeItemGroup[] }>(path.join(this.root, key, 'ItemsTwo.json'))
    const mods = parseJson<{ result?: Array<{ data?: Array<Record<string, unknown>> }> }>(path.join(this.root, key, 'ModsTwo.json'))
    const currencies = parseJson<{ result?: Array<{ id?: string; entries?: Array<{ id?: string; text?: string; image?: string }> }> }>(path.join(this.root, key, 'CurrencyTwo.json'))
    const itemClassesFile = path.join(this.root, key, 'ItemClassTwo.json')
    const itemClasses = existsSync(itemClassesFile)
      ? parseJson<{ item_class?: XiletradeItemClassEntry[] }>(itemClassesFile).item_class
      : undefined
    const catalog = {
      locale: key,
      upstreamCommit: this.manifest.upstreamCommit,
      entries: (filters.result || []).flatMap((group) => group.entries || []),
      rules: (parsing.mods || []).filter((rule) => !rule.disabled),
      bases: (bases.result || []).flatMap((group) => group.data || []),
      words: (words.result || []).flatMap((group) => group.data || []),
      items: items.result || [],
      ...(itemClasses ? { itemClasses } : {}),
      mods: (mods.result || []).flatMap((group) => group.data || []),
      currencies: (currencies.result || []).flatMap((group) => (group.entries || []).flatMap((entry) => {
        if (!entry.id || !entry.text) return []
        return [{
          id: entry.id,
          text: entry.text,
          ...(group.id ? { groupId: group.id } : {}),
          ...(entry.image ? { image: entry.image } : {}),
        }]
      })),
    }
    this.catalogs.set(key, catalog)
    return catalog
  }

  bundle(locale: LibraryTextLocale): XiletradeCatalogBundle {
    return { display: this.get(locale), canonical: this.get('en-US') }
  }

  /** Resolves a localized base name through the stable Xiletrade base ID. */
  resolveBaseType(locale: LibraryTextLocale, value: string): string | undefined {
    const normalized = normalizedKey(value)
    if (!normalized) return undefined
    const preferred = locale in localeMap ? localeMap[locale as LibraryTextLocale] : locale as XiletradeLocale
    const locales: XiletradeLocale[] = [preferred, 'zh-CN', 'zh-TW', 'ko-KR', 'en-US']
    const canonicalBases = this.get('en-US').bases || []
    for (const candidateLocale of [...new Set(locales)]) {
      const displayBases = this.get(candidateLocale).bases || []
      const displayBase = displayBases.find((entry) => (
        normalizedKey(entry.name) === normalized || normalizedKey(entry.name_en) === normalized
      ))
      if (!displayBase) continue
      return canonicalBases.find((entry) => entry.id === displayBase.id)?.name_en || displayBase.name_en
    }
    // ItemsTwo has no stable ID for ordinary bases and localized files can
    // have different ordering. Never translate a base by array position.
    const canonicalCurrencies = this.get('en-US').currencies || []
    for (const candidateLocale of [...new Set(locales)]) {
      const currency = findCurrency(this.get(candidateLocale).currencies, value)
      if (!currency) continue
      return canonicalCurrencies.find((entry) => entry.id === currency.id)?.text || currency.text
    }
    return undefined
  }

  resolveItemContext(locale: LibraryTextLocale, input: XiletradeItemContextInput): XiletradeItemContext {
    return resolveItemContext(this.bundle(locale), input)
  }
}

export class XiletradeModifierMatcher {
  private readonly canonicalById = new Map<string, XiletradeFilterEntry>()
  private readonly kinds = new Map<string, XiletradeFilterEntry[]>()
  private readonly displayIds: ReadonlySet<string>

  constructor(private readonly bundle: XiletradeCatalogBundle) {
    this.displayIds = new Set(bundle.display.entries.map((entry) => entry.id))
    for (const entry of bundle.canonical.entries) this.canonicalById.set(entry.id, entry)
    for (const entry of bundle.display.entries) {
      const kind = templateKind(entry.text)
      const list = this.kinds.get(kind) || []
      list.push(entry)
      this.kinds.set(kind, list)
    }
  }

  match(source: string, group: LibraryModifierGroup, contextInput: XiletradeItemContextInput | string = {}, nextLine = ''): CanonicalStatMatch | undefined {
    const context = resolveItemContext(this.bundle, typeof contextInput === 'string' ? { itemClass: contextInput } : contextInput)
    const itemClass = `${context.itemClass || ''} ${context.flags.weapon ? 'weapon' : ''} ${context.flags.armourPiece ? 'armour' : ''}`
    const normalized = normalizeSpace(source)
    // Clipboard-only annotations describe roll scaling or a skill's level cap;
    // neither is part of the trade stat template used for matching.
    const ruled = normalizeSpace(normalizeLegacyPobTradeText(stripXiletradePresentationSuffixes(applyRules(normalized, this.bundle.display.rules))))
    const scope = scopeFor(group)
    let matchSource = ruled
    let valueSource = ruled
    let kinds = localCandidateKinds(templateKind(matchSource), itemClass, this.bundle.display.locale)
    let matches: XiletradeFilterEntry[] = []
    for (const kind of kinds) {
      matches = this.kinds.get(kind) || []
      if (matches.length) break
    }
    if (!matches.length) {
      const negative = negativeIncreasedVariant(ruled, this.bundle.display.locale)
      if (negative) {
        matchSource = negative.matchText
        valueSource = negative.valueText
        kinds = localCandidateKinds(templateKind(matchSource), itemClass, this.bundle.display.locale)
        for (const kind of kinds) {
          matches = this.kinds.get(kind) || []
          if (matches.length) break
        }
      }
    }
    if (!matches.length && nextLine) {
      const first = templateKind(ruled.split('\n')[0])
      matches = [...this.bundle.display.entries].filter((entry) => templateKind(entry.text).startsWith(`${first}\n`)
        && templateKind(entry.text).includes(templateKind(nextLine)))
    }
    const scoped = matches.filter((entry) => entry.id.split('.')[0] === scope || (scope === 'rune' && entry.type === 'augment'))
    if (scoped.length) matches = scoped
    if (matches.length > 1 && matches.some((entry) => !entry.part)) matches = matches.filter((entry) => !entry.part)
    matches = [...new Map(matches.map((entry) => [entry.id, entry])).values()]
    if (!matches.length) return undefined
    const candidateStatIds = selectWeaponPseudoStats(disambiguatePoe2(matches.map((entry) => entry.id), context), context, this.displayIds)
    const selected = candidateStatIds.length === 1
      ? this.bundle.display.entries.find((entry) => entry.id === candidateStatIds[0]) || matches.find((entry) => entry.id === candidateStatIds[0]) || matches[0]
      : matches[0]
    const canonical = this.canonicalById.get(candidateStatIds.length === 1 ? candidateStatIds[0] : selected.id)
    if (!canonical) return undefined
    return {
      canonicalText: fillTemplate(canonical.text.replace(/ \(Local\)$/i, ''), valueSource),
      queryStatId: candidateStatIds.length === 1 ? candidateStatIds[0] : undefined,
      candidateStatIds,
    }
  }
}

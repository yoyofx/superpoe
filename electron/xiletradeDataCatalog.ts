import { readFileSync } from 'node:fs'
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
  mods?: Array<Record<string, unknown>>
  currencies?: Array<Record<string, unknown>>
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

export interface XiletradeItemContextInput {
  itemClass?: string
  tradeCategory?: string
  rarity?: string
  name?: string
  baseType?: string
}

export interface XiletradeItemFlags {
  unique: boolean
  weapon: boolean
  armourPiece: boolean
  shield: boolean
  jewel: boolean
  flask: boolean
  charm: boolean
  amulet: boolean
  tablet: boolean
  waystone: boolean
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

function categoryFromBase(base: XiletradeBaseEntry | undefined, broadCategory = ''): string | undefined {
  const value = `${base?.id || ''} ${base?.inherits_from || ''}`.toLocaleLowerCase()
  const match = (pattern: RegExp, category: string) => pattern.test(value) ? category : undefined
  return match(/sceptre/u, 'weapon.sceptre')
    || match(/quarterstaff|warstaff/u, 'weapon.warstaff')
    || match(/\/staves\/|abstractstaff/u, 'weapon.staff')
    || match(/wand/u, 'weapon.wand')
    || match(/spear/u, 'weapon.spear')
    || match(/crossbow/u, 'weapon.crossbow')
    || match(/bow/u, 'weapon.bow')
    || match(/flail/u, 'weapon.flail')
    || match(/dagger/u, 'weapon.basedagger')
    || match(/claw/u, 'weapon.claw')
    || match(/twohand.*axe|twohandaxes/u, 'weapon.twoaxe')
    || match(/twohand.*mace|twohandmaces|greathammer|greatclub|maul/u, 'weapon.twomace')
    || match(/twohand.*sword|twohandswords/u, 'weapon.twosword')
    || match(/onehand.*axe|onehandaxes/u, 'weapon.oneaxe')
    || match(/onehand.*mace|onehandmaces/u, 'weapon.onemace')
    || match(/onehand.*sword|onehandswords/u, 'weapon.onesword')
    || match(/bodyarmour/u, 'armour.chest')
    || match(/helmet/u, 'armour.helmet')
    || match(/gloves/u, 'armour.gloves')
    || match(/boots/u, 'armour.boots')
    || match(/buckler/u, 'armour.buckler')
    || match(/shield/u, 'armour.shield')
    || match(/focus|foci/u, 'armour.focus')
    || match(/quiver/u, 'armour.quiver')
    || match(/amulet/u, 'accessory.amulet')
    || match(/ring/u, 'accessory.ring')
    || match(/belt/u, 'accessory.belt')
    || match(/jewel/u, 'jewel')
    || match(/tablet|toweraugment/u, 'map.tablet')
    || match(/waystone/u, 'map.waystone')
    || (broadCategory ? broadCategory : undefined)
}

function resolveItemContext(bundle: XiletradeCatalogBundle, input: XiletradeItemContextInput): XiletradeItemContext {
  const displayBases = bundle.display.bases || []
  const canonicalBases = bundle.canonical.bases || []
  const displayWords = bundle.display.words || []
  const canonicalWords = bundle.canonical.words || []
  const displayItems = bundle.display.items || []
  const canonicalItems = bundle.canonical.items || []
  const displayBase = displayBases.find((entry) => normalizedKey(entry.name) === normalizedKey(input.baseType)
    || normalizedKey(entry.name_en) === normalizedKey(input.baseType))
  const canonicalBase = displayBase
    ? canonicalBases.find((entry) => entry.id === displayBase.id) || displayBase
    : canonicalBases.find((entry) => normalizedKey(entry.name_en) === normalizedKey(input.baseType))
  let canonicalName = input.name || ''
  const displayWord = displayWords.find((entry) => normalizedKey(entry.name) === normalizedKey(input.name))
  if (displayWord) {
    canonicalName = canonicalWords.find((entry) => String(entry.id) === String(displayWord.id))?.name_en || displayWord.name_en || canonicalName
  }
  let broadCategory = ''
  for (let groupIndex = 0; groupIndex < displayItems.length; groupIndex += 1) {
    const group = displayItems[groupIndex]
    const entryIndex = group.entries.findIndex((entry) => normalizedKey(entry.type) === normalizedKey(input.baseType)
      || (entry.name && normalizedKey(entry.name) === normalizedKey(input.name)))
    if (entryIndex < 0) continue
    broadCategory = group.id
    const canonicalEntry = canonicalItems.find((candidate) => candidate.id === group.id)?.entries[entryIndex]
    if (canonicalEntry?.name) canonicalName = canonicalEntry.name
    break
  }
  const canonicalBaseType = canonicalBase?.name_en || input.baseType || ''
  const tradeCategory = input.tradeCategory || categoryFromBase(canonicalBase, broadCategory)
  const source = normalizedKey(`${input.itemClass || ''} ${tradeCategory || ''} ${broadCategory} ${canonicalBase?.id || ''} ${canonicalBase?.inherits_from || ''}`)
  const flags: XiletradeItemFlags = {
    unique: /unique|relic/u.test(normalizedKey(input.rarity)),
    weapon: /^weapon(?:\.|$)/u.test(tradeCategory || '') || broadCategory === 'weapon' || /weapons?|bow|crossbow|staff|stave|wand|sceptre|mace|axe|sword|dagger|claw|spear|flail|quarterstaff|warstaff|法杖|节杖|權杖|弓|弩|杖|锤|錘|斧|剑|劍|匕首|爪|矛|连枷|連枷|무기|활|석궁|지팡이|철퇴|도끼|검|단검|클로|창/u.test(source),
    armourPiece: /^armour(?:\.|$)/u.test(tradeCategory || '') || broadCategory === 'armour' || /body armour|helmet|gloves|boots|shield|buckler|focus|护甲|護甲|头盔|頭盔|手套|鞋|盾|방어구|투구|장갑|장화|방패/u.test(source),
    shield: /^armour\.(?:shield|buckler)$/u.test(tradeCategory || '') || /shield|buckler|盾|방패/u.test(source),
    jewel: /^jewel(?:\.|$)/u.test(tradeCategory || '') || broadCategory === 'jewel' || /jewel|珠宝|珠寶|주얼/u.test(source),
    flask: broadCategory === 'flask' || /flask|药剂|藥劑|플라스크/u.test(source),
    charm: /charm|护符|護符|부적/u.test(source),
    amulet: tradeCategory === 'accessory.amulet' || /amulet|项链|項鍊|목걸이/u.test(source),
    tablet: tradeCategory === 'map.tablet' || /tablet|碑牌|서판/u.test(source),
    waystone: tradeCategory === 'map.waystone' || /waystone|引路石|경로석/u.test(source),
  }
  return { ...input, itemClass: input.itemClass, tradeCategory, canonicalName, canonicalBaseType, flags }
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
    const currencies = parseJson<{ result?: Array<{ entries?: Array<Record<string, unknown>> }> }>(path.join(this.root, key, 'CurrencyTwo.json'))
    const catalog = {
      locale: key,
      upstreamCommit: this.manifest.upstreamCommit,
      entries: (filters.result || []).flatMap((group) => group.entries || []),
      rules: (parsing.mods || []).filter((rule) => !rule.disabled),
      bases: (bases.result || []).flatMap((group) => group.data || []),
      words: (words.result || []).flatMap((group) => group.data || []),
      items: items.result || [],
      mods: (mods.result || []).flatMap((group) => group.data || []),
      currencies: (currencies.result || []).flatMap((group) => group.entries || []),
    }
    this.catalogs.set(key, catalog)
    return catalog
  }

  bundle(locale: LibraryTextLocale): XiletradeCatalogBundle {
    return { display: this.get(locale), canonical: this.get('en-US') }
  }

  resolveItemContext(locale: LibraryTextLocale, input: XiletradeItemContextInput): XiletradeItemContext {
    return resolveItemContext(this.bundle(locale), input)
  }
}

export class XiletradeModifierMatcher {
  private readonly canonicalById = new Map<string, XiletradeFilterEntry>()
  private readonly kinds = new Map<string, XiletradeFilterEntry[]>()

  constructor(private readonly bundle: XiletradeCatalogBundle) {
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
    const candidateStatIds = disambiguatePoe2(matches.map((entry) => entry.id), context)
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

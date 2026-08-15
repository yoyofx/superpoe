import type {
  CanonicalItemView, ItemParseEvidence, LibraryModifierGroup, LibraryModifierTag, LibraryTextLocale,
  ParsedItemModifierEvidence,
} from '../src/types/market.js'

export const XILETRADE_UPSTREAM_COMMIT = 'c16c145f30aced5aa667456dd5f6897a2af3af3b'

export interface CanonicalStatMatch {
  canonicalText: string
  queryStatId?: string
  candidateStatIds?: string[]
}

export interface XiletradeItemParserLanguage {
  locale: LibraryTextLocale
  toEnglish(value: string): string | undefined
  statToEnglish(value: string): string | undefined
}

export interface XiletradeItemParserOptions {
  strict?: boolean
  language: XiletradeItemParserLanguage
  canonicalizeStat?: (value: string, group: LibraryModifierGroup, context?: CanonicalStatContext, nextLine?: string) => CanonicalStatMatch | undefined
  parsingRules?: XiletradeParsingRule[]
  upstreamCommit?: string
  now?: () => string
}

export interface CanonicalStatContext {
  itemClass?: string
  rarity?: string
  name?: string
  baseType?: string
  tradeCategory?: string
}

export interface XiletradeParsingRule {
  replace: 'equals' | 'contains'
  old: string
  new: string
  disabled?: boolean
}

export interface XiletradeItemParseResult {
  raw: string
  unresolved: string[]
  evidence: ItemParseEvidence
  localized: { name: string; baseType: string }
}

interface ParsedModifier {
  canonicalText: string
  evidence: ParsedItemModifierEvidence
  implicit: boolean
}

/** Merge parser evidence into the Lua-normalized display projection. */
export function applyXiletradeParseEvidence(view: CanonicalItemView, evidence: ItemParseEvidence | undefined): CanonicalItemView {
  if (!evidence) return view
  if (evidence.itemClass) view.itemClass = evidence.itemClass
  const claimed = new Set<number>()
  for (const parsed of evidence.modifiers) {
    if (!parsed.canonicalText || parsed.status === 'unresolved') continue
    const canonicalLines = parsed.canonicalText.split('\n').map((line) => line.trim()).filter(Boolean)
    const modifierIndex = view.modifiers.findIndex((modifier, index) => (
      !claimed.has(index) && (modifier.text === parsed.canonicalText || canonicalLines.includes(modifier.text))
    ))
    if (modifierIndex < 0) continue
    claimed.add(modifierIndex)
    const modifier = view.modifiers[modifierIndex]
    const statIds = parsed.queryStatId ? [parsed.queryStatId] : parsed.candidateStatIds
    view.modifiers[modifierIndex] = {
      ...modifier,
      group: parsed.group,
      sourceTags: parsed.sourceTags,
      localized: { ...modifier.localized, [parsed.original.locale]: parsed.original.displayText },
      tradeStatIds: [...new Set(statIds)],
      ...(parsed.currentValues[0] != null ? { tradeValue: parsed.currentValues[0] } : {}),
    }
  }
  return view
}

const FIELD_LINE = /^(?:物品类别|物品類別|아이템 종류|稀有度|Rarity|品质|品質|Quality|物理伤害|物理傷害|Physical Damage|元素伤害|元素傷害|Elemental Damage|暴击率|暴擊率|Critical Hit Chance|每秒攻击次数|每秒攻擊次數|Attacks per Second|需求|Requirements?|插槽|Sockets?|物品等级|物品等級|Item Level|仅限|僅限|Limited to|范围|範圍|Radius|품질|소켓|요구|아이템 레벨|물리 피해|원소 피해|치명타 확률|초당 공격 횟수)\s*[：:]/iu
const FOOTER_LINE = /^(?:Corrupted|Twice Corrupted|Sanctified|Sanctified Item|已腐化|已污染|被腐化|双重腐化|雙重腐化|圣化|聖化|圣化物品|Split|分裂|分裂之物|引路石掉落|Waystone Drop|타락|이중 타락|분열|웨이스톤 드롭)$/iu
const PROPERTY_LINE = /^(?:Requirements?|Sockets?|Quality|Physical Damage|Elemental Damage|Critical Hit Chance|Attacks per Second|Weapon Range|Armour|Evasion|Energy Shield|Ward|Spirit|Charm Slots|Requires)\s*:/i

function unique<T>(values: T[]): T[] { return [...new Set(values)] }

function escapeRegex(value: string): string { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') }

function isInteractionHintLine(line: string): boolean {
  return /^(?:使用|放置到|右键点击|按住|Use|Place|Right[- ]click|Hold)\b/iu.test(line)
}

function isFlavorStart(lines: string[], index: number): boolean {
  if (index >= lines.length || FOOTER_LINE.test(lines[index]) || /^\{.*\}$/u.test(lines[index]) || isInteractionHintLine(lines[index])) return false
  if (!/[，。！？；、——…]$/u.test(lines[index])) return false
  const next = lines[index + 1]
  return !!next && /[，。！？；、——…]$/u.test(next) && !FOOTER_LINE.test(next)
}

/** Split newer CN clipboard output that omits the visual separator rows. */
function splitCompactClipboardSections(lines: string[]): string[][] {
  const itemLevelIndex = lines.findIndex((line) => /^(?:Item Level|物品等级|物品等級|아이템 레벨)\s*[：:]/iu.test(line))
  if (itemLevelIndex < 0) return [lines]
  const sections: string[][] = []
  const header = lines.slice(0, itemLevelIndex)
  if (header.length) sections.push(header)
  let cursor = itemLevelIndex
  const isBoundary = (index: number) => /^\{.*\}$/u.test(lines[index])
    || FOOTER_LINE.test(lines[index]) || isInteractionHintLine(lines[index]) || isFlavorStart(lines, index)
  while (cursor < lines.length) {
    const start = cursor
    if (/^\{.*\}$/u.test(lines[cursor])) {
      cursor += 1
      while (cursor < lines.length && !isBoundary(cursor)) cursor += 1
    } else if (FOOTER_LINE.test(lines[cursor])) {
      while (cursor < lines.length && FOOTER_LINE.test(lines[cursor])) cursor += 1
    } else if (isInteractionHintLine(lines[cursor])) {
      cursor += 1
      while (cursor < lines.length && !isBoundary(cursor)) cursor += 1
    } else if (isFlavorStart(lines, cursor)) {
      cursor += 1
      while (cursor < lines.length && /[，。！？；、——…]$/u.test(lines[cursor])) cursor += 1
    } else {
      while (cursor < lines.length && !isBoundary(cursor)) cursor += 1
    }
    if (cursor > start) sections.push(lines.slice(start, cursor))
  }
  return sections
}

export function applyXiletradeParsingRules(value: string, rules: XiletradeParsingRule[] = []): string {
  let result = value
  for (const rule of rules) {
    if (rule.disabled || !rule.old || !rule.new || (rule.replace !== 'equals' && rule.replace !== 'contains')) continue
    let captures = 0
    const pattern = escapeRegex(rule.old).replace(/#/g, () => { captures += 1; return '([-+]?\\d+(?:\\.\\d+)?)' })
    const regex = new RegExp(rule.replace === 'equals' ? `^${pattern}$` : pattern, 'iu')
    const match = result.match(regex)
    if (!match) continue
    let captureIndex = 1
    const replacement = rule.new.replace(/#/g, () => match[captureIndex++] || '#')
    result = rule.replace === 'equals' ? replacement : result.replace(regex, replacement)
  }
  return result
}

function numbersWithoutTierRanges(value: string): number[] {
  return [...value
    .replace(/\s*\(\s*[-+]?\d+(?:\.\d+)?\s*-\s*[-+]?\d+(?:\.\d+)?\s*\)/g, '')
    .replace(/\s*\(\s*[-+]?\d+(?:\.\d+)?\s*\)/g, '')
    .matchAll(/[-+]?\d+(?:\.\d+)?/g)]
    .map((match) => Number(match[0]))
}

function tierRanges(value: string): Array<{ min: number; max: number }> {
  return [...value.matchAll(/\(\s*([-+]?\d+(?:\.\d+)?)\s*-\s*([-+]?\d+(?:\.\d+)?)\s*\)/g)]
    .map((match) => ({ min: Number(match[1]), max: Number(match[2]) }))
}

function sourceTags(marker: string, rune: boolean): LibraryModifierTag[] {
  const tags: LibraryModifierTag[] = []
  if (/(?:基底属性|基底屬性|Base Properties|기본 속성)/iu.test(marker)) tags.push('implicit')
  if (/(?:腐化强化|腐化強化|强化|強化|강화|Enhance)/iu.test(marker)) tags.push('enchant')
  if (/(?:破碎的|碎裂的|Fractured|분열된)/iu.test(marker)) tags.push('fractured')
  if (/(?:打造的|製作的|Crafted|제작된)/iu.test(marker)) tags.push('crafted')
  if (/(?:亵渎的|褻瀆的|Desecrated|모독된)/iu.test(marker)) tags.push('desecrated')
  if (rune) tags.push('rune')
  return unique(tags)
}

function groupFor(tags: LibraryModifierTag[]): LibraryModifierGroup {
  if (tags.includes('rune')) return 'rune'
  if (tags.includes('enchant')) return 'enchant'
  if (tags.includes('implicit')) return 'implicit'
  return 'explicit'
}

function localizedRadius(value: string): string {
  const normalized: Record<string, string> = {
    '变量': 'Variable', '變數': 'Variable', '极小': 'Very Small', '極小': 'Very Small',
    '小': 'Small', '小型': 'Small', '中小': 'Medium-Small', '中小型': 'Medium-Small',
    '中': 'Medium', '中型': 'Medium', '大': 'Large', '大型': 'Large',
    '极大': 'Very Large', '極大': 'Very Large', '巨大': 'Massive',
  }
  return normalized[value] || value
}

/**
 * Parses advanced PoE2 clipboard text using Xiletrade's section-first model:
 * headers establish item context, descriptor rows establish affix source, and
 * stat matching happens only after tier ranges and presentation suffixes are separated.
 */
export function parseXiletradeItemText(value: string, options: XiletradeItemParserOptions): XiletradeItemParseResult {
  const normalized = value
    .replace(/\r\n?/g, '\n')
    // The CN client inserts an empty placeholder before some variable unique
    // modifiers (for example: "异能魔力 ()范围内..."). It is presentation
    // noise, and leaving the adjacent space prevents exact catalog matching.
    .replace(/[ \t\u3000]*\(\)[ \t\u3000]*/g, '')
    .replace(/\[([^\]|]*\|)?([^\]]+)\]/g, '$2')
    .trim()
  const separatedSections = normalized.split(/^--------+$/m)
    .map((section) => section.split('\n').map((line) => line.trim()).filter(Boolean))
    .filter((section) => section.length)
  const sections = separatedSections.length > 1
    ? separatedSections
    : splitCompactClipboardSections(separatedSections[0] || [])
  if (sections.length < 2) throw new Error('Clipboard does not contain a supported Path of Exile 2 item')

  const first = sections[0]
  const itemClass = first.find((line) => /^(?:Item Class|物品类别|物品類別|아이템 종류)\s*[：:]/iu.test(line))
    ?.split(/[：:]/u).slice(1).join(':').trim() || ''
  const rarityIndex = first.findIndex((line) => /^(?:Rarity|稀有度|희귀도)\s*[：:]/iu.test(line))
  const inlineNames = rarityIndex >= 0 ? first.slice(rarityIndex + 1) : []
  const nameNoise = /^(?:You cannot use|你无法使用|您无法使用|你無法使用|사용할 수 없는|이 아이템을 사용할 수 없습니다)/iu
  const nameCandidates = (lines: string[]) => lines.filter((line) => !nameNoise.test(line) && !FIELD_LINE.test(line))
  let names = nameCandidates(inlineNames).slice(-2)
  if (names.length < 2) {
    for (const section of sections.slice(1)) {
      const candidates = nameCandidates(section)
      if (candidates.length >= 2) { names = candidates.slice(-2); break }
    }
  }
  const rarityLine = first.find((line) => /^(?:Rarity|稀有度|희귀도)\s*[：:]/iu.test(line)) || ''
  const rarityValue = rarityLine.split(/[：:]/u).slice(1).join(':')
  const rarity = /unique|傳奇|传奇|유니크|고유/i.test(rarityValue) ? 'UNIQUE'
    : /rare|稀有|희귀/i.test(rarityValue) ? 'RARE'
      : /magic|魔法|마법/i.test(rarityValue) ? 'MAGIC' : 'NORMAL'
  const localizedName = names[0] || ''
  const localizedBaseType = names[1] || names[0] || ''
  const baseType = options.language.toEnglish(localizedBaseType) || (/^[\x20-\x7e]+$/.test(localizedBaseType) ? localizedBaseType : '')
  const name = options.language.toEnglish(localizedName) || (/^[\x20-\x7e]+$/.test(localizedName) ? localizedName : '')
  if (!baseType) throw new Error(`Unsupported item base language: ${localizedBaseType}`)
  const itemContext: CanonicalStatContext = { itemClass, rarity, name, baseType }

  const allLines = sections.flat()
  const metadata: string[] = []
  const itemLevel = allLines.find((line) => /^(?:Item Level|物品等级|物品等級|아이템 레벨)\s*[：:]/iu.test(line))?.match(/\d+/)?.[0]
  for (const line of allLines) {
    const cleaned = line.replace(/\s*\((?:augmented|强化|強化)\)\s*$/iu, '').trim()
    const limited = cleaned.match(/^(?:Limited to|仅限|僅限)\s*[：:]\s*(\d+)(?:\s+Historic)?$/iu)
    if (limited) metadata.push(`Limited to: ${limited[1]}${/\s+Historic$/iu.test(cleaned) ? ' Historic' : ''}`)
    const radius = cleaned.match(/^(?:Radius|范围|範圍)\s*[：:]\s*(.+)$/iu)
    if (radius) metadata.push(`Radius: ${localizedRadius(radius[1])}`)
  }
  const quality = allLines.find((line) => /^(?:Quality|品质|品質|품질)\s*[：:]/iu.test(line))?.match(/([+-]?\d+(?:\.\d+)?)\s*%/u)?.[1]
  if (quality) metadata.push(`Quality: ${quality}`)
  const displayProperties: Array<[string, RegExp]> = [
    ['Armour', /^(?:Armour|护甲|護甲|방어도)\s*[：:]/iu],
    ['Evasion', /^(?:Evasion|闪避值|閃避值|회피)\s*[：:]/iu],
    ['Energy Shield', /^(?:Energy Shield|能量护盾|能量護盾|에너지 보호막)\s*[：:]/iu],
    ['Ward', /^(?:Ward|Runic Ward|符文结界|符文結界|룬 보호막)\s*[：:]/iu],
    ['Spirit', /^(?:Spirit|精魂|정신력)\s*[：:]/iu],
    ['Charm Slots', /^(?:Charm Slots|护符栏位|護符欄位)\s*[：:]/iu],
  ]
  for (const [label, pattern] of displayProperties) {
    const property = allLines.find((line) => pattern.test(line))
    const amount = property?.split(/[：:]/u).slice(1).join(':').match(/[-+]?\d+(?:\.\d+)?/)?.[0]
    if (amount) metadata.push(`${label}: ${amount}`)
  }
  const socketLine = allLines.find((line) => /^(?:Sockets|插槽|소켓)\s*[：:]/iu.test(line))
  const sockets = socketLine?.split(/[：:]/u).slice(1).join(':').match(/[SJ]/gi)?.join(' ')
  if (sockets) metadata.push(`Sockets: ${sockets}`)
  const requirement = allLines.find((line) => /^(?:需求|Requirements?|요구)\s*[：:]/iu.test(line))
  const levelRequirement = requirement?.match(/(?:等级|等級|Level)\s*(\d+)/iu)?.[1]
  if (levelRequirement) metadata.push(`LevelReq: ${levelRequirement}`)

  const parsedModifiers: ParsedModifier[] = []
  const unresolved: string[] = []
  const unresolvedEvidence: ParsedItemModifierEvidence[] = []
  let footerMode = false
  let pendingMarker = ''
  const startSection = Math.max(1, sections.findIndex((section) => section.some((line) => /^(?:Item Level|物品等级|物品等級|아이템 레벨)\s*[：:]/iu.test(line))) + 1)

  const addModifier = (originalLines: string[], marker: string, rune: boolean, match?: CanonicalStatMatch) => {
    const cleanedLines = originalLines.map((line) => line.replace(/\s*\((?:rune|符文)\)\s*$/iu, '').trim())
    const displayText = cleanedLines.join('\n')
    const matchText = applyXiletradeParsingRules(displayText, options.parsingRules)
    const tags = sourceTags(marker, rune)
    const group = groupFor(tags)
    const fallback = cleanedLines.length === 1
      ? options.language.statToEnglish(matchText) || (/^[\x20-\x7e]+$/.test(matchText) ? matchText : undefined)
      : undefined
    const resolved = match || options.canonicalizeStat?.(matchText, group, itemContext)
    const canonicalText = resolved?.canonicalText || fallback
    if (!canonicalText || PROPERTY_LINE.test(canonicalText)) {
      if (!PROPERTY_LINE.test(canonicalText || '') && displayText) {
        unresolved.push(...originalLines)
        unresolvedEvidence.push({
          displayOrder: parsedModifiers.length + unresolvedEvidence.length,
          group,
          sourceTags: tags.length ? tags : ['explicit'],
          original: { locale: options.language.locale, lines: originalLines, displayText },
          currentValues: numbersWithoutTierRanges(displayText),
          tierRanges: tierRanges(displayText),
          candidateStatIds: [],
          status: 'unresolved',
        })
      }
      return
    }
    const order = parsedModifiers.length
    parsedModifiers.push({
      canonicalText,
      implicit: !rune && (tags.includes('implicit') || /^Grants Skill:/i.test(canonicalText)),
      evidence: {
        displayOrder: order,
        group,
        sourceTags: tags.length ? tags : ['explicit'],
        original: { locale: options.language.locale, lines: originalLines, displayText },
        canonicalText,
        currentValues: numbersWithoutTierRanges(displayText),
        tierRanges: tierRanges(displayText),
        queryStatId: resolved?.queryStatId,
        candidateStatIds: resolved?.candidateStatIds || (resolved?.queryStatId ? [resolved.queryStatId] : []),
        status: resolved?.queryStatId ? 'resolved' : resolved?.candidateStatIds?.length ? 'ambiguous' : 'unresolved',
      },
    })
  }

  const processContent = (content: string[], marker: string) => {
    if (!content.length) return
    const isFlavor = content.some((line) => /^(?:[“"]|'.*')/u.test(line)) || content.every((line) => /[，。！？；、——…]$/u.test(line))
    const isHint = content.some((line) => /^(?:使用|放置到|右键点击|按住|Use|Place|Right[- ]click|Hold)\b/iu.test(line))
    if (isFlavor || isHint) return

    const candidateLines = content.filter((line) => !FIELD_LINE.test(line))
    if (!candidateLines.length) return
    const rune = candidateLines.every((line) => /\((?:rune|符文)\)\s*$/iu.test(line))
    const cleanLines = candidateLines.map((line) => line.replace(/\s*\((?:rune|符文)\)\s*$/iu, '').trim())
    const tags = sourceTags(marker, rune)
    const group = groupFor(tags)
    const multiLineText = applyXiletradeParsingRules(cleanLines.join('\n'), options.parsingRules)
    const multiLineMatch = cleanLines.length > 1
      ? options.canonicalizeStat?.(multiLineText, group, itemContext, cleanLines[1])
      : undefined
    if (multiLineMatch) addModifier(candidateLines, marker, rune, multiLineMatch)
    else for (const line of candidateLines) addModifier([line], marker, /\((?:rune|符文)\)\s*$/iu.test(line))
  }

  for (const section of sections.slice(startSection)) {
    if (footerMode) continue
    const hasDescriptors = section.some((line) => /^\{.*\}$/u.test(line))
    if (!hasDescriptors) {
      const footerAt = section.findIndex((line) => FOOTER_LINE.test(line))
      processContent(footerAt >= 0 ? section.slice(0, footerAt) : section, pendingMarker)
      pendingMarker = ''
      if (footerAt >= 0) footerMode = true
      continue
    }

    let marker = pendingMarker
    let content: string[] = []
    let processedContent = false
    const flush = () => {
      if (content.length) { processContent(content, marker); processedContent = true }
      content = []
    }
    for (const line of section) {
      if (FOOTER_LINE.test(line)) { flush(); footerMode = true; break }
      if (/^\{.*\}$/u.test(line)) {
        flush()
        marker = line
      } else {
        content.push(line)
      }
    }
    flush()
    pendingMarker = processedContent ? '' : marker
  }

  // Repeated identical lines are meaningful for socketed runes and must not
  // be collapsed. Their source order is the stable identity for persistence.
  const projected = parsedModifiers
  projected.forEach((modifier, index) => { modifier.evidence.displayOrder = index })
  const uniqueUnresolved = unique(unresolved)
  if (options.strict && uniqueUnresolved.length) throw new Error(`Unsupported item lines: ${uniqueUnresolved.join(' | ')}`)

  const implicitCount = projected.filter((modifier) => modifier.implicit || modifier.evidence.group !== 'explicit').length
  const raw = [`Rarity: ${rarity}`]
  if ((rarity === 'RARE' || rarity === 'UNIQUE') && name && name !== baseType) raw.push(name)
  raw.push(baseType)
  if (itemLevel) raw.push(`Item Level: ${itemLevel}`)
  raw.push(...unique(metadata), `Implicits: ${implicitCount}`)
  raw.push(...projected.map((modifier) => {
    const tags = modifier.evidence.sourceTags.filter((tag) => tag !== 'implicit' && tag !== 'explicit' && tag !== 'unknown')
    return `${modifier.implicit ? '{implicit}' : ''}${tags.map((tag) => `{${tag}}`).join('')}${modifier.canonicalText}`
  }))
  if (allLines.some((line) => /^(?:Twice Corrupted|双重腐化|雙重腐化|이중 타락)$/iu.test(line))) raw.push('Twice Corrupted')
  else if (allLines.some((line) => /^(?:Corrupted|已腐化|已污染|被腐化|타락)$/iu.test(line))) raw.push('Corrupted')

  return {
    raw: raw.join('\n'), unresolved: uniqueUnresolved,
    localized: { name: localizedName, baseType: localizedBaseType },
    evidence: {
      parser: 'xiletrade-compatible', schemaVersion: 1, upstreamCommit: options.upstreamCommit || XILETRADE_UPSTREAM_COMMIT,
      parsedAt: options.now?.() || new Date().toISOString(), locale: options.language.locale,
      originalText: normalized,
      itemClass,
      modifiers: [
        ...projected.map((modifier) => modifier.evidence),
        ...unresolvedEvidence.map((modifier, index) => ({ ...modifier, displayOrder: projected.length + index })),
      ],
    },
  }
}

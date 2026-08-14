import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { app } from 'electron'

export type ItemRawLanguage = 'en' | 'zh-rCN' | 'zh-rTW' | 'ko-KR'

/** Detects the language used by the game's item clipboard format, independently of UI language. */
export function detectItemRawLanguage(value: string): ItemRawLanguage {
  const text = value.replace(/\r\n/g, '\n')
  if (/^\s*Rarity\s*:/im.test(text)) return 'en'
  if (/[\uAC00-\uD7AF]/u.test(text)) return 'ko-KR'
  if (/(?:物品類別|物品等級|傳奇|品質\s*[：:]|獲得技能|屬性需求|攻擊速度|閃電傷害)/u.test(text)) return 'zh-rTW'
  if (/(?:物品类别|物品等级|传奇|品质\s*[：:]|获得技能|属性需求|攻击速度|闪电伤害)/u.test(text)) return 'zh-rCN'
  return 'en'
}

const ITEM_FILES = [
  // Short variant tokens (for example, Mageblood's Legacy of Silver) must
  // win before generic item names such as Diamond Ring introduce a different
  // localized token for the same English stem.
  'Items_Oils.csv',
  'Items_Flasks.txt.csv',
  'Items_Armour.txt.csv',
  'Items_Accessories.txt.csv',
  'Items_Weapons.txt.csv',
  'Items_Jewels.txt.csv',
  'Uniques.txt.csv',
  'Items_Gems.txt.csv',
  'Gems_data.txt.csv',
  'ItemsTab.csv',
]
const STAT_FILES = ['statDescriptions.csv', 'Query_Mod.csv']
const NODE_NAME_FILES = ['tree_dn.csv']
const RARE_NAME_FILES = ['stats_words_suffix.csv', 'stats_words_prefix.csv']
interface ReverseTemplate {
  pattern: RegExp
  english: string
  placeholderNames: string[]
  literalLength: number
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function reverseTemplate(english: string, chinese: string): ReverseTemplate | null {
  const placeholder = /\{(\d+)\}|#/g
  const names: string[] = []
  let pattern = '^'
  let cursor = 0
  let sequential = 0
  for (const match of chinese.matchAll(placeholder)) {
    pattern += escapeRegExp(chinese.slice(cursor, match.index)) + '(.+?)'
    names.push(match[1] ?? String(sequential++))
    cursor = (match.index || 0) + match[0].length
  }
  if (!names.length) return null
  pattern += escapeRegExp(chinese.slice(cursor)) + '$'
  return { pattern: new RegExp(pattern, 'i'), english, placeholderNames: names, literalLength: chinese.replace(placeholder, '').length }
}

function normalizeStatLine(value: string): string {
  return value
    .replace(/\s*[—-]\s*数值不可调整\s*$/u, '')
    .replace(/\s*[—-]\s*數值不可調整\s*$/u, '')
    .replace(/\s*[—-]\s*수치를 조정할 수 없음\s*$/u, '')
    // Granted-skill clipboard lines can include a display-only level cap.
    .replace(/\s*[（(]\s*(?:最高等级|最高等級|max(?:imum)?\s+level)\s*\d+\s*[）)]\s*$/iu, '')
    // Advanced item copy includes the current value followed by its tier range.
    // PoB's stat catalog expects only the current value.
    .replace(/(-?\d+(?:\.\d+)?)\s*\(\s*-?\d+(?:\.\d+)?\s*-\s*-?\d+(?:\.\d+)?\s*\)/g, '$1')
    .replace(/(-?\d+(?:\.\d+)?)\s*\(\s*-?\d+(?:\.\d+)?\s*\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * The game's advanced clipboard format may prefix a stat with item context
 * (for example, "该装备精魂提高 20%"). Translation catalogs usually store
 * the reusable stat template without that presentation prefix. Keep the raw
 * form first, then try a context-free variant so both formats resolve.
 */
function statLineVariants(value: string): string[] {
  const normalized = normalizeStatLine(value)
  const contextFree = normalized
    .replace(/^(?:该装备|该物品|此装备|此物品|該裝備|該物品|此裝備)\s*(?:的)?\s*/u, '')
    // Bonded/羁绊 is a presentation prefix used by the advanced clipboard
    // format. The PoB stat catalog contains the reusable stat without it.
    .replace(/^(?:Bonded|羁绊|羈絆)\s*[:：]\s*/iu, '')
  const variants = contextFree && contextFree !== normalized ? [normalized, contextFree] : [normalized]
  return [...new Set(variants)]
}

function parseCsvRows(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        field += '"'
        index += 1
      } else if (char === '"') quoted = false
      else field += char
    } else if (char === '"') quoted = true
    else if (char === ',') {
      row.push(field)
      field = ''
    } else if (char === '\n') {
      row.push(field.replace(/\r$/, ''))
      rows.push(row)
      row = []
      field = ''
    } else field += char
  }
  if (field || row.length) {
    row.push(field)
    rows.push(row)
  }
  return rows
}

export class ItemTranslationIndex {
  private readonly cnToEnglish = new Map<string, string>()
  private readonly englishToCn = new Map<string, string>()
  private readonly cnStatToEnglish = new Map<string, string>()
  private readonly englishStatToCn = new Map<string, string>()
  private readonly statTemplates: ReverseTemplate[] = []
  private readonly cnStatTemplates: ReverseTemplate[] = []
  private readonly rareNameParts: Array<{ chinese: string; english: string }> = []

  constructor(translationRoot?: string) {
    const root = translationRoot || (app.isPackaged
      ? path.join(app.getAppPath(), 'dist', 'data', 'Translate', 'zh-rCN')
      : path.join(app.getAppPath(), 'public', 'data', 'Translate', 'zh-rCN'))
    for (const fileName of ITEM_FILES) {
      const filePath = path.join(root, fileName)
      if (!existsSync(filePath)) continue
      for (const row of parseCsvRows(readFileSync(filePath, 'utf8'))) {
        const english = row[0]?.trim()
        const chinese = row[1]?.trim()
        if (english && chinese && english !== chinese) {
          if (!this.cnToEnglish.has(chinese)) this.cnToEnglish.set(chinese, english)
          if (!this.englishToCn.has(english)) this.englishToCn.set(english, chinese)
          // Variant stats such as "Legacy of {0}" use the short item token
          // ("Diamond"/"宝钻") rather than the full item name
          // ("Diamond Flask"/"宝钻药剂"). Keep these short tokens data-driven from
          // the item catalogs instead of adding one rule per variant stat.
          for (const [englishSuffix, chineseSuffix] of [
            [' Flask', '药剂'], [' Charm', '咒符'], [' Oil', '圣油'],
            [' Ring', '戒指'], [' Amulet', '护符'], [' Belt', '腰带'],
          ] as const) {
            if (!english.endsWith(englishSuffix) || !chinese.endsWith(chineseSuffix)) continue
            const englishToken = english.slice(0, -englishSuffix.length).trim()
            const chineseToken = chinese.slice(0, -chineseSuffix.length).trim()
            if (englishToken && chineseToken) {
              if (!this.cnToEnglish.has(chineseToken)) this.cnToEnglish.set(chineseToken, englishToken)
              if (!this.englishToCn.has(englishToken)) this.englishToCn.set(englishToken, chineseToken)
            }
          }
        }
      }
    }
    const supplementalPath = path.join(root, '..', '..', 'poe2db-item-localizations.json')
    if (existsSync(supplementalPath)) {
      try {
        const supplemental = JSON.parse(readFileSync(supplementalPath, 'utf8')) as { lookup?: unknown }
        if (supplemental.lookup && typeof supplemental.lookup === 'object' && !Array.isArray(supplemental.lookup)) {
          for (const [english, chinese] of Object.entries(supplemental.lookup)) {
            if (typeof chinese !== 'string' || !english || !chinese) continue
            if (!this.englishToCn.has(english)) this.englishToCn.set(english, chinese)
            if (!this.cnToEnglish.has(chinese)) this.cnToEnglish.set(chinese, english)
          }
        }
      } catch {
        // Supplemental presentation data is optional.
      }
    }
    for (const fileName of STAT_FILES) {
      const filePath = path.join(root, fileName)
      if (!existsSync(filePath)) continue
      for (const row of parseCsvRows(readFileSync(filePath, 'utf8'))) {
        const english = row[0]?.trim()
        const chinese = row[1]?.trim()
        if (!english || !chinese || english === chinese) continue
        const template = reverseTemplate(english, chinese)
        if (template) {
          this.statTemplates.push(template)
          const cnTemplate = reverseTemplate(chinese, english)
          if (cnTemplate) this.cnStatTemplates.push(cnTemplate)
        } else {
          if (!this.cnStatToEnglish.has(chinese)) this.cnStatToEnglish.set(chinese, english)
          if (!this.englishStatToCn.has(english)) this.englishStatToCn.set(english, chinese)
        }
      }
    }
    // Anoint and jewel enchantments refer to passive names (for example
    // "Efficient Inscriptions" and "Paragon").  Keep these names in the
    // same data-driven catalog used by the passive-tree renderer so compound
    // stat templates can translate their captured parameter.
    for (const fileName of NODE_NAME_FILES) {
      const filePath = path.join(root, fileName)
      if (!existsSync(filePath)) continue
      for (const row of parseCsvRows(readFileSync(filePath, 'utf8'))) {
        const english = row[0]?.trim()
        const chinese = row[1]?.trim()
        if (!english || !chinese || english === chinese) continue
        if (!this.englishToCn.has(english)) this.englishToCn.set(english, chinese)
        if (!this.cnToEnglish.has(chinese)) this.cnToEnglish.set(chinese, english)
      }
    }
    for (const fileName of RARE_NAME_FILES) {
      const filePath = path.join(root, fileName)
      if (!existsSync(filePath)) continue
      for (const row of parseCsvRows(readFileSync(filePath, 'utf8'))) {
        const english = row[0]
        const chinese = row[1]
        if (english && chinese && english !== chinese) this.rareNameParts.push({ chinese, english })
      }
    }
    this.rareNameParts.sort((left, right) => right.chinese.length - left.chinese.length)
    this.statTemplates.sort((left, right) => right.literalLength - left.literalLength)
    this.cnStatTemplates.sort((left, right) => right.literalLength - left.literalLength)
  }

  /** Adds authoritative runtime translations (for example official trade options). */
  registerStatTranslation(source: string, translated: string): void {
    const from = source.trim()
    const to = translated.trim()
    if (!from || !to || from === to) return
    // Runtime catalogs are authoritative and may correct a generic template
    // translation that was loaded earlier.
    this.cnStatToEnglish.set(from, to)
    this.englishStatToCn.set(to, from)
  }

  private translateRareName(value: string, direction: 'toEnglish' | 'toChinese'): string | undefined {
    const normalized = value.trim()
    const memo = new Map<number, string | undefined>()
    const translateFrom = (offset: number): string | undefined => {
      if (offset === normalized.length) return ''
      if (memo.has(offset)) return memo.get(offset)
      for (const part of this.rareNameParts) {
        const input = direction === 'toEnglish' ? part.chinese : part.english
        const output = direction === 'toEnglish' ? part.english : part.chinese
        if (!normalized.startsWith(input, offset)) continue
        const remainder = translateFrom(offset + input.length)
        if (remainder != null) {
          const translated = output + remainder
          memo.set(offset, translated)
          return translated
        }
      }
      memo.set(offset, undefined)
      return undefined
    }
    return translateFrom(0)?.trim()
  }

  toEnglish(value: string): string | undefined {
    const normalized = value.trim()
    return this.cnToEnglish.get(normalized) || this.translateRareName(normalized, 'toEnglish')
  }

  toChinese(value: string): string | undefined {
    const normalized = value.trim()
    return this.englishToCn.get(normalized) || this.translateRareName(normalized, 'toChinese')
  }

  private translateStatTemplate(
    value: string,
    templates: ReverseTemplate[],
    resolveValue?: (value: string) => string | undefined,
  ): string | undefined {
    for (const template of templates) {
      const match = value.match(template.pattern)
      if (!match) continue
      const values = new Map<string, string>()
      template.placeholderNames.forEach((name, index) => {
        const captured = match[index + 1]
        values.set(name, resolveValue?.(captured.trim()) || captured)
      })
      let sequential = 0
      return template.english.replace(/\{(\d+)\}|#/g, (_placeholder, index: string | undefined) => values.get(index ?? String(sequential++)) || '')
    }
    return undefined
  }

  statToEnglish(value: string): string | undefined {
    const variants = statLineVariants(value)
    for (const normalized of variants) {
      const exact = this.cnStatToEnglish.get(normalized)
      if (exact) return exact
      const translated = this.translateStatTemplate(normalized, this.statTemplates, (captured) => this.toEnglish(captured))
      if (translated) return translated
    }

    const normalized = variants[0]

    // Advanced item copy shortens generic added-damage lines by omitting the
    // word "基础". Resolve this grammar before the structured fallback so it
    // works for every item and all elemental/physical damage types.
    const addedDamage = normalized.match(/^附加\s+(-?\d+(?:\.\d+)?)\s*-\s*(-?\d+(?:\.\d+)?)\s*(物理|火焰|冰霜|冰冷|闪电|閃電|混沌)(?:伤害|傷害)$/u)
    if (addedDamage) {
      const damageType: Record<string, string> = { 物理: 'Physical', 火焰: 'Fire', 冰霜: 'Cold', 冰冷: 'Cold', 闪电: 'Lightning', 閃電: 'Lightning', 混沌: 'Chaos' }
      return `Adds ${addedDamage[1]} to ${addedDamage[2]} ${damageType[addedDamage[3]]} Damage`
    }

    // The advanced Chinese copy format uses a localized label for granted skills,
    // while PoB's canonical item format always uses "Grants Skill".
    const grantedSkill = normalized.match(/^(?:获得技能|獲得技能)\s*[:：]\s*(?:等级|等級)?\s*(?:(\d+)\s*(?:级|級)?\s*)?(.+)$/u)
    if (grantedSkill) {
      const skillName = this.toEnglish(grantedSkill[2])
      if (skillName) return `Grants Skill: ${grantedSkill[1] ? `Level ${grantedSkill[1]} ` : ''}${skillName}`
    }
    const structured = this.translateStructuredStat(normalized, 'toEnglish')
    if (structured) return structured
    return undefined
  }

  statToChinese(value: string): string | undefined {
    const normalized = normalizeStatLine(value)
    const grantedSkill = normalized.match(/^Grants Skill:\s+(?:Level\s+(\d+)\s+)?(.+)$/i)
    if (grantedSkill) {
      const skillName = this.toChinese(grantedSkill[2])
      if (skillName) return `获得技能: ${grantedSkill[1] ? `${grantedSkill[1]} 级` : ''}${skillName}`
    }
    return this.englishStatToCn.get(normalized)
      || this.translateStatTemplate(normalized, this.cnStatTemplates, (captured) => this.toChinese(captured))
      || this.translateStructuredStat(normalized, 'toChinese')
  }

  private translateStructuredStat(value: string, direction: 'toEnglish' | 'toChinese'): string | undefined {
    const match = value.match(/^(.+?)(\s*[:：]\s*)(.+)$/)
    if (!match) return undefined
    const prefix = direction === 'toEnglish'
      ? this.cnStatToEnglish.get(match[1].trim()) || this.cnToEnglish.get(match[1].trim())
      : this.englishStatToCn.get(match[1].trim()) || this.englishToCn.get(match[1].trim())
    if (!prefix) return undefined
    const translatedValue = direction === 'toEnglish'
      ? this.cnStatToEnglish.get(match[3].trim()) || this.cnToEnglish.get(match[3].trim()) || match[3]
      : this.englishStatToCn.get(match[3].trim()) || this.englishToCn.get(match[3].trim()) || match[3]
    return `${prefix}${match[2]}${translatedValue}`
  }
}

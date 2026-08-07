import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { app } from 'electron'

const ITEM_FILES = [
  'Items_Armour.txt.csv',
  'Items_Accessories.txt.csv',
  'Items_Weapons.txt.csv',
  'Items_Jewels.txt.csv',
  'Items_Flasks.txt.csv',
  'Uniques.txt.csv',
  'Items_Gems.txt.csv',
  'Gems_data.txt.csv',
]
const STAT_FILES = ['statDescriptions.csv', 'Query_Mod.csv']
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

  private translateStatTemplate(value: string, templates: ReverseTemplate[]): string | undefined {
    for (const template of templates) {
      const match = value.match(template.pattern)
      if (!match) continue
      const values = new Map<string, string>()
      template.placeholderNames.forEach((name, index) => values.set(name, match[index + 1]))
      let sequential = 0
      return template.english.replace(/\{(\d+)\}|#/g, (_placeholder, index: string | undefined) => values.get(index ?? String(sequential++)) || '')
    }
    return undefined
  }

  statToEnglish(value: string): string | undefined {
    const normalized = value.trim()
    const exact = this.cnStatToEnglish.get(normalized)
    if (exact) return exact
    return this.translateStatTemplate(normalized, this.statTemplates)
  }

  statToChinese(value: string): string | undefined {
    const normalized = value.trim()
    const grantedSkill = normalized.match(/^Grants Skill:\s+(?:Level\s+(\d+)\s+)?(.+)$/i)
    if (grantedSkill) {
      const skillName = this.toChinese(grantedSkill[2])
      if (skillName) return `获得技能: ${grantedSkill[1] ? `${grantedSkill[1]} 级` : ''}${skillName}`
    }
    return this.englishStatToCn.get(normalized) || this.translateStatTemplate(normalized, this.cnStatTemplates)
  }
}

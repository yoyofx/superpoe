import type { TreeNode } from '@/types/tree'
import { getGrantedSkillInfo } from '@/i18n/grantedSkills'

export type Language = 'en' | 'zh-rCN' | 'zh-rTW' | 'ko-KR'

export const LANGUAGE_OPTIONS: Array<{ value: Language; label: string }> = [
  { value: 'en', label: 'English' },
  { value: 'zh-rCN', label: '简体中文' },
  { value: 'zh-rTW', label: '繁體中文' },
  { value: 'ko-KR', label: '한국어' },
]

const loadedLanguages = new Set<Language>()
const dictionaries = new Map<Language, Map<string, string>>()
const numericDictionaries = new Map<Language, Map<string, string>>()
const templateDictionaries = new Map<Language, TranslationTemplate[]>()
const templateKeys = new Map<Language, Set<string>>()

const TRANSLATION_MANIFEST = '/data/Translate/translation-files.json'

interface TranslationManifest {
  schemaVersion: number
  languages: Partial<Record<Language, string[]>>
}

interface TranslationTemplate {
  pattern: RegExp
  translated: string
  placeholderCount: number
  literalLength: number
}

interface NumericPattern {
  key: string
  values: string[]
}

export interface LocalizedNodeDisplay {
  name: string
  stats: string[]
  grantedSkills: LocalizedGrantedSkill[]
  reminderText?: string[]
  flavourText?: string[]
  recipe?: string[]
}

export interface LocalizedGrantedSkill {
  sourceStat: string
  skillId: string
  name: string
  description: string
  tags?: string
  weaponRequirements?: string
  gemType?: string
}

function parseCsvRows(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]
    const next = text[i + 1]

    if (quoted) {
      if (char === '"' && next === '"') {
        field += '"'
        i += 1
      } else if (char === '"') {
        quoted = false
      } else {
        field += char
      }
      continue
    }

    if (char === '"') {
      quoted = true
    } else if (char === ',') {
      row.push(field)
      field = ''
    } else if (char === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else if (char !== '\r') {
      field += char
    }
  }

  if (field || row.length > 0) {
    row.push(field)
    rows.push(row)
  }

  return rows
}

function normalizeKey(value: string): string {
  return value.trim()
}

function normalizeDisplayTags(value: string): string {
  return value
    .replace(/\[([^|\]]+)\|([^\]]+)\]/g, '$2')
    .replace(/<i>\{([^}]+)\}/g, '$1')
    .replace(/\s+\n/g, '\n')
    .replace(/\n\s+/g, '\n')
    .trim()
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function compileTemplate(source: string, translated: string): TranslationTemplate | null {
  let pattern = '^'
  let placeholderCount = 0

  for (let i = 0; i < source.length; i += 1) {
    const rest = source.slice(i)
    const numbered = rest.match(/^\{(\d+)\}/)
    if (numbered) {
      pattern += '(.+?)'
      placeholderCount = Math.max(placeholderCount, Number(numbered[1]) + 1)
      i += numbered[0].length - 1
      continue
    }

    if (source[i] === '#') {
      pattern += '(.+?)'
      placeholderCount += 1
      continue
    }

    pattern += escapeRegExp(source[i])
  }

  if (placeholderCount === 0) return null
  return {
    pattern: new RegExp(`${pattern}$`, 'i'),
    translated,
    placeholderCount,
    literalLength: source.replace(/\{\d+\}|#/g, '').length,
  }
}

function compileNumericPattern(value: string): NumericPattern | null {
  const numberPattern = /[+-]?\d+(?:\.\d+)?%?/g
  const values = value.match(numberPattern)
  if (!values?.length || values.length > 4 || value.length > 220) return null
  let index = 0
  return {
    key: value.replace(numberPattern, () => `{${index++}}`),
    values,
  }
}

function addNumericEntry(dictionary: Map<string, string>, source: string, translated: string): void {
  const sourcePattern = compileNumericPattern(source)
  const translatedPattern = compileNumericPattern(translated)
  if (!sourcePattern || !translatedPattern) return
  if (sourcePattern.values.length !== translatedPattern.values.length) return
  dictionary.set(sourcePattern.key, translatedPattern.key)
}

function applyNumericEntry(dictionary: Map<string, string> | undefined, source: string): string | null {
  const sourcePattern = compileNumericPattern(source)
  if (!sourcePattern) return null
  const translatedPattern = dictionary?.get(sourcePattern.key)
  if (!translatedPattern) return null
  return translatedPattern.replace(/\{(\d+)\}/g, (_, index: string) => sourcePattern.values[Number(index)] ?? '')
}

function addTemplate(
  language: Language,
  templates: TranslationTemplate[],
  source: string,
  translated: string,
  compiler: (source: string, translated: string) => TranslationTemplate | null,
): void {
  const key = `${source}\u0000${compiler.name}`
  const keys = templateKeys.get(language) || new Set<string>()
  templateKeys.set(language, keys)
  if (keys.has(key)) return
  const template = compiler(source, translated)
  if (!template) return
  keys.add(key)
  templates.push(template)
}

function applyTemplate(template: TranslationTemplate, source: string): string | null {
  const match = source.match(template.pattern)
  if (!match) return null

  const values = match.slice(1)
  let nextHash = 0
  return template.translated
    .replace(/\{(\d+)\}/g, (_, index: string) => values[Number(index)] ?? '')
    .replace(/#/g, () => values[nextHash++] ?? '')
}

async function getTranslationFiles(language: Language): Promise<string[]> {
  const response = await fetch(TRANSLATION_MANIFEST)
  if (!response.ok) throw new Error('Translation manifest is unavailable')
  const manifest = await response.json() as TranslationManifest | Partial<Record<Language, string[]>>
  const languageFiles = 'languages' in manifest
    ? manifest.languages?.[language]
    : manifest[language]
  return (languageFiles || []).filter((file) => file.endsWith('.csv'))
}

function addTranslationEntry(
  dictionary: Map<string, string>,
  templates: TranslationTemplate[],
  language: Language,
  source: string,
  translated: string,
): void {
  const key = normalizeKey(source)
  const displayKey = normalizeDisplayTags(key)
  const displayTranslated = normalizeDisplayTags(translated)

  if (!dictionary.has(key)) dictionary.set(key, translated)
  if (displayKey && displayTranslated) {
    if (!dictionary.has(displayKey)) dictionary.set(displayKey, displayTranslated)
  }

  for (const [templateSource, templateTranslated] of [
    [key, translated],
    [displayKey, displayTranslated],
  ] as const) {
    addTemplate(language, templates, templateSource, templateTranslated, compileTemplate)
  }
}

function translateText(value: string, language: Language): string {
  if (language === 'en') return value
  const key = normalizeKey(value)
  const exact = dictionaries.get(language)?.get(key)
  if (exact) return exact

  const numeric = applyNumericEntry(numericDictionaries.get(language), key)
  if (numeric) return numeric

  const templates = templateDictionaries.get(language) || []
  for (const template of templates) {
    const translated = applyTemplate(template, key)
    if (translated) return translated
  }

  if (key.includes('\n')) {
    const lines = key.split('\n')
    const translatedLines = lines.map((line) => line.trim() ? translateText(line, language) : line)
    if (translatedLines.some((line, index) => line !== lines[index])) {
      return translatedLines.join('\n')
    }
  }

  return value
}

/** Translate game-provided names and stat lines using the loaded PoB dictionaries. */
export function translateGameText(value: string, language: Language): string {
  return translateText(value, language)
}

function translateList(value: string[] | undefined, language: Language): string[] | undefined {
  if (!value) return value
  return value.map((item) => translateText(item, language))
}

function localizeGrantedSkills(stats: string[] | undefined, language: Language): LocalizedGrantedSkill[] {
  if (!stats) return []
  return stats.flatMap((stat) => {
    const skill = getGrantedSkillInfo(stat)
    if (!skill) return []
    return [{
      sourceStat: translateText(stat, language),
      skillId: skill.skillId,
      name: translateText(skill.name, language),
      description: translateText(skill.description, language),
      tags: skill.tagString ? translateText(skill.tagString, language) : undefined,
      weaponRequirements: skill.weaponRequirements ? translateText(skill.weaponRequirements, language) : undefined,
      gemType: skill.gemType ? translateText(skill.gemType, language) : undefined,
    }]
  })
}

function collectText(parts: string[], value: unknown): void {
  if (!value) return
  if (typeof value === 'string' || typeof value === 'number') {
    parts.push(String(value))
    return
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectText(parts, item))
    return
  }
  if (typeof value === 'object') {
    Object.values(value).forEach((item) => collectText(parts, item))
  }
}

export async function loadTranslations(language: Language): Promise<void> {
  if (loadedLanguages.has(language)) return
  if (language === 'en') {
    loadedLanguages.add(language)
    return
  }

  const dictionary = dictionaries.get(language) || new Map<string, string>()
  dictionaries.set(language, dictionary)
  const numericDictionary = numericDictionaries.get(language) || new Map<string, string>()
  numericDictionaries.set(language, numericDictionary)
  const templates = templateDictionaries.get(language) || []
  templateDictionaries.set(language, templates)

  const translationFiles = await getTranslationFiles(language)
  const fileRows = await Promise.all(translationFiles.map(async (file) => {
    const response = await fetch(`/data/Translate/${language}/${file}`)
    if (!response.ok) {
      if (response.status === 404) return
      throw new Error(`Failed to load translation file: ${file}`)
    }
    return parseCsvRows(await response.text())
  }))

  // Requests run concurrently, but merging follows the source manifest order.
  // The first matching upstream file wins when historical CSVs contain duplicates.
  for (const rows of fileRows) {
    if (!rows) continue
    for (const [source, translated] of rows) {
      if (!source || !translated) continue
      const key = normalizeKey(source)
      if (!dictionary.has(key)) {
        addTranslationEntry(dictionary, templates, language, source, translated)
      }
      const numericKey = compileNumericPattern(key)?.key
      if (numericKey && !numericDictionary.has(numericKey)) {
        addNumericEntry(numericDictionary, key, translated)
      }
      const displayKey = normalizeDisplayTags(source)
      const displayNumericKey = compileNumericPattern(displayKey)?.key
      if (displayNumericKey && !numericDictionary.has(displayNumericKey)) {
        addNumericEntry(numericDictionary, displayKey, normalizeDisplayTags(translated))
      }
    }
  }

  templates.sort((a, b) => b.literalLength - a.literalLength || a.placeholderCount - b.placeholderCount)

  loadedLanguages.add(language)
}

export function getLocalizedNodeDisplay(node: TreeNode, language: Language): LocalizedNodeDisplay {
  return {
    name: translateText(node.name, language),
    stats: translateList(node.stats, language) || [],
    grantedSkills: localizeGrantedSkills(node.stats, language),
    reminderText: translateList(node.reminderText, language),
    flavourText: translateList(node.flavourText, language),
    recipe: translateList(node.recipe, language),
  }
}

export function getLocalizedSearchText(node: TreeNode, language: Language): string {
  const display = getLocalizedNodeDisplay(node, language)
  const parts: string[] = []
  collectText(parts, node.name)
  collectText(parts, node.stats)
  collectText(parts, node.reminderText)
  collectText(parts, node.flavourText)
  collectText(parts, node.recipe)
  collectText(parts, node.options)
  collectText(parts, display.name)
  collectText(parts, display.stats)
  collectText(parts, display.grantedSkills)
  collectText(parts, display.reminderText)
  collectText(parts, display.flavourText)
  collectText(parts, display.recipe)
  return parts.join('\n').toLowerCase()
}

export function isTranslationLoaded(language: Language): boolean {
  return loadedLanguages.has(language)
}

export function resetTranslationsForTest(): void {
  loadedLanguages.clear()
  dictionaries.clear()
  numericDictionaries.clear()
  templateDictionaries.clear()
  templateKeys.clear()
}

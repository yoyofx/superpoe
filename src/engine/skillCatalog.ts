import type { BuildGem } from '@/engine/skills'
import { translateGameText, type Language } from '@/i18n/translationLoader'

export type SkillCatalogType = 'active' | 'support' | 'granted' | 'hidden' | 'internal'

export interface SkillCatalogEntry {
  id: string
  name: string
  baseTypeName?: string
  type: SkillCatalogType
  userVisible: boolean
  gemIds: string[]
  gameIds: string[]
  variantIds: string[]
  aliases: string[]
  tags: string[]
  tagString?: string
  description?: string | null
  localizedNames?: Record<string, string>
  localizedDescriptions?: Record<string, string>
  localizationSources?: Record<string, string>
  plannerParentSkillId?: string
  plannerSkillId?: string
  isAscendancySkill?: boolean
  icon?: string | null
  iconSource?: 'pob' | 'poe2db' | 'family-fallback' | null
  iconFallbackFrom?: string
  gemType?: string
  gemFamily?: string
  tier?: number | null
  naturalMaxLevel?: number | null
  requirements?: { str: number; dex: number; int: number }
}

export interface SkillCatalog {
  schemaVersion: number
  stats: Record<string, number | Record<string, number>>
  entries: Record<string, SkillCatalogEntry>
  lookup: Record<string, string>
}

let skillCatalogPromise: Promise<SkillCatalog | null> | null = null

export function normalizeSkillCatalog(value: unknown): SkillCatalog | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Partial<SkillCatalog>
  if (!candidate.entries || typeof candidate.entries !== 'object' || Array.isArray(candidate.entries)) return null
  if (!candidate.lookup || typeof candidate.lookup !== 'object' || Array.isArray(candidate.lookup)) return null
  return {
    schemaVersion: typeof candidate.schemaVersion === 'number' ? candidate.schemaVersion : 0,
    stats: candidate.stats && typeof candidate.stats === 'object' && !Array.isArray(candidate.stats) ? candidate.stats : {},
    entries: candidate.entries,
    lookup: Object.fromEntries(Object.entries(candidate.lookup).filter((entry): entry is [string, string] => (
      typeof entry[1] === 'string' && !!candidate.entries?.[entry[1]]
    ))),
  }
}

export function normalizeSkillKey(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/gi, '')
    .toLowerCase()
}

export function loadSkillCatalog(): Promise<SkillCatalog | null> {
  if (!skillCatalogPromise) {
    skillCatalogPromise = fetch('/data/skill-catalog.json')
      .then(async (response) => response.ok ? normalizeSkillCatalog(await response.json()) : null)
      .catch(() => null)
  }
  return skillCatalogPromise
}

export function resolveSkillCatalogEntry(
  gem: Pick<BuildGem, 'skillId' | 'gemId' | 'variantId' | 'name'>,
  catalog: SkillCatalog | null,
): SkillCatalogEntry | undefined {
  if (!catalog) return undefined
  for (const value of [gem.skillId, gem.gemId, gem.variantId, gem.name]) {
    const id = catalog.lookup[normalizeSkillKey(value)]
    if (id && catalog.entries[id]) return catalog.entries[id]
  }
  return undefined
}

export function resolveSkillCatalogName(name: string, catalog: SkillCatalog | null): SkillCatalogEntry | undefined {
  if (!catalog) return undefined
  const id = catalog.lookup[normalizeSkillKey(name)]
  return id ? catalog.entries[id] : undefined
}

export function getLocalizedSkillName(
  gem: Pick<BuildGem, 'name'>,
  entry: SkillCatalogEntry | undefined,
  language: Language,
): string {
  if (language === 'en') return gem.name || entry?.name || ''
  const localized = entry?.localizedNames?.[language]
  if (localized) return localized

  for (const source of [gem.name, entry?.name, entry?.baseTypeName]) {
    if (!source) continue
    const translated = translateGameText(source, language)
    if (translated !== source) return translated
  }
  return gem.name || entry?.name || ''
}

export function getLocalizedSkillDescription(
  entry: SkillCatalogEntry | undefined,
  language: Language,
): string {
  if (!entry?.description) return ''
  if (language === 'en') return entry.description
  return entry.localizedDescriptions?.[language]
    || translateGameText(entry.description, language)
}

export function getLocalizedSkillTags(
  entry: SkillCatalogEntry | undefined,
  language: Language,
): string[] {
  const tags = entry?.tagString
    ? entry.tagString.split(',').map((tag) => tag.trim()).filter(Boolean)
    : entry?.tags.map((tag) => tag.replace(/_/g, ' ')) || []
  return tags.map((tag) => translateGameText(tag, language))
}

export function buildSkillIconLookup(catalog: SkillCatalog | null): Record<string, string> {
  if (!catalog) return {}
  const lookup: Record<string, string> = {}
  for (const [alias, id] of Object.entries(catalog.lookup)) {
    const icon = catalog.entries[id]?.icon
    if (icon) lookup[alias] = icon
  }
  return lookup
}

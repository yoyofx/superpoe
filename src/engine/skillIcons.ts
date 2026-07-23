import type { BuildGem } from '@/engine/skills'
import {
  loadSkillCatalog,
  normalizeSkillKey,
  resolveSkillCatalogEntry,
  resolveSkillCatalogName,
  type SkillCatalog,
} from '@/engine/skillCatalog'

export interface SkillIconIndex {
  lookup?: Record<string, string>
}

export async function loadSkillIconIndex(): Promise<SkillIconIndex | null> {
  const catalog = await loadSkillCatalog()
  if (!catalog) return null
  const lookup: Record<string, string> = {}
  for (const [alias, id] of Object.entries(catalog.lookup)) {
    const icon = catalog.entries[id]?.icon
    if (icon) lookup[alias] = icon
  }
  return { lookup }
}

export function resolveSkillIconName(name: string, index: SkillIconIndex | null): string | undefined {
  return index?.lookup?.[normalizeSkillKey(name)]
}

export function resolveSkillIcon(gem: BuildGem, index: SkillIconIndex | null): string | undefined {
  const lookup = index?.lookup
  if (!lookup) return undefined
  for (const value of [gem.skillId, gem.gemId, gem.variantId, gem.name]) {
    const path = lookup[normalizeSkillKey(value)]
    if (path) return path
  }
  return undefined
}

export function resolveSkillIconFromCatalog(gem: BuildGem, catalog: SkillCatalog | null): string | undefined {
  return resolveSkillCatalogEntry(gem, catalog)?.icon || undefined
}

export function resolveSkillIconNameFromCatalog(name: string, catalog: SkillCatalog | null): string | undefined {
  return resolveSkillCatalogName(name, catalog)?.icon || undefined
}

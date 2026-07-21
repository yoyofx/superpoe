import { XMLParser } from 'fast-xml-parser'

function asArray<T>(value: T | T[] | undefined): T[] {
  if (value == null) return []
  return Array.isArray(value) ? value : [value]
}

export interface BuildGem {
  name: string
  skillId: string
  gemId: string
  variantId: string
  level: number
  quality: number
  enabled: boolean
}

export interface BuildSkillGroup {
  id: string
  enabled: boolean
  includeInFullDps: boolean
  gems: BuildGem[]
}

export interface BuildSkills {
  activeSkillSetId: string
  groups: BuildSkillGroup[]
}

export function parseSkillsXml(xml: string): BuildSkills {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '',
    parseAttributeValue: false,
  })
  const skills = parser.parse(xml)?.PathOfBuilding2?.Skills
  if (!skills) return { activeSkillSetId: '', groups: [] }
  const sets = asArray<Record<string, unknown>>(skills.SkillSet as Record<string, unknown> | Record<string, unknown>[] | undefined)
  const activeId = String(skills.activeSkillSet ?? sets[0]?.id ?? '')
  const activeSet = sets.find((set) => String(set.id ?? '') === activeId) || sets[0]
  const groups = asArray<Record<string, unknown>>(activeSet?.Skill as Record<string, unknown> | Record<string, unknown>[] | undefined).map((skill, index) => ({
    id: String(index + 1),
    enabled: String(skill.enabled ?? 'true') === 'true',
    includeInFullDps: String(skill.includeInFullDPS ?? '') === 'true',
    gems: asArray<Record<string, unknown>>(skill.Gem as Record<string, unknown> | Record<string, unknown>[] | undefined).map((gem) => ({
      name: String(gem.nameSpec ?? gem.skillId ?? 'Unknown skill').replace(/&apos;/g, "'"),
      skillId: String(gem.skillId ?? ''),
      gemId: String(gem.gemId ?? ''),
      variantId: String(gem.variantId ?? ''),
      level: Number(gem.level ?? 1),
      quality: Number(gem.quality ?? 0),
      enabled: String(gem.enabled ?? 'true') === 'true',
    })),
  })).filter((group) => group.gems.length > 0)
  return { activeSkillSetId: activeId, groups }
}

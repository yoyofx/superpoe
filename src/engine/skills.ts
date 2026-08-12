import { XMLParser } from 'fast-xml-parser'
import { decodeCodeToXml } from '@/engine/buildCode'
import type { PobBuildObject } from '@/engine/pobBuildObject'

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

export interface BuildSkillSet {
  id: string
  title: string
}

export interface BuildSkills {
  activeSkillSetId: string
  skillSets: BuildSkillSet[]
  activeGroupId: string
  groups: BuildSkillGroup[]
}

export function parseSkillsXml(xml: string): BuildSkills {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '',
    parseAttributeValue: false,
  })
  const build = parser.parse(xml)?.PathOfBuilding2
  const skills = build?.Skills
  if (!skills) return { activeSkillSetId: '', skillSets: [], activeGroupId: '', groups: [] }
  const sets = asArray<Record<string, unknown>>(skills.SkillSet as Record<string, unknown> | Record<string, unknown>[] | undefined)
  const activeId = String(skills.activeSkillSet ?? sets[0]?.id ?? '')
  const activeSet = sets.find((set) => String(set.id ?? '') === activeId) || sets[0]
  const skillSets = sets.map((set, index) => ({
    id: String(set.id ?? index + 1),
    title: String(set.title ?? set.name ?? `Skill Set ${index + 1}`),
  }))
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
  const activeGroupId = String(build?.Build?.mainSocketGroup ?? groups[0]?.id ?? '')
  return { activeSkillSetId: activeId, skillSets, activeGroupId, groups }
}

export function parseSkillsObject(object: PobBuildObject): BuildSkills {
  return parseSkillsXml(object.toXml())
}

export function parseSkillsCode(code: string): BuildSkills {
  return parseSkillsXml(decodeCodeToXml(code))
}

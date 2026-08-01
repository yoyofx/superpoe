import { decodeCodeToXml } from '@/engine/buildCode'
import { parseEquipmentXml } from '@/engine/equipment'
import {
  loadSkillCatalog,
  resolveSkillCatalogEntry,
  type SkillCatalog,
  type SkillCatalogEntry,
} from '@/engine/skillCatalog'
import { parseSkillsXml, type BuildGem } from '@/engine/skills'
import { loadTranslations, translateGameText, type Language } from '@/i18n/translationLoader'
import type { NodeAttributeSelections } from '@/engine/attributeNodes'
import type { NodeWeaponSets } from '@/engine/passiveAllocation'
import type { EquipmentItem, EquipmentSet } from '@/types/equipment'
import type { TreeData } from '@/types/tree'

export type BuildPlannerLevelInterval = number | [number, number]

export interface GameBuildPlannerPassive {
  id: string
  level_interval?: BuildPlannerLevelInterval
  weapon_set?: 0 | 1 | 2
  additional_text?: string
}

export interface GameBuildPlannerSupport {
  id: string
  level_interval?: BuildPlannerLevelInterval
  additional_text?: string
}

export interface GameBuildPlannerSkill extends GameBuildPlannerSupport {
  support_skills?: Array<string | GameBuildPlannerSupport>
}

export interface GameBuildPlannerInventorySlot {
  inventory_id: string
  slot_x?: number
  slot_y?: number
  level_interval?: BuildPlannerLevelInterval
  unique_name?: string
  additional_text?: string
}

export interface GameBuildPlannerBuild {
  name: string
  author?: string
  link?: string
  description?: string
  ascendancy?: string
  passives?: Array<string | GameBuildPlannerPassive>
  skills?: Array<string | GameBuildPlannerSkill>
  inventory_slots?: GameBuildPlannerInventorySlot[]
}

export interface BuildPlannerPassiveMap {
  schemaVersion: number
  treeVersion: string
  source: string
  sourceVersion: string
  nodes: Record<string, string>
}

export interface CreateGameBuildPlannerInput {
  name: string
  sourceUrl?: string | null
  treeVersion: string
  treeData: TreeData
  selectedClassId: string
  selectedAscendancyId: string
  allocatedNodes: Iterable<string>
  nodeWeaponSets: NodeWeaponSets
  nodeAttributeSelections: NodeAttributeSelections
  importedBuildCode?: string | null
  language?: Language
  passiveMap: BuildPlannerPassiveMap
  skillCatalog: SkillCatalog | null
}

export interface GameBuildPlannerExport {
  build: GameBuildPlannerBuild
  json: string
  fileName: string
  stats: {
    passives: number
    weaponSetPassives: number
    skills: number
    supports: number
    inventorySlots: number
  }
  missingPassiveIds: string[]
  missingSkills: string[]
  skippedSkills: BuildPlannerSkippedSkill[]
  omittedInventorySlots: string[]
  skippedInventorySlots: BuildPlannerSkippedInventorySlot[]
}

export type BuildPlannerSkippedSkillReason = 'granted' | 'meta' | 'spectre' | 'unsupported'

export interface BuildPlannerSkippedSkill {
  name: string
  reason: BuildPlannerSkippedSkillReason
}

export type BuildPlannerSkippedInventoryReason = 'embedded-socket' | 'unsupported-special-slot' | 'unknown-inventory-id'

export interface BuildPlannerSkippedInventorySlot {
  name: string
  reason: BuildPlannerSkippedInventoryReason
}

const ATTRIBUTE_TEXT: Record<number, string> = {
  1: '<red>{Strength +5}',
  2: '<green>{Dexterity +5}',
  3: '<blue>{Intelligence +5}',
}

const INVENTORY_IDS: Record<string, string> = {
  'Weapon 1': 'Weapon1',
  'Weapon 2': 'Weapon2',
  Helmet: 'Helm1',
  Gloves: 'Gloves1',
  'Body Armour': 'BodyArmour1',
  Boots: 'Boots1',
  'Ring 1': 'Ring1',
  'Ring 2': 'Ring2',
  Amulet: 'Amulet1',
  Belt: 'Belt1',
}

export async function loadBuildPlannerPassiveMap(treeVersion: string): Promise<BuildPlannerPassiveMap> {
  const response = await fetch(`/data/build-planner-passives-${treeVersion}.json`)
  if (!response.ok) {
    throw new Error(`Game Build Planner mapping is unavailable for tree ${treeVersion}`)
  }
  const value = await response.json() as Partial<BuildPlannerPassiveMap>
  if (value.treeVersion !== treeVersion || !value.nodes || typeof value.nodes !== 'object') {
    throw new Error(`Game Build Planner mapping is invalid for tree ${treeVersion}`)
  }
  return value as BuildPlannerPassiveMap
}

function resolveAscendancyId(input: CreateGameBuildPlannerInput): string | undefined {
  const currentClass = input.treeData.constants.classes[input.selectedClassId]
  const ascendancy = currentClass?.ascendancies.find((candidate) => (
    candidate.id === input.selectedAscendancyId
    || candidate.name === input.selectedAscendancyId
    || candidate.internalId === input.selectedAscendancyId
  ))
  return ascendancy?.internalId || ascendancy?.id || undefined
}

function metadataId(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed?.startsWith('Metadata/Items/') ? trimmed : undefined
}

function resolveGemId(gem: BuildGem, entry: SkillCatalogEntry | undefined, catalog: SkillCatalog | null): string | undefined {
  const original = [gem.gemId, gem.variantId, gem.skillId].map(metadataId).find(Boolean)
  if (original) return original
  const direct = metadataId(entry?.plannerSkillId) || entry?.gameIds.find(metadataId) || entry?.gemIds.find(metadataId)
  if (direct) return direct
  const parentEntryId = entry?.plannerParentSkillId
  const parentEntry = parentEntryId ? catalog?.entries[parentEntryId] : undefined
  return parentEntry?.gameIds.find(metadataId) || parentEntry?.gemIds.find(metadataId)
}

function gemName(gem: BuildGem): string {
  return gem.name || gem.skillId || gem.gemId || 'Unknown skill'
}

function skippedSkillReason(gem: BuildGem, entry: SkillCatalogEntry | undefined): BuildPlannerSkippedSkillReason | undefined {
  if (/^Spectre\s*:/i.test(gemName(gem))) return 'spectre'
  if (entry && (!entry.userVisible || entry.type === 'granted' || entry.type === 'hidden' || entry.type === 'internal')) {
    return 'granted'
  }
  return undefined
}

function buildSkills(code: string | null | undefined, catalog: SkillCatalog | null) {
  const skills: GameBuildPlannerSkill[] = []
  const missingSkills: string[] = []
  const skippedSkills: BuildPlannerSkippedSkill[] = []
  let supportCount = 0
  if (!code) return { skills, missingSkills, skippedSkills, supportCount }

  const parsed = parseSkillsXml(decodeCodeToXml(code))
  for (const group of parsed.groups) {
    const enabled = group.gems.filter((gem) => gem.enabled)
    if (!enabled.length) continue
    const resolved = enabled.map((gem) => {
      const entry = resolveSkillCatalogEntry(gem, catalog)
      return { gem, entry, id: resolveGemId(gem, entry, catalog) }
    })
    const active = resolved.find((item) => item.entry?.type !== 'support') || resolved[0]
    if (!active.id) {
      const reason = skippedSkillReason(active.gem, active.entry)
      if (reason) skippedSkills.push({ name: gemName(active.gem), reason })
      else missingSkills.push(gemName(active.gem))
      continue
    }
    const supports: string[] = []
    for (const item of resolved) {
      if (item === active) continue
      if (!item.id) {
        const reason = skippedSkillReason(item.gem, item.entry)
        if (reason) skippedSkills.push({ name: gemName(item.gem), reason })
        else missingSkills.push(gemName(item.gem))
        continue
      }
      if (item.entry?.type === 'support') supports.push(item.id)
    }
    const existing = skills.find((skill) => skill.id === active.id)
    if (existing) {
      const mergedSupports = new Set<string>([
        ...(existing.support_skills || []).filter((support): support is string => typeof support === 'string'),
        ...supports,
      ])
      existing.support_skills = mergedSupports.size ? [...mergedSupports] : undefined
    } else {
      skills.push({ id: active.id, ...(supports.length ? { support_skills: supports } : {}) })
    }
  }
  supportCount = skills.reduce((count, skill) => count + (skill.support_skills?.length || 0), 0)
  return { skills, missingSkills, skippedSkills, supportCount }
}

function cleanPlannerText(value: string): string {
  return value.replace(/[<>]/g, '').trim()
}

function itemHint(item: EquipmentItem, language: Language = 'en'): string {
  const lines = [item.baseType, ...(item.modifiers || []).map((modifier) => modifier.text)]
    .map(cleanPlannerText)
    .filter(Boolean)
    .map((line) => translateGameText(line, language))
  return lines.join('\n')
}

function activeEquipmentSlots(set: EquipmentSet): Map<string, string> {
  const result = new Map<string, string>()
  for (const slot of set.slots) {
    if (!slot.active || !slot.itemId) continue
    const name = set.useSecondWeaponSet
      ? slot.name.replace(/^Weapon ([12])$/, 'Weapon $1 Swap')
      : slot.name
    if (set.useSecondWeaponSet && /^Weapon [12]$/.test(slot.name)) continue
    if (!set.useSecondWeaponSet && /^Weapon [12] Swap$/.test(slot.name)) continue
    result.set(name.replace(/ Swap$/, ''), slot.itemId)
  }
  return result
}

function buildInventory(code: string | null | undefined, language: Language = 'en') {
  const inventorySlots: GameBuildPlannerInventorySlot[] = []
  const omittedInventorySlots: string[] = []
  const skippedInventorySlots: BuildPlannerSkippedInventorySlot[] = []
  if (!code) return { inventorySlots, omittedInventorySlots, skippedInventorySlots }
  const equipment = parseEquipmentXml(decodeCodeToXml(code))
  if (!equipment) return { inventorySlots, omittedInventorySlots, skippedInventorySlots }
  const set = equipment.itemSets.find((candidate) => candidate.id === equipment.activeItemSetId)
    || equipment.itemSets[0]
  if (!set) return { inventorySlots, omittedInventorySlots, skippedInventorySlots }

  for (const [slotName, itemId] of activeEquipmentSlots(set)) {
    const item = equipment.itemsById[itemId]
    if (!item) continue
    const inventoryId = INVENTORY_IDS[slotName]
    if (!inventoryId) {
      const reason: BuildPlannerSkippedInventoryReason = /Abyssal Socket|Socket \d+$/i.test(slotName)
        ? 'embedded-socket'
        : /^Incursion|^(Arm|Leg) \d+$/i.test(slotName)
          ? 'unsupported-special-slot'
          : 'unknown-inventory-id'
      skippedInventorySlots.push({ name: slotName, reason })
      if (reason !== 'embedded-socket') omittedInventorySlots.push(slotName)
      continue
    }
    const uniqueName = item.rarity.toUpperCase() === 'UNIQUE' ? item.name : undefined
    const additionalText = itemHint(item, language)
    inventorySlots.push({
      inventory_id: inventoryId,
      ...(uniqueName ? { unique_name: uniqueName } : {}),
      ...(additionalText ? { additional_text: additionalText } : {}),
    })
  }
  return { inventorySlots, omittedInventorySlots, skippedInventorySlots }
}

export function sanitizeBuildPlannerFileName(name: string): string {
  const clean = name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim()
  return `${clean || 'SuperPoE2 Build'}.build`
}

export function serializeGameBuildPlanner(build: GameBuildPlannerBuild): string {
  return `${JSON.stringify(build, null, 2)}\n`
}

export function createGameBuildPlanner(input: CreateGameBuildPlannerInput): GameBuildPlannerExport {
  const passives: GameBuildPlannerPassive[] = []
  const missingPassiveIds: string[] = []
  let weaponSetPassives = 0
  for (const nodeId of input.allocatedNodes) {
    const id = input.passiveMap.nodes[nodeId]
    if (!id) {
      missingPassiveIds.push(nodeId)
      continue
    }
    const weaponSet = input.nodeWeaponSets[nodeId]
    const attributeText = ATTRIBUTE_TEXT[input.nodeAttributeSelections[nodeId]]
    if (weaponSet) weaponSetPassives += 1
    passives.push({
      id,
      ...(weaponSet ? { weapon_set: weaponSet } : {}),
      ...(attributeText ? { additional_text: attributeText } : {}),
    })
  }
  const skillResult = buildSkills(input.importedBuildCode, input.skillCatalog)
  const inventoryResult = buildInventory(input.importedBuildCode, input.language)
  const build: GameBuildPlannerBuild = {
    name: input.name.trim() || 'SuperPoE2 Build',
    author: 'SuperPoE2',
    ...(input.sourceUrl ? { link: input.sourceUrl } : {}),
    description: `Exported by SuperPoE2 (passive tree ${input.treeVersion.replace('_', '.')})`,
    ...(resolveAscendancyId(input) ? { ascendancy: resolveAscendancyId(input) } : {}),
    ...(passives.length ? { passives } : {}),
    ...(skillResult.skills.length ? { skills: skillResult.skills } : {}),
    ...(inventoryResult.inventorySlots.length ? { inventory_slots: inventoryResult.inventorySlots } : {}),
  }
  return {
    build,
    json: serializeGameBuildPlanner(build),
    fileName: sanitizeBuildPlannerFileName(build.name),
    stats: {
      passives: passives.length,
      weaponSetPassives,
      skills: skillResult.skills.length,
      supports: skillResult.supportCount,
      inventorySlots: inventoryResult.inventorySlots.length,
    },
    missingPassiveIds,
    missingSkills: skillResult.missingSkills,
    skippedSkills: skillResult.skippedSkills,
    omittedInventorySlots: inventoryResult.omittedInventorySlots,
    skippedInventorySlots: inventoryResult.skippedInventorySlots,
  }
}

export async function generateGameBuildPlanner(
  input: Omit<CreateGameBuildPlannerInput, 'passiveMap' | 'skillCatalog'>,
): Promise<GameBuildPlannerExport> {
  const [passiveMap, skillCatalog] = await Promise.all([
    loadBuildPlannerPassiveMap(input.treeVersion),
    loadSkillCatalog(),
    loadTranslations(input.language || 'en'),
  ])
  return createGameBuildPlanner({ ...input, passiveMap, skillCatalog })
}

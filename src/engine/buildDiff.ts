import { decodeBuildCode, decodeCodeToXml } from '@/engine/buildCode'
import { parseEquipmentXml } from '@/engine/equipment'
import { parseSkillsXml, type BuildSkills } from '@/engine/skills'
import { normalizePobBuildCode } from '@/engine/pobItemCompatibility'
import type { EquipmentData, EquipmentItem } from '@/types/equipment'

export interface BuildChangeBucket {
  added: number
  removed: number
  changed: number
}

export interface BuildUpdateDiff {
  build: BuildChangeBucket
  tree: BuildChangeBucket
  equipment: BuildChangeBucket
  skills: BuildChangeBucket
  other: BuildChangeBucket
  total: number
  hasChanges: boolean
}

export type BuildUpdateSection = 'build' | 'tree' | 'equipment' | 'skills' | 'other'

export const BUILD_UPDATE_SECTIONS: readonly BuildUpdateSection[] = [
  'build', 'tree', 'equipment', 'skills', 'other',
]

function emptyBucket(): BuildChangeBucket {
  return { added: 0, removed: 0, changed: 0 }
}

function normalizeText(value: unknown): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim()
}

function parseXmlAttributes(xml: string, tagName: string): Record<string, string> {
  const tag = xml.match(new RegExp('<' + tagName + '\\b([^>]*)>', 'i'))?.[1] || ''
  const attrs: Record<string, string> = {}
  const attrRe = /([\w:-]+)=("([^"]*)"|'([^']*)')/g
  let match: RegExpExecArray | null
  while ((match = attrRe.exec(tag))) attrs[match[1]] = match[3] ?? match[4] ?? ''
  return attrs
}

function stableValue(value: unknown): string {
  return normalizeText(value).toLowerCase()
}

function compareScalarFields(
  left: Record<string, unknown>,
  right: Record<string, unknown>,
  fields: string[],
): number {
  return fields.reduce((count, field) => (
    stableValue(left[field]) === stableValue(right[field]) ? count : count + 1
  ), 0)
}

function compareStringSets(left: string[], right: string[]): Pick<BuildChangeBucket, 'added' | 'removed'> {
  const leftSet = new Set(left)
  const rightSet = new Set(right)
  return {
    added: right.filter((value) => !leftSet.has(value)).length,
    removed: left.filter((value) => !rightSet.has(value)).length,
  }
}

function compareTree(leftCode: string, rightCode: string): BuildChangeBucket {
  const left = decodeBuildCode(leftCode)
  const right = decodeBuildCode(rightCode)
  const nodeDelta = compareStringSets(left.nodes, right.nodes)
  const rightNodes = new Set(right.nodes)
  const sharedNodes = left.nodes.filter((nodeId) => rightNodes.has(nodeId))
  let changed = compareScalarFields(left as unknown as Record<string, unknown>, right as unknown as Record<string, unknown>, [
    'treeVersion',
    'classId',
    'ascendClassId',
    'classInternalId',
    'ascendancyInternalId',
    'activeSpecIndex',
  ])
  if (JSON.stringify(left.specs) !== JSON.stringify(right.specs)) changed += 1

  for (const nodeId of sharedNodes) {
    if (left.nodeWeaponSets[nodeId] !== right.nodeWeaponSets[nodeId]
      || left.nodeAttributeSelections[nodeId] !== right.nodeAttributeSelections[nodeId]) {
      changed += 1
    }
  }

  const jewelIds = new Set([...Object.keys(left.nodeJewels), ...Object.keys(right.nodeJewels)])
  for (const nodeId of jewelIds) {
    const leftJewel = left.nodeJewels[nodeId]
    const rightJewel = right.nodeJewels[nodeId]
    if (!leftJewel && rightJewel) nodeDelta.added += 1
    else if (leftJewel && !rightJewel) nodeDelta.removed += 1
    else if (JSON.stringify(leftJewel) !== JSON.stringify(rightJewel)) changed += 1
  }

  return { ...nodeDelta, changed }
}

function itemSignature(item: EquipmentItem | undefined): string {
  if (!item) return ''
  return JSON.stringify({
    rarity: stableValue(item.rarity),
    name: stableValue(item.name),
    baseType: stableValue(item.baseType),
    itemLevel: stableValue(item.itemLevel),
    levelReq: stableValue(item.levelReq),
    quality: stableValue(item.quality),
    sockets: stableValue(item.sockets),
    runes: item.runes.map(stableValue),
    modifiers: (item.modifiers || []).map((modifier) => ({
      text: stableValue(modifier.text),
      group: modifier.group,
      tags: [...modifier.tags].sort(),
    })),
  })
}

function activeEquipmentSet(data: EquipmentData | null): EquipmentData['itemSets'][number] | undefined {
  return data?.itemSets.find((set) => set.id === data.activeItemSetId) || data?.itemSets[0]
}

function equipmentSlots(data: EquipmentData | null): Map<string, string> {
  const activeSet = activeEquipmentSet(data)
  return new Map((activeSet?.slots || []).map((slot) => [
    slot.name,
    itemSignature(data?.itemsById[slot.itemId]) + ':' + (slot.active ? 'active' : 'inactive'),
  ]))
}

function compareEquipment(leftXml: string, rightXml: string): BuildChangeBucket {
  const left = parseEquipmentXml(leftXml)
  const right = parseEquipmentXml(rightXml)
  if (!left && !right) return emptyBucket()
  if (!left) return { added: 1, removed: 0, changed: 0 }
  if (!right) return { added: 0, removed: 1, changed: 0 }

  const result = emptyBucket()
  if (left.activeItemSetId !== right.activeItemSetId) result.changed += 1
  const leftSet = activeEquipmentSet(left)
  const rightSet = activeEquipmentSet(right)
  if (leftSet?.useSecondWeaponSet !== rightSet?.useSecondWeaponSet) result.changed += 1

  const leftSlots = equipmentSlots(left)
  const rightSlots = equipmentSlots(right)
  const slotNames = new Set([...leftSlots.keys(), ...rightSlots.keys()])
  for (const slotName of slotNames) {
    const leftItem = leftSlots.get(slotName)
    const rightItem = rightSlots.get(slotName)
    if (leftItem == null && rightItem != null) result.added += 1
    else if (leftItem != null && rightItem == null) result.removed += 1
    else if (leftItem !== rightItem) result.changed += 1
  }
  return result
}

function skillGroupSignature(group: BuildSkills['groups'][number]): string {
  return JSON.stringify({
    enabled: group.enabled,
    includeInFullDps: group.includeInFullDps,
    gems: group.gems.map((gem) => ({
      name: stableValue(gem.name),
      skillId: stableValue(gem.skillId),
      gemId: stableValue(gem.gemId),
      variantId: stableValue(gem.variantId),
      level: gem.level,
      quality: gem.quality,
      enabled: gem.enabled,
    })),
  })
}

function compareSkills(leftXml: string, rightXml: string): BuildChangeBucket {
  const left = parseSkillsXml(leftXml)
  const right = parseSkillsXml(rightXml)
  const result = emptyBucket()
  if (left.activeSkillSetId !== right.activeSkillSetId || left.activeGroupId !== right.activeGroupId) {
    result.changed += 1
  }

  const groupCount = Math.max(left.groups.length, right.groups.length)
  for (let index = 0; index < groupCount; index += 1) {
    const leftGroup = left.groups[index]
    const rightGroup = right.groups[index]
    if (!leftGroup && rightGroup) result.added += 1
    else if (leftGroup && !rightGroup) result.removed += 1
    else if (leftGroup && rightGroup && skillGroupSignature(leftGroup) !== skillGroupSignature(rightGroup)) {
      result.changed += 1
    }
  }
  return result
}

function stripKnownSections(xml: string): string {
  return normalizeText(xml
    .replace(/<Build\b[^>]*\/>/gi, '<Build/>')
    .replace(/<Tree\b[\s\S]*?<\/Tree>/gi, '<Tree/>')
    .replace(/<Items\b[\s\S]*?<\/Items>/gi, '<Items/>')
    .replace(/<Skills\b[\s\S]*?<\/Skills>/gi, '<Skills/>'))
}

function compareOther(leftXml: string, rightXml: string): BuildChangeBucket {
  return stripKnownSections(leftXml) === stripKnownSections(rightXml)
    ? emptyBucket()
    : { added: 0, removed: 0, changed: 1 }
}

export function compareBuildCodes(leftCode: string, rightCode: string): BuildUpdateDiff {
  const leftXml = decodeCodeToXml(normalizePobBuildCode(leftCode))
  const rightXml = decodeCodeToXml(normalizePobBuildCode(rightCode))
  const leftBuild = parseXmlAttributes(leftXml, 'Build')
  const rightBuild = parseXmlAttributes(rightXml, 'Build')
  const build = {
    added: 0,
    removed: 0,
    changed: compareScalarFields(leftBuild, rightBuild, [
      'level',
      'className',
      'ascendClassName',
      'targetVersion',
      'mainSocketGroup',
      'characterLevelAutoMode',
    ]),
  }
  const tree = compareTree(leftCode, rightCode)
  const equipment = compareEquipment(leftXml, rightXml)
  const skills = compareSkills(leftXml, rightXml)
  const other = compareOther(leftXml, rightXml)
  const total = [build, tree, equipment, skills, other].reduce(
    (sum, bucket) => sum + bucket.added + bucket.removed + bucket.changed,
    0,
  )
  return { build, tree, equipment, skills, other, total, hasChanges: total > 0 }
}

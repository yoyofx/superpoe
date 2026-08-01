import type { TreeData } from '@/types/tree'

type TreeClass = TreeData['constants']['classes'][string]

export interface ClassIdentifiers {
  classId?: string
  classInternalId?: string
}

export interface AscendancyIdentifiers {
  ascendClassId?: string
  ascendancyInternalId?: string
}

export function resolveTreeClass(
  treeData: TreeData | undefined,
  identifiers: ClassIdentifiers,
): [string, TreeClass] | null {
  if (!treeData) return null
  const classes = treeData.constants.classes || {}
  const entries = Object.entries(classes)
  const internalId = identifiers.classInternalId
  if (internalId) {
    const internalMatch = entries.find(([, cls]) => (
      String(cls.integerId) === internalId
      || cls.name === internalId
      || cls.displayName === internalId
    ))
    if (internalMatch) return internalMatch
  }

  const classId = identifiers.classId
  if (!classId) return null
  if (classes[classId]) return [classId, classes[classId]]
  return entries.find(([, cls]) => (
    String(cls.integerId) === classId
    || cls.name === classId
    || cls.displayName === classId
  )) || null
}

export function resolveTreeAscendancy(
  classData: TreeClass | undefined,
  identifiers: AscendancyIdentifiers,
): string {
  if (!classData) return ''
  const internalId = identifiers.ascendancyInternalId?.trim()
  const explicitId = identifiers.ascendClassId?.trim()
  const hasInternalId = !!internalId && internalId.toLowerCase() !== 'nil'
  const hasExplicitId = !!explicitId && explicitId !== '0' && explicitId.toLowerCase() !== 'nil'
  if (!hasInternalId && !hasExplicitId) return ''

  const ascendancy = classData.ascendancies.find((asc) => internalId && asc.internalId === internalId)
    || classData.ascendancies.find((asc) => (
      asc.id === explicitId
      || asc.name === explicitId
      || asc.internalId === explicitId
    ))
    || (/^\d+$/.test(explicitId || '') ? classData.ascendancies[Number(explicitId) - 1] : undefined)
  return ascendancy?.id || ascendancy?.name || ''
}

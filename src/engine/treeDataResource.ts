import type { TreeData } from '@/types/tree'

export function parseTreeDataResource(value: unknown, version: string): TreeData {
  if (!value || typeof value !== 'object') {
    throw new Error(`Passive tree data ${version} is invalid`)
  }
  const tree = value as Partial<TreeData>
  if (!tree.version || typeof tree.version !== 'object'
    || !tree.constants || typeof tree.constants !== 'object'
    || !tree.constants.classes || typeof tree.constants.classes !== 'object'
    || !tree.nodes || typeof tree.nodes !== 'object'
    || !tree.groups || typeof tree.groups !== 'object') {
    throw new Error(`Passive tree data ${version} is missing required fields`)
  }
  return tree as TreeData
}

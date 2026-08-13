import { decodeBuildCode } from '@/engine/buildCode'
import { normalizePobBuildCode } from '@/engine/pobItemCompatibility'
import { useTreeStore } from '@/store/treeStore'

export interface ImportedPobBuild {
  nodeCount: number
  treeVersion: string
}

/** Import any complete PoB code through the single store boundary. */
export async function importPobBuildCode(code: string, options: { allowEmptyTree?: boolean } = {}): Promise<ImportedPobBuild> {
  const trimmed = normalizePobBuildCode(code.trim())
  if (!trimmed) throw new Error('Missing PoB build code')

  const data = decodeBuildCode(trimmed)
  if (!data.nodes.length && !options.allowEmptyTree) throw new Error('The PoB build does not contain passive tree nodes')

  await useTreeStore.getState().importAllocatedNodes(data.nodes, data.nodeWeaponSets, {
    treeVersion: data.treeVersion,
    classId: data.classId,
    classInternalId: data.classInternalId,
    ascendClassId: data.ascendClassId,
    ascendancyInternalId: data.ascendancyInternalId,
    importedBuildCode: trimmed,
    nodeAttributeSelections: data.nodeAttributeSelections,
  })

  return {
    nodeCount: data.nodes.length,
    treeVersion: data.treeVersion || 'unknown',
  }
}

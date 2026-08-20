import type { TreeData, TreeNode } from '@/types/tree'

const VOICES_ALIASES = [
  'voices_jewel_slot1',
  'voices_jewel_slot2',
  'voices_jewel_slot3__',
  'voices_jewel_slot4',
  'voices_jewel_slot5',
] as const

export function isSinisterJewelSocket(node: TreeNode | undefined): boolean {
  if (!node) return false
  return Boolean(node.sinister || node.aliasPassiveSocket?.startsWith('voices_jewel_slot'))
    || (node.name === 'Sinister Jewel Socket' && (node.type === 'JewelSocket' || node.isJewelSocket === true))
}

export function getSinisterJewelSocketIds(treeData: TreeData | undefined, xml: string | null | undefined): Set<string> {
  const result = new Set<string>()
  if (!treeData || !xml) return result

  const byAlias = new Map<string, string>()
  for (const [id, node] of Object.entries(treeData.nodes)) {
    if (isSinisterJewelSocket(node) && node.aliasPassiveSocket) byAlias.set(node.aliasPassiveSocket, id)
  }
  if (!byAlias.size) return result

  // Restrict the scan to the active ItemSet and the active Spec sockets.  A
  // second item set may contain another Voices jewel but must not affect the
  // currently displayed tree.
  const itemsSection = xml.match(/<Items\b[^>]*>([\s\S]*?)<\/Items>/i)?.[1] || ''
  const activeItemSetId = xml.match(/<Items\b[^>]*\bactiveItemSet="([^"]+)"/i)?.[1]
  const itemSetMatch = [...itemsSection.matchAll(/<ItemSet\b([^>]*)>([\s\S]*?)<\/ItemSet>/gi)]
    .find((match) => !activeItemSetId || /\bid="([^"]+)"/i.exec(match[1])?.[1] === activeItemSetId)
  const activeSet = itemSetMatch?.[0] || ''
  const itemIds = new Set<string>()
  for (const match of activeSet.matchAll(/\bitemId="([^"]+)"/gi)) itemIds.add(match[1])

  const spec = xml.match(/<Tree\b[\s\S]*?<Spec\b[^>]*>([\s\S]*?)<\/Spec>/i)?.[1] || ''
  for (const match of spec.matchAll(/<Socket\b[^>]*\bitemId="([^"]+)"/gi)) itemIds.add(match[1])
  if (!itemIds.size) return result

  const itemRaws = new Map<string, string>()
  for (const match of itemsSection.matchAll(/<Item\b([^>]*)>([\s\S]*?)<\/Item>/gi)) {
    const id = /\bid="([^"]+)"/i.exec(match[1])?.[1]
    if (id && itemIds.has(id)) itemRaws.set(id, match[2].replace(/<[^>]+>/g, ' '))
  }
  let count = 0
  for (const raw of itemRaws.values()) {
    for (const match of raw.matchAll(/Allocates\s+(\d+)\s+Sinister\s+Jewel\s+sockets?/gi)) {
      count = Math.max(count, Math.min(Number(match[1]) || 0, VOICES_ALIASES.length))
    }
  }
  for (let index = 0; index < count; index += 1) {
    const id = byAlias.get(VOICES_ALIASES[index])
    if (id) result.add(id)
  }
  return result
}

export function isDynamicJewelSocketAllocated(
  nodeId: string,
  treeData: TreeData | undefined,
  xml: string | null | undefined,
): boolean {
  return getSinisterJewelSocketIds(treeData, xml).has(nodeId)
}

export const sinisterJewelSocketAliases = VOICES_ALIASES

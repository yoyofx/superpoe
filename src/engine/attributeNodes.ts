import type { TreeNode } from '@/types/tree'

export type AttributeSelection = 1 | 2 | 3
export type NodeAttributeSelections = Record<string, AttributeSelection>

export function normalizeAttributeSelection(value: unknown): AttributeSelection | null {
  return value === 1 || value === 2 || value === 3 ? value : null
}

export function nextAttributeSelection(current?: AttributeSelection): AttributeSelection {
  if (current === 1) return 2
  if (current === 2) return 3
  return 1
}

export function getAttributeNodeDisplay(
  node: TreeNode,
  selection?: AttributeSelection,
): Pick<TreeNode, 'name' | 'icon' | 'stats'> {
  if (!node.isAttribute || !selection) {
    return { name: node.name, icon: node.icon, stats: node.stats || [] }
  }

  const option = node.options?.[selection]
  if (!option) {
    return { name: node.name, icon: node.icon, stats: node.stats || [] }
  }

  return {
    name: option.name || node.name,
    icon: option.icon || node.icon,
    stats: option.stats?.length ? option.stats : node.stats || [],
  }
}

export function cleanAttributeSelections(
  nodes: Record<string, TreeNode> | undefined,
  allocatedNodes: Set<string>,
  selections: NodeAttributeSelections,
): NodeAttributeSelections {
  const next: NodeAttributeSelections = {}
  for (const [id, selection] of Object.entries(selections)) {
    const normalized = normalizeAttributeSelection(selection)
    if (normalized && allocatedNodes.has(id) && nodes?.[id]?.isAttribute) {
      next[id] = normalized
    }
  }
  return next
}

export function decodeBuildCodeXml(code: string, inflate: (data: Uint8Array) => Uint8Array): string | null {
  try {
    const normalized = code.trim().replace(/-/g, '+').replace(/_/g, '/')
    const binary = atob(normalized)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
    const inflated = inflate(bytes)
    return new TextDecoder().decode(inflated)
  } catch {
    return null
  }
}

function parseNodeList(value: string | null): string[] {
  return value ? value.split(',').map((id) => id.trim()).filter(Boolean) : []
}

export function parseAttributeSelectionsFromXml(xmlText: string | null): NodeAttributeSelections {
  const next: NodeAttributeSelections = {}
  if (!xmlText) return next
  const match = xmlText.match(/<AttributeOverride\b([^>]*)\/?>/i)
  if (!match) return next
  const attrs = match[1]
  const readAttr = (name: string) => attrs.match(new RegExp(`${name}="([^"]*)"`, 'i'))?.[1] || null
  for (const id of parseNodeList(readAttr('strNodes'))) next[id] = 1
  for (const id of parseNodeList(readAttr('dexNodes'))) next[id] = 2
  for (const id of parseNodeList(readAttr('intNodes'))) next[id] = 3
  return next
}

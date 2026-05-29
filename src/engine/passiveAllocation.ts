import type { TreeData, TreeNode } from '@/types/tree'

export type AllocMode = 0 | 1 | 2
export type NodeWeaponSets = Record<string, 1 | 2>

export interface AllocationContext {
  treeData: TreeData
  selectedClassId: string
  selectedAscendancyId: string
}

export interface AllocationState {
  allocatedNodes: Set<string>
  availableNodes: Set<string>
  nodeWeaponSets: NodeWeaponSets
}

export interface AllocationPath {
  nodes: string[]
  rootId: string | null
}

export const WEAPON_SET_COLORS: Record<1 | 2, string> = {
  1: '#DD0022',
  2: '#33FF77',
}

export function getNodeAllocMode(id: string, nodeWeaponSets: NodeWeaponSets): AllocMode {
  const mode = nodeWeaponSets[id]
  return mode === 1 || mode === 2 ? mode : 0
}

function cleanWeaponSets(allocatedNodes: Set<string>, nodeWeaponSets: NodeWeaponSets): NodeWeaponSets {
  const next: NodeWeaponSets = {}
  for (const [id, mode] of Object.entries(nodeWeaponSets)) {
    if (allocatedNodes.has(id) && (mode === 1 || mode === 2)) next[id] = mode
  }
  return next
}

function matchesAscendancy(asc: { id?: string; name: string; internalId?: string }, id: string): boolean {
  return asc.id === id || asc.name === id || asc.internalId === id
}

export function getImplicitRootIds(ctx: AllocationContext): Set<string> {
  const roots = new Set<string>()
  const cls = ctx.treeData.constants.classes[ctx.selectedClassId]
  if (cls?.startNodeId) roots.add(cls.startNodeId)

  const selectedAsc = cls?.ascendancies.find((asc) => matchesAscendancy(asc, ctx.selectedAscendancyId))
  if (selectedAsc) {
    for (const [id, node] of Object.entries(ctx.treeData.nodes)) {
      if (node.type === 'AscendClassStart' && node.ascendancyName === selectedAsc.name) {
        roots.add(id)
      }
    }
  }

  return roots
}

export function isEffectivelyAllocated(id: string, allocatedNodes: Set<string>, roots: Set<string>): boolean {
  return allocatedNodes.has(id) || roots.has(id)
}

function neighbors(treeData: TreeData, id: string): string[] {
  const node = treeData.nodes[id]
  if (!node) return []
  const ids = new Set<string>()
  for (const outId of node.out ?? []) ids.add(outId)
  for (const inId of node.in ?? []) ids.add(inId)
  return [...ids]
}

export function canPathThroughAllocMode(
  allocMode: AllocMode,
  nodeId: string,
  nodeWeaponSets: NodeWeaponSets,
): boolean {
  const nodeMode = getNodeAllocMode(nodeId, nodeWeaponSets)
  return nodeMode === 0 || (allocMode > 0 && nodeMode === allocMode)
}

function canAssignWeaponMode(node: TreeNode): boolean {
  return !node.ascendancyName
    && node.type !== 'Keystone'
    && node.type !== 'Socket'
    && node.type !== 'JewelSocket'
    && !node.isJewelSocket
}

function canTraverseEdge(from: TreeNode, to: TreeNode, rootDepth: number): boolean {
  if (from.type === 'Mastery') return false
  if (to.type === 'ClassStart' || to.type === 'AscendClassStart') return false
  return from.ascendancyName === to.ascendancyName || (rootDepth === 0 && !to.ascendancyName)
}

function makeAllocatedSet(allocatedNodes: Set<string>, roots: Set<string>): Set<string> {
  return new Set([...allocatedNodes, ...roots])
}

export function getAllocationPath(
  ctx: AllocationContext,
  allocatedNodes: Set<string>,
  nodeWeaponSets: NodeWeaponSets,
  targetId: string,
  allocMode: AllocMode,
  allocatedOnly = false,
  skipRootId?: string,
): AllocationPath | null {
  const roots = getImplicitRootIds(ctx)
  const effectiveAllocated = makeAllocatedSet(allocatedNodes, roots)
  const queue: string[] = []
  const visited = new Set<string>()
  const prev = new Map<string, string>()
  const depth = new Map<string, number>()
  const rootMode = allocatedOnly ? 0 : allocMode

  for (const id of effectiveAllocated) {
    if (id === skipRootId) continue
    if (!ctx.treeData.nodes[id]) continue
    if (!canPathThroughAllocMode(rootMode, id, nodeWeaponSets)) continue
    visited.add(id)
    depth.set(id, 0)
    queue.push(id)
  }

  for (let i = 0; i < queue.length; i++) {
    const id = queue[i]
    if (id === targetId) {
      const path: string[] = []
      let cur = targetId
      while (prev.has(cur)) {
        path.push(cur)
        cur = prev.get(cur)!
      }
      return { nodes: path, rootId: cur || null }
    }

    const node = ctx.treeData.nodes[id]
    if (!node) continue
    const rootDepth = depth.get(id) ?? 0
    for (const otherId of neighbors(ctx.treeData, id)) {
      const other = ctx.treeData.nodes[otherId]
      if (!other || visited.has(otherId)) continue
      if (!canTraverseEdge(node, other, rootDepth)) continue

      const otherMode = getNodeAllocMode(otherId, nodeWeaponSets)
      const otherAllocated = effectiveAllocated.has(otherId)
      const canVisit = allocatedOnly
        ? otherAllocated
          && canPathThroughAllocMode(allocMode, otherId, nodeWeaponSets)
          && (otherMode > 0 || (other.type !== 'ClassStart' && other.type !== 'AscendClassStart'))
        : (!otherAllocated || canPathThroughAllocMode(allocMode, otherId, nodeWeaponSets))

      if (!canVisit) continue
      visited.add(otherId)
      prev.set(otherId, id)
      depth.set(otherId, rootDepth + (otherAllocated ? 0 : 1))
      queue.push(otherId)
    }
  }

  return null
}

export function getEffectiveAllocationPath(
  ctx: AllocationContext,
  allocatedNodes: Set<string>,
  nodeWeaponSets: NodeWeaponSets,
  targetId: string,
  allocMode: AllocMode,
): AllocationPath | null {
  let path = getAllocationPath(ctx, allocatedNodes, nodeWeaponSets, targetId, allocMode)
  if (!path && allocMode === 0) {
    path = getAllocationPath(ctx, allocatedNodes, nodeWeaponSets, targetId, 1)
      ?? getAllocationPath(ctx, allocatedNodes, nodeWeaponSets, targetId, 2)
  }
  if (!path) return null

  const pathRootId = path.rootId
  const pathRootMode = pathRootId ? getNodeAllocMode(pathRootId, nodeWeaponSets) : 0
  if (pathRootMode === 0) return path

  if (allocMode === 0 && pathRootId && isEffectivelyAllocated(pathRootId, allocatedNodes, getImplicitRootIds(ctx))) {
    const rootPath = getAllocationPath(ctx, allocatedNodes, nodeWeaponSets, pathRootId, pathRootMode, true, pathRootId)
    const merged = [...path.nodes]
    for (const id of rootPath?.nodes ?? [pathRootId]) {
      if (!merged.includes(id)) merged.push(id)
    }
    path = { nodes: merged, rootId: rootPath?.rootId ?? path.rootId }
  } else if (allocMode > 0 && pathRootMode !== allocMode) {
    path = getAllocationPath(ctx, allocatedNodes, nodeWeaponSets, targetId, allocMode)
  }

  return path
}

export function buildAvailableAndDepends(
  ctx: AllocationContext,
  allocatedNodes: Set<string>,
  nodeWeaponSets: NodeWeaponSets,
): AllocationState {
  const roots = getImplicitRootIds(ctx)
  const effectiveAllocated = makeAllocatedSet(allocatedNodes, roots)
  const availableNodes = new Set<string>()
  const queue: string[] = []
  const visited = new Set<string>()
  const depth = new Map<string, number>()

  for (const root of roots) {
    if (!ctx.treeData.nodes[root]) continue
    visited.add(root)
    depth.set(root, 0)
    queue.push(root)
  }

  for (let i = 0; i < queue.length; i++) {
    const id = queue[i]
    const node = ctx.treeData.nodes[id]
    if (!node) continue
    const rootDepth = depth.get(id) ?? 0
    for (const otherId of neighbors(ctx.treeData, id)) {
      const other = ctx.treeData.nodes[otherId]
      if (!other || visited.has(otherId)) continue
      if (!canTraverseEdge(node, other, rootDepth)) continue
      if (effectiveAllocated.has(otherId) && !canPathThroughAllocMode(0, otherId, nodeWeaponSets)) continue
      visited.add(otherId)
      depth.set(otherId, rootDepth + (effectiveAllocated.has(otherId) ? 0 : 1))
      queue.push(otherId)
      if (!effectiveAllocated.has(otherId)) availableNodes.add(otherId)
    }
  }

  return {
    allocatedNodes: new Set(allocatedNodes),
    availableNodes,
    nodeWeaponSets: cleanWeaponSets(allocatedNodes, nodeWeaponSets),
  }
}

function modeForNode(node: TreeNode, allocMode: AllocMode): AllocMode {
  if (allocMode === 0 || !canAssignWeaponMode(node)) return 0
  return allocMode
}

export function allocateNode(
  ctx: AllocationContext,
  allocatedNodes: Set<string>,
  nodeWeaponSets: NodeWeaponSets,
  targetId: string,
  allocMode: AllocMode,
): AllocationState {
  const path = getEffectiveAllocationPath(ctx, allocatedNodes, nodeWeaponSets, targetId, allocMode)
  if (!path) return buildAvailableAndDepends(ctx, allocatedNodes, nodeWeaponSets)

  const nextAllocated = new Set(allocatedNodes)
  const nextWeaponSets: NodeWeaponSets = { ...nodeWeaponSets }
  for (const id of path.nodes) {
    const node = ctx.treeData.nodes[id]
    if (!node || node.type === 'ClassStart' || node.type === 'AscendClassStart' || node.type === 'OnlyImage') continue
    nextAllocated.add(id)
    const nodeMode = modeForNode(node, allocMode)
    if (nodeMode === 1 || nodeMode === 2) nextWeaponSets[id] = nodeMode
    else delete nextWeaponSets[id]
  }

  return buildAvailableAndDepends(ctx, nextAllocated, nextWeaponSets)
}

export function deallocateNode(
  ctx: AllocationContext,
  allocatedNodes: Set<string>,
  nodeWeaponSets: NodeWeaponSets,
  targetId: string,
): AllocationState {
  const roots = getImplicitRootIds(ctx)
  if (roots.has(targetId)) return buildAvailableAndDepends(ctx, allocatedNodes, nodeWeaponSets)

  const remaining = new Set(allocatedNodes)
  remaining.delete(targetId)
  const effective = makeAllocatedSet(remaining, roots)
  const reachable = new Set<string>()
  const queue = [...roots]
  for (const root of roots) reachable.add(root)

  for (let i = 0; i < queue.length; i++) {
    const id = queue[i]
    const mode = getNodeAllocMode(id, nodeWeaponSets)
    const node = ctx.treeData.nodes[id]
    if (!node) continue
    for (const otherId of neighbors(ctx.treeData, id)) {
      if (!effective.has(otherId) || reachable.has(otherId)) continue
      const other = ctx.treeData.nodes[otherId]
      if (!other) continue
      const otherMode = getNodeAllocMode(otherId, nodeWeaponSets)
      if (mode !== 0 && otherMode !== 0 && mode !== otherMode) continue
      if (node.ascendancyName && other.ascendancyName && node.ascendancyName !== other.ascendancyName) continue
      reachable.add(otherId)
      queue.push(otherId)
    }
  }

  const nextAllocated = new Set<string>()
  for (const id of remaining) {
    if (reachable.has(id)) nextAllocated.add(id)
  }

  return buildAvailableAndDepends(ctx, nextAllocated, cleanWeaponSets(nextAllocated, nodeWeaponSets))
}

export function getPreviewPath(
  ctx: AllocationContext,
  allocatedNodes: Set<string>,
  nodeWeaponSets: NodeWeaponSets,
  targetId: string | null,
  allocMode: AllocMode,
): Set<string> {
  if (!targetId || allocatedNodes.has(targetId)) return new Set()
  const path = getEffectiveAllocationPath(ctx, allocatedNodes, nodeWeaponSets, targetId, allocMode)
  return new Set(path?.nodes ?? [])
}

export function isConnectorActiveForModes(
  id1: string,
  id2: string,
  allocatedNodes: Set<string>,
  roots: Set<string>,
  nodeWeaponSets: NodeWeaponSets,
): boolean {
  if (!isEffectivelyAllocated(id1, allocatedNodes, roots) || !isEffectivelyAllocated(id2, allocatedNodes, roots)) {
    return false
  }
  const mode1 = getNodeAllocMode(id1, nodeWeaponSets)
  const mode2 = getNodeAllocMode(id2, nodeWeaponSets)
  return mode1 === 0 || mode2 === 0 || mode1 === mode2
}

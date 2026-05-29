import type { AscendancyClass, TreeConnectorQuad, TreeData, TreeNode } from '@/types/tree'

export const NODE_RADIUS: Record<string, number> = {
  Normal: 5,
  Notable: 9,
  Keystone: 13,
  ClassStart: 16,
  AscendClassStart: 12,
  Mastery: 8,
  JewelSocket: 9,
  Socket: 5,
}

export const NODE_COLOR: Record<string, string> = {
  Normal: '#888',
  Notable: '#C8A05A',
  Keystone: '#D45A5A',
  ClassStart: '#6AA84F',
  AscendClassStart: '#6AA84F',
  Mastery: '#6A8FC8',
  JewelSocket: '#C87ADA',
  Socket: '#888',
}

const ASCENDANCY_CENTER_MARGIN = 120

export interface AscendancyProjection {
  ascendancyName: string
  sourceX: number
  sourceY: number
  targetX: number
  targetY: number
  scale: number
}

export function matchesAscendancy(asc: AscendancyClass, id: string): boolean {
  return asc.id === id || asc.name === id
}

export function getSelectedAscendancyProjection(
  treeData: TreeData,
  selectedClassId: string,
  selectedAscendancyId: string,
): AscendancyProjection | null {
  const cls = treeData.constants.classes?.[selectedClassId]
  const ascendancy = cls?.ascendancies?.find((asc) => matchesAscendancy(asc, selectedAscendancyId))
  if (!cls?.background || !ascendancy?.background) return null

  const startNode = cls.startNodeId ? treeData.nodes[cls.startNodeId] : undefined
  if (!startNode) return null

  const targetX = cls.background.x
  const targetY = cls.background.y
  const sourceX = ascendancy.background.x
  const sourceY = ascendancy.background.y
  const maxRadius = Object.values(treeData.nodes).reduce((max, node) => {
    if (node.ascendancyName !== ascendancy.name) return max
    return Math.max(max, Math.hypot(node.x - sourceX, node.y - sourceY))
  }, Math.max(ascendancy.background.width, ascendancy.background.height) / 2)
  const boundaryRadius = Math.max(
    1,
    Math.hypot(startNode.x - targetX, startNode.y - targetY) - ASCENDANCY_CENTER_MARGIN,
  )
  const scale = maxRadius > 0 ? Math.min(1, boundaryRadius / maxRadius) : 1

  return {
    ascendancyName: ascendancy.name,
    sourceX,
    sourceY,
    targetX,
    targetY,
    scale,
  }
}

export function projectPoint(x: number, y: number, projection: AscendancyProjection): [number, number] {
  return [
    projection.targetX + (x - projection.sourceX) * projection.scale,
    projection.targetY + (y - projection.sourceY) * projection.scale,
  ]
}

export function getRenderTreePoint(node: TreeNode, projection: AscendancyProjection | null): [number, number] {
  if (projection && node.ascendancyName === projection.ascendancyName) {
    return projectPoint(node.x, node.y, projection)
  }
  return [node.x, node.y]
}

export function shouldProjectConnector(connector: TreeConnectorQuad, projection: AscendancyProjection | null): boolean {
  return !!projection && connector.ascendancyName === projection.ascendancyName
}

export function isClassToAscendancyConnector(node1?: TreeNode, node2?: TreeNode): boolean {
  if (!node1 || !node2) return false
  return (node1.type === 'ClassStart' && node2.type === 'AscendClassStart')
    || (node2.type === 'ClassStart' && node1.type === 'AscendClassStart')
}

export type JewelRadiusKind = 'normal' | 'variable' | 'special'
export type JewelRadiusVisual = 'standard' | 'from-nothing' | 'conqueror'

export interface JewelRadiusDefinition {
  index: number
  label: string
  inner: number
  outer: number
  color?: string
}

export interface JewelRadiusEffect {
  socketNodeId: string
  itemId: string
  label: string
  radiusIndex?: number
  inner?: number
  outer?: number
  color?: string
  kind: JewelRadiusKind
  visual?: JewelRadiusVisual
  conqueror?: string
  centerNodeIds: string[]
}

export interface JewelRadiusPreview {
  nodeId: string
  radiusIndex: number
}

export interface JewelRadiusSnapshot {
  success: boolean
  multiplier: number
  definitions: JewelRadiusDefinition[]
  effects: JewelRadiusEffect[]
  error?: string
}

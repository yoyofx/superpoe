import type { SkillCalculationMode } from '../types/calc.js'

export type EquipmentDifferenceCandidateSource =
  | 'equipment-slot'
  | 'equipment-library'
  | 'market-listing'
  | 'custom'

export interface BuildContextSnapshot {
  xml: string
  buildRevision: number
  activeItemSetId: string
  activeWeaponSet: 1 | 2
  configFingerprint?: string
  configOverrides?: Record<string, boolean | number | string>
  activeSkillContext?: {
    skillGroupId?: string
    calcMode?: SkillCalculationMode
  }
}

export interface EquipmentDifferenceRequest {
  context: BuildContextSnapshot
  candidate: {
    raw: string
    buildItemId?: string
    source: EquipmentDifferenceCandidateSource
  }
  sourceSlotName?: string
  slotOnlyTooltips?: boolean
}

export interface EquipmentDiffStat {
  key: string
  label: string
  actor: 'player' | 'minion'
  baseValue: number
  candidateValue: number
  delta: number
  displayDelta: number
  percent?: number
  format?: string
  positive: boolean
  lowerIsBetter: boolean
  compPercent: boolean
  color: 'positive' | 'negative'
}

export interface EquipmentSlotDiff {
  slotName: string
  slotLabel: string
  operation: 'equip' | 'remove' | 'toggle-on' | 'toggle-off'
  replacedItemId?: string
  replacedItemName?: string
  changedStats: EquipmentDiffStat[]
  sort: {
    empty: boolean
    similar: boolean
    fullDps?: number
    combinedDps?: number
    totalEhp?: number
  }
}

export type EquipmentDifferenceErrorCode =
  | 'invalid-build'
  | 'invalid-item'
  | 'no-valid-slot'
  | 'calculation-failed'
  | 'stale-context'
  | 'runtime-unavailable'

export interface EquipmentDifferenceResult {
  success: boolean
  contextKey?: string
  groups?: EquipmentSlotDiff[]
  warnings?: string[]
  performance?: {
    sessionReused: boolean
    baseCalculationMs: number
    candidateCalculationMs: number
    cacheHit: boolean
  }
  error?: {
    code: EquipmentDifferenceErrorCode
    message: string
  }
}

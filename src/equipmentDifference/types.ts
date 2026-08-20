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
  /** Item selected when a build-aware comparison was opened. */
  buildItemId?: string
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
    runeBehavior?: 'copy-current' | 'keep' | 'remove'
    anointBehavior?: 'copy-current' | 'keep' | 'remove'
  }
  sourceSlotName?: string
  slotOnlyTooltips?: boolean
  /** Optional PoB2 stat weights used only for Find Better ranking. */
  weightSpec?: Array<{
    stat: string
    weightMult: number
    lowerIsBetter?: boolean
  }>
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

/**
 * PoB2's weighted search value for one concrete replacement slot. This is
 * calculated by the project-owned Lua bridge with the upstream
 * TradeQueryGenerator implementation; the renderer must not reconstruct it
 * from display deltas.
 */
export interface EquipmentWeightedEvaluation {
  weightedRatio: number
  stats: Array<{
    stat: string
    baseValue: number
    candidateValue: number
    ratio: number
    weightMult: number
    transformedRatio: number
  }>
}

export interface EquipmentSlotDiff {
  slotName: string
  slotLabel: string
  operation: 'equip' | 'remove' | 'toggle-on' | 'toggle-off'
  replacedItemId?: string
  replacedItemName?: string
  changedStats: EquipmentDiffStat[]
  ranking?: EquipmentWeightedEvaluation
  sort: {
    empty: boolean
    similar: boolean
    fullDps?: number
    combinedDps?: number
    totalEhp?: number
    weaponDps?: number
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

import type { EquipmentModifierGroup } from '@/types/equipment'

export type EquipmentModifierType = 'BASE' | 'INC' | 'MORE' | 'FLAG' | 'LIST' | string
export type EquipmentModifierScope = 'local' | 'global'
export type EquipmentModifierRecipient = 'player' | 'minion' | 'companion' | 'ally' | 'player-and-allies' | 'enemy'
export type EquipmentModifierWrapper = 'MinionModifier' | 'ExtraAura' | 'GemProperty'

export interface EquipmentSemanticTag {
  type?: string
  [key: string]: string | number | boolean | undefined
}

export interface EquipmentSemanticModifier {
  name: string
  type: EquipmentModifierType
  value: string | number | boolean | null
  flags: string[]
  keywordFlags: string[]
  tags: EquipmentSemanticTag[]
  scope: EquipmentModifierScope
  recipient: EquipmentModifierRecipient
  wrapper?: EquipmentModifierWrapper
  line: string
  group: EquipmentModifierGroup
}

export interface EquipmentSemanticLine {
  text: string
  group: EquipmentModifierGroup
  parsed: boolean
  modifiers: EquipmentSemanticModifier[]
}

export interface EquipmentItemSemantics {
  baseType?: string
  itemType?: string
  isWeapon: boolean
  isArmour: boolean
  lines: EquipmentSemanticLine[]
}

export interface EquipmentInspectionItem {
  id: string
  raw: string
}

export interface EquipmentInspectionResult {
  items: Record<string, EquipmentItemSemantics>
  errors: Record<string, string>
  performance: {
    initMs: number
    parseMs: number
    cacheHits: number
    cacheMisses: number
  }
}

export type ItemRarity = 'NORMAL' | 'MAGIC' | 'RARE' | 'UNIQUE' | string

export interface EquipmentItem {
  id: string
  rarity: ItemRarity
  name: string
  baseType: string
  itemLevel?: string
  levelReq?: string
  quality?: string
  sockets?: string
  socketCount: number
  runes: string[]
  lines: string[]
  raw: string
  imageUrl?: string
}

export interface EquipmentSlot {
  name: string
  itemId: string
  active: boolean
}

export interface EquipmentSet {
  id: string
  title: string
  useSecondWeaponSet: boolean
  slots: EquipmentSlot[]
}

export interface EquipmentData {
  itemsById: Record<string, EquipmentItem>
  itemSets: EquipmentSet[]
  activeItemSetId: string
}

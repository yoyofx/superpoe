import type { EquipmentLibraryEntry } from '@/types/market'

export type EquipmentLibrarySlotKind = 'weapon' | 'helmet' | 'gloves' | 'body' | 'boots' | 'ring' | 'amulet' | 'belt' | 'charm' | 'flask' | 'jewel'

function categoryKind(category: string | undefined): EquipmentLibrarySlotKind | null {
  const normalized = category?.trim().toLowerCase()
  if (!normalized) return null
  if (normalized === 'jewel' || normalized.startsWith('jewel.')) return 'jewel'
  if (normalized.startsWith('weapon.') || ['armour.shield', 'armour.focus', 'armour.buckler', 'armour.quiver'].includes(normalized)) return 'weapon'
  if (normalized === 'armour.helmet') return 'helmet'
  if (normalized === 'armour.gloves') return 'gloves'
  if (normalized === 'armour.chest') return 'body'
  if (normalized === 'armour.boots') return 'boots'
  if (normalized === 'accessory.ring' || normalized === 'jewellery.ring') return 'ring'
  if (normalized === 'accessory.amulet' || normalized === 'jewellery.amulet') return 'amulet'
  if (normalized === 'accessory.belt' || normalized === 'jewellery.belt') return 'belt'
  if (normalized.startsWith('jewellery.charm')) return 'charm'
  if (normalized.startsWith('flask.')) return 'flask'
  return null
}

function textKind(text: string): EquipmentLibrarySlotKind | null {
  const value = text.toLocaleLowerCase()
  if (/\b(?:cluster\s+)?jewel\b/.test(value)) return 'jewel'
  if (/\b(?:shield|focus|buckler|quiver|quarterstaff|warstaff|staff|wand|bow|crossbow|spear|flail|sceptre|mace|sword|axe|dagger|claw|talisman)\b/.test(value)) return 'weapon'
  if (/\b(?:helmet|mask|hood|circlet|crown|cap|greathelm|veil)\b/.test(value)) return 'helmet'
  if (/\b(?:gloves?|gauntlets?|mitts?|bracers?|grips?|wraps?)\b/.test(value)) return 'gloves'
  if (/\b(?:body\s+armou?r|robe|vest|coat|plate|garb|brigandine|cuirass|jacket)\b/.test(value)) return 'body'
  if (/\b(?:boots?|greaves?|shoes?|slippers?|striders?|sabatons?)\b/.test(value)) return 'boots'
  if (/\b(?:ring)\b/.test(value)) return 'ring'
  if (/\b(?:amulet|talisman)\b/.test(value)) return 'amulet'
  if (/\b(?:belt|sash)\b/.test(value)) return 'belt'
  if (/\b(?:charm)\b/.test(value)) return 'charm'
  if (/\b(?:flask|vial)\b/.test(value)) return 'flask'
  return null
}

function entryIdentity(entry: EquipmentLibraryEntry): string {
  const rawIdentity = entry.item.raw.split(/\r?\n/).slice(0, 4).join(' ')
  return [entry.view.baseType, entry.view.name, rawIdentity].filter(Boolean).join(' ')
}

export function equipmentLibraryEntryKind(entry: EquipmentLibraryEntry): EquipmentLibrarySlotKind | null {
  return categoryKind(entry.view.tradeCategory || entry.item.tradeCategory) || textKind(entryIdentity(entry))
}

export function isEquipmentLibraryJewel(entry: EquipmentLibraryEntry): boolean {
  return equipmentLibraryEntryKind(entry) === 'jewel'
}

function slotKind(slot: string): EquipmentLibrarySlotKind | null {
  const normalized = slot.trim().toLowerCase()
  if (normalized.includes('jewel socket') || normalized.includes('abyssal socket') || normalized.includes('珠宝插槽') || normalized.includes('珠寶插槽')) return 'jewel'
  if (normalized.includes('weapon')) return 'weapon'
  if (normalized.includes('helmet')) return 'helmet'
  if (normalized.includes('glove')) return 'gloves'
  if (normalized.includes('body') || normalized.includes('chest')) return 'body'
  if (normalized.includes('boot')) return 'boots'
  if (normalized.includes('ring')) return 'ring'
  if (normalized.includes('amulet')) return 'amulet'
  if (normalized.includes('belt')) return 'belt'
  if (normalized.includes('charm')) return 'charm'
  if (normalized.includes('flask')) return 'flask'
  return null
}

export function fitsEquipmentLibrarySlot(entry: EquipmentLibraryEntry, slot: string | undefined): boolean {
  const kind = equipmentLibraryEntryKind(entry)
  if (!slot) return kind !== 'jewel'
  const expected = slotKind(slot)
  if (!expected || !kind) return false
  return kind === expected
}

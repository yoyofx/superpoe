import type { EquipmentCollectionRoot, EquipmentLibraryEntry } from '@/types/market'
import { fitsEquipmentLibrarySlot, isEquipmentLibraryJewel } from './equipmentLibrarySlot'

export type EquipmentLibraryQueryKind = 'workspace' | 'equipment-slot' | 'jewel-slot' | 'try-on' | 'price-check'

export interface EquipmentLibraryQueryContext {
  kind: EquipmentLibraryQueryKind
  allowedRoots?: readonly EquipmentCollectionRoot[]
  slotName?: string
}

export function equipmentLibraryEntryMatchesContext(entry: EquipmentLibraryEntry, context: EquipmentLibraryQueryContext): boolean {
  if (context.allowedRoots?.length && !context.allowedRoots.includes(entry.collectionRoot)) return false
  if (context.kind === 'jewel-slot' && !isEquipmentLibraryJewel(entry)) return false
  if ((context.kind === 'equipment-slot' || context.kind === 'try-on') && !fitsEquipmentLibrarySlot(entry, context.slotName)) return false
  return true
}

export function equipmentLibrarySearchText(entry: EquipmentLibraryEntry): string {
  return [
    entry.view.name,
    entry.view.baseType,
    entry.view.tradeCategory,
    ...entry.view.modifiers.flatMap((modifier) => [modifier.text, ...Object.values(modifier.localized || {})]),
    ...Object.values(entry.view.localized || {}).flatMap((localized) => [localized.name, localized.baseType]),
  ].filter(Boolean).join('\n').toLocaleLowerCase()
}

export function filterEquipmentLibraryEntries(
  entries: readonly EquipmentLibraryEntry[],
  context: EquipmentLibraryQueryContext,
  query = '',
): EquipmentLibraryEntry[] {
  const normalizedQuery = query.trim().toLocaleLowerCase()
  return entries.filter((entry) => equipmentLibraryEntryMatchesContext(entry, context))
    .filter((entry) => !normalizedQuery || equipmentLibrarySearchText(entry).includes(normalizedQuery))
}


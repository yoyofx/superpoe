import type { BuildContextSnapshot } from '../equipmentDifference/types.js'
import type { EquipmentLibraryEntry } from './market.js'

export type EquipmentTryOnLanguage = 'en' | 'zh-rCN' | 'zh-rTW' | 'ko-KR'

export interface EquipmentTryOnOpenRequest {
  entry: EquipmentLibraryEntry
  context: BuildContextSnapshot | null
  language: EquipmentTryOnLanguage
}

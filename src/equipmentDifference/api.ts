import { compareEquipment as compareEquipmentRuntime } from '@/engine/pobLuaClient'
import { createEquipmentDifferenceCacheKeys, equipmentDifferenceCache } from './comparisonCache'
import type { EquipmentDifferenceRequest, EquipmentDifferenceResult } from './types'

export async function requestEquipmentDifference(
  request: EquipmentDifferenceRequest,
): Promise<EquipmentDifferenceResult> {
  if (!request.context.xml) {
    return {
      success: false,
      error: { code: 'invalid-build', message: 'Missing build XML' },
    }
  }
  if (!request.candidate.raw) {
    return {
      success: false,
      error: { code: 'invalid-item', message: 'Missing candidate item' },
    }
  }

  const keys = createEquipmentDifferenceCacheKeys(request)
  const cached = equipmentDifferenceCache.get(keys)
  if (cached) {
    return {
      ...cached,
      performance: cached.performance
        ? { ...cached.performance, cacheHit: true }
        : { sessionReused: true, baseCalculationMs: 0, candidateCalculationMs: 0, cacheHit: true },
    }
  }

  const result = await compareEquipmentRuntime(request, keys.contextKey)
  if (result.success) equipmentDifferenceCache.set(keys, result)
  return result
}

export function clearEquipmentDifferenceCache(): void {
  equipmentDifferenceCache.clear()
}

import { afterEach, describe, expect, it } from 'vitest'
import { createEquipmentDifferenceCacheKeys, equipmentDifferenceCache } from '@/equipmentDifference/comparisonCache'
import type { EquipmentDifferenceRequest, EquipmentDifferenceResult } from '@/equipmentDifference/types'

const baseRequest: EquipmentDifferenceRequest = {
  context: {
    xml: '<PathOfBuilding2 />',
    buildRevision: 1,
    activeItemSetId: '1',
    activeWeaponSet: 1,
  },
  candidate: {
    raw: 'Rarity: RARE\nTest Ring\nRuby Ring',
    source: 'custom',
  },
}

const result: EquipmentDifferenceResult = {
  success: true,
  groups: [],
}

describe('equipment difference cache', () => {
  afterEach(() => equipmentDifferenceCache.clear())

  it('reuses an exact candidate result for the same build context', () => {
    const keys = createEquipmentDifferenceCacheKeys(baseRequest)
    equipmentDifferenceCache.set(keys, result)

    expect(equipmentDifferenceCache.get(keys)).toBe(result)
    expect(equipmentDifferenceCache.get(createEquipmentDifferenceCacheKeys({
      ...baseRequest,
      candidate: { ...baseRequest.candidate, raw: baseRequest.candidate.raw + '\n+10 to maximum Life' },
    }))).toBeNull()
  })

  it('invalidates results when the active weapon set or config changes', () => {
    const keys = createEquipmentDifferenceCacheKeys(baseRequest)
    equipmentDifferenceCache.set(keys, result)

    expect(equipmentDifferenceCache.get(createEquipmentDifferenceCacheKeys({
      ...baseRequest,
      context: { ...baseRequest.context, activeWeaponSet: 2 },
    }))).toBeNull()
    expect(equipmentDifferenceCache.get(createEquipmentDifferenceCacheKeys({
      ...baseRequest,
      context: { ...baseRequest.context, configOverrides: { enemyIsBoss: true } },
    }))).toBeNull()
  })
})

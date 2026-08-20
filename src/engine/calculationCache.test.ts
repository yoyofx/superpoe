import { afterEach, describe, expect, it } from 'vitest'
import { calculationCache, createCalculationCacheKeys } from '@/engine/calculationCache'
import type { CalcResult } from '@/types/calc'

const result = { FullDPS: 123, SkillDPS: [{ name: 'Comet', dps: 123, count: 1 }] } as CalcResult

describe('calculation cache', () => {
  afterEach(() => calculationCache.clear())

  it('reuses an exact calculation result for the same context and selection', () => {
    const input = {
      code: 'build-code',
      xml: '<PathOfBuilding2 />',
      weaponSet: 1 as const,
      calcMode: 'EFFECTIVE' as const,
      configOverrides: { enemyIsBoss: true },
      selection: { skillGroupId: '1', calcMode: 'EFFECTIVE' as const },
    }
    const keys = createCalculationCacheKeys(input)
    calculationCache.set(keys, result)

    expect(calculationCache.get(keys.resultKey)).toBe(result)
    expect(calculationCache.getContextResult(keys.contextKey)).toBe(result)
  })

  it('does not reuse results across weapon sets or build contents', () => {
    const base = {
      code: 'build-code',
      xml: '<PathOfBuilding2 />',
      weaponSet: 1 as const,
      selection: { skillGroupId: '1' },
    }
    const keys = createCalculationCacheKeys(base)
    calculationCache.set(keys, result)

    expect(calculationCache.get(createCalculationCacheKeys({ ...base, weaponSet: 2 }).resultKey)).toBeNull()
    expect(calculationCache.get(createCalculationCacheKeys({ ...base, xml: '<PathOfBuilding2 changed="true" />' }).resultKey)).toBeNull()
  })
})

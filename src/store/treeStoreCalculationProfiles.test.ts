import { beforeEach, describe, expect, it } from 'vitest'
import { useTreeStore } from '@/store/treeStore'
import type { CalcResult } from '@/types/calc'

describe('tree store calculation profiles', () => {
  beforeEach(() => {
    useTreeStore.setState({
      calculationProfiles: [{ id: 'default', name: 'Default', values: {} }],
      activeCalculationProfileId: 'default',
      calculationConfig: null,
      calcResult: { TotalDPS: 123 } as CalcResult,
      calcError: 'stale error',
    })
  })

  it('keeps overrides isolated when creating and switching profiles', () => {
    const store = useTreeStore.getState()
    store.setCalculationConfigValue('conditionRage', 44)
    useTreeStore.getState().addCalculationProfile(true)

    const copied = useTreeStore.getState()
    expect(copied.calculationProfiles).toHaveLength(2)
    expect(copied.calculationProfiles[1].values).toEqual({ conditionRage: 44 })

    copied.setCalculationConfigValue('conditionRage', 20)
    copied.setActiveCalculationProfile('default')
    expect(useTreeStore.getState().calculationProfiles[0].values).toEqual({ conditionRage: 44 })
    expect(useTreeStore.getState().calculationProfiles[1].values).toEqual({ conditionRage: 20 })
  })

  it('resets only the active profile and invalidates stale calculation output', () => {
    const store = useTreeStore.getState()
    store.setCalculationConfigValue('conditionRage', 44)

    expect(useTreeStore.getState().calcResult).toBeNull()
    expect(useTreeStore.getState().calcError).toBeNull()

    useTreeStore.setState({ calcResult: { TotalDPS: 456 } as CalcResult })
    useTreeStore.getState().resetCalculationConfig()
    expect(useTreeStore.getState().calculationProfiles[0].values).toEqual({})
    expect(useTreeStore.getState().calcResult).toBeNull()
  })

  it('includes local profiles in JSON export without modifying the imported code', () => {
    useTreeStore.setState({
      importedBuildCode: 'original-pob-code',
      calculationProfiles: [{ id: 'boss', name: 'Boss', values: { boss: 'Pinnacle', conditionRage: 44 } }],
      activeCalculationProfileId: 'boss',
      allocatedNodes: new Set(['node-1']),
    })

    const exported = JSON.parse(useTreeStore.getState().exportBuildJSON())
    expect(exported.importedBuildCode).toBe('original-pob-code')
    expect(exported.calculationProfiles).toEqual([
      { id: 'boss', name: 'Boss', values: { boss: 'Pinnacle', conditionRage: 44 } },
    ])
    expect(exported.activeCalculationProfileId).toBe('boss')
  })

})

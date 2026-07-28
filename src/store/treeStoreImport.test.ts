import { beforeEach, describe, expect, it } from 'vitest'
import { useTreeStore } from '@/store/treeStore'
import type { CalcResult } from '@/types/calc'
import type { TreeData } from '@/types/tree'

const treeData = {
  version: { version: '0_5', display: '0_5', num: 5 },
  constants: {
    classes: {
      '6': {
        integerId: 7,
        name: 'Sorceress',
        displayName: 'Sorceress',
        startNodeId: 'sorceress-root',
        ascendancies: [{ id: 'Stormweaver', name: 'Stormweaver', internalId: 'Sorceress1' }],
      },
      '7': {
        integerId: 10,
        name: 'Monk',
        displayName: 'Monk',
        startNodeId: 'monk-root',
        ascendancies: [{ id: 'Martial Artist', name: 'Martial Artist', internalId: 'Monk1' }],
      },
    },
    min_x: -100,
    max_x: 100,
    min_y: -80,
    max_y: 80,
  },
  nodes: {
    'sorceress-root': { id: 'sorceress-root', type: 'ClassStart', out: ['imported-node'], in: [] },
    'monk-root': { id: 'monk-root', type: 'ClassStart', out: ['old-node'], in: [] },
    'imported-node': { id: 'imported-node', type: 'Normal', out: [], in: ['sorceress-root'] },
    'old-node': { id: 'old-node', type: 'Normal', out: [], in: ['monk-root'] },
  },
} as unknown as TreeData

describe('tree store build import isolation', () => {
  beforeEach(() => {
    useTreeStore.setState({
      treeData,
      treeVersion: '0_5',
      selectedClassId: '7',
      selectedAscendancyId: 'Martial Artist',
      allocatedNodes: new Set(['old-node']),
      availableNodes: new Set(),
      treeEditMode: true,
      weaponSetMode: 2,
      activeWeaponSet: 2,
      nodeWeaponSets: { 'old-node': 2 },
      nodeAttributeSelections: {},
      masterySelections: { 'old-node': 'old-effect' },
      pendingMasteryNode: 'old-node',
      hoveredNodeId: 'old-node',
      selectedNodeId: 'old-node',
      searchQuery: 'old search',
      searchMatchIds: ['old-node'],
      searchMatchCount: 1,
      calcResult: { Str: 999 } as unknown as CalcResult,
      calcLoading: false,
      calcError: 'old error',
      calculationProfiles: [{ id: 'boss', name: 'Boss', values: { conditionRage: 44 } }],
      activeCalculationProfileId: 'boss',
    })
  })

  it('replaces the current build state entirely with the imported build', async () => {
    await useTreeStore.getState().importAllocatedNodes(['sorceress-root', 'imported-node'], {}, {
      treeVersion: '0_5',
      classInternalId: '7',
      ascendancyInternalId: 'Sorceress1',
      importedBuildCode: 'new-code',
    })

    const state = useTreeStore.getState()
    expect(state.selectedClassId).toBe('6')
    expect(state.selectedAscendancyId).toBe('Stormweaver')
    expect([...state.allocatedNodes]).toEqual(['imported-node'])
    expect(state.importedBuildCode).toBe('new-code')
    expect(state.treeEditMode).toBe(false)
    expect(state.weaponSetMode).toBe(0)
    expect(state.activeWeaponSet).toBe(1)
    expect(state.masterySelections).toEqual({})
    expect(state.pendingMasteryNode).toBeNull()
    expect(state.hoveredNodeId).toBeNull()
    expect(state.selectedNodeId).toBeNull()
    expect(state.searchQuery).toBe('')
    expect(state.calcResult).toBeNull()
    expect(state.calcError).toBeNull()
    expect(state.calculationProfiles).toEqual([{ id: 'default', name: 'Default', values: {} }])
    expect(state.activeCalculationProfileId).toBe('default')
  })

  it('rejects an import with no resolvable class instead of using the current class', async () => {
    await expect(useTreeStore.getState().importAllocatedNodes(['imported-node'], {}, {
      treeVersion: '0_5',
      classInternalId: '999',
    })).rejects.toThrow('class could not be resolved')
    expect(useTreeStore.getState().selectedClassId).toBe('7')
  })
})

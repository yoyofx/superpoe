import { beforeEach, describe, expect, it } from 'vitest'
import { deflate } from 'pako'
import { useTreeStore } from '@/store/treeStore'
import type { CalcResult } from '@/types/calc'
import type { TreeData } from '@/types/tree'

function encodeXml(xml: string): string {
  return Buffer.from(deflate(new TextEncoder().encode(xml))).toString('base64url')
}

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
      '3': {
        integerId: 9,
        name: 'Mercenary',
        displayName: 'Mercenary',
        startNodeId: 'mercenary-root',
        ascendancies: [
          { id: 'Tactician', name: 'Tactician', internalId: 'Mercenary1' },
          { id: 'Witchhunter', name: 'Witchhunter', internalId: 'Mercenary2' },
          { id: 'Gemling Legionnaire', name: 'Gemling Legionnaire', internalId: 'Mercenary3' },
        ],
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

  it('writes resolved class attributes back to Codes that only contain internal ids', async () => {
    const code = encodeXml(`<PathOfBuilding2>
      <Build level="90"/>
      <Tree activeSpec="1"><Spec treeVersion="0_5" classInternalId="9" ascendancyInternalId="Mercenary3" nodes="imported-node">
        <WeaponSet1 nodes="imported-node"/>
      </Spec></Tree>
    </PathOfBuilding2>`)

    await useTreeStore.getState().importAllocatedNodes(['imported-node'], { 'imported-node': 1 }, {
      treeVersion: '0_5',
      classInternalId: '9',
      ascendancyInternalId: 'Mercenary3',
      importedBuildCode: code,
    })

    const xml = useTreeStore.getState().getActivePobXml()
    expect(xml).toContain('classId="3"')
    expect(xml).toContain('ascendClassId="3"')
    expect(xml).toContain('classInternalId="9"')
    expect(xml).toContain('ascendancyInternalId="Mercenary3"')
    expect(xml).toContain('nodes="imported-node"')
    expect(xml).toContain('<WeaponSet1 nodes="imported-node"></WeaponSet1>')
  })

  it('rejects an import with no resolvable class instead of using the current class', async () => {
    await expect(useTreeStore.getState().importAllocatedNodes(['imported-node'], {}, {
      treeVersion: '0_5',
      classInternalId: '999',
    })).rejects.toThrow('class could not be resolved')
    expect(useTreeStore.getState().selectedClassId).toBe('7')
  })

  it('migrates a saved weapon-set selection into the loaded PoB object', async () => {
    const code = encodeXml(`<PathOfBuilding2>
      <Build level="90"/>
      <Items activeItemSet="1" useSecondWeaponSet="false">
        <ItemSet id="1" useSecondWeaponSet="false"/>
        <ItemSet id="2" useSecondWeaponSet="false"/>
      </Items>
      <Tree activeSpec="1"><Spec treeVersion="0_5" classId="6" classInternalId="7" ascendClassId="1" ascendancyInternalId="Sorceress1" nodes="imported-node"/></Tree>
    </PathOfBuilding2>`)
    const build = {
      id: 'legacy-weapon-set-build',
      name: 'Legacy weapon set build',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      treeVersion: '0_5',
      selectedClassId: '6',
      selectedAscendancyId: 'Stormweaver',
      importedBuildCode: code,
      realm: 'global' as const,
      weaponSetMode: 0 as const,
      activeWeaponSet: 2 as const,
      nodeWeaponSets: {},
      nodeAttributeSelections: {},
      masterySelections: {},
      allocatedNodes: ['imported-node'],
    }
    useTreeStore.setState({ savedBuilds: [build] })

    await useTreeStore.getState().loadBuild(build.id)

    const state = useTreeStore.getState()
    expect(state.activeWeaponSet).toBe(2)
    expect(state.getActivePobXml()).toContain('<Items activeItemSet="1" useSecondWeaponSet="true">')
    expect(state.getActivePobXml()).toContain('<ItemSet id="1" useSecondWeaponSet="true"></ItemSet>')
    expect(state.pobBuildRevision).toBeGreaterThan(0)
  })
})

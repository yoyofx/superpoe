import { beforeEach, describe, expect, it, vi } from 'vitest'
import { deflate } from 'pako'
import type { CalcApiResponse, CalcResult } from '@/types/calc'
import type { TreeData } from '@/types/tree'

const luaMocks = vi.hoisted(() => ({
  calculateBuild: vi.fn(),
  rankSkillsByEffectiveDps: vi.fn(),
}))

vi.mock('@/engine/pobLuaClient', () => luaMocks)

import { useTreeStore } from '@/store/treeStore'

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
        startNodeId: 'root',
        ascendancies: [{ id: 'Stormweaver', name: 'Stormweaver', internalId: 'Sorceress1' }],
      },
    },
    min_x: -100,
    max_x: 100,
    min_y: -100,
    max_y: 100,
  },
  nodes: {
    root: { id: 'root', type: 'ClassStart', out: ['allocated'], in: [] },
    allocated: { id: 'allocated', type: 'Normal', out: [], in: ['root'] },
  },
} as unknown as TreeData

describe('tree store calculation lifecycle', () => {
  beforeEach(async () => {
    luaMocks.calculateBuild.mockReset()
    useTreeStore.setState({
      treeData,
      treeVersion: '0_5',
      selectedClassId: '6',
      selectedAscendancyId: 'Stormweaver',
      allocatedNodes: new Set(['allocated']),
      activeWeaponSet: 1,
      calcResult: null,
      calcLoading: false,
      calcError: null,
      calculationProfiles: [{ id: 'default', name: 'Default', values: {} }],
      activeCalculationProfileId: 'default',
    })
    const code = encodeXml('<PathOfBuilding2><Build level="90"/><Tree activeSpec="1"><Spec treeVersion="0_5" classId="6" classInternalId="7" ascendClassId="1" ascendancyInternalId="Sorceress1" nodes="allocated"/></Tree></PathOfBuilding2>')
    await useTreeStore.getState().importAllocatedNodes(['allocated'], {}, {
      treeVersion: '0_5',
      classInternalId: '7',
      ascendancyInternalId: 'Sorceress1',
      importedBuildCode: code,
    })
  })

  it('releases loading when a completed result becomes stale', async () => {
    let finishCalculation!: (result: CalcApiResponse) => void
    luaMocks.calculateBuild.mockReturnValue(new Promise<CalcApiResponse>((resolve) => {
      finishCalculation = resolve
    }))

    const calculation = useTreeStore.getState().runCalculation({ weaponSet: 1 })
    expect(useTreeStore.getState().calcLoading).toBe(true)

    useTreeStore.setState({ pobBuildRevision: useTreeStore.getState().pobBuildRevision + 1 })
    finishCalculation({ success: true, data: { CharacterLevel: 90 } as CalcResult })
    await calculation

    expect(useTreeStore.getState().calcResult).toBeNull()
    expect(useTreeStore.getState().calcLoading).toBe(false)
  })
})

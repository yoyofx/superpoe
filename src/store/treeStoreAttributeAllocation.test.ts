import { beforeEach, describe, expect, it } from 'vitest'
import { useTreeStore } from '@/store/treeStore'
import type { TreeData } from '@/types/tree'

const attributeTree = {
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
    min_x: -10,
    max_x: 10,
    min_y: -10,
    max_y: 10,
  },
  nodes: {
    root: { id: 'root', name: 'Root', type: 'ClassStart', out: ['a'], in: [], stats: [], x: 0, y: 0 },
    a: { id: 'a', name: 'Attribute A', type: 'Normal', isAttribute: true, out: ['b'], in: ['root'], stats: [], x: 1, y: 0, options: { 1: { name: 'Strength' }, 2: { name: 'Dexterity' }, 3: { name: 'Intelligence' } } },
    b: { id: 'b', name: 'Attribute B', type: 'Normal', isAttribute: true, out: ['target'], in: ['a'], stats: [], x: 1, y: 1, options: { 1: { name: 'Strength' }, 2: { name: 'Dexterity' }, 3: { name: 'Intelligence' } } },
    target: { id: 'target', name: 'Target', type: 'Normal', out: [], in: ['b'], stats: [], x: 2, y: 0 },
  },
} as unknown as TreeData

describe('tree store attribute allocation', () => {
  beforeEach(() => {
    useTreeStore.setState({
      treeData: attributeTree,
      treeVersion: '0_5',
      selectedClassId: '6',
      selectedAscendancyId: 'Stormweaver',
      allocatedNodes: new Set(),
      availableNodes: new Set(),
      nodeWeaponSets: {},
      nodeAttributeSelections: {},
      treeEditMode: true,
      weaponSetMode: 0,
      undoStack: [],
      redoStack: [],
    })
  })

  it('applies one selected attribute to every new attribute node on the path', () => {
    useTreeStore.getState().allocateNodeWithAttribute('target', 3)
    const state = useTreeStore.getState()

    expect(state.allocatedNodes).toEqual(new Set(['a', 'b', 'target']))
    expect(state.nodeAttributeSelections).toEqual({ a: 3, b: 3 })
  })
})

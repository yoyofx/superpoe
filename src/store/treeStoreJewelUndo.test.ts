import { beforeEach, describe, expect, it } from 'vitest'
import { deflate } from 'pako'
import { useTreeStore } from '@/store/treeStore'
import type { TreeData } from '@/types/tree'

function encodeXml(xml: string): string {
  return Buffer.from(deflate(new TextEncoder().encode(xml))).toString('base64url')
}

const jewelTree = {
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
    root: { id: 'root', type: 'ClassStart', out: ['socket'], in: [], stats: [], x: 0, y: 0 },
    socket: { id: 'socket', type: 'JewelSocket', isJewelSocket: true, out: [], in: ['root'], stats: [], x: 1, y: 0 },
  },
} as unknown as TreeData

const originalXml = `<?xml version="1.0"?><PathOfBuilding2><Items><Item id="2">Rarity: RARE\nOld Jewel\nCrimson Jewel</Item><ItemSet id="1"/></Items><Tree activeSpec="1"><Spec treeVersion="0_5" classId="6" classInternalId="7" ascendClassId="1" ascendancyInternalId="Sorceress1" nodes="socket"><Sockets><Socket nodeId="socket" itemId="2"/></Sockets></Spec></Tree></PathOfBuilding2>`

describe('tree store jewel undo and redo', () => {
  beforeEach(async () => {
    useTreeStore.setState({
      treeData: jewelTree,
      treeVersion: '0_5',
      undoStack: [],
      redoStack: [],
      allocatedNodes: new Set(),
      availableNodes: new Set(),
      nodeWeaponSets: {},
      nodeAttributeSelections: {},
      masterySelections: {},
      activeWeaponSet: 1,
    })
    await useTreeStore.getState().importAllocatedNodes(['socket'], {}, {
      treeVersion: '0_5',
      classInternalId: '7',
      ascendancyInternalId: 'Sorceress1',
      importedBuildCode: encodeXml(originalXml),
    })
  })

  it('undoes and redoes a jewel replacement including the item and socket reference', () => {
    const store = useTreeStore.getState()
    store.bindTreeJewelRaw('socket', 'Rarity: UNIQUE\nNew Jewel\nCrimson Jewel')

    let xml = useTreeStore.getState().getActivePobXml() || ''
    expect(xml).toContain('<Item id="3">Rarity: UNIQUE\nNew Jewel\nCrimson Jewel</Item>')
    expect(xml).toContain('<Socket nodeId="socket" itemId="3"></Socket>')

    useTreeStore.getState().undo()
    xml = useTreeStore.getState().getActivePobXml() || ''
    expect(xml).toContain('<Item id="2">Rarity: RARE\nOld Jewel\nCrimson Jewel</Item>')
    expect(xml).not.toContain('<Item id="3">')
    expect(xml).toContain('<Socket nodeId="socket" itemId="2"></Socket>')

    useTreeStore.getState().redo()
    xml = useTreeStore.getState().getActivePobXml() || ''
    expect(xml).toContain('<Item id="3">Rarity: UNIQUE\nNew Jewel\nCrimson Jewel</Item>')
    expect(xml).toContain('<Socket nodeId="socket" itemId="3"></Socket>')
  })

  it('undoes and redoes jewel removal', () => {
    useTreeStore.getState().unbindTreeJewel('socket')
    let xml = useTreeStore.getState().getActivePobXml() || ''
    expect(xml).not.toContain('<Socket nodeId="socket"')

    useTreeStore.getState().undo()
    xml = useTreeStore.getState().getActivePobXml() || ''
    expect(xml).toContain('<Socket nodeId="socket" itemId="2"></Socket>')

    useTreeStore.getState().redo()
    xml = useTreeStore.getState().getActivePobXml() || ''
    expect(xml).not.toContain('<Socket nodeId="socket"')
  })
})

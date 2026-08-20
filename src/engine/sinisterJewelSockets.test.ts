import { describe, expect, it } from 'vitest'
import type { TreeData } from '@/types/tree'
import { getSinisterJewelSocketIds, isSinisterJewelSocket } from '@/engine/sinisterJewelSockets'

const treeData = {
  nodes: {
    '62152': { id: '62152', name: 'Sinister Jewel Socket', type: 'JewelSocket', isJewelSocket: true, sinister: true, aliasPassiveSocket: 'voices_jewel_slot1' },
    '26178': { id: '26178', name: 'Sinister Jewel Socket', type: 'JewelSocket', isJewelSocket: true, sinister: true, aliasPassiveSocket: 'voices_jewel_slot2' },
    '39087': { id: '39087', name: 'Sinister Jewel Socket', type: 'JewelSocket', isJewelSocket: true, sinister: true, aliasPassiveSocket: 'voices_jewel_slot4' },
    ordinary: { id: 'ordinary', name: 'Jewel Socket', type: 'JewelSocket', isJewelSocket: true },
  },
} as unknown as TreeData

function buildXml(voicesLine: string): string {
  return `<PathOfBuilding2>
    <Items activeItemSet="1">
      <Item id="17">Rarity: UNIQUE\nVoices\nSapphire\n${voicesLine}</Item>
      <ItemSet id="1"><Slot name="Jewel" itemId="17"/></ItemSet>
    </Items>
    <Tree activeSpec="1"><Spec nodes=""><Sockets/></Spec></Tree>
  </PathOfBuilding2>`
}

describe('sinister jewel sockets', () => {
  it('recognizes PoB dynamic socket metadata', () => {
    expect(isSinisterJewelSocket(treeData.nodes['62152'])).toBe(true)
    expect(isSinisterJewelSocket(treeData.nodes.ordinary)).toBe(false)
  })

  it('resolves the first Voices sockets in PoB alias order', () => {
    expect([...getSinisterJewelSocketIds(treeData, buildXml('Allocates 2 Sinister Jewel sockets'))]).toEqual(['62152', '26178'])
  })

  it('does not grant sockets without a Voices modifier', () => {
    expect(getSinisterJewelSocketIds(treeData, buildXml('Allocates 0 Sinister Jewel sockets'))).toEqual(new Set())
    expect(getSinisterJewelSocketIds(treeData, buildXml('Allocates 3 Jewel sockets'))).toEqual(new Set())
  })
})

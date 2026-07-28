import { describe, expect, it } from 'vitest'
import { deflate } from 'pako'
import { decodeBuildCode, encodeBuildCode, getBuildActiveWeaponSet, getBuildCharacterLevel, setBuildEquipmentSelection, setBuildMainSocketGroup } from '@/engine/buildCode'

function encodeXml(xml: string): string {
  return Buffer.from(deflate(new TextEncoder().encode(xml))).toString('base64url')
}

describe('front-end build code encode/decode', () => {
  it('reads the character level from build metadata', () => {
    const code = encodeXml('<?xml version="1.0"?><PathOfBuilding2><Build level="96"/></PathOfBuilding2>')
    expect(getBuildCharacterLevel(code)).toBe(96)
    expect(getBuildCharacterLevel('invalid-code')).toBeNull()
  })

  it('round-trips simple nodes', () => {
    const nodes = ['61419', '65413', '10131']
    const encoded = encodeBuildCode({ nodes, treeVersion: '0_5' })
    expect(encoded.code).toBeTruthy()
    expect(encoded.xml).toContain('<PathOfBuilding2>')

    const decoded = decodeBuildCode(encoded.code)
    expect(decoded.nodes.sort()).toEqual(nodes.sort())
    expect(decoded.treeVersion).toBe('0_5')
  })

  it('round-trips weapon sets and attribute overrides', () => {
    const nodes = ['722', '10131', '8569']
    const encoded = encodeBuildCode({
      nodes,
      treeVersion: '0_5',
      classId: '3',
      ascendClassId: '1',
      classInternalId: '7',
      ascendancyInternalId: 'Sorceress1',
      nodeWeaponSets: { '722': 1, '8569': 2 },
      nodeAttributeSelections: { '722': 1, '10131': 2, '8569': 3 },
    })

    const decoded = decodeBuildCode(encoded.code)
    expect(decoded.nodes.sort()).toEqual(nodes.sort())
    expect(decoded.nodeWeaponSets).toEqual({ '722': 1, '8569': 2 })
    expect(decoded.nodeAttributeSelections).toEqual({ '722': 1, '10131': 2, '8569': 3 })
    expect(decoded.classId).toBe('3')
    expect(decoded.ascendClassId).toBe('1')
    expect(decoded.classInternalId).toBe('7')
    expect(decoded.ascendancyInternalId).toBe('Sorceress1')
  })

  it('uses only the active passive tree spec', () => {
    const code = encodeXml(`<?xml version="1.0"?><PathOfBuilding2><Tree activeSpec="2">
      <Spec treeVersion="0_5" classId="7" classInternalId="10" ascendClassId="1" ascendancyInternalId="Monk1" nodes="100,101">
        <WeaponSet1 nodes="101"/>
      </Spec>
      <Spec treeVersion="0_5" classId="6" classInternalId="7" ascendClassId="1" ascendancyInternalId="Sorceress1" nodes="200,201">
        <WeaponSet2 nodes="201"/>
        <Overrides><AttributeOverride strNodes="200" dexNodes="" intNodes=""/></Overrides>
      </Spec>
    </Tree></PathOfBuilding2>`)

    const decoded = decodeBuildCode(code)
    expect(decoded.activeSpecIndex).toBe(2)
    expect(decoded.nodes).toEqual(['200', '201'])
    expect(decoded.nodeWeaponSets).toEqual({ '201': 2 })
    expect(decoded.nodeAttributeSelections).toEqual({ '200': 1 })
    expect(decoded.classInternalId).toBe('7')
    expect(decoded.ascendancyInternalId).toBe('Sorceress1')
    expect(decoded.specs).toHaveLength(2)
  })

  it('falls back to the first populated spec when activeSpec is invalid', () => {
    const code = encodeXml(`<?xml version="1.0"?><PathOfBuilding2><Tree activeSpec="99">
      <Spec treeVersion="0_5" classId="7" nodes=""/>
      <Spec treeVersion="0_5" classId="6" classInternalId="7" ascendClassId="1" ascendancyInternalId="Sorceress1" nodes="200,201"/>
    </Tree></PathOfBuilding2>`)

    const decoded = decodeBuildCode(code)
    expect(decoded.activeSpecIndex).toBe(2)
    expect(decoded.nodes).toEqual(['200', '201'])
    expect(decoded.classInternalId).toBe('7')
  })

  it('replaces tree XML in a base code', () => {
    const base = encodeBuildCode({
      nodes: ['1', '2'],
      treeVersion: '0_4',
      className: 'Sorceress',
      ascendancyName: 'Stormweaver',
    })
    const next = encodeBuildCode({
      nodes: ['3', '4', '5'],
      treeVersion: '0_5',
      baseCode: base.code,
    })

    const decoded = decodeBuildCode(next.code)
    expect(decoded.nodes.sort()).toEqual(['3', '4', '5'])
    expect(decoded.treeVersion).toBe('0_5')
    expect(decoded.xml).toContain('className="Sorceress"')
  })

  it('selects an item set and weapon set without changing other equipment XML', () => {
    const xml = `<PathOfBuilding2><Items activeItemSet="1" useSecondWeaponSet="false">
      <Item id="1">Rarity: NORMAL\nTest Item</Item>
      <ItemSet id="1" useSecondWeaponSet="false"><Slot name="Weapon 1" itemId="1"/></ItemSet>
      <ItemSet id="2" title="Swap"><Slot name="Weapon 1 Swap" itemId="1"/></ItemSet>
    </Items></PathOfBuilding2>`

    const selected = setBuildEquipmentSelection(xml, '2', true)

    expect(selected).toContain('<Items activeItemSet="2" useSecondWeaponSet="true">')
    expect(selected).toContain('<ItemSet id="1" useSecondWeaponSet="false">')
    expect(selected).toContain('<ItemSet id="2" title="Swap" useSecondWeaponSet="true">')
    expect(selected).toContain('<Item id="1">Rarity: NORMAL\nTest Item</Item>')
  })

  it('reads the active weapon set from the selected item set', () => {
    const xml = `<PathOfBuilding2><Items activeItemSet="2" useSecondWeaponSet="false">
      <ItemSet id="1" useSecondWeaponSet="false"/>
      <ItemSet id="2" useSecondWeaponSet="true"/>
    </Items></PathOfBuilding2>`

    expect(getBuildActiveWeaponSet(encodeXml(xml))).toBe(2)
    expect(getBuildActiveWeaponSet('invalid')).toBe(1)
  })

  it('falls back to the weapon set selected on Items', () => {
    const xml = '<PathOfBuilding2><Items useSecondWeaponSet="true"/></PathOfBuilding2>'

    expect(getBuildActiveWeaponSet(encodeXml(xml))).toBe(2)
  })

  it('selects the main socket group used for calculation', () => {
    const xml = '<PathOfBuilding2><Build level="90" mainSocketGroup="1"/></PathOfBuilding2>'

    expect(setBuildMainSocketGroup(xml, '4')).toContain('<Build level="90" mainSocketGroup="4"/>')
    expect(setBuildMainSocketGroup(xml, 'invalid')).toBe(xml)
  })

  it('encodes the selected item set and weapon set into the build code', () => {
    const baseXml = `<PathOfBuilding2><Items><ItemSet id="1" useSecondWeaponSet="false"/></Items>
      <Tree activeSpec="1"><Spec treeVersion="0_5" classId="3" ascendClassId="3" nodes="1"/></Tree></PathOfBuilding2>`
    const encoded = encodeBuildCode({
      nodes: ['1'],
      treeVersion: '0_5',
      baseCode: encodeXml(baseXml),
      activeItemSetId: '1',
      useSecondWeaponSet: true,
    })

    expect(encoded.xml).toContain('<Items activeItemSet="1" useSecondWeaponSet="true">')
    expect(encoded.xml).toContain('<ItemSet id="1" useSecondWeaponSet="true"/>')
    expect(decodeBuildCode(encoded.code).xml).toBe(encoded.xml)
  })

  it('round-trips passive tree jewels', () => {
    const encoded = encodeBuildCode({
      nodes: ['32763', '21984'],
      treeVersion: '0_5',
      nodeJewels: {
        '32763': {
          itemId: '22',
          name: 'Entropy Stone',
          baseType: 'Emerald',
          rarity: 'RARE',
          lines: ['6% increased Attack Speed'],
        },
      },
    })

    expect(encoded.xml).toContain('<Socket nodeId="32763" itemId="22"/>')
    expect(decodeBuildCode(encoded.code).nodeJewels).toEqual({
      '32763': {
        itemId: '22',
        name: 'Unknown Jewel',
        baseType: '',
        rarity: 'NORMAL',
        lines: [],
      },
    })
  })

  it('keeps passive jewel socket mappings when replacing an imported tree', () => {
    const base = encodeBuildCode({
      nodes: ['32763'],
      treeVersion: '0_5',
      nodeJewels: {
        '32763': { itemId: '22', name: 'Entropy Stone', baseType: 'Emerald', rarity: 'RARE', lines: [] },
      },
    })
    const updated = encodeBuildCode({
      nodes: ['32763', '21984'],
      treeVersion: '0_5',
      baseCode: base.code,
    })

    expect(decodeBuildCode(updated.code).nodeJewels['32763']?.itemId).toBe('22')
  })
})

import { describe, expect, it } from 'vitest'
import { decodeBuildCode, encodeBuildCode } from '@/engine/buildCode'

describe('front-end build code encode/decode', () => {
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
})

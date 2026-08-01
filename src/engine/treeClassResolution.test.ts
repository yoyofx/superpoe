import { describe, expect, it } from 'vitest'
import { resolveTreeAscendancy, resolveTreeClass } from '@/engine/treeClassResolution'
import type { TreeData } from '@/types/tree'

const treeData = {
  constants: {
    classes: {
      '6': {
        integerId: 7,
        name: 'Sorceress',
        displayName: 'Sorceress',
        ascendancies: [
          { id: 'Stormweaver', name: 'Stormweaver', internalId: 'Sorceress1' },
          { id: 'Chronomancer', name: 'Chronomancer', internalId: 'Sorceress2' },
        ],
      },
      '7': {
        integerId: 10,
        name: 'Monk',
        displayName: 'Monk',
        ascendancies: [{ id: 'Martial Artist', name: 'Martial Artist', internalId: 'Monk1' }],
      },
    },
  },
} as unknown as TreeData

describe('tree class resolution', () => {
  it('does not confuse a PoB internal id with a tree-data object key', () => {
    const resolved = resolveTreeClass(treeData, { classInternalId: '7' })
    expect(resolved?.[0]).toBe('6')
    expect(resolved?.[1].name).toBe('Sorceress')
  })

  it('resolves the ascendancy from its PoB internal id', () => {
    const resolved = resolveTreeClass(treeData, { classInternalId: '7' })
    expect(resolveTreeAscendancy(resolved?.[1], { ascendancyInternalId: 'Sorceress1' })).toBe('Stormweaver')
  })

  it('still accepts an explicit tree-data key', () => {
    expect(resolveTreeClass(treeData, { classId: '7' })?.[1].name).toBe('Monk')
  })

  it('accepts a legacy one-based ascendancy index', () => {
    const resolved = resolveTreeClass(treeData, { classId: '6' })
    expect(resolveTreeAscendancy(resolved?.[1], { ascendClassId: '2' })).toBe('Chronomancer')
  })

  it('does not invent an ascendancy for an unascended build', () => {
    const resolved = resolveTreeClass(treeData, { classInternalId: '7' })
    expect(resolveTreeAscendancy(resolved?.[1], {})).toBe('')
    expect(resolveTreeAscendancy(resolved?.[1], { ascendClassId: '0' })).toBe('')
    expect(resolveTreeAscendancy(resolved?.[1], { ascendClassId: 'nil' })).toBe('')
  })

  it('does not silently select the first ascendancy for an unknown id', () => {
    const resolved = resolveTreeClass(treeData, { classInternalId: '7' })
    expect(resolveTreeAscendancy(resolved?.[1], { ascendancyInternalId: 'Unknown1' })).toBe('')
  })
})

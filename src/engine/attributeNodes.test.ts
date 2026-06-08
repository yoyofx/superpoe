import { describe, expect, it } from 'vitest'
import type { TreeNode } from '@/types/tree'
import {
  cleanAttributeSelections,
  getAttributeNodeDisplay,
  nextAttributeSelection,
} from './attributeNodes'

function attributeNode(): TreeNode {
  return {
    id: 'a',
    name: 'Attribute',
    icon: 'base.webp',
    stats: ['base'],
    type: 'Normal',
    group: 'g',
    orbit: 0,
    orbitIndex: 0,
    x: 0,
    y: 0,
    out: [],
    in: [],
    isAttribute: true,
    options: {
      1: { name: 'Strength', icon: 'str.webp', stats: ['+5 to Strength'] },
      2: { name: 'Dexterity', icon: 'dex.webp', stats: ['+5 to Dexterity'] },
      3: { name: 'Intelligence', icon: 'int.webp', stats: ['+5 to Intelligence'] },
    },
  }
}

describe('attributeNodes', () => {
  it('cycles editable attribute selections in strength, dexterity, intelligence order', () => {
    expect(nextAttributeSelection()).toBe(1)
    expect(nextAttributeSelection(1)).toBe(2)
    expect(nextAttributeSelection(2)).toBe(3)
    expect(nextAttributeSelection(3)).toBe(1)
  })

  it('uses the selected imported or edited attribute display data', () => {
    const node = attributeNode()
    expect(getAttributeNodeDisplay(node, 2)).toEqual({
      name: 'Dexterity',
      icon: 'dex.webp',
      stats: ['+5 to Dexterity'],
    })
  })

  it('keeps only allocated attribute node selections', () => {
    const nodes = {
      a: attributeNode(),
      normal: { ...attributeNode(), id: 'normal', isAttribute: false },
    }

    expect(cleanAttributeSelections(nodes, new Set(['a', 'normal']), { a: 3, normal: 1 })).toEqual({ a: 3 })
    expect(cleanAttributeSelections(nodes, new Set(), { a: 3 })).toEqual({})
  })
})

import { describe, expect, it } from 'vitest'
import type { TreeData, TreeNode } from '@/types/tree'
import {
  allocateNode,
  deallocateNode,
  getNodeAllocMode,
  getPreviewPath,
  isConnectorActiveForModes,
} from './passiveAllocation'

function node(id: string, out: string[], extra: Partial<TreeNode> = {}): TreeNode {
  return {
    id,
    name: id,
    icon: '',
    stats: [],
    type: 'Normal',
    group: 'g',
    orbit: 0,
    orbitIndex: 0,
    x: 0,
    y: 0,
    out,
    in: [],
    ...extra,
  }
}

function wire(nodes: Record<string, TreeNode>) {
  for (const n of Object.values(nodes)) n.in = []
  for (const n of Object.values(nodes)) {
    for (const out of n.out) nodes[out]?.in.push(n.id)
  }
}

function tree(nodes: Record<string, TreeNode>): TreeData {
  wire(nodes)
  return {
    version: { version: '0_4', display: '0_4', num: 4 },
    constants: {
      skillsPerOrbit: [],
      orbitRadii: [],
      classes: {
        '6': {
          name: 'Sorceress',
          displayName: 'Sorceress',
          integerId: 7,
          startNodeId: 'root',
          ascendancies: [{ id: 'Stormweaver', name: 'Stormweaver' }],
        },
      },
      min_x: 0,
      max_x: 0,
      min_y: 0,
      max_y: 0,
    },
    groups: {},
    nodes,
  }
}

const ctx = (data: TreeData) => ({ treeData: data, selectedClassId: '6', selectedAscendancyId: 'Stormweaver' })

describe('passiveAllocation', () => {
  it('auto-allocates the path from the implicit class root', () => {
    const data = tree({ root: node('root', ['a'], { type: 'ClassStart' }), a: node('a', ['b']), b: node('b', []) })
    const result = allocateNode(ctx(data), new Set(), {}, 'b', 0)
    expect([...result.allocatedNodes].sort()).toEqual(['a', 'b'])
    expect(result.availableNodes.size).toBeGreaterThan(0)
  })

  it('deallocates dependents that no longer reach a root', () => {
    const data = tree({ root: node('root', ['a'], { type: 'ClassStart' }), a: node('a', ['b']), b: node('b', []) })
    const result = deallocateNode(ctx(data), new Set(['a', 'b']), {}, 'a')
    expect([...result.allocatedNodes]).toEqual([])
  })

  it('stores weapon set modes only for ordinary nodes', () => {
    const data = tree({
      root: node('root', ['a'], { type: 'ClassStart' }),
      a: node('a', ['k']),
      k: node('k', [], { type: 'Keystone' }),
    })
    const result = allocateNode(ctx(data), new Set(), {}, 'k', 1)
    expect(getNodeAllocMode('a', result.nodeWeaponSets)).toBe(1)
    expect(getNodeAllocMode('k', result.nodeWeaponSets)).toBe(0)
  })

  it('promotes a weapon branch back to normal when allocating through it in normal mode', () => {
    const data = tree({
      root: node('root', ['a'], { type: 'ClassStart' }),
      a: node('a', ['b']),
      b: node('b', ['c']),
      c: node('c', []),
    })
    const result = allocateNode(ctx(data), new Set(['a', 'b']), { a: 1, b: 1 }, 'c', 0)
    expect([...result.allocatedNodes].sort()).toEqual(['a', 'b', 'c'])
    expect(result.nodeWeaponSets).toEqual({})
  })

  it('previews the full path before click', () => {
    const data = tree({ root: node('root', ['a'], { type: 'ClassStart' }), a: node('a', ['b']), b: node('b', []) })
    expect([...getPreviewPath(ctx(data), new Set(), {}, 'b', 0)].sort()).toEqual(['a', 'b'])
  })

  it('does not activate connectors between different weapon sets', () => {
    const data = tree({ root: node('root', ['a'], { type: 'ClassStart' }), a: node('a', ['b']), b: node('b', []) })
    const roots = new Set(['root'])
    expect(isConnectorActiveForModes('a', 'b', new Set(['a', 'b']), roots, { a: 1, b: 2 })).toBe(false)
    expect(isConnectorActiveForModes('a', 'b', new Set(['a', 'b']), roots, { a: 1 })).toBe(true)
    expect(data.nodes.root.type).toBe('ClassStart')
  })
})

import { describe, expect, it } from 'vitest'
import { parseTreeDataResource } from '@/engine/treeDataResource'

describe('parseTreeDataResource', () => {
  it('rejects malformed core tree data with a useful error', () => {
    expect(() => parseTreeDataResource({}, '0_5')).toThrow('missing required fields')
    expect(() => parseTreeDataResource(null, '0_5')).toThrow('is invalid')
  })

  it('accepts a minimally valid tree resource', () => {
    const tree = { version: {}, constants: { classes: {} }, nodes: {}, groups: {} }
    expect(parseTreeDataResource(tree, '0_5')).toBe(tree)
  })
})

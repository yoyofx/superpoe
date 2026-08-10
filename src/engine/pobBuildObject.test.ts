import { describe, expect, it } from 'vitest'
import { deflate } from 'pako'
import { decodeCodeToXml } from '@/engine/buildCode'
import { PobBuildObject } from '@/engine/pobBuildObject'
import { createActiveBuildSession } from '@/engine/pobBuildSession'

function encodeXml(xml: string): string {
  return Buffer.from(deflate(new TextEncoder().encode(xml))).toString('base64url')
}

const sourceXml = '<?xml version="1.0" encoding="UTF-8"?><PathOfBuilding2><Build level="90"/><Unknown custom="keep"><Nested>value &amp; more</Nested></Unknown><!--keep this--></PathOfBuilding2>'

function buildPath(object: PobBuildObject, elementName: string): number[] {
  const index = object.root.children.findIndex((node) => node.kind === 'element' && node.elem === elementName)
  if (index < 0) throw new Error(`Missing ${elementName} test node`)
  return [index]
}

describe('PobBuildObject', () => {
  it('keeps the original XML until an edit is applied', () => {
    const object = PobBuildObject.fromXml(sourceXml)

    expect(object.toXml()).toBe(sourceXml)
    expect(object.revision).toBe(0)
    expect(object.dirty).toBe(false)
  })

  it('edits an XML node without dropping unknown nodes or comments', () => {
    const object = PobBuildObject.fromXml(sourceXml)
    const change = object.apply({
      type: 'set-attribute',
      path: buildPath(object, 'Build'),
      name: 'level',
      value: '91',
      section: 'build',
    })

    expect(change).toEqual({ changed: true, revision: 1, sections: ['build'] })
    expect(object.toXml()).toContain('<?xml version="1.0" encoding="UTF-8"?>')
    expect(object.toXml()).toContain('<Build level="91"></Build>')
    expect(object.toXml()).toContain('<Unknown custom="keep"><Nested>value &amp; more</Nested></Unknown>')
    expect(object.toXml()).toContain('<!--keep this-->')
  })

  it('round-trips Code through the object without changing untouched XML', () => {
    const code = encodeXml(sourceXml)
    const object = PobBuildObject.fromCode(code)

    expect(decodeCodeToXml(object.toCode())).toBe(sourceXml)
    expect(object.snapshot().contentHash).toMatch(/^fnv1a:/)
  })

  it('forks an independent object', () => {
    const object = PobBuildObject.fromXml(sourceXml)
    const fork = object.fork()

    fork.apply({ type: 'set-attribute', path: buildPath(fork, 'Build'), name: 'level', value: '92' })

    expect(object.toXml()).toBe(sourceXml)
    expect(fork.toXml()).toContain('<Build level="92"></Build>')
  })

  it('rejects use after dispose', () => {
    const object = PobBuildObject.fromXml(sourceXml)
    object.dispose()

    expect(() => object.toXml()).toThrow('PobBuildObject has been disposed')
  })
})

describe('ActiveBuildSession', () => {
  it('owns one object and releases it as a unit', () => {
    const session = createActiveBuildSession('build-1', encodeXml(sourceXml))

    expect(session.buildId).toBe('build-1')
    expect(session.revision).toBe(0)
    session.apply({ type: 'set-attribute', path: buildPath(session.object, 'Build'), name: 'level', value: '91' })
    expect(session.dirty).toBe(true)

    session.dispose()
    expect(() => session.revision).toThrow('ActiveBuildSession has been disposed')
    expect(() => session.object.toXml()).toThrow('PobBuildObject has been disposed')
  })
})

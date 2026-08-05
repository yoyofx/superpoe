import { describe, expect, it } from 'vitest'
import { encodeBuildCode } from '@/engine/buildCode'
import {
  createSuperPoeBuildFile,
  parseSuperPoeBuildFile,
  sanitizeSuperPoeBuildFileName,
} from '@/engine/superPoeBuildFile'

function buildFixture() {
  const encoded = encodeBuildCode({
    nodes: ['100', '200'],
    treeVersion: '0_5',
    classId: '6',
    ascendClassId: '1',
  })
  return {
    id: '70d86bc7-05f8-4f22-8aa2-e290ded40713',
    name: 'Stormweaver',
    tags: ['starter'],
    realm: 'global' as const,
    source: 'wegame' as const,
    sourceUrl: 'https://www.wegame.com.cn/helper/poe2/#/share/example',
    createdAt: '2026-08-01T08:00:00.000Z',
    updatedAt: '2026-08-03T10:30:00.000Z',
    code: encoded.code,
    xml: encoded.xml,
    revision: 3,
    appVersion: '0.5.1',
    channel: 'release' as const,
    platform: 'win32' as const,
  }
}

describe('SuperPoE native build files', () => {
  it('round-trips a self-contained build envelope', async () => {
    const content = await createSuperPoeBuildFile(buildFixture())
    const parsed = await parseSuperPoeBuildFile(content)

    expect(parsed.envelope.format).toBe('superpoe-build')
    expect(parsed.envelope.schemaVersion).toBe(1)
    expect(parsed.envelope.revision).toBe(3)
    expect(parsed.envelope.data.metadata.source).toBe('wegame')
    expect(parsed.envelope.data.metadata.sourceUrl).toContain('wegame.com.cn')
    expect(parsed.envelope.data.pob.contentHash).toMatch(/^sha256:[a-f0-9]{64}$/)
    expect(parsed.treeVersion).toBe('0_5')
    expect(parsed.nodeCount).toBe(2)
  })

  it('rejects a modified payload', async () => {
    const envelope = JSON.parse(await createSuperPoeBuildFile(buildFixture()))
    envelope.data.metadata.name = 'Tampered'
    await expect(parseSuperPoeBuildFile(JSON.stringify(envelope))).rejects.toThrow('payload hash')
  })

  it('rejects the legacy JSON import shape', async () => {
    await expect(parseSuperPoeBuildFile(JSON.stringify({ allocatedNodes: ['100'] }))).rejects.toThrow('not a SuperPoE build')
  })

  it('supports a new build with an empty passive tree', async () => {
    const fixture = buildFixture()
    const empty = encodeBuildCode({ nodes: [], treeVersion: '0_5', classId: '6', ascendClassId: '0' })
    const parsed = await parseSuperPoeBuildFile(await createSuperPoeBuildFile({ ...fixture, code: empty.code, xml: empty.xml }))
    expect(parsed.nodeCount).toBe(0)
    expect(parsed.treeVersion).toBe('0_5')
  })

  it('normalizes the legacy json source to local when creating a new file', async () => {
    const parsed = await parseSuperPoeBuildFile(await createSuperPoeBuildFile({ ...buildFixture(), source: 'json' }))
    expect(parsed.envelope.data.metadata.source).toBe('local')
  })

  it('normalizes a portable file name', () => {
    expect(sanitizeSuperPoeBuildFileName('Ice: Build?')).toBe('Ice Build.spoe')
  })
})

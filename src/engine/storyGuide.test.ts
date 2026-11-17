import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { StoryChapter } from '@/types/storyGuide'
import { createStoryNode, deleteStoryNode, findStoryArea, parseStoryChapter, serializeStoryChapter, setStoryFlow, validateStoryChapter } from './storyGuide'
import { normalizeStoryAsset } from './storyGuideAssets'

const fixture = (): StoryChapter => ({
  id: 'act_test', title: '测试章节', maps: [{ id: 'map_a', title: '地图', image: '/maps/test.png' }],
  flowOrder: ['node_1', 'node_2', 'node_3'],
  nodes: [
    { id: 'node_1', mapId: 'map_a', title: '起点', description: '', x: 10, y: 20, areaId: 'G1_1', next: 'node_2' },
    { id: 'node_2', mapId: 'map_a', title: '中段', description: '', x: 40, y: 50, areaId: 'G1_2', next: 'node_3' },
    { id: 'node_3', mapId: 'map_a', title: '终点', description: '', x: 80, y: 90, areaId: 'G1_3', next: null },
    { id: 'node_4', mapId: 'map_a', title: '支线', description: '', x: 30, y: 70, areaId: 'G1_Side', next: 'node_2' },
  ],
})

describe('story chapter import and export', () => {
  it.each([
    { names: { international: 'Area' } },
    { images: [{ url: 42 }] },
    { steps: [{ title: 'Step', body: [] }] },
    { badge: { text: {} } },
    { next: undefined },
  ])('rejects malformed nested node content: %j', patch => {
    const input = fixture()
    Object.assign(input.nodes[0], patch)
    expect(() => parseStoryChapter(input)).toThrow()
  })

  it('rejects malformed quest steps before rendering', () => {
    expect(() => parseStoryChapter({ ...fixture(), seasonQuests: [{ id: 'q', title: '任务', overview: '', steps: [null] }] })).toThrow()
  })

  it('roundtrips BOM input, local media, and unknown metadata without sharing references', () => {
    const input = { ...fixture(), futureSetting: { enabled: true } }
    Object.assign(input.nodes[0], { extra: { source: 'manual' }, steps: [{ title: '路线', image: '/media/step.png' }] })
    const parsed = parseStoryChapter('\uFEFF' + JSON.stringify(input))
    expect(JSON.parse(serializeStoryChapter(parsed))).toEqual(input)
    const cloned = parseStoryChapter(input)
    cloned.nodes[0].title = 'changed'
    expect(input.nodes[0].title).toBe('起点')
  })

  it.each([
    { x: Number.NaN }, { x: 101 }, { mapId: 'missing' },
    { next: 'missing' }, { next: 'node_1' }, { coverImage: '../private.png' },
    { areaId: 'not a real id' },
  ])('refuses semantically invalid exports: %j', patch => {
    const input = fixture()
    Object.assign(input.nodes[0], patch)
    expect(() => serializeStoryChapter(input)).toThrow()
  })

  it('allows drafts without area IDs but reports the missing log binding', () => {
    const input = fixture()
    delete input.nodes[0].areaId
    expect(validateStoryChapter(input)).toContainEqual(expect.objectContaining({ level: 'warning', nodeId: 'node_1' }))
    expect(() => serializeStoryChapter(input)).not.toThrow()
  })

  it('rejects inconsistent mainline and unsafe quest images', () => {
    const input = fixture()
    input.flowOrder.reverse()
    expect(() => serializeStoryChapter(input)).toThrow(/next/)
    const questInput = { ...fixture(), seasonQuests: [{ id: 'q', title: '任务', overview: '', steps: [{ title: '步骤', image: 'https://example.com/a.png' }] }] }
    expect(() => serializeStoryChapter(questInput)).toThrow(/图片/)
  })
})

describe('story route editing and game area matching', () => {
  it('reorders mainline links while retaining branch destinations and source state', () => {
    const input = fixture()
    const edited = setStoryFlow(input, ['node_3', 'node_1', 'node_2'])
    expect(edited.nodes.map(node => node.next)).toEqual(['node_2', null, 'node_1', 'node_2'])
    expect(input.nodes[2].next).toBeNull()
    expect(validateStoryChapter(edited).filter(issue => issue.level === 'error')).toEqual([])
  })

  it('repairs both mainline and incoming branch links when a node is removed', () => {
    const edited = deleteStoryNode(fixture(), 'node_2')
    expect(edited.flowOrder).toEqual(['node_1', 'node_3'])
    expect(edited.nodes.find(node => node.id === 'node_1')?.next).toBe('node_3')
    expect(edited.nodes.find(node => node.id === 'node_4')?.next).toBe('node_3')
    expect(validateStoryChapter(edited).filter(issue => issue.level === 'error')).toEqual([])
  })

  it('does not create a self cycle when deleting one half of a branch loop', () => {
    const input = fixture()
    input.nodes.push({ ...input.nodes[3], id: 'node_5', next: 'node_4' })
    input.nodes[3].next = 'node_5'
    expect(deleteStoryNode(input, 'node_5').nodes.find(node => node.id === 'node_4')?.next).toBeNull()
  })

  it('duplicates metadata deeply but clears the log binding and route destination', () => {
    const input = fixture()
    input.nodes[0].steps = [{ title: '原步骤' }]
    const copy = createStoryNode(input, 'map_a', input.nodes[0])
    expect(copy.id).toBe('node_5')
    expect(copy.areaId).toBeUndefined()
    expect(copy.next).toBeNull()
    copy.steps![0].title = '副本步骤'
    expect(input.nodes[0].steps[0].title).toBe('原步骤')
  })

  it('matches exact IDs and prefers the first mainline occurrence over branch array order', () => {
    const input = fixture()
    input.nodes[3].areaId = 'G1_2'
    input.nodes.unshift(input.nodes.pop()!)
    expect(findStoryArea([input], 'G1_2')?.node.id).toBe('node_2')
    expect(findStoryArea([input], 'g1_2')).toBeNull()
    expect(findStoryArea([input], 'G1_20')).toBeNull()
    expect(findStoryArea([input], '')).toBeNull()
  })
})

describe('local story assets', () => {
  it.each(['../a.png', '/maps/../a.png', '/maps/%2e%2e/a.png', '%252e%252e/a.png', 'https://x/a.png', '//x/a.png', 'C:\\a.png', 'maps\\a.png', 'maps/a.png?x=1', 'maps/a.png#x', 'maps/%ZZ.png', ' maps/a.png', '/maps//a.png'])('rejects unsafe asset reference %s', path => {
    expect(normalizeStoryAsset(path)).toBeNull()
  })

  it('supports the existing public prefix and encoded local filenames', () => {
    expect(normalizeStoryAsset('/story-guide/maps/act1.png')).toBe('maps/act1.png')
    expect(normalizeStoryAsset('/media/%E5%9C%B0%E5%9B%BE.png')).toBe('media/地图.png')
  })
})

describe('bundled chapters and verified bindings', () => {
  const root = new URL('../../', import.meta.url)
  const readJson = (path: string) => JSON.parse(readFileSync(new URL(path, root), 'utf8'))
  const manifest = readJson('src/data/storyGuide/manifest.json') as { chapters: { id: string; title: string; file: string }[] }
  const bindings = readJson('scripts/story-guide-bindings.json') as Record<string, string[]>
  const snapshot = readJson('src/data/storyGuide/area-snapshot.json') as { areas: { areaId: string; names: { international: string; chinese: string } }[] }
  const chapters = manifest.chapters.map(entry => parseStoryChapter(readJson(`src/data/storyGuide/chapters/${entry.id}.json`)))

  it('ships all five chapters, 92 bound nodes, and the interlude label', () => {
    expect(chapters.map(chapter => chapter.nodes.length)).toEqual([13, 22, 18, 17, 22])
    expect(manifest.chapters.find(chapter => chapter.id === 'act5')?.title).toBe('间章')
    for (const chapter of chapters) {
      expect(validateStoryChapter(chapter).filter(issue => issue.level === 'error'), chapter.id).toEqual([])
      expect(JSON.parse(serializeStoryChapter(chapter))).toEqual(chapter)
      for (const node of chapter.nodes) {
        expect(node.areaId, `${chapter.id}/${node.id}`).toBe(bindings[chapter.id][Number(node.id.slice(5)) - 1])
        const verified = snapshot.areas.find(area => area.areaId === node.areaId)
        expect(verified, node.areaId).toBeDefined()
        expect(node.names).toEqual(verified!.names)
      }
    }
  })

  it('resolves real Act 4 IDs and prioritizes the first Halani Gates visit', () => {
    expect(findStoryArea(chapters, 'G4_1_1')?.node.id).toBe('node_4')
    expect(findStoryArea(chapters, 'G4_2_2')?.node.id).toBe('node_3')
    expect(findStoryArea(chapters, 'G2_3')?.node.id).toBe('node_3')
    expect(findStoryArea(chapters, 'Unknown_Future_Area')).toBeNull()
  })

  it('includes every referenced map, cover, step, and quest image locally', () => {
    for (const chapter of chapters) {
      const assets = [
        ...chapter.maps.map(map => map.image),
        ...chapter.nodes.flatMap(node => [node.coverImage, ...(node.images ?? []).map(image => image.url), ...(node.steps ?? []).map(step => step.image)]),
        ...(chapter.seasonQuests ?? []).flatMap(quest => quest.steps.map(step => step.image)),
      ].filter((path): path is string => Boolean(path))
      for (const asset of assets) {
        const normalized = normalizeStoryAsset(asset)
        expect(normalized, asset).not.toBeNull()
        expect(existsSync(fileURLToPath(new URL(`public/story-guide/${normalized}`, root))), `${chapter.id}: ${asset}`).toBe(true)
      }
    }
  })
})

import { afterEach, describe, expect, it, vi } from 'vitest'
import { reloadStoryChapters, storyChapters } from '@/data/storyGuide/loadContent'

afterEach(() => vi.unstubAllGlobals())

describe('story data reload', () => {
  it('reads fresh chapter files without changing the initial data', async () => {
    const original = storyChapters[0].nodes[0].description
    const fetchMock = vi.fn(async (url: string, _options?: RequestInit) => {
      const chapter = structuredClone(storyChapters.find(item => url.endsWith(`/${item.id}.json`))!)
      chapter.nodes[0].description = '重新读取的攻略'
      return new Response(JSON.stringify(chapter))
    })
    vi.stubGlobal('fetch', fetchMock)
    const loaded = await reloadStoryChapters()
    expect(loaded).toHaveLength(storyChapters.length)
    expect(loaded.every(chapter => chapter.nodes[0].description === '重新读取的攻略')).toBe(true)
    expect(storyChapters[0].nodes[0].description).toBe(original)
    expect(fetchMock).toHaveBeenCalledTimes(storyChapters.length)
    for (const call of fetchMock.mock.calls) expect(call[1]).toEqual({ cache: 'no-store' })
  })

  it('rejects the whole reload when a chapter cannot be read', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.endsWith('/act2.json')) return new Response('', { status: 503 })
      return new Response(JSON.stringify(storyChapters.find(item => url.endsWith(`/${item.id}.json`))))
    }))
    await expect(reloadStoryChapters()).rejects.toThrow('读取第二章失败（503）')
  })

  it('rejects a chapter with a different ID', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ...storyChapters[0], id: 'wrong_id' }))))
    await expect(reloadStoryChapters()).rejects.toThrow('剧情章节 ID 与清单不一致')
  })

  it('rejects malformed chapter data', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{')))
    await expect(reloadStoryChapters()).rejects.toThrow()
  })
})

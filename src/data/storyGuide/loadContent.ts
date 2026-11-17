import manifestData from './manifest.json'
import areaData from './area-snapshot.json'
import { parseStoryChapter } from '@/engine/storyGuide'
import { normalizeStoryAsset } from '@/engine/storyGuideAssets'
import type { StoryArea, StoryChapter, StoryManifest } from '@/types/storyGuide'

export const storyManifest = manifestData as StoryManifest
export const storyAreas = areaData.areas as StoryArea[]
// Eager discovery keeps new chapters in the data manifest, without page-specific imports.
const modules = import.meta.glob('./chapters/*.json', { eager: true, import: 'default' })
const chapterUrls = import.meta.glob<string>('./chapters/*.json', { eager: true, query: '?url', import: 'default' })
export const storyChapters: StoryChapter[] = storyManifest.chapters.map(entry => {
  const file = `./chapters/${entry.file.split('/').pop()}`
  if (!modules[file]) throw new Error(`缺少剧情章节：${entry.file}`)
  const chapter = parseStoryChapter(modules[file])
  if (chapter.id !== entry.id) throw new Error(`剧情章节 ID 与清单不一致：${entry.id}`)
  return { ...chapter, title: entry.title }
})

export async function reloadStoryChapters(): Promise<StoryChapter[]> {
  return Promise.all(storyManifest.chapters.map(async entry => {
    const file = `./chapters/${entry.file.split('/').pop()}`
    const url = chapterUrls[file]
    if (!url) throw new Error(`缺少剧情章节：${entry.file}`)
    const response = await fetch(url, { cache: 'no-store' })
    if (!response.ok) throw new Error(`读取${entry.title}失败（${response.status}）`)
    const chapter = parseStoryChapter(await response.text())
    if (chapter.id !== entry.id) throw new Error(`剧情章节 ID 与清单不一致：${entry.id}`)
    return { ...chapter, title: entry.title }
  }))
}

export function storyAssetUrl(path: string) {
  const normalized = normalizeStoryAsset(path)
  return normalized ? `${import.meta.env.BASE_URL}story-guide/${normalized.split('/').map(encodeURIComponent).join('/')}` : ''
}

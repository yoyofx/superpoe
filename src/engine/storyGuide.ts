import type { StoryChapter, StoryIssue, StoryNode } from '@/types/storyGuide'
import { normalizeStoryAsset } from './storyGuideAssets'

const record = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value))
const text = (value: unknown): value is string => typeof value === 'string'
const localAsset = (value: string) => normalizeStoryAsset(value) !== null

/** Validate untrusted drafts before the UI can use nested properties. Extra metadata survives import/export. */
export function parseStoryChapter(input: string | unknown): StoryChapter {
  const value: unknown = typeof input === 'string' ? JSON.parse(input.replace(/^\uFEFF/, '')) : input
  if (!record(value) || !text(value.id) || !text(value.title) || !Array.isArray(value.maps) || !Array.isArray(value.nodes) || !Array.isArray(value.flowOrder)) {
    throw new Error('章节需要 id、title、maps、nodes 和 flowOrder。')
  }
  if (!value.flowOrder.every(text)) throw new Error('flowOrder 必须是节点 ID 数组。')
  for (const map of value.maps) {
    if (!record(map) || !text(map.id) || !text(map.title) || !text(map.image)) throw new Error('地图需要 id、title 和 image。')
  }
  const checkSteps = (steps: unknown) => {
    if (steps === undefined) return
    if (!Array.isArray(steps) || steps.some(step => !record(step) || !text(step.title) || (step.body !== undefined && !text(step.body)) || (step.image !== undefined && !text(step.image)))) throw new Error('步骤需要 title，可选 body 和 image。')
  }
  for (const node of value.nodes) {
    if (!record(node) || !text(node.id) || !text(node.mapId) || !text(node.title) || !text(node.description) || typeof node.x !== 'number' || typeof node.y !== 'number' || !(node.next === null || text(node.next))) throw new Error('节点需要 id、mapId、title、description、x、y 和 next。')
    for (const key of ['areaId', 'hint', 'mapTitle', 'seasonReward', 'rewards', 'coverImage']) {
      if (node[key] !== undefined && !(key === 'coverImage' && node[key] === null) && !text(node[key])) throw new Error(`${node.id} 的 ${key} 必须是文本。`)
    }
    if (node.names !== undefined && (!record(node.names) || !text(node.names.international) || !text(node.names.chinese))) throw new Error(`${node.id} 的 names 需要 international 和 chinese。`)
    if (node.badge !== undefined && (!record(node.badge) || !text(node.badge.text) || (node.badge.type !== undefined && !text(node.badge.type)))) throw new Error(`${node.id} 的标签格式无效。`)
    if (node.images !== undefined && (!Array.isArray(node.images) || node.images.some(img => !record(img) || !text(img.url) || (img.caption !== undefined && !text(img.caption))))) throw new Error(`${node.id} 的图片格式无效。`)
    checkSteps(node.steps)
  }
  if (value.seasonQuests !== undefined) {
    if (!Array.isArray(value.seasonQuests)) throw new Error('seasonQuests 必须是数组。')
    for (const quest of value.seasonQuests) {
      if (!record(quest) || !text(quest.id) || !text(quest.title) || !text(quest.overview) || !Array.isArray(quest.steps) || (quest.reward !== undefined && !text(quest.reward)) || (quest.note !== undefined && !text(quest.note))) throw new Error('赛季任务格式无效。')
      checkSteps(quest.steps)
    }
  }
  return structuredClone(value) as unknown as StoryChapter
}

export function validateStoryChapter(chapter: StoryChapter): StoryIssue[] {
  const issues: StoryIssue[] = []
  const add = (level: StoryIssue['level'], message: string, nodeId?: string) => issues.push({ level, message, nodeId })
  if (!/^[a-zA-Z0-9_-]+$/.test(chapter.id)) add('error', '章节 ID 只能包含字母、数字、下划线和短横线。')
  if (!chapter.title.trim()) add('error', '章节标题不能为空。')
  const ids = new Set<string>()
  const mapIds = new Set<string>()
  for (const map of chapter.maps) {
    if (!map.id.trim() || mapIds.has(map.id)) add('error', `地图 ID 为空或重复：${map.id}`)
    mapIds.add(map.id)
    if (!localAsset(map.image)) add('error', `地图 ${map.id} 需要本地图片路径。`)
  }
  if (!mapIds.size) add('error', '章节至少需要一张地图。')
  for (const node of chapter.nodes) {
    if (!node.id.trim() || ids.has(node.id)) add('error', `节点 ID 为空或重复：${node.id}`, node.id)
    ids.add(node.id)
  }
  const areas = new Map<string, string>()
  for (const node of chapter.nodes) {
    if (!mapIds.has(node.mapId)) add('error', `地图不存在：${node.mapId}`, node.id)
    if (!Number.isFinite(node.x) || !Number.isFinite(node.y) || node.x < 0 || node.x > 100 || node.y < 0 || node.y > 100) add('error', '坐标必须在 0–100 之间。', node.id)
    if (!node.title.trim()) add('error', '节点标题不能为空。', node.id)
    if (node.next !== null && !ids.has(node.next)) add('error', `下一节点不存在：${node.next}`, node.id)
    if (node.next === node.id) add('error', '下一节点不能指向自身。', node.id)
    if (!node.areaId?.trim()) add('warning', '尚未填写真实区域 ID，无法自动定位。', node.id)
    else {
      if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(node.areaId)) add('error', '区域 ID 格式无效，请填写游戏日志中的真实 ID。', node.id)
      if (areas.has(node.areaId)) add('warning', `区域 ${node.areaId} 也用于 ${areas.get(node.areaId)}，自动定位优先主线路中的首个节点。`, node.id)
      else areas.set(node.areaId, node.id)
    }
    for (const url of [node.coverImage, ...(node.images ?? []).map(img => img.url), ...(node.steps ?? []).map(step => step.image)]) {
      if (url && !localAsset(url)) add('error', '图片必须使用本地资源路径。', node.id)
    }
  }
  const flow = new Set<string>()
  if (!chapter.flowOrder.length) add('error', '主线路至少需要一个节点。')
  chapter.flowOrder.forEach((id, index) => {
    if (!ids.has(id)) add('error', `主线路节点不存在：${id}`)
    if (flow.has(id)) add('error', `主线路节点重复：${id}`, id)
    flow.add(id)
    const node = chapter.nodes.find(item => item.id === id)
    if (node && node.next !== (chapter.flowOrder[index + 1] ?? null)) add('error', '主线路 next 与 flowOrder 不一致。', id)
  })
  const quests = new Set<string>()
  for (const quest of chapter.seasonQuests ?? []) {
    if (!quest.id.trim() || quests.has(quest.id)) add('error', `赛季任务 ID 为空或重复：${quest.id}`)
    quests.add(quest.id)
    for (const step of quest.steps) {
      if (step.image && !localAsset(step.image)) add('error', `赛季任务 ${quest.id} 的图片必须使用本地资源路径。`)
    }
  }
  return issues
}

export function setStoryFlow(chapter: StoryChapter, flowOrder: string[]): StoryChapter {
  const positions = new Map(flowOrder.map((id, index) => [id, index]))
  return { ...chapter, flowOrder, nodes: chapter.nodes.map(node => {
    const index = positions.get(node.id)
    return index === undefined ? node : { ...node, next: flowOrder[index + 1] ?? null }
  }) }
}

export function createStoryNode(chapter: StoryChapter, mapId: string, source?: StoryNode, point = { x: 50, y: 50 }): StoryNode {
  let number = 1
  while (chapter.nodes.some(node => node.id === `node_${number}`)) number++
  if (source) {
    const copy = structuredClone(source)
    delete copy.areaId
    return { ...copy, id: `node_${number}`, title: `${copy.title}（副本）`, x: Math.min(100, copy.x + 2), y: Math.min(100, copy.y + 2), next: null }
  }
  return { id: `node_${number}`, mapId, ...point, title: '新区域', description: '', next: null }
}

export function deleteStoryNode(chapter: StoryChapter, nodeId: string): StoryChapter {
  const removed = chapter.nodes.find(node => node.id === nodeId)
  const nodes = chapter.nodes.filter(node => node.id !== nodeId).map(node => node.next === nodeId ? { ...node, next: removed?.next === nodeId || removed?.next === node.id ? null : removed?.next ?? null } : node)
  return setStoryFlow({ ...chapter, nodes }, chapter.flowOrder.filter(id => id !== nodeId))
}

export function findStoryArea(chapters: StoryChapter[], areaId: string) {
  if (!areaId) return null
  for (const chapter of chapters) {
    const node = [...chapter.flowOrder.map(id => chapter.nodes.find(item => item.id === id)), ...chapter.nodes].find(item => item?.areaId === areaId)
    if (node) return { chapter, node }
  }
  return null
}

export function storyNodeName(node: StoryNode, realm: 'international' | 'chinese') {
  return node.names?.[realm] || node.title
}

export function serializeStoryChapter(chapter: StoryChapter) {
  const errors = validateStoryChapter(chapter).filter(issue => issue.level === 'error')
  if (errors.length) throw new Error(errors.map(issue => `${issue.nodeId ? `${issue.nodeId}：` : ''}${issue.message}`).join('\n'))
  return JSON.stringify(chapter, null, 2) + '\n'
}

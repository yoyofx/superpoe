export interface StoryMap {
  id: string
  title: string
  image: string
  [key: string]: unknown
}

export interface StoryStep {
  title: string
  body?: string
  image?: string
  [key: string]: unknown
}

export interface StoryNode {
  id: string
  mapId: string
  areaId?: string
  x: number
  y: number
  title: string
  names?: { international: string; chinese: string }
  description: string
  next: string | null
  hint?: string
  mapTitle?: string
  badge?: { text: string; type?: string }
  seasonReward?: string
  rewards?: string
  coverImage?: string | null
  images?: { url: string; caption?: string; [key: string]: unknown }[]
  steps?: StoryStep[]
  [key: string]: unknown
}

export interface StoryChapter {
  id: string
  title: string
  flowOrder: string[]
  maps: StoryMap[]
  nodes: StoryNode[]
  seasonQuests?: {
    id: string
    title: string
    overview: string
    steps: StoryStep[]
    reward?: string
    note?: string
    [key: string]: unknown
  }[]
  [key: string]: unknown
}

export interface StoryManifest {
  contentVersion: string
  chapters: { id: string; title: string; file: string }[]
}

export interface StoryArea {
  areaId: string
  names: { international: string; chinese: string }
  source: string
}

export interface StoryAreaEvent {
  areaId: string
  enteredAt: number
}

export interface StoryIssue {
  level: 'error' | 'warning'
  message: string
  nodeId?: string
}

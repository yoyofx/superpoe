export type CampaignStatsSegment = 'act1' | 'act2' | 'act3' | 'act4' | 'interlude'

export interface CampaignRunRecord {
  id: number
  startedAt: number
  completedAt: number
  elapsed: number
  fullRoute: boolean
  segments: { key: CampaignStatsSegment; elapsed: number }[]
}

export interface CampaignStatistics {
  completedRuns: number
  totalElapsed: number
  fullRouteRuns: number
  bestElapsed: number | null
  averageElapsed: number | null
  chapters: {
    key: CampaignStatsSegment
    count: number
    best: number | null
    average: number | null
    latest: number | null
  }[]
  current: { status: 'idle' | 'running' | 'paused' | 'completed'; elapsed: number; segment: CampaignStatsSegment | null }
  runs: CampaignRunRecord[]
  page: number
  pageSize: number
}

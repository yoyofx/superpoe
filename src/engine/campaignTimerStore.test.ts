import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { campaignSegmentForAreaId } from '../../electron/campaignAreaRules.js'
import { CAMPAIGN_SEGMENTS, CampaignTimerStore } from '../../electron/campaignTimerStore.js'

const tempDirectories: string[] = []

afterEach(() => {
  vi.useRealTimers()
  while (tempDirectories.length) rmSync(tempDirectories.pop()!, { recursive: true, force: true })
})

describe('campaign area classification', () => {
  it('keeps interlude area ids separate from act 6 data', () => {
    expect(campaignSegmentForAreaId('G4_town')).toBe('act4')
    expect(campaignSegmentForAreaId('P1_Town')).toBe('interlude')
    expect(campaignSegmentForAreaId('P2_Town')).toBe('interlude')
    expect(campaignSegmentForAreaId('P3_Town')).toBe('interlude')
    expect(campaignSegmentForAreaId('MapSavanna')).toBeNull()
  })
})

describe('campaign timer persistence', () => {
  it.each(['idle', 'paused', 'running'] as const)('allows repeated disposal of a %s timer and preserves its final checkpoint', (status) => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000)
    const directory = mkdtempSync(path.join(os.tmpdir(), 'superpoe-campaign-dispose-'))
    tempDirectories.push(directory)
    const databasePath = path.join(directory, 'campaign.sqlite')
    const store = new CampaignTimerStore(databasePath)
    if (status !== 'idle') store.start('act1')
    vi.advanceTimersByTime(2_000)
    if (status === 'paused') store.pause()
    vi.advanceTimersByTime(2_000)
    store.dispose()
    expect(vi.getTimerCount()).toBe(0)
    vi.advanceTimersByTime(2_000)
    expect(() => store.dispose()).not.toThrow()

    const restored = new CampaignTimerStore(databasePath)
    try {
      expect(restored.getSnapshot()).toMatchObject({
        status,
        elapsed: status === 'running' ? 6_000 : status === 'paused' ? 2_000 : 0,
      })
    } finally {
      restored.dispose()
    }
  })

  it('restores paused totals and separates chapter elapsed time', () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), 'superpoe-campaign-'))
    tempDirectories.push(directory)
    const databasePath = path.join(directory, 'campaign.sqlite')
    const first = new CampaignTimerStore(databasePath)
    first.setCurrentArea('G1_town', 'act1', 1_000)
    first.start(null, 1_000)
    first.checkpoint(4_000)
    first.pause(5_000)
    first.dispose()

    const restored = new CampaignTimerStore(databasePath)
    expect(restored.getSnapshot(5_000)).toMatchObject({ status: 'paused', elapsed: 4_000 })
    restored.start(null, 6_000)
    restored.setCurrentArea('G2_town', 'act2', 7_000)
    restored.checkpoint(9_000)
    const snapshot = restored.getSnapshot(9_000)
    expect(snapshot.elapsed).toBe(7_000)
    expect(snapshot.segments.find((segment) => segment.key === 'act1')?.elapsed).toBe(5_000)
    expect(snapshot.segments.find((segment) => segment.key === 'act2')?.elapsed).toBe(2_000)
    restored.complete(10_000)
    expect(restored.getSnapshot(10_000).status).toBe('completed')
    restored.reset()
    expect(restored.getSnapshot(10_000).runId).toBeNull()
    restored.dispose()
  })
})

describe('campaign statistics', () => {
  const createStore = () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), 'superpoe-campaign-stats-'))
    tempDirectories.push(directory)
    const databasePath = path.join(directory, 'campaign.sqlite')
    return { store: new CampaignTimerStore(databasePath), databasePath }
  }
  const finishFullRoute = (store: CampaignTimerStore, start: number, split: number) => {
    store.start('act1', start)
    CAMPAIGN_SEGMENTS.slice(1).forEach((segment, index) => store.setCurrentArea(`area-${segment}`, segment, start + (index + 1) * split))
    store.complete(start + 5 * split)
  }

  it('aggregates completed records, keeps partial runs separate, and excludes active runs', () => {
    const { store } = createStore()
    try {
      finishFullRoute(store, 1000, 1000)
      store.reset()
      finishFullRoute(store, 10000, 2000)
      store.reset()
      store.start('act3', 30000)
      store.complete(33000)
      store.reset()
      store.start('act1', 40000)

      const stats = store.getStatistics(0, 42000)
      expect(stats).toMatchObject({ completedRuns: 3, totalElapsed: 18000, fullRouteRuns: 2, bestElapsed: 5000, averageElapsed: 7500,
        current: { status: 'running', elapsed: 2000, segment: 'act1' } })
      expect(stats.chapters[0]).toEqual({ key: 'act1', count: 2, best: 1000, average: 1500, latest: 2000 })
      expect(stats.chapters[2]).toEqual({ key: 'act3', count: 3, best: 1000, average: 2000, latest: 3000 })
      expect(stats.runs.map(run => [run.elapsed, run.fullRoute])).toEqual([[3000, false], [10000, true], [5000, true]])
      store.pause(43000)
      expect(store.getStatistics(0, 50000).current).toMatchObject({ status: 'paused', elapsed: 3000 })
    } finally { store.dispose() }
  })

  it('preserves completed history after reset and reopening the database', () => {
    const { store, databasePath } = createStore()
    finishFullRoute(store, 1000, 1000)
    store.reset()
    store.dispose()
    const restored = new CampaignTimerStore(databasePath)
    try {
      expect(restored.getStatistics()).toMatchObject({ completedRuns: 1, bestElapsed: 5000, current: { status: 'idle' } })
      expect(restored.getStatistics().runs[0].segments.map(segment => segment.elapsed)).toEqual([1000, 1000, 1000, 1000, 1000])
      restored.start('act2', 20000)
      restored.reset()
      expect(restored.getStatistics().completedRuns).toBe(1)
    } finally { restored.dispose() }
  })

  it('returns empty statistics and paginates history without changing aggregates', () => {
    const { store } = createStore()
    try {
      expect(store.getStatistics()).toMatchObject({ completedRuns: 0, bestElapsed: null, averageElapsed: null, runs: [], page: 0 })
      expect(store.getStatistics().chapters.every(chapter => chapter.count === 0 && chapter.latest === null)).toBe(true)
      for (let index = 0; index < 21; index++) {
        store.start('act2', index * 10000)
        store.complete(index * 10000 + 1000)
        store.reset()
      }
      const first = store.getStatistics()
      const last = store.getStatistics(100)
      expect(first).toMatchObject({ completedRuns: 21, totalElapsed: 21000, fullRouteRuns: 0, bestElapsed: null, page: 0, pageSize: 20 })
      expect(first.runs).toHaveLength(20)
      expect(last.page).toBe(1)
      expect(last.runs.map(run => run.id)).toEqual([1])
      expect(last.chapters).toEqual(first.chapters)
      expect(store.getStatistics(-1).page).toBe(0)
    } finally { store.dispose() }
  })
})

import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { CampaignRunRecord, CampaignStatistics } from '../src/types/campaignStats.js'

export const CAMPAIGN_SEGMENTS = ['act1', 'act2', 'act3', 'act4', 'interlude'] as const
export type CampaignSegmentKey = typeof CAMPAIGN_SEGMENTS[number]
export type CampaignRunStatus = 'running' | 'paused' | 'completed'

export interface CampaignSegmentSnapshot {
  key: CampaignSegmentKey
  elapsed: number
  status: 'current' | 'completed' | 'pending'
}

export interface CampaignTimerSnapshot {
  runId: number | null
  status: CampaignRunStatus | 'idle'
  elapsed: number
  currentSegment: CampaignSegmentKey | null
  currentAreaId: string | null
  segments: CampaignSegmentSnapshot[]
}

type Row = Record<string, unknown>

function isSegment(value: unknown): value is CampaignSegmentKey {
  return typeof value === 'string' && (CAMPAIGN_SEGMENTS as readonly string[]).includes(value)
}

function numberValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

/**
 * Local story-run persistence. The Electron main process is the sole writer;
 * renderer windows only receive snapshots through IPC.
 */
export class CampaignTimerStore {
  private readonly db: DatabaseSync
  private runId: number | null = null
  private status: CampaignRunStatus | 'idle' = 'idle'
  private currentSegment: CampaignSegmentKey | null = null
  private currentAreaId: string | null = null
  private lastCheckpointAt: number | null = null
  private checkpointTicker?: NodeJS.Timeout
  private disposed = false

  constructor(private readonly databasePath: string) {
    mkdirSync(path.dirname(databasePath), { recursive: true })
    this.db = new DatabaseSync(databasePath)
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;')
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS campaign_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        status TEXT NOT NULL CHECK (status IN ('running', 'paused', 'completed')),
        started_at INTEGER NOT NULL,
        completed_at INTEGER,
        total_elapsed_ms INTEGER NOT NULL DEFAULT 0,
        current_segment TEXT,
        current_area_id TEXT,
        last_checkpoint_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS campaign_segments (
        run_id INTEGER NOT NULL REFERENCES campaign_runs(id) ON DELETE CASCADE,
        segment_key TEXT NOT NULL,
        elapsed_ms INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (run_id, segment_key)
      );
      CREATE TABLE IF NOT EXISTS campaign_progress (
        run_id INTEGER PRIMARY KEY REFERENCES campaign_runs(id) ON DELETE CASCADE,
        current_segment TEXT,
        current_area_id TEXT,
        updated_at INTEGER NOT NULL
      );
    `)
    this.restore(Date.now())
    this.checkpointTicker = setInterval(() => this.checkpoint(Date.now()), 5_000)
    this.checkpointTicker.unref()
  }

  getSnapshot(now = Date.now()): CampaignTimerSnapshot {
    const run = this.currentRunRow()
    const elapsed = run ? numberValue(run.total_elapsed_ms) + this.liveDelta(now) : 0
    const liveSegment = this.currentSegment
    const segmentRows = new Map<string, number>()
    for (const row of this.segmentRows()) segmentRows.set(String(row.segment_key), numberValue(row.elapsed_ms))
    if (liveSegment) segmentRows.set(liveSegment, (segmentRows.get(liveSegment) || 0) + this.liveDelta(now))
    return {
      runId: this.runId,
      status: this.status,
      elapsed,
      currentSegment: liveSegment,
      currentAreaId: this.currentAreaId,
      segments: CAMPAIGN_SEGMENTS.map((key) => ({
        key,
        elapsed: segmentRows.get(key) || 0,
        status: liveSegment === key ? 'current' : (segmentRows.get(key) || 0) > 0 ? 'completed' : 'pending',
      })),
    }
  }

  setCurrentArea(areaId: string | undefined, segment: CampaignSegmentKey | null, now = Date.now()): void {
    if (!segment) return
    if (this.status === 'running' && this.currentSegment !== segment) this.checkpoint(now)
    this.currentAreaId = areaId || null
    this.currentSegment = segment
    if (this.runId !== null) {
      this.db.prepare(`UPDATE campaign_runs SET current_segment = ?, current_area_id = ? WHERE id = ?`)
        .run(segment, this.currentAreaId, this.runId)
      this.db.prepare(`
        INSERT INTO campaign_progress(run_id, current_segment, current_area_id, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(run_id) DO UPDATE SET current_segment = excluded.current_segment,
          current_area_id = excluded.current_area_id, updated_at = excluded.updated_at
      `).run(this.runId, segment, this.currentAreaId, now)
    }
  }

  start(segment: CampaignSegmentKey | null, now = Date.now()): void {
    if (this.status === 'paused' && this.runId !== null) {
      this.status = 'running'
      this.lastCheckpointAt = now
      this.db.prepare(`UPDATE campaign_runs SET status = 'running', last_checkpoint_at = ? WHERE id = ?`).run(now, this.runId)
      return
    }
    if (this.status === 'running') return
    const initialSegment = segment || this.currentSegment || 'act1'
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const result = this.db.prepare(`
        INSERT INTO campaign_runs(status, started_at, total_elapsed_ms, current_segment, current_area_id, last_checkpoint_at)
        VALUES ('running', ?, 0, ?, ?, ?)
      `).run(now, initialSegment, this.currentAreaId, now)
      this.runId = Number(result.lastInsertRowid)
      this.status = 'running'
      this.currentSegment = initialSegment
      this.lastCheckpointAt = now
      for (const key of CAMPAIGN_SEGMENTS) this.db.prepare(`INSERT INTO campaign_segments(run_id, segment_key, elapsed_ms) VALUES (?, ?, 0)`).run(this.runId, key)
      this.db.prepare(`INSERT INTO campaign_progress(run_id, current_segment, current_area_id, updated_at) VALUES (?, ?, ?, ?)`).run(this.runId, initialSegment, this.currentAreaId, now)
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  pause(now = Date.now()): void {
    if (this.status !== 'running' || this.runId === null) return
    this.checkpoint(now)
    this.status = 'paused'
    this.db.prepare(`UPDATE campaign_runs SET status = 'paused' WHERE id = ?`).run(this.runId)
  }

  complete(now = Date.now()): void {
    if (this.runId === null || (this.status !== 'running' && this.status !== 'paused')) return
    if (this.status === 'running') this.checkpoint(now)
    this.db.prepare(`UPDATE campaign_runs SET status = 'completed', completed_at = ? WHERE id = ?`).run(now, this.runId)
    this.status = 'completed'
    this.lastCheckpointAt = null
  }

  reset(): void {
    if (this.runId !== null && this.status !== 'completed') this.db.prepare(`DELETE FROM campaign_runs WHERE id = ?`).run(this.runId)
    this.runId = null
    this.status = 'idle'
    this.currentSegment = null
    this.currentAreaId = null
    this.lastCheckpointAt = null
  }

  getStatistics(requestedPage = 0, now = Date.now()): CampaignStatistics {
    const summary = this.db.prepare(`
      WITH records AS (
        SELECT total_elapsed_ms,
          (SELECT COUNT(*) FROM campaign_segments s WHERE s.run_id = r.id AND s.elapsed_ms > 0) = 5 AS full_route
        FROM campaign_runs r WHERE status = 'completed'
      )
      SELECT COUNT(*) AS count, COALESCE(SUM(total_elapsed_ms), 0) AS total,
        COALESCE(SUM(full_route), 0) AS full_count,
        MIN(CASE WHEN full_route THEN total_elapsed_ms END) AS best,
        AVG(CASE WHEN full_route THEN total_elapsed_ms END) AS average
      FROM records
    `).get() as Row
    const pageSize = 20
    const completedRuns = numberValue(summary.count)
    const page = Math.min(Math.max(0, Math.floor(Number.isFinite(requestedPage) ? requestedPage : 0)), Math.max(0, Math.ceil(completedRuns / pageSize) - 1))
    const rows = this.db.prepare(`SELECT id, started_at, completed_at, total_elapsed_ms FROM campaign_runs
      WHERE status = 'completed' ORDER BY id DESC LIMIT ? OFFSET ?`).all(pageSize, page * pageSize) as Row[]
    const runs: CampaignRunRecord[] = rows.map(row => {
      const segments = this.db.prepare(`SELECT segment_key, elapsed_ms FROM campaign_segments WHERE run_id = ?`).all(numberValue(row.id)) as Row[]
      return {
        id: numberValue(row.id), startedAt: numberValue(row.started_at), completedAt: numberValue(row.completed_at),
        elapsed: numberValue(row.total_elapsed_ms),
        fullRoute: CAMPAIGN_SEGMENTS.every(key => segments.some(s => s.segment_key === key && numberValue(s.elapsed_ms) > 0)),
        segments: CAMPAIGN_SEGMENTS.map(key => ({ key, elapsed: numberValue(segments.find(s => s.segment_key === key)?.elapsed_ms) })),
      }
    })
    const chapterRows = this.db.prepare(`
      SELECT s.segment_key, COUNT(*) AS count, MIN(s.elapsed_ms) AS best, AVG(s.elapsed_ms) AS average
      FROM campaign_segments s JOIN campaign_runs r ON r.id = s.run_id
      WHERE r.status = 'completed' AND s.elapsed_ms > 0 GROUP BY s.segment_key
    `).all() as Row[]
    const latestRows = this.db.prepare(`
      SELECT s.segment_key, s.elapsed_ms FROM campaign_segments s JOIN campaign_runs r ON r.id = s.run_id
      WHERE r.status = 'completed' AND s.elapsed_ms > 0 AND r.id = (
        SELECT MAX(r2.id) FROM campaign_runs r2 JOIN campaign_segments s2 ON s2.run_id = r2.id
        WHERE r2.status = 'completed' AND s2.segment_key = s.segment_key AND s2.elapsed_ms > 0
      )
    `).all() as Row[]
    const current = this.getSnapshot(now)
    return {
      completedRuns, totalElapsed: numberValue(summary.total), fullRouteRuns: numberValue(summary.full_count),
      bestElapsed: summary.best === null ? null : numberValue(summary.best),
      averageElapsed: summary.average === null ? null : numberValue(summary.average),
      chapters: CAMPAIGN_SEGMENTS.map(key => {
        const row = chapterRows.find(item => item.segment_key === key)
        const latest = latestRows.find(item => item.segment_key === key)
        return { key, count: numberValue(row?.count), best: row ? numberValue(row.best) : null,
          average: row ? numberValue(row.average) : null, latest: latest ? numberValue(latest.elapsed_ms) : null }
      }),
      current: { status: current.status, elapsed: current.elapsed, segment: current.currentSegment },
      runs, page, pageSize,
    }
  }

  checkpoint(now = Date.now()): void {
    if (this.status !== 'running' || this.runId === null || this.lastCheckpointAt === null) return
    const delta = Math.max(0, now - this.lastCheckpointAt)
    if (delta <= 0) return
    this.db.exec('BEGIN IMMEDIATE')
    try {
      this.db.prepare(`UPDATE campaign_runs SET total_elapsed_ms = total_elapsed_ms + ?, last_checkpoint_at = ? WHERE id = ?`).run(delta, now, this.runId)
      if (this.currentSegment) this.db.prepare(`UPDATE campaign_segments SET elapsed_ms = elapsed_ms + ? WHERE run_id = ? AND segment_key = ?`).run(delta, this.runId, this.currentSegment)
      this.lastCheckpointAt = now
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  dispose(): void {
    if (this.disposed) return
    this.checkpoint(Date.now())
    this.disposed = true
    if (this.checkpointTicker) clearInterval(this.checkpointTicker)
    this.checkpointTicker = undefined
    this.db.close()
  }

  private restore(now: number): void {
    const row = this.db.prepare(`SELECT * FROM campaign_runs WHERE status IN ('running', 'paused') ORDER BY id DESC LIMIT 1`).get() as Row | undefined
    if (!row) return
    this.runId = numberValue(row.id)
    this.status = row.status === 'paused' ? 'paused' : 'running'
    this.currentSegment = isSegment(row.current_segment) ? row.current_segment : null
    this.currentAreaId = typeof row.current_area_id === 'string' ? row.current_area_id : null
    this.lastCheckpointAt = numberValue(row.last_checkpoint_at)
    if (this.status === 'running') this.checkpoint(now)
  }

  private currentRunRow(): Row | undefined {
    if (this.runId === null) return undefined
    return this.db.prepare(`SELECT total_elapsed_ms FROM campaign_runs WHERE id = ?`).get(this.runId) as Row | undefined
  }

  private segmentRows(): Row[] {
    if (this.runId === null) return []
    return this.db.prepare(`SELECT segment_key, elapsed_ms FROM campaign_segments WHERE run_id = ?`).all(this.runId) as Row[]
  }

  private liveDelta(now: number): number {
    return this.status === 'running' && this.lastCheckpointAt !== null ? Math.max(0, now - this.lastCheckpointAt) : 0
  }
}

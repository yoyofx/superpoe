import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import type {
  GameRuntimeState,
  MarketMonitorSettings,
  MarketMonitoringSnapshot,
  MarketOpportunity,
  MarketOpportunityAttemptResult,
  MarketRealm,
  MonitorConnectionStatus,
  MonitorRuntimeState,
  MonitorTaskPriority,
  MonitorTaskStatus,
  OpportunityBatch,
  PurchaseTarget,
  PurchaseTargetStatus,
  SavedMarketSearch,
  MarketSoundId,
} from '../src/types/market.js'
import { EquipmentLibraryRepository } from './equipmentLibraryRepository.js'
import { normalizeMarketListing } from './marketListing.js'
import type { MarketViewManager } from './marketView.js'

interface MonitoringFile {
  schemaVersion: 1 | 2
  purchaseTargets?: PurchaseTarget[]
  batches?: OpportunityBatch[]
  opportunities: MarketOpportunity[]
  settings: MarketMonitorSettings
  globalPaused: boolean
  updatedAt: string
}

interface BurstEntry {
  target: PurchaseTarget
  listingIds: Set<string>
  resultTokens: Set<string>
}

const DEFAULT_SETTINGS: MarketMonitorSettings = {
  overlayEnabled: true,
  soundEnabled: true,
  soundVolume: 0.7,
  soundId: 'chime-rise',
  doNotDisturb: false,
  overlayCorner: 'top-right',
}
const MAX_OPPORTUNITIES = 30
const SOUND_IDS: readonly MarketSoundId[] = ['chime-rise', 'double-beep', 'bell', 'digital', 'alert', 'soft', 'triple', 'low-pulse', 'bright', 'warble']
const LIVE_ID = /^[A-Za-z0-9_-]{1,128}$/
const CONNECTION_STATUSES: MonitorConnectionStatus[] = ['disabled', 'connecting', 'connected', 'reconnecting', 'auth-required', 'invalid-search', 'error']
const PRIORITY_SCORE: Record<MonitorTaskPriority, number> = { high: 3, normal: 2, low: 1 }

function liveUrl(target: PurchaseTarget): string {
  const host = target.search.realm === 'cn' ? 'poe.game.qq.com' : 'www.pathofexile.com'
  return `wss://${host}/api/trade2/live/poe2/${encodeURIComponent(target.search.leagueId)}/${encodeURIComponent(target.search.searchCode)}`
}

function isOpportunity(value: unknown): value is MarketOpportunity {
  if (!value || typeof value !== 'object') return false
  const item = value as Partial<MarketOpportunity>
  return typeof item.id === 'string' && typeof item.searchId === 'string'
    && (item.realm === 'cn' || item.realm === 'global') && typeof item.leagueId === 'string'
    && typeof item.searchCode === 'string' && typeof item.listingId === 'string'
    && typeof item.status === 'string' && typeof item.detectedAt === 'string'
}

export class MarketMonitoringCoordinator {
  private runtime = new Map<string, MonitorRuntimeState>()
  private purchaseTargets: PurchaseTarget[] = []
  private batches: OpportunityBatch[] = []
  private opportunities: MarketOpportunity[] = []
  private settings: MarketMonitorSettings = { ...DEFAULT_SETTINGS }
  private globalPaused = false
  private game: GameRuntimeState = { status: 'unknown' }
  private burst = new Map<string, BurstEntry>()
  private burstTimer?: NodeJS.Timeout
  private expiryTimer?: NodeJS.Timeout
  private saveTimer?: NodeJS.Timeout
  private dedupe = new Map<string, number>()

  constructor(
    private readonly manager: MarketViewManager,
    private readonly library: EquipmentLibraryRepository,
    private readonly filePath: string,
    private readonly callbacks: {
      changed: (snapshot: MarketMonitoringSnapshot) => void
      actionable: (opportunities: MarketOpportunity[]) => void
    },
  ) {
    this.load()
    this.migrateLegacyTargets()
  }

  start(): void {
    this.syncAll()
    this.expiryTimer = setInterval(() => this.expireOld(), 15_000)
    this.expiryTimer.unref()
    this.emitChanged()
  }

  dispose(): void {
    if (this.burstTimer) clearTimeout(this.burstTimer)
    if (this.expiryTimer) clearInterval(this.expiryTimer)
    if (this.saveTimer) clearTimeout(this.saveTimer)
    for (const realm of ['cn', 'global'] as const) this.manager.sendMonitorSync(realm, [])
    this.saveNow()
  }

  snapshot(): MarketMonitoringSnapshot {
    const pendingCounts = new Map<string, number>()
    for (const opportunity of this.opportunities) {
      if (['detected', 'fetching', 'actionable', 'error'].includes(opportunity.status)) {
        pendingCounts.set(opportunity.targetId, (pendingCounts.get(opportunity.targetId) || 0) + 1)
      }
    }
    return structuredClone({
      purchaseTargets: this.purchaseTargets.map((target) => ({
        ...target,
        sourceSearchChanged: Boolean(target.sourceSearchId && this.library.getSearch(target.sourceSearchId)?.updatedAt !== target.sourceSearchUpdatedAt),
      })),
      targets: this.purchaseTargets.map((target) => ({
        ...(this.runtime.get(target.id) || this.disabledRuntime(target.id)),
        pendingOpportunityCount: pendingCounts.get(target.id) || 0,
      })),
      batches: this.batches,
      opportunities: this.sortedOpportunities().slice(0, MAX_OPPORTUNITIES),
      game: this.game,
      settings: this.settings,
      globalPaused: this.globalPaused,
    })
  }

  setGameState(state: GameRuntimeState): void {
    this.game = structuredClone(state)
    this.emitChanged()
  }

  refreshTargets(): void {
    this.syncAll()
    this.emitChanged()
  }

  createTarget(searchId: string, priority: MonitorTaskPriority = 'normal'): PurchaseTarget {
    const search = this.library.getSearch(searchId)
    if (!search || search.validity === 'invalid' || !search.leagueId || !search.searchCode) throw new Error('Invalid searches cannot be monitored')
    const existing = this.purchaseTargets.find((target) => target.sourceSearchId === searchId && target.status !== 'completed')
    if (existing) return this.setTarget(existing.id, 'armed', priority)
    const now = new Date().toISOString()
    const targetId = this.purchaseTargets.some((target) => target.id === searchId) ? randomUUID() : searchId
    const target: PurchaseTarget = {
      id: targetId, sourceSearchId: search.id, sourceSearchUpdatedAt: search.updatedAt,
      name: search.name, note: search.note, status: 'armed', priority,
      search: this.searchReference(search), createdAt: now, updatedAt: now, statusChangedAt: now,
    }
    this.purchaseTargets.push(target)
    this.syncRealm(target.search.realm)
    this.scheduleSave()
    this.emitChanged()
    return structuredClone(target)
  }

  setTarget(targetId: string, status: PurchaseTargetStatus | MonitorTaskStatus, priority?: MonitorTaskPriority): PurchaseTarget {
    let target = this.purchaseTargets.find((candidate) => candidate.id === targetId)
    if (!target) {
      const search = this.library.getSearch(targetId)
      if (!search) throw new Error('Purchase target was not found')
      return status === 'saved' ? this.createTarget(search.id, priority) : this.createTarget(search.id, priority || search.monitorPriority)
    }
    const nextStatus: PurchaseTargetStatus = status === 'saved' ? 'paused' : status
    const now = new Date().toISOString()
    if (target.status !== nextStatus) target.statusChangedAt = now
    target.status = nextStatus
    if (priority) target.priority = priority
    target.updatedAt = now
    if (nextStatus !== 'armed') this.runtime.set(target.id, this.disabledRuntime(target.id))
    this.syncRealm(target.search.realm)
    this.scheduleSave()
    this.emitChanged()
    return structuredClone(target)
  }

  setPriority(targetId: string, priority: MonitorTaskPriority): PurchaseTarget {
    const target = this.purchaseTargets.find((candidate) => candidate.id === targetId)
    if (!target) throw new Error('Purchase target was not found')
    target.priority = priority
    target.updatedAt = new Date().toISOString()
    this.scheduleSave()
    this.emitChanged()
    return structuredClone(target)
  }

  deleteTarget(targetId: string): boolean {
    const target = this.purchaseTargets.find((candidate) => candidate.id === targetId)
    if (!target) return false
    this.purchaseTargets = this.purchaseTargets.filter((candidate) => candidate.id !== targetId)
    this.runtime.delete(targetId)
    this.syncRealm(target.search.realm)
    this.scheduleSave()
    this.emitChanged()
    return true
  }

  refreshTargetFromSource(targetId: string): PurchaseTarget {
    const target = this.purchaseTargets.find((candidate) => candidate.id === targetId)
    const source = target?.sourceSearchId ? this.library.getSearch(target.sourceSearchId) : undefined
    if (!target || !source || source.validity === 'invalid') throw new Error('The source saved search is unavailable')
    target.name = source.name
    target.note = source.note
    target.search = this.searchReference(source)
    target.sourceSearchUpdatedAt = source.updatedAt
    target.updatedAt = new Date().toISOString()
    this.syncRealm(target.search.realm)
    this.scheduleSave()
    this.emitChanged()
    return structuredClone(target)
  }

  setGlobalPaused(paused: boolean): void {
    this.globalPaused = paused
    this.syncAll()
    this.scheduleSave()
    this.emitChanged()
  }

  updateSettings(patch: Partial<MarketMonitorSettings>): void {
    if (typeof patch.overlayEnabled === 'boolean') this.settings.overlayEnabled = patch.overlayEnabled
    if (typeof patch.soundEnabled === 'boolean') this.settings.soundEnabled = patch.soundEnabled
    if (typeof patch.doNotDisturb === 'boolean') this.settings.doNotDisturb = patch.doNotDisturb
    if (typeof patch.soundVolume === 'number' && Number.isFinite(patch.soundVolume)) this.settings.soundVolume = Math.max(0, Math.min(1, patch.soundVolume))
    if (typeof patch.soundId === 'string' && SOUND_IDS.includes(patch.soundId as MarketSoundId)) this.settings.soundId = patch.soundId as MarketSoundId
    if (patch.overlayCorner && ['top-right', 'top-left', 'bottom-right', 'bottom-left'].includes(patch.overlayCorner)) this.settings.overlayCorner = patch.overlayCorner
    this.scheduleSave()
    this.emitChanged()
  }

  handlePreloadReady(realm: MarketRealm): void {
    this.syncRealm(realm)
  }

  handleRuntime(realm: MarketRealm, value: unknown): void {
    if (!value || typeof value !== 'object') return
    const input = value as Partial<MonitorRuntimeState>
    const target = this.purchaseTargets.find((candidate) => candidate.id === input.searchId)
    if (!target || target.search.realm !== realm || target.status !== 'armed' || !CONNECTION_STATUSES.includes(input.connectionStatus as MonitorConnectionStatus)) return
    const previous = this.runtime.get(target.id) || this.disabledRuntime(target.id)
    this.runtime.set(target.id, {
      ...previous,
      targetId: target.id,
      searchId: target.id,
      connectionStatus: input.connectionStatus as MonitorConnectionStatus,
      retryAttempt: Number.isInteger(input.retryAttempt) ? Math.max(0, Math.min(100, Number(input.retryAttempt))) : previous.retryAttempt,
      ...(typeof input.connectedAt === 'string' ? { connectedAt: input.connectedAt } : {}),
      ...(typeof input.nextRetryAt === 'string' ? { nextRetryAt: input.nextRetryAt } : {}),
      ...(typeof input.lastErrorCode === 'string' ? { lastErrorCode: input.lastErrorCode.slice(0, 100) } : {}),
    })
    this.emitChanged()
  }

  handleLiveResult(realm: MarketRealm, value: unknown): void {
    if (!value || typeof value !== 'object') return
    const input = value as { searchId?: unknown; listingIds?: unknown; resultTokens?: unknown }
    const target = this.purchaseTargets.find((candidate) => candidate.id === input.searchId)
    if (!target || target.search.realm !== realm || target.status !== 'armed' || this.globalPaused) return
    const ids = Array.isArray(input.listingIds) ? input.listingIds.filter((id): id is string => typeof id === 'string' && LIVE_ID.test(id)).slice(0, 500) : []
    const tokens = Array.isArray(input.resultTokens) ? input.resultTokens.filter((token): token is string => typeof token === 'string'
      && token.length <= 4_096 && /^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+){2}$/.test(token)).slice(0, 100) : []
    if (!ids.length && !tokens.length) return
    const now = Date.now()
    this.pruneDedupe(now)
    const entry = this.burst.get(target.id) || { target, listingIds: new Set<string>(), resultTokens: new Set<string>() }
    for (const id of ids) {
      const key = `${realm}:${target.search.searchCode}:${id}`
      if (this.dedupe.has(key)) continue
      this.dedupe.set(key, now)
      entry.listingIds.add(id)
    }
    for (const token of tokens) {
      const tokenHash = createHash('sha256').update(token).digest('base64url')
      const key = `${realm}:${target.search.searchCode}:token:${tokenHash}`
      if (this.dedupe.has(key)) continue
      this.dedupe.set(key, now)
      entry.resultTokens.add(token)
    }
    if (!entry.listingIds.size && !entry.resultTokens.size) return
    this.burst.set(target.id, entry)
    if (!this.burstTimer) this.burstTimer = setTimeout(() => void this.flushBurst(), 250)
  }

  skipOpportunity(id: string): void {
    this.setOpportunityStatus(id, 'skipped')
  }

  async attemptOpportunity(id: string): Promise<MarketOpportunityAttemptResult> {
    const opportunity = this.opportunities.find((candidate) => candidate.id === id)
    const target = opportunity && this.purchaseTargets.find((candidate) => candidate.id === opportunity.targetId)
    if (!opportunity || !target || !['actionable', 'error'].includes(opportunity.status)) return 'error'
    opportunity.status = 'attempting'
    this.emitChanged()
    const ref = { realm: opportunity.realm, listingId: opportunity.listingId, queryId: opportunity.searchCode, sourceUrl: target.search.canonicalUrl }
    try {
      const result = await this.manager.visitHideout(ref)
      if (!result.ok) {
        opportunity.status = 'error'
        this.emitChanged()
        return 'game-offline'
      }
      opportunity.status = 'attempted'
      opportunity.attemptedAt = new Date().toISOString()
      this.scheduleSave()
      this.emitChanged()
      return 'attempted'
    } catch (error) {
      const message = error instanceof Error ? error.message.toLowerCase() : ''
      const unavailable = message.includes('hideout token') || message.includes('listing') && message.includes('not')
      opportunity.status = unavailable ? 'unavailable' : 'error'
      this.scheduleSave()
      this.emitChanged()
      return unavailable ? 'unavailable' : 'error'
    }
  }

  private syncAll(): void {
    for (const realm of ['cn', 'global'] as const) this.syncRealm(realm)
  }

  private syncRealm(realm: MarketRealm): void {
    const configs = this.globalPaused ? [] : this.purchaseTargets
      .filter((target) => target.search.realm === realm && target.status === 'armed')
      .slice(0, 20)
      .map((target) => ({ searchId: target.id, realm, liveUrl: liveUrl(target) }))
    if (configs.length) this.manager.ensureMonitoringView(realm)
    this.manager.sendMonitorSync(realm, configs)
    const active = new Set(configs.map((config) => config.searchId))
    for (const target of this.purchaseTargets.filter((candidate) => candidate.search.realm === realm)) {
      if (!active.has(target.id)) this.runtime.set(target.id, this.disabledRuntime(target.id))
      else if (!this.runtime.has(target.id) || this.runtime.get(target.id)?.connectionStatus === 'disabled') {
        this.runtime.set(target.id, { ...this.disabledRuntime(target.id), connectionStatus: 'connecting' })
      }
    }
  }

  private async flushBurst(): Promise<void> {
    this.burstTimer = undefined
    const entries = [...this.burst.values()]
    this.burst.clear()
    const detectedAt = new Date().toISOString()
    const created: MarketOpportunity[] = []
    const prefetchedPayloads = new Map<string, unknown>()
    for (const entry of entries) {
      const batchId = randomUUID()
      const batchOpportunityIds: string[] = []
      const addOpportunity = (listingId: string, prefetchedPayload?: unknown, alreadyReserved = false) => {
        const key = `${entry.target.search.realm}:${entry.target.search.searchCode}:${listingId}`
        if (!alreadyReserved) {
          if (this.dedupe.has(key)) return
          this.dedupe.set(key, Date.now())
        }
        const opportunity: MarketOpportunity = {
          id: randomUUID(), targetId: entry.target.id, batchId, searchId: entry.target.sourceSearchId || entry.target.id,
          realm: entry.target.search.realm, leagueId: entry.target.search.leagueId, searchCode: entry.target.search.searchCode,
          listingId, status: 'detected', detectedAt,
        }
        this.opportunities.push(opportunity)
        created.push(opportunity)
        batchOpportunityIds.push(opportunity.id)
        if (prefetchedPayload) prefetchedPayloads.set(opportunity.id, prefetchedPayload)
      }
      for (const token of [...entry.resultTokens].slice(0, 100)) {
        try {
          const payload = await this.manager.fetchLiveResult(entry.target.search.realm, token, entry.target.search.searchCode)
          const root = payload && typeof payload === 'object' ? payload as { result?: unknown } : {}
          const results = Array.isArray(root.result) ? root.result : []
          for (const result of results.slice(0, 100)) {
            const listingId = result && typeof result === 'object' && typeof (result as { id?: unknown }).id === 'string'
              ? (result as { id: string }).id : ''
            if (LIVE_ID.test(listingId)) addOpportunity(listingId, payload)
          }
        } catch {
          const runtime = this.runtime.get(entry.target.id) || this.disabledRuntime(entry.target.id)
          runtime.lastErrorCode = 'live-fetch-failed'
          this.runtime.set(entry.target.id, runtime)
        }
      }
      for (const listingId of [...entry.listingIds].slice(0, 100)) {
        addOpportunity(listingId, undefined, true)
      }
      if (batchOpportunityIds.length) this.batches.push({ id: batchId, targetId: entry.target.id, detectedAt, opportunityIds: batchOpportunityIds })
      const runtime = this.runtime.get(entry.target.id) || this.disabledRuntime(entry.target.id)
      runtime.lastOpportunityAt = detectedAt
      runtime.pendingOpportunityCount += batchOpportunityIds.length
      this.runtime.set(entry.target.id, runtime)
    }
    this.trimHistory()
    this.scheduleSave()
    this.emitChanged()

    const actionable: MarketOpportunity[] = []
    for (const entry of entries) {
      const candidates = created.filter((opportunity) => opportunity.targetId === entry.target.id).slice(0, 30)
      for (const candidate of candidates) candidate.status = 'fetching'
      this.emitChanged()
      const applyPayload = (candidate: MarketOpportunity, payload: unknown) => {
        try {
          const normalized = normalizeMarketListing(payload, {
            realm: candidate.realm, listingId: candidate.listingId, queryId: candidate.searchCode, sourceUrl: entry.target.search.canonicalUrl,
          })
          candidate.status = 'actionable'
          candidate.fetchedAt = new Date().toISOString()
          candidate.item = {
            name: normalized.item.name, baseType: normalized.item.baseType, rarity: normalized.item.rarity,
            iconUrl: normalized.item.iconUrl, price: normalized.source.price?.display,
            itemLevel: normalized.item.itemLevel, quality: normalized.item.quality, sockets: normalized.item.sockets,
            corrupted: normalized.item.corrupted, identified: normalized.item.identified,
            modifiers: normalized.item.modifiers,
          }
          actionable.push(candidate)
        } catch { candidate.status = 'unavailable' }
      }
      for (const candidate of candidates.filter((item) => prefetchedPayloads.has(item.id))) {
        applyPayload(candidate, prefetchedPayloads.get(candidate.id))
      }
      const fetchCandidates = candidates.filter((item) => !prefetchedPayloads.has(item.id))
      for (let index = 0; index < fetchCandidates.length; index += 10) {
        const batch = fetchCandidates.slice(index, index + 10)
        try {
          const payload = await this.manager.fetchListings(entry.target.search.realm, batch.map((candidate) => candidate.listingId), entry.target.search.searchCode)
          for (const candidate of batch) applyPayload(candidate, payload)
        } catch {
          for (const candidate of batch) candidate.status = 'error'
        }
        this.scheduleSave()
        this.emitChanged()
        if (actionable.length) this.callbacks.actionable(this.sortForAction(actionable))
      }
      if (!fetchCandidates.length && actionable.length) {
        this.scheduleSave()
        this.emitChanged()
        this.callbacks.actionable(this.sortForAction(actionable))
      }
    }
  }

  private sortForAction(opportunities: MarketOpportunity[]): MarketOpportunity[] {
    const targets = new Map(this.purchaseTargets.map((target) => [target.id, target]))
    const sorted = [...opportunities].sort((left, right) => {
      const priority = PRIORITY_SCORE[targets.get(right.targetId)?.priority || 'normal'] - PRIORITY_SCORE[targets.get(left.targetId)?.priority || 'normal']
      return priority || right.detectedAt.localeCompare(left.detectedAt) || left.listingId.localeCompare(right.listingId)
    })
    const queues = new Map<string, MarketOpportunity[]>()
    for (const opportunity of sorted) {
      const queue = queues.get(opportunity.targetId) || []
      queue.push(opportunity)
      queues.set(opportunity.targetId, queue)
    }
    const targetOrder = [...queues.keys()].sort((left, right) => {
      const priority = PRIORITY_SCORE[targets.get(right)?.priority || 'normal'] - PRIORITY_SCORE[targets.get(left)?.priority || 'normal']
      return priority || left.localeCompare(right)
    })
    const result: MarketOpportunity[] = []
    while (result.length < sorted.length) {
      for (const searchId of targetOrder) {
        const next = queues.get(searchId)?.shift()
        if (next) result.push(next)
      }
    }
    return result
  }

  private sortedOpportunities(): MarketOpportunity[] {
    return [...this.opportunities].sort((left, right) => right.detectedAt.localeCompare(left.detectedAt))
  }

  private setOpportunityStatus(id: string, status: MarketOpportunity['status']): void {
    const opportunity = this.opportunities.find((candidate) => candidate.id === id)
    if (!opportunity) return
    for (const candidate of this.opportunities) {
      if (candidate.realm === opportunity.realm && candidate.listingId === opportunity.listingId) candidate.status = status
    }
    this.scheduleSave()
    this.emitChanged()
  }

  private expireOld(): void {
    const cutoff = Date.now() - 120_000
    let changed = false
    for (const opportunity of this.opportunities) {
      if (['detected', 'fetching', 'actionable', 'error'].includes(opportunity.status) && Date.parse(opportunity.detectedAt) < cutoff) {
        opportunity.status = 'expired'
        changed = true
      }
    }
    if (changed) {
      this.scheduleSave()
      this.emitChanged()
    }
  }

  private pruneDedupe(now: number): void {
    const cutoff = now - 86_400_000
    for (const [key, timestamp] of this.dedupe) if (timestamp < cutoff) this.dedupe.delete(key)
    while (this.dedupe.size > 5_000) this.dedupe.delete(this.dedupe.keys().next().value as string)
  }

  private trimHistory(): void {
    const cutoff = Date.now() - 86_400_000
    this.opportunities = this.sortedOpportunities().filter((opportunity) => Date.parse(opportunity.detectedAt) >= cutoff).slice(0, MAX_OPPORTUNITIES)
    const retained = new Set(this.opportunities.map((opportunity) => opportunity.id))
    this.batches = this.batches.map((batch) => ({ ...batch, opportunityIds: batch.opportunityIds.filter((id) => retained.has(id)) }))
      .filter((batch) => batch.opportunityIds.length).slice(-200)
  }

  private disabledRuntime(targetId: string): MonitorRuntimeState {
    return { targetId, searchId: targetId, connectionStatus: 'disabled', retryAttempt: 0, pendingOpportunityCount: 0 }
  }

  private emitChanged(): void {
    this.callbacks.changed(this.snapshot())
  }

  private load(): void {
    const loadFile = (candidatePath: string): boolean => {
      if (!existsSync(candidatePath)) return false
      try {
        const parsed = JSON.parse(readFileSync(candidatePath, 'utf8')) as Partial<MonitoringFile>
        if (parsed.schemaVersion !== 1 && parsed.schemaVersion !== 2) return false
        this.purchaseTargets = Array.isArray(parsed.purchaseTargets) ? parsed.purchaseTargets : []
        this.batches = Array.isArray(parsed.batches) ? parsed.batches : []
        this.opportunities = Array.isArray(parsed.opportunities) ? parsed.opportunities.filter(isOpportunity).slice(0, MAX_OPPORTUNITIES) : []
        this.settings = { ...DEFAULT_SETTINGS, ...(parsed.settings && typeof parsed.settings === 'object' ? parsed.settings : {}) }
        if (!SOUND_IDS.includes(this.settings.soundId)) this.settings.soundId = DEFAULT_SETTINGS.soundId
        this.globalPaused = parsed.globalPaused === true
        this.trimHistory()
        this.scheduleSave()
        return true
      } catch { return false }
    }
    if (!loadFile(this.filePath)) loadFile(`${this.filePath}.backup.json`)
  }

  private scheduleSave(): void {
    if (this.saveTimer) return
    this.saveTimer = setTimeout(() => {
      this.saveTimer = undefined
      this.saveNow()
    }, 100)
  }

  private saveNow(): void {
    try {
      const directory = path.dirname(this.filePath)
      mkdirSync(directory, { recursive: true })
      const temporaryPath = `${this.filePath}.tmp`
      const backupPath = `${this.filePath}.backup.json`
      const file: MonitoringFile = {
        schemaVersion: 2, purchaseTargets: this.purchaseTargets, batches: this.batches,
        opportunities: this.opportunities, settings: this.settings,
        globalPaused: this.globalPaused, updatedAt: new Date().toISOString(),
      }
      if (existsSync(this.filePath)) copyFileSync(this.filePath, backupPath)
      writeFileSync(temporaryPath, JSON.stringify(file, null, 2), { encoding: 'utf8', mode: 0o600, flush: true })
      renameSync(temporaryPath, this.filePath)
    } catch { /* Persistence failure must not stop live monitoring. */ }
  }

  private searchReference(search: SavedMarketSearch): PurchaseTarget['search'] {
    return {
      realm: search.realm, leagueId: search.leagueId, searchCode: search.searchCode,
      canonicalUrl: search.canonicalUrl, captureSource: search.captureSource,
      ...(search.querySnapshot ? { querySnapshot: structuredClone(search.querySnapshot) } : {}),
    }
  }

  private migrateLegacyTargets(): void {
    const searches = this.library.sidebarSnapshot().searches
    const bySearch = new Map(searches.map((search) => [search.id, search]))
    const now = new Date().toISOString()
    for (const opportunity of this.opportunities) {
      if (!opportunity.targetId) opportunity.targetId = opportunity.searchId
      if (!opportunity.batchId) opportunity.batchId = `legacy:${opportunity.detectedAt}:${opportunity.targetId}`
    }
    if (!this.batches.length) {
      const groups = new Map<string, OpportunityBatch>()
      for (const opportunity of this.opportunities) {
        const batch = groups.get(opportunity.batchId) || { id: opportunity.batchId, targetId: opportunity.targetId, detectedAt: opportunity.detectedAt, opportunityIds: [] }
        batch.opportunityIds.push(opportunity.id)
        groups.set(batch.id, batch)
      }
      this.batches = [...groups.values()]
    }
    for (const search of searches) {
      if (search.monitorStatus === 'saved' || this.purchaseTargets.some((target) => target.sourceSearchId === search.id)) continue
      const status: PurchaseTargetStatus = search.monitorStatus === 'completed' ? 'completed' : search.monitorStatus === 'paused' ? 'paused' : 'armed'
      this.purchaseTargets.push({
        id: search.id, sourceSearchId: search.id, sourceSearchUpdatedAt: search.updatedAt,
        name: search.name, note: search.note, status, priority: search.monitorPriority,
        search: this.searchReference(search), createdAt: search.createdAt, updatedAt: now,
        statusChangedAt: search.monitorStatusChangedAt || now,
      })
    }
    this.purchaseTargets = this.purchaseTargets.filter((target) => target.search && target.id && target.name)
    for (const target of this.purchaseTargets) {
      const source = target.sourceSearchId ? bySearch.get(target.sourceSearchId) : undefined
      if (!target.sourceSearchUpdatedAt && source) target.sourceSearchUpdatedAt = source.updatedAt
    }
    this.scheduleSave()
  }
}

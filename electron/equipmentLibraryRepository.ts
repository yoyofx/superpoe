import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import type {
  EquipmentLibraryEntry,
  EquipmentLibraryFilter,
  EquipmentLibraryFolder,
  EquipmentLibraryFolderInput,
  EquipmentLibraryFolderPatch,
  EquipmentLibraryMetadataPatch,
  EquipmentLibrarySidebarSnapshot,
  EquipmentLibrarySource,
  CanonicalEquipmentItem,
  CanonicalItemView,
  LibraryItemSnapshot,
  LibraryTreeScope,
  MarketFavoriteState,
  MarketRealm,
  SavedMarketSearch,
  SavedMarketSearchRecordInput,
  SavedMarketSearchPatch,
} from '../src/types/market.js'
import type { NormalizedPobItem, PobItemBridge } from './pobItemBridge.js'
import { createSearchQuerySnapshot, parseOfficialSearchUrl, withSearchSnapshot } from './marketSearch.js'

interface EquipmentLibraryFile {
  schemaVersion: 2
  entries: PersistedEquipmentLibraryEntry[]
  unresolvedLegacyEntries?: unknown[]
  folders?: EquipmentLibraryFolder[]
  searches?: SavedMarketSearch[]
  selectedFolders?: Partial<Record<LibraryTreeScope, string>>
  updatedAt: string
}

type PersistedEquipmentLibraryEntry = Omit<EquipmentLibraryEntry, 'view'>

interface LegacyEquipmentLibraryFile {
  schemaVersion: 1
  entries: LegacyEquipmentLibraryEntry[]
  folders?: EquipmentLibraryFolder[]
  searches?: SavedMarketSearch[]
  selectedFolders?: Partial<Record<LibraryTreeScope, string>>
}

type LegacyEquipmentLibraryEntry = Omit<EquipmentLibraryEntry, 'schemaVersion' | 'item' | 'view'> & {
  schemaVersion: 1
  item: LibraryItemSnapshot
}

const MAX_ENTRIES = 5_000
const MAX_TEXT = 100_000
const MAX_NOTE = 4_000
const MAX_TAGS = 32
const MAX_TAG_LENGTH = 64
const MAX_FOLDERS = 1_000
const MAX_SEARCHES = 5_000

function normalizeText(value: string | undefined, maxLength: number): string | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim()
  if (!normalized) return undefined
  return normalized.slice(0, maxLength)
}

function normalizeTags(tags: string[] | undefined): string[] {
  if (!Array.isArray(tags)) return []
  return [...new Set(tags.map((tag) => normalizeText(tag, MAX_TAG_LENGTH)).filter((tag): tag is string => !!tag))].slice(0, MAX_TAGS)
}

export function fingerprintLibraryItem(item: CanonicalEquipmentItem): string {
  return createHash('sha256').update(item.raw.replace(/\r\n/g, '\n').trim()).digest('hex')
}

export function marketSourceKey(realm: MarketRealm, listingId: string): string {
  return `market:${realm}:${listingId}`
}

export function equipmentSourceKey(buildId: string, equipmentSetId: string, itemId: string): string {
  return `equipment:${buildId}:${equipmentSetId}:${itemId}`
}

export function pobSourceKey(buildId: string, pobItemId: string): string {
  return `pob:${buildId}:${pobItemId}`
}

function isLegacyLibraryItem(value: unknown): value is LibraryItemSnapshot {
  if (!value || typeof value !== 'object') return false
  const item = value as Partial<LibraryItemSnapshot>
  return typeof item.rarity === 'string'
    && typeof item.name === 'string'
    && typeof item.baseType === 'string'
    && Array.isArray(item.modifiers)
    && item.modifiers.length <= 128
}

function isLegacyLibraryEntry(value: unknown): value is LegacyEquipmentLibraryEntry {
  if (!value || typeof value !== 'object') return false
  const entry = value as Partial<LegacyEquipmentLibraryEntry>
  return entry.schemaVersion === 1
    && typeof entry.id === 'string'
    && typeof entry.fingerprint === 'string'
    && isLegacyLibraryItem(entry.item)
    && Array.isArray(entry.sources)
    && Array.isArray(entry.tags)
    && typeof entry.archived === 'boolean'
    && typeof entry.createdAt === 'string'
    && typeof entry.updatedAt === 'string'
}

function isCanonicalItem(value: unknown): value is CanonicalEquipmentItem {
  const item = value as Partial<CanonicalEquipmentItem> | null
  return !!item && item.format === 'pob2-item' && typeof item.raw === 'string' && item.raw.length > 0 && item.raw.length <= MAX_TEXT
}

function deriveItemView(item: CanonicalEquipmentItem): CanonicalItemView {
  const lines = item.raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  const rarity = lines[0]?.replace(/^Rarity:\s*/i, '') || 'NORMAL'
  const metadata = /^(?:Unique ID|League|Unreleased|Crafted|Prefix|Suffix|Catalyst|CatalystQuality|Cluster Jewel|Talisman Tier|Item Level|Quality|Sockets|Rune|LevelReq|Radius|Limited to|Requires Class|Implicits):/i
  const title = lines[1] || 'Unknown item'
  const baseType = lines[2] && !metadata.test(lines[2]) ? lines[2] : title
  const value = (label: string) => Number(lines.find((line) => line.startsWith(label))?.slice(label.length).trim())
  const implicitAt = lines.findIndex((line) => /^Implicits:\s*\d+/i.test(line))
  const implicitCount = implicitAt >= 0 ? Number(lines[implicitAt].match(/\d+/)?.[0] || 0) : 0
  const modifierLines = implicitAt >= 0 ? lines.slice(implicitAt + 1).filter((line) => !/^(?:Mirrored|Sanctified|Twice Corrupted|Corrupted)$/i.test(line)) : []
  return {
    rarity,
    name: title,
    baseType,
    ...(Number.isFinite(value('Item Level:')) ? { itemLevel: value('Item Level:') } : {}),
    ...(Number.isFinite(value('Quality:')) ? { quality: value('Quality:') } : {}),
    ...(lines.find((line) => line.startsWith('Sockets:'))?.slice(8).trim() ? { sockets: lines.find((line) => line.startsWith('Sockets:'))!.slice(8).trim() } : {}),
    corrupted: lines.some((line) => /^(?:Twice Corrupted|Corrupted)$/i.test(line)),
    identified: true,
    modifiers: modifierLines.map((rawLine, index) => {
      const tags = [...rawLine.matchAll(/\{([^}:,]+)(?::[^}]*)?\}/g)].map((match) => match[1].toLowerCase())
      const group = tags.includes('rune') ? 'rune' : tags.includes('enchant') ? 'enchant' : index < implicitCount ? 'implicit' : 'explicit'
      return {
        id: `${group}-${index}`,
        displayOrder: index,
        group,
        sourceTags: tags.filter((tag): tag is CanonicalItemView['modifiers'][number]['sourceTags'][number] => ['rune', 'enchant', 'implicit', 'explicit', 'fractured', 'crafted', 'desecrated', 'mutated', 'corrupted'].includes(tag)),
        text: rawLine.replace(/\{[^}]+\}/g, '').trim(),
        tradeStatIds: [],
      }
    }),
  }
}

function isPersistedLibraryEntry(value: unknown): value is PersistedEquipmentLibraryEntry {
  if (!value || typeof value !== 'object') return false
  const entry = value as Partial<PersistedEquipmentLibraryEntry>
  return entry.schemaVersion === 2 && typeof entry.id === 'string' && typeof entry.fingerprint === 'string'
    && isCanonicalItem(entry.item) && Array.isArray(entry.sources) && Array.isArray(entry.tags)
    && typeof entry.archived === 'boolean' && typeof entry.createdAt === 'string' && typeof entry.updatedAt === 'string'
}

function hydrateEntry(entry: PersistedEquipmentLibraryEntry): EquipmentLibraryEntry {
  const view = deriveItemView(entry.item)
  const displays = [...entry.sources].reverse().flatMap((source) => source.display ? [source.display] : [])
  const iconDisplay = displays.find((display) => display.iconUrl)
  const localizedDisplay = displays.find((display) => display.locale !== 'en' && display.locale !== 'unknown')
  if (iconDisplay?.iconUrl) view.iconUrl = iconDisplay.iconUrl
  if (localizedDisplay) {
      view.localized = { [localizedDisplay.locale]: { name: localizedDisplay.name, baseType: localizedDisplay.baseType } }
      localizedDisplay.modifiers?.forEach((text, index) => {
        if (view.modifiers[index]) view.modifiers[index].localized = { [localizedDisplay.locale]: text }
      })
  }
  return { ...entry, view }
}

export class EquipmentLibraryRepository {
  private entries: EquipmentLibraryEntry[] = []
  private folders: EquipmentLibraryFolder[] = []
  private searches: SavedMarketSearch[] = []
  private selectedFolders: Partial<Record<LibraryTreeScope, string>> = {}
  private unresolvedLegacyEntries: unknown[] = []

  constructor(private readonly filePath: string, private readonly legacyFilePath?: string) {
    this.load()
  }

  list(filter: EquipmentLibraryFilter = {}): EquipmentLibraryEntry[] {
    const query = filter.query?.trim().toLocaleLowerCase()
    return this.entries
      .filter((entry) => filter.includeArchived || !entry.archived)
      .filter((entry) => !filter.realm || entry.sources.some((source) => 'realm' in source && source.realm === filter.realm))
      .filter((entry) => !filter.sourceKind || filter.sourceKind === 'all' || entry.sources.some((source) => source.kind === filter.sourceKind))
      .filter((entry) => !query || [entry.view.name, entry.view.baseType, ...entry.view.modifiers.map((modifier) => modifier.text), entry.folder, this.folderName(entry.folderId), entry.note, ...entry.tags]
        .some((value) => value?.toLocaleLowerCase().includes(query)))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map((entry) => structuredClone(entry))
  }

  get(id: string): EquipmentLibraryEntry | undefined {
    const entry = this.entries.find((candidate) => candidate.id === id)
    return entry ? structuredClone(entry) : undefined
  }

  upsert(normalized: NormalizedPobItem, source: EquipmentLibrarySource): EquipmentLibraryEntry {
    if (!isCanonicalItem(normalized.item)) throw new Error('Invalid canonical equipment item')
    const fingerprint = fingerprintLibraryItem(normalized.item)
    const now = new Date().toISOString()
    let entry = this.entries.find((candidate) => candidate.sources.some((existing) => existing.sourceKey === source.sourceKey))
    entry ||= this.entries.find((candidate) => candidate.fingerprint === fingerprint)

    if (entry) {
      entry.item = structuredClone(normalized.item)
      entry.view = structuredClone(normalized.view)
      entry.fingerprint = fingerprint
      const sourceIndex = entry.sources.findIndex((existing) => existing.sourceKey === source.sourceKey)
      if (sourceIndex >= 0) entry.sources[sourceIndex] = structuredClone(source)
      else entry.sources.push(structuredClone(source))
      entry.updatedAt = now
    } else {
      if (this.entries.length >= MAX_ENTRIES) throw new Error('Equipment library limit reached')
      entry = {
        schemaVersion: 2,
        id: randomUUID(),
        fingerprint,
        item: structuredClone(normalized.item),
        view: structuredClone(normalized.view),
        sources: [structuredClone(source)],
        ...(this.selectedFolders.items ? { folderId: this.selectedFolders.items } : {}),
        tags: [],
        archived: false,
        createdAt: now,
        updatedAt: now,
      }
      this.entries.push(entry)
    }

    this.save()
    return structuredClone(entry)
  }

  removeSource(sourceKey: string): { removedEntryId?: string; entry?: EquipmentLibraryEntry } {
    const entry = this.entries.find((candidate) => candidate.sources.some((source) => source.sourceKey === sourceKey))
    if (!entry) return {}
    entry.sources = entry.sources.filter((source) => source.sourceKey !== sourceKey)
    if (!entry.sources.length && !entry.folderId && !entry.folder && !entry.tags.length && !entry.note && !entry.archived) {
      this.entries = this.entries.filter((candidate) => candidate.id !== entry.id)
      this.save()
      return { removedEntryId: entry.id }
    }
    entry.updatedAt = new Date().toISOString()
    this.save()
    return { entry: structuredClone(entry) }
  }

  delete(id: string): boolean {
    const before = this.entries.length
    this.entries = this.entries.filter((entry) => entry.id !== id)
    if (this.entries.length === before) return false
    this.save()
    return true
  }

  deleteMany(ids: string[]): number {
    const selectedIds = new Set(ids)
    if (!selectedIds.size) return 0
    const before = this.entries.length
    this.entries = this.entries.filter((entry) => !selectedIds.has(entry.id))
    const deleted = before - this.entries.length
    if (deleted) this.save()
    return deleted
  }

  updateMetadata(patch: EquipmentLibraryMetadataPatch): EquipmentLibraryEntry {
    const entry = this.entries.find((candidate) => candidate.id === patch.id)
    if (!entry) throw new Error('Equipment library entry not found')
    if ('folderId' in patch) {
      if (patch.folderId == null) entry.folderId = undefined
      else {
        this.requireFolder(patch.folderId, 'items')
        entry.folderId = patch.folderId
      }
      entry.folder = undefined
    }
    if ('folder' in patch) entry.folder = normalizeText(patch.folder, 120)
    if ('note' in patch) entry.note = normalizeText(patch.note, MAX_NOTE)
    if ('tags' in patch) entry.tags = normalizeTags(patch.tags)
    if (typeof patch.archived === 'boolean') entry.archived = patch.archived
    entry.updatedAt = new Date().toISOString()
    this.save()
    return structuredClone(entry)
  }

  updateItem(id: string, normalized: NormalizedPobItem, options: { touchUpdatedAt?: boolean } = {}): EquipmentLibraryEntry {
    if (!isCanonicalItem(normalized.item)) throw new Error('Invalid canonical equipment item')
    const entry = this.entries.find((candidate) => candidate.id === id)
    if (!entry) throw new Error('Equipment library entry not found')
    entry.item = structuredClone(normalized.item)
    entry.view = structuredClone(normalized.view)
    entry.fingerprint = fingerprintLibraryItem(normalized.item)
    if (options.touchUpdatedAt !== false) entry.updatedAt = new Date().toISOString()
    this.save()
    return structuredClone(entry)
  }

  marketStates(realm: MarketRealm, listingIds: string[]): MarketFavoriteState[] {
    const active = new Set(this.entries.flatMap((entry) => entry.sources.flatMap((source) => (
      source.kind === 'market-favorite' && source.realm === realm ? [source.listingId] : []
    ))))
    return [...new Set(listingIds)].slice(0, 250).map((listingId) => ({ listingId, active: active.has(listingId) }))
  }

  count(): number {
    return this.entries.length
  }

  sidebarSnapshot(): EquipmentLibrarySidebarSnapshot {
    return structuredClone({
      folders: [...this.folders].sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt.localeCompare(b.createdAt)),
      searches: [...this.searches].sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt.localeCompare(b.createdAt)),
      ...(this.selectedFolders.items ? { selectedItemFolderId: this.selectedFolders.items } : {}),
      ...(this.selectedFolders.searches ? { selectedSearchFolderId: this.selectedFolders.searches } : {}),
    })
  }

  createFolder(input: EquipmentLibraryFolderInput): EquipmentLibraryFolder {
    if (this.folders.length >= MAX_FOLDERS) throw new Error('Equipment library folder limit reached')
    const name = normalizeText(input.name, 120)
    if (!name) throw new Error('Folder name is required')
    if (input.scope !== 'items' && input.scope !== 'searches') throw new Error('Invalid folder scope')
    if (input.parentId) this.requireFolder(input.parentId, input.scope)
    const now = new Date().toISOString()
    const folder: EquipmentLibraryFolder = {
      id: randomUUID(), scope: input.scope, name,
      ...(input.parentId ? { parentId: input.parentId } : {}),
      sortOrder: this.siblingFolders(input.scope, input.parentId).length,
      expanded: true, createdAt: now, updatedAt: now,
    }
    this.folders.push(folder)
    this.selectedFolders[input.scope] = folder.id
    this.save()
    return structuredClone(folder)
  }

  updateFolder(patch: EquipmentLibraryFolderPatch): EquipmentLibraryFolder {
    const folder = this.folders.find((candidate) => candidate.id === patch.id)
    if (!folder) throw new Error('Equipment library folder not found')
    const previousParentId = folder.parentId
    if ('name' in patch) {
      const name = normalizeText(patch.name, 120)
      if (!name) throw new Error('Folder name is required')
      folder.name = name
    }
    if ('parentId' in patch) {
      if (patch.parentId == null) folder.parentId = undefined
      else {
        const parent = this.requireFolder(patch.parentId, folder.scope)
        if (parent.id === folder.id || this.descendantFolderIds(folder.id).has(parent.id)) throw new Error('A folder cannot be moved into itself')
        folder.parentId = parent.id
      }
    }
    if ('beforeId' in patch || previousParentId !== folder.parentId) {
      this.placeFolder(folder, patch.beforeId)
      if (previousParentId !== folder.parentId) this.normalizeSiblingOrder(folder.scope, previousParentId)
    }
    if (typeof patch.expanded === 'boolean') folder.expanded = patch.expanded
    folder.updatedAt = new Date().toISOString()
    this.save()
    return structuredClone(folder)
  }

  deleteFolder(id: string): boolean {
    const folder = this.folders.find((candidate) => candidate.id === id)
    if (!folder) return false
    this.folders = this.folders.filter((candidate) => candidate.id !== id)
    for (const child of this.folders) {
      if (child.parentId === id) child.parentId = folder.parentId
    }
    for (const entry of this.entries) {
      if (entry.folderId === id) entry.folderId = folder.parentId
    }
    for (const search of this.searches) {
      if (search.folderId === id) search.folderId = folder.parentId
    }
    this.normalizeSearchOrder(id)
    this.normalizeSearchOrder(folder.parentId)
    if (this.selectedFolders[folder.scope] === id) {
      if (folder.parentId) this.selectedFolders[folder.scope] = folder.parentId
      else delete this.selectedFolders[folder.scope]
    }
    this.normalizeSiblingOrder(folder.scope, folder.parentId)
    this.save()
    return true
  }

  selectFolder(scope: LibraryTreeScope, folderId?: string): EquipmentLibrarySidebarSnapshot {
    if (scope !== 'items' && scope !== 'searches') throw new Error('Invalid folder scope')
    if (folderId) {
      this.requireFolder(folderId, scope)
      this.selectedFolders[scope] = folderId
    } else delete this.selectedFolders[scope]
    this.save()
    return this.sidebarSnapshot()
  }

  saveSearch(input: SavedMarketSearchRecordInput): SavedMarketSearch {
    const name = normalizeText(input.name, 160) || 'Saved search'
    const note = normalizeText(input.note, MAX_NOTE)
    if (input.folderId) this.requireFolder(input.folderId, 'searches')
    const exact = this.searches.find((search) => search.realm === input.realm
      && search.leagueId === input.leagueId && search.searchCode === input.searchCode)
    if (exact) {
      if (input.querySnapshot && exact.querySnapshot?.hash !== input.querySnapshot.hash) {
        exact.captureSource = input.captureSource
        exact.querySnapshot = structuredClone(input.querySnapshot)
        exact.validity = 'valid'
        exact.checkedAt = new Date().toISOString()
        exact.updatedAt = exact.checkedAt
        this.save()
      }
      return structuredClone(exact)
    }
    const sameQuery = input.querySnapshot && this.searches.find((search) => search.realm === input.realm
      && search.leagueId === input.leagueId && search.querySnapshot?.hash === input.querySnapshot?.hash)
    if (sameQuery) {
      Object.assign(sameQuery, {
        leagueId: input.leagueId,
        searchCode: input.searchCode,
        canonicalUrl: input.canonicalUrl,
        captureSource: input.captureSource,
        querySnapshot: structuredClone(input.querySnapshot),
        validity: 'valid' as const,
        checkedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })
      this.save()
      return structuredClone(sameQuery)
    }
    if (this.searches.length >= MAX_SEARCHES) throw new Error('Saved search limit reached')
    const now = new Date().toISOString()
    const folderId = input.folderId || this.selectedFolders.searches
    const search: SavedMarketSearch = {
      id: randomUUID(), realm: input.realm, leagueId: input.leagueId, searchCode: input.searchCode,
      canonicalUrl: input.canonicalUrl, captureSource: input.captureSource,
      ...(input.querySnapshot ? { querySnapshot: structuredClone(input.querySnapshot) } : {}),
      validity: 'valid', checkedAt: now, name,
      ...(note ? { note } : {}),
      ...(folderId ? { folderId } : {}),
      sortOrder: this.siblingSearches(folderId).length,
      monitorStatus: 'saved', monitorPriority: 'normal', monitorStatusChangedAt: now,
      createdAt: now, updatedAt: now,
    }
    this.searches.push(search)
    this.save()
    return structuredClone(search)
  }

  updateSearch(patch: SavedMarketSearchPatch): SavedMarketSearch {
    const search = this.searches.find((candidate) => candidate.id === patch.id)
    if (!search) throw new Error('Saved search not found')
    if ('name' in patch) search.name = normalizeText(patch.name, 160) || search.name
    if ('note' in patch) search.note = normalizeText(patch.note, MAX_NOTE)
    if ('folderId' in patch) {
      const previousFolderId = search.folderId
      if (patch.folderId == null) search.folderId = undefined
      else {
        this.requireFolder(patch.folderId, 'searches')
        search.folderId = patch.folderId
      }
      if (previousFolderId !== search.folderId) {
        this.placeSearch(search, patch.beforeId)
        this.normalizeSearchOrder(previousFolderId)
      } else if ('beforeId' in patch) this.placeSearch(search, patch.beforeId)
    } else if ('beforeId' in patch) {
      this.placeSearch(search, patch.beforeId)
    }
    if (patch.monitorStatus && ['saved', 'armed', 'paused', 'completed'].includes(patch.monitorStatus)) {
      if (patch.monitorStatus === 'armed' && (search.validity === 'invalid' || !search.leagueId || !search.searchCode)) {
        throw new Error('Invalid searches cannot be monitored')
      }
      if (search.monitorStatus !== patch.monitorStatus) search.monitorStatusChangedAt = new Date().toISOString()
      search.monitorStatus = patch.monitorStatus
    }
    if (patch.monitorPriority && ['high', 'normal', 'low'].includes(patch.monitorPriority)) search.monitorPriority = patch.monitorPriority
    search.updatedAt = new Date().toISOString()
    this.save()
    return structuredClone(search)
  }

  replaceSearchReference(id: string, input: SavedMarketSearchRecordInput): SavedMarketSearch {
    const search = this.searches.find((candidate) => candidate.id === id)
    if (!search) throw new Error('Saved search not found')
    const duplicate = this.searches.find((candidate) => candidate.id !== id && candidate.realm === input.realm
      && candidate.leagueId === input.leagueId && candidate.searchCode === input.searchCode)
    if (duplicate) throw new Error('This search is already saved')
    const now = new Date().toISOString()
    Object.assign(search, {
      realm: input.realm,
      leagueId: input.leagueId,
      searchCode: input.searchCode,
      canonicalUrl: input.canonicalUrl,
      captureSource: input.captureSource,
      querySnapshot: input.querySnapshot ? structuredClone(input.querySnapshot) : undefined,
      validity: 'valid' as const,
      checkedAt: now,
      updatedAt: now,
    })
    this.save()
    return structuredClone(search)
  }

  getSearch(id: string): SavedMarketSearch | undefined {
    const search = this.searches.find((candidate) => candidate.id === id)
    return search ? structuredClone(search) : undefined
  }

  deleteSearch(id: string): boolean {
    const search = this.searches.find((candidate) => candidate.id === id)
    if (!search) return false
    const before = this.searches.length
    this.searches = this.searches.filter((candidate) => candidate.id !== id)
    if (before === this.searches.length) return false
    this.normalizeSearchOrder(search.folderId)
    this.save()
    return true
  }

  async migrateLegacy(bridge: PobItemBridge): Promise<{ migrated: number; unresolved: number }> {
    if (existsSync(this.filePath) || !this.legacyFilePath || !existsSync(this.legacyFilePath)) {
      return { migrated: 0, unresolved: this.unresolvedLegacyEntries.length }
    }
    const raw = readFileSync(this.legacyFilePath, 'utf8')
    if (raw.length > 50_000_000) throw new Error('Legacy equipment library file is too large')
    const legacy = JSON.parse(raw) as Partial<LegacyEquipmentLibraryFile>
    if (legacy.schemaVersion !== 1 || !Array.isArray(legacy.entries)) throw new Error('Unsupported legacy equipment library schema')
    this.folders = Array.isArray(legacy.folders) ? legacy.folders.filter((folder): folder is EquipmentLibraryFolder => this.isFolder(folder)).slice(0, MAX_FOLDERS) : []
    this.searches = Array.isArray(legacy.searches) ? legacy.searches.flatMap((search) => this.normalizeLoadedSearch(search)).slice(0, MAX_SEARCHES) : []
    this.selectedFolders = legacy.selectedFolders && typeof legacy.selectedFolders === 'object' ? legacy.selectedFolders : {}
    let migrated = 0
    this.unresolvedLegacyEntries = []
    for (const candidate of legacy.entries.slice(0, MAX_ENTRIES)) {
      if (!isLegacyLibraryEntry(candidate) || !candidate.item.rawText?.trim()) {
        this.unresolvedLegacyEntries.push(candidate)
        continue
      }
      try {
        const normalized = await bridge.normalize(candidate.item.rawText)
        this.entries.push({
          ...candidate,
          schemaVersion: 2,
          fingerprint: fingerprintLibraryItem(normalized.item),
          item: normalized.item,
          view: {
            ...normalized.view,
            ...(candidate.item.iconUrl ? { iconUrl: candidate.item.iconUrl } : {}),
            ...(candidate.item.localized ? { localized: candidate.item.localized } : {}),
          },
        })
        migrated += 1
      } catch {
        this.unresolvedLegacyEntries.push(candidate)
      }
    }
    this.migrateLegacyFolders()
    const migrationBackup = `${this.legacyFilePath}.migration-backup.json`
    if (!existsSync(migrationBackup)) copyFileSync(this.legacyFilePath, migrationBackup)
    this.save()
    return { migrated, unresolved: this.unresolvedLegacyEntries.length }
  }

  async repairCorruptedMarketTitles(
    bridge: PobItemBridge,
    translateCnItem: (value: string) => string | undefined,
  ): Promise<number> {
    let repaired = 0
    for (let index = 0; index < this.entries.length; index += 1) {
      const entry = this.entries[index]
      const lines = entry.item.raw.replace(/\r\n/g, '\n').split('\n')
      if (!/^Rarity:\s*(?:RARE|UNIQUE)$/i.test(lines[0] || '') || !/[?\ufffd]/.test(lines[1] || '') || !lines[2]) continue
      const display = [...entry.sources].reverse().find((source) => source.kind === 'market-favorite' && source.display?.locale === 'zh-CN')?.display
      const translatedName = display?.name ? translateCnItem(display.name) : undefined
      if (!translatedName || /[\u3400-\u9fff?\ufffd]/.test(translatedName)) continue
      lines[1] = translatedName
      try {
        const normalized = await bridge.normalize(lines.join('\n'))
        const persisted = {
          ...entry,
          item: normalized.item,
          fingerprint: fingerprintLibraryItem(normalized.item),
          updatedAt: new Date().toISOString(),
        }
        this.entries[index] = hydrateEntry(persisted)
        repaired += 1
      } catch {
        // Leave the original entry intact if PoB does not accept the repaired title.
      }
    }
    if (repaired) this.save()
    return repaired
  }

  enrichManualPresentation(
    toChinese: (value: string) => string | undefined,
    statToChinese: (value: string) => string | undefined,
    resolveIcon: (rarity: string, name: string, baseType: string) => string | undefined,
  ): number {
    let enriched = 0
    for (let index = 0; index < this.entries.length; index += 1) {
      const entry = this.entries[index]
      const manualSources = entry.sources.filter((source) => source.kind === 'manual')
      if (!manualSources.length) continue
      const canonicalView = deriveItemView(entry.item)
      const name = toChinese(canonicalView.name)
      const baseType = toChinese(canonicalView.baseType)
      const modifiers = canonicalView.modifiers.map((modifier) => statToChinese(modifier.text) || modifier.text)
      const hasLocalizedText = !!name || !!baseType || modifiers.some((text, modifierIndex) => text !== canonicalView.modifiers[modifierIndex].text)
      const iconUrl = resolveIcon(canonicalView.rarity, canonicalView.name, canonicalView.baseType)
      let changed = false
      for (const source of manualSources) {
        const display = {
          locale: hasLocalizedText ? 'zh-CN' as const : 'en' as const,
          name: name || canonicalView.name,
          baseType: baseType || canonicalView.baseType,
          ...(iconUrl ? { iconUrl } : {}),
          ...(hasLocalizedText ? { modifiers } : {}),
        }
        if (JSON.stringify(source.display) === JSON.stringify(display)) continue
        source.display = display
        source.updatedAt = new Date().toISOString()
        changed = true
      }
      if (changed) {
        this.entries[index] = hydrateEntry({ ...entry, updatedAt: new Date().toISOString() })
        enriched += 1
      }
    }
    if (enriched) this.save()
    return enriched
  }

  private load(): void {
    if (!existsSync(this.filePath)) return
    try {
      const raw = readFileSync(this.filePath, 'utf8')
      if (raw.length > 50_000_000) throw new Error('Equipment library file is too large')
      const parsed = JSON.parse(raw) as Partial<EquipmentLibraryFile>
      if (parsed.schemaVersion !== 2 || !Array.isArray(parsed.entries)) throw new Error('Unsupported equipment library schema')
      this.entries = parsed.entries.filter(isPersistedLibraryEntry).slice(0, MAX_ENTRIES).map(hydrateEntry)
      this.unresolvedLegacyEntries = Array.isArray(parsed.unresolvedLegacyEntries) ? parsed.unresolvedLegacyEntries.slice(0, MAX_ENTRIES) : []
      this.folders = Array.isArray(parsed.folders) ? parsed.folders.filter((folder): folder is EquipmentLibraryFolder => this.isFolder(folder)).slice(0, MAX_FOLDERS) : []
      this.searches = Array.isArray(parsed.searches) ? parsed.searches.flatMap((search) => this.normalizeLoadedSearch(search)).slice(0, MAX_SEARCHES) : []
      this.selectedFolders = parsed.selectedFolders && typeof parsed.selectedFolders === 'object' ? parsed.selectedFolders : {}
      this.migrateLegacyFolders()
    } catch {
      const backupPath = `${this.filePath}.backup.json`
      if (!existsSync(backupPath)) return
      try {
        const parsed = JSON.parse(readFileSync(backupPath, 'utf8')) as Partial<EquipmentLibraryFile>
        if (parsed.schemaVersion === 2 && Array.isArray(parsed.entries)) {
          this.entries = parsed.entries.filter(isPersistedLibraryEntry).slice(0, MAX_ENTRIES).map(hydrateEntry)
          this.unresolvedLegacyEntries = Array.isArray(parsed.unresolvedLegacyEntries) ? parsed.unresolvedLegacyEntries.slice(0, MAX_ENTRIES) : []
          this.folders = Array.isArray(parsed.folders) ? parsed.folders.filter((folder): folder is EquipmentLibraryFolder => this.isFolder(folder)).slice(0, MAX_FOLDERS) : []
          this.searches = Array.isArray(parsed.searches) ? parsed.searches.flatMap((search) => this.normalizeLoadedSearch(search)).slice(0, MAX_SEARCHES) : []
          this.selectedFolders = parsed.selectedFolders && typeof parsed.selectedFolders === 'object' ? parsed.selectedFolders : {}
          this.migrateLegacyFolders()
        }
      } catch {
        this.entries = []
      }
    }
  }

  private save(): void {
    const directory = path.dirname(this.filePath)
    mkdirSync(directory, { recursive: true })
    const temporaryPath = `${this.filePath}.tmp`
    const backupPath = `${this.filePath}.backup.json`
    const file: EquipmentLibraryFile = {
      schemaVersion: 2,
      entries: this.entries.map(({ view: _view, ...entry }) => entry),
      ...(this.unresolvedLegacyEntries.length ? { unresolvedLegacyEntries: this.unresolvedLegacyEntries } : {}),
      folders: this.folders,
      searches: this.searches,
      selectedFolders: this.selectedFolders,
      updatedAt: new Date().toISOString(),
    }
    const serialized = JSON.stringify(file, null, 2)
    if (serialized.length > MAX_TEXT * MAX_ENTRIES) throw new Error('Equipment library file is too large')
    if (existsSync(this.filePath)) copyFileSync(this.filePath, backupPath)
    writeFileSync(temporaryPath, serialized, { encoding: 'utf8', mode: 0o600, flush: true })
    renameSync(temporaryPath, this.filePath)
  }

  private folderName(id: string | undefined): string | undefined {
    return id ? this.folders.find((folder) => folder.id === id)?.name : undefined
  }

  private requireFolder(id: string, scope: LibraryTreeScope): EquipmentLibraryFolder {
    const folder = this.folders.find((candidate) => candidate.id === id && candidate.scope === scope)
    if (!folder) throw new Error('Equipment library folder not found')
    return folder
  }

  private descendantFolderIds(id: string): Set<string> {
    const result = new Set<string>()
    const visit = (parentId: string) => {
      for (const child of this.folders.filter((folder) => folder.parentId === parentId)) {
        if (result.has(child.id)) continue
        result.add(child.id)
        visit(child.id)
      }
    }
    visit(id)
    return result
  }

  private siblingFolders(scope: LibraryTreeScope, parentId?: string): EquipmentLibraryFolder[] {
    return this.folders
      .filter((folder) => folder.scope === scope && folder.parentId === parentId)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt.localeCompare(b.createdAt))
  }

  private normalizeSiblingOrder(scope: LibraryTreeScope, parentId?: string): void {
    this.siblingFolders(scope, parentId).forEach((folder, index) => { folder.sortOrder = index })
  }

  private placeFolder(folder: EquipmentLibraryFolder, beforeId: string | null | undefined): void {
    const siblings = this.siblingFolders(folder.scope, folder.parentId).filter((candidate) => candidate.id !== folder.id)
    let index = siblings.length
    if (beforeId) {
      const before = this.requireFolder(beforeId, folder.scope)
      if (before.id === folder.id || before.parentId !== folder.parentId) throw new Error('Folder sort target must be a sibling')
      index = siblings.findIndex((candidate) => candidate.id === before.id)
      if (index < 0) throw new Error('Folder sort target not found')
    }
    siblings.splice(index, 0, folder)
    siblings.forEach((candidate, candidateIndex) => { candidate.sortOrder = candidateIndex })
  }

  private migrateLegacyFolders(): void {
    const byName = new Map(this.folders.filter((folder) => folder.scope === 'items' && !folder.parentId).map((folder) => [folder.name, folder]))
    for (const entry of this.entries) {
      if (!entry.folder || entry.folderId) continue
      let folder = byName.get(entry.folder)
      if (!folder && this.folders.length < MAX_FOLDERS) {
        const now = new Date().toISOString()
        folder = { id: randomUUID(), scope: 'items', name: entry.folder, sortOrder: this.siblingFolders('items').length, expanded: true, createdAt: now, updatedAt: now }
        this.folders.push(folder)
        byName.set(folder.name, folder)
      }
      if (folder) entry.folderId = folder.id
      entry.folder = undefined
    }
    for (const scope of ['items', 'searches'] as const) {
      for (const folder of this.folders.filter((candidate) => candidate.scope === scope)) {
        if (!Number.isFinite(folder.sortOrder)) folder.sortOrder = Number.MAX_SAFE_INTEGER
      }
      for (const parentId of [undefined, ...this.folders.filter((folder) => folder.scope === scope).map((folder) => folder.id)]) {
        this.normalizeSiblingOrder(scope, parentId)
      }
      if (this.selectedFolders[scope] && !this.folders.some((folder) => folder.id === this.selectedFolders[scope] && folder.scope === scope)) {
        delete this.selectedFolders[scope]
      }
    }
    for (const folderId of [undefined, ...this.folders.filter((folder) => folder.scope === 'searches').map((folder) => folder.id)]) {
      this.normalizeSearchOrder(folderId)
    }
  }

  private isFolder(value: unknown): boolean {
    if (!value || typeof value !== 'object') return false
    const folder = value as Partial<EquipmentLibraryFolder>
    return typeof folder.id === 'string' && (folder.scope === 'items' || folder.scope === 'searches')
      && typeof folder.name === 'string' && typeof folder.expanded === 'boolean'
  }

  private siblingSearches(folderId?: string): SavedMarketSearch[] {
    return this.searches
      .filter((search) => search.folderId === folderId)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt.localeCompare(b.createdAt))
  }

  private normalizeSearchOrder(folderId?: string): void {
    this.siblingSearches(folderId).forEach((search, index) => { search.sortOrder = index })
  }

  private placeSearch(search: SavedMarketSearch, beforeId: string | null | undefined): void {
    const siblings = this.siblingSearches(search.folderId).filter((candidate) => candidate.id !== search.id)
    let index = siblings.length
    if (beforeId) {
      const before = this.searches.find((candidate) => candidate.id === beforeId)
      if (!before || before.folderId !== search.folderId || before.id === search.id) throw new Error('Search sort target must be a sibling')
      index = siblings.findIndex((candidate) => candidate.id === before.id)
    }
    siblings.splice(index, 0, search)
    siblings.forEach((candidate, candidateIndex) => { candidate.sortOrder = candidateIndex })
  }

  private normalizeLoadedSearch(value: unknown): SavedMarketSearch[] {
    if (!value || typeof value !== 'object') return []
    const raw = value as Partial<SavedMarketSearch> & { url?: unknown }
    if (typeof raw.id !== 'string' || (raw.realm !== 'cn' && raw.realm !== 'global')
      || typeof raw.name !== 'string' || typeof raw.createdAt !== 'string' || typeof raw.updatedAt !== 'string') return []
    const sourceUrl = typeof raw.canonicalUrl === 'string' ? raw.canonicalUrl : typeof raw.url === 'string' ? raw.url : ''
    const parsed = parseOfficialSearchUrl(sourceUrl, raw.realm)
    let reference = parsed
    if (parsed && raw.querySnapshot && typeof raw.querySnapshot === 'object') {
      const snapshot = raw.querySnapshot as Partial<NonNullable<SavedMarketSearch['querySnapshot']>>
      if ((snapshot.source === 'official-page' || snapshot.source === 'superpoe-query') && typeof snapshot.capturedAt === 'string') {
        try { reference = withSearchSnapshot(parsed, createSearchQuerySnapshot(snapshot.body, snapshot.source, snapshot.capturedAt)) } catch { /* code-only fallback */ }
      }
    }
    const now = raw.monitorStatusChangedAt || raw.updatedAt
    return [{
      id: raw.id,
      realm: raw.realm,
      leagueId: reference?.leagueId || '',
      searchCode: reference?.searchCode || '',
      canonicalUrl: reference?.canonicalUrl || sourceUrl.slice(0, 2_048),
      captureSource: reference?.captureSource || 'code-only',
      ...(reference?.querySnapshot ? { querySnapshot: reference.querySnapshot } : {}),
      validity: reference ? (raw.validity === 'needs-refresh' ? 'needs-refresh' : 'valid') : 'invalid',
      ...(typeof raw.checkedAt === 'string' ? { checkedAt: raw.checkedAt } : {}),
      name: raw.name.slice(0, 160),
      ...(typeof raw.note === 'string' && raw.note.trim() ? { note: raw.note.slice(0, MAX_NOTE) } : {}),
      ...(typeof raw.folderId === 'string' ? { folderId: raw.folderId } : {}),
      sortOrder: Number.isFinite(raw.sortOrder) ? raw.sortOrder! : Number.MAX_SAFE_INTEGER,
      monitorStatus: raw.monitorStatus === 'armed' || raw.monitorStatus === 'paused' || raw.monitorStatus === 'completed' ? raw.monitorStatus : 'saved',
      monitorPriority: raw.monitorPriority === 'high' || raw.monitorPriority === 'low' ? raw.monitorPriority : 'normal',
      monitorStatusChangedAt: now,
      createdAt: raw.createdAt,
      updatedAt: raw.updatedAt,
    }]
  }
}

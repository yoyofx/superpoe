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
  LibraryItemSnapshot,
  LibraryTreeScope,
  MarketFavoriteState,
  MarketRealm,
  SavedMarketSearch,
  SavedMarketSearchInput,
  SavedMarketSearchPatch,
} from '../src/types/market.js'

interface EquipmentLibraryFile {
  schemaVersion: 1
  entries: EquipmentLibraryEntry[]
  folders?: EquipmentLibraryFolder[]
  searches?: SavedMarketSearch[]
  selectedFolders?: Partial<Record<LibraryTreeScope, string>>
  updatedAt: string
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

function fingerprintPayload(item: LibraryItemSnapshot): unknown {
  return {
    rarity: item.rarity.trim().toUpperCase(),
    name: item.name.trim(),
    baseType: item.baseType.trim(),
    itemLevel: item.itemLevel,
    quality: item.quality,
    sockets: item.sockets?.trim(),
    corrupted: !!item.corrupted,
    identified: item.identified !== false,
    modifiers: item.modifiers.map((modifier) => ({
      group: modifier.group,
      sourceTags: [...modifier.sourceTags].sort(),
      affixKind: modifier.affixKind,
      text: modifier.original.lines.map((line) => line.trim()),
      values: modifier.currentValues,
    })),
  }
}

export function fingerprintLibraryItem(item: LibraryItemSnapshot): string {
  return createHash('sha256').update(JSON.stringify(fingerprintPayload(item))).digest('hex')
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

function isLibraryItem(value: unknown): value is LibraryItemSnapshot {
  if (!value || typeof value !== 'object') return false
  const item = value as Partial<LibraryItemSnapshot>
  return typeof item.rarity === 'string'
    && typeof item.name === 'string'
    && typeof item.baseType === 'string'
    && Array.isArray(item.modifiers)
    && item.modifiers.length <= 128
}

function isLibraryEntry(value: unknown): value is EquipmentLibraryEntry {
  if (!value || typeof value !== 'object') return false
  const entry = value as Partial<EquipmentLibraryEntry>
  return entry.schemaVersion === 1
    && typeof entry.id === 'string'
    && typeof entry.fingerprint === 'string'
    && isLibraryItem(entry.item)
    && Array.isArray(entry.sources)
    && Array.isArray(entry.tags)
    && typeof entry.archived === 'boolean'
    && typeof entry.createdAt === 'string'
    && typeof entry.updatedAt === 'string'
}

export class EquipmentLibraryRepository {
  private entries: EquipmentLibraryEntry[] = []
  private folders: EquipmentLibraryFolder[] = []
  private searches: SavedMarketSearch[] = []
  private selectedFolders: Partial<Record<LibraryTreeScope, string>> = {}

  constructor(private readonly filePath: string) {
    this.load()
  }

  list(filter: EquipmentLibraryFilter = {}): EquipmentLibraryEntry[] {
    const query = filter.query?.trim().toLocaleLowerCase()
    return this.entries
      .filter((entry) => filter.includeArchived || !entry.archived)
      .filter((entry) => !filter.realm || entry.sources.some((source) => 'realm' in source && source.realm === filter.realm))
      .filter((entry) => !filter.sourceKind || filter.sourceKind === 'all' || entry.sources.some((source) => source.kind === filter.sourceKind))
      .filter((entry) => !query || [entry.item.name, entry.item.baseType, entry.folder, this.folderName(entry.folderId), entry.note, ...entry.tags]
        .some((value) => value?.toLocaleLowerCase().includes(query)))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map((entry) => structuredClone(entry))
  }

  get(id: string): EquipmentLibraryEntry | undefined {
    const entry = this.entries.find((candidate) => candidate.id === id)
    return entry ? structuredClone(entry) : undefined
  }

  upsert(item: LibraryItemSnapshot, source: EquipmentLibrarySource): EquipmentLibraryEntry {
    if (!isLibraryItem(item)) throw new Error('Invalid equipment library item')
    const fingerprint = fingerprintLibraryItem(item)
    const now = new Date().toISOString()
    let entry = this.entries.find((candidate) => candidate.sources.some((existing) => existing.sourceKey === source.sourceKey))
    entry ||= this.entries.find((candidate) => candidate.fingerprint === fingerprint)

    if (entry) {
      entry.item = structuredClone(item)
      entry.fingerprint = fingerprint
      const sourceIndex = entry.sources.findIndex((existing) => existing.sourceKey === source.sourceKey)
      if (sourceIndex >= 0) entry.sources[sourceIndex] = structuredClone(source)
      else entry.sources.push(structuredClone(source))
      entry.updatedAt = now
    } else {
      if (this.entries.length >= MAX_ENTRIES) throw new Error('Equipment library limit reached')
      entry = {
        schemaVersion: 1,
        id: randomUUID(),
        fingerprint,
        item: structuredClone(item),
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
    if (!entry.sources.length) {
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

  updateItem(id: string, item: LibraryItemSnapshot): EquipmentLibraryEntry {
    if (!isLibraryItem(item)) throw new Error('Invalid equipment library item')
    const entry = this.entries.find((candidate) => candidate.id === id)
    if (!entry) throw new Error('Equipment library entry not found')
    entry.item = structuredClone(item)
    entry.fingerprint = fingerprintLibraryItem(item)
    entry.updatedAt = new Date().toISOString()
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
      searches: this.searches,
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

  saveSearch(input: SavedMarketSearchInput): SavedMarketSearch {
    if (this.searches.length >= MAX_SEARCHES) throw new Error('Saved search limit reached')
    const name = normalizeText(input.name, 160) || 'Saved search'
    const note = normalizeText(input.note, MAX_NOTE)
    if (input.folderId) this.requireFolder(input.folderId, 'searches')
    const now = new Date().toISOString()
    const search: SavedMarketSearch = {
      id: randomUUID(), realm: input.realm, name, url: input.url,
      ...(note ? { note } : {}),
      ...(input.folderId || this.selectedFolders.searches ? { folderId: input.folderId || this.selectedFolders.searches } : {}),
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
      if (patch.folderId == null) search.folderId = undefined
      else {
        this.requireFolder(patch.folderId, 'searches')
        search.folderId = patch.folderId
      }
    }
    search.updatedAt = new Date().toISOString()
    this.save()
    return structuredClone(search)
  }

  getSearch(id: string): SavedMarketSearch | undefined {
    const search = this.searches.find((candidate) => candidate.id === id)
    return search ? structuredClone(search) : undefined
  }

  deleteSearch(id: string): boolean {
    const before = this.searches.length
    this.searches = this.searches.filter((candidate) => candidate.id !== id)
    if (before === this.searches.length) return false
    this.save()
    return true
  }

  private load(): void {
    if (!existsSync(this.filePath)) return
    try {
      const raw = readFileSync(this.filePath, 'utf8')
      if (raw.length > 50_000_000) throw new Error('Equipment library file is too large')
      const parsed = JSON.parse(raw) as Partial<EquipmentLibraryFile>
      if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.entries)) throw new Error('Unsupported equipment library schema')
      this.entries = parsed.entries.filter(isLibraryEntry).slice(0, MAX_ENTRIES)
      this.folders = Array.isArray(parsed.folders) ? parsed.folders.filter((folder): folder is EquipmentLibraryFolder => this.isFolder(folder)).slice(0, MAX_FOLDERS) : []
      this.searches = Array.isArray(parsed.searches) ? parsed.searches.filter((search): search is SavedMarketSearch => this.isSearch(search)).slice(0, MAX_SEARCHES) : []
      this.selectedFolders = parsed.selectedFolders && typeof parsed.selectedFolders === 'object' ? parsed.selectedFolders : {}
      this.migrateLegacyFolders()
    } catch {
      const backupPath = `${this.filePath}.backup.json`
      if (!existsSync(backupPath)) return
      try {
        const parsed = JSON.parse(readFileSync(backupPath, 'utf8')) as Partial<EquipmentLibraryFile>
        if (parsed.schemaVersion === 1 && Array.isArray(parsed.entries)) {
          this.entries = parsed.entries.filter(isLibraryEntry).slice(0, MAX_ENTRIES)
          this.folders = Array.isArray(parsed.folders) ? parsed.folders.filter((folder): folder is EquipmentLibraryFolder => this.isFolder(folder)).slice(0, MAX_FOLDERS) : []
          this.searches = Array.isArray(parsed.searches) ? parsed.searches.filter((search): search is SavedMarketSearch => this.isSearch(search)).slice(0, MAX_SEARCHES) : []
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
      schemaVersion: 1,
      entries: this.entries,
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
  }

  private isFolder(value: unknown): boolean {
    if (!value || typeof value !== 'object') return false
    const folder = value as Partial<EquipmentLibraryFolder>
    return typeof folder.id === 'string' && (folder.scope === 'items' || folder.scope === 'searches')
      && typeof folder.name === 'string' && typeof folder.expanded === 'boolean'
  }

  private isSearch(value: unknown): boolean {
    if (!value || typeof value !== 'object') return false
    const search = value as Partial<SavedMarketSearch>
    return typeof search.id === 'string' && (search.realm === 'cn' || search.realm === 'global')
      && typeof search.name === 'string' && typeof search.url === 'string'
      && typeof search.createdAt === 'string' && typeof search.updatedAt === 'string'
  }
}

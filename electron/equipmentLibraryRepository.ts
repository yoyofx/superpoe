import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import type {
  EquipmentLibraryEntry,
  EquipmentLibraryFilter,
  EquipmentLibraryMetadataPatch,
  EquipmentLibrarySource,
  LibraryItemSnapshot,
  MarketFavoriteState,
  MarketRealm,
} from '../src/types/market.js'

interface EquipmentLibraryFile {
  schemaVersion: 1
  entries: EquipmentLibraryEntry[]
  updatedAt: string
}

const MAX_ENTRIES = 5_000
const MAX_TEXT = 100_000
const MAX_NOTE = 4_000
const MAX_TAGS = 32
const MAX_TAG_LENGTH = 64

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

  constructor(private readonly filePath: string) {
    this.load()
  }

  list(filter: EquipmentLibraryFilter = {}): EquipmentLibraryEntry[] {
    const query = filter.query?.trim().toLocaleLowerCase()
    return this.entries
      .filter((entry) => filter.includeArchived || !entry.archived)
      .filter((entry) => !filter.realm || entry.sources.some((source) => 'realm' in source && source.realm === filter.realm))
      .filter((entry) => !filter.sourceKind || filter.sourceKind === 'all' || entry.sources.some((source) => source.kind === filter.sourceKind))
      .filter((entry) => !query || [entry.item.name, entry.item.baseType, entry.folder, entry.note, ...entry.tags]
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
    if (!entry.sources.length && !entry.folder && !entry.note && !entry.tags.length) {
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

  private load(): void {
    if (!existsSync(this.filePath)) return
    try {
      const raw = readFileSync(this.filePath, 'utf8')
      if (raw.length > 50_000_000) throw new Error('Equipment library file is too large')
      const parsed = JSON.parse(raw) as Partial<EquipmentLibraryFile>
      if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.entries)) throw new Error('Unsupported equipment library schema')
      this.entries = parsed.entries.filter(isLibraryEntry).slice(0, MAX_ENTRIES)
    } catch {
      const backupPath = `${this.filePath}.backup.json`
      if (!existsSync(backupPath)) return
      try {
        const parsed = JSON.parse(readFileSync(backupPath, 'utf8')) as Partial<EquipmentLibraryFile>
        if (parsed.schemaVersion === 1 && Array.isArray(parsed.entries)) {
          this.entries = parsed.entries.filter(isLibraryEntry).slice(0, MAX_ENTRIES)
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
      updatedAt: new Date().toISOString(),
    }
    const serialized = JSON.stringify(file, null, 2)
    if (serialized.length > MAX_TEXT * MAX_ENTRIES) throw new Error('Equipment library file is too large')
    if (existsSync(this.filePath)) copyFileSync(this.filePath, backupPath)
    writeFileSync(temporaryPath, serialized, { encoding: 'utf8', mode: 0o600, flush: true })
    renameSync(temporaryPath, this.filePath)
  }
}

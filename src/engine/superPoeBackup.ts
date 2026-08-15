export const SUPERPOE_BACKUP_FORMAT = 'superpoe-backup'
export const SUPERPOE_BACKUP_SCHEMA_VERSION = 1
export const SUPERPOE_BACKUP_EXTENSION = 'spoe-backup'
export const MAX_SUPERPOE_BACKUP_FILE_SIZE = 100_000_000

export const BACKUP_STORAGE_KEYS = [
  'superpoe-global-settings',
  'pob2-language',
  'pob2-saved-builds',
  'pob2-imported-build',
] as const

export type BackupStorageKey = typeof BACKUP_STORAGE_KEYS[number]

export interface SuperPoeBackupMainData {
  equipmentLibrary: unknown | null
  marketMonitoring: unknown | null
}

export interface SuperPoeBackupData {
  rendererStorage: Partial<Record<BackupStorageKey, string>>
  urlHash: string
  main: SuperPoeBackupMainData
}

export interface SuperPoeBackupEnvelope {
  format: typeof SUPERPOE_BACKUP_FORMAT
  schemaVersion: typeof SUPERPOE_BACKUP_SCHEMA_VERSION
  writtenAt: string
  writtenBy: {
    appVersion: string
    channel: 'dev' | 'release'
    platform: 'win32' | 'darwin'
  }
  payloadHash: string
  data: SuperPoeBackupData
}

interface StorageLike {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
  removeItem: (key: string) => void
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function requireString(value: unknown, name: string, maxLength: number, allowEmpty = false): string {
  if (typeof value !== 'string' || value.length > maxLength || (!allowEmpty && !value.trim())) {
    throw new Error(`Invalid ${name}`)
  }
  return value
}

function canonicalize(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value)
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Cannot hash a non-finite number')
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(',')}}`
  }
  throw new Error('Cannot hash an unsupported backup value')
}

async function sha256(value: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return `sha256:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')}`
}

function validateStorage(value: unknown): Partial<Record<BackupStorageKey, string>> {
  if (!isRecord(value)) throw new Error('Invalid backup renderer storage')
  const allowed = new Set<string>(BACKUP_STORAGE_KEYS)
  const result: Partial<Record<BackupStorageKey, string>> = {}
  for (const [key, entry] of Object.entries(value)) {
    if (!allowed.has(key) || typeof entry !== 'string' || entry.length > 50_000_000) throw new Error('Invalid backup renderer storage entry')
    result[key as BackupStorageKey] = entry
  }
  return result
}

function validateMainData(value: unknown): SuperPoeBackupMainData {
  if (!isRecord(value)) throw new Error('Invalid backup main data')
  const equipmentLibrary = value.equipmentLibrary == null ? null : value.equipmentLibrary
  const marketMonitoring = value.marketMonitoring == null ? null : value.marketMonitoring
  if (JSON.stringify(equipmentLibrary).length > 60_000_000 || JSON.stringify(marketMonitoring).length > 20_000_000) {
    throw new Error('Backup main data is too large')
  }
  return { equipmentLibrary, marketMonitoring }
}

function validateData(value: unknown): SuperPoeBackupData {
  if (!isRecord(value)) throw new Error('Invalid backup payload')
  return {
    rendererStorage: validateStorage(value.rendererStorage),
    urlHash: requireString(value.urlHash, 'backup URL hash', 10_000_000, true).replace(/^#/, ''),
    main: validateMainData(value.main),
  }
}

export function collectRendererStorage(storage: StorageLike | undefined = typeof localStorage === 'undefined' ? undefined : localStorage): Partial<Record<BackupStorageKey, string>> {
  if (!storage) return {}
  const result: Partial<Record<BackupStorageKey, string>> = {}
  for (const key of BACKUP_STORAGE_KEYS) {
    const value = storage.getItem(key)
    if (value != null) result[key] = value
  }
  return result
}

export function applyRendererStorage(
  snapshot: Partial<Record<BackupStorageKey, string>>,
  storage: StorageLike | undefined = typeof localStorage === 'undefined' ? undefined : localStorage,
): void {
  if (!storage) return
  const values = validateStorage(snapshot)
  for (const key of BACKUP_STORAGE_KEYS) {
    const value = values[key]
    if (value == null) storage.removeItem(key)
    else storage.setItem(key, value)
  }
}

export function buildBackupFileName(date = new Date()): string {
  const stamp = date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
  return `SuperPoE-backup-${stamp}.${SUPERPOE_BACKUP_EXTENSION}`
}

export async function createSuperPoeBackup(input: {
  main: SuperPoeBackupMainData
  appVersion: string
  channel: 'dev' | 'release'
  platform: 'win32' | 'darwin'
  storage?: StorageLike
  rendererStorage?: Partial<Record<BackupStorageKey, string>>
  urlHash?: string
}): Promise<string> {
  const data: SuperPoeBackupData = {
    rendererStorage: input.rendererStorage || collectRendererStorage(input.storage),
    urlHash: (input.urlHash || '').replace(/^#/, ''),
    main: input.main,
  }
  const validatedData = validateData(data)
  const envelope: SuperPoeBackupEnvelope = {
    format: SUPERPOE_BACKUP_FORMAT,
    schemaVersion: SUPERPOE_BACKUP_SCHEMA_VERSION,
    writtenAt: new Date().toISOString(),
    writtenBy: {
      appVersion: requireString(input.appVersion, 'writer app version', 64),
      channel: input.channel,
      platform: input.platform,
    },
    payloadHash: await sha256(canonicalize(validatedData)),
    data: validatedData,
  }
  const serialized = `${JSON.stringify(envelope, null, 2)}\n`
  if (serialized.length > MAX_SUPERPOE_BACKUP_FILE_SIZE) throw new Error('Backup file is too large')
  return serialized
}

export async function parseSuperPoeBackup(content: string): Promise<SuperPoeBackupEnvelope> {
  if (!content || content.length > MAX_SUPERPOE_BACKUP_FILE_SIZE) throw new Error('Invalid SuperPoE backup file size')
  let raw: unknown
  try {
    raw = JSON.parse(content)
  } catch {
    throw new Error('The backup file is not valid JSON')
  }
  if (!isRecord(raw) || raw.format !== SUPERPOE_BACKUP_FORMAT) throw new Error('The file is not a SuperPoE backup')
  if (raw.schemaVersion !== SUPERPOE_BACKUP_SCHEMA_VERSION) throw new Error(`Unsupported SuperPoE backup schema: ${String(raw.schemaVersion)}`)
  const writtenAt = requireString(raw.writtenAt, 'backup write time', 64)
  if (Number.isNaN(Date.parse(writtenAt))) throw new Error('Invalid backup write time')
  if (!isRecord(raw.writtenBy)) throw new Error('Invalid backup writer metadata')
  const channel = raw.writtenBy.channel
  const platform = raw.writtenBy.platform
  if (channel !== 'dev' && channel !== 'release') throw new Error('Invalid backup writer channel')
  if (platform !== 'win32' && platform !== 'darwin') throw new Error('Invalid backup writer platform')
  const data = validateData(raw.data)
  const payloadHash = requireString(raw.payloadHash, 'backup payload hash', 80)
  if (!/^sha256:[a-f0-9]{64}$/.test(payloadHash)) throw new Error('Invalid backup payload hash')
  if (await sha256(canonicalize(data)) !== payloadHash) throw new Error('The backup payload hash does not match')
  return {
    format: SUPERPOE_BACKUP_FORMAT,
    schemaVersion: SUPERPOE_BACKUP_SCHEMA_VERSION,
    writtenAt,
    writtenBy: {
      appVersion: requireString(raw.writtenBy.appVersion, 'writer app version', 64),
      channel,
      platform,
    },
    payloadHash,
    data,
  }
}

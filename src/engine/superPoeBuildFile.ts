import { decodeBuildCode } from '@/engine/buildCode'
import type { BuildRealm, SavedBuild } from '@/types/tree'

export const SUPERPOE_BUILD_FORMAT = 'superpoe-build'
export const SUPERPOE_BUILD_SCHEMA_VERSION = 1
export const SUPERPOE_BUILD_EXTENSION = 'spoe'
export const MAX_SUPERPOE_BUILD_FILE_SIZE = 10_000_000

export type SuperPoeBuildSource = 'local' | 'pob' | 'wegame' | 'poe-ninja'

export interface SuperPoeBuildRecord {
  id: string
  metadata: {
    name: string
    description?: string
    tags: string[]
    realm: BuildRealm
    source: SuperPoeBuildSource
    sourceUrl?: string
    createdAt: string
    updatedAt: string
    lastOpenedAt: string
  }
  pob: {
    code: string
    contentHash: string
  }
}

export interface SuperPoeBuildEnvelope {
  format: typeof SUPERPOE_BUILD_FORMAT
  schemaVersion: typeof SUPERPOE_BUILD_SCHEMA_VERSION
  revision: number
  writtenAt: string
  writtenBy: {
    appVersion: string
    channel: 'dev' | 'release'
    platform: 'win32' | 'darwin'
  }
  payloadHash: string
  data: SuperPoeBuildRecord
}

export interface ParsedSuperPoeBuildFile {
  envelope: SuperPoeBuildEnvelope
  xml: string
  treeVersion: string
  nodeCount: number
}

interface CreateSuperPoeBuildFileInput {
  id: string
  name: string
  description?: string
  tags?: string[]
  realm: BuildRealm
  source?: SavedBuild['source']
  sourceUrl?: string | null
  createdAt: string
  updatedAt: string
  lastOpenedAt?: string
  code: string
  xml: string
  revision?: number
  appVersion: string
  channel: 'dev' | 'release'
  platform: 'win32' | 'darwin'
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

function requireIsoDate(value: unknown, name: string): string {
  const text = requireString(value, name, 64)
  if (Number.isNaN(Date.parse(text))) throw new Error(`Invalid ${name}`)
  return text
}

function requireHash(value: unknown, name: string): string {
  const text = requireString(value, name, 80)
  if (!/^sha256:[a-f0-9]{64}$/.test(text)) throw new Error(`Invalid ${name}`)
  return text
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
  throw new Error('Cannot hash an unsupported value')
}

async function sha256(value: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return `sha256:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')}`
}

export function normalizeSuperPoeBuildSource(source: SavedBuild['source']): SuperPoeBuildSource {
  return source === 'pob' || source === 'wegame' || source === 'poe-ninja' ? source : 'local'
}

function validateMetadata(value: unknown): SuperPoeBuildRecord['metadata'] {
  if (!isRecord(value)) throw new Error('Invalid build metadata')
  const tags = value.tags
  if (!Array.isArray(tags) || tags.length > 32 || tags.some((tag) => typeof tag !== 'string' || !tag.trim() || tag.length > 64)) {
    throw new Error('Invalid build tags')
  }
  if (value.realm !== 'cn' && value.realm !== 'global') throw new Error('Invalid build realm')
  if (value.source !== 'local' && value.source !== 'pob' && value.source !== 'wegame' && value.source !== 'poe-ninja') throw new Error('Invalid build source')
  const sourceUrl = value.sourceUrl == null ? undefined : requireString(value.sourceUrl, 'build source URL', 2_048)
  if (sourceUrl) {
    const url = new URL(sourceUrl)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('Invalid build source URL')
  }
  return {
    name: requireString(value.name, 'build name', 80),
    ...(value.description == null ? {} : { description: requireString(value.description, 'build description', 2_000, true) }),
    tags: [...tags] as string[],
    realm: value.realm,
    source: value.source,
    ...(sourceUrl ? { sourceUrl } : {}),
    createdAt: requireIsoDate(value.createdAt, 'build creation time'),
    updatedAt: requireIsoDate(value.updatedAt, 'build update time'),
    lastOpenedAt: requireIsoDate(value.lastOpenedAt, 'build last-opened time'),
  }
}

function validateRecord(value: unknown): SuperPoeBuildRecord {
  if (!isRecord(value)) throw new Error('Invalid SuperPoE build record')
  const pob = value.pob
  if (!isRecord(pob)) throw new Error('Invalid PoB payload')
  return {
    id: requireString(value.id, 'build ID', 128),
    metadata: validateMetadata(value.metadata),
    pob: {
      code: requireString(pob.code, 'PoB code', MAX_SUPERPOE_BUILD_FILE_SIZE),
      contentHash: requireHash(pob.contentHash, 'PoB content hash'),
    },
  }
}

export async function createSuperPoeBuildFile(input: CreateSuperPoeBuildFileInput): Promise<string> {
  const now = input.lastOpenedAt || input.updatedAt
  const data: SuperPoeBuildRecord = {
    id: requireString(input.id, 'build ID', 128),
    metadata: {
      name: requireString(input.name, 'build name', 80),
      ...(input.description == null ? {} : { description: requireString(input.description, 'build description', 2_000, true) }),
      tags: [...(input.tags || [])],
      realm: input.realm,
      source: normalizeSuperPoeBuildSource(input.source),
      ...(input.sourceUrl ? { sourceUrl: input.sourceUrl } : {}),
      createdAt: requireIsoDate(input.createdAt, 'build creation time'),
      updatedAt: requireIsoDate(input.updatedAt, 'build update time'),
      lastOpenedAt: requireIsoDate(now, 'build last-opened time'),
    },
    pob: {
      code: requireString(input.code, 'PoB code', MAX_SUPERPOE_BUILD_FILE_SIZE),
      contentHash: await sha256(input.xml),
    },
  }
  // Run the same validation used for untrusted files before serializing.
  validateRecord(data)
  const envelope: SuperPoeBuildEnvelope = {
    format: SUPERPOE_BUILD_FORMAT,
    schemaVersion: SUPERPOE_BUILD_SCHEMA_VERSION,
    revision: Math.max(1, Math.floor(input.revision || 1)),
    writtenAt: new Date().toISOString(),
    writtenBy: {
      appVersion: requireString(input.appVersion, 'writer app version', 64),
      channel: input.channel,
      platform: input.platform,
    },
    payloadHash: await sha256(canonicalize(data)),
    data,
  }
  return `${JSON.stringify(envelope, null, 2)}\n`
}

export async function parseSuperPoeBuildFile(content: string): Promise<ParsedSuperPoeBuildFile> {
  if (!content || content.length > MAX_SUPERPOE_BUILD_FILE_SIZE) throw new Error('Invalid SuperPoE build file size')
  let raw: unknown
  try {
    raw = JSON.parse(content)
  } catch {
    throw new Error('The file is not valid SuperPoE build JSON')
  }
  if (!isRecord(raw) || raw.format !== SUPERPOE_BUILD_FORMAT) throw new Error('The file is not a SuperPoE build')
  if (raw.schemaVersion !== SUPERPOE_BUILD_SCHEMA_VERSION) {
    throw new Error(`Unsupported SuperPoE build schema: ${String(raw.schemaVersion)}`)
  }
  if (!Number.isInteger(raw.revision) || Number(raw.revision) < 1) throw new Error('Invalid build revision')
  const writtenAt = requireIsoDate(raw.writtenAt, 'file write time')
  if (!isRecord(raw.writtenBy)) throw new Error('Invalid build writer metadata')
  const channel = raw.writtenBy.channel
  const platform = raw.writtenBy.platform
  if (channel !== 'dev' && channel !== 'release') throw new Error('Invalid build writer channel')
  if (platform !== 'win32' && platform !== 'darwin') throw new Error('Invalid build writer platform')
  const data = validateRecord(raw.data)
  const payloadHash = requireHash(raw.payloadHash, 'payload hash')
  if (await sha256(canonicalize(data)) !== payloadHash) throw new Error('The SuperPoE build payload hash does not match')

  const decoded = decodeBuildCode(data.pob.code)
  if (await sha256(decoded.xml) !== data.pob.contentHash) throw new Error('The PoB content hash does not match')

  return {
    envelope: {
      format: SUPERPOE_BUILD_FORMAT,
      schemaVersion: SUPERPOE_BUILD_SCHEMA_VERSION,
      revision: Number(raw.revision),
      writtenAt,
      writtenBy: {
        appVersion: requireString(raw.writtenBy.appVersion, 'writer app version', 64),
        channel,
        platform,
      },
      payloadHash,
      data,
    },
    xml: decoded.xml,
    treeVersion: decoded.treeVersion,
    nodeCount: decoded.nodes.length,
  }
}

export function sanitizeSuperPoeBuildFileName(name: string): string {
  const clean = name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim() || 'SuperPoE Build'
  return `${clean.slice(0, 100).replace(/[. ]+$/g, '') || 'SuperPoE Build'}.${SUPERPOE_BUILD_EXTENSION}`
}

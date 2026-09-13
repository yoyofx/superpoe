import type { ReferenceSiteConfig } from '@/types/reference'

export const DEFAULT_REFERENCE_SITES: readonly ReferenceSiteConfig[] = [
  { id: 'ninja', name: 'Ninja builds', url: 'https://ninja.710421059.xyz/poe2/builds', builtIn: true },
  { id: 'poe2db', name: 'PoE2DB', url: 'https://poe2db.tw/cn/', builtIn: true },
]

const REFERENCE_SITES_STORAGE_KEY = 'superpoe-reference-sites'
const MAX_REFERENCE_SITES = 24
const MAX_REFERENCE_SITE_NAME_LENGTH = 80
const MAX_REFERENCE_SITE_URL_LENGTH = 2_048

interface SettingsStorage {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
}

export function isValidReferenceSiteUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > MAX_REFERENCE_SITE_URL_LENGTH) return false
  try {
    const url = new URL(value.trim())
    return url.protocol === 'https:' && Boolean(url.hostname)
  } catch {
    return false
  }
}

export function normalizeReferenceSite(value: unknown): ReferenceSiteConfig | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Partial<ReferenceSiteConfig>
  const id = typeof candidate.id === 'string' ? candidate.id.trim().slice(0, 64) : ''
  const name = typeof candidate.name === 'string' ? candidate.name.trim().slice(0, MAX_REFERENCE_SITE_NAME_LENGTH) : ''
  const url = typeof candidate.url === 'string' ? candidate.url.trim() : ''
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(id) || !name || !isValidReferenceSiteUrl(url)) return null
  return { id, name, url, ...(candidate.builtIn === true ? { builtIn: true } : {}) }
}

export function normalizeReferenceSites(value: unknown): ReferenceSiteConfig[] {
  if (!Array.isArray(value)) return DEFAULT_REFERENCE_SITES.map((site) => ({ ...site }))
  const sites: ReferenceSiteConfig[] = []
  const ids = new Set<string>()
  for (const entry of value) {
    const site = normalizeReferenceSite(entry)
    if (!site || ids.has(site.id)) continue
    ids.add(site.id)
    sites.push(site)
    if (sites.length >= MAX_REFERENCE_SITES) break
  }
  return sites.length > 0 ? sites : DEFAULT_REFERENCE_SITES.map((site) => ({ ...site }))
}

export function loadReferenceSites(storage: SettingsStorage | undefined = typeof localStorage === 'undefined' ? undefined : localStorage): ReferenceSiteConfig[] {
  if (!storage) return DEFAULT_REFERENCE_SITES.map((site) => ({ ...site }))
  try {
    const raw = storage.getItem(REFERENCE_SITES_STORAGE_KEY)
    return raw ? normalizeReferenceSites(JSON.parse(raw)) : DEFAULT_REFERENCE_SITES.map((site) => ({ ...site }))
  } catch {
    return DEFAULT_REFERENCE_SITES.map((site) => ({ ...site }))
  }
}

export function saveReferenceSites(sites: readonly ReferenceSiteConfig[], storage: SettingsStorage | undefined = typeof localStorage === 'undefined' ? undefined : localStorage): void {
  if (!storage) return
  try {
    storage.setItem(REFERENCE_SITES_STORAGE_KEY, JSON.stringify(normalizeReferenceSites(sites)))
  } catch {
    // Keep the in-memory list usable when persistent storage is unavailable.
  }
}

export function createReferenceSiteId(existing: readonly ReferenceSiteConfig[]): string {
  const ids = new Set(existing.map((site) => site.id))
  let candidate = ''
  do {
    candidate = `site-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
  } while (ids.has(candidate))
  return candidate.slice(0, 64)
}

export const REFERENCE_SITE_LIMITS = {
  maxNameLength: MAX_REFERENCE_SITE_NAME_LENGTH,
  maxUrlLength: MAX_REFERENCE_SITE_URL_LENGTH,
  maxSites: MAX_REFERENCE_SITES,
} as const

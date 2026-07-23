import type { BuildRealm } from '@/types/tree'

export type UpdateChannel = 'release' | 'dev'

const APP_SETTINGS_STORAGE_KEY = 'superpoe-global-settings'

export interface AppSettings {
  defaultRealm: BuildRealm
  confirmUnsavedExit: boolean
  updateChannel: UpdateChannel
  /** Update check interval in minutes */
  updateCheckIntervalMinutes: number
  /** User-configured GitHub proxy domains (unioned with built-in list) */
  proxyDomains: string[]
}

const DEFAULT_APP_SETTINGS: AppSettings = {
  defaultRealm: 'global',
  confirmUnsavedExit: true,
  updateChannel: 'release',
  updateCheckIntervalMinutes: 60,
  proxyDomains: [],
}

interface SettingsStorage {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
}

export function loadAppSettings(storage: SettingsStorage | undefined = typeof localStorage === 'undefined' ? undefined : localStorage): AppSettings {
  if (!storage) return DEFAULT_APP_SETTINGS
  try {
    const parsed = JSON.parse(storage.getItem(APP_SETTINGS_STORAGE_KEY) || '{}') as Partial<AppSettings>
    return {
      defaultRealm: parsed.defaultRealm === 'cn' ? 'cn' : 'global',
      confirmUnsavedExit: parsed.confirmUnsavedExit !== false,
      updateChannel: parsed.updateChannel === 'dev' ? 'dev' : 'release',
      updateCheckIntervalMinutes: typeof parsed.updateCheckIntervalMinutes === 'number' && parsed.updateCheckIntervalMinutes >= 10 ? parsed.updateCheckIntervalMinutes : 60,
      proxyDomains: Array.isArray(parsed.proxyDomains)
        ? parsed.proxyDomains.filter((d): d is string => typeof d === 'string' && d.trim().length > 0).map((d) => d.trim().replace(/\/+$/, ''))
        : [],
    }
  } catch {
    return DEFAULT_APP_SETTINGS
  }
}

export function saveAppSettings(settings: AppSettings, storage: SettingsStorage | undefined = typeof localStorage === 'undefined' ? undefined : localStorage): void {
  if (!storage) return
  try {
    storage.setItem(APP_SETTINGS_STORAGE_KEY, JSON.stringify(settings))
  } catch {
    // Keep the in-memory settings usable when persistent storage is unavailable.
  }
}

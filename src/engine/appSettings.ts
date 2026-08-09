import type { BuildRealm } from '@/types/tree'
import { mapSystemRealm } from '@/engine/systemLocale'

export type UpdateChannel = 'release' | 'dev'

export const MIN_UI_SCALE_PERCENT = 80
export const MAX_UI_SCALE_PERCENT = 150
export const DEFAULT_UI_SCALE_PERCENT = 100
export const UI_SCALE_STEP_PERCENT = 5

const APP_SETTINGS_STORAGE_KEY = 'superpoe-global-settings'

export interface AppSettings {
  defaultRealm: BuildRealm
  confirmUnsavedExit: boolean
  uiScalePercent: number
  updateChannel: UpdateChannel
  /** Update check interval in minutes */
  updateCheckIntervalMinutes: number
  /** User-configured GitHub proxy domains (unioned with built-in list) */
  proxyDomains: string[]
  priceCheckEnabled: boolean
  priceCheckHotkey: string
}

function getDefaultAppSettings(): AppSettings {
  return {
    defaultRealm: mapSystemRealm(),
    confirmUnsavedExit: true,
    uiScalePercent: 120,
    updateChannel: 'dev',
    updateCheckIntervalMinutes: 60,
    proxyDomains: [],
    priceCheckEnabled: true,
    priceCheckHotkey: 'Ctrl+D',
  }
}

interface SettingsStorage {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
}

export function normalizeUiScalePercent(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_UI_SCALE_PERCENT
  const stepped = Math.round(value / UI_SCALE_STEP_PERCENT) * UI_SCALE_STEP_PERCENT
  return Math.min(MAX_UI_SCALE_PERCENT, Math.max(MIN_UI_SCALE_PERCENT, stepped))
}

export function loadAppSettings(storage: SettingsStorage | undefined = typeof localStorage === 'undefined' ? undefined : localStorage): AppSettings {
  if (!storage) return getDefaultAppSettings()
  try {
    const parsed = JSON.parse(storage.getItem(APP_SETTINGS_STORAGE_KEY) || '{}') as Partial<AppSettings>
    const defaults = getDefaultAppSettings()
    return {
      defaultRealm: parsed.defaultRealm === 'cn' || parsed.defaultRealm === 'global' ? parsed.defaultRealm : defaults.defaultRealm,
      confirmUnsavedExit: parsed.confirmUnsavedExit !== false,
      uiScalePercent: parsed.uiScalePercent === undefined ? defaults.uiScalePercent : normalizeUiScalePercent(parsed.uiScalePercent),
      updateChannel: parsed.updateChannel === 'dev' ? 'dev' : parsed.updateChannel === 'release' ? 'release' : defaults.updateChannel,
      updateCheckIntervalMinutes: typeof parsed.updateCheckIntervalMinutes === 'number' && parsed.updateCheckIntervalMinutes >= 10 ? parsed.updateCheckIntervalMinutes : defaults.updateCheckIntervalMinutes,
      proxyDomains: Array.isArray(parsed.proxyDomains)
        ? parsed.proxyDomains.filter((d): d is string => typeof d === 'string' && d.trim().length > 0).map((d) => d.trim().replace(/\/+$/, ''))
        : [],
      priceCheckEnabled: typeof parsed.priceCheckEnabled === 'boolean' ? parsed.priceCheckEnabled : defaults.priceCheckEnabled,
      priceCheckHotkey: typeof parsed.priceCheckHotkey === 'string' && parsed.priceCheckHotkey.trim() ? parsed.priceCheckHotkey.trim().slice(0, 64) : defaults.priceCheckHotkey,
    }
  } catch {
    return getDefaultAppSettings()
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

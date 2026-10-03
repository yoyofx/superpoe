import type { BuildRealm } from '@/types/tree'
import { mapSystemRealm } from '@/engine/systemLocale'

export type UpdateChannel = 'release' | 'dev'

export const MIN_UI_SCALE_PERCENT = 80
export const MAX_UI_SCALE_PERCENT = 150
export const DEFAULT_UI_SCALE_PERCENT = 100
export const UI_SCALE_STEP_PERCENT = 5

const APP_SETTINGS_STORAGE_KEY = 'superpoe-global-settings'
const UI_SCALE_PREFERENCE_VERSION = 1

export interface AppSettings {
  defaultRealm: BuildRealm
  gameDirectories: Record<BuildRealm, string>
  confirmUnsavedExit: boolean
  uiScalePercent: number
  updateChannel: UpdateChannel
  /** Update check interval in minutes */
  updateCheckIntervalMinutes: number
  /** User-configured GitHub proxy domains (unioned with built-in list) */
  proxyDomains: string[]
  priceCheckEnabled: boolean
  priceCheckHotkey: string
  /** Anonymous operation metrics; enabled by default and user-controllable. */
  analyticsEnabled: boolean
}

function getDefaultAppSettings(): AppSettings {
  return {
    defaultRealm: mapSystemRealm(),
    gameDirectories: { cn: '', global: '' },
    confirmUnsavedExit: true,
    uiScalePercent: DEFAULT_UI_SCALE_PERCENT,
    updateChannel: 'release',
    updateCheckIntervalMinutes: 60,
    proxyDomains: [],
    priceCheckEnabled: true,
    priceCheckHotkey: 'Ctrl+D',
    analyticsEnabled: true,
  }
}

interface SettingsStorage {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
}

interface StoredAppSettings extends Partial<AppSettings> {
  uiScalePreferenceVersion?: number
}

export function normalizeUiScalePercent(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_UI_SCALE_PERCENT
  const stepped = Math.round(value / UI_SCALE_STEP_PERCENT) * UI_SCALE_STEP_PERCENT
  return Math.min(MAX_UI_SCALE_PERCENT, Math.max(MIN_UI_SCALE_PERCENT, stepped))
}

export function loadAppSettings(storage: SettingsStorage | undefined = typeof localStorage === 'undefined' ? undefined : localStorage): AppSettings {
  if (!storage) return getDefaultAppSettings()
  try {
    const parsed = JSON.parse(storage.getItem(APP_SETTINGS_STORAGE_KEY) || '{}') as StoredAppSettings
    const defaults = getDefaultAppSettings()
    // 120% was previously shipped as the hard-coded default. Treat that old
    // unversioned value as the legacy default, while preserving values saved
    // after the user has explicitly chosen a scale.
    const hasLegacyDefaultScale = parsed.uiScalePreferenceVersion !== UI_SCALE_PREFERENCE_VERSION && parsed.uiScalePercent === 120
    return {
      defaultRealm: parsed.defaultRealm === 'cn' || parsed.defaultRealm === 'global' ? parsed.defaultRealm : defaults.defaultRealm,
      gameDirectories: {
        cn: typeof parsed.gameDirectories?.cn === 'string' ? parsed.gameDirectories.cn.trim().slice(0, 4_096) : defaults.gameDirectories.cn,
        global: typeof parsed.gameDirectories?.global === 'string' ? parsed.gameDirectories.global.trim().slice(0, 4_096) : defaults.gameDirectories.global,
      },
      confirmUnsavedExit: parsed.confirmUnsavedExit !== false,
      uiScalePercent: parsed.uiScalePercent === undefined || hasLegacyDefaultScale ? defaults.uiScalePercent : normalizeUiScalePercent(parsed.uiScalePercent),
      updateChannel: parsed.updateChannel === 'dev' ? 'dev' : parsed.updateChannel === 'release' ? 'release' : defaults.updateChannel,
      updateCheckIntervalMinutes: typeof parsed.updateCheckIntervalMinutes === 'number' && parsed.updateCheckIntervalMinutes >= 10 ? parsed.updateCheckIntervalMinutes : defaults.updateCheckIntervalMinutes,
      proxyDomains: Array.isArray(parsed.proxyDomains)
        ? parsed.proxyDomains.filter((d): d is string => typeof d === 'string' && d.trim().length > 0).map((d) => d.trim().replace(/\/+$/, ''))
        : [],
      priceCheckEnabled: typeof parsed.priceCheckEnabled === 'boolean' ? parsed.priceCheckEnabled : defaults.priceCheckEnabled,
      priceCheckHotkey: typeof parsed.priceCheckHotkey === 'string' && parsed.priceCheckHotkey.trim() ? parsed.priceCheckHotkey.trim().slice(0, 64) : defaults.priceCheckHotkey,
      analyticsEnabled: typeof parsed.analyticsEnabled === 'boolean' ? parsed.analyticsEnabled : defaults.analyticsEnabled,
    }
  } catch {
    return getDefaultAppSettings()
  }
}

export function saveAppSettings(settings: AppSettings, storage: SettingsStorage | undefined = typeof localStorage === 'undefined' ? undefined : localStorage): void {
  if (!storage) return
  try {
    storage.setItem(APP_SETTINGS_STORAGE_KEY, JSON.stringify({ ...settings, uiScalePreferenceVersion: UI_SCALE_PREFERENCE_VERSION }))
  } catch {
    // Keep the in-memory settings usable when persistent storage is unavailable.
  }
}

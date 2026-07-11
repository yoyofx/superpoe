const IMPORTED_BUILD_STORAGE_KEY = 'pob2-imported-build'

interface PersistedImportedBuild {
  hash: string
  code: string
}

export function readPersistedImportedBuild(storage: Storage, currentHash: string): string | null {
  try {
    const raw = storage.getItem(IMPORTED_BUILD_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<PersistedImportedBuild>
    return parsed.hash === currentHash && typeof parsed.code === 'string' && parsed.code
      ? parsed.code
      : null
  } catch {
    return null
  }
}

export function writePersistedImportedBuild(storage: Storage, hash: string, code: string | null): void {
  try {
    if (!hash || !code) {
      storage.removeItem(IMPORTED_BUILD_STORAGE_KEY)
      return
    }
    storage.setItem(IMPORTED_BUILD_STORAGE_KEY, JSON.stringify({ hash, code }))
  } catch {
    // Storage can be unavailable or full; the in-memory build remains usable.
  }
}

export function clearPersistedImportedBuild(storage: Storage): void {
  try { storage.removeItem(IMPORTED_BUILD_STORAGE_KEY) } catch {}
}

export function getInitialImportedBuildCode(): string | null {
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') return null
  return readPersistedImportedBuild(localStorage, window.location.hash.slice(1))
}

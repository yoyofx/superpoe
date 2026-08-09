import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { app } from 'electron'

function normalizeItemKey(value: string): string {
  return value.replace(/\{[^}]*\}/g, '').replace(/[^a-z0-9]+/gi, '').toLowerCase()
}

export class ItemIconIndex {
  private readonly lookup: Record<string, string> = {}

  constructor(indexPath?: string) {
    const filePath = indexPath || (app.isPackaged
      ? path.join(app.getAppPath(), 'dist', 'data', 'item-icons.json')
      : path.join(app.getAppPath(), 'public', 'data', 'item-icons.json'))
    if (!existsSync(filePath)) return
    try {
      const raw = readFileSync(filePath, 'utf8')
      if (raw.length > 50_000_000) return
      const parsed = JSON.parse(raw) as { lookup?: unknown }
      if (!parsed.lookup || typeof parsed.lookup !== 'object' || Array.isArray(parsed.lookup)) return
      for (const [key, value] of Object.entries(parsed.lookup)) {
        if (typeof value === 'string' && value) this.lookup[key] = value
      }
    } catch {
      // Missing presentation data must not prevent canonical item storage.
    }
  }

  resolve(rarity: string, name: string, baseType: string): string | undefined {
    const keys = rarity.toUpperCase() === 'UNIQUE' ? [name, baseType] : [baseType, name]
    for (const value of keys) {
      const exact = this.lookup[normalizeItemKey(value)]
      if (exact) return exact
    }
    for (const value of keys) {
      const normalized = normalizeItemKey(value)
      let bestKey = ''
      for (const key of Object.keys(this.lookup)) {
        if (key.length >= 6 && key.length > bestKey.length && normalized.includes(key)) bestKey = key
      }
      if (bestKey) return this.lookup[bestKey]
    }
    return undefined
  }
}

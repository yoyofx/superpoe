import type { CalcResult, SkillCalculationMode, SkillCalculationSelection } from '@/types/calc'

const CACHE_VERSION = 'calc-v2'
const MAX_ENTRIES = 32

export interface CalculationCacheKeyInput {
  code: string
  xml: string
  weaponSet: 1 | 2
  calcMode?: SkillCalculationMode
  configOverrides?: Record<string, boolean | number | string>
  selection?: SkillCalculationSelection
}

export interface CalculationCacheKeys {
  contextKey: string
  resultKey: string
}

interface CalculationCacheEntry {
  contextKey: string
  resultKey: string
  result: CalcResult
  lastUsedAt: number
}

function hashText(value: string): string {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

function stableConfig(config?: Record<string, boolean | number | string>): string {
  return Object.entries(config || {})
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${typeof value}:${String(value)}`)
    .join('|')
}

function selectionKey(selection?: SkillCalculationSelection): string {
  if (!selection) return ''
  return [
    selection.characterOnly ? 'character' : 'full',
    selection.skillGroupId || '',
    selection.calcMode || '',
    selection.activeSkillIndex ?? '',
    selection.skillPartIndex ?? '',
    selection.statSetIndex ?? '',
    selection.actor || '',
    selection.minionSkillIndex ?? '',
    selection.minionStatSetIndex ?? '',
    selection.includeConfig ? 'config' : '',
  ].join(':')
}

export function createCalculationCacheKeys(input: CalculationCacheKeyInput): CalculationCacheKeys {
  const buildFingerprint = hashText(`${input.code}\u0000${input.xml}`)
  const contextSource = [
    CACHE_VERSION,
    buildFingerprint,
    input.weaponSet,
    input.calcMode || '',
    input.selection?.characterOnly ? 'character' : 'full',
    stableConfig(input.configOverrides),
  ].join('|')
  const contextKey = hashText(contextSource)
  const resultKey = hashText(`${contextKey}|${selectionKey(input.selection)}`)
  return { contextKey, resultKey }
}

class CalculationCache {
  private readonly entries = new Map<string, CalculationCacheEntry>()

  get(resultKey: string): CalcResult | null {
    const entry = this.entries.get(resultKey)
    if (!entry) return null
    entry.lastUsedAt = Date.now()
    return entry.result
  }

  getContextResult(contextKey: string): CalcResult | null {
    let newest: CalculationCacheEntry | null = null
    for (const entry of this.entries.values()) {
      if (entry.contextKey !== contextKey) continue
      if (!newest || entry.lastUsedAt > newest.lastUsedAt) newest = entry
    }
    if (!newest) return null
    newest.lastUsedAt = Date.now()
    return newest.result
  }

  set(keys: CalculationCacheKeys, result: CalcResult): void {
    this.entries.set(keys.resultKey, {
      contextKey: keys.contextKey,
      resultKey: keys.resultKey,
      result,
      lastUsedAt: Date.now(),
    })
    while (this.entries.size > MAX_ENTRIES) {
      const oldest = [...this.entries.values()].sort((left, right) => left.lastUsedAt - right.lastUsedAt)[0]
      if (!oldest) break
      this.entries.delete(oldest.resultKey)
    }
  }

  clear(): void {
    this.entries.clear()
  }
}

export const calculationCache = new CalculationCache()

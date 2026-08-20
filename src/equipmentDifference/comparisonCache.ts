import type { EquipmentDifferenceResult, EquipmentDifferenceRequest } from './types'

const CACHE_VERSION = 'equipment-difference-v1'
const MAX_ENTRIES = 64

export interface EquipmentDifferenceCacheKeys {
  contextKey: string
  candidateKey: string
}

function hashText(value: string): string {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

function stableValues(values: Record<string, boolean | number | string> | undefined): string {
  return Object.entries(values || {})
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => key + '=' + typeof value + ':' + String(value))
    .join('|')
}

export function createEquipmentDifferenceCacheKeys(
  request: EquipmentDifferenceRequest,
): EquipmentDifferenceCacheKeys {
  const context = request.context
  const contextSource = [
    CACHE_VERSION,
    hashText(context.xml),
    context.buildRevision,
    context.activeItemSetId,
    context.activeWeaponSet,
    context.buildItemId || '',
    context.configFingerprint || '',
    stableValues(context.configOverrides),
    context.activeSkillContext?.skillGroupId || '',
    context.activeSkillContext?.calcMode || '',
  ].join('|')
  const contextKey = hashText(contextSource)
  const weightSource = (request.weightSpec || []).map((weight) => ({
    stat: weight.stat,
    weightMult: weight.weightMult,
    lowerIsBetter: weight.lowerIsBetter === true,
  }))
  const candidateSource = [
    contextKey,
    hashText(request.candidate.raw),
    request.candidate.buildItemId || '',
    request.candidate.source,
    request.candidate.runeBehavior || '',
    request.candidate.anointBehavior || '',
    request.sourceSlotName || '',
    request.slotOnlyTooltips ? 'slot-only' : 'all-slots',
    JSON.stringify(weightSource),
  ].join('|')
  return { contextKey, candidateKey: hashText(candidateSource) }
}

class EquipmentDifferenceCache {
  private readonly entries = new Map<string, { contextKey: string; result: EquipmentDifferenceResult; lastUsedAt: number }>()

  get(keys: EquipmentDifferenceCacheKeys): EquipmentDifferenceResult | null {
    const entry = this.entries.get(keys.candidateKey)
    if (!entry || entry.contextKey !== keys.contextKey) return null
    entry.lastUsedAt = Date.now()
    return entry.result
  }

  set(keys: EquipmentDifferenceCacheKeys, result: EquipmentDifferenceResult): void {
    this.entries.set(keys.candidateKey, {
      contextKey: keys.contextKey,
      result,
      lastUsedAt: Date.now(),
    })
    while (this.entries.size > MAX_ENTRIES) {
      const oldest = [...this.entries.entries()]
        .sort(([, left], [, right]) => left.lastUsedAt - right.lastUsedAt)[0]
      if (!oldest) break
      this.entries.delete(oldest[0])
    }
  }

  clear(): void {
    this.entries.clear()
  }
}

export const equipmentDifferenceCache = new EquipmentDifferenceCache()

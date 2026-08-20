import type { EquipmentItem } from '@/types/equipment'
import { parseEquipmentItemRaw } from './equipment'
import { resolveItemBaseData, type ItemBaseData } from './itemBaseData'

export type ItemDisplayStatTone = 'physical' | 'fire' | 'cold' | 'lightning' | 'chaos' | 'magic'

export interface ItemDisplayStatSegment {
  value: string
  tone: ItemDisplayStatTone
}

export interface ItemDisplayStat {
  key: string
  value: string
  tone?: ItemDisplayStatTone
  augmented?: boolean
  segments?: ItemDisplayStatSegment[]
}

export interface ItemDisplayRequirements {
  str?: number
  dex?: number
  int?: number
}

export interface WeaponComparisonStat {
  key: 'APS' | 'DPS' | 'pDPS' | 'eDPS'
  value: string
}

function clean(text: string) {
  return text.replace(/\{[^}]+\}/g, '').trim()
}

function sumMatches(lines: string[], pattern: RegExp): number {
  let total = 0
  for (const line of lines) {
    const match = clean(line).match(pattern)
    if (match) total += Number(match[1])
  }
  return total
}

function addedDamage(lines: string[], type: string): [number, number] {
  let min = 0
  let max = 0
  const pattern = new RegExp(`Adds\\s+(\\d+(?:\\.\\d+)?)\\s+to\\s+(\\d+(?:\\.\\d+)?)\\s+${type}\\s+Damage`, 'i')
  for (const line of lines) {
    const match = clean(line).match(pattern)
    if (match) {
      min += Number(match[1])
      max += Number(match[2])
    }
  }
  return [min, max]
}

function integer(value: number) {
  return String(Math.floor(value + 1e-7))
}

function roundedInteger(value: number) {
  return String(Math.round(value))
}

function decimal(value: number) {
  return value.toFixed(2).replace(/\.00$/, '')
}

type DefenceField = 'Armour' | 'Evasion' | 'EnergyShield' | 'Ward'

function normaliseDefenceTarget(value: string): DefenceField | undefined {
  const target = value.trim().replace(/\s+Rating$/i, '').toLowerCase()
  if (target === 'armour') return 'Armour'
  if (target === 'evasion') return 'Evasion'
  if (target === 'energy shield') return 'EnergyShield'
  if (target === 'ward' || target === 'runic ward') return 'Ward'
  return undefined
}

function defenceTargets(value: string): Set<DefenceField> {
  const targets = value
    .replace(/,/g, ' and ')
    .split(/\s+and\s+/i)
    .map(normaliseDefenceTarget)
    .filter((target): target is DefenceField => !!target)
  return new Set(targets)
}

function defenceModifier(lines: string[], field: DefenceField, kind: 'increased' | 'flat'): number {
  let total = 0
  const pattern = kind === 'increased'
    ? /^(\d+(?:\.\d+)?)% increased (.+)$/i
    : /^\+(\d+(?:\.\d+)?) (?:to )?(.+)$/i
  for (const line of lines) {
    const match = clean(line).match(pattern)
    if (match && defenceTargets(match[2]).has(field)) total += Number(match[1])
  }
  return total
}

function itemQuality(item: EquipmentItem): number {
  return Number(item.quality?.replace(/[^\d.-]/g, '') || 0)
}

export function deriveWeaponComparisonStats(item: EquipmentItem, base?: ItemBaseData): WeaponComparisonStat[] {
  const weapon = base?.weapon
  if (!weapon?.AttackRateBase || base?.type === 'Fishing Rod') return []

  const lines = item.modifiers?.map((modifier) => modifier.text) || item.lines.map(clean)
  const attackSpeed = sumMatches(lines, /^(\d+(?:\.\d+)?)% increased Attack Speed$/i)
  const attacks = weapon.AttackRateBase * (1 + attackSpeed / 100)
  if (attacks <= 0) return []

  const result: WeaponComparisonStat[] = [{ key: 'APS', value: decimal(attacks) }]
  const quality = itemQuality(item)
  const physicalIncrease = sumMatches(lines, /^(\d+(?:\.\d+)?)% increased Physical Damage$/i)
  const addedPhysical = addedDamage(lines, 'Physical')
  const physicalMultiplier = (1 + physicalIncrease / 100) * (1 + quality / 100)
  const physicalMin = Math.round(((weapon.PhysicalMin || 0) + addedPhysical[0]) * physicalMultiplier)
  const physicalMax = Math.round(((weapon.PhysicalMax || 0) + addedPhysical[1]) * physicalMultiplier)
  const physicalDps = (physicalMin + physicalMax) / 2 * attacks
  let elementalDps = 0
  for (const type of ['Fire', 'Cold', 'Lightning']) {
    const added = addedDamage(lines, type)
    const min = (weapon[`${type}Min`] || 0) + added[0]
    const max = (weapon[`${type}Max`] || 0) + added[1]
    elementalDps += (min + max) / 2 * attacks
  }
  const addedChaos = addedDamage(lines, 'Chaos')
  const chaosMin = (weapon.ChaosMin || 0) + addedChaos[0]
  const chaosMax = (weapon.ChaosMax || 0) + addedChaos[1]
  const chaosDps = (chaosMin + chaosMax) / 2 * attacks
  const totalDps = physicalDps + elementalDps + chaosDps

  if (totalDps > 0) result.push({ key: 'DPS', value: totalDps.toFixed(1) })
  if (physicalDps > 0) result.push({ key: 'pDPS', value: physicalDps.toFixed(1) })
  if (elementalDps > 0) result.push({ key: 'eDPS', value: elementalDps.toFixed(1) })

  return result
}

/**
 * Derive the local weapon DPS metrics used by library cards from persisted PoB
 * item text. This deliberately stays independent of the active build and its
 * calculation runtime.
 */
export function deriveWeaponComparisonStatsFromRaw(
  raw: string,
  bases: Record<string, ItemBaseData>,
  id = 'library-item',
): WeaponComparisonStat[] {
  if (!raw.trim()) return []
  const item = parseEquipmentItemRaw(raw, id)
  return deriveWeaponComparisonStats(item, resolveItemBaseData(item.baseType, bases))
}

export function deriveItemDisplayRequirements(item: EquipmentItem, base?: ItemBaseData): ItemDisplayRequirements {
  const quality = itemQuality(item)
  const qualityMultiplier = Math.max(0, 1 - quality * 0.004)
  const requirements = base?.requirements || {}
  const result: ItemDisplayRequirements = {}

  for (const field of ['str', 'dex', 'int'] as const) {
    const value = requirements[field]
    if (value) result[field] = Math.round(value * qualityMultiplier)
  }
  return result
}

export function deriveItemDisplayStats(item: EquipmentItem, base?: ItemBaseData): ItemDisplayStat[] {
  const lines = item.modifiers?.map((modifier) => modifier.text) || item.lines.map(clean)
  const quality = itemQuality(item)
  const result: ItemDisplayStat[] = []

  if (item.quality) {
    result.push({ key: 'quality', value: item.quality, tone: quality ? 'magic' : undefined, augmented: quality !== 0 })
  }
  if (!base) return result

  if (base.weapon) {
    const weapon = base.weapon
    const physicalIncrease = sumMatches(lines, /^(\d+(?:\.\d+)?)% increased Physical Damage$/i)
    const addedPhysical = addedDamage(lines, 'Physical')
    const physicalMin = (weapon.PhysicalMin || 0) + addedPhysical[0]
    const physicalMax = (weapon.PhysicalMax || 0) + addedPhysical[1]
    if (physicalMax > 0) {
      result.push({
        key: 'physicalDamage',
        value: `${roundedInteger(physicalMin * (1 + physicalIncrease / 100) * (1 + quality / 100))}-${roundedInteger(physicalMax * (1 + physicalIncrease / 100) * (1 + quality / 100))}`,
        tone: 'physical',
        augmented: quality !== 0 || physicalIncrease !== 0 || addedPhysical[0] !== 0 || addedPhysical[1] !== 0,
      })
    }

    const elementalSegments: ItemDisplayStatSegment[] = []
    for (const [type, tone] of [['Fire', 'fire'], ['Cold', 'cold'], ['Lightning', 'lightning']] as const) {
      const added = addedDamage(lines, type)
      const min = (weapon[`${type}Min`] || 0) + added[0]
      const max = (weapon[`${type}Max`] || 0) + added[1]
      if (max > 0) elementalSegments.push({ value: `${integer(min)}-${integer(max)}`, tone })
    }
    if (elementalSegments.length) {
      result.push({
        key: 'elementalDamage',
        value: elementalSegments.map((segment) => segment.value).join(', '),
        segments: elementalSegments,
      })
    }
    const addedChaos = addedDamage(lines, 'Chaos')
    const chaosMin = (weapon.ChaosMin || 0) + addedChaos[0]
    const chaosMax = (weapon.ChaosMax || 0) + addedChaos[1]
    if (chaosMax > 0) result.push({ key: 'chaosDamage', value: `${integer(chaosMin)}-${integer(chaosMax)}`, tone: 'chaos' })

    const flatCrit = sumMatches(lines, /^\+(\d+(?:\.\d+)?)% to Critical Hit Chance$/i)
    const increasedCrit = sumMatches(lines, /^(\d+(?:\.\d+)?)% increased Critical Hit Chance$/i)
    const crit = (weapon.CritChanceBase || 0) * (1 + increasedCrit / 100) + flatCrit
    if (crit > 0) result.push({
      key: 'criticalHitChance',
      value: `${decimal(crit)}%`,
      tone: flatCrit || increasedCrit ? 'magic' : undefined,
      augmented: !!(flatCrit || increasedCrit),
    })

    const attackSpeed = sumMatches(lines, /^(\d+(?:\.\d+)?)% increased Attack Speed$/i)
    const attacks = (weapon.AttackRateBase || 0) * (1 + attackSpeed / 100)
    if (attacks > 0) result.push({
      key: 'attacksPerSecond',
      value: decimal(attacks),
      tone: attackSpeed ? 'magic' : undefined,
      augmented: !!attackSpeed,
    })
    if (weapon.ReloadTimeBase) result.push({ key: 'reloadTime', value: decimal(weapon.ReloadTimeBase) })
  } else if (base.armour) {
    const fields = [
      ['BlockChance', 'blockChance', 'Chance to Block'],
      ['Armour', 'armour'],
      ['Evasion', 'evasion'],
      ['EnergyShield', 'energyShield'],
      ['Ward', 'runicWard'],
    ] as const
    for (const [field, key] of fields) {
      const baseValue = base.armour[field] || 0
      if (!baseValue) continue
      if (field === 'BlockChance') {
        const added = sumMatches(lines, /^\+(\d+(?:\.\d+)?)% to Block chance$/i)
        result.push({ key, value: `${integer(baseValue + added)}%`, tone: added ? 'magic' : undefined })
        continue
      }
      const increase = defenceModifier(lines, field, 'increased')
      const added = defenceModifier(lines, field, 'flat')
      result.push({
        key,
        value: roundedInteger((baseValue + added) * (1 + increase / 100) * (1 + quality / 100)),
        tone: quality || increase || added ? 'magic' : undefined,
        augmented: !!(quality || increase || added),
      })
    }
  } else if (base.flask) {
    if (base.flask.life) result.push({ key: 'lifeRecovery', value: integer(base.flask.life) })
    if (base.flask.mana) result.push({ key: 'manaRecovery', value: integer(base.flask.mana) })
    if (base.flask.duration) result.push({ key: 'duration', value: `${decimal(base.flask.duration)}s` })
    if (base.flask.chargesUsed && base.flask.chargesMax) result.push({ key: 'charges', value: `${base.flask.chargesUsed} / ${base.flask.chargesMax}` })
  } else if (base.charm) {
    if (base.charm.duration) result.push({ key: 'duration', value: `${decimal(base.charm.duration)}s` })
    if (base.charm.chargesUsed && base.charm.chargesMax) result.push({ key: 'charges', value: `${base.charm.chargesUsed} / ${base.charm.chargesMax}` })
  }

  return result
}

import type { EquipmentItem } from '@/types/equipment'
import type { ItemBaseData } from './itemBaseData'

export type ItemDisplayStatTone = 'physical' | 'fire' | 'cold' | 'lightning' | 'chaos' | 'magic'

export interface ItemDisplayStat {
  key: string
  value: string
  tone?: ItemDisplayStatTone
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

function decimal(value: number) {
  return value.toFixed(2).replace(/\.00$/, '')
}

export function deriveItemDisplayStats(item: EquipmentItem, base?: ItemBaseData): ItemDisplayStat[] {
  if (!base) return []
  const lines = item.modifiers?.map((modifier) => modifier.text) || item.lines.map(clean)
  const quality = Number(item.quality?.replace(/[^\d.-]/g, '') || 0)
  const result: ItemDisplayStat[] = []

  if (base.weapon) {
    const weapon = base.weapon
    const physicalIncrease = quality + sumMatches(lines, /^(\d+(?:\.\d+)?)% increased Physical Damage$/i)
    const addedPhysical = addedDamage(lines, 'Physical')
    const physicalMin = (weapon.PhysicalMin || 0) + addedPhysical[0]
    const physicalMax = (weapon.PhysicalMax || 0) + addedPhysical[1]
    if (physicalMax > 0) {
      result.push({
        key: 'physicalDamage',
        value: `${integer(physicalMin * (1 + physicalIncrease / 100))}-${integer(physicalMax * (1 + physicalIncrease / 100))}`,
        tone: 'physical',
      })
    }

    for (const [type, tone] of [['Fire', 'fire'], ['Cold', 'cold'], ['Lightning', 'lightning'], ['Chaos', 'chaos']] as const) {
      const added = addedDamage(lines, type)
      const min = (weapon[`${type}Min`] || 0) + added[0]
      const max = (weapon[`${type}Max`] || 0) + added[1]
      if (max > 0) result.push({ key: `${type.toLowerCase()}Damage`, value: `${integer(min)}-${integer(max)}`, tone })
    }

    const flatCrit = sumMatches(lines, /^\+(\d+(?:\.\d+)?)% to Critical Hit Chance$/i)
    const increasedCrit = sumMatches(lines, /^(\d+(?:\.\d+)?)% increased Critical Hit Chance$/i)
    const crit = (weapon.CritChanceBase || 0) * (1 + increasedCrit / 100) + flatCrit
    if (crit > 0) result.push({ key: 'criticalHitChance', value: `${decimal(crit)}%`, tone: flatCrit || increasedCrit ? 'magic' : undefined })

    const attackSpeed = sumMatches(lines, /^(\d+(?:\.\d+)?)% increased Attack Speed$/i)
    const attacks = (weapon.AttackRateBase || 0) * (1 + attackSpeed / 100)
    if (attacks > 0) result.push({ key: 'attacksPerSecond', value: decimal(attacks), tone: attackSpeed ? 'magic' : undefined })
    if (weapon.ReloadTimeBase) result.push({ key: 'reloadTime', value: decimal(weapon.ReloadTimeBase) })
    if (weapon.Range && weapon.Range < 120) result.push({ key: 'weaponRange', value: decimal(weapon.Range / 10) })
  } else if (base.armour) {
    const fields = [
      ['BlockChance', 'blockChance', 'Chance to Block'],
      ['Armour', 'armour', 'Armour'],
      ['Evasion', 'evasion', 'Evasion Rating'],
      ['EnergyShield', 'energyShield', 'Energy Shield'],
      ['Ward', 'runicWard', 'Runic Ward'],
    ] as const
    for (const [field, key, englishName] of fields) {
      const baseValue = base.armour[field] || 0
      if (!baseValue) continue
      if (field === 'BlockChance') {
        const added = sumMatches(lines, /^\+(\d+(?:\.\d+)?)% to Block chance$/i)
        result.push({ key, value: `${integer(baseValue + added)}%`, tone: added ? 'magic' : undefined })
        continue
      }
      const increase = quality + sumMatches(lines, new RegExp(`^(\\d+(?:\\.\\d+)?)% increased ${englishName}$`, 'i'))
      const added = sumMatches(lines, new RegExp(`^\\+(\\d+(?:\\.\\d+)?) ${englishName}$`, 'i'))
      result.push({ key, value: integer((baseValue + added) * (1 + increase / 100)), tone: increase || added ? 'magic' : undefined })
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

import type { EquipmentItem, EquipmentSlot } from '@/types/equipment'
import type { EquipmentAffixCategory, EquipmentAffixSource, EquipmentAffixSummary } from '@/engine/equipmentAffixes'
import type {
  EquipmentItemSemantics,
  EquipmentSemanticModifier,
} from '@/types/equipmentSemantics'

export type EquipmentSemanticView = 'offence' | 'defence'

const OFFENCE_NAME = /Damage|Speed|Crit|Accuracy|Penetrat|Skill|Level|Poison|Bleed|Ignite|Ailment|Hit|Projectile|AreaOfEffect|Leech/i
const FLAT_DAMAGE_NAME = /^(?:Physical|Fire|Cold|Lightning|Chaos)(?:Min|Max)$/i
const DEFENCE_NAME = /DamageTaken|^(?:Life|Mana|Spirit|EnergyShield)(?:$|Max|Regen|Recovery|Recharge)|Armour|Evasion|Ward|Guard|Resist|Block|Defen|Recovery|Regen|Recharge|StunThreshold|Attribute|Strength|Dexterity|Intelligence|Requirement/i

function modifierView(modifier: EquipmentSemanticModifier): EquipmentSemanticView | null {
  if (modifier.scope !== 'global') return null
  if (DEFENCE_NAME.test(modifier.name)) return 'defence'
  if (OFFENCE_NAME.test(modifier.name) || FLAT_DAMAGE_NAME.test(modifier.name)
    || modifier.flags.some((flag) => ['Attack', 'Spell', 'Hit', 'Dot', 'Cast', 'Projectile', 'Melee', 'Ailment'].includes(flag))
    || modifier.keywordFlags.some((flag) => ['Attack', 'Spell', 'Hit', 'Ailment', 'Poison', 'Bleed', 'Ignite'].includes(flag))) return 'offence'
  return null
}

function categoryFor(modifiers: EquipmentSemanticModifier[], view: EquipmentSemanticView): EquipmentAffixCategory {
  if (view === 'offence') {
    if (modifiers.some((modifier) => /Skill|Level/i.test(modifier.name))) return 'skillLevels'
    if (modifiers.some((modifier) => /Min$|Max$/i.test(modifier.name))) return 'addedDamage'
    return 'offence'
  }
  if (modifiers.some((modifier) => /Resist/i.test(modifier.name))) return 'resistances'
  if (modifiers.some((modifier) => /Life|Mana|Spirit|EnergyShield/i.test(modifier.name))) return 'resources'
  if (modifiers.some((modifier) => /Attribute|Strength|Dexterity|Intelligence/i.test(modifier.name))) return 'attributes'
  return 'defences'
}

function semanticKey(modifiers: EquipmentSemanticModifier[], line: string): string {
  return modifiers.map((modifier) => JSON.stringify({
    name: modifier.name,
    type: modifier.type,
    flags: modifier.flags,
    keywordFlags: modifier.keywordFlags,
    tags: modifier.tags,
    nonScalarLine: modifier.value == null || modifier.type === 'LIST' ? line : undefined,
  })).join('|')
}

function formatNumber(value: number, signed: boolean): string {
  const rounded = Math.round(value * 100) / 100
  return `${signed && rounded > 0 ? '+' : ''}${rounded}`
}

function replaceModifierValues(text: string, original: number[], totals: number[]): string {
  let output = text
  original.forEach((value, index) => {
    const signed = value > 0 && output.includes(`+${value}`)
    const escaped = String(value).replace('.', '\\.')
    output = output.replace(new RegExp(`(^|[^\\d.])([+-]?)${escaped}(?=$|[^\\d.])`), (_match, prefix: string) => (
      `${prefix}${formatNumber(totals[index], signed)}`
    ))
  })
  return output
}

export function aggregateEquipmentSemantics(
  slots: EquipmentSlot[],
  itemsById: Record<string, EquipmentItem>,
  semanticsById: Record<string, EquipmentItemSemantics>,
  view: EquipmentSemanticView,
): EquipmentAffixSummary[] {
  const aggregated = new Map<string, {
    summary: EquipmentAffixSummary
    originalValues: number[]
    totals: number[]
    template: string
  }>()

  for (const slot of slots) {
    const item = itemsById[slot.itemId]
    const semantics = semanticsById[slot.itemId]
    if (!slot.active || !item || !semantics) continue

    for (const line of semantics.lines) {
      const modifiers = line.modifiers.filter((modifier) => modifierView(modifier) === view)
      if (!modifiers.length) continue
      const sourceScope = /^Flask\s+\d+$/i.test(slot.name)
        ? 'flask'
        : /^Charm\s+\d+$/i.test(slot.name) ? 'charm' : 'gear'
      const key = `${sourceScope}|${view}|${semanticKey(modifiers, line.text)}`
      const source: EquipmentAffixSource = {
        itemId: item.id,
        itemName: item.name,
        slotName: slot.name,
        line: line.text,
        rune: line.group === 'rune',
      }
      const numericValues = modifiers.map((modifier) => typeof modifier.value === 'number' ? modifier.value : 0)
      const current = aggregated.get(key)
      if (current) {
        current.summary.sources.push(source)
        current.totals = current.totals.map((value, index) => value + numericValues[index])
        current.summary.text = replaceModifierValues(current.template, current.originalValues, current.totals)
      } else {
        aggregated.set(key, {
          summary: { key, category: categoryFor(modifiers, view), text: line.text, sources: [source] },
          originalValues: numericValues,
          totals: [...numericValues],
          template: line.text,
        })
      }
    }
  }

  return [...aggregated.values()].map(({ summary }) => summary)
}

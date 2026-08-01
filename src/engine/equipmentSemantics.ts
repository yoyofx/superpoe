import type { EquipmentItem, EquipmentSlot } from '@/types/equipment'
import { aggregateEquipmentAffixes } from '@/engine/equipmentAffixes'
import type {
  EquipmentAffixCategory,
  EquipmentAffixSemanticGroup,
  EquipmentAffixSource,
  EquipmentAffixSummary,
} from '@/engine/equipmentAffixes'
import type {
  EquipmentItemSemantics,
  EquipmentModifierRecipient,
  EquipmentSemanticModifier,
} from '@/types/equipmentSemantics'

export type EquipmentSemanticView = 'offence' | 'defence'

const OFFENCE_NAME = /Damage|Speed|Crit|Accuracy|Penetrat|Skill|Level|Poison|Bleed|Ignite|Ailment|Hit|Projectile|AreaOfEffect|Leech|Minion|Companion|Ally/i
const FLAT_DAMAGE_NAME = /^(?:Physical|Fire|Cold|Lightning|Chaos)(?:Min|Max)$/i
const DEFENCE_NAME = /DamageTaken|^PhysicalDamageReduction$|^ReduceCritExtraDamage$|^(?:Life|Mana|Spirit|EnergyShield)(?:$|Max|Regen|Recovery|Recharge)|Armour|Evasion|Ward|Guard|Resist|Block|Defen|Recovery|Regen|Recharge|StunThreshold|Attribute|Strength|Dexterity|Intelligence|Requirement/i

function modifierView(modifier: EquipmentSemanticModifier): EquipmentSemanticView | null {
  if (/MovementSpeed/i.test(modifier.name)) return null
  if (modifier.recipient === 'enemy' && /Resist|DamageTaken|Armour|StunThreshold/i.test(modifier.name)) return 'offence'
  if (DEFENCE_NAME.test(modifier.name)) return 'defence'
  if (OFFENCE_NAME.test(modifier.name) || FLAT_DAMAGE_NAME.test(modifier.name)
    || modifier.flags.some((flag) => ['Attack', 'Spell', 'Hit', 'Dot', 'Cast', 'Projectile', 'Melee', 'Ailment'].includes(flag))
    || modifier.keywordFlags.some((flag) => ['Attack', 'Spell', 'Hit', 'Ailment', 'Poison', 'Bleed', 'Ignite'].includes(flag))) return 'offence'
  return null
}

function semanticGroupFor(modifiers: EquipmentSemanticModifier[], line: string): EquipmentAffixSemanticGroup {
  if (modifiers.some((modifier) => FLAT_DAMAGE_NAME.test(modifier.name))) return 'flatDamage'
  if (modifiers.some((modifier) => /GainAs/i.test(modifier.name)) || /\bGain\b.+\bas Extra\b/i.test(line)) return 'gain'
  if (modifiers.some((modifier) => modifier.type === 'MORE') || /\b(?:more|less)\b.+\bDamage\b/i.test(line)) return 'moreLess'
  if (/^Grants Skill:/i.test(line)) return 'grantedSkills'
  if (modifiers.some((modifier) => /SkillLevel|(?:^|[^a-z])Level/i.test(modifier.name))) return 'skillLevels'
  if (modifiers.some((modifier) => /Speed/i.test(modifier.name))) return 'speed'
  if (modifiers.some((modifier) => /Crit/i.test(modifier.name))) return 'critical'
  if (/\benem(?:y|ies)\b.*\bresist/i.test(line) || modifiers.some((modifier) => /Accuracy|Penetrat|ArmourBreak|IgnoreArmour|Enemy.*Resist/i.test(modifier.name)
    || (modifier.recipient === 'enemy' && /Resist|Armour|StunThreshold/i.test(modifier.name)))) return 'accuracyPenetration'
  if (modifiers.some((modifier) => /Poison|Bleed|Ignite|Ailment|DamageOverTime|Dot/i.test(modifier.name))) return 'ailments'
  if (modifiers.some((modifier) => modifier.type === 'INC' && /Damage/i.test(modifier.name))) return 'increased'
  return 'offenceOther'
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

function normalizedFlags(modifier: EquipmentSemanticModifier, semantics: EquipmentItemSemantics): string[] {
  const flags = new Set([...modifier.flags, ...modifier.keywordFlags])
  if (semantics.isWeapon && modifier.scope === 'local') flags.add('Attack')
  return [...flags].sort()
}

function semanticKey(modifiers: EquipmentSemanticModifier[], line: string, semantics: EquipmentItemSemantics): string {
  const valueUnit = /%/.test(line) ? 'percent' : 'flat'
  return `${valueUnit}|${modifiers.map((modifier) => JSON.stringify({
    name: modifier.name.replace(/^Local(?=[A-Z])/, ''),
    type: modifier.type,
    recipient: modifier.recipient,
    scopeFlags: normalizedFlags(modifier, semantics),
    tags: modifier.tags,
    nonScalarLine: modifier.value == null || modifier.type === 'LIST' ? line : undefined,
  })).join('|')}`
}

function flatDamageDescriptor(modifiers: EquipmentSemanticModifier[], semantics: EquipmentItemSemantics): {
  type: string
  scope: 'attack' | 'spell' | 'other'
  recipient: EquipmentModifierRecipient
  minIndex: number
  maxIndex: number
} | null {
  const minIndex = modifiers.findIndex((modifier) => /Min$/i.test(modifier.name))
  const maxIndex = modifiers.findIndex((modifier) => /Max$/i.test(modifier.name))
  if (minIndex < 0 || maxIndex < 0) return null
  const recipient = modifiers[minIndex].recipient
  if (modifiers[maxIndex].recipient !== recipient) return null
  const type = modifiers[minIndex].name.replace(/Min$/i, '').replace(/^Local/, '')
  const flags = new Set(modifiers.flatMap((modifier) => normalizedFlags(modifier, semantics)))
  const scope = flags.has('Spell') ? 'spell' : flags.has('Attack') ? 'attack' : 'other'
  return { type, scope, recipient, minIndex, maxIndex }
}

function commonRecipient(modifiers: EquipmentSemanticModifier[]): EquipmentModifierRecipient | undefined {
  const recipients = new Set(modifiers.map((modifier) => modifier.recipient))
  return recipients.size === 1 ? modifiers[0].recipient : undefined
}

function renderFlatDamage(type: string, scope: 'attack' | 'spell' | 'other', min: number, max: number): string {
  const target = scope === 'attack' ? ' to Attacks' : scope === 'spell' ? ' to Spells' : ''
  return `Adds ${formatNumber(min, false)} to ${formatNumber(max, false)} ${type} Damage${target}`
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

function sourceLineKey(itemId: string, line: string): string {
  return `${itemId}|${line.replace(/\{[^}]+\}/g, '').replace(/\s+/g, ' ').trim().toLowerCase()}`
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
      const enemyResistanceLine = /\benem(?:y|ies)\b.*\bresist/i.test(line.text)
      const modifiers = line.modifiers.filter((modifier) => (
        (enemyResistanceLine ? 'offence' : modifierView(modifier)) === view
      ))
      if (!modifiers.length) continue
      const semanticGroup = view === 'offence' ? semanticGroupFor(modifiers, line.text) : undefined
      const flatDamage = semanticGroup === 'flatDamage' ? flatDamageDescriptor(modifiers, semantics) : null
      const key = flatDamage
        ? `${view}|flatDamage|${flatDamage.recipient}|${flatDamage.type}|${flatDamage.scope}`
        : `${view}|${semanticGroup || 'defence'}|${semanticKey(modifiers, line.text, semantics)}`
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
        current.summary.text = flatDamage
          ? renderFlatDamage(flatDamage.type, flatDamage.scope, current.totals[flatDamage.minIndex], current.totals[flatDamage.maxIndex])
          : replaceModifierValues(current.template, current.originalValues, current.totals)
      } else {
        aggregated.set(key, {
          summary: {
            key,
            category: categoryFor(modifiers, view),
            semanticGroup,
            recipient: flatDamage?.recipient || commonRecipient(modifiers),
            text: flatDamage
              ? renderFlatDamage(flatDamage.type, flatDamage.scope, numericValues[flatDamage.minIndex], numericValues[flatDamage.maxIndex])
              : line.text,
            sources: [source],
          },
          originalValues: numericValues,
          totals: [...numericValues],
          template: line.text,
        })
      }
    }
  }

  const summaries = [...aggregated.values()].map(({ summary }) => summary)
  if (view !== 'defence') return summaries

  const coveredLines = new Set(summaries.flatMap((summary) => (
    summary.sources.map((source) => sourceLineKey(source.itemId, source.line))
  )))
  const fallback = aggregateEquipmentAffixes(slots, itemsById).filter((summary) => (
    summary.category === 'resistances'
    && !/\benem(?:y|ies)\b/i.test(summary.text)
    && summary.sources.every((source) => !coveredLines.has(sourceLineKey(source.itemId, source.line)))
  ))
  return [...summaries, ...fallback]
}

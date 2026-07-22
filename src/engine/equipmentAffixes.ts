import type { EquipmentItem, EquipmentSlot } from '@/types/equipment'

export type EquipmentAffixCategory = 'attributes' | 'resources' | 'resistances' | 'defences' | 'addedDamage' | 'skillLevels' | 'offence' | 'utility' | 'special'

export interface EquipmentAffixSource {
  itemId: string
  itemName: string
  slotName: string
  line: string
  rune: boolean
}

export interface EquipmentAffixSummary {
  key: string
  category: EquipmentAffixCategory
  text: string
  sources: EquipmentAffixSource[]
}

interface NumericAffix {
  key: string
  render: (first: number, second?: number) => string
  first: number
  second?: number
}

const TAG_PATTERN = /\{([^}]+)\}/g
const NUMBER = '[+-]?\\d+(?:\\.\\d+)?'

function cleanAffixLine(line: string): { text: string; rune: boolean } {
  let rune = false
  const text = line.replace(TAG_PATTERN, (_match, tag: string) => {
    if (tag.toLowerCase() === 'rune') rune = true
    return ''
  }).replace(/\s+/g, ' ').trim()
  return { text, rune }
}

function formatNumber(value: number, forcePlus: boolean): string {
  const rounded = Math.round(value * 100) / 100
  const text = Number.isInteger(rounded) ? String(rounded) : String(rounded).replace(/0+$/, '').replace(/\.$/, '')
  return forcePlus && rounded > 0 ? `+${text}` : text
}

function parseNumericAffix(text: string): NumericAffix | null {
  const range = text.match(new RegExp(`^(Adds\\s+)?(${NUMBER})\\s+to\\s+(${NUMBER})(.*)$`, 'i'))
  if (range) {
    const prefix = range[1] || ''
    const firstToken = range[2]
    const secondToken = range[3]
    const suffix = range[4]
    return {
      key: `range|${prefix.toLowerCase()}|${suffix.toLowerCase()}`,
      first: Number(firstToken),
      second: Number(secondToken),
      render: (first, second = 0) => `${prefix}${formatNumber(first, firstToken.startsWith('+'))} to ${formatNumber(second, secondToken.startsWith('+'))}${suffix}`,
    }
  }

  const leading = text.match(new RegExp(`^(${NUMBER})(%?)(.*)$`, 'i'))
  if (leading) {
    const token = leading[1]
    const unit = leading[2]
    const suffix = leading[3]
    return {
      key: `single||${unit}|${suffix.toLowerCase()}`,
      first: Number(token),
      render: (value) => `${formatNumber(value, token.startsWith('+'))}${unit}${suffix}`,
    }
  }

  const embedded = text.match(new RegExp(`^(.*?\\b(?:is|penetrates|gain|grants)\\s+)(${NUMBER})(%?)(.*)$`, 'i'))
  if (embedded) {
    const prefix = embedded[1]
    const token = embedded[2]
    const unit = embedded[3]
    const suffix = embedded[4]
    return {
      key: `single|${prefix.toLowerCase()}|${unit}|${suffix.toLowerCase()}`,
      first: Number(token),
      render: (value) => `${prefix}${formatNumber(value, token.startsWith('+'))}${unit}${suffix}`,
    }
  }

  return null
}

export function categorizeEquipmentAffix(text: string): EquipmentAffixCategory {
  const value = text.toLowerCase()
  if (/grants skill/.test(value)) return 'special'
  if (/level of/.test(value)) return 'skillLevels'
  if (/resistance/.test(value)) return 'resistances'
  if (/requirements?/.test(value)) return 'utility'
  if (/\bstrength\b|\bdexterity\b|\bintelligence\b|\battributes?\b/.test(value)) return 'attributes'
  if (/adds? .+ damage|\bthorns damage\b/.test(value)) return 'addedDamage'
  if (!/enem(?:y|ies)/.test(value) && (/\bguard\b|stun threshold/.test(value) || /符文(?:结界|結界)|晕眩(?:阈值|门槛)|暈眩(?:閾值|門檻)/.test(text))) return 'defences'
  if (/armour|evasion|block chance|deflection/.test(value)) return 'defences'
  if (/\blife\b|\bmana\b|\bspirit\b|energy shield/.test(value)) return 'resources'
  if (/damage|critical|attack speed|cast speed|skill speed|penetrat/.test(value)) return 'offence'
  if (/movement speed|rarity|flask|charm|charges|recovery|regeneration|requirements?/.test(value)) return 'utility'
  return 'special'
}

export function aggregateEquipmentAffixes(slots: EquipmentSlot[], itemsById: Record<string, EquipmentItem>): EquipmentAffixSummary[] {
  const aggregated = new Map<string, EquipmentAffixSummary & { first?: number; second?: number; render?: NumericAffix['render'] }>()

  for (const slot of slots) {
    if (!slot.active || !slot.itemId) continue
    const item = itemsById[slot.itemId]
    if (!item) continue

    for (const rawLine of item.lines) {
      const { text, rune } = cleanAffixLine(rawLine)
      if (!text || /^-+$/.test(text)) continue

      const category = categorizeEquipmentAffix(text)
      const numeric = parseNumericAffix(text)
      const sourceScope = /^Flask\s+\d+$/i.test(slot.name)
        ? 'flask'
        : /^Charm\s+\d+$/i.test(slot.name) ? 'charm' : 'gear'
      const aggregationKey = numeric ? `${sourceScope}|${category}|${numeric.key}` : `${sourceScope}|${category}|text|${text.toLowerCase()}`
      const source: EquipmentAffixSource = { itemId: item.id, itemName: item.name, slotName: slot.name, line: text, rune }
      const existing = aggregated.get(aggregationKey)

      if (existing) {
        existing.sources.push(source)
        if (numeric && existing.render) {
          existing.first = (existing.first || 0) + numeric.first
          if (numeric.second != null) existing.second = (existing.second || 0) + numeric.second
          existing.text = existing.render(existing.first, existing.second)
        }
        continue
      }

      aggregated.set(aggregationKey, {
        key: aggregationKey,
        category,
        text,
        sources: [source],
        first: numeric?.first,
        second: numeric?.second,
        render: numeric?.render,
      })
    }
  }

  return [...aggregated.values()].map(({ first: _first, second: _second, render: _render, ...summary }) => summary)
}

import { decodeCodeToXml, encodeXmlToCode } from '@/engine/buildCode'

/**
 * The seven item lines observed in WeGame exports that need PoB compatibility
 * handling. Keep this list intentionally narrow and evidence based.
 */
export const POB_ITEM_COMPATIBILITY_RULES = [
  { id: 'legacy-fire-resistance', source: 'Fire Resistance is +X%', target: '+X% to Fire Resistance' },
  { id: 'legacy-cold-resistance', source: 'Cold Resistance is +X%', target: '+X% to Cold Resistance' },
  { id: 'legacy-lightning-resistance', source: 'Lightning Resistance is +X%', target: '+X% to Lightning Resistance' },
  { id: 'legacy-chaos-resistance', source: 'Chaos Resistance is +X%', target: '+X% to Chaos Resistance' },
  { id: 'legacy-maximum-runic-ward', source: '+X to maximum Runic Ward', target: '+X to maximum Ward' },
  { id: 'legacy-increased-runic-ward', source: 'X% increased Runic Ward', target: 'X% increased Ward' },
  { id: 'prefix-effect-parser-bridge', source: 'X% increased Effect of Prefixes', target: 'Lua LocalPrefixEffect bridge' },
] as const

export type PobItemCompatibilityRuleId = typeof POB_ITEM_COMPATIBILITY_RULES[number]['id']

export interface PobItemCompatibilityResult {
  raw: string
  changed: boolean
  matchedRules: PobItemCompatibilityRuleId[]
}

export interface PobBuildCompatibilityResult {
  xml: string
  changed: boolean
  matchedRules: PobItemCompatibilityRuleId[]
}

const markerPrefix = /^(?:(?:\{[^}\r\n]+\})+)/

function normalizeItemLine(line: string): { line: string; rule?: PobItemCompatibilityRuleId } {
  const marker = line.match(markerPrefix)?.[0] || ''
  const body = line.slice(marker.length)
  let match = body.match(/^(Fire|Cold|Lightning|Chaos) Resistance is ([+\-]?\d+(?:\.\d+)?)%$/)
  if (match) {
    return {
      line: `${marker}${match[2]}% to ${match[1]} Resistance`,
      rule: `legacy-${match[1].toLowerCase()}-resistance` as PobItemCompatibilityRuleId,
    }
  }
  match = body.match(/^([+\-]?\d+(?:\.\d+)?) to maximum Runic Ward$/)
  if (match) return { line: `${marker}${match[1]} to maximum Ward`, rule: 'legacy-maximum-runic-ward' }
  match = body.match(/^(\d+(?:\.\d+)?)% increased Runic Ward$/)
  if (match) return { line: `${marker}${match[1]}% increased Ward`, rule: 'legacy-increased-runic-ward' }
  // This line is valid PoB2 item text. It is kept unchanged and handled by
  // the project-owned Lua parser bridge because the bundled parser has no
  // generic entry for the stat descriptor.
  if (/^\d+(?:\.\d+)?% increased Effect of Prefixes$/.test(body)) {
    return { line, rule: 'prefix-effect-parser-bridge' }
  }
  return { line }
}

export function normalizePobItemRaw(raw: string): PobItemCompatibilityResult {
  const matched = new Set<PobItemCompatibilityRuleId>()
  // Keep the original line endings. Item Raw is part of the PoB payload and
  // a compatibility migration must not create unrelated XML/code churn.
  const normalized = raw.split(/(\r\n|\n|\r)/).map((part, index) => {
    if (index % 2 === 1) return part
    const result = normalizeItemLine(part)
    if (result.rule) matched.add(result.rule)
    return result.line
  }).join('')
  return { raw: normalized, changed: normalized !== raw, matchedRules: [...matched] }
}

/** Normalize only text inside PoB <Item> elements; all other XML is untouched. */
export function normalizePobBuildXml(xml: string): PobBuildCompatibilityResult {
  const matched = new Set<PobItemCompatibilityRuleId>()
  let changed = false
  const normalizedXml = xml.replace(/(<Item\b[^>]*>)([\s\S]*?)(<\/Item>)/gi, (_full, open: string, body: string, close: string) => {
    const result = normalizePobItemRaw(body)
    for (const rule of result.matchedRules) matched.add(rule)
    if (result.raw !== body) changed = true
    return `${open}${result.raw}${close}`
  })
  return { xml: normalizedXml, changed, matchedRules: [...matched] }
}

export function normalizePobBuildCode(code: string): string {
  return normalizePobBuildCodeResult(code).code
}

export function normalizePobBuildCodeResult(code: string): PobBuildCompatibilityResult & { code: string } {
  const xml = decodeCodeToXml(code)
  const result = normalizePobBuildXml(xml)
  return { ...result, code: result.changed ? encodeXmlToCode(result.xml) : code.trim() }
}

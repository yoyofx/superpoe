import { XMLParser } from 'fast-xml-parser'
import type { SkillCalculationMode } from '@/types/calc'

const MODES = new Set<SkillCalculationMode>(['UNBUFFED', 'BUFFED', 'COMBAT', 'EFFECTIVE'])
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  parseAttributeValue: false,
})

function asArray<T>(value: T | T[] | undefined): T[] {
  if (value == null) return []
  return Array.isArray(value) ? value : [value]
}

export function getImportedCalculationMode(xml: string): SkillCalculationMode {
  try {
    const root = parser.parse(xml)?.PathOfBuilding2 as {
      Calcs?: { Input?: Array<{ name?: string; string?: string }> | { name?: string; string?: string } }
    } | undefined
    const value = asArray(root?.Calcs?.Input)
      .find((input) => input.name === 'misc_buffMode')?.string as SkillCalculationMode | undefined
    return value && MODES.has(value) ? value : 'EFFECTIVE'
  } catch {
    return 'EFFECTIVE'
  }
}

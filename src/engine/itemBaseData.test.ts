import { describe, expect, it } from 'vitest'
import { normalizeItemBaseIndex, resolveItemBaseData, type ItemBaseData } from './itemBaseData'

describe('resolveItemBaseData', () => {
  const bases: Record<string, ItemBaseData> = {
    'Ultimate Mana Flask': { type: 'Mana Flask' },
    'Sinister Quarterstaff': { type: 'Staff' },
  }

  it('resolves exact, variant and affixed magic names', () => {
    expect(resolveItemBaseData('Sinister Quarterstaff', bases)?.type).toBe('Staff')
    expect(resolveItemBaseData('Sinister Quarterstaff (2)', bases)?.type).toBe('Staff')
    expect(resolveItemBaseData('Turbid Ultimate Mana Flask of the Practitioner', bases)?.type).toBe('Mana Flask')
  })
})

describe('normalizeItemBaseIndex', () => {
  it('falls back to an empty index for missing or legacy data', () => {
    expect(normalizeItemBaseIndex(null)).toEqual({ bases: {} })
    expect(normalizeItemBaseIndex({ entries: {} })).toEqual({ bases: {} })
  })
})

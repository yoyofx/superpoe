import { describe, expect, it } from 'vitest'
import { getImportedCalculationMode } from '@/engine/calculationConfig'

describe('getImportedCalculationMode', () => {
  it('reads the calculation mode saved by PoB2', () => {
    expect(getImportedCalculationMode('<PathOfBuilding2><Calcs><Input string="EFFECTIVE" name="misc_buffMode"/></Calcs></PathOfBuilding2>'))
      .toBe('EFFECTIVE')
  })

  it('uses effective DPS for game exports without a Calcs section', () => {
    expect(getImportedCalculationMode('<PathOfBuilding2><Build level="90"/></PathOfBuilding2>')).toBe('EFFECTIVE')
  })
})

import { describe, expect, it } from 'vitest'
import {
  cleanConfigurationTranslation,
  localizeCalculationConfigOption,
} from '@/i18n/configurationTranslations'
import type { CalculationConfigOption } from '@/types/calc'

const comboOption: CalculationConfigOption = {
  key: 'multiplierCombo',
  section: 'When In Combat',
  type: 'count',
  label: 'Combo:',
  visible: true,
  valid: true,
}

describe('configuration translations', () => {
  it('uses stable option-key overrides for PoB2-specific labels', () => {
    const translated = localizeCalculationConfigOption(comboOption, 'zh-rCN')
    expect(translated.label).toBe('连击数：')
    expect(translated.key).toBe('multiplierCombo')
  })

  it('keeps the original option object in English', () => {
    expect(localizeCalculationConfigOption(comboOption, 'en')).toBe(comboOption)
  })

  it('removes PoB colour escapes from translated text', () => {
    expect(cleanConfigurationTranslation('^xFFFFFF满^xE05030生命^7状态')).toBe('满生命状态')
  })
})

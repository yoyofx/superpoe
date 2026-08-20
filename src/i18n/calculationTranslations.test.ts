import { describe, expect, it } from 'vitest'
import { translateCalculationLabel, translateCalculationStat, translateCalculationTerm, translateCalculationText } from '@/i18n/calculationTranslations'

describe('calculation translations', () => {
  it('localizes current PoB2 damage breakdown fragments', () => {
    expect(translateCalculationText('66 to 109 (damage from weapon)', 'zh-rCN')).toBe('66 至 109 （来自武器的伤害）')
    expect(translateCalculationText('x 0.4 (60% converted to other damage types)', 'zh-rCN')).toBe('x 0.4 （60% 转换为其他伤害类型）')
    expect(translateCalculationText('= -50% (weighted average from 100% inversion chance)', 'zh-rCN')).toBe('= -50% （按 100% 反转几率加权）')
    expect(translateCalculationText('12.00 (base from main weapon)', 'zh-rCN')).toBe('12.00 （来自主手武器的基础值）')
    expect(translateCalculationText('x 2.40 (increased/reduced)', 'zh-rCN')).toBe('x 2.40 （提高/降低）')
  })

  it('turns internal modifier names into readable labels', () => {
    expect(translateCalculationStat('ElementalDamage', 'zh-rCN')).toBe('元素伤害')
    expect(translateCalculationStat('PhysicalMin / PhysicalMax', 'zh-rCN')).toBe('物理最小点伤 / 物理最大点伤')
    expect(translateCalculationStat('WeaponLightningDamage', 'zh-rCN')).toBe('武器闪电基础伤害')
    expect(translateCalculationStat('SkillLightningDamage', 'zh-rCN')).toBe('技能闪电基础伤害')
    expect(translateCalculationStat('PhysicalDamageGainAsLightning', 'zh-rCN')).toBe('物理作为额外闪电伤害')
    expect(translateCalculationStat('DamageGainAsCold', 'zh-rCN')).toBe('所有伤害作为额外冰霜伤害')
  })

  it('localizes PoB2 internal calculation terms', () => {
    expect(translateCalculationTerm('Zap', 'zh-rCN')).toBe('电击')
  })

  it('localizes display-stat labels stored with trailing punctuation', async () => {
    // The production manifest contains these labels in BuildDisplayStats.csv,
    // CalcSections.csv, and related language files.
    const { loadTranslations, resetTranslationsForTest } = await import('@/i18n/translationLoader')
    const originalFetch = globalThis.fetch
    const files = [
      'BuildDisplayStats.csv',
      'CalcSections.csv',
      'SkillsTab.csv',
      'GUI.csv',
    ]
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/translation-files.json')) {
        return new Response(JSON.stringify({ languages: { 'zh-rCN': files } }), { status: 200 })
      }
      const file = url.split('/').pop() || ''
      const rows: Record<string, string> = {
        'CalcSections.csv': 'Mana Cost:,魔力消耗:\nEffective Hit Pool:,击中伤有效生命值:\n',
        'SkillsTab.csv': 'Full DPS,最终总和DPS\n',
      }
      return new Response(rows[file] || '', { status: 200 })
    }) as typeof globalThis.fetch
    try {
      await loadTranslations('zh-rCN')
      expect(translateCalculationLabel('Mana Cost', 'zh-rCN')).toBe('魔力消耗')
      expect(translateCalculationLabel('Effective Hit Pool', 'zh-rCN')).toBe('击中伤有效生命值')
      expect(translateCalculationLabel('Full DPS', 'zh-rCN')).toBe('最终总和DPS')
    } finally {
      globalThis.fetch = originalFetch
      resetTranslationsForTest()
    }
  })
})

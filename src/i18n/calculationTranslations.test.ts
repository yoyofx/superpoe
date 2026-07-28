import { describe, expect, it } from 'vitest'
import { translateCalculationStat, translateCalculationTerm, translateCalculationText } from '@/i18n/calculationTranslations'

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
})

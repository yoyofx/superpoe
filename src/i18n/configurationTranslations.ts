import { translateGameText, type Language } from '@/i18n/translationLoader'
import type { CalculationConfigOption } from '@/types/calc'

interface ConfigurationTranslationOverride {
  label?: string
  tooltip?: string
  choices?: Record<string, string>
}

const ZH_CN_OVERRIDES: Record<string, ConfigurationTranslationOverride> = {
  warcryMode: { label: '强化攻击计算模式：' },
  whirlwindStages: { label: '旋风阶段数：' },
  whirlwindBuffCold: { label: '旋风已获得冰霜元素：' },
  whirlwindBuffFire: { label: '旋风已获得火焰元素：' },
  whirlwindBuffLightning: { label: '旋风已获得闪电元素：' },
  multiplierCombo: { label: '连击数：' },
  conditionShapeshifted: { label: '当前处于变形状态？' },
  conditionTriggeredSkillRecently: { label: '近期是否触发过技能？' },
  customMods: { label: '自定义词缀' },
}

const OVERRIDES: Partial<Record<Language, Record<string, ConfigurationTranslationOverride>>> = {
  'zh-rCN': ZH_CN_OVERRIDES,
}

function choiceKey(value: boolean | number | string): string {
  return `${typeof value}:${String(value)}`
}

export function cleanConfigurationTranslation(value: string): string {
  return value
    .replace(/\^x[0-9a-f]{6}/gi, '')
    .replace(/\^[0-9]/g, '')
    .trim()
}

function localizeQuestLabel(value: string, language: Language): string | null {
  if (language !== 'zh-rCN') return null
  const match = value.match(/^(Act|Interlude) (\d+):\s*(.+)$/)
  if (!match) return null
  const [, type, number, location] = match
  const prefix = type === 'Act' ? `第 ${number} 章` : `间章 ${number}`
  return `${prefix}：${cleanConfigurationTranslation(translateGameText(location, language))}`
}

export function translateConfigurationText(value: string | undefined, language: Language): string | undefined {
  if (value == null || language === 'en') return value
  const questLabel = localizeQuestLabel(value, language)
  if (questLabel) return questLabel
  return cleanConfigurationTranslation(translateGameText(value, language))
}

export function localizeCalculationConfigOption(
  option: CalculationConfigOption,
  language: Language,
): CalculationConfigOption {
  if (language === 'en') return option
  const override = OVERRIDES[language]?.[option.key]
  return {
    ...option,
    label: override?.label || translateConfigurationText(option.label, language) || option.label,
    tooltip: override?.tooltip || translateConfigurationText(option.tooltip, language),
    choices: option.choices?.map((choice) => ({
      ...choice,
      label: override?.choices?.[choiceKey(choice.value)]
        || translateConfigurationText(choice.label, language)
        || choice.label,
    })),
  }
}

import { translateGameText, type Language } from '@/i18n/translationLoader'

const DAMAGE_TYPE_ZH: Record<string, string> = {
  Physical: '物理',
  Lightning: '闪电',
  Cold: '冰霜',
  Fire: '火焰',
  Chaos: '混沌',
}

const ZH_CALCULATION_RULES: Array<[RegExp, string]> = [
  [/(-?\d+(?:\.\d+)?)\s+to\s+(-?\d+(?:\.\d+)?)/gi, '$1 至 $2'],
  [/\bBase damage:/gi, '基础伤害：'],
  [/\bHit damage:/gi, '击中伤害：'],
  [/\bEnemy resistance:/gi, '敌人抗性：'],
  [/\bEffective resistance:/gi, '有效抗性：'],
  [/\(damage from weapon\)/gi, '（来自武器的伤害）'],
  [/\(added damage\)/gi, '（附加伤害）'],
  [/\((\d+(?:\.\d+)?)% converted to other damage types\)/gi, '（$1% 转换为其他伤害类型）'],
  [/\(damage converted from other damage types\)/gi, '（从其他伤害类型转换而来）'],
  [/\(damage gained from other damage types\)/gi, '（从其他伤害类型额外获得）'],
  [/\(physical damage reduction\)/gi, '（物理伤害减免）'],
  [/\(non-inverted hit after penetration\)/gi, '（穿透后未反转的击中）'],
  [/\(inverted hit after penetration\)/gi, '（穿透后反转的击中）'],
  [/\(weighted average from (\d+(?:\.\d+)?)% inversion chance\)/gi, '（按 $1% 反转几率加权）'],
  [/\(resistance\)/gi, '（抗性）'],
  [/\(damage from non-crits\)/gi, '（来自非暴击的伤害）'],
  [/\(damage from crits\)/gi, '（来自暴击的伤害）'],
  [/\(average from non-crits\)/gi, '（非暴击平均值）'],
  [/\(average from crits\)/gi, '（暴击平均值）'],
  [/\(base from main weapon\)/gi, '（来自主手武器的基础值）'],
  [/\(base from parent main weapon\)/gi, '（来自上级主手武器的基础值）'],
  [/\(base\)/gi, '（基础值）'],
  [/\(increased\/reduced\)/gi, '（提高/降低）'],
  [/\(more\/less\)/gi, '（总增/总降）'],
  [/\(crit chance\)/gi, '（暴击率）'],
  [/\(additional extra damage\)/gi, '（额外暴击伤害）'],
  [/\(extra crit damage\)/gi, '（额外暴击伤害）'],
  [/\bEffective Crit Chance:/gi, '有效暴击率：'],
  [/\bCrit Chance is Lucky:/gi, '暴击率为幸运：'],
  [/\bCritical Strike Bifurcates:/gi, '暴击分岔：'],
  [/\bInevitable Critical Hits:/gi, '必定暴击：'],
  [/\(chance to hit\)/gi, '（命中几率）'],
  [/\(override\)/gi, '（覆盖）'],
]

const ZH_CALCULATION_TERMS: Record<string, string> = {
  Zap: '电击',
}

export function translateCalculationText(value: string, language: Language): string {
  let translated = translateGameText(value, language)
  if (language !== 'zh-rCN') return translated
  for (const [pattern, replacement] of ZH_CALCULATION_RULES) {
    translated = translated.replace(pattern, replacement)
  }
  return translated
}

function formatSingleStat(stat: string, language: Language): string {
  const translated = translateGameText(stat, language)
  if (translated !== stat || language !== 'zh-rCN') return translated

  const damage = stat.match(/^(Physical|Lightning|Cold|Fire|Chaos)Damage$/)
  if (damage) return `${DAMAGE_TYPE_ZH[damage[1]]}伤害`
  if (stat === 'Damage') return '所有伤害'
  if (stat === 'ElementalDamage') return '元素伤害'

  const point = stat.match(/^(Physical|Lightning|Cold|Fire|Chaos)(Min|Max)$/)
  if (point) return `${DAMAGE_TYPE_ZH[point[1]]}${point[2] === 'Min' ? '最小' : '最大'}点伤`

  const weaponDamage = stat.match(/^Weapon(Physical|Lightning|Cold|Fire|Chaos)Damage$/)
  if (weaponDamage) return `武器${DAMAGE_TYPE_ZH[weaponDamage[1]]}基础伤害`

  const skillDamage = stat.match(/^Skill(Physical|Lightning|Cold|Fire|Chaos)Damage$/)
  if (skillDamage) return `技能${DAMAGE_TYPE_ZH[skillDamage[1]]}基础伤害`

  const gain = stat.match(/^(?:(Physical|Lightning|Cold|Fire|Chaos|Elemental)?Damage)?GainAs(Physical|Lightning|Cold|Fire|Chaos|Random)$/)
  if (gain) {
    const from = gain[1] ? (DAMAGE_TYPE_ZH[gain[1]] || '元素') : '所有伤害'
    const to = gain[2] === 'Random' ? '随机元素' : DAMAGE_TYPE_ZH[gain[2]]
    return `${from}作为额外${to}伤害`
  }

  return stat
}

export function translateCalculationStat(stat: string, language: Language): string {
  return stat.split(' / ').map((entry) => formatSingleStat(entry, language)).join(' / ')
}

export function translateCalculationTerm(value: string, language: Language): string {
  if (language === 'zh-rCN' && ZH_CALCULATION_TERMS[value]) return ZH_CALCULATION_TERMS[value]
  return translateCalculationText(value, language)
}

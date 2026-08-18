import type { CalcResult } from '@/types/calc'

export type AnalysisDimension = 'attack' | 'defense'
export type AnalysisConfidence = 'verified' | 'supported' | 'limited' | 'unavailable'
export type AnalysisCurve = 'linear' | 'diminishing' | 'threshold' | 'capped' | 'non-monotonic' | 'unstable'
export interface AnalysisText { en: string; zhCN: string; zhTW: string; koKR: string }
export interface MetricDefinition { key: string; dimension: AnalysisDimension; label: AnalysisText; unit: 'number' | 'percent' | 'per-second'; direction: 'higher-better' | 'target-range'; epsilon: number; displayScale?: number }
export interface AttributeProbeDefinition {
  id: string; familyId: string; primaryDimension: AnalysisDimension; label: AnalysisText
  scope: 'synthetic-global' | 'skill' | 'threshold'; primaryMetric: string; affectedMetrics: string[]; points: number[]; unit: AnalysisText
  /** Which effective DPS skill types can receive this temporary modifier. */
  skillScope: 'shared' | 'attack' | 'spell'
  pointUnit?: 'percent' | 'level'
  mutation: { type: 'custom-mod'; format: (point: number) => string }
  applicability: 'always' | 'full-dps' | 'life' | 'energy-shield' | 'armour' | 'evasion' | 'deflection' | 'block' | 'spell-block' | 'ward'
  evidence: { source: 'pob-supported'; fixtureIds: string[] }
}
export interface ProbeMetricDelta { baseline: number | null; projected: number | null; absoluteDelta: number | null; relativeDelta: number | null }
export interface ProbePointResult { input: number; mod: string; metrics: Record<string, ProbeMetricDelta>; error?: string }
export interface ProbeSeriesResult { probe: AttributeProbeDefinition; points: ProbePointResult[]; curve: AnalysisCurve; confidence: AnalysisConfidence; warnings: string[] }

export const PROBE_CATALOG_VERSION = '2026.08.18.4'
const t = (en: string, zhCN: string, zhTW = zhCN, koKR = en): AnalysisText => ({ en, zhCN, zhTW, koKR })
const mod = (pattern: string) => ({ type: 'custom-mod' as const, format: (point: number) => pattern.replace('{n}', String(point)) })

export const ANALYSIS_DIMENSIONS: Array<{ id: AnalysisDimension; label: AnalysisText }> = [
  { id: 'attack', label: t('Attack / output', '攻击 / 输出', '攻擊 / 輸出', '공격 / 출력') },
  { id: 'defense', label: t('Defense', '防御', '防禦', '방어') },
]

export const METRIC_DEFINITIONS: MetricDefinition[] = [
  { key: 'FullDPS', dimension: 'attack', label: t('Full DPS', '完整 DPS'), unit: 'number', direction: 'higher-better', epsilon: 1 },
  { key: 'AllDPS', dimension: 'attack', label: t('Actual DPS total', '实际 DPS 总和'), unit: 'number', direction: 'higher-better', epsilon: 1 },
  { key: 'TotalDPS', dimension: 'attack', label: t('Hit DPS', '击中 DPS'), unit: 'number', direction: 'higher-better', epsilon: 1 },
  { key: 'Speed', dimension: 'attack', label: t('Attack / cast rate', '攻击 / 施法速度'), unit: 'per-second', direction: 'higher-better', epsilon: .001 },
  { key: 'AverageDamage', dimension: 'attack', label: t('Average hit', '平均击中'), unit: 'number', direction: 'higher-better', epsilon: 1 },
  { key: 'TotalEHP', dimension: 'defense', label: t('EHP', 'EHP', 'EHP', 'EHP'), unit: 'number', direction: 'higher-better', epsilon: 1 },
  { key: 'Life', dimension: 'defense', label: t('Life', '生命'), unit: 'number', direction: 'higher-better', epsilon: 1 },
  { key: 'EnergyShield', dimension: 'defense', label: t('Energy shield', '能量护盾'), unit: 'number', direction: 'higher-better', epsilon: 1 },
  { key: 'Armour', dimension: 'defense', label: t('Armour', '护甲'), unit: 'number', direction: 'higher-better', epsilon: 1 },
  { key: 'Evasion', dimension: 'defense', label: t('Evasion Rating', '闪避值'), unit: 'number', direction: 'higher-better', epsilon: 1 },
  { key: 'EvadeChance', dimension: 'defense', label: t('Evade chance', '闪避几率'), unit: 'percent', direction: 'higher-better', epsilon: .01 },
  { key: 'DeflectionRating', dimension: 'defense', label: t('Deflection rating', '偏斜值'), unit: 'number', direction: 'higher-better', epsilon: 1 },
  { key: 'DeflectChance', dimension: 'defense', label: t('Deflect chance', '偏斜几率'), unit: 'percent', direction: 'higher-better', epsilon: .01 },
  { key: 'DeflectEffect', dimension: 'defense', label: t('Deflect effect', '偏斜效果'), unit: 'percent', direction: 'higher-better', epsilon: .01 },
  { key: 'BlockChance', dimension: 'defense', label: t('Block chance', '格挡几率'), unit: 'percent', direction: 'higher-better', epsilon: .01 },
  { key: 'SpellBlockChance', dimension: 'defense', label: t('Spell block chance', '法术格挡几率'), unit: 'percent', direction: 'higher-better', epsilon: .01 },
  { key: 'PhysicalDamageReduction', dimension: 'defense', label: t('Physical damage reduction', '物理伤害减免'), unit: 'percent', direction: 'higher-better', epsilon: .01 },
  { key: 'Ward', dimension: 'defense', label: t('Ward', '结界'), unit: 'number', direction: 'higher-better', epsilon: 1 },
  { key: 'FireResistTotal', dimension: 'defense', label: t('Fire resistance', '火焰抗性'), unit: 'percent', direction: 'target-range', epsilon: .01 },
  { key: 'ColdResistTotal', dimension: 'defense', label: t('Cold resistance', '冰霜抗性'), unit: 'percent', direction: 'target-range', epsilon: .01 },
  { key: 'LightningResistTotal', dimension: 'defense', label: t('Lightning resistance', '闪电抗性'), unit: 'percent', direction: 'target-range', epsilon: .01 },
  { key: 'ChaosResistTotal', dimension: 'defense', label: t('Chaos resistance', '混沌抗性'), unit: 'percent', direction: 'higher-better', epsilon: .01 },
  { key: 'FireResist', dimension: 'defense', label: t('Fire resistance', '火焰抗性'), unit: 'percent', direction: 'higher-better', epsilon: .01 },
  { key: 'ColdResist', dimension: 'defense', label: t('Cold resistance', '冰霜抗性'), unit: 'percent', direction: 'higher-better', epsilon: .01 },
  { key: 'LightningResist', dimension: 'defense', label: t('Lightning resistance', '闪电抗性'), unit: 'percent', direction: 'higher-better', epsilon: .01 },
  { key: 'ChaosResist', dimension: 'defense', label: t('Chaos resistance', '混沌抗性'), unit: 'percent', direction: 'higher-better', epsilon: .01 },
]

export const ATTRIBUTE_PROBE_CATALOG: AttributeProbeDefinition[] = [
  { id: 'generic-damage', familyId: 'damage', primaryDimension: 'attack', label: t('Increased damage', '伤害提高'), scope: 'synthetic-global', skillScope: 'shared', primaryMetric: 'FullDPS', affectedMetrics: ['FullDPS', 'TotalDPS', 'AverageDamage'], points: [1], unit: t('%', '%'), mutation: mod('{n}% increased Damage'), applicability: 'full-dps', evidence: { source: 'pob-supported', fixtureIds: ['generic-damage'] } },
  { id: 'attack-damage', familyId: 'damage', primaryDimension: 'attack', label: t('Attack damage', '攻击伤害'), scope: 'synthetic-global', skillScope: 'attack', primaryMetric: 'FullDPS', affectedMetrics: ['FullDPS', 'TotalDPS', 'AverageDamage'], points: [1], unit: t('%', '%'), mutation: mod('{n}% increased Attack Damage'), applicability: 'full-dps', evidence: { source: 'pob-supported', fixtureIds: ['attack-damage'] } },
  { id: 'spell-damage', familyId: 'damage', primaryDimension: 'attack', label: t('Spell damage', '法术伤害'), scope: 'synthetic-global', skillScope: 'spell', primaryMetric: 'FullDPS', affectedMetrics: ['FullDPS', 'TotalDPS', 'AverageDamage'], points: [1], unit: t('%', '%'), mutation: mod('{n}% increased Spell Damage'), applicability: 'full-dps', evidence: { source: 'pob-supported', fixtureIds: ['spell-damage'] } },
  { id: 'elemental-damage', familyId: 'damage', primaryDimension: 'attack', label: t('Elemental damage', '元素伤害'), scope: 'synthetic-global', skillScope: 'shared', primaryMetric: 'FullDPS', affectedMetrics: ['FullDPS', 'TotalDPS', 'AverageDamage'], points: [1], unit: t('%', '%'), mutation: mod('{n}% increased Elemental Damage'), applicability: 'full-dps', evidence: { source: 'pob-supported', fixtureIds: ['elemental-damage'] } },
  { id: 'physical-damage', familyId: 'damage', primaryDimension: 'attack', label: t('Physical damage', '物理伤害'), scope: 'synthetic-global', skillScope: 'shared', primaryMetric: 'FullDPS', affectedMetrics: ['FullDPS', 'TotalDPS', 'AverageDamage'], points: [1], unit: t('%', '%'), mutation: mod('{n}% increased Physical Damage'), applicability: 'full-dps', evidence: { source: 'pob-supported', fixtureIds: ['physical-damage'] } },
  { id: 'fire-damage', familyId: 'damage', primaryDimension: 'attack', label: t('Fire damage', '火焰伤害'), scope: 'synthetic-global', skillScope: 'shared', primaryMetric: 'FullDPS', affectedMetrics: ['FullDPS', 'TotalDPS', 'AverageDamage'], points: [1], unit: t('%', '%'), mutation: mod('{n}% increased Fire Damage'), applicability: 'full-dps', evidence: { source: 'pob-supported', fixtureIds: ['fire-damage'] } },
  { id: 'cold-damage', familyId: 'damage', primaryDimension: 'attack', label: t('Cold damage', '冰霜伤害'), scope: 'synthetic-global', skillScope: 'shared', primaryMetric: 'FullDPS', affectedMetrics: ['FullDPS', 'TotalDPS', 'AverageDamage'], points: [1], unit: t('%', '%'), mutation: mod('{n}% increased Cold Damage'), applicability: 'full-dps', evidence: { source: 'pob-supported', fixtureIds: ['cold-damage'] } },
  { id: 'lightning-damage', familyId: 'damage', primaryDimension: 'attack', label: t('Lightning damage', '闪电伤害'), scope: 'synthetic-global', skillScope: 'shared', primaryMetric: 'FullDPS', affectedMetrics: ['FullDPS', 'TotalDPS', 'AverageDamage'], points: [1], unit: t('%', '%'), mutation: mod('{n}% increased Lightning Damage'), applicability: 'full-dps', evidence: { source: 'pob-supported', fixtureIds: ['lightning-damage'] } },
  { id: 'chaos-damage', familyId: 'damage', primaryDimension: 'attack', label: t('Chaos damage', '混沌伤害'), scope: 'synthetic-global', skillScope: 'shared', primaryMetric: 'FullDPS', affectedMetrics: ['FullDPS', 'TotalDPS', 'AverageDamage'], points: [1], unit: t('%', '%'), mutation: mod('{n}% increased Chaos Damage'), applicability: 'full-dps', evidence: { source: 'pob-supported', fixtureIds: ['chaos-damage'] } },
  { id: 'gain-extra-elemental', familyId: 'damage-gain', primaryDimension: 'attack', label: t('Gain as extra elemental damage', '获得额外元素伤害'), scope: 'synthetic-global', skillScope: 'shared', primaryMetric: 'FullDPS', affectedMetrics: ['FullDPS', 'TotalDPS', 'AverageDamage'], points: [1], unit: t('%', '%'), mutation: mod('Gain {n}% of Damage as Extra Damage of all Elements'), applicability: 'full-dps', evidence: { source: 'pob-supported', fixtureIds: ['gain-extra-elemental'] } },
  { id: 'attack-speed', familyId: 'speed', primaryDimension: 'attack', label: t('Attack speed', '攻击速度'), scope: 'synthetic-global', skillScope: 'attack', primaryMetric: 'FullDPS', affectedMetrics: ['FullDPS', 'Speed'], points: [1], unit: t('%', '%'), mutation: mod('{n}% increased Attack Speed'), applicability: 'full-dps', evidence: { source: 'pob-supported', fixtureIds: ['attack-speed'] } },
  { id: 'cast-speed', familyId: 'speed', primaryDimension: 'attack', label: t('Cast speed', '施法速度'), scope: 'synthetic-global', skillScope: 'spell', primaryMetric: 'FullDPS', affectedMetrics: ['FullDPS', 'Speed'], points: [1], unit: t('%', '%'), mutation: mod('{n}% increased Cast Speed'), applicability: 'full-dps', evidence: { source: 'pob-supported', fixtureIds: ['cast-speed'] } },
  { id: 'accuracy', familyId: 'hit', primaryDimension: 'attack', label: t('Accuracy rating', '命中值'), scope: 'synthetic-global', skillScope: 'attack', primaryMetric: 'FullDPS', affectedMetrics: ['FullDPS', 'TotalDPS'], points: [1], unit: t('%', '%'), mutation: mod('{n}% increased Accuracy Rating'), applicability: 'full-dps', evidence: { source: 'pob-supported', fixtureIds: ['accuracy'] } },
  { id: 'critical-chance', familyId: 'critical', primaryDimension: 'attack', label: t('Critical hit chance', '暴击几率'), scope: 'synthetic-global', skillScope: 'shared', primaryMetric: 'FullDPS', affectedMetrics: ['FullDPS', 'TotalDPS'], points: [1], unit: t('%', '%'), mutation: mod('+{n}% to Critical Hit Chance'), applicability: 'full-dps', evidence: { source: 'pob-supported', fixtureIds: ['critical-chance'] } },
  { id: 'attack-critical-chance', familyId: 'critical', primaryDimension: 'attack', label: t('Attack critical chance', '攻击暴击几率'), scope: 'synthetic-global', skillScope: 'attack', primaryMetric: 'FullDPS', affectedMetrics: ['FullDPS', 'TotalDPS'], points: [1], unit: t('%', '%'), mutation: mod('+{n}% to Critical Hit Chance for Attacks'), applicability: 'full-dps', evidence: { source: 'pob-supported', fixtureIds: ['attack-critical-chance'] } },
  { id: 'spell-critical-chance', familyId: 'critical', primaryDimension: 'attack', label: t('Spell critical chance', '法术暴击几率'), scope: 'synthetic-global', skillScope: 'spell', primaryMetric: 'FullDPS', affectedMetrics: ['FullDPS', 'TotalDPS'], points: [1], unit: t('%', '%'), mutation: mod('+{n}% to Critical Hit Chance for Spells'), applicability: 'full-dps', evidence: { source: 'pob-supported', fixtureIds: ['spell-critical-chance'] } },
  { id: 'critical-damage', familyId: 'critical', primaryDimension: 'attack', label: t('Critical damage bonus', '暴击伤害加成'), scope: 'synthetic-global', skillScope: 'shared', primaryMetric: 'FullDPS', affectedMetrics: ['FullDPS', 'TotalDPS'], points: [1], unit: t('%', '%'), mutation: mod('+{n}% to Critical Damage Bonus'), applicability: 'full-dps', evidence: { source: 'pob-supported', fixtureIds: ['critical-damage'] } },
  { id: 'skill-level', familyId: 'skill-level', primaryDimension: 'attack', label: t('Skill level', '技能等级'), scope: 'skill', skillScope: 'shared', pointUnit: 'level', primaryMetric: 'FullDPS', affectedMetrics: ['FullDPS', 'TotalDPS', 'AverageDamage'], points: [1], unit: t('level', '级'), mutation: mod('+{n} to Level of all Skills'), applicability: 'full-dps', evidence: { source: 'pob-supported', fixtureIds: ['skill-level'] } },
  { id: 'maximum-life', familyId: 'life', primaryDimension: 'defense', label: t('Maximum life', '最大生命'), scope: 'synthetic-global', skillScope: 'shared', primaryMetric: 'TotalEHP', affectedMetrics: ['Life', 'TotalEHP'], points: [1], unit: t('%', '%'), mutation: mod('{n}% increased maximum Life'), applicability: 'life', evidence: { source: 'pob-supported', fixtureIds: ['maximum-life'] } },
  { id: 'maximum-energy-shield', familyId: 'energy-shield', primaryDimension: 'defense', label: t('Maximum energy shield', '最大能量护盾'), scope: 'synthetic-global', skillScope: 'shared', primaryMetric: 'TotalEHP', affectedMetrics: ['EnergyShield', 'TotalEHP'], points: [1], unit: t('%', '%'), mutation: mod('{n}% increased maximum Energy Shield'), applicability: 'energy-shield', evidence: { source: 'pob-supported', fixtureIds: ['maximum-energy-shield'] } },
  { id: 'armour', familyId: 'armour', primaryDimension: 'defense', label: t('Armour', '护甲'), scope: 'synthetic-global', skillScope: 'shared', primaryMetric: 'TotalEHP', affectedMetrics: ['Armour', 'TotalEHP'], points: [1], unit: t('%', '%'), mutation: mod('{n}% increased Armour'), applicability: 'armour', evidence: { source: 'pob-supported', fixtureIds: ['armour'] } },
  { id: 'evasion', familyId: 'evasion', primaryDimension: 'defense', label: t('Evasion Rating', '闪避值'), scope: 'synthetic-global', skillScope: 'shared', primaryMetric: 'TotalEHP', affectedMetrics: ['Evasion', 'EvadeChance', 'TotalEHP'], points: [1], unit: t('%', '%'), mutation: mod('{n}% increased Evasion Rating'), applicability: 'evasion', evidence: { source: 'pob-supported', fixtureIds: ['evasion'] } },
  { id: 'deflection', familyId: 'deflection', primaryDimension: 'defense', label: t('Deflection', '偏斜'), scope: 'synthetic-global', skillScope: 'shared', primaryMetric: 'TotalEHP', affectedMetrics: ['DeflectionRating', 'DeflectChance', 'DeflectEffect', 'TotalEHP'], points: [1], unit: t('%', '%'), mutation: mod('{n}% increased Deflection Rating'), applicability: 'deflection', evidence: { source: 'pob-supported', fixtureIds: ['deflection'] } },
  { id: 'fire-resistance', familyId: 'resistance', primaryDimension: 'defense', label: t('Fire resistance', '火焰抗性'), scope: 'threshold', skillScope: 'shared', primaryMetric: 'TotalEHP', affectedMetrics: ['FireResistTotal', 'TotalEHP'], points: [1], unit: t('%', '%'), mutation: mod('+{n}% to Fire Resistance'), applicability: 'always', evidence: { source: 'pob-supported', fixtureIds: ['fire-resistance'] } },
  { id: 'cold-resistance', familyId: 'resistance', primaryDimension: 'defense', label: t('Cold resistance', '冰霜抗性'), scope: 'threshold', skillScope: 'shared', primaryMetric: 'TotalEHP', affectedMetrics: ['ColdResistTotal', 'TotalEHP'], points: [1], unit: t('%', '%'), mutation: mod('+{n}% to Cold Resistance'), applicability: 'always', evidence: { source: 'pob-supported', fixtureIds: ['cold-resistance'] } },
  { id: 'lightning-resistance', familyId: 'resistance', primaryDimension: 'defense', label: t('Lightning resistance', '闪电抗性'), scope: 'threshold', skillScope: 'shared', primaryMetric: 'TotalEHP', affectedMetrics: ['LightningResistTotal', 'TotalEHP'], points: [1], unit: t('%', '%'), mutation: mod('+{n}% to Lightning Resistance'), applicability: 'always', evidence: { source: 'pob-supported', fixtureIds: ['lightning-resistance'] } },
  { id: 'chaos-resistance', familyId: 'resistance', primaryDimension: 'defense', label: t('Chaos resistance', '混沌抗性'), scope: 'threshold', skillScope: 'shared', primaryMetric: 'TotalEHP', affectedMetrics: ['ChaosResistTotal', 'TotalEHP'], points: [1], unit: t('%', '%'), mutation: mod('+{n}% to Chaos Resistance'), applicability: 'always', evidence: { source: 'pob-supported', fixtureIds: ['chaos-resistance'] } },
  { id: 'block-chance', familyId: 'block', primaryDimension: 'defense', label: t('Block chance', '格挡几率'), scope: 'synthetic-global', skillScope: 'shared', primaryMetric: 'TotalEHP', affectedMetrics: ['BlockChance', 'TotalEHP'], points: [1], unit: t('%', '%'), mutation: mod('+{n}% to Block chance'), applicability: 'block', evidence: { source: 'pob-supported', fixtureIds: ['block-chance'] } },
  { id: 'spell-block-chance', familyId: 'block', primaryDimension: 'defense', label: t('Spell block chance', '法术格挡几率'), scope: 'synthetic-global', skillScope: 'shared', primaryMetric: 'TotalEHP', affectedMetrics: ['SpellBlockChance', 'TotalEHP'], points: [1], unit: t('%', '%'), mutation: mod('+{n}% to Spell Block chance'), applicability: 'spell-block', evidence: { source: 'pob-supported', fixtureIds: ['spell-block-chance'] } },
  { id: 'maximum-fire-resistance', familyId: 'maximum-resistance', primaryDimension: 'defense', label: t('Maximum fire resistance', '最大火焰抗性'), scope: 'synthetic-global', skillScope: 'shared', primaryMetric: 'TotalEHP', affectedMetrics: ['TotalEHP'], points: [1], unit: t('%', '%'), mutation: mod('+{n}% to Maximum Fire Resistance'), applicability: 'always', evidence: { source: 'pob-supported', fixtureIds: ['maximum-fire-resistance'] } },
  { id: 'maximum-cold-resistance', familyId: 'maximum-resistance', primaryDimension: 'defense', label: t('Maximum cold resistance', '最大冰霜抗性'), scope: 'synthetic-global', skillScope: 'shared', primaryMetric: 'TotalEHP', affectedMetrics: ['TotalEHP'], points: [1], unit: t('%', '%'), mutation: mod('+{n}% to Maximum Cold Resistance'), applicability: 'always', evidence: { source: 'pob-supported', fixtureIds: ['maximum-cold-resistance'] } },
  { id: 'maximum-lightning-resistance', familyId: 'maximum-resistance', primaryDimension: 'defense', label: t('Maximum lightning resistance', '最大闪电抗性'), scope: 'synthetic-global', skillScope: 'shared', primaryMetric: 'TotalEHP', affectedMetrics: ['TotalEHP'], points: [1], unit: t('%', '%'), mutation: mod('+{n}% to Maximum Lightning Resistance'), applicability: 'always', evidence: { source: 'pob-supported', fixtureIds: ['maximum-lightning-resistance'] } },
  { id: 'maximum-chaos-resistance', familyId: 'maximum-resistance', primaryDimension: 'defense', label: t('Maximum chaos resistance', '最大混沌抗性'), scope: 'synthetic-global', skillScope: 'shared', primaryMetric: 'TotalEHP', affectedMetrics: ['TotalEHP'], points: [1], unit: t('%', '%'), mutation: mod('+{n}% to Maximum Chaos Resistance'), applicability: 'always', evidence: { source: 'pob-supported', fixtureIds: ['maximum-chaos-resistance'] } },
  { id: 'physical-damage-reduction', familyId: 'physical-mitigation', primaryDimension: 'defense', label: t('Physical damage reduction', '物理伤害减免'), scope: 'synthetic-global', skillScope: 'shared', primaryMetric: 'TotalEHP', affectedMetrics: ['PhysicalDamageReduction', 'TotalEHP'], points: [1], unit: t('%', '%'), mutation: mod('+{n}% additional Physical Damage Reduction'), applicability: 'always', evidence: { source: 'pob-supported', fixtureIds: ['physical-damage-reduction'] } },
  { id: 'ward', familyId: 'ward', primaryDimension: 'defense', label: t('Ward', '结界'), scope: 'synthetic-global', skillScope: 'shared', primaryMetric: 'TotalEHP', affectedMetrics: ['Ward', 'TotalEHP'], points: [1], unit: t('%', '%'), mutation: mod('{n}% increased maximum Runic Ward'), applicability: 'ward', evidence: { source: 'pob-supported', fixtureIds: ['ward'] } },
]

export function getMetricDefinition(key: string): MetricDefinition | undefined { return METRIC_DEFINITIONS.find((metric) => metric.key === key) }
export function getDimensionMetric(dimension: AnalysisDimension): MetricDefinition { return METRIC_DEFINITIONS.find((metric) => metric.key === (dimension === 'attack' ? 'FullDPS' : 'TotalEHP'))! }

export interface AnalysisSkillScope {
  mode: 'full-dps' | 'fallback' | 'none'
  entries: NonNullable<CalcResult['AllSkillDPS']>
  attack: NonNullable<CalcResult['AllSkillDPS']>
  spell: NonNullable<CalcResult['AllSkillDPS']>
  other: NonNullable<CalcResult['AllSkillDPS']>
}

/**
 * Selects the DPS rows that drive the report.  A configured Full DPS list is
 * authoritative; otherwise the complete positive-DPS list is used as a
 * deliberate fallback.  Synthetic ailment rows are excluded because the
 * first report version only ranks hit DPS attributes.
 */
export function getAnalysisSkillScope(result: CalcResult | null | undefined, hasFullDpsSelection: boolean): AnalysisSkillScope {
  const selected = hasFullDpsSelection ? result?.FullSkillDPS : result?.AllSkillDPS
  const source = selected && selected.length ? selected : (!hasFullDpsSelection ? result?.SkillDPS : selected)
  const uniqueEntries = new Map<string, NonNullable<CalcResult['AllSkillDPS']>[number]>()
  for (const entry of source || []) {
    if (!Number.isFinite(entry.dps) || entry.dps <= 0 || entry.kind === 'dot') continue
    const key = [entry.groupId || '', entry.skillId || '', entry.skillPart || '', entry.name, entry.skillType || 'other'].join('|')
    const previous = uniqueEntries.get(key)
    uniqueEntries.set(key, previous ? { ...previous, dps: previous.dps + entry.dps, count: previous.count + entry.count } : entry)
  }
  const entries = [...uniqueEntries.values()]
  const fallbackType = result?.SkillDetails?.skillType
  const attack = entries.filter((entry) => (entry.skillType || fallbackType) === 'attack')
  const spell = entries.filter((entry) => (entry.skillType || fallbackType) === 'spell')
  const other = entries.filter((entry) => (entry.skillType || fallbackType || 'other') === 'other')
  return {
    mode: entries.length ? (hasFullDpsSelection ? 'full-dps' : 'fallback') : 'none',
    entries,
    attack,
    spell,
    other,
  }
}

export function getPowerStatValue(result: CalcResult | null | undefined, key: string): number | null {
  if (!result) return null
  // The top-level result is the canonical calculation payload for the
  // standard metrics. Older cached reports may still contain a zero-valued
  // PowerStats entry, so it must not mask a real direct result.
  const directValue = (result as unknown as Record<string, unknown>)[key]
  if (typeof directValue === 'number' && Number.isFinite(directValue)) return directValue
  const powerValue = result.PowerStats?.[key]
  if (typeof powerValue === 'number' && Number.isFinite(powerValue)) return powerValue
  if (key === 'AverageDamage' && Number.isFinite(result.AverageHit)) return result.AverageHit
  return null
}
export function isProbeApplicable(probe: AttributeProbeDefinition, baseline: CalcResult, hasFullDpsSelection: boolean, skillScope = getAnalysisSkillScope(baseline, hasFullDpsSelection)): boolean {
  if (probe.applicability === 'full-dps') {
    if (!skillScope.entries.length) return false
    if (probe.skillScope === 'attack') return skillScope.attack.length > 0
    if (probe.skillScope === 'spell') return skillScope.spell.length > 0
    return true
  }
  if (probe.applicability === 'life') return (getPowerStatValue(baseline, 'Life') ?? 0) > 1
  if (probe.applicability === 'energy-shield') return (getPowerStatValue(baseline, 'EnergyShield') ?? 0) > 1
  if (probe.applicability === 'armour') return (getPowerStatValue(baseline, 'Armour') ?? 0) > 1
  if (probe.applicability === 'evasion') return (getPowerStatValue(baseline, 'Evasion') ?? 0) > 1
  if (probe.applicability === 'deflection') return (getPowerStatValue(baseline, 'DeflectionRating') ?? 0) > 1
  if (probe.applicability === 'block') return (getPowerStatValue(baseline, 'BlockChance') ?? 0) > 0
  if (probe.applicability === 'spell-block') return (getPowerStatValue(baseline, 'SpellBlockChance') ?? 0) > 0
  if (probe.applicability === 'ward') return (getPowerStatValue(baseline, 'Ward') ?? 0) > 1
  return true
}
export function buildProbePoint(probe: AttributeProbeDefinition, point: number, baseline: CalcResult, projected: CalcResult): ProbePointResult {
  return { input: point, mod: probe.mutation.format(point), metrics: Object.fromEntries(probe.affectedMetrics.map((key) => {
    const base = getPowerStatValue(baseline, key); const next = getPowerStatValue(projected, key); const delta = base == null || next == null ? null : next - base
    return [key, { baseline: base, projected: next, absoluteDelta: delta, relativeDelta: delta != null && base != null && base !== 0 ? delta / Math.abs(base) * 100 : null }]
  })) }
}
export function classifyProbeSeries(points: ProbePointResult[], metricKey: string): Pick<ProbeSeriesResult, 'curve' | 'confidence' | 'warnings'> {
  const values = points.map((point) => point.metrics[metricKey]?.absoluteDelta).filter((value): value is number => value != null && Number.isFinite(value))
  if (!values.length) return { curve: 'unstable', confidence: 'unavailable', warnings: ['metric-unavailable'] }
  if (values.some((value, index) => index > 0 && value < values[index - 1])) return { curve: 'non-monotonic', confidence: 'limited', warnings: ['non-monotonic'] }
  if (values.every((value) => Math.abs(value) < (getMetricDefinition(metricKey)?.epsilon ?? 0))) return { curve: 'capped', confidence: 'supported', warnings: ['no-effective-change'] }
  if (values.length < 2) return { curve: 'linear', confidence: 'supported', warnings: [] }
  const slopes = values.slice(1).map((value, index) => value - values[index]); const spread = Math.max(...slopes) - Math.min(...slopes); const scale = Math.max(1, ...values.map(Math.abs))
  // Catalog fixture execution is a separate release gate; runtime shape alone is only supported evidence.
  return spread / scale < .08 ? { curve: 'linear', confidence: 'supported', warnings: [] } : { curve: slopes[slopes.length - 1] < slopes[0] ? 'diminishing' : 'threshold', confidence: 'supported', warnings: [] }
}
export function detectBaselineFindings(result: CalcResult, hasFullDpsSelection: boolean): Array<{ id: string; dimension: AnalysisDimension; status: 'blocked' | 'at-risk'; value?: number }> {
  const findings: Array<{ id: string; dimension: AnalysisDimension; status: 'blocked' | 'at-risk'; value?: number }> = []
  for (const [id, key] of [['fire-resistance', 'FireResistTotal'], ['cold-resistance', 'ColdResistTotal'], ['lightning-resistance', 'LightningResistTotal']] as const) { const value = getPowerStatValue(result, key); if (value != null && value < 75) findings.push({ id, dimension: 'defense', status: 'at-risk', value }) }
  return findings
}

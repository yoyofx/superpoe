import { ArrowRight, CircleHelp, Crosshair, GitBranch, Gauge, Layers3, Shield, Sparkles, Target, X, Zap } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from '@/i18n/useTranslation'
import { formatUiNumber, uiText } from '@/i18n/uiLocale'
import { getLocalizedNodeDisplay, translateGameText } from '@/i18n/translationLoader'
import type { CalcResult, SkillCalculationDetails, SkillContributionSourceType, SkillCriticalContribution, SkillDamageBreakdown, SkillGainContribution, SkillConversionContribution, SkillModifierContribution, SkillSpeedContribution } from '@/types/calc'
import type { AnalysisSkillScope } from '@/engine/attributeAnalysis'
import { getLocalizedSkillName, resolveSkillCatalogName, type SkillCatalog } from '@/engine/skillCatalog'
import { translateEquipmentItemName } from '@/components/equipment/EquipmentItemInspector'
import type { TreeData } from '@/types/tree'

type Language = Parameters<typeof uiText>[0]
type SourceType = SkillContributionSourceType

interface SourceValue {
  type: SourceType
  value: number
}

interface ModifierSourceValue extends SourceValue {
  source: string
  stat: string
  damageType: SkillDamageBreakdown['type']
  bucket: SkillModifierContribution['bucket']
}

interface DamageFlow {
  from: string
  to: string
  value: number
  kind: 'gain' | 'conversion'
  source: string
  sourceType?: SourceType
}

interface DamageRange {
  type: Exclude<SkillDamageBreakdown['type'], 'all'>
  min: number
  max: number
  average: number
  source: string
  sourceType?: SourceType
}

interface AddedDamageRange extends DamageRange {
  sourceType: SourceType
}

interface FinalDamageType {
  type: Exclude<SkillDamageBreakdown['type'], 'all'>
  averageHit: number
  finalDps: number
  share: number
  effectiveMultiplier: number | null
}

export interface DamageStructureReportData {
  skillName: string
  skillType: SkillCalculationDetails['skillType']
  calculationScope: 'selectedSkill' | 'fullDps' | 'fallback'
  includedSkillCount: number
  totalDps: number | null
  averageHit: number | null
  speed: number | null
  effectiveRate: number | null
  hitChance: number | null
  dpsMultiplier: number | null
  quantityMultiplier: number | null
  damageTypes: SkillDamageBreakdown[]
  baseRanges: DamageRange[]
  addedRanges: AddedDamageRange[]
  /** Starting base plus all separately exposed added damage, grouped by damage type. */
  combinedBaseRanges: DamageRange[]
  /** Sum of the average values in combinedBaseRanges. This is a base-pool value, not final average hit. */
  baseTotalAverage: number | null
  baseRole: 'weapon' | 'skillLevel' | 'mixed' | 'unknown'
  finalDamageTypes: FinalDamageType[]
  baseSources: SourceValue[]
  gains: DamageFlow[]
  conversions: DamageFlow[]
  increased: { total: number | null; factor: number | null; sources: SourceValue[]; details: ModifierSourceValue[] }
  more: { factor: number | null; sources: SourceValue[]; nodes: Array<{ type: SourceType; value: number; factor: number }>; details: ModifierSourceValue[] }
  speedModifiers: SkillSpeedContribution[]
  critModifiers: SkillCriticalContribution[]
  critChance: number | null
  critMultiplier: number | null
  effectiveMultipliers: Array<{ type: string; value: number }>
  effectiveBreakdown: string[]
  formula: string[]
}

const SOURCE_COLORS: Record<SourceType, string> = {
  equipment: '#c99545',
  tree: '#6fa987',
  jewel: '#aa83c5',
  skill: '#6f9fc0',
  buff: '#d36f63',
  config: '#879198',
}

function sourceType(source: string, hint?: string): SourceType {
  if (hint === 'jewel') return 'jewel'
  if (hint === 'tree') return 'tree'
  if (hint === 'skill') return 'skill'
  if (hint === 'buff') return 'buff'
  if (hint === 'config') return 'config'
  const value = source.toLowerCase()
  if (/jewel|socket|radius|珠宝/.test(value)) return 'jewel'
  if (/tree|passive|talent|天赋/.test(value)) return 'tree'
  if (/skill|gem|support|技能/.test(value)) return 'skill'
  if (/buff|aura|curse|charge|战斗|光环/.test(value)) return 'buff'
  if (/config|enemy|敌人|配置/.test(value)) return 'config'
  return 'equipment'
}

function addSource(target: SourceValue[], source: string, value: number, hint?: SourceType): void {
  if (!Number.isFinite(value) || value === 0) return
  target.push({ type: sourceType(source, hint), value })
}

function sumSourceValues(values: SourceValue[]): SourceValue[] {
  const grouped = new Map<SourceType, number>()
  for (const entry of values) grouped.set(entry.type, (grouped.get(entry.type) || 0) + entry.value)
  return [...grouped.entries()].map(([type, value]) => ({ type, value })).filter((entry) => Math.abs(entry.value) > 0.0001)
}

function contributionSources(entries: Array<{ source: string; sourceType?: SourceType; value: number }>): SourceValue[] {
  return sumSourceValues(entries.map((entry) => ({ type: sourceType(entry.source, entry.sourceType), value: entry.value })))
}

function modifierSourceValues(entries: SkillModifierContribution[]): ModifierSourceValue[] {
  const grouped = new Map<string, ModifierSourceValue>()
  for (const entry of entries) {
    if (!Number.isFinite(entry.value) || entry.value === 0) continue
    const type = sourceType(entry.source, entry.sourceType)
    const key = `${entry.bucket}|${entry.damageType}|${entry.stat}|${type}|${entry.source}`
    const current = grouped.get(key)
    if (current) current.value += entry.value
    else grouped.set(key, { type, value: entry.value, source: entry.source, stat: entry.stat, damageType: entry.damageType, bucket: entry.bucket })
  }
  return [...grouped.values()]
}

function uniqueModifierEntries(entries: SkillModifierContribution[]): SkillModifierContribution[] {
  const seen = new Set<string>()
  return entries.filter((entry) => {
    // A broad modifier such as ElementalDamage is returned once for each
    // matching damage type. Keep one logical contribution for source totals.
    const key = `${entry.bucket}|${entry.stat}|${entry.value}|${entry.sourceType || ''}|${entry.source}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function toDamageRange(type: Exclude<SkillDamageBreakdown['type'], 'all'>, min: number, max: number, source: string, hint?: SourceType): DamageRange {
  return { type, min, max, average: (min + max) / 2, source, sourceType: sourceType(source, hint) }
}

function buildAddedDamageRanges(modifiers: SkillModifierContribution[]): AddedDamageRange[] {
  const ranges = new Map<string, AddedDamageRange>()
  for (const entry of modifiers) {
    if (entry.bucket !== 'addedMin' && entry.bucket !== 'addedMax' || entry.damageType === 'all') continue
    const entrySourceType = sourceType(entry.source, entry.sourceType)
    const key = `${entry.damageType}|${entrySourceType}|${entry.source}`
    const current = ranges.get(key) || {
      type: entry.damageType,
      min: 0,
      max: 0,
      average: 0,
      source: entry.source,
      sourceType: entrySourceType,
    }
    if (entry.bucket === 'addedMin') current.min += entry.value
    else current.max += entry.value
    current.average = (current.min + current.max) / 2
    ranges.set(key, current)
  }
  return [...ranges.values()].filter((entry) => entry.min !== 0 || entry.max !== 0)
}

function combineDamageRanges(ranges: Array<DamageRange | AddedDamageRange>): DamageRange[] {
  const grouped = new Map<DamageRange['type'], DamageRange & { sources: Set<string> }>()
  for (const entry of ranges) {
    const current = grouped.get(entry.type) || {
      type: entry.type,
      min: 0,
      max: 0,
      average: 0,
      source: '',
      sources: new Set<string>(),
    }
    current.min += Number.isFinite(entry.min) ? entry.min : 0
    current.max += Number.isFinite(entry.max) ? entry.max : 0
    if (entry.source) current.sources.add(entry.source)
    current.average = (current.min + current.max) / 2
    current.source = [...current.sources].join(' + ')
    grouped.set(entry.type, current)
  }
  return [...grouped.values()].map(({ sources: _sources, ...entry }) => entry)
}

export function buildDamageStructureReportData(
  result: CalcResult | null,
  scope?: AnalysisSkillScope,
  options: { totalDps?: number | null; finalDamageDps?: Record<string, number>; calculationScope?: DamageStructureReportData['calculationScope']; includedSkillCount?: number } = {},
): DamageStructureReportData | null {
  if (!result) return null
  const details = result.SkillDetails
  const skill = details?.activeSkills.find((entry) => entry.index === details.activeSkillIndex) || details?.activeSkills[0]
  const weaponBaseRanges: DamageRange[] = (details?.weaponDamage || []).map((entry) => toDamageRange(entry.damageType, entry.min, entry.max, entry.source || 'Weapon', entry.sourceType))
  const skillBaseRanges: DamageRange[] = (details?.skillDamage || []).map((entry) => toDamageRange(entry.damageType, entry.min, entry.max, entry.source || 'Skill level', entry.sourceType))
  const baseRanges: DamageRange[] = [...weaponBaseRanges, ...skillBaseRanges]
  const addedRanges = buildAddedDamageRanges(details?.modifiers || [])
  const combinedBaseRanges = combineDamageRanges([...baseRanges, ...addedRanges])
  const baseTotalAverage = combinedBaseRanges.length
    ? combinedBaseRanges.reduce((sum, entry) => sum + entry.average, 0)
    : null
  const baseSources: SourceValue[] = []
  for (const entry of [...baseRanges, ...addedRanges]) addSource(baseSources, entry.source, entry.average, entry.sourceType)
  // Some cached/native calculations expose only the top-level result. Keep
  // the report useful in that case without inventing a source split.
  if (!baseSources.length && Number.isFinite(result.AverageHit) && result.AverageHit > 0) {
    addSource(baseSources, 'Skill', result.AverageHit)
  }

  const flows = (entries: Array<SkillGainContribution | SkillConversionContribution>, kind: DamageFlow['kind']): DamageFlow[] => entries
    .filter((entry) => Number.isFinite(entry.value) && entry.value !== 0)
    .map((entry) => ({ from: entry.fromType, to: entry.toType, value: entry.value, kind, source: entry.source, sourceType: entry.sourceType }))
  const increasedMods = uniqueModifierEntries((details?.modifiers || []).filter((entry) => entry.bucket === 'increased'))
  const moreMods = uniqueModifierEntries((details?.modifiers || []).filter((entry) => entry.bucket === 'more'))
  const increasedTotal = details ? increasedMods.reduce((sum, entry) => sum + entry.value, 0) : null
  const moreFactor = details
    ? moreMods.length
      ? moreMods.reduce((factor, entry) => factor * (1 + entry.value / 100), 1)
      : 1 + ((details.damageTypes || []).find((entry) => entry.type === 'all')?.more || 0) / 100
    : null
  const effectiveRate = Number.isFinite(details?.effectiveRate) ? details!.effectiveRate! : Number.isFinite(details?.speed) ? details!.speed! : Number.isFinite(result.Speed) ? result.Speed : null
  const hitChance = Number.isFinite(details?.hitChance) ? details!.hitChance! : 100
  const dpsMultiplier = Number.isFinite(details?.dpsMultiplier) ? details!.dpsMultiplier! : 1
  const quantityMultiplier = Number.isFinite(details?.quantityMultiplier) ? details!.quantityMultiplier! : 1
  const damageTypes = (details?.damageTypes || []).filter((entry): entry is SkillDamageBreakdown & { type: Exclude<SkillDamageBreakdown['type'], 'all'> } => entry.type !== 'all')
  const finalTypeDpsOverride = options.finalDamageDps && Object.keys(options.finalDamageDps).length > 0 ? options.finalDamageDps : null
  const finalTypeTotal = finalTypeDpsOverride
    ? Object.values(finalTypeDpsOverride).reduce((sum, value) => sum + (Number.isFinite(value) && value > 0 ? value : 0), 0)
    : damageTypes.reduce((sum, entry) => {
    const average = damageTypeValue(entry)
    return sum + (Number.isFinite(entry.finalDps) ? entry.finalDps! : average * hitChance / 100 * (effectiveRate || 0) * dpsMultiplier * quantityMultiplier)
  }, 0)
  const finalDamageTypes: FinalDamageType[] = damageTypes
    .map((entry) => {
      const averageHit = damageTypeValue(entry)
      const finalDps = finalTypeDpsOverride?.[entry.type] ?? (Number.isFinite(entry.finalDps) ? entry.finalDps! : averageHit * hitChance / 100 * (effectiveRate || 0) * dpsMultiplier * quantityMultiplier)
      return { type: entry.type, averageHit, finalDps, share: finalTypeTotal > 0 ? finalDps / finalTypeTotal * 100 : 0, effectiveMultiplier: Number.isFinite(entry.effectiveMultiplier) ? entry.effectiveMultiplier! : null }
    })
    .filter((entry) => entry.finalDps > 0 || damageTypes.some((source) => source.type === entry.type && damageTypeValue(source) > 0))
  if (finalTypeDpsOverride) {
    const existingTypes = new Set(finalDamageTypes.map((entry) => entry.type))
    for (const [type, finalDps] of Object.entries(finalTypeDpsOverride)) {
      if (existingTypes.has(type as FinalDamageType['type']) || !Number.isFinite(finalDps) || finalDps <= 0) continue
      finalDamageTypes.push({ type: type as FinalDamageType['type'], averageHit: 0, finalDps, share: finalTypeTotal > 0 ? finalDps / finalTypeTotal * 100 : 0, effectiveMultiplier: null })
    }
  }
  return {
    skillName: skill?.label || 'Current skill',
    skillType: details?.skillType || 'other',
    calculationScope: options.calculationScope || (scope?.mode === 'full-dps' ? 'fullDps' : scope?.mode === 'fallback' ? 'fallback' : result.FullSkillDPS?.length ? 'fullDps' : 'selectedSkill'),
    includedSkillCount: options.includedSkillCount || scope?.entries.length || result.FullSkillDPS?.length || result.AllSkillDPS?.length || 1,
    // The analysis page aggregates the same scope. Do not replace that total
    // with the representative skill's own DPS.
    totalDps: options.totalDps != null ? options.totalDps : scope?.entries.length ? scope.entries.reduce((sum, entry) => sum + entry.dps, 0) : preferredDps(result, details),
    averageHit: Number.isFinite(details?.averageHit) ? details!.averageHit! : Number.isFinite(result.AverageHit) ? result.AverageHit : null,
    speed: Number.isFinite(details?.speed) ? details!.speed! : Number.isFinite(result.Speed) ? result.Speed : null,
    effectiveRate,
    hitChance: Number.isFinite(details?.hitChance) ? details!.hitChance! : null,
    dpsMultiplier: Number.isFinite(details?.dpsMultiplier) ? details!.dpsMultiplier! : null,
    quantityMultiplier: Number.isFinite(details?.quantityMultiplier) ? details!.quantityMultiplier! : null,
    damageTypes,
    baseRanges,
    addedRanges,
    combinedBaseRanges,
    baseTotalAverage,
    baseRole: weaponBaseRanges.length && skillBaseRanges.length ? 'mixed' : weaponBaseRanges.length ? 'weapon' : skillBaseRanges.length ? 'skillLevel' : 'unknown',
    finalDamageTypes,
    baseSources: sumSourceValues(baseSources),
    gains: flows(details?.gains || [], 'gain'),
    conversions: flows(details?.conversions || [], 'conversion'),
    increased: { total: increasedTotal, factor: increasedTotal == null ? null : 1 + increasedTotal / 100, sources: sumSourceValues(increasedMods.map((entry) => ({ type: sourceType(entry.source, entry.sourceType), value: entry.value }))), details: modifierSourceValues(increasedMods) },
    more: { factor: moreFactor, sources: sumSourceValues(moreMods.map((entry) => ({ type: sourceType(entry.source, entry.sourceType), value: entry.value }))), nodes: moreMods.map((entry) => ({ type: sourceType(entry.source, entry.sourceType), value: entry.value, factor: 1 + entry.value / 100 })), details: modifierSourceValues(moreMods) },
    speedModifiers: details?.speedModifiers || [],
    critModifiers: details?.critModifiers || [],
    critChance: Number.isFinite(details?.critChance) ? details!.critChance! : Number.isFinite(result.CritChance) ? result.CritChance : null,
    critMultiplier: Number.isFinite(details?.critMultiplier) ? details!.critMultiplier! : Number.isFinite(result.CritMultiplier) ? result.CritMultiplier : null,
    effectiveMultipliers: (details?.damageTypes || []).filter((entry) => entry.type !== 'all' && Number.isFinite(entry.effectiveMultiplier)).map((entry) => ({ type: entry.type, value: entry.effectiveMultiplier! })),
    effectiveBreakdown: [...new Set((details?.damageTypes || []).flatMap((entry) => entry.effectiveBreakdown || []))].slice(0, 6),
    formula: details?.dpsFormula || [],
  }
}

function number(value: number | null | undefined, language: Language, digits = 1): string {
  if (value == null || !Number.isFinite(value)) return '—'
  return formatUiNumber(value, language, { maximumFractionDigits: digits })
}

function percent(value: number | null | undefined, language: Language, digits = 1): string {
  return value == null || !Number.isFinite(value) ? '—' : `${number(value, language, digits)}%`
}

function damageTypeValue(entry: SkillDamageBreakdown): number {
  return entry.finalAverage ?? entry.averageHit ?? ((entry.hitMin || 0) + (entry.hitMax || 0)) / 2
}

function damageTypeBarWidth(entry: SkillDamageBreakdown, total: number | null): number {
  const value = damageTypeValue(entry)
  return Math.max(2, Math.min(100, value / Math.max(1, total || 1) * 100))
}

function preferredDps(result: CalcResult, details?: SkillCalculationDetails): number | null {
  const candidates = [details?.totalDps, result.TotalDPS, result.FullDPS, result.AllDPS]
  return candidates.find((value) => typeof value === 'number' && Number.isFinite(value) && value > 0)
    ?? candidates.find((value) => typeof value === 'number' && Number.isFinite(value))
    ?? null
}

function sourceLabel(type: SourceType, language: Language): string {
  const labels: Record<SourceType, [string, string, string, string]> = {
    equipment: ['Equipment', '装备', '裝備', '장비'],
    tree: ['Passive tree', '天赋', '天賦', '패시브 트리'],
    jewel: ['Jewels', '珠宝', '珠寶', '주얼'],
    skill: ['Skills', '技能', '技能', '스킬'],
    buff: ['Buffs', 'Buff / 增益', 'Buff / 增益', '버프'],
    config: ['Config', '配置', '配置', '설정'],
  }
  const [en, zhCN, zhTW, koKR] = labels[type]
  return uiText(language, en, zhCN, zhTW, koKR)
}

function damageTypeLabel(type: string, language: Language): string {
  const labels: Record<string, [string, string, string, string]> = {
    physical: ['Physical', '物理', '物理', '물리'], lightning: ['Lightning', '闪电', '閃電', '번개'], cold: ['Cold', '冰霜', '冰霜', '냉기'], fire: ['Fire', '火焰', '火焰', '화염'], chaos: ['Chaos', '混沌', '混沌', '카오스'], all: ['All', '全部', '全部', '전체'],
  }
  const [en, zhCN, zhTW, koKR] = labels[type] || [type, type, type, type]
  return uiText(language, en, zhCN, zhTW, koKR)
}

function SourceDonut({ values, language, unit = '' }: { values: SourceValue[]; language: Language; unit?: string }) {
  const positive = values.filter((entry) => entry.value > 0)
  const total = positive.reduce((sum, entry) => sum + entry.value, 0)
  if (!positive.length || total <= 0) return <div className="damage-structure-chart-empty">—</div>
  let cursor = 0
  const boundaries: number[] = []
  const stops = positive.map((entry) => {
    const start = cursor / total * 360
    cursor += entry.value
    if (cursor < total) boundaries.push(cursor / total * 360)
    return `${SOURCE_COLORS[entry.type]} ${start}deg ${cursor / total * 360}deg`
  }).join(', ')
  return <div className="damage-structure-donut-wrap"><div className="damage-structure-donut" style={{ background: `conic-gradient(${stops})` }}>{boundaries.map((angle) => <i key={angle} className="damage-structure-donut-separator" aria-hidden="true" style={{ transform: `rotate(${angle}deg)` }} />)}<strong>{number(total, language, 0)}{unit}</strong><span>{uiText(language, 'total', '合计', '合計', '합계')}</span></div><div className="damage-structure-legend"><small>{uiText(language, 'Source share', '来源占比', '來源占比', '출처 비율')}</small>{positive.map((entry) => <div key={entry.type}><i style={{ background: SOURCE_COLORS[entry.type] }} /><span>{sourceLabel(entry.type, language)}</span><b>{(entry.value / total * 100).toFixed(0)}%</b></div>)}</div></div>
}

function SourceBars({ values, language, unit = '%', caption = '' }: { values: SourceValue[]; language: Language; unit?: string; caption?: string }) {
  const max = Math.max(1, ...values.map((entry) => Math.abs(entry.value)))
  return <div className="damage-structure-source-bars">{caption && <span className="damage-structure-source-bars-caption">{caption}</span>}{values.length ? values.map((entry) => <div key={entry.type} className="damage-structure-source-row"><span><i style={{ background: SOURCE_COLORS[entry.type] }} />{sourceLabel(entry.type, language)}</span><div><b style={{ width: `${Math.max(3, Math.abs(entry.value) / max * 100)}%`, background: SOURCE_COLORS[entry.type] }} /></div><strong>{number(entry.value, language, 1)}{unit}</strong></div>) : <span className="damage-structure-muted">—</span>}</div>
}

function modifierStatLabel(stat: string, damageType: SkillDamageBreakdown['type'], language: Language): string {
  if (damageType !== 'all' && /Damage/i.test(stat)) return damageTypeLabel(damageType, language)
  const labels: Record<string, [string, string, string, string]> = {
    Damage: ['Damage', '伤害', '傷害', '피해'],
    ElementalDamage: ['Elemental damage', '元素伤害', '元素傷害', '원소 피해'],
    PhysicalDamage: ['Physical damage', '物理伤害', '物理傷害', '물리 피해'],
    Speed: ['Speed', '速度', '速度', '속도'],
    CritChance: ['Critical chance', '暴击率', '暴擊率', '치명타 확률'],
    CritMultiplier: ['Critical damage', '暴击伤害', '暴擊傷害', '치명타 피해'],
  }
  const value = labels[stat]
  return value ? uiText(language, ...value) : translateGameText(stat, language)
}

function ModifierSourceRows({ modifiers, language, treeData, skillCatalog }: { modifiers: ModifierSourceValue[]; language: Language; treeData?: TreeData | null; skillCatalog?: SkillCatalog | null }) {
  if (!modifiers.length) return <span className="damage-structure-muted">—</span>
  return <div className="damage-structure-modifier-sources">{modifiers.map((entry, index) => {
    const value = entry.bucket === 'more' ? `×${(1 + entry.value / 100).toFixed(2)}` : `${entry.value > 0 ? '+' : ''}${number(entry.value, language, 1)}%`
    return <div key={`${entry.bucket}-${entry.damageType}-${entry.stat}-${entry.source}-${index}`} title={`${entry.source} · ${entry.stat}`}><span><i style={{ background: SOURCE_COLORS[entry.type] }} />{modifierStatLabel(entry.stat, entry.damageType, language)}<small>{sourceLabel(entry.type, language)} · {sourceName(entry.source, language, treeData, skillCatalog, entry.type)}</small></span><strong>{value}</strong></div>
  })}</div>
}

function SpeedSourceRows({ modifiers, language, treeData, skillCatalog }: { modifiers: SkillSpeedContribution[]; language: Language; treeData?: TreeData | null; skillCatalog?: SkillCatalog | null }) {
  const grouped = new Map<string, SkillSpeedContribution>()
  for (const entry of modifiers) {
    if (!Number.isFinite(entry.value) || entry.value === 0) continue
    const key = `${entry.bucket}|${entry.source}|${entry.sourceType || ''}`
    const current = grouped.get(key)
    if (current) current.value += entry.value
    else grouped.set(key, { ...entry })
  }
  const rows = [...grouped.values()]
  if (!rows.length) return <span className="damage-structure-muted">—</span>
  return <div className="damage-structure-speed-sources">{rows.map((entry, index) => {
    const type = sourceType(entry.source, entry.sourceType)
    return <div key={`${entry.bucket}-${entry.source}-${index}`} title={entry.source}><span><i style={{ background: SOURCE_COLORS[type] }} />{sourceLabel(type, language)}<small>{sourceName(entry.source, language, treeData, skillCatalog, type)}</small></span><strong>{entry.bucket === 'more' ? `×${(1 + entry.value / 100).toFixed(2)}` : `${entry.value > 0 ? '+' : ''}${number(entry.value, language, 1)}%`}</strong></div>
  })}</div>
}

function sourceName(source: string, language: Language, treeData?: TreeData | null, skillCatalog?: SkillCatalog | null, sourceKind?: SourceType): string {
  const treeMatch = source.match(/^Tree:([^:]+)/)
  if (treeMatch && treeData) {
    const node = treeData.nodes[treeMatch[1]]
    if (node) return getLocalizedNodeDisplay(node, language).name || treeMatch[1]
  }
  const itemMatch = source.match(/^Item:[^:]+:(.*)$/)
  if (itemMatch?.[1]) return translateEquipmentItemName(itemMatch[1], 'RARE', language)
  const skillMatch = source.match(/^Skill:(.*)$/)
  if (skillMatch?.[1] || sourceKind === 'skill') {
    const skillName = (skillMatch?.[1] || source).trim()
    const entry = resolveSkillCatalogName(skillName, skillCatalog || null)
    return getLocalizedSkillName({ name: skillName }, entry, language) || translateGameText(skillName, language)
  }
  const display = source
    .replace(/^Tree:/, 'Tree · ')
    .replace(/^Buff:/, 'Buff · ')
    .replace(/^Aura:/, 'Aura · ')
    .replace(/^Config:/, 'Config · ')
    .replace(/^Enemy:/, 'Enemy · ')
  return translateGameText(display, language)
}

function CriticalSourceRows({ modifiers, language, treeData, skillCatalog }: { modifiers: SkillCriticalContribution[]; language: Language; treeData?: TreeData | null; skillCatalog?: SkillCatalog | null }) {
  if (!modifiers.length) return null
  const bucketLabel = (bucket: SkillCriticalContribution['bucket']) => bucket === 'base'
    ? uiText(language, 'base', '基础', '基礎', '기본')
    : bucket === 'increased'
      ? uiText(language, 'increased', '提高', '提高', '증가')
      : uiText(language, 'more', '独立倍率', '獨立倍率', 'more')
  return <div className="damage-structure-crit-sources">{modifiers.map((entry, index) => {
    const type = sourceType(entry.source, entry.sourceType)
    const value = entry.bucket === 'more' ? `×${(1 + entry.value / 100).toFixed(2)}` : `${entry.value > 0 ? '+' : ''}${number(entry.value, language, 1)}%`
    return <div key={`${entry.stat}-${entry.source}-${index}`} title={entry.source}><span><i style={{ background: SOURCE_COLORS[type] }} />{entry.stat === 'CritChance' ? uiText(language, 'Crit chance', '暴击率', '暴擊率', '치명타 확률') : uiText(language, 'Critical damage', '暴击伤害', '暴擊傷害', '치명타 피해')}<small>{sourceLabel(type, language)} · {sourceName(entry.source, language, treeData, skillCatalog, type)} · {bucketLabel(entry.bucket)}</small></span><strong>{value}</strong></div>
  })}</div>
}

function CriticalAverageFormula({ critChance, critMultiplier, language }: { critChance: number | null; critMultiplier: number | null; language: Language }) {
  const l = (en: string, zhCN: string, zhTW = zhCN, koKR = en) => uiText(language, en, zhCN, zhTW, koKR)
  const chance = critChance == null || !Number.isFinite(critChance) ? null : Math.max(0, Math.min(100, critChance))
  const multiplier = critMultiplier != null && Number.isFinite(critMultiplier) ? critMultiplier : null
  const expectedFactor = chance != null && multiplier != null ? 1 + (chance / 100) * (multiplier - 1) : null
  const formula = chance == null || multiplier == null || expectedFactor == null
    ? l('Normal hit rate × 1.00 + critical hit rate × critical damage multiplier', '普通命中率 × 1.00 + 暴击命中率 × 暴击伤害倍率', '普通命中率 × 1.00 + 暴擊命中率 × 暴擊傷害倍率', '일반 적중률 × 1.00 + 치명타 적중률 × 치명타 피해 배율')
    : `${percent(100 - chance, language)} × 1.00 + ${percent(chance, language)} × ${number(multiplier, language, 2)} = ×${number(expectedFactor, language, 2)}`
  return <div className="damage-structure-crit-formula"><span>{l('Average crit multiplier formula', '暴击平均倍率公式', '暴擊平均倍率公式', '치명타 평균 배율 공식')}</span><code>{formula}</code><small>{l('The result is the weighted average of normal hits and critical hits.', '结果是普通命中与暴击命中按概率加权后的平均倍率。', '結果是普通命中與暴擊命中按機率加權後的平均倍率。', '일반 적중과 치명타 적중을 확률로 가중한 평균 배율입니다.')}</small></div>
}

function FlowRows({ flows, language, treeData, skillCatalog }: { flows: DamageFlow[]; language: Language; treeData?: TreeData | null; skillCatalog?: SkillCatalog | null }) {
  return <div className="damage-structure-flow-list">{flows.length ? flows.map((entry, index) => {
    const type = sourceType(entry.source, entry.sourceType)
    return <div key={`${entry.kind}-${entry.source}-${index}`} title={entry.source}><span>{damageTypeLabel(entry.from, language)}<small>{sourceLabel(type, language)} · {sourceName(entry.source, language, treeData, skillCatalog, type)}</small></span><ArrowRight /><strong>{damageTypeLabel(entry.to, language)}</strong><b>{number(entry.value, language, 1)}%</b></div>
  }) : <span className="damage-structure-muted">{uiText(language, 'No conversion or Gain is exposed for this skill.', '当前技能没有可展示的转换或 Gain。', '目前技能沒有可展示的轉換或 Gain。', '이 스킬에 표시할 변환 또는 Gain이 없습니다.')}</span>}</div>
}

function Meter({ value, max = 100, label, display }: { value: number | null; max?: number; label: string; display: string }) {
  const width = value == null || !Number.isFinite(value) ? 0 : Math.max(0, Math.min(100, value / max * 100))
  return <div className="damage-structure-meter"><div><span>{label}</span><b>{display}</b></div><i><em style={{ width: `${width}%` }} /></i></div>
}

function DamageRangeRows({ ranges, language, empty, showSource = false, treeData, skillCatalog }: { ranges: DamageRange[]; language: Language; empty: string; showSource?: boolean; treeData?: TreeData | null; skillCatalog?: SkillCatalog | null }) {
  if (!ranges.length) return <span className="damage-structure-muted">{empty}</span>
  const max = Math.max(1, ...ranges.map((entry) => entry.average))
  return <div className="damage-structure-range-list">{ranges.map((entry, index) => {
    const type = sourceType(entry.source, entry.sourceType)
    return <div key={`${entry.type}-${entry.source}-${index}`} title={entry.source || undefined}><span>{damageTypeLabel(entry.type, language)}{showSource && <small>{sourceLabel(type, language)} · {sourceName(entry.source, language, treeData, skillCatalog, type)}</small>}</span><i><b style={{ width: `${Math.max(3, entry.average / max * 100)}%` }} /></i><strong>{number(entry.min, language, 0)} - {number(entry.max, language, 0)}</strong></div>
  })}</div>
}

function FinalDamageBreakdown({ data, language, skillLevel, formulaLayers, onOpenLayer }: { data: DamageStructureReportData; language: Language; skillLevel?: number; formulaLayers: Array<{ id: string; title: string; subtitle: string; summary: string }>; onOpenLayer: (id: string) => void }) {
  const l = (en: string, zhCN: string, zhTW = zhCN, koKR = en) => uiText(language, en, zhCN, zhTW, koKR)
  return (
    <section className="damage-structure-final-breakdown">
      <div id="damage-structure-formula" className="damage-structure-formula-wrap">
        <div className="damage-structure-formula-title">
          <span>{l('How damage is formed', '伤害如何形成', '傷害如何形成', '피해 형성 과정')} <b className="damage-structure-formula-stage-label">({l('7 major damage composition areas', '7大伤害构成区域', '7大傷害構成區域', '7대 피해 구성 영역')})</b></span>
          <small>{l('Click a node to locate its result; use View details for the full breakdown', '点击节点定位统计结果；点击查看明细打开完整明细', '點擊節點定位統計結果；點擊查看明細開啟完整明細', '노드에서 결과를 찾고 상세 보기를 눌러 전체 내역을 확인합니다')}</small>
        </div>
        <p className="damage-structure-formula-note">{l('Conversion changes the damage type flow, while Gain adds extra damage. They share one display stage here, but the calculation still applies their rules separately.', '转换负责改变伤害类型的流向，额外 (Gain) 负责叠加新的伤害来源。这里合并为一个展示阶段，但计算仍按各自规则处理。', '轉換負責改變傷害類型的流向，額外 (Gain) 負責疊加新的傷害來源。這裡合併為一個展示階段，但計算仍按各自規則處理。', '변환은 피해 유형의 흐름을 바꾸고 Gain은 추가 피해를 더합니다. 여기서는 하나의 표시 단계로 묶지만 계산은 각 규칙을 따로 적용합니다.')}</p>
        <div className="damage-structure-formula" aria-label={l('Damage formula flow', '伤害公式流程', '傷害公式流程', '피해 공식 흐름')}>
          {formulaLayers.map((layer, index) => <span key={layer.id}>
            <button type="button" className={`damage-structure-formula-node damage-structure-formula-node-${layer.id}`} onClick={() => onOpenLayer(layer.id)}>
              <strong>{layer.title}</strong>
              <b>{layer.summary}</b>
              <small>{layer.subtitle}</small>
            </button>
            {index < formulaLayers.length - 1 && <ArrowRight />}
          </span>)}
          <span className="damage-structure-formula-final-group">
            <ArrowRight />
            <button type="button" className="damage-structure-formula-final" onClick={() => onOpenLayer('finalDps')} aria-label={l('View final DPS and damage types', '查看最终 DPS 与伤害类型', '查看最終 DPS 與傷害類型', '최종 DPS 및 피해 유형 보기')} title={l('View final DPS and damage types', '查看最终 DPS 与伤害类型', '查看最終 DPS 與傷害類型', '최종 DPS 및 피해 유형 보기')}>
              <strong>{l('Final DPS', '最终 DPS', '最終 DPS', '최종 DPS')}</strong>
              <b>{number(data.totalDps, language, 0)}</b>
              <small>{l('calculated result', '计算结果', '計算結果', '계산 결과')}</small>
            </button>
          </span>
        </div>
        <div className="damage-structure-final-context">
          <span>{l('Average hit', '平均击中', '平均擊中', '평균 적중')} <b>{number(data.averageHit, language, 1)}</b></span>
          <span>{l('Rate', '频率', '頻率', '빈도')} <b>{data.speed == null ? '—' : `${number(data.speed, language, 2)}/s`}</b></span>
          <span>{l('Level', '等级', '等級', '레벨')} <b>{skillLevel == null ? '—' : skillLevel}</b></span>
        </div>
      </div>
    </section>
  )
}

function FinalDamageTypes({ data, language }: { data: DamageStructureReportData; language: Language }) {
  const l = (en: string, zhCN: string, zhTW = zhCN, koKR = en) => uiText(language, en, zhCN, zhTW, koKR)
  const max = Math.max(1, ...data.finalDamageTypes.map((entry) => entry.finalDps))
  return <>
    <div className="damage-structure-final-dps-total"><span>{l('Final DPS', '最终 DPS', '最終 DPS', '최종 DPS')}</span><strong>{number(data.totalDps, language, 0)}</strong><small>{l('Current skill result', '当前技能结果', '目前技能結果', '현재 스킬 결과')}</small></div>
    <div className="damage-structure-final-type-heading"><strong>{l('Damage types', '伤害类型', '傷害類型', '피해 유형')}</strong><small>{l('DPS contribution by type', '各伤害类型对 DPS 的贡献', '各傷害類型對 DPS 的貢獻', '유형별 DPS 기여도')}</small></div>
    {data.finalDamageTypes.length ? <div className="damage-structure-final-type-grid">{data.finalDamageTypes.map((entry) => <div key={entry.type} className={`damage-structure-final-type-row damage-type-${entry.type}${entry.finalDps <= 0 ? ' empty' : ''}`}><span>{damageTypeLabel(entry.type, language)}</span><i><b style={{ width: `${entry.finalDps > 0 ? Math.max(3, entry.finalDps / max * 100) : 0}%` }} /></i><strong>{number(entry.finalDps, language, 0)}</strong><small>{number(entry.share, language, 1)}%</small></div>)}</div> : <span className="damage-structure-muted">{l('No damage type breakdown is available.', '暂无伤害类型明细。', '暫無傷害類型明細。', '피해 유형 내역이 없습니다.')}</span>}
  </>
}

function FinalDpsDetail({ data, language }: { data: DamageStructureReportData; language: Language }) {
  return <div className="damage-structure-final-dps-detail"><FinalDamageTypes data={data} language={language} /></div>
}

function SourceShareDetail({ label, values, language, unit = '', barsCaption = '' }: { label: string; values: SourceValue[]; language: Language; unit?: string; barsCaption?: string }) {
  if (!values.length) return null
  return <div className="damage-structure-source-share-detail">
    <div className="damage-structure-source-composition-card">
      <span>{label}</span>
      <div className="damage-structure-source-share-grid">
        <SourceDonut values={values} language={language} unit={unit} />
        <SourceBars values={values} language={language} unit={unit} caption={barsCaption} />
      </div>
    </div>
  </div>
}

function DamageBaseLayer({ data, language, treeData, skillCatalog }: { data: DamageStructureReportData; language: Language; treeData?: TreeData | null; skillCatalog?: SkillCatalog | null }) {
  const l = (en: string, zhCN: string, zhTW = zhCN, koKR = en) => uiText(language, en, zhCN, zhTW, koKR)
  const roleTitle = data.baseRole === 'weapon'
    ? l('Attack: weapon base', '攻击：武器基底', '攻擊：武器基底', '공격: 무기 기반')
    : data.baseRole === 'skillLevel'
      ? l('Spell: skill level base', '法术：技能等级基底', '法術：技能等級基底', '주문: 스킬 레벨 기반')
      : l('Starting base', '起始基底', '起始基底', '시작 기반')
  const roleHint = data.baseRole === 'weapon'
    ? l('The weapon supplies the starting range.', '武器提供起始伤害区间。', '武器提供起始傷害區間。', '무기가 시작 피해 범위를 제공합니다.')
    : data.baseRole === 'skillLevel'
      ? l('The active gem level supplies the starting range.', '当前技能等级提供起始伤害区间。', '目前技能等級提供起始傷害區間。', '현재 스킬 레벨이 시작 피해 범위를 제공합니다.')
      : l('The calculation provides the starting range for this skill.', '当前计算提供该技能的起始伤害区间。', '目前計算提供該技能的起始傷害區間。', '현재 계산이 이 스킬의 시작 피해 범위를 제공합니다.')
  return <div className="damage-structure-base">
    <SourceShareDetail label={l('Base source share', '基底来源占比', '基底來源占比', '기반 출처 비율')} values={data.baseSources} language={language} barsCaption={l('Base value', '基底数值', '基底數值', '기반 수치')} />
    <div className="damage-structure-combined">
      <div className="damage-structure-origin-heading">
        <strong>{l('Combined damage base', '合计伤害基底', '合計傷害基底', '합산 피해 기반')}</strong>
        <small>{l('Starting base and added damage are summed by damage type.', '起始基底与附加点伤已按伤害类型合计。', '起始基底與附加點傷已按傷害類型合計。', '시작 기반과 추가 피해를 피해 유형별로 합산했습니다.')}</small>
      </div>
      <DamageRangeRows ranges={data.combinedBaseRanges} language={language} empty={l('No base range exposed', '没有可读取的基底区间', '沒有可讀取的基底區間', '기본 범위가 노출되지 않음')} treeData={treeData} skillCatalog={skillCatalog} />
    </div>
    <div className="damage-structure-origin">
      <div className="damage-structure-origin-heading"><strong>{roleTitle}</strong><small>{roleHint}</small></div>
      <DamageRangeRows ranges={data.baseRanges} language={language} showSource empty={l('No base range exposed', '没有可读取的基底区间', '沒有可讀取的基底區間', '기본 범위가 노출되지 않음')} treeData={treeData} skillCatalog={skillCatalog} />
    </div>
    <div className="damage-structure-added">
      <div className="damage-structure-kicker">{l('Added damage from current build', '当前构筑附加点伤', '目前構築附加點傷', '현재 구성의 추가 피해')}</div>
      <DamageRangeRows ranges={data.addedRanges} language={language} showSource empty={l('No separate added damage exposed', '没有单独暴露的附加点伤', '沒有單獨暴露的附加點傷', '별도 추가 피해가 노출되지 않음')} treeData={treeData} skillCatalog={skillCatalog} />
    </div>
  </div>
}

function AverageHitLayer({ data, language }: { data: DamageStructureReportData; language: Language }) {
  const l = (en: string, zhCN: string, zhTW = zhCN, koKR = en) => uiText(language, en, zhCN, zhTW, koKR)
  return <div className="damage-structure-average-hit">
    <div className="damage-structure-average-hit-result">
      <span>{l('Expected average hit', '期望平均击中', '期望平均擊中', '기대 평균 적중')}</span>
      <strong>{number(data.averageHit, language, 1)}</strong>
      <small>{l('Single-hit result for the current calculation mode', '当前计算模式下的单次击中结果', '目前計算模式下的單次擊中結果', '현재 계산 모드의 단일 적중 결과')}</small>
    </div>
    <div className="damage-structure-average-hit-stats">
      <div><span>{l('Critical chance', '暴击率', '暴擊率', '치명타 확률')}</span><b>{percent(data.critChance, language)}</b></div>
      <div><span>{l('Critical damage', '暴击伤害', '暴擊傷害', '치명타 피해')}</span><b>×{data.critMultiplier == null ? '—' : data.critMultiplier.toFixed(2)}</b></div>
    </div>
    <p>{l('This is a single-hit value. Hit chance and attack/cast rate are applied later; in EFFECTIVE mode, enemy mitigation is already included.', '这是单次击中值；命中率和攻击/施法频率会在后续应用；EFFECTIVE 模式下已计入敌人减伤。', '這是單次擊中值；命中率和攻擊/施法頻率會在後續套用；EFFECTIVE 模式下已計入敵人減傷。', '단일 적중 값입니다. 적중률과 공격/시전 빈도는 이후 적용되며 EFFECTIVE 모드에서는 적 완화가 이미 포함됩니다.')}</p>
  </div>
}

function RateLayer({ data, language, treeData, skillCatalog }: { data: DamageStructureReportData; language: Language; treeData?: TreeData | null; skillCatalog?: SkillCatalog | null }) {
  const l = (en: string, zhCN: string, zhTW = zhCN, koKR = en) => uiText(language, en, zhCN, zhTW, koKR)
  const speedSources = contributionSources(data.speedModifiers)
  return <div className="damage-structure-rate">
    <Meter value={data.speed} max={5} label={l('Attack / cast rate', '攻击 / 施法频率', '攻擊 / 施法頻率', '공격 / 시전 빈도')} display={data.speed == null ? '—' : `${number(data.speed, language, 2)}/s`} />
    <SourceShareDetail label={l('Rate source share', '频率来源占比', '頻率來源占比', '빈도 출처 비율')} values={speedSources} language={language} unit="%" barsCaption={l('Rate modifier', '频率修正', '頻率修正', '빈도 보정')} />
    <div className="damage-structure-rate-sources">
      <div className="damage-structure-kicker">{l('Speed modifiers by source', '攻速来源明细', '攻速來源明細', '속도 보정 출처')}</div>
      <SpeedSourceRows modifiers={data.speedModifiers} language={language} treeData={treeData} skillCatalog={skillCatalog} />
    </div>
    <Meter value={data.totalDps} max={Math.max(1, data.totalDps || 1)} label={l('Final DPS', '最终 DPS', '最終 DPS', '최종 DPS')} display={number(data.totalDps, language, 0)} />
    {data.formula.length > 0 && <details><summary>{l('Calculation formula detail', '计算公式明细', '計算公式明細', '계산 공식 상세')}</summary><ol>{data.formula.slice(0, 8).map((line, index) => <li key={`${line}-${index}`}>{translateGameText(line, language)}</li>)}</ol></details>}
  </div>
}

function SummaryMetric({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return <div className="damage-structure-summary-metric"><span>{label}</span><strong>{value}</strong>{detail && <small>{detail}</small>}</div>
}

function LayerSummary({ id, data, language }: { id: string; data: DamageStructureReportData; language: Language }) {
  const l = (en: string, zhCN: string, zhTW = zhCN, koKR = en) => uiText(language, en, zhCN, zhTW, koKR)
  if (id === 'base') {
    return <div className="damage-structure-layer-summary"><div className="damage-structure-summary-metrics"><SummaryMetric label={l('Average base', '基底平均值', '基底平均值', '기반 평균')} value={number(data.baseTotalAverage, language, 1)} /><SummaryMetric label={l('Damage types', '伤害类型', '傷害類型', '피해 유형')} value={`${data.combinedBaseRanges.length}`} /></div><DamageRangeRows ranges={data.combinedBaseRanges} language={language} empty={l('No base range exposed', '没有可读取的基底区间', '沒有可讀取的基底區間', '기본 범위가 노출되지 않음')} /></div>
  }
  if (id === 'flow') {
    const flowSources = sumSourceValues([...data.gains, ...data.conversions].map((entry) => ({ type: sourceType(entry.source, entry.sourceType), value: entry.value })))
    return <div className="damage-structure-layer-summary"><div className="damage-structure-summary-metrics"><SummaryMetric label={l('Gain branches', '额外获得分支', '額外獲得分支', '추가 획득 분기')} value={`${data.gains.length}`} /><SummaryMetric label={l('Conversions', '转换', '轉換', '변환')} value={`${data.conversions.length}`} /></div><SourceBars values={flowSources} language={language} unit="%" /></div>
  }
  if (id === 'increased') {
    return <div className="damage-structure-layer-summary"><div className="damage-structure-summary-highlight"><span>{l('Combined factor', '合计倍率', '合計倍率', '합산 배율')}</span><strong>{data.increased.factor == null ? '—' : `×${data.increased.factor.toFixed(2)}`}</strong><small>{number(data.increased.total, language, 1)}%</small></div><SourceBars values={data.increased.sources} language={language} /></div>
  }
  if (id === 'more') {
    return <div className="damage-structure-layer-summary"><div className="damage-structure-summary-metrics"><SummaryMetric label={l('Multiplier product', '独立倍率乘积', '獨立倍率乘積', '배율 곱')} value={data.more.factor == null ? '—' : `×${data.more.factor.toFixed(2)}`} /><SummaryMetric label={l('Active sources', '生效来源', '生效來源', '활성 출처')} value={`${data.more.nodes.length}`} /></div><SourceBars values={data.more.sources} language={language} /></div>
  }
  if (id === 'crit') {
    const expectedFactor = data.critChance != null && data.critMultiplier != null ? 1 + (data.critChance / 100) * (data.critMultiplier - 1) : null
    return <div className="damage-structure-layer-summary"><div className="damage-structure-summary-metrics"><SummaryMetric label={l('Crit chance', '暴击率', '暴擊率', '치명타 확률')} value={percent(data.critChance, language)} /><SummaryMetric label={l('Critical damage', '暴击伤害', '暴擊傷害', '치명타 피해')} value={data.critMultiplier == null ? '—' : `×${data.critMultiplier.toFixed(2)}`} /><SummaryMetric label={l('Average crit multiplier', '暴击平均倍率', '暴擊平均倍率', '치명타 평균 배율')} value={expectedFactor == null ? '—' : `×${expectedFactor.toFixed(2)}`} /></div></div>
  }
  if (id === 'defence') {
    const multipliers = data.effectiveMultipliers.filter((entry) => Number.isFinite(entry.value))
    const weakest = multipliers.length ? Math.min(...multipliers.map((entry) => entry.value)) : null
    return <div className="damage-structure-layer-summary"><div className="damage-structure-summary-metrics"><SummaryMetric label={l('Filtered types', '受防御影响类型', '受防禦影響類型', '방어 영향 유형')} value={`${multipliers.length}`} /><SummaryMetric label={l('Lowest factor', '最低有效倍率', '最低有效倍率', '최저 유효 배율')} value={weakest == null ? '—' : `×${weakest.toFixed(2)}`} /></div><span className="damage-structure-summary-note">{l('The current enemy configuration is applied to the calculation.', '当前计算已应用敌人配置。', '目前計算已套用敵人配置。', '현재 적 설정이 계산에 적용되었습니다.')}</span></div>
  }
  if (id === 'averageHit') {
    return <div className="damage-structure-layer-summary"><div className="damage-structure-summary-highlight"><span>{l('Expected average hit', '增伤后平均击中', '增傷後平均擊中', '증폭 후 평균 적중')}</span><strong>{number(data.averageHit, language, 1)}</strong><small>{l('After critical calculation and mitigation', '完成暴击与敌人减伤后', '完成暴擊與敵人減傷後', '치명타와 완화 적용 후')}</small></div></div>
  }
  if (id === 'rate') {
    return <div className="damage-structure-layer-summary"><div className="damage-structure-summary-metrics"><SummaryMetric label={l('Hit chance', '命中率', '命中率', '적중률')} value={percent(data.hitChance, language)} /><SummaryMetric label={l('Output rate', '输出频率', '輸出頻率', '출력 빈도')} value={data.speed == null ? '—' : `${number(data.speed, language, 2)}/s`} /><SummaryMetric label={l('Final DPS', '最终 DPS', '最終 DPS', '최종 DPS')} value={number(data.totalDps, language, 0)} /></div></div>
  }
  return <span className="damage-structure-muted">—</span>
}

interface Props {
  data: DamageStructureReportData | null
  skillLevel?: number
  treeData?: TreeData | null
  skillCatalog?: SkillCatalog | null
}

export function DamageStructureReport({ data: scopeData, skillLevel, treeData, skillCatalog }: Props) {
  const { lang } = useTranslation()
  const l = (en: string, zhCN: string, zhTW = zhCN, koKR = en) => uiText(lang, en, zhCN, zhTW, koKR)
  const data = scopeData
  const [detailLayerId, setDetailLayerId] = useState<string | null>(null)
  useEffect(() => {
    setDetailLayerId(null)
  }, [scopeData])
  useEffect(() => {
    if (!detailLayerId) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setDetailLayerId(null)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [detailLayerId])
  const hints = data ? [
    data.finalDamageTypes.length > 0
      ? (() => {
        const dominant = [...data.finalDamageTypes].sort((left, right) => right.finalDps - left.finalDps)[0]
        return dominant
          ? l(`Most of ${data.skillName}'s final DPS is ${damageTypeLabel(dominant.type, lang)}.`, `${data.skillName} 的最终 DPS 主要来自${damageTypeLabel(dominant.type, lang)}。`, `${data.skillName} 的最終 DPS 主要來自${damageTypeLabel(dominant.type, lang)}。`, `${data.skillName}의 최종 DPS는 주로 ${damageTypeLabel(dominant.type, lang)}입니다.`)
          : ''
      })()
      : '',
    data.more.sources.length === 0
      ? l('No separate More / Less source is exposed for this skill.', '当前技能没有单独暴露的 More / Less 来源。', '目前技能沒有單獨暴露的 More / Less 來源。', '이 스킬에는 별도 More / Less 소스가 노출되지 않았습니다.')
      : '',
    data.effectiveMultipliers.some((entry) => entry.value < .8)
      ? l('Enemy defence noticeably filters at least one damage type.', '敌人防御会明显削减至少一种伤害类型。', '敵人防禦會明顯削減至少一種傷害類型。', '적 방어가 하나 이상의 피해 유형을 크게 감소시킵니다.')
      : '',
  ].filter((value): value is string => Boolean(value)).slice(0, 3) : []
  const layers = data ? [
    { id: 'base', icon: Layers3, title: l('Damage base', '伤害基底', '傷害基底', '피해 기반'), subtitle: data.baseRole === 'weapon' ? l('Weapon base damage plus added damage', '武器基础伤害加附加点伤', '武器基礎傷害加附加點傷', '무기 기본 피해와 추가 피해') : data.baseRole === 'skillLevel' ? l('Skill level base damage plus added damage', '技能等级基础伤害加附加点伤', '技能等級基礎傷害加附加點傷', '스킬 레벨 기본 피해와 추가 피해') : l('Where the skill starts its damage', '技能从哪里开始形成伤害', '技能從哪裡開始形成傷害', '스킬 피해의 시작점'), summary: data.averageHit == null ? '—' : number(data.averageHit, lang, 1), body: <div className="damage-structure-base"><div className="damage-structure-origin"><div className="damage-structure-origin-heading"><strong>{data.baseRole === 'weapon' ? l('Attack: weapon base', '攻击：武器基底', '攻擊：武器基底', '공격: 무기 기반') : data.baseRole === 'skillLevel' ? l('Spell: skill level base', '法术：技能等级基底', '法術：技能等級基底', '주문: 스킬 레벨 기반') : l('Starting base', '起始基底', '起始基底', '시작 기반')}</strong><small>{data.baseRole === 'weapon' ? l('The weapon supplies the starting range.', '武器提供起始伤害区间。', '武器提供起始傷害區間。', '무기가 시작 피해 범위를 제공합니다.') : data.baseRole === 'skillLevel' ? l('The active gem level supplies the starting range.', '当前技能等级提供起始伤害区间。', '目前技能等級提供起始傷害區間。', '현재 스킬 레벨이 시작 피해 범위를 제공합니다.') : l('The calculation provides the starting range for this skill.', '当前计算提供该技能的起始伤害区间。', '目前計算提供該技能的起始傷害區間。', '현재 계산이 이 스킬의 시작 피해 범위를 제공합니다.')}</small></div><DamageRangeRows ranges={data.baseRanges} language={lang} showSource empty={l('No base range exposed', '没有可读取的基底区间', '沒有可讀取的基底區間', '기본 범위가 노출되지 않음')} /></div><div className="damage-structure-added"><div className="damage-structure-kicker">{l('Added damage from current build', '当前构筑附加点伤', '目前構築附加點傷', '현재 구성의 추가 피해')}</div><DamageRangeRows ranges={data.addedRanges} language={lang} showSource empty={l('No separate added damage exposed', '没有单独暴露的附加点伤', '沒有單獨暴露的附加點傷', '별도 추가 피해가 노출되지 않음')} /></div></div> },
    { id: 'flow', icon: GitBranch, title: l('Conversion and Gain', '转换与 Gain', '轉換與 Gain', '변환 및 Gain'), subtitle: l('Damage can change type or gain an extra branch', '伤害类型可以转换或额外获得分支', '傷害類型可以轉換或額外獲得分支', '피해 유형을 변환하거나 추가 분기를 얻음'), summary: l(`Extra ${data.gains.length + data.conversions.length}`, `额外 ${data.gains.length + data.conversions.length} 条`, `額外 ${data.gains.length + data.conversions.length} 條`, `추가 ${data.gains.length + data.conversions.length}개`), body: <div className="damage-structure-flow-columns"><div><span className="damage-structure-kicker">{l('Gain as extra', '额外获得', '額外獲得', '추가 획득')}</span><FlowRows flows={data.gains} language={lang} treeData={treeData} skillCatalog={skillCatalog} /></div><div><span className="damage-structure-kicker">{l('Conversion', '转换', '轉換', '변환')}</span><FlowRows flows={data.conversions} language={lang} treeData={treeData} skillCatalog={skillCatalog} /></div></div> },
    { id: 'increased', icon: Sparkles, title: l('Increased / Reduced', '同类提高', '同類提高', '증가 / 감소'), subtitle: l('Matching modifiers are combined into one modifier', '同类修正按来源汇总为统一修正', '同類修正按來源彙總為統一修正', '같은 유형의 보정을 하나의 수정값으로 합산'), summary: data.increased.factor == null ? '—' : `×${data.increased.factor.toFixed(2)}`, body: data.increased.factor == null ? <span className="damage-structure-muted">{l('No detail is available for this layer in the current calculation.', '当前计算没有这一层的明细。', '目前計算沒有這一層的明細。', '현재 계산에는 이 레이어의 상세 정보가 없습니다.')}</span> : <div className="damage-structure-multiplier"><div className="damage-structure-factor"><span>{l('Combined factor', '合计倍率', '合計倍率', '합산 배율')}</span><strong>×{data.increased.factor.toFixed(2)}</strong><small>{number(data.increased.total, lang, 1)}%</small></div><SourceShareDetail label={l('Increased source share', '同类提高来源占比', '同類提高來源占比', '증가 출처 비율')} values={data.increased.sources} language={lang} unit="%" barsCaption={l('Modifier value', '修正值', '修正值', '보정값')} /><ModifierSourceRows modifiers={data.increased.details} language={lang} treeData={treeData} skillCatalog={skillCatalog} /></div> },
    { id: 'more', icon: Zap, title: l('More / Less', '独立增幅', '獨立增幅', 'More / Less'), subtitle: l('Each multiplier applies independently', '每个独立倍率分别相乘', '每個獨立倍率分別相乘', '각 배율은 독립적으로 곱해짐'), summary: data.more.factor == null ? '—' : `×${data.more.factor.toFixed(2)}`, body: data.more.factor == null ? <span className="damage-structure-muted">{l('No detail is available for this layer in the current calculation.', '当前计算没有这一层的明细。', '目前計算沒有這一層的明細。', '현재 계산에는 이 레이어의 상세 정보가 없습니다.')}</span> : <div className="damage-structure-multiplier"><div className="damage-structure-factor"><span>{l('Product of active multipliers', '当前独立倍率乘积', '目前獨立倍率乘積', '활성 배율 곱')}</span><strong>×{data.more.factor.toFixed(2)}</strong></div><SourceShareDetail label={l('More source share', '独立增幅来源占比', '獨立增幅來源占比', 'more 출처 비율')} values={data.more.sources} language={lang} unit="%" barsCaption={l('Modifier value', '修正值', '修正值', '보정값')} /><div className="damage-structure-chain">{data.more.nodes.length ? data.more.nodes.map((node, index) => <span key={`${node.type}-${node.value}-${index}`}><i style={{ borderColor: SOURCE_COLORS[node.type] }}><b>×{node.factor.toFixed(2)}</b><small>{sourceLabel(node.type, lang)}</small></i>{index < data.more.nodes.length - 1 && <ArrowRight />}</span>) : <i style={{ borderColor: '#917344' }}><b>×{data.more.factor.toFixed(2)}</b><small>{l('Combined result', '合并结果', '合併結果', '합산 결과')}</small></i>}</div><ModifierSourceRows modifiers={data.more.details} language={lang} treeData={treeData} skillCatalog={skillCatalog} /></div> },
    { id: 'crit', icon: Target, title: l('Critical and special hits', '暴击与特殊命中', '暴擊與特殊命中', '치명타 및 특수 적중'), subtitle: l('Normal and critical hits form expected damage', '普通命中与暴击合成期望伤害', '普通命中與暴擊合成期望傷害', '일반 및 치명타 적중의 기대 피해'), summary: data.critChance == null ? '—' : percent(data.critChance, lang), body: (() => {
      const critChanceSources = contributionSources(data.critModifiers.filter((entry) => entry.stat === 'CritChance'))
      const critMultiplierSources = contributionSources(data.critModifiers.filter((entry) => entry.stat === 'CritMultiplier'))
      return <div className="damage-structure-crit"><div className="damage-structure-crit-branch"><div><span>{l('Normal hit', '普通命中', '普通命中', '일반 적중')}</span><b>{data.critChance == null ? '—' : percent(100 - data.critChance, lang)}</b></div><div><span>{l('Critical hit', '暴击命中', '暴擊命中', '치명타 적중')}</span><b>{percent(data.critChance, lang)}</b></div></div><CriticalAverageFormula critChance={data.critChance} critMultiplier={data.critMultiplier} language={lang} /><div className="damage-structure-crit-result"><span>{l('Critical damage', '暴击伤害', '暴擊傷害', '치명타 피해')}</span><strong>×{data.critMultiplier == null ? '—' : data.critMultiplier.toFixed(2)}</strong></div>{(critChanceSources.length > 0 || critMultiplierSources.length > 0) && <div className="damage-structure-crit-source-share-grid"><SourceShareDetail label={l('Critical chance source share', '暴击率来源占比', '暴擊率來源占比', '치명타 확률 출처 비율')} values={critChanceSources} language={lang} unit="%" barsCaption={l('Critical chance modifier', '暴击率修正', '暴擊率修正', '치명타 확률 보정')} /><SourceShareDetail label={l('Critical damage source share', '暴击伤害来源占比', '暴擊傷害來源占比', '치명타 피해 출처 비율')} values={critMultiplierSources} language={lang} unit="%" barsCaption={l('Critical damage modifier', '暴击伤害修正', '暴擊傷害修正', '치명타 피해 보정')} /></div>}<CriticalSourceRows modifiers={data.critModifiers} language={lang} treeData={treeData} skillCatalog={skillCatalog} /></div>
    })() },
    { id: 'defence', icon: Shield, title: l('Enemy defence', '敌人有效防御', '敵人有效防禦', '적 방어'), subtitle: l('Resistance and mitigation are applied in the calculation', '抗性与减伤会在计算中应用', '抗性與減傷會在計算中套用', '저항과 완화는 계산에 적용됨'), summary: data.effectiveMultipliers.length ? `×${data.effectiveMultipliers[0].value.toFixed(2)}` : '—', body: <div className="damage-structure-defence"><p>{l('The final damage filter follows the active calculation settings. The rows below show the effective type multipliers for this skill.', '最终伤害过滤遵循当前计算设置；下方展示当前技能的类型有效倍率。', '最終傷害過濾遵循目前計算設定；下方展示目前技能的類型有效倍率。', '최종 피해 필터는 현재 계산 설정을 따릅니다. 아래에는 이 스킬의 유형별 유효 배율이 표시됩니다.')}</p>{data.effectiveMultipliers.length ? data.effectiveMultipliers.map((entry) => <div key={entry.type}><span>{damageTypeLabel(entry.type, lang)}</span><i><b style={{ width: `${Math.max(3, Math.min(100, entry.value * 100))}%` }} /></i><strong>×{entry.value.toFixed(2)}</strong></div>) : data.effectiveBreakdown.length ? <ol className="damage-structure-breakdown">{data.effectiveBreakdown.map((line) => <li key={line}>{translateGameText(line, lang)}</li>)}</ol> : <span className="damage-structure-muted">{l('No separate enemy multiplier is available; final DPS still includes the current enemy settings.', '当前没有单独的敌人倍率明细；最终 DPS 仍已包含当前敌人配置。', '目前沒有單獨的敵人倍率明細；最終 DPS 仍已包含目前敵人設定。', '별도 적 배율 상세 정보는 없지만 최종 DPS에는 현재 적 설정이 포함됩니다.')}</span>}</div> },
    { id: 'rate', icon: Gauge, title: l('Hit and output rate', '命中与输出频率', '命中與輸出頻率', '적중 및 출력 빈도'), subtitle: l('Frequency turns hit damage into DPS', '频率将单次伤害转为 DPS', '頻率將單次傷害轉為 DPS', '빈도가 적중 피해를 DPS로 변환'), summary: data.speed == null ? '—' : `${number(data.speed, lang, 2)}/s`, body: <div className="damage-structure-rate"><Meter value={data.speed} max={5} label={l('Attack / cast rate', '攻击 / 施法频率', '攻擊 / 施法頻率', '공격 / 시전 빈도')} display={data.speed == null ? '—' : `${number(data.speed, lang, 2)}/s`} /><Meter value={data.totalDps} max={Math.max(1, data.totalDps || 1)} label={l('Final DPS', '最终 DPS', '最終 DPS', '최종 DPS')} display={number(data.totalDps, lang, 0)} />{data.formula.length > 0 && <details><summary>{l('Calculation formula detail', '计算公式明细', '計算公式明細', '계산 공식 상세')}</summary><ol>{data.formula.slice(0, 8).map((line, index) => <li key={`${line}-${index}`}>{translateGameText(line, lang)}</li>)}</ol></details>}</div> },
  ] : []

  if (data) {
    const baseLayer = layers.find((layer) => layer.id === 'base')
    if (baseLayer) {
      baseLayer.summary = data.baseTotalAverage == null ? '—' : number(data.baseTotalAverage, lang, 1)
      baseLayer.body = <DamageBaseLayer data={data} language={lang} treeData={treeData} skillCatalog={skillCatalog} />
    }
    const defenceIndex = layers.findIndex((layer) => layer.id === 'defence')
    if (defenceIndex >= 0) {
      layers.splice(defenceIndex + 1, 0, {
        id: 'averageHit',
        icon: Crosshair,
        title: l('Expected average hit', '增伤后平均击中', '增傷後平均擊中', '증폭 후 평균 적중'),
        subtitle: l('The expected damage of one hit after critical calculation and mitigation', '完成暴击期望与敌人减伤后的单次伤害', '完成暴擊期望與敵人減傷後的單次傷害', '치명타 기대값과 적 완화 후 한 번의 적중 피해'),
        summary: data.averageHit == null ? '—' : number(data.averageHit, lang, 1),
        body: <AverageHitLayer data={data} language={lang} />,
      })
    }
    const rateLayer = layers.find((layer) => layer.id === 'rate')
    if (rateLayer) rateLayer.body = <RateLayer data={data} language={lang} treeData={treeData} skillCatalog={skillCatalog} />
  }

  const stageTitles: Record<string, string> = {
    base: l('Damage base (flat damage)', '伤害基底(点伤)', '傷害基底(點傷)', '피해 기반(플랫 피해)'),
    flow: l('Conversion and extra (Gain)', '转换与额外 (Gain)', '轉換與額外 (Gain)', '변환 및 추가 (Gain)'),
    increased: l('Increased (increase)', '同类提高 (increase)', '同類提高 (increase)', '증가 (increase)'),
    more: l('Independent multiplier (More)', '独立增幅 (More)', '獨立增幅 (More)', '독립 배율 (More)'),
    crit: l('Critical / critical damage (expected damage)', '暴击/暴伤 (期望伤害)', '暴擊/暴傷 (期望傷害)', '치명타/치명타 피해 (기대 피해)'),
    averageHit: l('Average hit damage', '平均命中伤害', '平均命中傷害', '평균 적중 피해'),
    rate: l('Output rate (attacks and casts)', '输出频率(攻击与施法)', '輸出頻率(攻擊與施法)', '출력 빈도(공격 및 시전)'),
  }
  const displayedLayers = layers.map((layer) => ({ ...layer, title: stageTitles[layer.id] || layer.title }))
  const formulaLayers = displayedLayers.filter((layer) => layer.id !== 'defence')
  if (!data) return <section id="damage-structure" className="damage-structure-report damage-structure-empty"><CircleHelp /><div><h2>{l('Damage structure report', '伤害结构报告', '傷害結構報告', '피해 구조 보고서')}</h2><p>{l('Open a calculated skill to inspect its damage layers.', '打开已完成计算的技能后即可查看伤害结构。', '開啟已完成計算的技能後即可查看傷害結構。', '계산된 스킬을 열면 피해 구조를 확인할 수 있습니다.')}</p></div></section>

  const detailLayer = detailLayerId === 'finalDps'
    ? { id: 'finalDps', title: l('Final DPS and damage types', '最终 DPS 与伤害类型', '最終 DPS 與傷害類型', '최종 DPS 및 피해 유형'), subtitle: '', summary: number(data.totalDps, lang, 0), body: <FinalDpsDetail data={data} language={lang} /> }
    : detailLayerId ? displayedLayers.find((layer) => layer.id === detailLayerId) : null

  return <section id="damage-structure" className="damage-structure-report">
    <FinalDamageBreakdown data={data} language={lang} skillLevel={skillLevel} formulaLayers={formulaLayers} onOpenLayer={setDetailLayerId} />
    {hints.length > 0 && <div className="damage-structure-hints"><span>{l('Current structure hints', '当前结构提示', '目前結構提示', '현재 구조 힌트')}</span>{hints.map((hint) => <p key={hint}>{hint}</p>)}</div>}
    <div className="damage-structure-grid">{displayedLayers.map(({ id, icon: Icon, title, subtitle, summary }) => <article id={`damage-layer-${id}`} key={id} className="damage-structure-layer"><div className="damage-structure-layer-heading"><span className="damage-structure-layer-icon"><Icon /></span><span role="button" tabIndex={0} onClick={() => setDetailLayerId(id)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setDetailLayerId(id) } }} aria-label={l(`View ${title} details`, `查看${title}明细`, `查看${title}明細`, `查看${title} 상세`)} title={l('Click to view details', '点击查看明细', '點擊查看明細', '상세 보기')}><strong>{title}</strong><small>{subtitle}</small></span><div className="damage-structure-layer-heading-actions"><b>{summary}</b></div></div><div className="damage-structure-layer-body"><LayerSummary id={id} data={data} language={lang} /></div></article>)}</div>
    {detailLayer && <div className="damage-structure-detail-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setDetailLayerId(null) }}><section className="damage-structure-detail-modal" role="dialog" aria-modal="true" aria-labelledby="damage-structure-detail-title"><header><div><span>{l('Damage area details', '伤害区域明细', '傷害區域明細', '피해 영역 상세')}</span><h3 id="damage-structure-detail-title">{detailLayer.title}</h3></div><button type="button" className="damage-structure-detail-close" onClick={() => setDetailLayerId(null)} aria-label={l('Close details', '关闭明细', '關閉明細', '상세 닫기')} title={l('Close details', '关闭明细', '關閉明細', '상세 닫기')}><X /></button></header><div className="damage-structure-detail-content">{detailLayer.body}</div></section></div>}
    <footer className="damage-structure-footer"><span><i style={{ background: SOURCE_COLORS.equipment }} />{sourceLabel('equipment', lang)}</span><span><i style={{ background: SOURCE_COLORS.tree }} />{sourceLabel('tree', lang)}</span><span><i style={{ background: SOURCE_COLORS.jewel }} />{sourceLabel('jewel', lang)}</span><span><i style={{ background: SOURCE_COLORS.skill }} />{sourceLabel('skill', lang)}</span><span><i style={{ background: SOURCE_COLORS.buff }} />{sourceLabel('buff', lang)}</span><span><i style={{ background: SOURCE_COLORS.config }} />{sourceLabel('config', lang)}</span><small>{l('Each area uses its own unit. They are not added into one percentage.', '每个区域使用自己的单位，不会强行相加成一个百分比。', '每個區域使用自己的單位，不會強行相加成一個百分比。', '각 영역은 고유 단위를 사용하며 하나의 백분율로 합산하지 않습니다.')}</small></footer>
  </section>
}

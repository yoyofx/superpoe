import { Check, Clipboard, Download, LocateFixed, LoaderCircle, Maximize2, Minus, Plus, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type WheelEvent } from 'react'
import { Application, Container, Graphics, Text } from 'pixi.js'
import { useTranslation } from '@/i18n/useTranslation'
import { formatUiNumber, uiText } from '@/i18n/uiLocale'
import type { DamageStructureReportData } from '@/components/DamageStructureReport'
import type { SkillDamageStageValues } from '@/types/calc'

type Language = Parameters<typeof uiText>[0]
type DamageType = 'physical' | 'lightning' | 'cold' | 'fire' | 'chaos'
type GraphStage = 'base' | 'conversion' | 'gain' | 'increased' | 'more' | 'crit' | 'defence' | 'averageHit' | 'rate' | 'final'

interface GraphNodeModel {
  id: string
  stage: GraphStage
  x: number
  y: number
  width: number
  height: number
  title: string
  value: string
  detail: string
  meta?: string
  metaEmphasis?: boolean
  kind: 'damage' | 'flow' | 'result' | 'shared'
  damageType?: DamageType
  color: string
}

interface GraphEdgeModel {
  id: string
  from: string
  to: string
  label?: string
  labelPlacement?: 'line' | 'target'
  color: string
  dashed?: boolean
}

interface GraphModel {
  width: number
  height: number
  title: string
  stageHeaders: Array<{ x: number; width: number; title: string; value: string; detail: string; color: string }>
  lanes: Array<{ y: number; height: number; label: string; color: string }>
  nodes: GraphNodeModel[]
  edges: GraphEdgeModel[]
}

interface Props {
  data: DamageStructureReportData
  skillLevel?: number
  onClose: () => void
}

const DAMAGE_TYPES: DamageType[] = ['physical', 'fire', 'cold', 'lightning', 'chaos']
const TYPE_COLORS: Record<DamageType, string> = {
  physical: '#c2b18d',
  fire: '#df705c',
  cold: '#dcecff',
  lightning: '#83c8ff',
  chaos: '#b58bd7',
}
const STAGE_COLORS: Record<GraphStage, string> = {
  base: '#b8904d',
  conversion: '#6f9fc0',
  gain: '#c38a66',
  increased: '#d0a85c',
  more: '#d36f63',
  crit: '#aa83c5',
  defence: '#70818c',
  averageHit: '#c3a868',
  rate: '#7eb69c',
  final: '#e05f59',
}
const GRAPH_TITLE_TOP = 14
const GRAPH_TITLE_HEIGHT = 42
const GRAPH_HEADER_TOP = GRAPH_TITLE_TOP + GRAPH_TITLE_HEIGHT + 14
const GRAPH_HEADER_HEIGHT = 156
const GRAPH_HEADER_GAP = 22
const GRAPH_SUMMARY_HEIGHT = 96

function l(language: Language, en: string, zhCN: string, zhTW = zhCN, koKR = en): string {
  return uiText(language, en, zhCN, zhTW, koKR)
}

function formatNumber(value: number | null | undefined, language: Language, digits = 1): string {
  if (value == null || !Number.isFinite(value)) return '—'
  return formatUiNumber(value, language, { maximumFractionDigits: digits })
}

function formatPercent(value: number | null | undefined, language: Language, digits = 1): string {
  return value == null || !Number.isFinite(value) ? '—' : `${formatNumber(value, language, digits)}%`
}

function formatSignedNumber(value: number | null | undefined, language: Language): string {
  if (value == null || !Number.isFinite(value)) return '—'
  return `${value >= 0 ? '+' : ''}${formatNumber(value, language, 0)}`
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Failed to read image'))
    reader.onerror = () => reject(reader.error || new Error('Failed to read image'))
    reader.readAsDataURL(blob)
  })
}

function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  anchor.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}

function canvasToPngBlob(source: HTMLCanvasElement): Promise<Blob> {
  const output = document.createElement('canvas')
  output.width = source.width
  output.height = source.height
  const context = output.getContext('2d')
  if (!context) return Promise.reject(new Error('Canvas export is unavailable'))
  context.fillStyle = '#080808'
  context.fillRect(0, 0, output.width, output.height)
  context.drawImage(source, 0, 0)
  return new Promise((resolve, reject) => {
    output.toBlob((blob) => blob ? resolve(blob) : reject(new Error('Failed to encode graph image')), 'image/png')
  })
}

function extractGraphCanvas(app: Application, world: Container): HTMLCanvasElement {
  const originalPosition = { x: world.position.x, y: world.position.y }
  const originalScale = { x: world.scale.x, y: world.scale.y }
  world.position.set(0, 0)
  world.scale.set(1)
  try {
    return app.renderer.extract.canvas({
      target: world,
      clearColor: '#080808',
      antialias: true,
      resolution: typeof window === 'undefined' ? 1 : Math.max(1, Math.min(2, window.devicePixelRatio || 1)),
    }) as HTMLCanvasElement
  } finally {
    world.position.set(originalPosition.x, originalPosition.y)
    world.scale.set(originalScale.x, originalScale.y)
  }
}

function damageTypeLabel(type: string, language: Language): string {
  const labels: Record<string, [string, string, string, string]> = {
    physical: ['Physical', '物理', '物理', '물리'],
    lightning: ['Lightning', '闪电', '閃電', '번개'],
    cold: ['Cold', '冰霜', '冰霜', '냉기'],
    fire: ['Fire', '火焰', '火焰', '화염'],
    chaos: ['Chaos', '混沌', '混沌', '카오스'],
  }
  const [en, zhCN, zhTW, koKR] = labels[type] || [type, type, type, type]
  return l(language, en, zhCN, zhTW, koKR)
}

function isDamageType(value: string): value is DamageType {
  return DAMAGE_TYPES.includes(value as DamageType)
}

function shortText(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, Math.max(1, maxLength - 1))}…` : value
}

function rangeAverage(min: number | null | undefined, max: number | null | undefined): number | null {
  return Number.isFinite(min) && Number.isFinite(max) ? ((min as number) + (max as number)) / 2 : null
}

function averageText(min: number | null | undefined, max: number | null | undefined, language: Language): string {
  const average = rangeAverage(min, max)
  if (average == null) return l(language, 'Value unavailable', '数值不可用')
  return formatNumber(average, language, 0)
}

function averageValueText(min: number | null | undefined, max: number | null | undefined, fallback: number | null | undefined, language: Language): string {
  const average = rangeAverage(min, max)
  return formatNumber(average ?? fallback, language, 0)
}

function sumStageValues(first: number | null | undefined, second: number | null | undefined): number | null {
  if (!Number.isFinite(first) && !Number.isFinite(second)) return null
  return (Number.isFinite(first) ? first as number : 0) + (Number.isFinite(second) ? second as number : 0)
}

function stageConversionPool(stage: SkillDamageStageValues | undefined, bound: 'min' | 'max'): number | null {
  return stage ? sumStageValues(stage[`retained${bound === 'min' ? 'Min' : 'Max'}`], stage[`conversion${bound === 'min' ? 'Min' : 'Max'}`]) : null
}

function hasPositiveRange(min: number | null | undefined, max: number | null | undefined): boolean {
  return [min, max].some((value) => Number.isFinite(value) && Math.abs(value as number) > 0.0001)
}

function averageOfStageRange(stage: NonNullable<SkillDamageStageValues | undefined> | undefined, min: keyof SkillDamageStageValues, max: keyof SkillDamageStageValues): number | null {
  if (!stage) return null
  return rangeAverage(stage[min] as number | undefined, stage[max] as number | undefined)
}

function stageFactor(
  stage: SkillDamageStageValues | undefined,
  factor: keyof SkillDamageStageValues,
  beforeMin: keyof SkillDamageStageValues,
  beforeMax: keyof SkillDamageStageValues,
  afterMin: keyof SkillDamageStageValues,
  afterMax: keyof SkillDamageStageValues,
): number | null {
  const explicit = stage?.[factor]
  if (Number.isFinite(explicit)) return explicit as number
  const before = averageOfStageRange(stage, beforeMin, beforeMax)
  const after = averageOfStageRange(stage, afterMin, afterMax)
  return before != null && before !== 0 && after != null ? after / before : null
}

function stageFactorForTotals(before: number | null, after: number | null): number | null {
  return before != null && before !== 0 && after != null ? after / before : null
}

function transferRows(data: DamageStructureReportData, kind: 'gain' | 'conversion'): Array<{ from: string; to: string; value: number }> {
  const rows = kind === 'gain' ? data.gains : data.conversions
  if (rows.length) return rows.map((entry) => ({ from: entry.from, to: entry.to, value: entry.value }))
  const totals = kind === 'gain' ? data.gainTotals : data.conversionTotals
  return totals.map((entry) => ({ from: entry.fromType, to: entry.toType, value: entry.value }))
}

function hasStageDamage(stage: NonNullable<DamageStructureReportData['stageDamageTypes'][number]['stages']>): boolean {
  return [stage.baseMin, stage.baseMax, stage.summedMin, stage.summedMax, stage.moreStageMin, stage.moreStageMax, stage.expectedAverage, stage.effectiveAverage]
    .some((value) => Number.isFinite(value) && Math.abs(value as number) > 0)
}

function rangeDisplay(min: number | null | undefined, max: number | null | undefined, language: Language): string {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return '—'
  const minValue = min as number
  const maxValue = max as number
  if (Math.abs(maxValue - minValue) < 0.0001) return formatNumber(minValue, language, 0)
  return `[${formatNumber(minValue, language, 0)} - ${formatNumber(maxValue, language, 0)}]`
}

function rangeSummary(min: number | null | undefined, max: number | null | undefined, language: Language): string {
  const average = rangeAverage(min, max)
  if (average == null) return '—'
  const display = rangeDisplay(min, max, language)
  return Math.abs((max as number) - (min as number)) < 0.0001
    ? display
    : `${display} ${l(language, 'average', '平均')} ${formatNumber(average, language, 0)}`
}

function expectedCritRange(stage: SkillDamageStageValues | undefined, critChance: number | null | undefined): { min: number; max: number } | null {
  if (!stage || !Number.isFinite(critChance) || !Number.isFinite(stage.normalMin) || !Number.isFinite(stage.normalMax) || !Number.isFinite(stage.criticalMin) || !Number.isFinite(stage.criticalMax)) return null
  const chance = (critChance as number) / 100
  return {
    min: (stage.normalMin as number) * (1 - chance) + (stage.criticalMin as number) * chance,
    max: (stage.normalMax as number) * (1 - chance) + (stage.criticalMax as number) * chance,
  }
}

function baseFormulaText(stage: SkillDamageStageValues | undefined, skillType: DamageStructureReportData['skillType'], language: Language): string | null {
  if (!stage || !Number.isFinite(stage.baseMin) || !Number.isFinite(stage.baseMax) || !Number.isFinite(stage.baseMultiplier)) return null
  const sourceMin = stage.baseSourceMin
  const sourceMax = stage.baseSourceMax
  const addedMin = stage.flatAddedMin
  const addedMax = stage.flatAddedMax
  const hasSource = hasPositiveRange(sourceMin, sourceMax)
  const hasAdded = hasPositiveRange(addedMin, addedMax)
  if (!hasSource && !hasAdded) return null
  const sourceLabel = skillType === 'attack'
    ? l(language, 'Weapon', '武器')
    : skillType === 'spell'
      ? l(language, 'Skill level', '技能等级')
      : l(language, 'Skill base', '技能基底')
  const terms: string[] = []
  if (hasSource) terms.push(`${sourceLabel} ${rangeDisplay(sourceMin, sourceMax, language)}`)
  if (hasAdded) {
    const addedMultiplier = Number.isFinite(stage.flatAddedMultiplier) ? stage.flatAddedMultiplier as number : 1
    const addedText = `${l(language, 'flat added', '平坦额外')} ${rangeDisplay(addedMin, addedMax, language)}`
    terms.push(addedMultiplier !== 1 ? `${addedText} ×${formatNumber(addedMultiplier, language, 2)}` : addedText)
  }
  const input = terms.length > 1 ? `(${terms.join(' + ')})` : terms[0]
  return `${input} ×${formatNumber(stage.baseMultiplier, language, 2)}\n= ${rangeDisplay(stage.baseMin, stage.baseMax, language)}`
}

function buildGraph(data: DamageStructureReportData, language: Language, skillLevel?: number): GraphModel {
  const nodeWidth = 168
  const nodeHeight = 108
  const flowWidth = 198
  const stageGap = 16
  const leftRail = 96
  const stageWidths: Array<{ stage: GraphStage; width: number; label: string }> = [
    { stage: 'base', width: nodeWidth, label: l(language, 'Damage base', '伤害基底') },
    { stage: 'conversion', width: flowWidth, label: l(language, 'Conversion', '转换') },
    { stage: 'gain', width: flowWidth, label: l(language, 'Gain as extra', '额外 (Gain)') },
    { stage: 'increased', width: nodeWidth, label: l(language, 'Increased by type', '按类型同类提高') },
    { stage: 'more', width: nodeWidth, label: l(language, 'More by type', '按类型独立增幅') },
    { stage: 'crit', width: nodeWidth, label: l(language, 'Critical expectation', '暴击期望') },
    { stage: 'defence', width: nodeWidth, label: l(language, 'Enemy defence', '敌人防御') },
    { stage: 'averageHit', width: nodeWidth, label: l(language, 'Average hit', '平均命中') },
    { stage: 'rate', width: nodeWidth, label: l(language, 'Output rate', '输出频率') },
    { stage: 'final', width: nodeWidth, label: l(language, 'Final DPS', '最终 DPS') },
  ]
  const stageX = new Map<GraphStage, number>()
  let cursor = leftRail
  for (const entry of stageWidths) {
    stageX.set(entry.stage, cursor)
    cursor += entry.width + stageGap
  }

  const laneHeight = 142
  const laneGap = Math.max(158, Math.min(236, laneHeight + 20))
  const laneTop = GRAPH_HEADER_TOP + GRAPH_HEADER_HEIGHT + GRAPH_HEADER_GAP
  const laneY = new Map<DamageType, number>(DAMAGE_TYPES.map((type, index) => [type, laneTop + index * laneGap]))
  const activeTypes = new Set<DamageType>()
  if (data.calculationScope === 'selectedSkill') {
    for (const range of data.combinedBaseRanges) if (isDamageType(range.type) && range.average !== 0) activeTypes.add(range.type)
  }
  for (const entry of data.finalDamageTypes) if (isDamageType(entry.type) && entry.finalDps > 0) activeTypes.add(entry.type)
  for (const entry of data.stageDamageTypes) if (isDamageType(entry.type) && entry.stages && hasStageDamage(entry.stages)) activeTypes.add(entry.type)

  const nodes: GraphNodeModel[] = []
  const edges: GraphEdgeModel[] = []
  const visibleNodes = new Set<string>()
  const addNode = (node: GraphNodeModel) => {
    nodes.push(node)
    visibleNodes.add(node.id)
  }
  const nodeId = (stage: GraphStage, type: DamageType) => `${stage}-${type}`
  // A selected-skill report already has the same stage rows in damageTypes.
  // Keep that direct payload as a fallback so a stale/partial aggregate cannot
  // turn a valid PoB result into an all-unavailable graph.
  const stageEntries = data.stageDamageTypes.length || data.calculationScope !== 'selectedSkill'
    ? data.stageDamageTypes
    : data.damageTypes
  const damageDetails = new Map(stageEntries.filter((entry) => isDamageType(entry.type)).map((entry) => [entry.type, entry]))
  const stageByType = new Map(DAMAGE_TYPES.map((type) => [type, damageDetails.get(type)?.stages]))
  const gainRows = transferRows(data, 'gain')
  const gainTargetTypes = new Set(gainRows.filter((row) => isDamageType(row.to) && Number.isFinite(row.value) && row.value !== 0).map((row) => row.to as DamageType))
  const stageTotal = (read: (stage: NonNullable<ReturnType<typeof stageByType.get>>) => number | null | undefined): number | null => {
    let total = 0
    let hasValue = false
    for (const stage of stageByType.values()) {
      const value = stage ? read(stage) : null
      if (Number.isFinite(value)) {
        total += value as number
        hasValue = true
      }
    }
    return hasValue ? total : null
  }
  const averageStage = (stage: NonNullable<ReturnType<typeof stageByType.get>> | undefined, min: keyof NonNullable<ReturnType<typeof stageByType.get>>, max: keyof NonNullable<ReturnType<typeof stageByType.get>>) => stage ? rangeAverage(stage[min] as number | undefined, stage[max] as number | undefined) : null

  for (const type of DAMAGE_TYPES) {
    if (!activeTypes.has(type)) continue
    const stage = stageByType.get(type)
    const increasedFactor = stageFactor(stage, 'increasedFactor', 'summedMin', 'summedMax', 'increasedMin', 'increasedMax')
    const moreFactor = stageFactor(stage, 'moreFactor', 'increasedMin', 'increasedMax', 'moreStageMin', 'moreStageMax')
    const conversionMin = stageConversionPool(stage, 'min')
    const conversionMax = stageConversionPool(stage, 'max')
    const hasOriginalBase = hasPositiveRange(stage?.baseMin, stage?.baseMax)
    const hasConversion = hasPositiveRange(stage?.conversionMin, stage?.conversionMax)
    const hasGain = hasPositiveRange(stage?.gainMin, stage?.gainMax)
      && (gainTargetTypes.size === 0 || gainTargetTypes.has(type))
    const critRange = expectedCritRange(stage, data.critChance)
    const moreAverage = averageOfStageRange(stage, 'moreStageMin', 'moreStageMax')
    const increasedAverage = averageOfStageRange(stage, 'increasedMin', 'increasedMax')
    const moreAverageFactor = stageFactorForTotals(increasedAverage, moreAverage)
    const gainBeforeAverage = rangeAverage(conversionMin, conversionMax)
    const gainAfterAverage = averageOfStageRange(stage, 'summedMin', 'summedMax')
    // Gain is an independent branch calculated by PoB. Do not infer it by
    // subtracting two displayed pools: that hides rounding and can mix scales.
    const gainContributionAverage = averageOfStageRange(stage, 'gainMin', 'gainMax')
    const baseFormula = data.calculationScope === 'selectedSkill' ? baseFormulaText(stage, data.skillType, language) : null
    addNode({
      id: nodeId('base', type),
      stage: 'base',
      x: stageX.get('base')!,
      y: laneY.get(type)! - nodeHeight / 2,
      width: nodeWidth,
      height: nodeHeight,
      title: `${damageTypeLabel(type, language)} ${l(language, 'base', '基底')}`,
      value: hasOriginalBase ? rangeSummary(stage?.baseMin, stage?.baseMax, language) : '—',
      detail: stage
        ? hasOriginalBase
          ? baseFormula || `${l(language, 'Average value', '平均值')}: ${averageText(stage.baseMin, stage.baseMax, language)}`
          : l(language, 'No original base; supplied by conversion or Gain', '没有原始基底；由转换或 Gain 提供')
        : l(language, 'PoB stage data unavailable', 'PoB 阶段数据不可用'),
      meta: stage
        ? hasOriginalBase
          ? baseFormula && Number.isFinite(stage.baseMultiplier)
            ? `${l(language, 'Skill base multiplier', '技能基础倍率')} ×${formatNumber(stage.baseMultiplier, language, 2)}`
            : l(language, 'Original base damage', '原始基底点伤')
          : l(language, 'No original base damage', '无原始基底点伤')
        : undefined,
      kind: 'damage',
      damageType: type,
      color: TYPE_COLORS[type],
    })
    if (hasConversion) addNode({
        id: nodeId('conversion', type),
        stage: 'conversion',
        x: stageX.get('conversion')!,
        y: laneY.get(type)! - nodeHeight / 2,
        width: flowWidth,
        height: nodeHeight,
        title: `${damageTypeLabel(type, language)} ${l(language, 'conversion', '转换')}`,
        value: averageValueText(conversionMin, conversionMax, null, language),
        detail: stage ? `${l(language, 'Retained', '保留')} ${averageText(stage.retainedMin, stage.retainedMax, language)} + ${l(language, 'converted in', '转入')} ${averageText(stage.conversionMin, stage.conversionMax, language)} = ${averageText(conversionMin, conversionMax, language)}` : l(language, 'PoB stage data unavailable', 'PoB 阶段数据不可用'),
        meta: stage ? l(language, 'Before Gain', 'Gain 前') : undefined,
        kind: 'flow',
        damageType: type,
        color: STAGE_COLORS.conversion,
      })
    if (hasGain) addNode({
        id: nodeId('gain', type),
        stage: 'gain',
        x: stageX.get('gain')!,
        y: laneY.get(type)! - nodeHeight / 2,
        width: flowWidth,
        height: nodeHeight,
        title: `${damageTypeLabel(type, language)} ${l(language, 'Gain as extra', '额外 (Gain)')}`,
        value: averageValueText(stage?.summedMin, stage?.summedMax, null, language),
        detail: stage && gainBeforeAverage != null && gainAfterAverage != null
          ? `${l(language, 'After conversion', '转换后')} ${formatNumber(gainBeforeAverage, language, 0)} + ${l(language, 'Extra contribution', '额外贡献')} ${formatSignedNumber(gainContributionAverage, language)} = ${formatNumber(gainAfterAverage, language, 0)}`
          : stage ? `${l(language, 'After conversion', '转换后')} ${averageText(conversionMin, conversionMax, language)} + ${l(language, 'Extra contribution', '额外贡献')} ${formatSignedNumber(gainContributionAverage, language)} = ${averageText(stage.summedMin, stage.summedMax, language)}` : l(language, 'PoB stage data unavailable', 'PoB 阶段数据不可用'),
        meta: stage ? l(language, 'New damage pool', '新增伤害池') : undefined,
        kind: 'flow',
        damageType: type,
        color: STAGE_COLORS.gain,
      })
    addNode({
      id: nodeId('increased', type),
      stage: 'increased',
      x: stageX.get('increased')!,
      y: laneY.get(type)! - nodeHeight / 2,
      width: nodeWidth,
      height: nodeHeight,
      title: `${damageTypeLabel(type, language)} ${l(language, 'increased', '同类提高')}`,
      value: averageValueText(stage?.increasedMin, stage?.increasedMax, null, language),
      detail: stage
        ? increasedFactor != null
          ? `${averageText(stage.summedMin, stage.summedMax, language)} × ${formatNumber(increasedFactor, language, 2)} = ${averageText(stage.increasedMin, stage.increasedMax, language)}`
          : `${l(language, 'Summed per-skill stage', '各技能阶段合计')} → ${averageText(stage.increasedMin, stage.increasedMax, language)}`
        : l(language, 'PoB stage data unavailable', 'PoB 阶段数据不可用'),
      meta: increasedFactor == null ? undefined : `×${formatNumber(increasedFactor, language, 2)}`,
      metaEmphasis: increasedFactor != null,
      kind: 'damage',
      damageType: type,
      color: STAGE_COLORS.increased,
    })
    addNode({
      id: nodeId('more', type),
      stage: 'more',
      x: stageX.get('more')!,
      y: laneY.get(type)! - nodeHeight / 2,
      width: nodeWidth,
      height: nodeHeight,
      title: `${damageTypeLabel(type, language)} ${l(language, 'More', '独立增幅')}`,
      value: averageValueText(stage?.moreStageMin, stage?.moreStageMax, null, language),
      detail: stage
        ? moreFactor != null
            ? `${averageText(stage.increasedMin, stage.increasedMax, language)} × ${formatNumber(moreAverageFactor ?? moreFactor, language, 2)} = ${averageText(stage.moreStageMin, stage.moreStageMax, language)}`
            : `${l(language, 'Summed per-skill stage', '各技能阶段合计')} → ${averageText(stage.moreStageMin, stage.moreStageMax, language)}`
        : l(language, 'PoB stage data unavailable', 'PoB 阶段数据不可用'),
      meta: (moreAverageFactor ?? moreFactor) == null ? undefined : `×${formatNumber(moreAverageFactor ?? moreFactor, language, 2)}`,
      metaEmphasis: (moreAverageFactor ?? moreFactor) != null,
      kind: 'damage',
      damageType: type,
      color: STAGE_COLORS.more,
    })
    addNode({
      id: nodeId('crit', type),
      stage: 'crit',
      x: stageX.get('crit')!,
      y: laneY.get(type)! - nodeHeight / 2,
      width: nodeWidth,
      height: nodeHeight,
      title: `${damageTypeLabel(type, language)} ${l(language, 'crit expectation', '暴击期望')}`,
      value: critRange ? averageValueText(critRange.min, critRange.max, stage?.expectedAverage, language) : formatNumber(stage?.expectedAverage, language, 0),
      detail: data.calculationScope === 'selectedSkill' && stage && stage.normalAverage != null && stage.criticalAverage != null && data.critChance != null
        ? `${formatNumber(stage.normalAverage, language, 0)} × ${formatPercent(100 - data.critChance, language)} + ${formatNumber(stage.criticalAverage, language, 0)} × ${formatPercent(data.critChance, language)} = ${formatNumber(stage.expectedAverage, language, 0)}`
        : stage?.expectedAverage != null ? l(language, 'Exact per-skill critical expectation sum', '各技能暴击期望精确合计') : l(language, 'PoB critical stage data unavailable', 'PoB 暴击阶段数据不可用'),
      meta: stage ? data.calculationScope === 'selectedSkill' ? `${l(language, 'Crit chance', '暴击率')} ${formatPercent(data.critChance, language)} · ${l(language, 'Crit multiplier', '暴击倍率')} ×${formatNumber(data.critMultiplier, language, 2)}` : l(language, 'Exact per-skill expectation sum', '各技能期望伤害精确合计') : undefined,
      kind: 'damage',
      damageType: type,
      color: STAGE_COLORS.crit,
    })
    addNode({
      id: nodeId('defence', type),
      stage: 'defence',
      x: stageX.get('defence')!,
      y: laneY.get(type)! - nodeHeight / 2,
      width: nodeWidth,
      height: nodeHeight,
      title: `${damageTypeLabel(type, language)} ${l(language, 'defence', '防御')}`,
      value: stage?.effectiveMin != null && stage?.effectiveMax != null ? averageValueText(stage.effectiveMin, stage.effectiveMax, stage.effectiveAverage, language) : formatNumber(stage?.effectiveAverage, language, 0),
      detail: stage?.effectiveMultiplier != null && stage.expectedAverage != null
        ? `${formatNumber(stage.expectedAverage, language, 0)} × ${formatNumber(stage.effectiveMultiplier, language, 3)} = ${formatNumber(stage.effectiveAverage, language, 0)}`
        : stage?.effectiveAverage != null ? l(language, 'Exact per-skill post-mitigation sum', '各技能减伤后精确合计') : l(language, 'PoB defence stage data unavailable', 'PoB 防御阶段数据不可用'),
      meta: stage?.effectiveMultiplier != null ? `${l(language, 'Effective multiplier', '有效倍率')} ×${formatNumber(stage.effectiveMultiplier, language, 3)}` : undefined,
      kind: 'damage',
      damageType: type,
      color: STAGE_COLORS.defence,
    })
    addNode({
      id: nodeId('averageHit', type),
      stage: 'averageHit',
      x: stageX.get('averageHit')!,
      y: laneY.get(type)! - nodeHeight / 2,
      width: nodeWidth,
      height: nodeHeight,
      title: `${damageTypeLabel(type, language)} ${l(language, 'average hit', '平均命中')}`,
      value: formatNumber(stage?.effectiveAverage, language, 0),
      detail: stage ? `${l(language, 'Contribution to total average hit', '计入总平均命中')} · ${formatNumber(stage.effectiveAverage, language, 0)} / ${formatNumber(data.averageHit, language, 0)}` : l(language, 'PoB average hit stage data unavailable', 'PoB 平均命中阶段数据不可用'),
      meta: stage ? l(language, 'Damage type contribution', '伤害类型贡献') : undefined,
      kind: 'damage',
      damageType: type,
      color: STAGE_COLORS.averageHit,
    })
  }

  for (const type of DAMAGE_TYPES) {
    if (!activeTypes.has(type)) continue
    const stagePath: Array<{ stage: GraphStage; color: string }> = ([
      { stage: 'base', color: TYPE_COLORS[type] },
      { stage: 'conversion', color: STAGE_COLORS.conversion },
      { stage: 'gain', color: STAGE_COLORS.gain },
      { stage: 'increased', color: STAGE_COLORS.increased },
      { stage: 'more', color: STAGE_COLORS.more },
      { stage: 'crit', color: STAGE_COLORS.crit },
      { stage: 'defence', color: STAGE_COLORS.defence },
      { stage: 'averageHit', color: STAGE_COLORS.averageHit },
    ] as Array<{ stage: GraphStage; color: string }>).filter((entry) => visibleNodes.has(nodeId(entry.stage, type)))
    const stage = stageByType.get(type)
    const hasOriginalBase = hasPositiveRange(stage?.baseMin, stage?.baseMax)
    for (let index = 1; index < stagePath.length; index += 1) {
      const previous = stagePath[index - 1]
      const current = stagePath[index]
      // A generated lane starts at the explicit conversion/Gain transfer edge;
      // connecting its empty base placeholder would suggest a false base value.
      if (previous.stage === 'base' && !hasOriginalBase) continue
      edges.push({ id: `${previous.stage}-${type}-${current.stage}`, from: nodeId(previous.stage, type), to: nodeId(current.stage, type), color: current.color })
    }
  }

  // PoB exposes conversion and Gain as source-to-target percentages. Expand
  // broad sources such as "all" only onto lanes that have a real source pool,
  // so a Gain-only chaos lane never looks like it owns a chaos base.
  const sourcePool = (type: DamageType, kind: 'gain' | 'conversion'): number => {
    const stage = stageByType.get(type)
    if (!stage) return 0
    const value = kind === 'conversion'
      ? averageStage(stage, 'baseMin', 'baseMax')
      : rangeAverage(stageConversionPool(stage, 'min'), stageConversionPool(stage, 'max'))
    return value != null && value > 0 ? value : 0
  }
  const expandTransferSource = (from: string): DamageType[] => {
    if (isDamageType(from)) return [from]
    if (from === 'elemental') return ['fire', 'cold', 'lightning']
    if (from === 'nonChaos') return ['physical', 'fire', 'cold', 'lightning']
    if (from === 'all') return DAMAGE_TYPES
    return []
  }
  const transferEdgeValues = new Map<string, { from: DamageType; fromLabel: string; to: DamageType; kind: 'gain' | 'conversion'; value: number }>()
  for (const kind of ['conversion', 'gain'] as const) {
    const rows = kind === 'gain' ? gainRows : transferRows(data, kind)
    for (const row of rows) {
      if (!isDamageType(row.to) || !Number.isFinite(row.value) || row.value === 0) continue
      for (const from of expandTransferSource(row.from)) {
        if (!activeTypes.has(row.to) || !activeTypes.has(from) || sourcePool(from, kind) <= 0) continue
        if (kind === 'conversion' && from === row.to) continue
        const targetStage = kind === 'conversion' ? 'conversion' : 'gain'
        if (!visibleNodes.has(nodeId(targetStage, row.to))) continue
        const key = `${kind}-${from}-${row.to}`
        const current = transferEdgeValues.get(key)
        if (current) current.value += row.value
        else transferEdgeValues.set(key, { from, fromLabel: row.from, to: row.to, kind, value: row.value })
      }
    }
  }
  const broadTransferLabels = new Set<string>()
  const transferSourceLabel = (value: string): string => {
    if (isDamageType(value)) return damageTypeLabel(value, language)
    if (value === 'elemental') return l(language, 'Elemental damage', '元素伤害')
    if (value === 'nonChaos') return l(language, 'Non-chaos damage', '非混沌伤害')
    return l(language, 'All damage', '全部伤害')
  }
  for (const edge of transferEdgeValues.values()) {
    const sourceStage = edge.kind === 'conversion'
      ? 'base'
      : visibleNodes.has(nodeId('conversion', edge.from)) ? 'conversion' : 'base'
    const broadSource = !isDamageType(edge.fromLabel)
    const broadLabelKey = `${edge.kind}-${edge.fromLabel}-${edge.to}-${edge.value}`
    const showLabel = !broadSource || !broadTransferLabels.has(broadLabelKey)
    if (broadSource) broadTransferLabels.add(broadLabelKey)
    edges.push({
      id: `transfer-${edge.kind}-${edge.from}-${edge.to}`,
      from: nodeId(sourceStage, edge.from),
      to: nodeId(edge.kind === 'conversion' ? 'conversion' : 'gain', edge.to),
      label: showLabel ? `${transferSourceLabel(edge.fromLabel)} → ${damageTypeLabel(edge.to, language)} ${formatPercent(edge.value, language, 0)}` : undefined,
      labelPlacement: 'target',
      color: broadSource ? STAGE_COLORS[edge.kind] : TYPE_COLORS[edge.from],
      dashed: edge.kind === 'gain',
    })
  }

  const activeLaneY = DAMAGE_TYPES.filter((type) => activeTypes.has(type)).map((type) => laneY.get(type)!)
  const resultY = activeLaneY.length ? activeLaneY.reduce((sum, value) => sum + value, 0) / activeLaneY.length : laneTop + laneGap
  const rateY = resultY - nodeHeight / 2
  const finalY = resultY - nodeHeight / 2
  const aggregateDps = data.finalDamageTypes.reduce((sum, entry) => sum + (Number.isFinite(entry.finalDps) ? entry.finalDps : 0), 0)
  const averageDamage = data.calculationScope === 'selectedSkill'
    ? data.averageDamage != null ? data.averageDamage : data.averageHit != null && data.hitChance != null ? data.averageHit * data.hitChance / 100 : null
    : aggregateDps || null
  const dpsFormula = data.calculationScope === 'selectedSkill' && data.dpsMultiplier != null && data.quantityMultiplier != null && data.effectiveRate != null
    ? `${formatNumber(averageDamage, language, 0)} × ${formatNumber(data.effectiveRate, language, 2)} × ${formatNumber(data.dpsMultiplier, language, 2)} × ${formatNumber(data.quantityMultiplier, language, 2)}`
    : `${data.includedSkillCount} ${l(language, 'skill DPS contributions', '个技能 DPS 贡献')} ${l(language, 'summed', '合计')}`
  const formulaDps = data.calculationScope === 'selectedSkill'
    && averageDamage != null
    && data.effectiveRate != null
    && data.dpsMultiplier != null
    && data.quantityMultiplier != null
    ? averageDamage * data.effectiveRate * data.dpsMultiplier * data.quantityMultiplier
    : null
  const formulaDpsDetail = data.calculationScope !== 'selectedSkill'
    ? `${l(language, 'Exact PoB per-skill DPS sum', 'PoB 各技能 DPS 精确合计')} ${formatNumber(aggregateDps, language, 0)}`
    : formulaDps == null || data.totalDps == null
      ? l(language, 'PoB reported DPS is available', 'PoB 报告 DPS 可用')
    : `${l(language, 'Formula result', '公式结果')} ${formatNumber(formulaDps, language, 0)} · ${l(language, 'Difference', '差值')} ${formatSignedNumber(formulaDps - data.totalDps, language)}`
  const dpsCheckDetail = data.dpsVerification.status === 'unavailable'
    ? l(language, 'DPS check unavailable', 'DPS 校验不可用')
    : `${l(language, 'Checked', '校验')} ${formatSignedNumber(data.dpsVerification.difference, language)}`
  addNode({
    id: 'rate', stage: 'rate', x: stageX.get('rate')!, y: rateY, width: nodeWidth, height: nodeHeight,
    title: l(language, 'Hit × output rate', '命中 × 输出频率'),
    value: data.effectiveRate != null ? `${formatNumber(data.effectiveRate, language, 2)}/s` : '—',
    detail: data.calculationScope === 'selectedSkill'
      ? l(language, 'PoB output frequency used by DPS', 'PoB 用于 DPS 的输出频率')
      : `${l(language, 'Each included skill keeps its own output frequency', '每个计入技能保留自己的输出频率')} · ${data.includedSkillCount} ${l(language, 'skills', '个技能')}`,
    meta: data.effectiveRate != null ? `${l(language, 'Hits per second', '每秒命中')} ${formatNumber(data.effectiveRate, language, 2)}` : undefined,
    kind: 'result', color: STAGE_COLORS.rate,
  })
  addNode({
    id: 'final', stage: 'final', x: stageX.get('final')!, y: finalY, width: nodeWidth, height: nodeHeight,
    title: l(language, 'Final DPS', '最终 DPS'),
    value: formatNumber(data.totalDps, language, 0),
    detail: dpsCheckDetail,
    meta: data.calculationScope === 'selectedSkill' ? dpsFormula : `${data.includedSkillCount} ${l(language, 'skills', '个技能')} · ${l(language, 'PoB total', 'PoB 总 DPS')} ${formatNumber(data.totalDps, language, 0)}`,
    kind: 'result', color: STAGE_COLORS.final,
  })
  for (const type of DAMAGE_TYPES) {
    if (activeTypes.has(type)) edges.push({ id: `averageHit-${type}-rate`, from: nodeId('averageHit', type), to: 'rate', color: TYPE_COLORS[type] })
  }
  edges.push({ id: 'rate-final', from: 'rate', to: 'final', label: `${formatNumber(data.effectiveRate, language, 2)}/s`, labelPlacement: 'line', color: STAGE_COLORS.rate })

  const lastLane = laneY.get('chaos')! + laneHeight / 2
  const height = Math.max(560, lastLane) + 92
  const baseTotal = stageTotal((stage) => rangeAverage(stage.baseMin, stage.baseMax)) ?? data.baseTotalAverage
  const retainedTotal = stageTotal((stage) => rangeAverage(stage.retainedMin, stage.retainedMax))
  const conversionTotal = stageTotal((stage) => rangeAverage(stageConversionPool(stage, 'min'), stageConversionPool(stage, 'max')))
  const summedTotal = stageTotal((stage) => rangeAverage(stage.summedMin, stage.summedMax))
  const gainContributionTotal = stageTotal((stage) => rangeAverage(stage.gainMin, stage.gainMax))
  const increasedTotal = stageTotal((stage) => rangeAverage(stage.increasedMin, stage.increasedMax))
  const moreTotal = stageTotal((stage) => rangeAverage(stage.moreStageMin, stage.moreStageMax))
  const expectedTotal = stageTotal((stage) => stage.expectedAverage)
  const effectiveTotal = stageTotal((stage) => stage.effectiveAverage)
  const stageRangeTotal = (readMin: (stage: SkillDamageStageValues) => number | null | undefined, readMax: (stage: SkillDamageStageValues) => number | null | undefined): { min: number; max: number; average: number } | null => {
    let min = 0
    let max = 0
    let hasValue = false
    for (const stage of stageByType.values()) {
      if (!stage) continue
      const stageMin = readMin(stage)
      const stageMax = readMax(stage)
      if (!Number.isFinite(stageMin) || !Number.isFinite(stageMax)) continue
      min += stageMin as number
      max += stageMax as number
      hasValue = true
    }
    return hasValue ? { min, max, average: (min + max) / 2 } : null
  }
  const baseRangeTotal = stageRangeTotal((stage) => stage.baseMin, (stage) => stage.baseMax)
  const conversionRangeTotal = stageRangeTotal((stage) => stageConversionPool(stage, 'min'), (stage) => stageConversionPool(stage, 'max'))
  const summedRangeTotal = stageRangeTotal((stage) => stage.summedMin, (stage) => stage.summedMax)
  const increasedRangeTotal = stageRangeTotal((stage) => stage.increasedMin, (stage) => stage.increasedMax)
  const moreRangeTotal = stageRangeTotal((stage) => stage.moreStageMin, (stage) => stage.moreStageMax)
  const critRangeTotal = stageRangeTotal((stage) => expectedCritRange(stage, data.critChance)?.min, (stage) => expectedCritRange(stage, data.critChance)?.max)
  const effectiveRangeTotal = stageRangeTotal((stage) => stage.effectiveMin, (stage) => stage.effectiveMax)
  const factorText = (value: number | null): string => value == null ? '—' : `×${formatNumber(value, language, 2)}`
  const graphSkillName = data.skillContext?.parentSkillName || data.skillName
  const title = `${l(language, 'Path of Exile 2 Damage Calculation Flow', '流放之路2 伤害计算流向图')} - ${graphSkillName} ${l(language, 'Level', '等级')} ${skillLevel ?? '—'}`
  const headerData: Record<GraphStage, { title: string; value: string; detail: string; color: string }> = {
    base: { title: l(language, 'Damage base', '伤害基底(点伤)'), value: baseRangeTotal ? rangeSummary(baseRangeTotal.min, baseRangeTotal.max, language) : formatNumber(baseTotal, language, 0), detail: `${l(language, 'PoB base range', 'PoB 基底区间')} · ${l(language, 'average', '平均')} ${formatNumber(baseRangeTotal?.average ?? baseTotal, language, 0)}`, color: STAGE_COLORS.base },
    conversion: { title: l(language, 'Conversion', '转换'), value: averageValueText(conversionRangeTotal?.min, conversionRangeTotal?.max, conversionTotal, language), detail: `${l(language, 'Retained', '保留')} ${formatNumber(retainedTotal, language, 0)} + ${l(language, 'converted in', '转入')} = ${formatNumber(conversionTotal, language, 0)}`, color: STAGE_COLORS.conversion },
    gain: { title: l(language, 'Gain as extra', '额外 (Gain)'), value: averageValueText(summedRangeTotal?.min, summedRangeTotal?.max, summedTotal, language), detail: gainContributionTotal != null ? `${l(language, 'After conversion', '转换后')} ${formatNumber(conversionTotal, language, 0)} + ${l(language, 'Extra contribution', '额外贡献')} ${formatSignedNumber(gainContributionTotal, language)} = ${formatNumber(summedTotal, language, 0)}` : `${l(language, 'After conversion', '转换后')} ${formatNumber(conversionTotal, language, 0)} + ${l(language, 'Extra contribution', '额外贡献')} = ${formatNumber(summedTotal, language, 0)}`, color: STAGE_COLORS.gain },
    increased: { title: l(language, 'Increased', '同类提高 (increase)'), value: averageValueText(increasedRangeTotal?.min, increasedRangeTotal?.max, increasedTotal, language), detail: `${l(language, 'Exact sum after each type increase', '各伤害类型提高后的精确合计')} · ${factorText(stageFactorForTotals(summedTotal, increasedTotal))}`, color: STAGE_COLORS.increased },
    more: { title: l(language, 'More', '独立增幅 (More)'), value: averageValueText(moreRangeTotal?.min, moreRangeTotal?.max, moreTotal, language), detail: `${l(language, 'Exact sum after independent multipliers', '独立倍率后的精确合计')} · ${factorText(stageFactorForTotals(increasedTotal, moreTotal))}`, color: STAGE_COLORS.more },
    crit: { title: l(language, 'Critical expectation', '暴击/暴伤 (期望伤害)'), value: averageValueText(critRangeTotal?.min, critRangeTotal?.max, expectedTotal, language), detail: data.critChance != null ? `${formatPercent(100 - data.critChance, language)} × 普通命中 + ${formatPercent(data.critChance, language)} × 暴击命中 = ${formatNumber(expectedTotal, language, 0)} · ×${formatNumber(data.critMultiplier, language, 2)}` : `${l(language, 'Exact expected damage sum', '精确期望伤害合计')} = ${formatNumber(expectedTotal, language, 0)}`, color: STAGE_COLORS.crit },
    defence: { title: l(language, 'Enemy defence', '敌人有效防御'), value: averageValueText(effectiveRangeTotal?.min, effectiveRangeTotal?.max, effectiveTotal, language), detail: `${l(language, 'Exact post-mitigation expected damage', '减伤后的精确期望伤害')} · ${l(language, 'per damage type sum', '各伤害类型合计')}`, color: STAGE_COLORS.defence },
    averageHit: { title: l(language, 'Average hit damage', '平均命中伤害'), value: formatNumber(data.averageHit ?? effectiveTotal, language, 0), detail: `${l(language, 'PoB output', 'PoB 输出')} · ${formatNumber(effectiveTotal, language, 0)} → ${formatNumber(data.averageHit ?? effectiveTotal, language, 0)}`, color: STAGE_COLORS.averageHit },
    rate: { title: l(language, 'Output rate', '输出频率(攻击与施法)'), value: data.effectiveRate != null ? `${formatNumber(data.effectiveRate, language, 2)}/s` : '—', detail: data.calculationScope === 'selectedSkill' ? l(language, 'PoB output frequency used by DPS', 'PoB 用于 DPS 的输出频率') : `${l(language, 'Each included skill keeps its own output frequency', '每个计入技能保留自己的输出频率')} · ${data.includedSkillCount} ${l(language, 'skills', '个技能')}`, color: STAGE_COLORS.rate },
    final: { title: l(language, 'Final DPS', '最终 DPS'), value: formatNumber(data.totalDps, language, 0), detail: `${dpsFormula} = ${formatNumber(formulaDps ?? data.totalDps, language, 0)} · ${formulaDpsDetail} · ${dpsCheckDetail}`, color: STAGE_COLORS.final },
  }
  return {
    width: cursor + 28,
    height,
    title,
    stageHeaders: stageWidths.map((entry) => ({ x: stageX.get(entry.stage)!, width: entry.width, ...headerData[entry.stage] })),
    lanes: DAMAGE_TYPES.map((type) => ({ y: laneY.get(type)!, height: laneHeight, label: damageTypeLabel(type, language), color: TYPE_COLORS[type] })),
    nodes,
    edges,
  }
}

function textNode(value: string, x: number, y: number, size: number, color: string, weight: 'normal' | '600' | '700' = 'normal'): Text {
  const text = new Text({ text: value, style: { fontFamily: 'Roboto, Segoe UI, Arial, sans-serif', fontSize: size, fill: color, fontWeight: weight } })
  text.position.set(x, y)
  return text
}

function wrappedText(value: string, x: number, y: number, width: number, maxHeight: number, size: number, color: string, weight: 'normal' | '600' | '700' = 'normal'): Text {
  let fontSize = size
  let text = new Text({ text: value, style: { fontFamily: 'Roboto, Segoe UI, Arial, sans-serif', fontSize, fill: color, fontWeight: weight, wordWrap: true, wordWrapWidth: width, breakWords: true, lineHeight: fontSize * 1.22 } })
  // Keep formulas inside their node. Font size is reduced before applying a
  // final scale, so long formulas stay legible instead of being clipped.
  while (text.height > maxHeight && fontSize > 6.5) {
    fontSize -= 0.5
    text = new Text({ text: value, style: { fontFamily: 'Roboto, Segoe UI, Arial, sans-serif', fontSize, fill: color, fontWeight: weight, wordWrap: true, wordWrapWidth: width, breakWords: true, lineHeight: fontSize * 1.22 } })
  }
  if (text.height > maxHeight && text.height > 0) text.scale.y = maxHeight / text.height
  text.position.set(x, y)
  return text
}

function drawArrow(graphics: Graphics, x: number, y: number, color: string): void {
  graphics.moveTo(x, y).lineTo(x - 8, y - 4).lineTo(x - 8, y + 4).closePath().fill({ color, alpha: 0.85 })
}

interface EdgeLabelBox {
  x: number
  y: number
  width: number
  height: number
}

function overlapsEdgeLabel(a: EdgeLabelBox, b: EdgeLabelBox): boolean {
  return Math.abs(a.x - b.x) < (a.width + b.width) / 2 + 8
    && Math.abs(a.y - b.y) < (a.height + b.height) / 2 + 6
}

function overlapsGraphNode(label: EdgeLabelBox, node: GraphNodeModel): boolean {
  return Math.abs(label.x - (node.x + node.width / 2)) < (label.width + node.width) / 2 + 4
    && Math.abs(label.y - (node.y + node.height / 2)) < (label.height + node.height) / 2 + 4
}

function drawEdge(
  graphics: Graphics,
  from: GraphNodeModel,
  to: GraphNodeModel,
  color: string,
  dashed = false,
  label?: string,
  labelPlacement: 'line' | 'target' = 'line',
  occupiedLabels: EdgeLabelBox[] = [],
  blockedNodes: GraphNodeModel[] = [],
): Container | null {
  const startX = from.x + from.width
  const startY = from.y + from.height / 2
  const endX = to.x
  const endY = to.y + to.height / 2
  const bendX = startX + Math.max(16, (endX - startX) / 2)
  const isBent = Math.abs(startY - endY) > 1
  if (dashed) {
    const length = Math.max(1, bendX - startX)
    const dash = 8
    for (let x = 0; x < length; x += dash * 2) graphics.moveTo(startX + x, startY).lineTo(Math.min(startX + x + dash, bendX), startY)
    if (Math.abs(startY - endY) > 1) graphics.moveTo(bendX, startY).lineTo(bendX, endY)
    const finalLength = Math.max(1, endX - bendX)
    for (let x = 0; x < finalLength; x += dash * 2) graphics.moveTo(bendX + x, endY).lineTo(Math.min(bendX + x + dash, endX), endY)
  } else {
    graphics.moveTo(startX, startY).lineTo(bendX, startY).lineTo(bendX, endY).lineTo(endX, endY)
  }
  graphics.stroke({ color, width: 1.4, alpha: dashed ? 0.42 : 0.7 })
  drawArrow(graphics, endX, endY, color)
  if (!label) return null

  // Keep edge explanations readable at the graph's fit-to-view zoom. They
  // are rendered as callouts instead of bare text so the path underneath can
  // never make the direction or percentage ambiguous.
  const labelText = textNode(label, 0, 0, 10, '#f3ead8', '600')
  labelText.anchor.set(0.5)
  const paddingX = 8
  const paddingY = 5
  const labelWidth = labelText.width + paddingX * 2
  const labelHeight = labelText.height + paddingY * 2
  const centerX = isBent ? bendX : (startX + endX) / 2
  const centerY = isBent ? (startY + endY) / 2 : startY
  const lineCandidates: Array<{ x: number; y: number }> = isBent
    ? [-220, 220, -140, 140, -80, 80, 0].flatMap((offset) => [
        { x: bendX + labelWidth / 2 + 10, y: centerY + offset },
        { x: bendX - labelWidth / 2 - 10, y: centerY + offset },
      ])
    : (centerY < 220
        ? [
            { x: centerX, y: centerY + from.height / 2 + labelHeight / 2 + 8 },
            { x: centerX, y: centerY - from.height / 2 - labelHeight / 2 - 8 },
          ]
        : [
            { x: centerX, y: centerY - from.height / 2 - labelHeight / 2 - 8 },
            { x: centerX, y: centerY + from.height / 2 + labelHeight / 2 + 8 },
          ])
  const targetY = endY < 220
    ? endY + to.height / 2 + labelHeight / 2 + 8
    : endY - to.height / 2 - labelHeight / 2 - 8
  const oppositeTargetY = endY < 220
    ? endY - to.height / 2 - labelHeight / 2 - 8
    : endY + to.height / 2 + labelHeight / 2 + 8
  const targetCandidates: Array<{ x: number; y: number }> = [
    { x: endX + to.width / 2, y: targetY },
    { x: endX + to.width / 2, y: oppositeTargetY },
    { x: endX + to.width * 0.28, y: targetY },
    { x: endX + to.width * 0.72, y: targetY },
    { x: endX + to.width * 0.28, y: oppositeTargetY },
    { x: endX + to.width * 0.72, y: oppositeTargetY },
  ]
  const candidates = labelPlacement === 'target' ? targetCandidates : lineCandidates
  const chosen = candidates.find((candidate) => {
    const box = { x: candidate.x, y: candidate.y, width: labelWidth, height: labelHeight }
    return !occupiedLabels.some((occupied) => overlapsEdgeLabel(box, occupied))
      && !blockedNodes.some((node) => overlapsGraphNode(box, node))
  }) || candidates[0]
  const labelBox = { x: chosen.x, y: chosen.y, width: labelWidth, height: labelHeight }
  occupiedLabels.push(labelBox)

  const container = new Container()
  container.position.set(chosen.x, chosen.y)
  const labelBackground = new Graphics()
  const labelColor = Number.parseInt(color.replace('#', ''), 16)
  labelBackground.roundRect(-labelWidth / 2, -labelHeight / 2, labelWidth, labelHeight, 6)
    .fill({ color: 0x0b0b0a, alpha: 0.94 })
    .stroke({ color: labelColor, width: 1, alpha: 0.85 })
  labelBackground.roundRect(-labelWidth / 2, -labelHeight / 2, 3, labelHeight, 2)
    .fill({ color: labelColor, alpha: 0.95 })
  container.addChild(labelBackground)
  container.addChild(labelText)
  return container
}

function drawNode(model: GraphNodeModel): Container {
  const container = new Container()
  container.position.set(model.x, model.y)
  const background = new Graphics()
  const surface = model.kind === 'flow' ? 0x161514 : model.kind === 'result' ? 0x211a0e : 0x121211
  background.roundRect(0, 0, model.width, model.height, 12).fill({ color: surface, alpha: 0.86 }).stroke({ color: 0x5a492d, width: 1, alpha: 0.72 })
  background.roundRect(0, 0, 5, model.height, 3).fill({ color: model.color, alpha: 0.95 })
  background.moveTo(12, 1).lineTo(model.width - 12, 1).stroke({ color: 0xe0c477, width: 1, alpha: 0.1 })
  container.addChild(background)
  const isFlow = model.kind === 'flow'
  container.addChild(textNode(shortText(model.title, isFlow ? 29 : 24), 15, 9, isFlow ? 13 : 12, '#e2d8c0', '600'))
  container.addChild(wrappedText(model.value, 15, isFlow ? 26 : 29, model.width - 30, 30, model.kind === 'result' ? 24 : 20, model.color, '700'))
  const detailY = model.height - (model.meta ? 43 : 27)
  const detailBottom = model.meta ? model.height - 20 : model.height - 8
  container.addChild(wrappedText(model.detail, 15, detailY, model.width - 30, Math.max(12, detailBottom - detailY), 8.5, '#a0947d'))
  if (model.meta) {
    container.addChild(wrappedText(model.meta, 15, model.height - (model.metaEmphasis ? 23 : 18), model.width - 30, model.metaEmphasis ? 20 : 15, model.metaEmphasis ? 12 : 8.5, model.metaEmphasis ? model.color : '#c5aa6d', model.metaEmphasis ? '700' : 'normal'))
  }
  return container
}

function applyCamera(world: Container, camera: { x: number; y: number; zoom: number }): void {
  world.position.set(camera.x, camera.y)
  world.scale.set(camera.zoom)
}

function getGraphResolution(): number {
  if (typeof window === 'undefined') return 1
  return Math.max(1, Math.min(3, window.devicePixelRatio || 1))
}

function resizeGraphRenderer(app: Application, host: HTMLElement): void {
  const rect = host.getBoundingClientRect()
  app.renderer.resize(Math.max(1, Math.round(rect.width)), Math.max(1, Math.round(rect.height)), getGraphResolution())
}

export function DamageFlowGraph({ data, skillLevel, onClose }: Props) {
  const { lang } = useTranslation()
  const hostRef = useRef<HTMLDivElement>(null)
  const appRef = useRef<Application | null>(null)
  const worldRef = useRef<Container | null>(null)
  const graphRef = useRef<GraphModel | null>(null)
  const cameraRef = useRef({ x: 0, y: 0, zoom: 1 })
  const pointerRef = useRef<{ id: number; x: number; y: number; moved: boolean } | null>(null)
  const [pixiReady, setPixiReady] = useState(false)
  const [imageAction, setImageAction] = useState<'save' | 'copy' | null>(null)
  const [imageNotice, setImageNotice] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)
  const graph = useMemo(() => buildGraph(data, lang, skillLevel), [data, lang, skillLevel])
  graphRef.current = graph

  const fitView = useCallback(() => {
    const app = appRef.current
    const world = worldRef.current
    const model = graphRef.current
    const host = hostRef.current
    if (!app || !world || !model || !host) return
    const rect = host.getBoundingClientRect()
    const zoom = Math.max(0.28, Math.min(1, Math.min((rect.width - 40) / model.width, (rect.height - 40) / model.height)))
    cameraRef.current = { x: (rect.width - model.width * zoom) / 2, y: (rect.height - model.height * zoom) / 2, zoom }
    applyCamera(world, cameraRef.current)
  }, [])

  const zoomAt = useCallback((nextZoom: number, clientX?: number, clientY?: number) => {
    const world = worldRef.current
    const host = hostRef.current
    if (!world || !host) return
    const rect = host.getBoundingClientRect()
    const camera = cameraRef.current
    const zoom = Math.max(0.22, Math.min(2.2, nextZoom))
    const pointX = clientX == null ? rect.width / 2 : clientX - rect.left
    const pointY = clientY == null ? rect.height / 2 : clientY - rect.top
    const worldX = (pointX - camera.x) / camera.zoom
    const worldY = (pointY - camera.y) / camera.zoom
    camera.x = pointX - worldX * zoom
    camera.y = pointY - worldY * zoom
    camera.zoom = zoom
    applyCamera(world, camera)
  }, [])

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    let destroyed = false
    let initialized = false
    const app = new Application()
    void app.init({ background: '#0a0a09', backgroundAlpha: 0, antialias: true, autoDensity: true, resolution: getGraphResolution(), resizeTo: host, preference: 'webgl' }).then(() => {
      initialized = true
      if (destroyed) {
        app.destroy(true)
        return
      }
      appRef.current = app
      const world = new Container()
      worldRef.current = world
      app.stage.addChild(world)
      app.canvas.style.width = '100%'
      app.canvas.style.height = '100%'
      app.canvas.style.display = 'block'
      app.canvas.dataset.renderer = 'pixi'
      host.replaceChildren(app.canvas)
      resizeGraphRenderer(app, host)
      setPixiReady(true)
      fitView()
    }).catch((error) => console.error('Failed to initialize damage flow graph', error))
    return () => {
      destroyed = true
      if (worldRef.current) worldRef.current.removeChildren().forEach((child) => child.destroy({ children: true }))
      worldRef.current = null
      appRef.current = null
      setPixiReady(false)
      if (initialized) app.destroy(true)
    }
  }, [fitView])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  useEffect(() => {
    const app = appRef.current
    const world = worldRef.current
    if (!app || !world || !pixiReady) return
    world.removeChildren().forEach((child) => child.destroy({ children: true }))
    const model = graph
    const background = new Graphics()
    background.rect(0, 0, model.width, model.height).fill({ color: 0x080808, alpha: 0.84 })
    for (const header of model.stageHeaders) {
      const headerColor = Number.parseInt(header.color.replace('#', ''), 16)
      background.roundRect(header.x, GRAPH_HEADER_TOP, header.width, GRAPH_HEADER_HEIGHT, 12).fill({ color: 0x1b1710, alpha: 0.9 }).stroke({ color: headerColor, width: 1.1, alpha: 0.65 })
      background.roundRect(header.x, GRAPH_HEADER_TOP, 5, GRAPH_HEADER_HEIGHT, 3).fill({ color: headerColor, alpha: 0.9 })
      background.moveTo(header.x + 14, GRAPH_HEADER_TOP + 1).lineTo(header.x + header.width - 14, GRAPH_HEADER_TOP + 1).stroke({ color: 0xe0c477, width: 1, alpha: 0.12 })
    }
    for (const lane of model.lanes) {
      const laneColor = Number.parseInt(lane.color.replace('#', ''), 16)
      const laneTop = lane.y - lane.height / 2
      background.roundRect(12, laneTop, model.width - 24, lane.height, 12).fill({ color: 0x10100f, alpha: 0.72 }).stroke({ color: 0x3e3424, width: 1, alpha: 0.82 })
      background.roundRect(12, laneTop, 5, lane.height, 3).fill({ color: laneColor, alpha: 0.9 })
      background.moveTo(20, lane.y).lineTo(model.width - 20, lane.y).stroke({ color: laneColor, width: 1, alpha: 0.18 })
      background.roundRect(22, laneTop + 10, 68, 24, 7).fill({ color: laneColor, alpha: 0.12 }).stroke({ color: 0x725c31, width: 1, alpha: 0.36 })
    }
    background.roundRect(12, GRAPH_HEADER_TOP, 68, GRAPH_SUMMARY_HEIGHT, 12).fill({ color: 0x1b1710, alpha: 0.9 }).stroke({ color: 0x725c31, width: 1.1, alpha: 0.65 })
    background.roundRect(12, GRAPH_HEADER_TOP, 5, GRAPH_SUMMARY_HEIGHT, 3).fill({ color: 0xe0c477, alpha: 0.9 })
    world.addChild(background)
    world.addChild(textNode(l(lang, 'Stage summary', '阶段汇总'), 24, GRAPH_HEADER_TOP + 12, 11, '#e2d8c0', '700'))
    world.addChild(wrappedText(l(lang, 'All damage types total', '所有伤害类型合计'), 24, GRAPH_HEADER_TOP + 36, 54, 30, 8.5, '#a9956d'))
    for (const header of model.stageHeaders) {
      world.addChild(textNode(l(lang, 'Summary', '汇总'), header.x + 15, GRAPH_HEADER_TOP + 11, 8.5, '#d7b867', '700'))
      world.addChild(textNode(shortText(header.title, header.width < 190 ? 16 : 22), header.x + 15, GRAPH_HEADER_TOP + 27, 11, '#e2d8c0', '600'))
      world.addChild(wrappedText(header.value, header.x + 13, GRAPH_HEADER_TOP + 47, header.width - 26, 28, 18, header.color, '700'))
      world.addChild(wrappedText(header.detail, header.x + 15, GRAPH_HEADER_TOP + 84, header.width - 28, 34, 8.5, '#a9956d'))
    }
    world.addChild(wrappedText(model.title, 30, GRAPH_TITLE_TOP + 4, model.width - 60, GRAPH_TITLE_HEIGHT - 8, 22, '#f0d27b', '700'))
    for (const lane of model.lanes) world.addChild(textNode(lane.label, 32, lane.y - lane.height / 2 + 17, 12, lane.color, '700'))

    const nodes = new Map(model.nodes.map((node) => [node.id, node]))
    const edges = new Graphics()
    const edgeLabels = new Container()
    const occupiedLabels: EdgeLabelBox[] = []
    for (const edge of model.edges) {
      const from = nodes.get(edge.from)
      const to = nodes.get(edge.to)
      if (from && to) {
        const label = drawEdge(edges, from, to, edge.color, edge.dashed, edge.label, edge.labelPlacement, occupiedLabels, model.nodes)
        if (label) edgeLabels.addChild(label)
      }
    }
    world.addChild(edges)
    for (const node of model.nodes) world.addChild(drawNode(node))
    // Callouts must be above nodes: short inter-column gaps can place a label
    // close to a card, and hiding it makes the transfer direction unreadable.
    world.addChild(edgeLabels)
    applyCamera(world, cameraRef.current)
  }, [graph, pixiReady])

  useEffect(() => {
    const host = hostRef.current
    const app = appRef.current
    if (!host || !app || !pixiReady) return
    const syncRendererSize = () => resizeGraphRenderer(app, host)
    syncRendererSize()
    const observer = new ResizeObserver(() => {
      const world = worldRef.current
      syncRendererSize()
      if (world) applyCamera(world, cameraRef.current)
    })
    observer.observe(host)
    return () => observer.disconnect()
  }, [pixiReady])

  const handleWheel = (event: WheelEvent<HTMLDivElement>) => {
    event.preventDefault()
    zoomAt(cameraRef.current.zoom * (event.deltaY > 0 ? 0.9 : 1.1), event.clientX, event.clientY)
  }
  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    pointerRef.current = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false }
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const pointer = pointerRef.current
    const world = worldRef.current
    if (!pointer || pointer.id !== event.pointerId || !world) return
    const dx = event.clientX - pointer.x
    const dy = event.clientY - pointer.y
    if (Math.abs(dx) + Math.abs(dy) > 3) pointer.moved = true
    if (!pointer.moved) return
    cameraRef.current.x += dx
    cameraRef.current.y += dy
    pointer.x = event.clientX
    pointer.y = event.clientY
    applyCamera(world, cameraRef.current)
  }
  const handlePointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (pointerRef.current?.id === event.pointerId) pointerRef.current = null
  }

  const context = data.skillContext || {}
  const graphSkillName = context.parentSkillName || data.skillName
  const graphSkillDetails = [
    context.formName ? `${l(lang, 'Form', '形态')} · ${context.formName}` : '',
    context.statSetName ? `Stat Set · ${context.statSetName}` : '',
    context.minionSkillName ? `${l(lang, 'Minion skill', '召唤技能')} · ${context.minionSkillName}` : '',
    context.actorName ? `${l(lang, 'Actor', '计算对象')} · ${context.actorName}` : '',
    skillLevel != null ? `${l(lang, 'Level', '等级')} ${skillLevel}` : '',
    data.totalDps != null ? `DPS ${formatNumber(data.totalDps, lang, 0)}` : '',
    data.calculationScope !== 'selectedSkill' ? `${data.includedSkillCount} ${l(lang, 'skills included', '个技能计入')}` : '',
  ].filter(Boolean)

  const handleGraphImage = useCallback(async (mode: 'save' | 'copy') => {
    const app = appRef.current
    const world = worldRef.current
    if (!app || !world) return
    setImageAction(mode)
    setImageNotice(null)
    try {
      const canvas = extractGraphCanvas(app, world)
      if (!canvas.width || !canvas.height) throw new Error('Graph image is empty')
      const blob = await canvasToPngBlob(canvas)
      const dataUrl = await blobToDataUrl(blob)
      const safeSkillName = graphSkillName.replace(/[<>:"/\\|?*\u0000-\u001F]/g, '-').trim() || 'skill'
      const fileName = `superpoe-damage-flow-${safeSkillName}-level-${skillLevel ?? 'unknown'}.png`
      const bridge = window.pob2Desktop

      if (mode === 'save') {
        if (bridge?.saveAnalysisImage) {
          const result = await bridge.saveAnalysisImage({ dataUrl, fileName })
          if (!result.canceled) setImageNotice({ kind: 'success', text: l(lang, 'Image saved', '图片已保存') })
        } else {
          downloadBlob(blob, fileName)
          setImageNotice({ kind: 'success', text: l(lang, 'Image downloaded', '图片已下载') })
        }
      } else {
        if (bridge?.copyAnalysisImage) {
          await bridge.copyAnalysisImage(dataUrl)
        } else if (navigator.clipboard && typeof ClipboardItem !== 'undefined') {
          await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
        } else {
          throw new Error('Image clipboard is unavailable')
        }
        setImageNotice({ kind: 'success', text: l(lang, 'Image copied', '图片已复制') })
      }
    } catch (error) {
      console.error('[DamageFlowGraph] image export failed', error)
      setImageNotice({ kind: 'error', text: l(lang, 'Image export failed', '图片导出失败') })
    } finally {
      setImageAction(null)
    }
  }, [graphSkillName, l, lang, skillLevel])

  return <div className="damage-flow-graph-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <section className="damage-flow-graph-modal" role="dialog" aria-modal="true" aria-label={l(lang, 'Damage calculation flow', '伤害计算流图')}>
      <div className="damage-flow-graph-toolbar">
        <div className="damage-flow-graph-title">
          <span>{l(lang, 'Damage calculation flow', '伤害计算流图')}</span>
          <strong title={graphSkillName}>{graphSkillName}</strong>
          {graphSkillDetails.length > 0 && <div className="damage-flow-graph-context">{graphSkillDetails.map((detail) => <span key={detail}>{detail}</span>)}</div>}
        </div>
        <div className="damage-flow-graph-toolbar-actions">
          <button type="button" onClick={() => zoomAt(cameraRef.current.zoom * 0.85)} title={l(lang, 'Zoom out', '缩小')} aria-label={l(lang, 'Zoom out', '缩小')}><Minus /></button>
          <button type="button" onClick={() => zoomAt(cameraRef.current.zoom * 1.15)} title={l(lang, 'Zoom in', '放大')} aria-label={l(lang, 'Zoom in', '放大')}><Plus /></button>
          <button type="button" onClick={fitView} title={l(lang, 'Fit graph', '适应窗口')} aria-label={l(lang, 'Fit graph', '适应窗口')}><Maximize2 /></button>
          <button type="button" onClick={() => { const world = worldRef.current; if (!world) return; cameraRef.current = { x: 28, y: 28, zoom: 1 }; applyCamera(world, cameraRef.current) }} title={l(lang, 'Reset view', '重置视图')} aria-label={l(lang, 'Reset view', '重置视图')}><LocateFixed /></button>
          <button type="button" disabled={!pixiReady || imageAction !== null} onClick={() => void handleGraphImage('save')} title={l(lang, 'Save image', '另存图片')} aria-label={l(lang, 'Save image', '另存图片')}>{imageAction === 'save' ? <LoaderCircle className="damage-flow-graph-action-loading" /> : <Download />}</button>
          <button type="button" disabled={!pixiReady || imageAction !== null} onClick={() => void handleGraphImage('copy')} title={l(lang, 'Copy image to clipboard', '复制图片到剪贴板')} aria-label={l(lang, 'Copy image to clipboard', '复制图片到剪贴板')}>{imageAction === 'copy' ? <LoaderCircle className="damage-flow-graph-action-loading" /> : <Clipboard />}</button>
          {imageNotice && <span className={`damage-flow-graph-export-status ${imageNotice.kind}`} role="status" aria-live="polite">{imageNotice.kind === 'success' && <Check />}{imageNotice.text}</span>}
          <button type="button" className="damage-flow-graph-close" onClick={onClose} aria-label={l(lang, 'Close', '关闭')} title={l(lang, 'Close', '关闭')}><X /></button>
        </div>
      </div>
      <div className="damage-flow-graph-body">
        <div ref={hostRef} className="damage-flow-graph-canvas" onWheel={handleWheel} onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={handlePointerUp} onPointerCancel={handlePointerUp} onPointerLeave={handlePointerUp} />
      </div>
    </section>
  </div>
}

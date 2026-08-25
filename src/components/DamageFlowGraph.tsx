import { LocateFixed, Maximize2, Minus, Plus, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type WheelEvent } from 'react'
import { Application, Container, Graphics, Text } from 'pixi.js'
import { useTranslation } from '@/i18n/useTranslation'
import { formatUiNumber, uiText } from '@/i18n/uiLocale'
import type { DamageStructureReportData } from '@/components/DamageStructureReport'

type Language = Parameters<typeof uiText>[0]
type DamageType = 'physical' | 'lightning' | 'cold' | 'fire' | 'chaos'
type GraphStage = 'base' | 'flow' | 'increased' | 'more' | 'crit' | 'defence' | 'averageHit' | 'rate' | 'final'

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
  kind: 'damage' | 'flow' | 'result' | 'shared'
  damageType?: DamageType
  color: string
}

interface GraphEdgeModel {
  id: string
  from: string
  to: string
  label?: string
  color: string
  dashed?: boolean
}

interface GraphModel {
  width: number
  height: number
  stageHeaders: Array<{ x: number; width: number; label: string }>
  lanes: Array<{ y: number; label: string; color: string }>
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
  flow: '#6f9fc0',
  increased: '#d0a85c',
  more: '#d36f63',
  crit: '#aa83c5',
  defence: '#70818c',
  averageHit: '#c3a868',
  rate: '#7eb69c',
  final: '#e05f59',
}

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

function sourceLabel(source: string): string {
  return source
    .replace(/^Tree:/, 'Tree · ')
    .replace(/^Item:[^:]+:/, '')
    .replace(/^Skill:/, 'Skill · ')
    .replace(/^Buff:/, 'Buff · ')
    .replace(/^Aura:/, 'Aura · ')
    .replace(/^Config:/, 'Config · ')
    .replace(/^Enemy:/, 'Enemy · ')
}

function shortText(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, Math.max(1, maxLength - 1))}…` : value
}

function buildGraph(data: DamageStructureReportData, language: Language): GraphModel {
  const nodeWidth = 210
  const nodeHeight = 66
  const flowWidth = 254
  const stageGap = 40
  const stageWidths: Array<{ stage: GraphStage; width: number; label: string }> = [
    { stage: 'base', width: nodeWidth, label: l(language, 'Damage base', '伤害基底') },
    { stage: 'flow', width: flowWidth, label: l(language, 'Conversion / Gain', '转换 / 额外') },
    { stage: 'increased', width: nodeWidth, label: l(language, 'Increased by type', '按类型同类提高') },
    { stage: 'more', width: nodeWidth, label: l(language, 'More by type', '按类型独立增幅') },
    { stage: 'crit', width: nodeWidth, label: l(language, 'Critical expectation', '暴击期望') },
    { stage: 'defence', width: nodeWidth, label: l(language, 'Enemy defence', '敌人防御') },
    { stage: 'averageHit', width: nodeWidth, label: l(language, 'Average hit', '平均命中') },
    { stage: 'rate', width: nodeWidth, label: l(language, 'Output rate', '输出频率') },
    { stage: 'final', width: nodeWidth, label: l(language, 'Final DPS', '最终 DPS') },
  ]
  const stageX = new Map<GraphStage, number>()
  let cursor = 34
  for (const entry of stageWidths) {
    stageX.set(entry.stage, cursor)
    cursor += entry.width + stageGap
  }

  const flows = [...data.conversions, ...data.gains]
  const flowPerType = new Map<DamageType, number>()
  for (const flow of flows) {
    if (isDamageType(flow.to)) flowPerType.set(flow.to, (flowPerType.get(flow.to) || 0) + 1)
  }
  const maxFlowPerType = Math.max(1, ...flowPerType.values())
  const laneGap = Math.max(108, Math.min(250, 86 + maxFlowPerType * 18))
  const laneTop = 150
  const laneY = new Map<DamageType, number>(DAMAGE_TYPES.map((type, index) => [type, laneTop + index * laneGap]))
  const activeTypes = new Set<DamageType>()
  for (const range of data.combinedBaseRanges) if (isDamageType(range.type) && range.average !== 0) activeTypes.add(range.type)
  for (const entry of data.finalDamageTypes) if (isDamageType(entry.type) && entry.finalDps > 0) activeTypes.add(entry.type)
  for (const flow of flows) {
    if (isDamageType(flow.from)) activeTypes.add(flow.from)
    if (isDamageType(flow.to)) activeTypes.add(flow.to)
  }

  const nodes: GraphNodeModel[] = []
  const edges: GraphEdgeModel[] = []
  const addNode = (node: GraphNodeModel) => nodes.push(node)
  const nodeId = (stage: GraphStage, type: DamageType) => `${stage}-${type}`
  const baseRanges = new Map(data.combinedBaseRanges.filter((entry) => isDamageType(entry.type)).map((entry) => [entry.type, entry]))
  const damageDetails = new Map(data.damageTypes.filter((entry) => isDamageType(entry.type)).map((entry) => [entry.type, entry]))
  const finalDetails = new Map(data.finalDamageTypes.filter((entry) => isDamageType(entry.type)).map((entry) => [entry.type, entry]))
  const expectedCrit = data.critChance != null && data.critMultiplier != null
    ? 1 + (data.critChance / 100) * (data.critMultiplier - 1)
    : null

  for (const type of DAMAGE_TYPES) {
    const range = baseRanges.get(type)
    const detail = damageDetails.get(type)
    const final = finalDetails.get(type)
    const active = activeTypes.has(type)
    addNode({
      id: nodeId('base', type),
      stage: 'base',
      x: stageX.get('base')!,
      y: laneY.get(type)!,
      width: nodeWidth,
      height: nodeHeight,
      title: `${damageTypeLabel(type, language)} ${l(language, 'base', '基底')}`,
      value: range ? formatNumber(range.average, language, 0) : '—',
      detail: range ? `${formatNumber(range.min, language, 0)} - ${formatNumber(range.max, language, 0)}` : l(language, 'No exposed base range', '没有可读取的基底区间'),
      kind: 'damage',
      damageType: type,
      color: TYPE_COLORS[type],
    })
    addNode({
      id: nodeId('increased', type),
      stage: 'increased',
      x: stageX.get('increased')!,
      y: laneY.get(type)!,
      width: nodeWidth,
      height: nodeHeight,
      title: `${damageTypeLabel(type, language)} ${l(language, 'increased', '同类提高')}`,
      value: detail ? `×${(1 + detail.increased / 100).toFixed(2)}` : '—',
      detail: detail ? `${detail.increased >= 0 ? '+' : ''}${formatPercent(detail.increased, language)}` : l(language, 'No type value', '没有该类型数据'),
      kind: 'damage',
      damageType: type,
      color: STAGE_COLORS.increased,
    })
    addNode({
      id: nodeId('more', type),
      stage: 'more',
      x: stageX.get('more')!,
      y: laneY.get(type)!,
      width: nodeWidth,
      height: nodeHeight,
      title: `${damageTypeLabel(type, language)} ${l(language, 'More', '独立增幅')}`,
      value: detail ? `×${(1 + detail.more / 100).toFixed(2)}` : '—',
      detail: detail ? `${detail.more >= 0 ? '+' : ''}${formatPercent(detail.more, language)}` : l(language, 'No type value', '没有该类型数据'),
      kind: 'damage',
      damageType: type,
      color: STAGE_COLORS.more,
    })
    addNode({
      id: nodeId('crit', type),
      stage: 'crit',
      x: stageX.get('crit')!,
      y: laneY.get(type)!,
      width: nodeWidth,
      height: nodeHeight,
      title: `${damageTypeLabel(type, language)} ${l(language, 'crit expectation', '暴击期望')}`,
      value: expectedCrit == null ? '—' : `×${expectedCrit.toFixed(2)}`,
      detail: expectedCrit == null ? l(language, 'Crit data unavailable', '没有暴击数据') : `${formatPercent(data.critChance, language)} · ×${data.critMultiplier!.toFixed(2)}`,
      kind: 'damage',
      damageType: type,
      color: STAGE_COLORS.crit,
    })
    const effectiveMultiplier = data.effectiveMultipliers.find((entry) => entry.type === type)?.value
    addNode({
      id: nodeId('defence', type),
      stage: 'defence',
      x: stageX.get('defence')!,
      y: laneY.get(type)!,
      width: nodeWidth,
      height: nodeHeight,
      title: `${damageTypeLabel(type, language)} ${l(language, 'defence', '防御')}`,
      value: effectiveMultiplier == null ? '—' : `×${effectiveMultiplier.toFixed(2)}`,
      detail: effectiveMultiplier == null ? l(language, 'No separate filter exposed', '没有单独的防御倍率') : l(language, 'Effective damage factor', '有效伤害倍率'),
      kind: 'damage',
      damageType: type,
      color: STAGE_COLORS.defence,
    })
    const finalEntry = final
    addNode({
      id: nodeId('averageHit', type),
      stage: 'averageHit',
      x: stageX.get('averageHit')!,
      y: laneY.get(type)!,
      width: nodeWidth,
      height: nodeHeight,
      title: `${damageTypeLabel(type, language)} ${l(language, 'average hit', '平均命中')}`,
      value: finalEntry ? formatNumber(finalEntry.averageHit, language, 0) : '—',
      detail: finalEntry ? `${formatNumber(finalEntry.finalDps, language, 0)} DPS` : l(language, 'No final type result', '没有最终类型结果'),
      kind: 'damage',
      damageType: type,
      color: STAGE_COLORS.averageHit,
    })
    if (!active) continue
  }

  const sourceFlowIndex = new Map<string, number>()
  const flowX = stageX.get('flow')!
  for (const [index, flow] of flows.entries()) {
    const targetType = isDamageType(flow.to) ? flow.to : isDamageType(flow.from) ? flow.from : 'physical'
    const sourceType = isDamageType(flow.from) ? flow.from : null
    const targetCount = flowPerType.get(targetType) || 1
    const currentIndex = sourceFlowIndex.get(targetType) || 0
    sourceFlowIndex.set(targetType, currentIndex + 1)
    const y = laneY.get(targetType)! + (currentIndex - (targetCount - 1) / 2) * 30
    const isGain = flow.kind === 'gain'
    const flowId = `flow-${index}`
    addNode({
      id: flowId,
      stage: 'flow',
      x: flowX,
      y,
      width: flowWidth,
      height: 44,
      title: `${isGain ? l(language, 'Gain', '额外') : l(language, 'Convert', '转换')} ${damageTypeLabel(flow.from, language)} → ${damageTypeLabel(flow.to, language)}`,
      value: `${flow.value >= 0 ? '+' : ''}${formatPercent(flow.value, language)}`,
      detail: sourceLabel(flow.source),
      kind: 'flow',
      damageType: isDamageType(flow.to) ? flow.to : sourceType || undefined,
      color: isGain ? '#6fa987' : '#6f9fc0',
    })
    const sourceTypes: DamageType[] = flow.from === 'all'
      ? DAMAGE_TYPES.filter((type) => activeTypes.has(type))
      : flow.from === 'elemental'
        ? DAMAGE_TYPES.filter((type) => ['fire', 'cold', 'lightning'].includes(type) && activeTypes.has(type))
        : flow.from === 'nonChaos'
          ? DAMAGE_TYPES.filter((type) => type !== 'chaos' && activeTypes.has(type))
          : sourceType ? [sourceType] : []
    for (const fromType of sourceTypes) edges.push({ id: `${flowId}-from-${fromType}`, from: nodeId('base', fromType), to: flowId, label: `${damageTypeLabel(fromType, language)}`, color: TYPE_COLORS[fromType], dashed: true })
    if (isDamageType(flow.to)) edges.push({ id: `${flowId}-to-${flow.to}`, from: flowId, to: nodeId('increased', flow.to), label: `${flow.value >= 0 ? '+' : ''}${formatPercent(flow.value, language)}`, color: isGain ? '#6fa987' : '#6f9fc0' })
  }

  for (const type of DAMAGE_TYPES) {
    const relatedFlows = flows.some((flow) => flow.to === type || (flow.to === 'random' && flow.from === type))
    if (!relatedFlows) edges.push({ id: `base-${type}-increased`, from: nodeId('base', type), to: nodeId('increased', type), color: TYPE_COLORS[type] })
    edges.push({ id: `increased-${type}-more`, from: nodeId('increased', type), to: nodeId('more', type), color: STAGE_COLORS.increased })
    edges.push({ id: `more-${type}-crit`, from: nodeId('more', type), to: nodeId('crit', type), color: STAGE_COLORS.more })
    edges.push({ id: `crit-${type}-defence`, from: nodeId('crit', type), to: nodeId('defence', type), color: STAGE_COLORS.crit })
    edges.push({ id: `defence-${type}-averageHit`, from: nodeId('defence', type), to: nodeId('averageHit', type), color: STAGE_COLORS.defence })
  }

  const activeLaneY = DAMAGE_TYPES.filter((type) => activeTypes.has(type)).map((type) => laneY.get(type)!)
  const resultY = activeLaneY.length ? activeLaneY.reduce((sum, value) => sum + value, 0) / activeLaneY.length : laneTop + laneGap
  const rateY = resultY - nodeHeight / 2
  const finalY = resultY - nodeHeight / 2
  addNode({
    id: 'rate', stage: 'rate', x: stageX.get('rate')!, y: rateY, width: nodeWidth, height: nodeHeight,
    title: l(language, 'Hit × output rate', '命中 × 输出频率'),
    value: data.speed == null ? '—' : `${formatNumber(data.speed, language, 2)}/s`,
    detail: `${l(language, 'Hit chance', '命中率')} ${formatPercent(data.hitChance, language)}`,
    kind: 'result', color: STAGE_COLORS.rate,
  })
  addNode({
    id: 'final', stage: 'final', x: stageX.get('final')!, y: finalY, width: nodeWidth, height: nodeHeight,
    title: l(language, 'Final DPS', '最终 DPS'),
    value: formatNumber(data.totalDps, language, 0),
    detail: l(language, 'Merged damage types', '合并各伤害类型'),
    kind: 'result', color: STAGE_COLORS.final,
  })
  for (const type of DAMAGE_TYPES) {
    if (activeTypes.has(type)) edges.push({ id: `averageHit-${type}-rate`, from: nodeId('averageHit', type), to: 'rate', color: TYPE_COLORS[type] })
  }
  edges.push({ id: 'rate-final', from: 'rate', to: 'final', label: `${formatNumber(data.speed, language, 2)}/s`, color: STAGE_COLORS.rate })

  const lastLane = laneY.get('chaos')! + nodeHeight
  const flowBottom = flows.length ? laneTop + Math.max(0, flows.length - 1) * 30 + 80 : 0
  const height = Math.max(560, lastLane, flowBottom) + 92
  return {
    width: cursor + 34,
    height,
    stageHeaders: stageWidths.map((entry) => ({ x: stageX.get(entry.stage)!, width: entry.width, label: entry.label })),
    lanes: DAMAGE_TYPES.map((type) => ({ y: laneY.get(type)!, label: damageTypeLabel(type, language), color: TYPE_COLORS[type] })),
    nodes,
    edges,
  }
}

function textNode(value: string, x: number, y: number, size: number, color: string, weight: 'normal' | '600' | '700' = 'normal'): Text {
  const text = new Text({ text: value, style: { fontFamily: 'Segoe UI, Arial, sans-serif', fontSize: size, fill: color, fontWeight: weight } })
  text.position.set(x, y)
  return text
}

function drawArrow(graphics: Graphics, x: number, y: number, color: string): void {
  graphics.moveTo(x, y).lineTo(x - 8, y - 4).lineTo(x - 8, y + 4).closePath().fill({ color, alpha: 0.85 })
}

function drawEdge(graphics: Graphics, from: GraphNodeModel, to: GraphNodeModel, color: string, dashed = false): void {
  const startX = from.x + from.width
  const startY = from.y + from.height / 2
  const endX = to.x
  const endY = to.y + to.height / 2
  const bendX = startX + Math.max(16, (endX - startX) / 2)
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
}

function drawNode(model: GraphNodeModel, selected: boolean, onSelect: () => void): Container {
  const container = new Container()
  container.position.set(model.x, model.y)
  const background = new Graphics()
  background.roundRect(0, 0, model.width, model.height, 7).fill({ color: 0x111719, alpha: selected ? 0.98 : 0.92 }).stroke({ color: model.color, width: selected ? 2.2 : 1, alpha: selected ? 1 : 0.72 })
  background.rect(0, 0, 4, model.height).fill({ color: model.color, alpha: 0.95 })
  container.addChild(background)
  container.addChild(textNode(model.title, 15, 10, model.kind === 'flow' ? 11 : 10, '#d9cfb5', '600'))
  const value = textNode(model.value, 15, model.kind === 'flow' ? 25 : 27, model.kind === 'result' ? 21 : 17, model.color, '700')
  container.addChild(value)
  container.addChild(textNode(shortText(model.detail, model.kind === 'flow' ? 36 : 32), 15, model.height - 17, 8, '#857a68'))
  container.eventMode = 'static'
  container.cursor = 'pointer'
  container.on('pointertap', onSelect)
  return container
}

function applyCamera(world: Container, camera: { x: number; y: number; zoom: number }): void {
  world.position.set(camera.x, camera.y)
  world.scale.set(camera.zoom)
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
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const graph = useMemo(() => buildGraph(data, lang), [data, lang])
  graphRef.current = graph
  const selectedNode = graph.nodes.find((node) => node.id === selectedId) || null

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
    void app.init({ background: '#080b0d', antialias: true, autoDensity: true, resizeTo: host, preference: 'webgl' }).then(() => {
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
    background.rect(0, 0, model.width, model.height).fill({ color: 0x080b0d, alpha: 1 })
    for (const header of model.stageHeaders) {
      background.roundRect(header.x, 22, header.width, 34, 6).fill({ color: 0x171818, alpha: 0.9 }).stroke({ color: 0x3a3327, width: 1, alpha: 0.85 })
    }
    for (const lane of model.lanes) {
      background.roundRect(12, lane.y - 14, model.width - 24, 94, 8).fill({ color: 0x0e1315, alpha: 0.54 }).stroke({ color: Number.parseInt(lane.color.replace('#', ''), 16), width: 1, alpha: 0.12 })
      background.rect(12, lane.y - 14, 3, 94).fill({ color: Number.parseInt(lane.color.replace('#', ''), 16), alpha: 0.65 })
    }
    world.addChild(background)
    for (const header of model.stageHeaders) world.addChild(textNode(header.label, header.x + 13, 34, 10, '#a9956d', '600'))
    for (const lane of model.lanes) world.addChild(textNode(lane.label, 18, lane.y - 29, 9, lane.color, '600'))

    const nodes = new Map(model.nodes.map((node) => [node.id, node]))
    const edges = new Graphics()
    for (const edge of model.edges) {
      const from = nodes.get(edge.from)
      const to = nodes.get(edge.to)
      if (from && to) drawEdge(edges, from, to, edge.color, edge.dashed)
    }
    world.addChild(edges)
    for (const node of model.nodes) world.addChild(drawNode(node, node.id === selectedId, () => setSelectedId(node.id)))
    applyCamera(world, cameraRef.current)
  }, [graph, pixiReady, selectedId])

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const observer = new ResizeObserver(() => {
      const world = worldRef.current
      if (world) applyCamera(world, cameraRef.current)
    })
    observer.observe(host)
    return () => observer.disconnect()
  }, [])

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

  const detailTitle = selectedNode?.title || l(lang, 'Select a node', '选择一个节点')
  const detailLines = selectedNode ? [
    selectedNode.value,
    selectedNode.detail,
    selectedNode.damageType ? damageTypeLabel(selectedNode.damageType, lang) : '',
  ].filter(Boolean) : [l(lang, 'Click a node to inspect its value and stage.', '点击节点查看它的数值和所属阶段。')]

  return <div className="damage-flow-graph-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <section className="damage-flow-graph-modal" role="dialog" aria-modal="true" aria-labelledby="damage-flow-graph-title">
      <header className="damage-flow-graph-header">
        <div><span>{l(lang, 'Calculation detail', '计算明细')}</span><h2 id="damage-flow-graph-title">{l(lang, 'Damage calculation flow', '伤害计算流图')}</h2><small>{data.skillName}{skillLevel == null ? '' : ` · ${l(lang, 'Level', '等级')} ${skillLevel}`}</small></div>
        <button type="button" className="damage-flow-graph-close" onClick={onClose} aria-label={l(lang, 'Close', '关闭')} title={l(lang, 'Close', '关闭')}><X /></button>
      </header>
      <div className="damage-flow-graph-toolbar">
        <span>{l(lang, 'Each damage type is calculated independently before DPS is merged.', '各伤害类型先独立计算，最后再合并为 DPS。')}</span>
        <div>
          <button type="button" onClick={() => zoomAt(cameraRef.current.zoom * 0.85)} title={l(lang, 'Zoom out', '缩小')} aria-label={l(lang, 'Zoom out', '缩小')}><Minus /></button>
          <button type="button" onClick={() => zoomAt(cameraRef.current.zoom * 1.15)} title={l(lang, 'Zoom in', '放大')} aria-label={l(lang, 'Zoom in', '放大')}><Plus /></button>
          <button type="button" onClick={fitView} title={l(lang, 'Fit graph', '适应窗口')} aria-label={l(lang, 'Fit graph', '适应窗口')}><Maximize2 /></button>
          <button type="button" onClick={() => { const world = worldRef.current; if (!world) return; cameraRef.current = { x: 28, y: 28, zoom: 1 }; applyCamera(world, cameraRef.current) }} title={l(lang, 'Reset view', '重置视图')} aria-label={l(lang, 'Reset view', '重置视图')}><LocateFixed /></button>
        </div>
      </div>
      <div className="damage-flow-graph-body">
        <div ref={hostRef} className="damage-flow-graph-canvas" onWheel={handleWheel} onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={handlePointerUp} onPointerCancel={handlePointerUp} onPointerLeave={handlePointerUp} />
        <aside className="damage-flow-graph-inspector"><span>{l(lang, 'Selected node', '选中节点')}</span><strong>{detailTitle}</strong>{detailLines.map((line, index) => <p key={`${line}-${index}`}>{line}</p>)}</aside>
      </div>
    </section>
  </div>
}

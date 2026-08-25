import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import { Activity, AlertTriangle, BarChart3, ChevronDown, Clipboard, Download, ImageDown, LoaderCircle, Shield, Swords, TrendingUp } from 'lucide-react'
import { useTreeStore } from '@/store/treeStore'
import { useTranslation } from '@/i18n/useTranslation'
import { formatUiNumber, uiText } from '@/i18n/uiLocale'
import { getImportedCalculationMode } from '@/engine/calculationConfig'
import { parseSkillsXml } from '@/engine/skills'
import { translateCalculationText } from '@/i18n/calculationTranslations'
import { getLocalizedSkillDpsName, getLocalizedSkillName, loadSkillCatalog, resolveSkillCatalogEntry, type SkillCatalog } from '@/engine/skillCatalog'
import { ANALYSIS_DIMENSIONS, ATTRIBUTE_PROBE_CATALOG, METRIC_DEFINITIONS, PROBE_CATALOG_VERSION, getAnalysisSkillScope, getPowerStatValue, type AnalysisDimension, type AnalysisText, type MetricDefinition, type ProbeMetricDelta, type ProbeSeriesResult } from '@/engine/attributeAnalysis'
import { calculateAnalysisResult, calculateAnalysisScopeDetail, runInvestmentProbeBatch, type AnalysisSkillDetail } from '@/engine/investmentAnalysisService'
import type { CalcResult } from '@/types/calc'
import { DamageStructureReport, buildDamageStructureReportData } from '@/components/DamageStructureReport'

export type AnalysisPage = 'structure' | 'investment'

interface Props {
  page?: AnalysisPage
  onPageChange?: (page: AnalysisPage) => void
  onOpenSkills?: () => void
}
type LoadState = 'idle' | 'loading' | 'ready' | 'error'

function localText(value: AnalysisText, language: Parameters<typeof uiText>[0]): string {
  return uiText(language, value.en, value.zhCN, value.zhTW, value.koKR)
}

function formatMetric(value: number | null, metric: MetricDefinition, language: Parameters<typeof uiText>[0]): string {
  if (value == null || !Number.isFinite(value)) return '—'
  const shown = value * (metric.displayScale ?? 1)
  const suffix = metric.unit === 'percent' ? '%' : metric.unit === 'per-second' ? '/s' : ''
  return `${formatUiNumber(shown, language, { maximumFractionDigits: Math.abs(shown) >= 1000 ? 0 : 2 })}${suffix}`
}

function signedMetric(value: number | null, metric: MetricDefinition, language: Parameters<typeof uiText>[0]): string {
  if (value == null || !Number.isFinite(value)) return '—'
  return `${value >= 0 ? '+' : ''}${formatMetric(value, metric, language)}`
}

function firstDelta(series: ProbeSeriesResult): ProbeMetricDelta | null {
  return series.points[0]?.metrics[series.probe.primaryMetric] || null
}

function probePointLabel(probe: ProbeSeriesResult['probe'], point: number, language: Parameters<typeof uiText>[0]): string {
  return probe.pointUnit === 'level'
    ? `+${point}${uiText(language, ' level', '级', '級', ' 레벨')}`
    : probe.pointUnit === 'flat'
      ? `+${point} ${probe.primaryDimension === 'attack' ? uiText(language, 'flat damage', '点伤', '點傷', '플랫 피해') : uiText(language, 'value', '值', '值', '값')}`
      : `+${point}%`
}

function probeTestLabel(series: ProbeSeriesResult, language: Parameters<typeof uiText>[0]): string {
  return probePointLabel(series.probe, series.probe.points[0] ?? 1, language)
}

function probeSamplingLabel(series: ProbeSeriesResult, language: Parameters<typeof uiText>[0]): string {
  if (series.sampling?.mode !== 'amplified' || !series.sampling.samplePoint) return ''
  const sample = probePointLabel(series.probe, series.sampling.samplePoint, language)
  return uiText(language, `estimated from ${sample}`, `由 ${sample} 放大复算后折算`, `由 ${sample} 放大複算後折算`, `${sample} 확대 계산 후 환산`)
}

function usefulSeries(series: ProbeSeriesResult[]): ProbeSeriesResult[] {
  return series
    .filter((entry) => firstDelta(entry)?.absoluteDelta != null)
    .sort((left, right) => (firstDelta(right)?.relativeDelta ?? -Infinity) - (firstDelta(left)?.relativeDelta ?? -Infinity))
}

function probeScopeText(scope: 'shared' | 'attack' | 'spell', language: Parameters<typeof uiText>[0]): string {
  if (scope === 'attack') return uiText(language, 'Attacks only', '仅攻击技能', '僅攻擊技能', '공격만')
  if (scope === 'spell') return uiText(language, 'Spells only', '仅法术技能', '僅法術技能', '주문만')
  return uiText(language, 'Attacks + spells', '攻击与法术', '攻擊與法術', '공격 + 주문')
}

type ProbeFamilyKey = 'base' | 'base-defense' | 'increased' | 'extra' | 'critical' | 'skill-level' | 'skill-speed'

function probeFamilyKey(familyId: string): ProbeFamilyKey | null {
  if (familyId === 'base-damage') return 'base'
  if (familyId === 'base-defense') return 'base-defense'
  if (familyId === 'damage') return 'increased'
  if (familyId === 'damage-gain') return 'extra'
  if (familyId === 'critical') return 'critical'
  if (familyId === 'skill-level') return 'skill-level'
  if (familyId === 'speed') return 'skill-speed'
  return null
}

function probeFamilyLabel(key: ProbeFamilyKey, language: Parameters<typeof uiText>[0]): string {
  if (key === 'base') return uiText(language, 'Base damage', '基础点伤', '基礎點傷', '기초 피해')
  if (key === 'base-defense') return uiText(language, 'Base value', '基础值', '基礎值', '기본 값')
  if (key === 'increased') return uiText(language, 'Increased', '增加', '增加', '증가')
  if (key === 'extra') return uiText(language, 'Extra', '额外', '額外', '추가')
  if (key === 'critical') return uiText(language, 'Critical', '暴击', '暴擊', '치명타')
  if (key === 'skill-level') return uiText(language, 'Skill level', '技能等级', '技能等級', '스킬 레벨')
  return uiText(language, 'Skill speed', '技能速度', '技能速度', '스킬 속도')
}

function trackGainRowPointer(event: MouseEvent<HTMLTableRowElement>): void {
  const rect = event.currentTarget.getBoundingClientRect()
  event.currentTarget.style.setProperty('--row-pointer-x', `${event.clientX - rect.left}px`)
}

function resetGainRowPointer(event: MouseEvent<HTMLTableRowElement>): void {
  event.currentTarget.style.removeProperty('--row-pointer-x')
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

interface DpsComposition {
  skillCount: number
  attackCount: number
  spellCount: number
  topSkill: { name: string; share: number } | null
}

function GainTable({ dimension, series, baseline, language, dpsComposition, loading }: { dimension: AnalysisDimension; series: ProbeSeriesResult[]; baseline: CalcResult | null; language: Parameters<typeof uiText>[0]; dpsComposition?: DpsComposition | null; loading?: boolean }) {
  const metricKey = dimension === 'attack' && series.some((entry) => entry.probe.primaryMetric === 'AllDPS') && !series.some((entry) => entry.probe.primaryMetric === 'FullDPS') ? 'AllDPS' : dimension === 'attack' ? 'FullDPS' : 'TotalEHP'
  const metric = METRIC_DEFINITIONS.find((entry) => entry.key === metricKey)!
  const rows = usefulSeries(series)
  const isAttack = dimension === 'attack'
  const defenseDescription = uiText(language, 'Actual EHP change for each tested unit · EHP uses the current enemy setup', '按每项测试单位显示实际 EHP 变化 · EHP 按当前敌人配置估算可承受总伤害', '按每項測試單位顯示實際 EHP 變化 · EHP 按目前敵人配置估算可承受總傷害', '각 테스트 단위별 실제 EHP 변화 · EHP는 현재 적 설정으로 계산')
  const defenseMetricKeys = ['Armour', 'Evasion', 'EvadeChance', 'DeflectionRating', 'DeflectChance', 'DeflectEffect', 'BlockChance', 'SpellBlockChance', 'PhysicalDamageReduction', 'Ward'] as const
  return <div className="simple-gain-card">
    <header className="simple-gain-card-header">
      <div className="simple-gain-card-title"><span className={`simple-gain-icon ${dimension}`}>{isAttack ? <Swords /> : <Shield />}</span><div><h2>{uiText(language, isAttack ? 'Attack' : 'Defense', isAttack ? '攻击' : '防御', isAttack ? '攻擊' : '防禦', isAttack ? '공격' : '방어')}</h2><p>{isAttack ? uiText(language, 'Actual DPS change for each tested unit', '按每项测试单位显示实际 DPS 变化', '按每項測試單位顯示實際 DPS 變化', '각 테스트 단위별 실제 DPS 변화') : defenseDescription}</p></div></div>
      <div className="simple-gain-baseline"><span>{localText(metric.label, language)}</span><strong>{formatMetric(getPowerStatValue(baseline, metric.key), metric, language)}</strong></div>
    </header>
    {isAttack && dpsComposition && <div className="simple-gain-attack-metrics">
      <div><span>{uiText(language, 'DPS skills', 'DPS 技能', 'DPS 技能', 'DPS 스킬')}</span><strong>{dpsComposition.skillCount}</strong></div>
      <div><span>{uiText(language, 'Attack skills', '攻击技能', '攻擊技能', '공격 스킬')}</span><strong>{dpsComposition.attackCount}</strong></div>
      <div><span>{uiText(language, 'Spell skills', '法术技能', '法術技能', '주문 스킬')}</span><strong>{dpsComposition.spellCount}</strong></div>
      <div className="top-skill"><span>{uiText(language, 'Top contribution', '最高贡献', '最高貢獻', '최고 기여')}</span><strong title={dpsComposition.topSkill?.name || undefined}>{dpsComposition.topSkill ? `${dpsComposition.topSkill.name} ${dpsComposition.topSkill.share.toFixed(0)}%` : '—'}</strong></div>
    </div>}
    {!isAttack && <div className="simple-gain-defense-metrics">{defenseMetricKeys.map((key) => { const metricDefinition = METRIC_DEFINITIONS.find((entry) => entry.key === key)!; return <div key={key}><span>{localText(metricDefinition.label, language)}</span><strong>{formatMetric(getPowerStatValue(baseline, key), metricDefinition, language)}</strong></div> })}</div>}
    {loading ? <div className="simple-gain-empty loading"><LoaderCircle /><strong>{uiText(language, 'Calculating', '正在计算中', '正在計算中', '계산 중')}</strong><span>{uiText(language, 'Analysis results will appear when calculation is complete.', '计算完成后将显示分析结果。', '計算完成後將顯示分析結果。', '계산이 완료되면 분석 결과가 표시됩니다.')}</span></div> : rows.length ? <div className="simple-gain-table-wrap"><table className="simple-gain-table"><thead><tr><th>{uiText(language, 'Attribute', '属性', '屬性', '속성')}</th><th>{uiText(language, 'Test', '测试', '測試', '테스트')}</th><th>{uiText(language, 'Actual change', '实际变化', '實際變化', '실제 변화')}</th><th>{uiText(language, 'Relative', '相对收益', '相對收益', '상대 수익')}</th></tr></thead><tbody>{rows.map((entry) => { const delta = firstDelta(entry)!; const pointLabel = probePointLabel(entry.probe, entry.probe.points[0] ?? 1, language); const family = probeFamilyKey(entry.probe.familyId); return <tr key={entry.probe.id} className={family ? `probe-family-${family}` : undefined} onMouseMove={trackGainRowPointer} onMouseLeave={resetGainRowPointer}><td><strong>{localText(entry.probe.label, language)}</strong><small>{family && <span className="simple-gain-family"><i aria-hidden="true" />{probeFamilyLabel(family, language)}</span>}{family && ' · '}{probeScopeText(entry.probe.skillScope, language)} · {entry.probe.mutation.format(entry.probe.points[0])}{probeSamplingLabel(entry, language) ? ` · ${probeSamplingLabel(entry, language)}` : ''}</small></td><td>{pointLabel}</td><td className={delta.absoluteDelta! >= 0 ? 'positive' : 'negative'}>{signedMetric(delta.absoluteDelta, metric, language)}</td><td className={delta.relativeDelta != null && delta.relativeDelta >= 0 ? 'positive' : 'negative'}>{delta.relativeDelta == null ? '—' : `${delta.relativeDelta >= 0 ? '+' : ''}${delta.relativeDelta.toFixed(2)}%`}</td></tr> })}</tbody></table></div> : <div className="simple-gain-empty"><BarChart3 /><strong>{uiText(language, 'No calculable result', '暂无可计算结果', '暫無可計算結果', '계산 가능한 결과 없음')}</strong><span>{isAttack ? uiText(language, 'A working damage source is required.', '需要存在有效伤害来源。', '需要存在有效傷害來源。', '유효한 피해 원천이 필요합니다.') : uiText(language, 'No usable survival metric is available.', '当前没有可用的生存指标。', '目前沒有可用的生存指標。', '사용 가능한 생존 지표가 없습니다.')}</span></div>}
    <footer className="simple-gain-card-footer">{uiText(language, 'Only attributes with a calculable result are shown.', '只显示可以实际算出结果的属性。', '只顯示可以實際算出結果的屬性。', '계산 가능한 결과가 있는 속성만 표시합니다.')}</footer>
  </div>
}

export function AttributeAnalysisPage({ page = 'structure', onPageChange, onOpenSkills }: Props) {
  const { lang } = useTranslation()
  const l = (en: string, zhCN: string, zhTW = zhCN, koKR = en) => uiText(lang, en, zhCN, zhTW, koKR)
  const treeData = useTreeStore((state) => state.treeData)
  const revision = useTreeStore((state) => state.pobBuildRevision)
  const getCode = useTreeStore((state) => state.getActivePobCode)
  const getXml = useTreeStore((state) => state.getActivePobXml)
  const weaponSet = useTreeStore((state) => state.activeWeaponSet)
  const profiles = useTreeStore((state) => state.calculationProfiles)
  const activeProfileId = useTreeStore((state) => state.activeCalculationProfileId)
  const allocatedNodes = useTreeStore((state) => state.allocatedNodes)
  const [baseline, setBaseline] = useState<CalcResult | null>(null)
  const [structureBaseline, setStructureBaseline] = useState<CalcResult | null>(null)
  const [structureFinalDamageDps, setStructureFinalDamageDps] = useState<Record<string, number>>({})
  const [structureSkills, setStructureSkills] = useState<AnalysisSkillDetail[]>([])
  const [characterBaseline, setCharacterBaseline] = useState<CalcResult | null>(null)
  const [series, setSeries] = useState<ProbeSeriesResult[]>([])
  const [state, setState] = useState<LoadState>('idle')
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState({ completed: 0, total: 0 })
  const [displayCompleted, setDisplayCompleted] = useState(0)
  const [skillCatalog, setSkillCatalog] = useState<SkillCatalog | null>(null)
  const [selectedStructureActor, setSelectedStructureActor] = useState<string | null>(null)
  const [selectedStructureSkillId, setSelectedStructureSkillId] = useState<string | null>(null)
  const requestRef = useRef(0)
  const analysisExportRef = useRef<HTMLElement | null>(null)
  const exportMenuRef = useRef<HTMLDivElement | null>(null)
  const [exportMenuOpen, setExportMenuOpen] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [exportNotice, setExportNotice] = useState<string | null>(null)

  // Batched Lua probes report their real completion count when a batch
  // returns. Animate the indicator toward that count so the UI stays alive
  // between batch boundaries without changing the underlying result.
  useEffect(() => {
    const target = Math.max(0, progress.completed)
    if (!progress.total || Math.abs(target - displayCompleted) < 0.01) {
      if (displayCompleted !== target) setDisplayCompleted(target)
      return
    }

    let current = displayCompleted
    let frame = 0
    const tick = () => {
      const remaining = target - current
      if (Math.abs(remaining) < 0.05) {
        setDisplayCompleted(target)
        return
      }
      current += Math.sign(remaining) * Math.max(0.35, Math.abs(remaining) * 0.2)
      setDisplayCompleted(current)
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [progress.completed, progress.total])

  const code = useMemo(() => getCode() || '', [getCode, revision])
  const xml = useMemo(() => getXml() || '', [getXml, revision])
  const skills = useMemo(() => parseSkillsXml(xml), [xml])
  const fullDpsGroups = useMemo(() => skills.groups.filter((group) => group.enabled && group.includeInFullDps), [skills])
  const hasFullDpsSelection = fullDpsGroups.length > 0
  const localizeGemName = (gem: typeof skills.groups[number]['gems'][number]) => getLocalizedSkillName(gem, resolveSkillCatalogEntry(gem, skillCatalog), lang)
  const fullDpsNames = useMemo(() => [...new Set(fullDpsGroups.flatMap((group) => group.gems.filter((gem) => gem.enabled).filter((gem) => {
    const entry = resolveSkillCatalogEntry(gem, skillCatalog)
    return entry?.type !== 'support' && !gem.skillId.toLowerCase().startsWith('support')
  }).map(localizeGemName)))].filter(Boolean), [fullDpsGroups, lang, skillCatalog])
  const profile = profiles.find((entry) => entry.id === activeProfileId) || profiles[0]
  const overrides = profile?.values || {}
  const calcMode = useMemo(() => getImportedCalculationMode(xml), [xml])
  const analysisProbes = useMemo(() => ATTRIBUTE_PROBE_CATALOG.map((probe) => {
    if (probe.primaryDimension !== 'attack' || hasFullDpsSelection) return probe
    return { ...probe, primaryMetric: 'AllDPS', affectedMetrics: probe.affectedMetrics.map((key) => key === 'FullDPS' ? 'AllDPS' : key) }
  }), [hasFullDpsSelection])
  const seriesByDimension = useMemo(() => {
    const map = new Map<AnalysisDimension, ProbeSeriesResult[]>(ANALYSIS_DIMENSIONS.map((entry) => [entry.id, []]))
    for (const entry of series) map.get(entry.probe.primaryDimension)?.push(entry)
    return map
  }, [series])
  const analysisScope = useMemo(() => getAnalysisSkillScope(baseline, hasFullDpsSelection), [baseline, hasFullDpsSelection])
  const scopedDpsNames = useMemo(() => [...new Set(analysisScope.entries.map((entry) => {
    return getLocalizedSkillDpsName(entry, skillCatalog, lang)
  }))].filter(Boolean), [analysisScope.entries, lang, skillCatalog])
  const runtimeDpsNames = useMemo(() => [...new Set((baseline?.AllSkillDPS || []).filter((entry) => entry.dps > 0).map((entry) => {
    return getLocalizedSkillDpsName(entry, skillCatalog, lang)
  }))].filter(Boolean), [baseline, lang, skillCatalog])
  const damageSourceNames = scopedDpsNames.length ? scopedDpsNames : (fullDpsNames.length ? fullDpsNames : runtimeDpsNames)
  const dpsComposition = useMemo<DpsComposition | null>(() => {
    const entries = analysisScope.entries.filter((entry) => Number.isFinite(entry.dps) && entry.dps > 0)
    const contributionOf = (entry: typeof entries[number]) => entry.dps * Math.max(1, entry.count || 1)
    const total = entries.reduce((sum, entry) => sum + contributionOf(entry), 0)
    if (!entries.length || total <= 0) return null
    const top = [...entries].sort((left, right) => contributionOf(right) - contributionOf(left))[0]
    const topGroup = top.groupId ? skills.groups.find((group) => group.id === top.groupId) : undefined
    const fallbackGem = topGroup?.gems.find((gem) => {
      const entry = resolveSkillCatalogEntry(gem, skillCatalog)
      return entry?.type !== 'support' && !gem.skillId.toLowerCase().startsWith('support')
    }) || topGroup?.gems[0]
    const fallbackName = fallbackGem ? localizeGemName(fallbackGem) : ''
    return {
      skillCount: entries.length,
      attackCount: analysisScope.attack.length,
      spellCount: analysisScope.spell.length,
      topSkill: { name: getLocalizedSkillDpsName(top, skillCatalog, lang) || fallbackName || l('Triggered skill', '触发技能'), share: contributionOf(top) / total * 100 },
    }
  }, [analysisScope, lang, localizeGemName, l, skills.groups, skillCatalog])

  useEffect(() => {
    let mounted = true
    void loadSkillCatalog().then((catalog) => { if (mounted) setSkillCatalog(catalog) })
    return () => { mounted = false }
  }, [])

  useEffect(() => {
    if (!structureSkills.length) {
      setSelectedStructureActor(null)
      setSelectedStructureSkillId(null)
      return
    }
    const options = structureSkills.map((skill) => {
      const details = skill.detail.SkillDetails
      const actor = details?.actor || 'player'
      return { id: skill.id, actor: `${actor}:${details?.minionName || ''}` }
    })
    const actor = selectedStructureActor && options.some((option) => option.actor === selectedStructureActor)
      ? selectedStructureActor
      : options[0].actor
    if (actor !== selectedStructureActor) setSelectedStructureActor(actor)
    const actorOptions = options.filter((option) => option.actor === actor)
    if (!selectedStructureSkillId || !actorOptions.some((option) => option.id === selectedStructureSkillId)) {
      setSelectedStructureSkillId(actorOptions[0]?.id || null)
    }
  }, [selectedStructureActor, selectedStructureSkillId, structureSkills])

  useEffect(() => {
    if (!exportMenuOpen) return
    const onPointerDown = (event: PointerEvent) => {
      if (!exportMenuRef.current?.contains(event.target as Node)) setExportMenuOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setExportMenuOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [exportMenuOpen])

  const captureAnalysisImage = useCallback(async (): Promise<Blob> => {
    const root = analysisExportRef.current
    if (!root) throw new Error('Analysis report is not available')
    const bridge = window.pob2Desktop
    const originalRootStyle = {
      height: root.style.height,
      minHeight: root.style.minHeight,
      maxHeight: root.style.maxHeight,
      overflow: root.style.overflow,
      scrollTop: root.scrollTop,
    }
    const excluded = Array.from(root.querySelectorAll<HTMLElement>('[data-export-exclude="true"]'))
    const originalExcludedDisplay = excluded.map((element) => element.style.display)
    const captureAncestors: Array<{ element: HTMLElement; overflow: string }> = []
    for (let element = root.parentElement; element; element = element.parentElement) {
      captureAncestors.push({ element, overflow: element.style.overflow })
      element.style.overflow = 'visible'
    }
    root.style.height = 'auto'
    root.style.minHeight = '0'
    root.style.maxHeight = 'none'
    root.style.overflow = 'visible'
    root.scrollTop = 0
    excluded.forEach((element) => { element.style.display = 'none' })
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))

    try {
      const rect = root.getBoundingClientRect()
      const captureWidth = Math.max(1, Math.ceil(root.scrollWidth), Math.ceil(rect.width))
      const captureHeight = Math.max(1, Math.ceil(root.scrollHeight), Math.ceil(rect.height))

      // Electron can ask Chromium for a screenshot beyond the viewport. This
      // preserves the rendered page (including charts and CSS effects) and,
      // unlike capturePage(rect), does not stop at the visible viewport.
      if (bridge?.captureAnalysisImage) {
        try {
          const captured = await bridge.captureAnalysisImage({
            x: Math.max(0, Math.floor(rect.left)),
            y: Math.max(0, Math.floor(rect.top)),
            width: captureWidth,
            height: captureHeight,
            scale: 1,
          })
          const response = await fetch(captured.dataUrl)
          if (!response.ok) throw new Error(`Failed to read Chromium screenshot (${response.status})`)
          return await response.blob()
        } catch (reason) {
          console.warn('[Analysis] full-page Chromium screenshot failed, using DOM renderer', reason)
        }
      }

      // Browser/dev-server fallback. The clone is expanded before html2canvas
      // runs, so this remains a complete report rather than a viewport crop.
      const { default: html2canvas } = await import('html2canvas')
      const host = document.createElement('div')
      host.style.position = 'absolute'
      host.style.left = '-100000px'
      host.style.top = '0'
      host.style.width = `${captureWidth}px`
      host.style.height = 'auto'
      host.style.overflow = 'visible'
      host.style.pointerEvents = 'none'
      const clone = root.cloneNode(true) as HTMLElement
      clone.style.position = 'relative'
      clone.style.inset = 'auto'
      clone.style.width = `${captureWidth}px`
      clone.style.height = 'auto'
      clone.style.minHeight = '0'
      clone.style.maxHeight = 'none'
      clone.style.overflow = 'visible'
      clone.style.margin = '0'
      clone.querySelectorAll('[data-export-exclude="true"]').forEach((element) => element.remove())
      clone.querySelectorAll('.analysis-anchor-nav').forEach((element) => {
        const nav = element as HTMLElement
        nav.style.position = 'static'
        nav.style.top = 'auto'
      })
      host.appendChild(clone)
      document.body.appendChild(host)
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
      const cloneHeight = Math.max(1, clone.scrollHeight, Math.ceil(clone.getBoundingClientRect().height))
      const requestedScale = Math.min(2, Math.max(1, window.devicePixelRatio || 1))
      const scale = Math.max(.5, Math.min(
        requestedScale,
        Math.sqrt(24_000_000 / (captureWidth * cloneHeight)),
        16_384 / captureWidth,
        16_384 / cloneHeight,
      ))
      try {
        const canvas = await html2canvas(clone, {
          backgroundColor: '#0e1011',
          scale,
          useCORS: true,
          logging: false,
          imageTimeout: 15000,
        })
        return await new Promise<Blob>((resolve, reject) => {
          canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('Failed to encode full report image')), 'image/png')
        })
      } finally {
        host.remove()
      }
    } finally {
      root.style.height = originalRootStyle.height
      root.style.minHeight = originalRootStyle.minHeight
      root.style.maxHeight = originalRootStyle.maxHeight
      root.style.overflow = originalRootStyle.overflow
      root.scrollTop = originalRootStyle.scrollTop
      excluded.forEach((element, index) => { element.style.display = originalExcludedDisplay[index] || '' })
      captureAncestors.forEach(({ element, overflow }) => { element.style.overflow = overflow })
    }
  }, [])

  const handleAnalysisExport = useCallback(async (mode: 'save' | 'copy') => {
    setExportMenuOpen(false)
    setExportNotice(null)
    setExporting(true)
    try {
      const bridge = window.pob2Desktop
      const blob = await captureAnalysisImage()
      const dataUrl = await blobToDataUrl(blob)
      const fileName = `${page === 'structure' ? 'superpoe-damage-structure' : 'superpoe-build-gains'}-${new Date().toISOString().slice(0, 10)}.png`

      if (mode === 'save') {
        if (bridge?.saveAnalysisImage) {
          try {
            const result = await bridge.saveAnalysisImage({ dataUrl, fileName })
            if (!result.canceled) setExportNotice(l('Image saved', '图片已保存', '圖片已儲存', '이미지 저장됨'))
          } catch (reason) {
            console.warn('[Analysis] native image save failed, falling back to download', reason)
            downloadBlob(blob, fileName)
            setExportNotice(l('Image downloaded', '图片已下载', '圖片已下載', '이미지 다운로드됨'))
          }
        } else {
          downloadBlob(blob, fileName)
          setExportNotice(l('Image downloaded', '图片已下载', '圖片已下載', '이미지 다운로드됨'))
        }
      } else {
        if (bridge?.copyAnalysisImage) {
          try {
            await bridge.copyAnalysisImage(dataUrl)
          } catch (reason) {
            console.warn('[Analysis] native image clipboard failed, trying browser clipboard', reason)
            if (!(navigator.clipboard && typeof ClipboardItem !== 'undefined')) throw reason
            await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
          }
        } else if (navigator.clipboard && typeof ClipboardItem !== 'undefined') {
          await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
        } else {
          throw new Error('Image clipboard is unavailable')
        }
        setExportNotice(l('Image copied to clipboard', '图片已复制到剪贴板', '圖片已複製到剪貼簿', '이미지가 클립보드에 복사됨'))
      }
    } catch (reason) {
      console.error('[Analysis] image export failed', reason)
      setExportNotice(l('Image export failed', '图片导出失败', '圖片匯出失敗', '이미지 내보내기 실패'))
    } finally {
      setExporting(false)
    }
  }, [captureAnalysisImage, l, page])

  useEffect(() => {
    const requestId = ++requestRef.current
    setBaseline(null)
    setStructureBaseline(null)
    setStructureFinalDamageDps({})
    setStructureSkills([])
    setCharacterBaseline(null)
    setSeries([])
    setError(null)
    setProgress({ completed: 0, total: 0 })
    setDisplayCompleted(0)
    if (!code || !xml || !allocatedNodes.size) { setState('idle'); return }
    setState('loading')
    void calculateAnalysisResult(code, xml, weaponSet, calcMode, overrides).then(async (nextBaseline) => {
      // Structure and investment pages share the cached baseline, but only
      // the page that needs a calculation branch asks the runtime for it.
      const nextCharacterBaseline = page === 'investment'
        ? await calculateAnalysisResult(code, xml, weaponSet, undefined, overrides, { characterOnly: true })
        : null
      if (requestId !== requestRef.current) return
      setBaseline(nextBaseline)
      setCharacterBaseline(nextCharacterBaseline)
      if (page === 'structure') {
        // Resolve every selectable skill/shape independently. This page is
        // deliberately not coupled to the Full DPS investment probes.
        let nextStructureBaseline = nextBaseline
        let nextStructureFinalDamageDps: Record<string, number> = {}
        let nextStructureSkills: AnalysisSkillDetail[] = []
        try {
          const scopeDetail = await calculateAnalysisScopeDetail(code, xml, weaponSet, calcMode, overrides, nextBaseline, hasFullDpsSelection)
          nextStructureBaseline = scopeDetail.representative
          nextStructureFinalDamageDps = scopeDetail.finalDamageDps
          nextStructureSkills = scopeDetail.skills
        } catch {
          // A missing representative detail must not invalidate the report.
        }
        if (requestId !== requestRef.current) return
        setStructureBaseline(nextStructureBaseline)
        setStructureFinalDamageDps(nextStructureFinalDamageDps)
        setStructureSkills(nextStructureSkills)
        setSeries([])
        setState('ready')
        return
      }

      const results = await runInvestmentProbeBatch({ code, xml, weaponSet, calcMode, baseOverrides: overrides, baseline: nextBaseline, defenseBaseline: nextCharacterBaseline || nextBaseline, probes: analysisProbes, hasFullDpsSelection, isCurrent: () => requestId === requestRef.current, onProgress: (completed, total) => { if (requestId === requestRef.current) setProgress({ completed, total }) }, onPartialResults: (partial) => { if (requestId === requestRef.current) setSeries(partial) } })
      if (requestId !== requestRef.current) return
      setSeries(results)
      setState('ready')
    }).catch((reason: unknown) => {
      if (requestId !== requestRef.current) return
      setError(reason instanceof Error ? reason.message : String(reason))
      setState('error')
    })
    return () => { if (requestRef.current === requestId) requestRef.current += 1 }
  }, [activeProfileId, allocatedNodes.size, analysisProbes, calcMode, code, hasFullDpsSelection, overrides, page, revision, weaponSet, xml])

  const attackSeries = seriesByDimension.get('attack') || []
  const defenseSeries = seriesByDimension.get('defense') || []
  const fullDpsMetric = attackSeries.some((entry) => entry.probe.primaryMetric === 'AllDPS') && !attackSeries.some((entry) => entry.probe.primaryMetric === 'FullDPS') ? METRIC_DEFINITIONS.find((entry) => entry.key === 'AllDPS')! : METRIC_DEFINITIONS.find((entry) => entry.key === 'FullDPS')!
  const ehpMetric = METRIC_DEFINITIONS.find((entry) => entry.key === 'TotalEHP')!
  const attackRows = usefulSeries(attackSeries)
  const defenseRows = usefulSeries(defenseSeries)
  const damageMetricKey = hasFullDpsSelection ? 'FullDPS' : 'AllDPS'
  const scopeModeLabel = analysisScope.mode === 'full-dps' ? l('Full DPS total', '完整 DPS 总和') : analysisScope.mode === 'fallback' ? l('All actual DPS fallback', '所有实际 DPS（自动回退）') : l('No effective DPS skill', '没有有效 DPS 技能')
  const defenseDisplayBaseline = characterBaseline || baseline
  const damageStructureAggregateData = useMemo(() => buildDamageStructureReportData(structureBaseline, analysisScope, {
    totalDps: getPowerStatValue(baseline, damageMetricKey),
    finalDamageDps: structureFinalDamageDps,
  }), [analysisScope, baseline, damageMetricKey, structureBaseline, structureFinalDamageDps])
  const damageStructureSkills = useMemo(() => structureSkills.map((skill) => {
    const details = skill.detail.SkillDetails
    const activeSkill = details?.activeSkills.find((entry) => entry.index === details.activeSkillIndex) || details?.activeSkills[0]
    const activeStatSet = details?.statSets.find((entry) => entry.index === details.statSetIndex) || details?.statSets[0]
    const activeMinionSkill = details?.minionSkills?.find((entry) => entry.index === details.minionSkillIndex) || details?.minionSkills?.[0]
    const rawShapeName = skill.entry.skillPart || activeStatSet?.label || activeSkill?.skillPart || activeSkill?.label || skill.entry.name
    const shapeName = translateCalculationText(rawShapeName || l('Default form', '默认形态'), lang)
    const statSetName = activeStatSet?.label && activeStatSet.label !== skill.entry.skillPart
      ? translateCalculationText(activeStatSet.label, lang)
      : ''
    return {
      id: skill.id,
      name: getLocalizedSkillDpsName(skill.entry, skillCatalog, lang) || l('Triggered skill', '触发技能'),
      dps: skill.entry.dps,
      level: skill.detail.SkillLevel,
      actor: `${details?.actor || 'player'}:${details?.minionName || ''}`,
      entryGroupKey: `${skill.entry.groupId || skill.id}|${skill.entry.skillId || skill.entry.name}`,
      shapeName,
      statSetName,
      minionSkillName: activeMinionSkill?.label || '',
      data: buildDamageStructureReportData(skill.detail, undefined, {
        totalDps: skill.entry.dps,
        finalDamageDps: skill.finalDamageDps,
        calculationScope: 'selectedSkill',
        includedSkillCount: 1,
      }),
    }
  }).filter((entry): entry is typeof entry & { data: NonNullable<typeof entry.data> } => Boolean(entry.data)), [lang, skillCatalog, structureSkills])
  const actorChoices = useMemo(() => [...new Map(damageStructureSkills.map((skill) => [skill.actor, skill.actor.startsWith('minion:') ? (skill.actor.slice('minion:'.length) || l('Minion', '召唤物')) : l('Character', '角色')])).entries()], [damageStructureSkills, l])
  const actorSkills = useMemo(() => damageStructureSkills.filter((skill) => !selectedStructureActor || skill.actor === selectedStructureActor), [damageStructureSkills, selectedStructureActor])
  const skillChoices = useMemo(() => [...new Map(actorSkills.map((skill) => [skill.entryGroupKey, skill])).values()], [actorSkills])
  const selectedStructureSkill = damageStructureSkills.find((skill) => skill.id === selectedStructureSkillId) || actorSkills[0] || damageStructureSkills[0]
  const shapeChoices = useMemo(() => actorSkills.filter((skill) => skill.entryGroupKey === selectedStructureSkill?.entryGroupKey), [actorSkills, selectedStructureSkill?.entryGroupKey])
  const damageStructureData = selectedStructureSkill?.data || damageStructureAggregateData
  const structureReportReady = page === 'structure' ? Boolean(structureBaseline) : Boolean(baseline)

  if (!code || !xml || !allocatedNodes.size) return <section className="attribute-analysis-empty"><BarChart3 /><h1>{page === 'structure' ? l('Damage structure', '伤害结构') : l('Gain analysis', '收益分析')}</h1><p>{l('Open a build with an active passive tree to begin.', '打开包含有效天赋树的构筑后即可开始分析。')}</p></section>

  return <section ref={analysisExportRef} data-analysis-export-root="true" className="investment-analysis-workspace simple-gain-workspace">
    <header className="investment-analysis-header simple-gain-header">
      <div><span>{page === 'structure' ? l('One actor, one skill form, one calculation', '单个计算对象、技能与形态的独立计算') : l('Attribute investment impact on DPS and EHP', '属性投入对 DPS 与 EHP 的实际影响')}</span><h1>{page === 'structure' ? l('Damage structure', '伤害结构') : l('Gain analysis', '收益分析')}</h1></div>
      <div className="simple-gain-header-tools">
        <div className="simple-gain-export" ref={exportMenuRef} data-export-exclude="true"><button type="button" className="simple-gain-export-trigger" aria-haspopup="menu" aria-expanded={exportMenuOpen} disabled={exporting || state === 'loading'} onClick={() => setExportMenuOpen((open) => !open)} title={l('Export image', '导出图片', '匯出圖片', '이미지 내보내기')}><ImageDown /><span>{exporting ? l('Exporting', '正在导出', '正在匯出', '내보내는 중') : l('Export image', '导出图片', '匯出圖片', '이미지 내보내기')}</span><ChevronDown /></button>{exportMenuOpen && <div className="simple-gain-export-menu" role="menu"><button type="button" role="menuitem" onClick={() => void handleAnalysisExport('save')}><Download /><span><strong>{l('Save image', '保存图片', '儲存圖片', '이미지 저장')}</strong><small>{l('Save a PNG file', '保存 PNG 文件', '儲存 PNG 檔案', 'PNG 파일 저장')}</small></span></button><button type="button" role="menuitem" onClick={() => void handleAnalysisExport('copy')}><Clipboard /><span><strong>{l('Copy to clipboard', '复制到剪贴板', '複製到剪貼簿', '클립보드에 복사')}</strong><small>{l('Copy the report image', '复制报告图片', '複製報告圖片', '보고서 이미지 복사')}</small></span></button></div>}</div>
        {exportNotice && <span className="simple-gain-export-notice" data-export-exclude="true" role="status">{exportNotice}</span>}
      </div>
    </header>
    <nav className="analysis-page-nav analysis-anchor-nav" aria-label={l('Analysis pages', '分析页面')}>
      <button type="button" className={page === 'structure' ? 'active' : ''} aria-pressed={page === 'structure'} onClick={() => onPageChange?.('structure')}><BarChart3 />{l('Damage structure', '伤害结构')}</button>
      <button type="button" className={page === 'investment' ? 'active' : ''} aria-pressed={page === 'investment'} onClick={() => onPageChange?.('investment')}><TrendingUp />{l('Gain analysis', '收益分析')}</button>
      <div className={`investment-runtime analysis-anchor-runtime ${state}`}>{state === 'loading' ? <LoaderCircle className="spinning" /> : state === 'error' ? <AlertTriangle /> : <Activity className="simple-gain-runtime-ecg" />}<div><span>{state === 'loading' ? l('Calculating', '正在计算') : state === 'error' ? l('Calculation failed', '计算失败') : l('Report is current', '报告为最新')}</span><small>{state === 'loading' ? `${Math.round(displayCompleted)} / ${progress.total || '…'}` : page === 'structure' ? l('Selected skill scope', '当前技能范围') : `${calcMode} · ${PROBE_CATALOG_VERSION}`}</small></div></div>
    </nav>
    {state === 'loading' && !structureReportReady && <div className="simple-gain-loading-overlay" role="status" aria-live="polite">
      <div className="simple-gain-loading-panel">
        <LoaderCircle className="simple-gain-loading-icon" />
        <strong>{page === 'structure' ? l('Calculating damage structure', '正在计算伤害结构') : l('Calculating attribute gains', '正在计算属性收益')}</strong>
        <span>{progress.total ? `${Math.round(displayCompleted)} / ${progress.total}` : l('Preparing calculation…', '正在准备计算…')}</span>
        <div className="simple-gain-loading-progress" aria-hidden="true"><i style={{ width: `${progress.total ? Math.max(4, Math.min(100, displayCompleted / progress.total * 100)) : 8}%` }} /></div>
      </div>
    </div>}
    {error && <div className="attribute-analysis-error">{error}</div>}
    {page === 'structure' && <>
      <section className="damage-structure-selection" aria-label={l('Damage structure selection', '伤害结构选择')}>
        <div className="damage-structure-selection-heading"><div><span>{l('Calculation target', '计算对象')}</span><strong>{l('Choose the actor and exact skill form to inspect', '选择要查看的计算对象与具体技能形态')}</strong></div><small>{damageStructureSkills.length ? `${damageStructureSkills.length} ${l('calculated entries', '个可计算项')}` : l('No selectable skill', '没有可选择的技能')}</small></div>
        <label><span>{l('Actor', '计算对象')}</span><select value={selectedStructureActor || ''} onChange={(event) => { const nextActor = event.target.value; setSelectedStructureActor(nextActor); setSelectedStructureSkillId(damageStructureSkills.find((skill) => skill.actor === nextActor)?.id || null) }} disabled={!actorChoices.length}>{actorChoices.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label><span>{l('Skill', '技能')}</span><select value={selectedStructureSkill?.entryGroupKey || ''} onChange={(event) => setSelectedStructureSkillId(skillChoices.find((skill) => skill.entryGroupKey === event.target.value)?.id || null)} disabled={!skillChoices.length}>{skillChoices.map((skill) => <option key={skill.entryGroupKey} value={skill.entryGroupKey}>{skill.name}</option>)}</select></label>
        <label><span>{l('Skill form / stat set', '技能形态 / Stat Set')}</span><select value={selectedStructureSkill?.id || ''} onChange={(event) => setSelectedStructureSkillId(event.target.value)} disabled={!shapeChoices.length}>{shapeChoices.map((skill) => <option key={skill.id} value={skill.id}>{skill.shapeName}{skill.statSetName ? ` · ${skill.statSetName}` : ''}{skill.minionSkillName ? ` · ${skill.minionSkillName}` : ''}</option>)}</select></label>
        <div className="damage-structure-selection-status"><span>{selectedStructureSkill?.shapeName || l('No form selected', '未选择形态')}</span><strong>{selectedStructureSkill ? `${l('DPS', 'DPS')} ${formatUiNumber(selectedStructureSkill.dps, lang, { maximumFractionDigits: 0 })}` : '—'}</strong></div>
      </section>
      <DamageStructureReport data={damageStructureData} skillLevel={selectedStructureSkill?.level} treeData={treeData} skillCatalog={skillCatalog} />
    </>}
    {page === 'investment' && <>
    <div id="gain-summary" className="simple-gain-section-heading"><span className="simple-gain-section-heading-icon"><TrendingUp /></span><div><small>{l('Attribute investment', '属性投入')}</small><h2>{l('Gain calculation', '收益计算')}</h2></div></div>
    <section className="simple-gain-summary"><div className="gain-highlight attack-gain"><TrendingUp /><span>{l('Best attack gain', '攻击最高收益')}{attackRows[0] ? ` · ${l('Test', '测试')} ${probeTestLabel(attackRows[0], lang)}` : ''}</span><strong>{attackRows[0] ? `${localText(attackRows[0].probe.label, lang)} · DPS ${signedMetric(firstDelta(attackRows[0])?.absoluteDelta ?? null, fullDpsMetric, lang)}` : '—'}</strong></div><div className="gain-highlight defense-gain"><Shield /><span>{l('Best defense gain', '防御最高收益')}{defenseRows[0] ? ` · ${l('Test', '测试')} ${probeTestLabel(defenseRows[0], lang)}` : ''}</span><strong>{defenseRows[0] ? `${localText(defenseRows[0].probe.label, lang)} · EHP ${signedMetric(firstDelta(defenseRows[0])?.absoluteDelta ?? null, ehpMetric, lang)}` : '—'}</strong></div></section>
    <section className="simple-gain-note"><Activity /><div><strong>{l('How to read', '如何阅读')}</strong><span>{l('Each row reports the marginal DPS or EHP change for its displayed test step. If the change is too small to measure reliably, a larger internal sample is calculated and normalized back to that step.', '每一行按表格中的测试步长显示 DPS 或 EHP 边际变化；如果变化过小，会用更大步长在内部复算后折算回当前测试单位。')}</span></div></section>
    <section className="simple-gain-scope-note"><div className="simple-gain-scope-copy"><span className="simple-gain-scope-icon"><Activity /></span><div><strong>{l('Automatic analysis scope', '自动分析范围')} · {scopeModeLabel}</strong><p>{hasFullDpsSelection ? l(`All ${analysisScope.entries.length} effective skills included in Full DPS are aggregated. Multiple skills are not averaged.`, `完整 DPS 中的 ${analysisScope.entries.length} 个有效技能会全部计入总和，不会取平均值。`) : analysisScope.mode === 'fallback' ? l(`Full DPS has no configured skills, so all ${analysisScope.entries.length} positive actual DPS skills are used automatically.`, `当前未配置完整 DPS，已自动使用 ${analysisScope.entries.length} 个实际 DPS 大于 0 的技能。`) : l('No effective DPS skill is available, so attack gains cannot be calculated.', '当前没有有效 DPS 技能，暂时无法计算攻击收益。')} {l('Attack-only and spell-only attributes affect matching skills only; shared attributes can affect both. DoT, ailments, and trigger frequency are excluded in this version.', '攻击专属和法术专属属性只影响对应技能，共享属性可同时影响两者。本版本暂不纳入持续伤害、异常和触发频率。')}</p></div></div><div className="simple-gain-scope-counts"><span>{l('Skills', '技能')} <b>{analysisScope.entries.length}</b></span><span className="attack">{l('Attacks', '攻击')} <b>{analysisScope.attack.length}</b></span><span className="spell">{l('Spells', '法术')} <b>{analysisScope.spell.length}</b></span></div></section>
    <section className="investment-context-strip simple-gain-context"><div className="investment-full-dps"><span>{l('DPS skills', 'DPS 技能')}</span>{damageSourceNames.length ? <strong>{damageSourceNames.join(' + ')}</strong> : <><strong>{l('No effective damage source', '没有有效伤害来源')}</strong>{onOpenSkills && <button type="button" onClick={onOpenSkills}>{l('Manage skills', '管理技能')}</button>}</>}</div>{([damageMetricKey, 'TotalEHP', 'Life', 'EnergyShield', 'Armour', 'Evasion', 'DeflectionRating', 'FireResist', 'ColdResist', 'LightningResist', 'ChaosResist'] as const).map((key) => { const metric = METRIC_DEFINITIONS.find((entry) => entry.key === key)!; const source = key === damageMetricKey ? baseline : defenseDisplayBaseline; return <div key={key}><span>{localText(metric.label, lang)}</span><strong>{formatMetric(getPowerStatValue(source, key), metric, lang)}</strong></div> })}</section>
    <section id="attribute-gains" className="simple-gain-grid"><div id="attack-gains"><GainTable dimension="attack" series={attackSeries} baseline={baseline} language={lang} dpsComposition={dpsComposition} loading={state === 'loading' && !attackSeries.length} /></div><div id="defense-gains"><GainTable dimension="defense" series={defenseSeries} baseline={defenseDisplayBaseline} language={lang} loading={state === 'loading' && !defenseSeries.length} /></div></section>
    </>}
  </section>
}

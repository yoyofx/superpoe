import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import { Activity, AlertTriangle, BarChart3, ChevronDown, Clipboard, Download, ImageDown, LoaderCircle, Shield, Swords, TrendingUp } from 'lucide-react'
import { useTreeStore } from '@/store/treeStore'
import { useTranslation } from '@/i18n/useTranslation'
import { formatUiNumber, uiText } from '@/i18n/uiLocale'
import { getImportedCalculationMode } from '@/engine/calculationConfig'
import { parseSkillsXml } from '@/engine/skills'
import { getLocalizedSkillName, loadSkillCatalog, resolveSkillCatalogEntry, type SkillCatalog } from '@/engine/skillCatalog'
import { ANALYSIS_DIMENSIONS, ATTRIBUTE_PROBE_CATALOG, METRIC_DEFINITIONS, PROBE_CATALOG_VERSION, getAnalysisSkillScope, getPowerStatValue, type AnalysisDimension, type AnalysisText, type MetricDefinition, type ProbeMetricDelta, type ProbeSeriesResult } from '@/engine/attributeAnalysis'
import { calculateAnalysisResult, calculateAnalysisScopeDetail, runInvestmentProbeBatch } from '@/engine/investmentAnalysisService'
import type { CalcResult } from '@/types/calc'
import { DamageStructureReport, buildDamageStructureReportData } from '@/components/DamageStructureReport'

interface Props { onOpenSkills?: () => void }
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

function probeTestLabel(series: ProbeSeriesResult, language: Parameters<typeof uiText>[0]): string {
  const point = series.probe.points[0] ?? 1
  return series.probe.pointUnit === 'level'
    ? `+${point}${uiText(language, ' level', '级', '級', ' 레벨')}`
    : `+${point}%`
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

function GainTable({ dimension, series, baseline, language, dpsComposition }: { dimension: AnalysisDimension; series: ProbeSeriesResult[]; baseline: CalcResult | null; language: Parameters<typeof uiText>[0]; dpsComposition?: DpsComposition | null }) {
  const metricKey = dimension === 'attack' && series.some((entry) => entry.probe.primaryMetric === 'AllDPS') && !series.some((entry) => entry.probe.primaryMetric === 'FullDPS') ? 'AllDPS' : dimension === 'attack' ? 'FullDPS' : 'TotalEHP'
  const metric = METRIC_DEFINITIONS.find((entry) => entry.key === metricKey)!
  const rows = usefulSeries(series)
  const isAttack = dimension === 'attack'
  const defenseDescription = uiText(language, 'Actual EHP change after adding 1% · EHP uses the current enemy setup', '增加 1% 后的实际 EHP 变化 · EHP 按当前敌人配置估算可承受总伤害', '增加 1% 後的實際 EHP 變化 · EHP 按目前敵人配置估算可承受總傷害', '1% 추가 후 실제 EHP 변화 · EHP는 현재 적 설정으로 계산')
  const defenseMetricKeys = ['Armour', 'Evasion', 'EvadeChance', 'DeflectionRating', 'DeflectChance', 'DeflectEffect', 'BlockChance', 'SpellBlockChance', 'PhysicalDamageReduction', 'Ward'] as const
  return <div className="simple-gain-card">
    <header className="simple-gain-card-header">
      <div className="simple-gain-card-title"><span className={`simple-gain-icon ${dimension}`}>{isAttack ? <Swords /> : <Shield />}</span><div><h2>{uiText(language, isAttack ? 'Attack' : 'Defense', isAttack ? '攻击' : '防御', isAttack ? '攻擊' : '防禦', isAttack ? '공격' : '방어')}</h2><p>{isAttack ? uiText(language, 'Actual DPS change after adding 1%', '增加 1% 后的实际 DPS 变化', '增加 1% 後的實際 DPS 變化', '1% 추가 후 실제 DPS 변화') : defenseDescription}</p></div></div>
      <div className="simple-gain-baseline"><span>{localText(metric.label, language)}</span><strong>{formatMetric(getPowerStatValue(baseline, metric.key), metric, language)}</strong></div>
    </header>
    {isAttack && dpsComposition && <div className="simple-gain-attack-metrics">
      <div><span>{uiText(language, 'DPS skills', 'DPS 技能', 'DPS 技能', 'DPS 스킬')}</span><strong>{dpsComposition.skillCount}</strong></div>
      <div><span>{uiText(language, 'Attack skills', '攻击技能', '攻擊技能', '공격 스킬')}</span><strong>{dpsComposition.attackCount}</strong></div>
      <div><span>{uiText(language, 'Spell skills', '法术技能', '法術技能', '주문 스킬')}</span><strong>{dpsComposition.spellCount}</strong></div>
      <div className="top-skill"><span>{uiText(language, 'Top contribution', '最高贡献', '最高貢獻', '최고 기여')}</span><strong title={dpsComposition.topSkill?.name || undefined}>{dpsComposition.topSkill ? `${dpsComposition.topSkill.name} ${dpsComposition.topSkill.share.toFixed(0)}%` : '—'}</strong></div>
    </div>}
    {!isAttack && <div className="simple-gain-defense-metrics">{defenseMetricKeys.map((key) => { const metricDefinition = METRIC_DEFINITIONS.find((entry) => entry.key === key)!; return <div key={key}><span>{localText(metricDefinition.label, language)}</span><strong>{formatMetric(getPowerStatValue(baseline, key), metricDefinition, language)}</strong></div> })}</div>}
    {rows.length ? <div className="simple-gain-table-wrap"><table className="simple-gain-table"><thead><tr><th>{uiText(language, 'Attribute', '属性', '屬性', '속성')}</th><th>{uiText(language, 'Test', '测试', '測試', '테스트')}</th><th>{uiText(language, 'Actual change', '实际变化', '實際變化', '실제 변화')}</th><th>{uiText(language, 'Relative', '相对收益', '相對收益', '상대 수익')}</th></tr></thead><tbody>{rows.map((entry) => { const delta = firstDelta(entry)!; const pointLabel = entry.probe.pointUnit === 'level' ? `+${entry.probe.points[0]} ${uiText(language, 'level', '级', '級', '레벨')}` : `+${entry.probe.points[0]}%`; return <tr key={entry.probe.id} onMouseMove={trackGainRowPointer} onMouseLeave={resetGainRowPointer}><td><strong>{localText(entry.probe.label, language)}</strong><small>{probeScopeText(entry.probe.skillScope, language)} · {entry.probe.mutation.format(entry.probe.points[0])}</small></td><td>{pointLabel}</td><td className={delta.absoluteDelta! >= 0 ? 'positive' : 'negative'}>{signedMetric(delta.absoluteDelta, metric, language)}</td><td className={delta.relativeDelta != null && delta.relativeDelta >= 0 ? 'positive' : 'negative'}>{delta.relativeDelta == null ? '—' : `${delta.relativeDelta >= 0 ? '+' : ''}${delta.relativeDelta.toFixed(2)}%`}</td></tr> })}</tbody></table></div> : <div className="simple-gain-empty"><BarChart3 /><strong>{uiText(language, 'No calculable result', '暂无可计算结果', '暫無可計算結果', '계산 가능한 결과 없음')}</strong><span>{isAttack ? uiText(language, 'A working damage source is required.', '需要存在有效伤害来源。', '需要存在有效傷害來源。', '유효한 피해 원천이 필요합니다.') : uiText(language, 'The PoB result has no usable survival metric.', '当前 PoB 没有可用的生存指标。', '目前 PoB 沒有可用的生存指標。', '현재 PoB에 사용할 생존 지표가 없습니다.')}</span></div>}
    <footer className="simple-gain-card-footer">{uiText(language, 'Only attributes with a real PoB result are shown.', '只显示 PoB 能实际算出结果的属性。', '只顯示 PoB 能實際算出結果的屬性。', 'PoB가 실제로 계산한 속성만 표시합니다.')}</footer>
  </div>
}

export function AttributeAnalysisPage({ onOpenSkills }: Props) {
  const { lang } = useTranslation()
  const l = (en: string, zhCN: string, zhTW = zhCN, koKR = en) => uiText(lang, en, zhCN, zhTW, koKR)
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
  const [characterBaseline, setCharacterBaseline] = useState<CalcResult | null>(null)
  const [series, setSeries] = useState<ProbeSeriesResult[]>([])
  const [state, setState] = useState<LoadState>('idle')
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState({ completed: 0, total: 0 })
  const [skillCatalog, setSkillCatalog] = useState<SkillCatalog | null>(null)
  const requestRef = useRef(0)
  const analysisExportRef = useRef<HTMLElement | null>(null)
  const exportMenuRef = useRef<HTMLDivElement | null>(null)
  const [exportMenuOpen, setExportMenuOpen] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [exportNotice, setExportNotice] = useState<string | null>(null)
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
    const gem = { name: entry.name, skillId: entry.skillId || '', gemId: entry.skillId || '', variantId: '' }
    return getLocalizedSkillName(gem, resolveSkillCatalogEntry(gem, skillCatalog), lang)
  }))].filter(Boolean), [analysisScope.entries, lang, skillCatalog])
  const runtimeDpsNames = useMemo(() => [...new Set((baseline?.AllSkillDPS || []).filter((entry) => entry.dps > 0).map((entry) => {
    const gem = { name: entry.name, skillId: entry.skillId || '', gemId: entry.skillId || '', variantId: '' }
    return getLocalizedSkillName(gem, resolveSkillCatalogEntry(gem, skillCatalog), lang)
  }))].filter(Boolean), [baseline, lang, skillCatalog])
  const damageSourceNames = scopedDpsNames.length ? scopedDpsNames : (fullDpsNames.length ? fullDpsNames : runtimeDpsNames)
  const dpsComposition = useMemo<DpsComposition | null>(() => {
    const entries = analysisScope.entries.filter((entry) => Number.isFinite(entry.dps) && entry.dps > 0)
    const total = entries.reduce((sum, entry) => sum + entry.dps, 0)
    if (!entries.length || total <= 0) return null
    const top = [...entries].sort((left, right) => right.dps - left.dps)[0]
    const gem = { name: top.name, skillId: top.skillId || '', gemId: top.skillId || '', variantId: '' }
    return {
      skillCount: entries.length,
      attackCount: analysisScope.attack.length,
      spellCount: analysisScope.spell.length,
      topSkill: { name: getLocalizedSkillName(gem, resolveSkillCatalogEntry(gem, skillCatalog), lang), share: top.dps / total * 100 },
    }
  }, [analysisScope, lang, skillCatalog])

  useEffect(() => {
    let mounted = true
    void loadSkillCatalog().then((catalog) => { if (mounted) setSkillCatalog(catalog) })
    return () => { mounted = false }
  }, [])

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
      const fileName = `superpoe-build-gains-${new Date().toISOString().slice(0, 10)}.png`

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
  }, [captureAnalysisImage, l])

  useEffect(() => {
    const requestId = ++requestRef.current
    setBaseline(null)
    setStructureBaseline(null)
    setStructureFinalDamageDps({})
    setCharacterBaseline(null)
    setSeries([])
    setError(null)
    if (!code || !xml || !allocatedNodes.size) { setState('idle'); return }
    setState('loading')
    void calculateAnalysisResult(code, xml, weaponSet, calcMode, overrides).then(async (nextBaseline) => {
      // Defence values must use the same character-only MAIN output as the
      // equipment panel. Keep the full CALCS result for DPS analysis.
      const nextCharacterBaseline = await calculateAnalysisResult(code, xml, weaponSet, undefined, overrides, { characterOnly: true })
      if (requestId !== requestRef.current) return
      setBaseline(nextBaseline)
      setCharacterBaseline(nextCharacterBaseline)
      // The report is on the same page as the gain analysis, so resolve its
      // representative skill from the exact same Full DPS/fallback scope.
      let nextStructureBaseline = nextBaseline
      let nextStructureFinalDamageDps: Record<string, number> = {}
      try {
        const scopeDetail = await calculateAnalysisScopeDetail(code, xml, weaponSet, calcMode, overrides, nextBaseline, hasFullDpsSelection)
        nextStructureBaseline = scopeDetail.representative
        nextStructureFinalDamageDps = scopeDetail.finalDamageDps
      } catch {
        // A missing representative detail must not invalidate the complete
        // attribute report; the baseline remains a useful PoB result.
      }
      if (requestId !== requestRef.current) return
      setStructureBaseline(nextStructureBaseline)
      setStructureFinalDamageDps(nextStructureFinalDamageDps)
      const results = await runInvestmentProbeBatch({ code, xml, weaponSet, calcMode, baseOverrides: overrides, baseline: nextBaseline, defenseBaseline: nextCharacterBaseline, probes: analysisProbes, hasFullDpsSelection, isCurrent: () => requestId === requestRef.current, onProgress: (completed, total) => { if (requestId === requestRef.current) setProgress({ completed, total }) } })
      if (requestId !== requestRef.current) return
      setSeries(results)
      setState('ready')
    }).catch((reason: unknown) => {
      if (requestId !== requestRef.current) return
      setError(reason instanceof Error ? reason.message : String(reason))
      setState('error')
    })
    return () => { if (requestRef.current === requestId) requestRef.current += 1 }
  }, [activeProfileId, allocatedNodes.size, analysisProbes, calcMode, code, hasFullDpsSelection, overrides, revision, weaponSet, xml])

  if (!code || !xml || !allocatedNodes.size) return <section className="attribute-analysis-empty"><BarChart3 /><h1>{l('Build gains analysis', '构筑收益分析')}</h1><p>{l('Open a build with an active passive tree to begin.', '打开包含有效天赋树的构筑后即可开始分析。')}</p></section>

  const attackSeries = seriesByDimension.get('attack') || []
  const defenseSeries = seriesByDimension.get('defense') || []
  const fullDpsMetric = attackSeries.some((entry) => entry.probe.primaryMetric === 'AllDPS') && !attackSeries.some((entry) => entry.probe.primaryMetric === 'FullDPS') ? METRIC_DEFINITIONS.find((entry) => entry.key === 'AllDPS')! : METRIC_DEFINITIONS.find((entry) => entry.key === 'FullDPS')!
  const ehpMetric = METRIC_DEFINITIONS.find((entry) => entry.key === 'TotalEHP')!
  const attackRows = usefulSeries(attackSeries)
  const defenseRows = usefulSeries(defenseSeries)
  const damageMetricKey = hasFullDpsSelection ? 'FullDPS' : 'AllDPS'
  const scopeModeLabel = analysisScope.mode === 'full-dps' ? l('Full DPS total', '完整 DPS 总和') : analysisScope.mode === 'fallback' ? l('All actual DPS fallback', '所有实际 DPS（自动回退）') : l('No effective DPS skill', '没有有效 DPS 技能')
  const defenseDisplayBaseline = characterBaseline || baseline
  const damageStructureData = useMemo(() => buildDamageStructureReportData(structureBaseline, analysisScope, {
    totalDps: getPowerStatValue(baseline, damageMetricKey),
    finalDamageDps: structureFinalDamageDps,
  }), [analysisScope, baseline, damageMetricKey, structureBaseline, structureFinalDamageDps])

  return <section ref={analysisExportRef} data-analysis-export-root="true" className="investment-analysis-workspace simple-gain-workspace">
    <header className="investment-analysis-header simple-gain-header"><div><span>{l('Attribute investment impact on DPS and EHP', '属性投入对 DPS 与 EHP 的实际影响')}</span><h1>{l('Build gains analysis', '构筑收益分析')}</h1></div><div className="simple-gain-header-tools"><div className="simple-gain-export" ref={exportMenuRef} data-export-exclude="true"><button type="button" className="simple-gain-export-trigger" aria-haspopup="menu" aria-expanded={exportMenuOpen} disabled={exporting || state === 'loading'} onClick={() => setExportMenuOpen((open) => !open)} title={l('Export image', '导出图片', '匯出圖片', '이미지 내보내기')}><ImageDown /><span>{exporting ? l('Exporting', '正在导出', '正在匯出', '내보내는 중') : l('Export image', '导出图片', '匯出圖片', '이미지 내보내기')}</span><ChevronDown /></button>{exportMenuOpen && <div className="simple-gain-export-menu" role="menu"><button type="button" role="menuitem" onClick={() => void handleAnalysisExport('save')}><Download /><span><strong>{l('Save image', '保存图片', '儲存圖片', '이미지 저장')}</strong><small>{l('Save a PNG file', '保存 PNG 文件', '儲存 PNG 檔案', 'PNG 파일 저장')}</small></span></button><button type="button" role="menuitem" onClick={() => void handleAnalysisExport('copy')}><Clipboard /><span><strong>{l('Copy to clipboard', '复制到剪贴板', '複製到剪貼簿', '클립보드에 복사')}</strong><small>{l('Copy the report image', '复制报告图片', '複製報告圖片', '보고서 이미지 복사')}</small></span></button></div>}</div><div className={`investment-runtime ${state}`}>{state === 'loading' ? <LoaderCircle className="spinning" /> : state === 'error' ? <AlertTriangle /> : <Activity className="simple-gain-runtime-ecg" />}<div><span>{state === 'loading' ? l('Calculating', '正在计算') : state === 'error' ? l('Calculation failed', '计算失败') : l('Report is current', '报告为最新')}</span><small>{state === 'loading' ? `${progress.completed} / ${progress.total}` : `${calcMode} · ${PROBE_CATALOG_VERSION}`}</small></div></div>{exportNotice && <span className="simple-gain-export-notice" data-export-exclude="true" role="status">{exportNotice}</span>}</div></header>
    {state === 'loading' && !baseline && <div className="simple-gain-loading-overlay" role="status" aria-live="polite">
      <div className="simple-gain-loading-panel">
        <LoaderCircle className="simple-gain-loading-icon" />
        <strong>{l('Calculating attribute gains', '正在计算属性收益')}</strong>
        <span>{progress.total ? `${progress.completed} / ${progress.total}` : l('Preparing calculation…', '正在准备计算…')}</span>
        <div className="simple-gain-loading-progress" aria-hidden="true"><i style={{ width: `${progress.total ? Math.max(4, Math.min(100, progress.completed / progress.total * 100)) : 8}%` }} /></div>
      </div>
    </div>}
    {error && <div className="attribute-analysis-error">{error}</div>}
    <nav className="analysis-anchor-nav" aria-label={l('Analysis sections', '分析区域')}>
      <a href="#damage-structure">{l('Damage structure', '伤害结构')}</a>
      <a href="#attribute-gains">{l('Attribute gains', '属性收益')}</a>
      <a href="#attack-gains">{l('Attack gains', '攻击收益')}</a>
      <a href="#defense-gains">{l('Defense gains', '防御收益')}</a>
    </nav>
    <DamageStructureReport data={damageStructureData} />
    <section className="simple-gain-summary"><div className="gain-highlight attack-gain"><TrendingUp /><span>{l('Best attack gain', '攻击最高收益')}{attackRows[0] ? ` · ${l('Test', '测试')} ${probeTestLabel(attackRows[0], lang)}` : ''}</span><strong>{attackRows[0] ? `${localText(attackRows[0].probe.label, lang)} · DPS ${signedMetric(firstDelta(attackRows[0])?.absoluteDelta ?? null, fullDpsMetric, lang)}` : '—'}</strong></div><div className="gain-highlight defense-gain"><Shield /><span>{l('Best defense gain', '防御最高收益')}{defenseRows[0] ? ` · ${l('Test', '测试')} ${probeTestLabel(defenseRows[0], lang)}` : ''}</span><strong>{defenseRows[0] ? `${localText(defenseRows[0].probe.label, lang)} · EHP ${signedMetric(firstDelta(defenseRows[0])?.absoluteDelta ?? null, ehpMetric, lang)}` : '—'}</strong></div></section>
    <section className="simple-gain-note"><Activity /><div><strong>{l('How to read', '如何阅读')}</strong><span>{l('Each row simulates adding 1% of the attribute and shows the real DPS or EHP change. Skill level uses +1 level.', '每一行模拟增加 1% 的该属性，并显示实际带来的 DPS 或 EHP 变化；技能等级按增加 1 级计算。')}</span></div></section>
    <section className="simple-gain-scope-note"><div className="simple-gain-scope-copy"><span className="simple-gain-scope-icon"><Activity /></span><div><strong>{l('Automatic analysis scope', '自动分析范围')} · {scopeModeLabel}</strong><p>{hasFullDpsSelection ? l(`All ${analysisScope.entries.length} effective skills included in Full DPS are aggregated. Multiple skills are not averaged.`, `完整 DPS 中的 ${analysisScope.entries.length} 个有效技能会全部计入总和，不会取平均值。`) : analysisScope.mode === 'fallback' ? l(`Full DPS has no configured skills, so all ${analysisScope.entries.length} positive actual DPS skills are used automatically.`, `当前未配置完整 DPS，已自动使用 ${analysisScope.entries.length} 个实际 DPS 大于 0 的技能。`) : l('No effective DPS skill is available, so attack gains cannot be calculated.', '当前没有有效 DPS 技能，暂时无法计算攻击收益。')} {l('Attack-only and spell-only attributes affect matching skills only; shared attributes can affect both. DoT, ailments, and trigger frequency are excluded in this version.', '攻击专属和法术专属属性只影响对应技能，共享属性可同时影响两者。本版本暂不纳入持续伤害、异常和触发频率。')}</p></div></div><div className="simple-gain-scope-counts"><span>{l('Skills', '技能')} <b>{analysisScope.entries.length}</b></span><span className="attack">{l('Attacks', '攻击')} <b>{analysisScope.attack.length}</b></span><span className="spell">{l('Spells', '法术')} <b>{analysisScope.spell.length}</b></span></div></section>
    <section className="investment-context-strip simple-gain-context"><div className="investment-full-dps"><span>{l('DPS skills', 'DPS 技能')}</span>{damageSourceNames.length ? <strong>{damageSourceNames.join(' + ')}</strong> : <><strong>{l('No effective damage source', '没有有效伤害来源')}</strong>{onOpenSkills && <button type="button" onClick={onOpenSkills}>{l('Manage skills', '管理技能')}</button>}</>}</div>{([damageMetricKey, 'TotalEHP', 'Life', 'EnergyShield', 'Armour', 'Evasion', 'DeflectionRating', 'FireResist', 'ColdResist', 'LightningResist', 'ChaosResist'] as const).map((key) => { const metric = METRIC_DEFINITIONS.find((entry) => entry.key === key)!; const source = key === damageMetricKey ? baseline : defenseDisplayBaseline; return <div key={key}><span>{localText(metric.label, lang)}</span><strong>{formatMetric(getPowerStatValue(source, key), metric, lang)}</strong></div> })}</section>
    <section id="attribute-gains" className="simple-gain-grid"><div id="attack-gains"><GainTable dimension="attack" series={attackSeries} baseline={baseline} language={lang} dpsComposition={dpsComposition} /></div><div id="defense-gains"><GainTable dimension="defense" series={defenseSeries} baseline={defenseDisplayBaseline} language={lang} /></div></section>
  </section>
}

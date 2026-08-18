import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import { Activity, AlertTriangle, BarChart3, LoaderCircle, Shield, Swords, TrendingUp } from 'lucide-react'
import { useTreeStore } from '@/store/treeStore'
import { useTranslation } from '@/i18n/useTranslation'
import { formatUiNumber, uiText } from '@/i18n/uiLocale'
import { getImportedCalculationMode } from '@/engine/calculationConfig'
import { parseSkillsXml } from '@/engine/skills'
import { getLocalizedSkillName, loadSkillCatalog, resolveSkillCatalogEntry, type SkillCatalog } from '@/engine/skillCatalog'
import { ANALYSIS_DIMENSIONS, ATTRIBUTE_PROBE_CATALOG, METRIC_DEFINITIONS, PROBE_CATALOG_VERSION, detectBaselineFindings, getAnalysisSkillScope, getPowerStatValue, type AnalysisDimension, type AnalysisText, type MetricDefinition, type ProbeMetricDelta, type ProbeSeriesResult } from '@/engine/attributeAnalysis'
import { calculateAnalysisResult, runInvestmentProbeBatch } from '@/engine/investmentAnalysisService'
import type { CalcResult } from '@/types/calc'

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
  const defenseMetricKeys = ['Evasion', 'EvadeChance', 'DeflectionRating', 'DeflectChance', 'DeflectEffect'] as const
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
  const [series, setSeries] = useState<ProbeSeriesResult[]>([])
  const [state, setState] = useState<LoadState>('idle')
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState({ completed: 0, total: 0 })
  const [skillCatalog, setSkillCatalog] = useState<SkillCatalog | null>(null)
  const requestRef = useRef(0)
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
  const findings = useMemo(() => baseline ? detectBaselineFindings(baseline, hasFullDpsSelection) : [], [baseline, hasFullDpsSelection])
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
    const requestId = ++requestRef.current
    setBaseline(null)
    setSeries([])
    setError(null)
    if (!code || !xml || !allocatedNodes.size) { setState('idle'); return }
    setState('loading')
    void calculateAnalysisResult(code, xml, weaponSet, calcMode, overrides).then(async (nextBaseline) => {
      if (requestId !== requestRef.current) return
      setBaseline(nextBaseline)
      const results = await runInvestmentProbeBatch({ code, xml, weaponSet, calcMode, baseOverrides: overrides, baseline: nextBaseline, probes: analysisProbes, hasFullDpsSelection, isCurrent: () => requestId === requestRef.current, onProgress: (completed, total) => { if (requestId === requestRef.current) setProgress({ completed, total }) } })
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
  const riskCount = findings.filter((finding) => finding.status === 'at-risk').length
  const damageMetricKey = hasFullDpsSelection ? 'FullDPS' : 'AllDPS'
  const scopeModeLabel = analysisScope.mode === 'full-dps' ? l('Full DPS total', '完整 DPS 总和') : analysisScope.mode === 'fallback' ? l('All actual DPS fallback', '所有实际 DPS（自动回退）') : l('No effective DPS skill', '没有有效 DPS 技能')

  return <section className="investment-analysis-workspace simple-gain-workspace">
    <header className="investment-analysis-header simple-gain-header"><div><span>{l('Attribute investment impact on DPS and EHP', '属性投入对 DPS 与 EHP 的实际影响')}</span><h1>{l('Build gains analysis', '构筑收益分析')}</h1></div><div className={`investment-runtime ${state}`}>{state === 'loading' ? <LoaderCircle className="spinning" /> : state === 'error' ? <AlertTriangle /> : <Activity className="simple-gain-runtime-ecg" />}<div><span>{state === 'loading' ? l('Calculating', '正在计算') : state === 'error' ? l('Calculation failed', '计算失败') : l('Report is current', '报告为最新')}</span><small>{state === 'loading' ? `${progress.completed} / ${progress.total}` : `${calcMode} · ${PROBE_CATALOG_VERSION}`}</small></div></div></header>
    {state === 'loading' && <div className="simple-gain-loading-overlay" role="status" aria-live="polite">
      <div className="simple-gain-loading-panel">
        <LoaderCircle className="simple-gain-loading-icon" />
        <strong>{l('Calculating attribute gains', '正在计算属性收益')}</strong>
        <span>{progress.total ? `${progress.completed} / ${progress.total}` : l('Preparing calculation…', '正在准备计算…')}</span>
        <div className="simple-gain-loading-progress" aria-hidden="true"><i style={{ width: `${progress.total ? Math.max(4, Math.min(100, progress.completed / progress.total * 100)) : 8}%` }} /></div>
      </div>
    </div>}
    {error && <div className="attribute-analysis-error">{error}</div>}
    <section className={`simple-gain-summary${riskCount ? ' has-warnings' : ''}`}><div className="gain-highlight attack-gain"><TrendingUp /><span>{l('Best attack gain', '攻击最高收益')}{attackRows[0] ? ` · ${l('Test', '测试')} ${probeTestLabel(attackRows[0], lang)}` : ''}</span><strong>{attackRows[0] ? `${localText(attackRows[0].probe.label, lang)} · DPS ${signedMetric(firstDelta(attackRows[0])?.absoluteDelta ?? null, fullDpsMetric, lang)}` : '—'}</strong></div><div className="gain-highlight defense-gain"><Shield /><span>{l('Best defense gain', '防御最高收益')}{defenseRows[0] ? ` · ${l('Test', '测试')} ${probeTestLabel(defenseRows[0], lang)}` : ''}</span><strong>{defenseRows[0] ? `${localText(defenseRows[0].probe.label, lang)} · EHP ${signedMetric(firstDelta(defenseRows[0])?.absoluteDelta ?? null, ehpMetric, lang)}` : '—'}</strong></div>{riskCount > 0 && <div className="warning"><span>{l('Current warnings', '当前提示')}</span><strong>{`${riskCount} ${l('items', '项')}`}</strong></div>}</section>
    <section className="simple-gain-note"><Activity /><div><strong>{l('How to read', '如何阅读')}</strong><span>{l('Each row simulates adding 1% of the attribute and shows the real DPS or EHP change. Skill level uses +1 level.', '每一行模拟增加 1% 的该属性，并显示实际带来的 DPS 或 EHP 变化；技能等级按增加 1 级计算。')}</span></div></section>
    <section className="simple-gain-scope-note"><div className="simple-gain-scope-copy"><span className="simple-gain-scope-icon"><Activity /></span><div><strong>{l('Automatic analysis scope', '自动分析范围')} · {scopeModeLabel}</strong><p>{hasFullDpsSelection ? l(`All ${analysisScope.entries.length} effective skills included in Full DPS are aggregated. Multiple skills are not averaged.`, `完整 DPS 中的 ${analysisScope.entries.length} 个有效技能会全部计入总和，不会取平均值。`) : analysisScope.mode === 'fallback' ? l(`Full DPS has no configured skills, so all ${analysisScope.entries.length} positive actual DPS skills are used automatically.`, `当前未配置完整 DPS，已自动使用 ${analysisScope.entries.length} 个实际 DPS 大于 0 的技能。`) : l('No effective DPS skill is available, so attack gains cannot be calculated.', '当前没有有效 DPS 技能，暂时无法计算攻击收益。')} {l('Attack-only and spell-only attributes affect matching skills only; shared attributes can affect both. DoT, ailments, and trigger frequency are excluded in this version.', '攻击专属和法术专属属性只影响对应技能，共享属性可同时影响两者。本版本暂不纳入持续伤害、异常和触发频率。')}</p></div></div><div className="simple-gain-scope-counts"><span>{l('Skills', '技能')} <b>{analysisScope.entries.length}</b></span><span className="attack">{l('Attacks', '攻击')} <b>{analysisScope.attack.length}</b></span><span className="spell">{l('Spells', '法术')} <b>{analysisScope.spell.length}</b></span></div></section>
    <section className="investment-context-strip simple-gain-context"><div className="investment-full-dps"><span>{l('DPS skills', 'DPS 技能')}</span>{damageSourceNames.length ? <strong>{damageSourceNames.join(' + ')}</strong> : <><strong>{l('No effective damage source', '没有有效伤害来源')}</strong>{onOpenSkills && <button type="button" onClick={onOpenSkills}>{l('Manage skills', '管理技能')}</button>}</>}</div>{([damageMetricKey, 'TotalEHP', 'Life', 'EnergyShield'] as const).map((key) => { const metric = METRIC_DEFINITIONS.find((entry) => entry.key === key)!; return <div key={key}><span>{localText(metric.label, lang)}</span><strong>{formatMetric(getPowerStatValue(baseline, key), metric, lang)}</strong></div> })}</section>
    <section className="simple-gain-grid"><GainTable dimension="attack" series={attackSeries} baseline={baseline} language={lang} dpsComposition={dpsComposition} /><GainTable dimension="defense" series={defenseSeries} baseline={baseline} language={lang} /></section>
  </section>
}

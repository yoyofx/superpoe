import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
} from 'react'
import { PanelRightOpen, Sparkles, X } from 'lucide-react'
import { FallbackImage } from '@/components/FallbackImage'
import { GemTooltip, type GemTooltipTarget } from '@/components/GemTooltip'
import { decodeCodeToXml } from '@/engine/buildCode'
import { getImportedCalculationMode } from '@/engine/calculationConfig'
import {
  getLocalizedSkillDescription,
  getLocalizedSkillName,
  getLocalizedSkillTags,
  loadSkillCatalog,
  resolveSkillCatalogEntry,
  type SkillCatalog,
} from '@/engine/skillCatalog'
import { parseSkillsXml } from '@/engine/skills'
import { translateGameText, type Language } from '@/i18n/translationLoader'
import { useTranslation } from '@/i18n/useTranslation'
import { useTreeStore } from '@/store/treeStore'
import type { CalcResult, SkillCalculationDetails, SkillCalculationMode } from '@/types/calc'

const SKILL_PANEL_WIDTH = 1540
const SKILL_PANEL_HEIGHT = 1200

interface SkillPanelSize {
  width: number
  height: number
  scale: number
}

type SkillPanelStyle = CSSProperties & { '--skill-panel-scale': string }

const CALCULATION_MODES: Array<{ value: SkillCalculationMode; zh: string; en: string }> = [
  { value: 'UNBUFFED', zh: '无增益效果', en: 'Unbuffed' },
  { value: 'BUFFED', zh: '有增益效果', en: 'Buffed' },
  { value: 'COMBAT', zh: '战斗中', en: 'In Combat' },
  { value: 'EFFECTIVE', zh: '有效 DPS', en: 'Effective DPS' },
]

const DAMAGE_TYPE_LABELS = {
  all: { zh: '所有类型', en: 'All Types' },
  physical: { zh: '物理', en: 'Physical' },
  lightning: { zh: '闪电', en: 'Lightning' },
  cold: { zh: '冰霜', en: 'Cold' },
  fire: { zh: '火焰', en: 'Fire' },
  chaos: { zh: '混沌', en: 'Chaos' },
} as const

type SpecificDamageType = Exclude<keyof typeof DAMAGE_TYPE_LABELS, 'all'>

function formatCalculationValue(value: number | undefined, decimals = 0): string {
  if (!Number.isFinite(value)) return '-'
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: decimals }).format(value as number)
}

function SkillCalculationPanel({
  details,
  result,
  loading,
  zh,
  groupName,
  activeSkillIndex,
  statSetIndex,
  calcMode,
  onActiveSkillChange,
  onStatSetChange,
  onCalcModeChange,
}: {
  details?: SkillCalculationDetails
  result: CalcResult | null
  loading: boolean
  zh: boolean
  groupName: string
  activeSkillIndex?: number
  statSetIndex?: number
  calcMode: SkillCalculationMode
  onActiveSkillChange: (value: number) => void
  onStatSetChange: (value: number) => void
  onCalcModeChange: (value: SkillCalculationMode) => void
}) {
  const activeSkills = Array.isArray(details?.activeSkills) ? details.activeSkills : []
  const statSets = Array.isArray(details?.statSets) ? details.statSets : []
  const damageTypes = (Array.isArray(details?.damageTypes) ? details.damageTypes : []).filter((entry) => entry.type === 'all'
    || [entry.addedMin, entry.addedMax, entry.hitMin, entry.hitMax].some((value) => value != null && value !== 0)) || []
  const selectedActiveSkill = activeSkillIndex ?? details?.activeSkillIndex ?? 1
  const selectedStatSet = statSetIndex ?? details?.statSetIndex ?? 1
  const row = (label: string, render: (entry: SkillCalculationDetails['damageTypes'][number]) => string) => <tr>
    <th>{label}</th>
    {damageTypes.map((entry) => <td key={entry.type}>{render(entry)}</td>)}
  </tr>

  return <section className="skill-calculation-panel">
    <div className="skill-calculation-controls">
      <label><span>{zh ? '插槽组' : 'Socket Group'}</span><strong>{groupName}</strong></label>
      <label><span>{zh ? '启用技能' : 'Active Skill'}</span><select
        value={selectedActiveSkill}
        disabled={!activeSkills.length || loading}
        onChange={(event) => onActiveSkillChange(Number(event.target.value))}
      >{(activeSkills.length ? activeSkills : [{ index: 1, label: groupName }]).map((option) => <option key={option.index} value={option.index}>{option.label}</option>)}</select></label>
      <label><span>Stat Set</span><select
        value={selectedStatSet}
        disabled={!statSets.length || loading}
        onChange={(event) => onStatSetChange(Number(event.target.value))}
      >{(statSets.length ? statSets : [{ index: 1, label: '-' }]).map((option) => <option key={option.index} value={option.index}>{option.label}</option>)}</select></label>
      <label><span>{zh ? '计算模式' : 'Calculation Mode'}</span><select
        value={calcMode}
        disabled={loading}
        onChange={(event) => onCalcModeChange(event.target.value as SkillCalculationMode)}
      >{CALCULATION_MODES.map((option) => <option key={option.value} value={option.value}>{zh ? option.zh : option.en}</option>)}</select></label>
    </div>
    <div className="skill-hit-heading">
      <span>{zh ? '技能击中伤害' : 'Skill Hit Damage'}</span>
      <strong>{loading ? '...' : `${formatCalculationValue(details?.totalDps ?? result?.TotalDPS, 1)} DPS`}</strong>
    </div>
    {!!damageTypes.length && <div className="skill-damage-table-wrap"><table className="skill-damage-table">
      <thead><tr><th />{damageTypes.map((entry) => <th key={entry.type} className={`damage-${entry.type}`}>{zh ? DAMAGE_TYPE_LABELS[entry.type].zh : DAMAGE_TYPE_LABELS[entry.type].en}</th>)}</tr></thead>
      <tbody>
        {row(zh ? '附加（最小）' : 'Added (Min)', (entry) => entry.type === 'all' ? '-' : formatCalculationValue(entry.addedMin))}
        {row(zh ? '附加（最大）' : 'Added (Max)', (entry) => entry.type === 'all' ? '-' : formatCalculationValue(entry.addedMax))}
        {row(zh ? '总提高' : 'Total Increased', (entry) => `${formatCalculationValue(entry.increased)}%`)}
        {row(zh ? '总增益' : 'Total More', (entry) => `${formatCalculationValue(entry.more)}%`)}
        {row(zh ? '击中伤害' : 'Hit Damage', (entry) => entry.hitMin == null || entry.hitMax == null ? '-' : `${formatCalculationValue(entry.hitMin)} - ${formatCalculationValue(entry.hitMax)}`)}
      </tbody>
    </table></div>}
    <dl className="skill-damage-summary">
      <div><dt>{zh ? '平均击中伤害' : 'Average Hit'}</dt><dd>{loading ? '...' : formatCalculationValue(details?.averageHit ?? result?.AverageHit, 1)}</dd></div>
      <div><dt>{zh ? '攻击/施法速率' : 'Attack/Cast Rate'}</dt><dd>{loading ? '...' : `${formatCalculationValue(details?.speed ?? result?.Speed, 2)}/s`}</dd></div>
      <div><dt>{zh ? '技能 DPS' : 'Skill DPS'}</dt><dd>{loading ? '...' : formatCalculationValue(details?.totalDps ?? result?.TotalDPS, 1)}</dd></div>
    </dl>
  </section>
}

function SkillDamageCalculationDetails({
  details,
  loading,
  language,
}: {
  details?: SkillCalculationDetails
  loading: boolean
  language: Language
}) {
  const zh = language === 'zh-rCN'
  const availableTypes = (details?.damageTypes || []).filter((entry) => entry.type !== 'all'
    && [entry.hitMin, entry.hitMax, entry.addedMin, entry.addedMax].some((value) => value != null && value !== 0))
  const [selectedType, setSelectedType] = useState<SpecificDamageType>('physical')
  const activeType = availableTypes.find((entry) => entry.type === selectedType) || availableTypes[0]
  const modifiers = (details?.modifiers || []).filter((entry) => entry.damageType === 'all' || entry.damageType === activeType?.type)
  const effects = [
    { key: 'auras', label: zh ? '光环与增益技能' : 'Aura and Buff Skills', values: details?.effects?.aurasAndBuffs || [] },
    { key: 'combat', label: zh ? '战斗增益' : 'Combat Buffs', values: details?.effects?.combatBuffs || [] },
    { key: 'debuffs', label: zh ? '诅咒与减益' : 'Curses and Debuffs', values: details?.effects?.cursesAndDebuffs || [] },
  ]
  const bucketLabels = zh
    ? { addedMin: '基础最小', addedMax: '基础最大', increased: '提高', more: '总增' }
    : { addedMin: 'Base Min', addedMax: 'Base Max', increased: 'Increased', more: 'More' }
  const localize = (value: string) => translateGameText(value, language)
  const localizeSource = (value: string) => {
    const item = value.match(/^Item:\d+:(.+)$/)
    if (item) return `${zh ? '装备' : 'Item'}：${localize(item[1])}`
    const skill = value.match(/^Skill:(.+)$/)
    if (skill) return `${zh ? '技能' : 'Skill'}：${localize(skill[1])}`
    if (value === 'Tree') return zh ? '天赋树' : 'Passive Tree'
    if (value === 'Config') return zh ? '配置' : 'Configuration'
    return localize(value)
  }

  if (loading) return <div className="skill-detail-loading">{zh ? '正在生成伤害计算详情...' : 'Building damage calculation details...'}</div>

  return <div className="skill-damage-detail-page">
    <section className="skill-detail-block">
      <h3>{zh ? '最终 DPS 公式' : 'Final DPS Formula'}</h3>
      {details?.dpsFormula?.length
        ? <ol className="skill-formula-lines">{details.dpsFormula.map((line, index) => <li key={`${line}-${index}`}>{localize(line)}</li>)}</ol>
        : <p className="skill-detail-empty">{zh ? '当前技能没有可用的击中 DPS 公式。' : 'No hit DPS formula is available for this skill.'}</p>}
    </section>

    <section className="skill-detail-block">
      <h3>{zh ? '当前生效效果' : 'Active Effects'}</h3>
      <div className="skill-effect-groups">{effects.map((effect) => <div key={effect.key}>
        <strong>{effect.label}</strong>
        {effect.values.length
          ? <ul>{effect.values.map((value) => <li key={value}>{localize(value)}</li>)}</ul>
          : <span>{zh ? '无' : 'None'}</span>}
      </div>)}</div>
    </section>

    {!!availableTypes.length && <section className="skill-detail-block">
      <h3>{zh ? '伤害类型计算链' : 'Damage Type Calculation'}</h3>
      <div className="skill-damage-type-switch" role="tablist" aria-label={zh ? '伤害类型' : 'Damage type'}>
        {availableTypes.map((entry) => <button
          type="button"
          role="tab"
          aria-selected={entry.type === activeType?.type}
          className={entry.type === activeType?.type ? 'active' : ''}
          key={entry.type}
          onClick={() => setSelectedType(entry.type as SpecificDamageType)}
        >{zh ? DAMAGE_TYPE_LABELS[entry.type].zh : DAMAGE_TYPE_LABELS[entry.type].en}</button>)}
      </div>
      {activeType && <>
        <dl className="skill-type-summary">
          <div><dt>{zh ? '最终击中' : 'Final Hit'}</dt><dd>{formatCalculationValue(activeType.hitMin)} - {formatCalculationValue(activeType.hitMax)}</dd></div>
          <div><dt>{zh ? '有效伤害乘数' : 'Effective Multiplier'}</dt><dd>{activeType.effectiveMultiplier == null ? '-' : `${formatCalculationValue(activeType.effectiveMultiplier, 3)}x`}</dd></div>
        </dl>
        {!!activeType.breakdown?.length && <ol className="skill-formula-lines compact">{activeType.breakdown.map((line, index) => <li key={`${line}-${index}`}>{localize(line)}</li>)}</ol>}
        {!!activeType.effectiveBreakdown?.length && <div className="skill-effective-breakdown">
          <strong>{zh ? '敌人防御与承伤' : 'Enemy Defence and Damage Taken'}</strong>
          <ol className="skill-formula-lines compact">{activeType.effectiveBreakdown.map((line, index) => <li key={`${line}-${index}`}>{localize(line)}</li>)}</ol>
        </div>}
      </>}
    </section>}

    <section className="skill-detail-block">
      <h3>{zh ? '修正来源' : 'Modifier Sources'} <small>{modifiers.length}</small></h3>
      {modifiers.length ? <div className="skill-modifier-table-wrap"><table className="skill-modifier-table">
        <thead><tr><th>{zh ? '乘区' : 'Bucket'}</th><th>{zh ? '数值' : 'Value'}</th><th>{zh ? '来源' : 'Source'}</th><th>{zh ? '属性' : 'Stat'}</th></tr></thead>
        <tbody>{modifiers.map((entry, index) => <tr key={`${entry.bucket}-${entry.damageType}-${entry.source}-${entry.stat}-${index}`}>
          <td>{bucketLabels[entry.bucket]}</td>
          <td>{entry.bucket === 'increased' || entry.bucket === 'more' ? `${formatCalculationValue(entry.value, 2)}%` : formatCalculationValue(entry.value, 2)}</td>
          <td>{localizeSource(entry.source)}</td>
          <td>{entry.stat}</td>
        </tr>)}</tbody>
      </table></div> : <p className="skill-detail-empty">{zh ? '没有适用于当前伤害类型的修正来源。' : 'No modifier sources apply to this damage type.'}</p>}
    </section>
  </div>
}

function useSkillPanelSize(enabled: boolean) {
  const hostRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState<SkillPanelSize>({ width: 0, height: 0, scale: 0 })

  useLayoutEffect(() => {
    if (!enabled) return
    const host = hostRef.current
    if (!host) return
    const update = () => {
      const scale = Math.min(
        Math.max(0, host.clientWidth - 16) / SKILL_PANEL_WIDTH,
        Math.max(0, host.clientHeight - 16) / SKILL_PANEL_HEIGHT,
        1,
      )
      setSize({
        width: SKILL_PANEL_WIDTH * scale,
        height: SKILL_PANEL_HEIGHT * scale,
        scale,
      })
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(host)
    return () => observer.disconnect()
  }, [enabled])

  return { hostRef, size }
}

export function SkillsPanel() {
  const { lang } = useTranslation()
  const importedBuildCode = useTreeStore((state) => state.importedBuildCode)
  const weaponSet = useTreeStore((state) => state.activeWeaponSet)
  const setWeaponSet = useTreeStore((state) => state.setActiveWeaponSet)
  const calcResult = useTreeStore((state) => state.calcResult)
  const calcLoading = useTreeStore((state) => state.calcLoading)
  const calcError = useTreeStore((state) => state.calcError)
  const runCalculation = useTreeStore((state) => state.runCalculation)
  const [selectedId, setSelectedId] = useState('')
  const [inspectorOpen, setInspectorOpen] = useState(true)
  const [inspectorPage, setInspectorPage] = useState<'overview' | 'calculation'>('overview')
  const [calcMode, setCalcMode] = useState<SkillCalculationMode>('EFFECTIVE')
  const [skillCalculationSelection, setSkillCalculationSelection] = useState<{
    groupId: string
    activeSkillIndex?: number
    statSetIndex?: number
  }>({ groupId: '' })
  const [catalog, setCatalog] = useState<SkillCatalog | null>(null)
  const [tooltip, setTooltip] = useState<GemTooltipTarget | null>(null)
  const zh = lang === 'zh-rCN'

  useEffect(() => {
    let mounted = true
    loadSkillCatalog().then((value) => mounted && setCatalog(value))
    return () => { mounted = false }
  }, [])

  useEffect(() => {
    if (!inspectorOpen) return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setInspectorOpen(false)
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [inspectorOpen])

  const buildXml = useMemo(() => {
    if (!importedBuildCode) return ''
    try {
      return decodeCodeToXml(importedBuildCode)
    } catch {
      return ''
    }
  }, [importedBuildCode])
  const skills = useMemo(() => buildXml
    ? parseSkillsXml(buildXml)
    : { activeSkillSetId: '', activeGroupId: '', groups: [] }, [buildXml])

  useEffect(() => {
    if (buildXml) setCalcMode(getImportedCalculationMode(buildXml))
  }, [buildXml])
  const selected = skills.groups.find((group) => group.id === selectedId)
    || skills.groups.find((group) => group.id === skills.activeGroupId)
    || skills.groups[0]
  const { hostRef, size: panelSize } = useSkillPanelSize(Boolean(selected))
  const activeSkillIndex = selected && skillCalculationSelection.groupId === selected.id
    ? skillCalculationSelection.activeSkillIndex
    : undefined
  const statSetIndex = selected && skillCalculationSelection.groupId === selected.id
    ? skillCalculationSelection.statSetIndex
    : undefined
  const calculationKey = selected
    ? `${importedBuildCode}:${weaponSet}:${selected.id}:${calcMode}:${activeSkillIndex || ''}:${statSetIndex || ''}`
    : ''
  const lastCalculationKey = useRef('')

  useEffect(() => {
    if (!selected || !importedBuildCode || calcLoading || lastCalculationKey.current === calculationKey) return
    lastCalculationKey.current = calculationKey
    void runCalculation({
      weaponSet,
      skillGroupId: selected.id,
      calcMode,
      activeSkillIndex,
      statSetIndex,
    })
  }, [selected?.id, importedBuildCode, weaponSet, calcMode, activeSkillIndex, statSetIndex, calcLoading, calculationKey, runCalculation])

  const selectedCalculation = !calcLoading && lastCalculationKey.current === calculationKey ? calcResult : null
  const calculationDetails = selectedCalculation?.SkillDetails

  const showTooltip = (
    event: MouseEvent<HTMLElement>,
    gem: NonNullable<typeof selected>['gems'][number],
    detail: ReturnType<typeof resolveSkillCatalogEntry>,
  ) => setTooltip({ gem, detail, x: event.clientX, y: event.clientY })

  if (!selected) {
    return <section className="workspace-empty">
      <Sparkles />
      <h2>{zh ? '没有技能数据' : 'No skill data'}</h2>
      <p>{zh ? '导入完整 PoB2 构筑后，这里会显示独立的技能组。' : 'Import a complete PoB2 build to view skill groups.'}</p>
    </section>
  }

  return <section className={`skills-workspace${inspectorOpen ? ' inspector-open' : ''}`}>
    <div className="skill-groups-stage">
      <header>
        <div className="skill-groups-header-actions">
          <label>{zh ? '武器组' : 'Weapon set'}</label>
          <div className="skill-weapon-set-control" role="group" aria-label={zh ? '武器组' : 'Weapon set'}>
            {([1, 2] as const).map((value) => <button
              key={value}
              type="button"
              className={weaponSet === value ? 'active' : ''}
              aria-pressed={weaponSet === value}
              onClick={() => setWeaponSet(value)}
            >{value === 1 ? 'I' : 'II'}</button>)}
          </div>
          <span>{zh ? '技能组' : 'Skill groups'}</span>
        </div>
        <div className="skill-groups-header-meta">
          <strong>{skills.groups.length}</strong>
          {!inspectorOpen && <button
            type="button"
            className="skill-inspector-toggle"
            onClick={() => setInspectorOpen(true)}
            title={zh ? '打开技能详情' : 'Open skill details'}
            aria-label={zh ? '打开技能详情' : 'Open skill details'}
          ><PanelRightOpen /></button>}
        </div>
      </header>
      <div className="skill-panel-host" ref={hostRef}>
        <div
          className="skill-panel-frame"
          style={panelSize.scale > 0 ? {
            width: panelSize.width,
            height: panelSize.height,
            '--skill-panel-scale': String(panelSize.scale),
          } as SkillPanelStyle : undefined}
        >
          <div className="skill-group-rows">{skills.groups.map((group) => {
        const main = group.gems[0]
        const groupSupports = group.gems.slice(1)
        const mainDetail = resolveSkillCatalogEntry(main, catalog)
        const label = getLocalizedSkillName(main, mainDetail, lang)
        const calculatedLevel = group.id === selected.id ? selectedCalculation?.SkillLevel : undefined
        return <article
          key={group.id}
          className={`skill-group-row${group.id === selected.id ? ' active' : ''}${group.enabled ? '' : ' disabled'}`}
          role="button"
          tabIndex={0}
          aria-pressed={group.id === selected.id}
          onClick={() => {
            setSelectedId(group.id)
            setInspectorOpen(true)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault()
              setSelectedId(group.id)
              setInspectorOpen(true)
            }
          }}
        >
          <div className="skill-row-intro">
            <div
              className="skill-row-main-icon"
              onMouseEnter={(event) => showTooltip(event, main, mainDetail)}
              onMouseLeave={() => setTooltip(null)}
            >
              <FallbackImage src={mainDetail?.icon || undefined} alt="" fallback={<Sparkles />} />
            </div>
            <div className="skill-group-copy">
              <strong>{label}</strong>
              <small>{calculatedLevel
                ? (zh ? `实际等级 ${calculatedLevel}` : `Effective level ${calculatedLevel}`)
                : (zh ? `宝石等级 ${main.level}` : `Gem level ${main.level}`)}</small>
            </div>
          </div>
          <div className="skill-row-gems">
            <div className="skill-row-primary-placeholder" aria-hidden="true" />
            {Array.from({ length: 5 }, (_, index) => {
              const gem = groupSupports[index]
              if (!gem) return <div className="skill-row-support-slot empty" key={`empty-${index}`} />
              const detail = resolveSkillCatalogEntry(gem, catalog)
              const supportName = getLocalizedSkillName(gem, detail, lang)
              return <div
                className="skill-row-support-slot"
                key={`${gem.skillId}-${index}`}
                title={supportName}
                onMouseEnter={(event) => showTooltip(event, gem, detail)}
                onMouseLeave={() => setTooltip(null)}
              >
                <FallbackImage src={detail?.icon || undefined} alt="" fallback={<span>{supportName.slice(0, 1)}</span>} />
              </div>
            })}
          </div>
            </article>
          })}</div>
        </div>
      </div>
    </div>

    {inspectorOpen && <aside className="skill-inspector skill-inspector-floating">{(() => {
      const mainGem = selected.gems[0]
      const mainSkill = resolveSkillCatalogEntry(mainGem, catalog)
      const supports = selected.gems.slice(1)
      const mainName = getLocalizedSkillName(mainGem, mainSkill, lang)
      const description = getLocalizedSkillDescription(mainSkill, lang)
      const tags = getLocalizedSkillTags(mainSkill, lang)
      return <>
      <header>
        <div className="skill-inspector-icon">
          <FallbackImage src={mainSkill?.icon || undefined} alt="" fallback={<Sparkles />} />
        </div>
        <div>
          <span>{zh ? '技能详情' : 'Skill details'}</span>
          <h2>{mainName}</h2>
          <small>{translateGameText(mainSkill?.gemType || (mainSkill?.type === 'support' ? 'Support' : 'Skill Gem'), lang)}</small>
        </div>
        <button
          type="button"
          className="skill-inspector-close"
          onClick={() => setInspectorOpen(false)}
          title={zh ? '关闭技能详情' : 'Close skill details'}
          aria-label={zh ? '关闭技能详情' : 'Close skill details'}
        ><X /></button>
      </header>
      <nav className="skill-inspector-tabs" aria-label={zh ? '技能详情页面' : 'Skill detail pages'}>
        <button type="button" className={inspectorPage === 'overview' ? 'active' : ''} onClick={() => setInspectorPage('overview')}>{zh ? '概览' : 'Overview'}</button>
        <button type="button" className={inspectorPage === 'calculation' ? 'active' : ''} onClick={() => setInspectorPage('calculation')}>{zh ? '伤害计算' : 'Damage Calculation'}</button>
      </nav>
      <div className="skill-inspector-scroll">
        <SkillCalculationPanel
          details={calculationDetails}
          result={selectedCalculation}
          loading={calcLoading}
          zh={zh}
          groupName={mainName}
          activeSkillIndex={activeSkillIndex}
          statSetIndex={statSetIndex}
          calcMode={calcMode}
          onActiveSkillChange={(value) => setSkillCalculationSelection({
            groupId: selected.id,
            activeSkillIndex: value,
          })}
          onStatSetChange={(value) => setSkillCalculationSelection({
            groupId: selected.id,
            activeSkillIndex: activeSkillIndex ?? calculationDetails?.activeSkillIndex,
            statSetIndex: value,
          })}
          onCalcModeChange={setCalcMode}
        />
        {calcError && lastCalculationKey.current === calculationKey && <p className="skill-calculation-error">{calcError}</p>}
        {inspectorPage === 'calculation' && <SkillDamageCalculationDetails
          details={calculationDetails}
          loading={calcLoading}
          language={lang}
        />}
        {inspectorPage === 'overview' && <>
        <section className="skill-inspector-overview">
          {description
            ? <p className="skill-description">{description}</p>
            : <p className="skill-description muted">{zh ? '上游暂无技能描述' : 'No upstream description available'}</p>}
          {!!tags.length && <div className="skill-tags">
            {tags.map((tag) => <span key={tag}>{tag}</span>)}
          </div>}
          <dl>
            <div><dt>{zh ? '宝石等级' : 'Gem level'}</dt><dd>{mainGem.level}</dd></div>
            <div><dt>{zh ? '实际等级' : 'Effective level'}</dt><dd>{calcLoading ? '...' : (selectedCalculation?.SkillLevel ?? '-')}</dd></div>
            <div><dt>{zh ? '品质' : 'Quality'}</dt><dd>{mainGem.quality}%</dd></div>
            <div><dt>{zh ? '变体' : 'Variant'}</dt><dd>{mainGem.variantId || '-'}</dd></div>
          </dl>
        </section>
        <section className="skill-inspector-section">
          <h3><span>{zh ? '辅助宝石' : 'Support gems'}</span><small>{supports.length}</small></h3>
          <div className="skill-support-list">{supports.map((gem, index) => {
            const detail = resolveSkillCatalogEntry(gem, catalog)
            const name = getLocalizedSkillName(gem, detail, lang)
            const supportDescription = getLocalizedSkillDescription(detail, lang)
            return <div
              className="skill-support-row"
              key={`${gem.gemId}-${index}`}
              onMouseEnter={(event) => showTooltip(event, gem, detail)}
              onMouseLeave={() => setTooltip(null)}
            >
              <FallbackImage src={detail?.icon || undefined} alt="" fallback={<span>{name.slice(0, 1)}</span>} />
              <div><strong>{name}</strong>{supportDescription && <p>{supportDescription}</p>}</div>
              <small>Lv. {gem.level}</small>
            </div>
          })}</div>
        </section>
        </>}
      </div>
      </>
    })()}</aside>}
    <GemTooltip target={tooltip} language={lang} />
  </section>
}

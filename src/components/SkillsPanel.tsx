import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
} from 'react'
import { ArrowDownWideNarrow, Info, LoaderCircle, PanelRightOpen, RotateCcw, Sparkles, X } from 'lucide-react'
import { FallbackImage } from '@/components/FallbackImage'
import { GemTooltip, type GemTooltipTarget } from '@/components/GemTooltip'
import { decodeCodeToXml } from '@/engine/buildCode'
import { getImportedCalculationMode } from '@/engine/calculationConfig'
import {
  getLocalizedSkillDescription,
  getLocalizedSkillName,
  getLocalizedSupportEffectLines,
  getLocalizedSkillTags,
  loadSkillCatalog,
  resolveSkillCatalogEntry,
  resolveSkillCatalogName,
  type SkillCatalog,
} from '@/engine/skillCatalog'
import { parseSkillsXml } from '@/engine/skills'
import { translateCalculationStat, translateCalculationTerm, translateCalculationText } from '@/i18n/calculationTranslations'
import { translateGameText, type Language } from '@/i18n/translationLoader'
import { useTranslation } from '@/i18n/useTranslation'
import { formatUiNumber, uiText, type UiMessage } from '@/i18n/uiLocale'
import { useTreeStore } from '@/store/treeStore'
import type { CalcResult, SkillCalculationDetails, SkillCalculationMode, SkillLevelReference } from '@/types/calc'

const SKILL_PANEL_WIDTH = 1540
const SKILL_PANEL_HEIGHT = 1200

interface SkillPanelSize {
  width: number
  height: number
  scale: number
}

type SkillPanelStyle = CSSProperties & { '--skill-panel-scale': string }

const CALCULATION_MODES: Array<{ value: SkillCalculationMode; label: UiMessage }> = [
  { value: 'UNBUFFED', label: { en: 'Unbuffed', 'zh-rCN': '无增益效果', 'zh-rTW': '無增益效果', 'ko-KR': '버프 없음' } },
  { value: 'BUFFED', label: { en: 'Buffed', 'zh-rCN': '有增益效果', 'zh-rTW': '有增益效果', 'ko-KR': '버프 적용' } },
  { value: 'COMBAT', label: { en: 'In Combat', 'zh-rCN': '战斗中', 'zh-rTW': '戰鬥中', 'ko-KR': '전투 중' } },
  { value: 'EFFECTIVE', label: { en: 'Effective DPS', 'zh-rCN': '有效 DPS', 'zh-rTW': '有效 DPS', 'ko-KR': '유효 DPS' } },
]

const DAMAGE_TYPE_LABELS: Record<'all' | 'physical' | 'lightning' | 'cold' | 'fire' | 'chaos', UiMessage> = {
  all: { en: 'All Types', 'zh-rCN': '所有类型', 'zh-rTW': '所有類型', 'ko-KR': '모든 유형' },
  physical: { en: 'Physical', 'zh-rCN': '物理', 'zh-rTW': '物理', 'ko-KR': '물리' },
  lightning: { en: 'Lightning', 'zh-rCN': '闪电', 'zh-rTW': '閃電', 'ko-KR': '번개' },
  cold: { en: 'Cold', 'zh-rCN': '冰霜', 'zh-rTW': '冰冷', 'ko-KR': '냉기' },
  fire: { en: 'Fire', 'zh-rCN': '火焰', 'zh-rTW': '火焰', 'ko-KR': '화염' },
  chaos: { en: 'Chaos', 'zh-rCN': '混沌', 'zh-rTW': '混沌', 'ko-KR': '카오스' },
}

type SpecificDamageType = Exclude<keyof typeof DAMAGE_TYPE_LABELS, 'all'>
type DamageBucket = 'added' | 'increased' | 'gain' | 'more' | 'levels'

function formatCalculationValue(value: number | undefined, decimals: number, language: Language): string {
  if (!Number.isFinite(value)) return '-'
  return formatUiNumber(value as number, language, { maximumFractionDigits: decimals })
}

function SkillLevelReferencePanel({
  details,
  loading,
  language,
  statSetIndex,
}: {
  details?: SkillCalculationDetails
  loading: boolean
  language: Language
  statSetIndex: number
}) {
  const l = (en: string, zhCN: string, zhTW: string, koKR: string) => uiText(language, en, zhCN, zhTW, koKR)
  const levels = details?.levelReferences || []
  const currentLevel = details?.levelReferenceCurrent
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null)

  const formatCosts = (entry: SkillLevelReference) => {
    const costs = entry.costs.map(({ resource, value }) => `${formatCalculationValue(value, 2, language)} ${translateCalculationTerm(resource, language)}`)
    if (Number.isFinite(entry.spiritReservation)) {
      costs.push(`${formatCalculationValue(entry.spiritReservation, 0, language)} ${l('Spirit reserved', '精魂保留', '精魂保留', '정신력 점유')}`)
    }
    return costs.join(' / ') || '-'
  }

  if (loading) return <p className="skill-detail-loading">{l('Loading level data...', '正在读取等级数据...', '正在讀取等級數據...', '레벨 데이터 불러오는 중...')}</p>
  if (!levels.length) return <p className="skill-detail-empty">{l('No per-level data is available for the selected skill.', '所选技能没有可用的逐级数据。', '所選技能沒有可用的逐級數據。', '선택한 스킬에 레벨별 데이터가 없습니다.')}</p>

  const damageTypes = (Object.keys(DAMAGE_TYPE_LABELS) as Array<keyof typeof DAMAGE_TYPE_LABELS>)
    .filter((type): type is SpecificDamageType => type !== 'all')
    .filter((type) => levels.some((entry) => entry.statSets.find((set) => set.index === statSetIndex)?.damageRanges?.some((range) => range.type === type)))
  const damageColors: Record<SpecificDamageType, string> = {
    physical: '#a8a49a',
    lightning: '#7779d5',
    cold: '#5d9cba',
    fire: '#b65f48',
    chaos: '#8f5ca4',
  }
  const resourceColors = ['#d3b96e', '#78a78d', '#b783aa', '#a97958']
  const resourceNames = Array.from(new Set(levels.flatMap((entry) => entry.costs.map((cost) => cost.resource))))
  const hasBaseMultiplier = levels.some((entry) => Number.isFinite(entry.statSets.find((set) => set.index === statSetIndex)?.baseMultiplier ?? entry.baseMultiplier))
  const series = damageTypes.length
    ? damageTypes.map((type) => ({
      key: type,
      label: DAMAGE_TYPE_LABELS[type][language],
      color: damageColors[type],
      values: levels.map((entry) => {
        const range = entry.statSets.find((set) => set.index === statSetIndex)?.damageRanges?.find((item) => item.type === type)
        return range ? (range.min + range.max) / 2 : undefined
      }),
    }))
    : hasBaseMultiplier
      ? [{
        key: 'baseMultiplier',
        label: l('Base Damage Multiplier', '基础伤害倍率', '基礎傷害倍率', '기본 피해 배율'),
        color: '#d3b96e',
        values: levels.map((entry) => {
          const statSet = entry.statSets.find((set) => set.index === statSetIndex)
          const value = statSet?.baseMultiplier ?? entry.baseMultiplier
          return Number.isFinite(value) ? (value as number) * 100 : undefined
        }),
      }]
      : resourceNames.map((resource, index) => ({
        key: resource,
        label: translateCalculationTerm(resource, language),
        color: resourceColors[index % resourceColors.length],
        values: levels.map((entry) => entry.costs.find((cost) => cost.resource === resource)?.value),
      }))
  const chartSeries = series.filter((entry) => entry.values.some(Number.isFinite))
  const maxValue = Math.max(1, ...chartSeries.flatMap((entry) => entry.values.filter((value): value is number => Number.isFinite(value))))
  const width = 520
  const height = 190
  const plot = { left: 44, right: 12, top: 16, bottom: 28 }
  const plotWidth = width - plot.left - plot.right
  const plotHeight = height - plot.top - plot.bottom
  const xAt = (index: number) => plot.left + (levels.length > 1 ? index / (levels.length - 1) * plotWidth : plotWidth / 2)
  const yAt = (value: number) => plot.top + plotHeight - value / maxValue * plotHeight
  const currentIndex = Math.max(0, levels.findIndex((entry) => entry.level === currentLevel))
  const activeIndex = hoveredIndex ?? currentIndex
  const activeEntry = levels[activeIndex]
  const activeSet = activeEntry.statSets.find((set) => set.index === statSetIndex) || activeEntry.statSets[0]
  const axisValue = (value: number) => value >= 1000 ? `${formatCalculationValue(value / 1000, 1, language)}k` : formatCalculationValue(value, 1, language)
  const tooltipShift = activeIndex === 0 ? '0' : activeIndex === levels.length - 1 ? '-100%' : '-50%'
  const handleChartMouseMove = (event: MouseEvent<SVGSVGElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect()
    const chartX = (event.clientX - bounds.left) / bounds.width * width
    const ratio = Math.max(0, Math.min(1, (chartX - plot.left) / plotWidth))
    setHoveredIndex(Math.round(ratio * Math.max(0, levels.length - 1)))
  }

  return <section className="skill-level-reference">
    <header>
      <div>
        <span>{l('Skill Level Scaling', '技能等级成长', '技能等級成長', '스킬 레벨 성장')}</span>
        <strong>{l('Current', '当前', '目前', '현재')} Lv. {currentLevel}</strong>
      </div>
      <p>{l('Move across the x-axis to inspect each level. 0% quality base values, excluding gear, passives, and supports.', '沿横轴移动鼠标查看各等级完整数值。零品质基础值，不包含装备、天赋与辅助宝石。', '沿橫軸移動滑鼠以查看各等級完整數值。零品質基礎值，不包含裝備、天賦與輔助寶石。', '가로축에서 마우스를 움직여 레벨별 전체 수치를 확인하세요. 장비, 패시브, 보조 젬을 제외한 퀄리티 0% 기본값입니다.')}</p>
    </header>
    {!!chartSeries.length && <div className="skill-level-chart" onMouseLeave={() => setHoveredIndex(null)}>
      <div className="skill-level-chart-legend">{chartSeries.map((entry) => <span key={entry.key}><i style={{ background: entry.color }} />{entry.label}</span>)}</div>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={l('Skill level scaling chart', '技能等级成长曲线', '技能等級成長曲線', '스킬 레벨 성장 차트')} onMouseMove={handleChartMouseMove}>
        {[0, .5, 1].map((ratio) => {
          const y = plot.top + plotHeight * (1 - ratio)
          return <g key={ratio}><line className="grid" x1={plot.left} x2={width - plot.right} y1={y} y2={y} /><text className="axis-y" x={plot.left - 6} y={y + 3}>{axisValue(maxValue * ratio)}</text></g>
        })}
        <line className="current-guide" x1={xAt(currentIndex)} x2={xAt(currentIndex)} y1={plot.top} y2={plot.top + plotHeight} />
        {hoveredIndex != null && <line className="hover-guide" x1={xAt(hoveredIndex)} x2={xAt(hoveredIndex)} y1={plot.top} y2={plot.top + plotHeight} />}
        {chartSeries.map((entry) => {
          const points = entry.values.flatMap((value, index) => Number.isFinite(value) ? [`${xAt(index)},${yAt(value as number)}`] : [])
          return <g key={entry.key}>
            <polyline points={points.join(' ')} fill="none" stroke={entry.color} />
            {entry.values.map((value, index) => Number.isFinite(value) && <circle key={levels[index].level} cx={xAt(index)} cy={yAt(value as number)} r={levels[index].level === currentLevel ? 4 : 2.4} fill={entry.color}>
              <title>{`Lv. ${levels[index].level}: ${formatCalculationValue(value as number, 1, language)}`}</title>
            </circle>)}
          </g>
        })}
        {levels.map((entry, index) => {
          const show = index === 0 || index === levels.length - 1 || entry.level === currentLevel || entry.level % 5 === 0
          return show && <text key={entry.level} className={entry.level === currentLevel ? 'axis-x current' : 'axis-x'} x={xAt(index)} y={height - 8}>Lv.{entry.level}</text>
        })}
        {levels.map((entry, index) => {
          const left = index === 0 ? plot.left : (xAt(index - 1) + xAt(index)) / 2
          const right = index === levels.length - 1 ? width - plot.right : (xAt(index) + xAt(index + 1)) / 2
          return <rect key={`hit-${entry.level}`} className="level-hit-area" x={left} y={plot.top} width={Math.max(1, right - left)} height={plotHeight + plot.bottom} />
        })}
      </svg>
      {hoveredIndex != null && <div className="skill-level-tooltip" style={{ left: `${xAt(activeIndex) / width * 100}%`, transform: `translateX(${tooltipShift})` }}>
        <header><strong>Lv. {activeEntry.level}</strong>{activeEntry.level === currentLevel && <span>{l('Current', '当前等级', '目前等級', '현재')}</span>}<small>{l('Required', '需求', '需求', '요구')} {formatCalculationValue(activeEntry.requiredLevel, 0, language)}</small></header>
        <dl>
          <div><dt>{l('Resource Cost', '资源消耗', '資源消耗', '자원 소모')}</dt><dd>{formatCosts(activeEntry)}</dd></div>
          {activeSet?.damageRanges?.map((range) => <div key={range.type}><dt>{DAMAGE_TYPE_LABELS[range.type][language]}</dt><dd>{formatCalculationValue(range.min, 0, language)}–{formatCalculationValue(range.max, 0, language)}</dd></div>)}
          {activeEntry.cooldown != null && <div><dt>{l('Cooldown', '冷却时间', '冷卻時間', '재사용 대기시간')}</dt><dd>{formatCalculationValue(activeEntry.cooldown, 2, language)}s</dd></div>}
          {(activeSet?.critChance ?? activeEntry.critChance) != null && <div><dt>{l('Base Crit', '基础暴击率', '基礎暴擊率', '기본 치명타')}</dt><dd>{formatCalculationValue(activeSet?.critChance ?? activeEntry.critChance, 2, language)}%</dd></div>}
          {(activeSet?.baseMultiplier ?? activeEntry.baseMultiplier) != null && <div><dt>{l('Base Damage', '基础伤害倍率', '基礎傷害倍率', '기본 피해')}</dt><dd>{formatCalculationValue((activeSet?.baseMultiplier ?? activeEntry.baseMultiplier)! * 100, 0, language)}%</dd></div>}
        </dl>
        {!!activeSet?.lines.length && <ul>{activeSet.lines.map((line, index) => <li key={`${line}-${index}`}>{translateCalculationText(line, language)}</li>)}</ul>}
      </div>}
    </div>}
    {!chartSeries.length && <p className="skill-detail-empty">{l('This skill has no plottable per-level values.', '该技能没有可绘制的逐级数值。', '此技能沒有可繪製的逐級數值。', '이 스킬에는 차트로 표시할 레벨별 수치가 없습니다.')}</p>}
  </section>
}

function SkillCriticalMetric({
  kind,
  value,
  multiplier,
  breakdown,
  loading,
  language,
}: {
  kind: 'chance' | 'damage'
  value?: number
  multiplier?: number
  breakdown?: string[]
  loading: boolean
  language: Language
}) {
  const l = (en: string, zhCN: string, zhTW: string, koKR: string) => uiText(language, en, zhCN, zhTW, koKR)
  const chance = kind === 'chance'
  const label = chance ? l('Critical Chance', '暴击率', '暴擊率', '치명타 확률') : l('Critical Damage', '暴击伤害', '暴擊傷害', '치명타 피해')
  const displayValue = loading
    ? '...'
    : chance
      ? `${formatCalculationValue(value, 2, language)}%`
      : `x${formatCalculationValue(multiplier, 2, language)}`
  const lines = breakdown || []
  const critBonus = Number.isFinite(multiplier) ? ((multiplier as number) - 1) * 100 : undefined

  return <div className="skill-critical-metric" tabIndex={0} aria-label={`${label} ${displayValue}`}>
    <dt>{label}<Info aria-hidden="true" /></dt>
    <dd>{displayValue}</dd>
    <div className="skill-critical-tooltip" role="tooltip">
      <header><span>{label}</span><strong>{displayValue}</strong></header>
      {!chance && Number.isFinite(critBonus) && <p>
        <span>{l('Critical damage bonus', '暴击伤害加成', '暴擊傷害加成', '치명타 피해 보너스')}</span>
        <b>+{formatCalculationValue(critBonus, 1, language)}%</b>
      </p>}
      {lines.length
        ? <ol>{lines.map((line, index) => <li key={`${line}-${index}`}>{translateCalculationText(line, language)}</li>)}</ol>
        : <p className="empty">{chance
          ? l('No additional critical chance calculation steps.', '当前没有额外的暴击率计算步骤。', '目前沒有額外的暴擊率計算步驟。', '추가 치명타 확률 계산 단계가 없습니다.')
          : l('The multiplier includes all active critical damage bonuses.', '当前倍率已包含所有生效的暴击伤害加成。', '目前倍率已包含所有生效的暴擊傷害加成。', '배율에 적용 중인 모든 치명타 피해 보너스가 포함되어 있습니다.')}</p>}
    </div>
  </div>
}

function SkillCalculationPanel({
  details,
  result,
  loading,
  groupName,
  activeSkillIndex,
  statSetIndex,
  minionSkillIndex,
  minionStatSetIndex,
  calcMode,
  language,
  catalog,
  onActiveSkillChange,
  onStatSetChange,
  onMinionSkillChange,
  onMinionStatSetChange,
  onCalcModeChange,
}: {
  details?: SkillCalculationDetails
  result: CalcResult | null
  loading: boolean
  groupName: string
  activeSkillIndex?: number
  statSetIndex?: number
  minionSkillIndex?: number
  minionStatSetIndex?: number
  calcMode: SkillCalculationMode
  language: Language
  catalog: SkillCatalog | null
  onActiveSkillChange: (value: number) => void
  onStatSetChange: (value: number) => void
  onMinionSkillChange: (value: number) => void
  onMinionStatSetChange: (value: number) => void
  onCalcModeChange: (value: SkillCalculationMode) => void
}) {
  const l = (en: string, zhCN: string, zhTW: string, koKR: string) => uiText(language, en, zhCN, zhTW, koKR)
  const activeSkills = Array.isArray(details?.activeSkills) ? details.activeSkills : []
  const statSets = Array.isArray(details?.statSets) ? details.statSets : []
  const damageTypes = (Array.isArray(details?.damageTypes) ? details.damageTypes : []).filter((entry) => entry.type === 'all'
    || [entry.addedMin, entry.addedMax, entry.hitMin, entry.hitMax].some((value) => value != null && value !== 0)) || []
  const composition = damageTypes.filter((entry) => entry.type !== 'all' && entry.hitMin != null && entry.hitMax != null)
    .map((entry) => ({ ...entry, average: ((entry.hitMin || 0) + (entry.hitMax || 0)) / 2 }))
    .filter((entry) => entry.average > 0)
  const compositionTotal = composition.reduce((total, entry) => total + entry.average, 0)
  const selectedActiveSkill = activeSkillIndex ?? details?.activeSkillIndex ?? 1
  const selectedStatSet = statSetIndex ?? details?.statSetIndex ?? 1
  const selectedActor = details?.actor ?? 'player'
  const selectedMinionSkill = minionSkillIndex ?? details?.minionSkillIndex ?? 1
  const selectedMinionStatSet = minionStatSetIndex ?? details?.minionStatSetIndex ?? 1
  const minionSkills = details?.minionSkills || []
  const minionStatSets = details?.minionStatSets || []
  const localizeSkillOption = (value: string) => {
    const entry = resolveSkillCatalogName(value, catalog)
    return entry ? getLocalizedSkillName({ name: entry.name }, entry, language) : translateCalculationText(value, language)
  }
  return <section className="skill-calculation-panel">
    <div className="skill-calculation-controls">
      <label><span>{l('Socket Group', '插槽组', '插槽組', '홈 그룹')}</span><strong>{groupName}</strong></label>
      <label><span>{l('Active Skill', '启用技能', '啟用技能', '활성 스킬')}</span><select
        value={selectedActiveSkill}
        disabled={!activeSkills.length || loading}
        onChange={(event) => onActiveSkillChange(Number(event.target.value))}
      >{(activeSkills.length ? activeSkills : [{ index: 1, label: groupName }]).map((option) => <option key={option.index} value={option.index}>{localizeSkillOption(option.label)}</option>)}</select></label>
      <label><span>{l('Stat Set', '技能形态', '技能型態', '능력치 세트')}</span><select
        value={selectedStatSet}
        disabled={!statSets.length || loading}
        onChange={(event) => onStatSetChange(Number(event.target.value))}
      >{(statSets.length ? statSets : [{ index: 1, label: '-' }]).map((option) => <option key={option.index} value={option.index}>{translateCalculationText(option.label, language)}</option>)}</select></label>
      {details?.hasMinion && <label><span>{l('Data Actor', '数据对象', '數據對象', '데이터 대상')}</span><strong>{details.minionName || l('Minion', '召唤物', '召喚物', '소환수')}</strong></label>}
      {details?.hasMinion && selectedActor === 'minion' && <label><span>{l('Minion Skill', '召唤物技能', '召喚物技能', '소환수 스킬')}</span><select
        value={selectedMinionSkill}
        disabled={minionSkills.length < 2 || loading}
        onChange={(event) => onMinionSkillChange(Number(event.target.value))}
      >{minionSkills.map((option) => <option key={option.index} value={option.index}>{localizeSkillOption(option.label)}</option>)}</select></label>}
      {details?.hasMinion && selectedActor === 'minion' && minionStatSets.length > 1 && <label><span>{l('Minion Stat Set', '召唤物技能形态', '召喚物技能型態', '소환수 능력치 세트')}</span><select
        value={selectedMinionStatSet}
        disabled={loading}
        onChange={(event) => onMinionStatSetChange(Number(event.target.value))}
      >{minionStatSets.map((option) => <option key={option.index} value={option.index}>{translateCalculationText(option.label, language)}</option>)}</select></label>}
      <label><span>{l('Calculation Mode', '计算模式', '計算模式', '계산 모드')}</span><select
        value={calcMode}
        disabled={loading}
        onChange={(event) => onCalcModeChange(event.target.value as SkillCalculationMode)}
      >{CALCULATION_MODES.map((option) => <option key={option.value} value={option.value}>{option.label[language]}</option>)}</select></label>
    </div>
    <div className="skill-hit-heading">
      <span>{selectedActor === 'minion' ? l('Minion Hit Damage', '召唤物击中伤害', '召喚物擊中傷害', '소환수 적중 피해') : l('Skill Hit Damage', '技能击中伤害', '技能擊中傷害', '스킬 적중 피해')}</span>
      <strong>{loading ? '...' : `${formatCalculationValue(details?.totalDps ?? result?.TotalDPS, 1, language)} DPS`}</strong>
    </div>
    {!!composition.length && <div className="skill-damage-composition">
      <div className="skill-composition-heading"><span>{l('Final Damage Mix', '最终伤害构成', '最終傷害構成', '최종 피해 구성')}</span><small>{l('By average hit', '按平均击中伤害', '依平均擊中傷害', '평균 적중 기준')}</small></div>
      <div className="skill-composition-bar" aria-label={l('Final damage mix', '最终伤害构成', '最終傷害構成', '최종 피해 구성')}>{composition.map((entry) => {
        const percent = compositionTotal ? entry.average / compositionTotal * 100 : 0
        return <span key={entry.type} className={`damage-${entry.type}`} style={{ width: `${percent}%` }} title={`${DAMAGE_TYPE_LABELS[entry.type][language]} ${formatCalculationValue(percent, 1, language)}%`} />
      })}</div>
      <div className="skill-composition-legend">{composition.map((entry) => {
        const percent = compositionTotal ? entry.average / compositionTotal * 100 : 0
        return <div key={entry.type}><i className={`damage-${entry.type}`} /><span>{DAMAGE_TYPE_LABELS[entry.type][language]}</span><strong>{formatCalculationValue(percent, 1, language)}%</strong></div>
      })}</div>
    </div>}
    <dl className="skill-damage-summary">
      <div><dt>{l('Average Hit', '平均击中伤害', '平均擊中傷害', '평균 적중')}</dt><dd>{loading ? '...' : formatCalculationValue(details?.averageHit ?? result?.AverageHit, 1, language)}</dd></div>
      <div><dt>{l('Attack/Cast Rate', '攻击/施法速率', '攻擊/施法速度', '공격/시전 속도')}</dt><dd>{loading ? '...' : `${formatCalculationValue(details?.speed ?? result?.Speed, 2, language)}/s`}</dd></div>
      <SkillCriticalMetric
        kind="chance"
        value={details?.critChance ?? result?.CritChance}
        breakdown={details?.critChanceBreakdown}
        loading={loading}
        language={language}
      />
      <SkillCriticalMetric
        kind="damage"
        multiplier={details?.critMultiplier ?? result?.CritMultiplier}
        breakdown={details?.critMultiplierBreakdown}
        loading={loading}
        language={language}
      />
      <div><dt>{l('Skill DPS', '技能 DPS', '技能 DPS', '스킬 DPS')}</dt><dd>{loading ? '...' : formatCalculationValue(details?.totalDps ?? result?.TotalDPS, 1, language)}</dd></div>
    </dl>
  </section>
}

function SkillDamageCalculationDetails({
  details,
  loading,
  language,
  catalog,
  statSetIndex,
}: {
  details?: SkillCalculationDetails
  loading: boolean
  language: Language
  catalog: SkillCatalog | null
  statSetIndex: number
}) {
  const l = (en: string, zhCN: string, zhTW: string, koKR: string) => uiText(language, en, zhCN, zhTW, koKR)
  const availableTypes = (details?.damageTypes || []).filter((entry) => entry.type !== 'all'
    && [entry.hitMin, entry.hitMax, entry.addedMin, entry.addedMax].some((value) => value != null && value !== 0))
  const [selectedType, setSelectedType] = useState<SpecificDamageType | 'all'>('all')
  const [selectedBucket, setSelectedBucket] = useState<DamageBucket>('added')
  const activeType = availableTypes.find((entry) => entry.type === selectedType) || availableTypes[0]
  const effects = [
    { key: 'auras', label: l('Aura and Buff Skills', '光环与增益技能', '光環與增益技能', '오라 및 버프 스킬'), values: details?.effects?.aurasAndBuffs || [] },
    { key: 'combat', label: l('Combat Buffs', '战斗增益', '戰鬥增益', '전투 버프'), values: details?.effects?.combatBuffs || [] },
    { key: 'debuffs', label: l('Curses and Debuffs', '诅咒与减益', '詛咒與減益', '저주 및 디버프'), values: details?.effects?.cursesAndDebuffs || [] },
  ]
  const localize = (value: string) => translateCalculationText(value, language)
  const localizeEffect = (value: string) => {
    const entry = resolveSkillCatalogName(value, catalog)
    const name = entry ? getLocalizedSkillName({ name: entry.name }, entry, language) : value
    return translateCalculationTerm(name, language)
  }
  const localizeSource = (value: string) => {
    const item = value.match(/^Item:(\d+):(.+)$/)
    if (item) {
      const fullName = localize(item[2])
      if (fullName !== item[2] || language !== 'zh-rCN') return `${l('Item', '装备', '裝備', '아이템')}：${fullName}`
      const parts = item[2].split(',').map((part) => part.trim())
      const baseName = parts[parts.length - 1] || item[2]
      const localizedBase = localize(baseName)
      return localizedBase !== baseName ? `${l('Item', '装备', '裝備', '아이템')}：${localizedBase}（#${item[1]}）` : `${l('Item', '装备', '裝備', '아이템')} #${item[1]}`
    }
    const skill = value.match(/^Skill:(.+)$/)
    if (skill) {
      const entry = resolveSkillCatalogName(skill[1], catalog)
      const name = entry ? getLocalizedSkillName({ name: entry.name }, entry, language) : localize(skill[1])
      return `${l('Skill', '技能', '技能', '스킬')}：${name}`
    }
    const tree = value.match(/^Tree(?::(.+))?$/)
    if (tree) return tree[1] ? `${l('Passive Tree', '天赋树', '天賦樹', '패시브 트리')} · ${l('Node', '节点', '節點', '노드')} ${tree[1]}` : l('Passive Tree', '天赋树', '天賦樹', '패시브 트리')
    const config = value.match(/^Config(?::(.+))?$/)
    if (config) return config[1] ? `${l('Configuration', '配置', '配置', '설정')} · ${config[1]}` : l('Configuration', '配置', '配置', '설정')
    return localize(value)
  }
  const typeLabel = (value: string) => {
    const weapon = value.match(/^(mainHand|offHand):(.+)$/)
    if (weapon) {
      const hand = weapon[1] === 'mainHand' ? l('Main Hand', '主手', '主手', '주 무기') : l('Off Hand', '副手', '副手', '보조 무기')
      const labels = DAMAGE_TYPE_LABELS[weapon[2] as keyof typeof DAMAGE_TYPE_LABELS]
      return `${hand} · ${labels ? labels[language] : weapon[2]}`
    }
    if (value === 'elemental') return l('Elemental', '元素', '元素', '원소')
    if (value === 'random') return l('Random Element', '随机元素', '隨機元素', '무작위 원소')
    const labels = DAMAGE_TYPE_LABELS[value as keyof typeof DAMAGE_TYPE_LABELS]
    return labels ? labels[language] : value
  }
  const bucketOptions: Array<{ key: DamageBucket; label: string }> = [
    { key: 'added', label: l('Added', '点伤', '附加傷害', '추가') },
    { key: 'increased', label: l('Increased', '提高', '增加', '증가') },
    { key: 'gain', label: l('Gain', '额外获得', '額外獲得', '추가 획득') },
    { key: 'more', label: l('More', '总增', '更多', '증폭') },
    { key: 'levels', label: l('Level Scaling', '等级成长', '等級成長', '레벨 성장') },
  ]
  const sourceRows: Array<{ key: string; value: string; source: string; scope: string; stat: string; kind?: 'skillDamage' }> = []
  if (selectedBucket === 'added') {
    const rows = new Map<string, { min: number; max: number; source: string; damageType: string; stats: Set<string> }>()
    for (const entry of details?.skillDamage || []) {
      const title = entry.damageType.slice(0, 1).toUpperCase() + entry.damageType.slice(1)
      const level = entry.skillLevel == null ? '' : ` · ${l('Level', '等级', '等級', '레벨')} ${formatCalculationValue(entry.skillLevel, 0, language)}`
      const baseMultiplier = Number.isFinite(entry.baseMultiplier) && Math.abs(entry.baseMultiplier - 1) > 0.0001
        ? ` · ${l('Base multiplier', '基础倍率', '基礎倍率', '기본 배율')} x${formatCalculationValue(entry.baseMultiplier, 3, language)}`
        : ''
      sourceRows.push({
        key: `skill:${entry.source}:${entry.damageType}`,
        value: `${formatCalculationValue(entry.min, 1, language)} - ${formatCalculationValue(entry.max, 1, language)}`,
        source: entry.source,
        scope: `${typeLabel(entry.damageType)}${level}${baseMultiplier}`,
        stat: `Skill${title}Damage`,
        kind: 'skillDamage',
      })
    }
    for (const entry of details?.weaponDamage || []) {
      const title = entry.damageType.slice(0, 1).toUpperCase() + entry.damageType.slice(1)
      rows.set(`weapon:${entry.source}:${entry.hand}:${entry.damageType}`, {
        min: entry.min,
        max: entry.max,
        source: entry.source,
        damageType: `${entry.hand}:${entry.damageType}`,
        stats: new Set([`Weapon${title}Damage`]),
      })
    }
    for (const entry of details?.modifiers || []) {
      if (entry.bucket !== 'addedMin' && entry.bucket !== 'addedMax') continue
      const key = `${entry.source}:${entry.damageType}`
      const row = rows.get(key) || { min: 0, max: 0, source: entry.source, damageType: entry.damageType, stats: new Set<string>() }
      if (entry.bucket === 'addedMin') row.min += entry.value
      else row.max += entry.value
      row.stats.add(entry.stat)
      rows.set(key, row)
    }
    for (const [key, row] of rows) sourceRows.push({
      key,
      value: `${formatCalculationValue(row.min, 1, language)} - ${formatCalculationValue(row.max, 1, language)}`,
      source: row.source,
      scope: typeLabel(row.damageType),
      stat: [...row.stats].join(' / '),
    })
  } else if (selectedBucket === 'gain') {
    for (const [index, entry] of (details?.gains || []).entries()) sourceRows.push({
      key: `${entry.source}:${entry.stat}:${entry.fromType}:${entry.toType}:${index}`,
      value: `${formatCalculationValue(entry.value, 2, language)}%`,
      source: entry.source,
      scope: `${typeLabel(entry.fromType)} → ${typeLabel(entry.toType)}`,
      stat: entry.stat,
    })
  } else if (selectedBucket === 'increased' || selectedBucket === 'more') {
    const rows = new Map<string, { value: number; source: string; stat: string; types: Set<string> }>()
    for (const entry of details?.modifiers || []) {
      if (entry.bucket !== selectedBucket) continue
      const key = `${entry.source}:${entry.stat}:${entry.value}`
      const row = rows.get(key) || { value: entry.value, source: entry.source, stat: entry.stat, types: new Set<string>() }
      row.types.add(entry.damageType)
      rows.set(key, row)
    }
    for (const [key, row] of rows) sourceRows.push({
      key,
      value: `${formatCalculationValue(row.value, 2, language)}%`,
      source: row.source,
      scope: [...row.types].map(typeLabel).join(' / '),
      stat: row.stat,
    })
  }
  sourceRows.sort((left, right) => Number.parseFloat(right.value) - Number.parseFloat(left.value))
  const composition = availableTypes.map((entry) => ({
    ...entry,
    average: ((entry.hitMin || 0) + (entry.hitMax || 0)) / 2,
  })).filter((entry) => entry.average > 0)
  const compositionTotal = composition.reduce((total, entry) => total + entry.average, 0)
  const totalDamage = (details?.damageTypes || []).find((entry) => entry.type === 'all')
  const dominantType = composition.reduce<(typeof composition)[number] | undefined>((best, entry) => (
    !best || entry.average > best.average ? entry : best
  ), undefined)
  const strongestIncrease = availableTypes.reduce<(typeof availableTypes)[number] | undefined>((best, entry) => (
    !best || entry.increased > best.increased ? entry : best
  ), undefined)
  const moreSourceCount = new Set((details?.modifiers || []).filter((entry) => entry.bucket === 'more')
    .map((entry) => `${entry.source}:${entry.stat}:${entry.value}`)).size

  if (loading) return <div className="skill-detail-loading">{l('Building damage calculation details...', '正在生成伤害计算详情...', '正在建立傷害計算詳情...', '피해 계산 상세 정보 생성 중...')}</div>

  return <div className="skill-damage-detail-page">
    <section className="skill-detail-block">
      <h3>{l('Current Damage Structure', '当前伤害结构', '目前傷害結構', '현재 피해 구조')}</h3>
      <div className="skill-damage-insights">
        <div><span>{l('Primary damage', '主要伤害', '主要傷害', '주요 피해')}</span><strong>{dominantType ? typeLabel(dominantType.type) : '-'}</strong><small>{dominantType && compositionTotal ? `${formatCalculationValue(dominantType.average / compositionTotal * 100, 1, language)}% ${l('of final damage', '最终伤害', '最終傷害', '최종 피해')}` : '-'}</small></div>
        <div><span>{l('Highest Increased', '最高提高 (Increased)', '最高增加 (Increased)', '가장 높은 증가')}</span><strong>{strongestIncrease ? `${formatCalculationValue(strongestIncrease.increased, 0, language)}%` : '-'}</strong><small>{strongestIncrease ? typeLabel(strongestIncrease.type) : '-'}</small></div>
        <div><span>{l('More sources', '独立总增 (More) 来源', '更多 (More) 來源', '증폭 출처')}</span><strong>{moreSourceCount}</strong><small>{moreSourceCount ? l('multiplicative', '乘法叠加', '乘法疊加', '곱연산') : l('none detected', '当前未检测到', '目前未偵測到', '감지되지 않음')}</small></div>
        <div><span>{l('Gain as Extra', '额外获得 (Gain)', '額外獲得 (Gain)', '추가 획득')}</span><strong>{details?.gains?.length || 0}</strong><small>{l('active sources', '生效来源', '生效來源', '활성 출처')}</small></div>
      </div>
    </section>

    <section className="skill-detail-block">
      <h3>{l('Damage Sources', '伤害来源', '傷害來源', '피해 출처')} {selectedBucket !== 'levels' && <small>{sourceRows.length}</small>}</h3>
      <div className="skill-bucket-switch" role="tablist" aria-label={l('Damage buckets', '伤害乘区', '傷害乘區', '피해 구간')}>{bucketOptions.map((bucket) => <button
        key={bucket.key}
        type="button"
        role="tab"
        aria-selected={selectedBucket === bucket.key}
        className={selectedBucket === bucket.key ? 'active' : ''}
        onClick={() => setSelectedBucket(bucket.key)}
      ><span>{bucket.label}</span><small>{bucket.key === 'added'
        ? l('base damage', '基础伤害', '基礎傷害', '기본 피해')
        : bucket.key === 'increased' ? l('additive', '同乘区相加', '同乘區相加', '가산')
          : bucket.key === 'gain' ? l('as extra', '额外获得', '額外獲得', '추가 획득')
            : bucket.key === 'more' ? l('multiplicative', '独立相乘', '獨立相乘', '곱연산')
              : l('current to 40', '当前至 40 级', '目前至 40 級', '현재부터 40레벨')}</small></button>)}</div>
      {selectedBucket === 'levels' ? <SkillLevelReferencePanel
        details={details}
        loading={loading}
        language={language}
        statSetIndex={statSetIndex}
      /> : sourceRows.length ? <div className="skill-source-list">{sourceRows.map((row) => <div key={row.key}>
        <strong>{row.value}</strong>
        <span>{row.kind === 'skillDamage'
          ? `${l('Skill Damage', '技能伤害', '技能傷害', '스킬 피해')} · ${localizeEffect(row.source)}`
          : localizeSource(row.source)}</span>
        <small>{row.scope}</small>
        <code>{translateCalculationStat(row.stat, language)}</code>
      </div>)}</div> : <p className="skill-detail-empty">{l('No active sources in this bucket.', '当前技能在这个乘区没有可用来源。', '目前技能在此乘區沒有可用來源。', '이 구간에 활성 출처가 없습니다.')}</p>}
    </section>

    {!!availableTypes.length && <section className="skill-detail-block">
      <h3>{l('Damage Type Calculation', '伤害类型计算链', '傷害類型計算鏈', '피해 유형 계산')}</h3>
      <div className="skill-damage-type-switch" role="tablist" aria-label={l('Damage type', '伤害类型', '傷害類型', '피해 유형')}>
        <button
          type="button"
          role="tab"
          aria-selected={selectedType === 'all'}
          className={selectedType === 'all' ? 'active' : ''}
          onClick={() => setSelectedType('all')}
        >{l('Total', '总计', '總計', '합계')}</button>
        {availableTypes.map((entry) => <button
          type="button"
          role="tab"
          aria-selected={entry.type === selectedType}
          className={entry.type === selectedType ? 'active' : ''}
          key={entry.type}
          onClick={() => setSelectedType(entry.type as SpecificDamageType)}
        >{DAMAGE_TYPE_LABELS[entry.type][language]}</button>)}
      </div>
      {selectedType === 'all' && <>
        <dl className="skill-type-summary skill-total-summary">
          <div><dt>{l('Total Hit Range', '总击中范围', '總擊中範圍', '총 적중 범위')}</dt><dd>{formatCalculationValue(totalDamage?.hitMin, 0, language)} - {formatCalculationValue(totalDamage?.hitMax, 0, language)}</dd></div>
          <div><dt>{l('Average Hit', '平均击中', '平均擊中', '평균 적중')}</dt><dd>{formatCalculationValue(details?.averageHit, 1, language)}</dd></div>
          <div><dt>{l('Final DPS', '最终 DPS', '最終 DPS', '최종 DPS')}</dt><dd>{formatCalculationValue(details?.totalDps, 1, language)}</dd></div>
        </dl>
        <div className="skill-total-damage-chain">{composition.map((entry) => <div key={entry.type}>
          <i className={`damage-${entry.type}`} />
          <strong>{typeLabel(entry.type)}</strong>
          <span>{formatCalculationValue(entry.hitMin, 0, language)} - {formatCalculationValue(entry.hitMax, 0, language)}</span>
          <small>{compositionTotal ? `${formatCalculationValue(entry.average / compositionTotal * 100, 1, language)}%` : '-'}</small>
          <em>{entry.effectiveMultiplier == null ? '-' : `${formatCalculationValue(entry.effectiveMultiplier, 3, language)}x`}</em>
        </div>)}</div>
        {!!details?.averageHitBreakdown?.length && <div className="skill-average-hit-breakdown">
          <strong>{l('Critical and Non-critical Summary', '暴击与非暴击汇总', '暴擊與非暴擊彙總', '치명타 및 비치명타 요약')}</strong>
          <ol className="skill-formula-lines compact">{details.averageHitBreakdown.map((line, index) => <li key={`${line}-${index}`}>{localize(line)}</li>)}</ol>
        </div>}
      </>}
      {selectedType !== 'all' && activeType && <>
        <dl className="skill-type-summary">
          <div><dt>{l('Final Hit', '最终击中', '最終擊中', '최종 적중')}</dt><dd>{formatCalculationValue(activeType.hitMin, 0, language)} - {formatCalculationValue(activeType.hitMax, 0, language)}</dd></div>
          <div><dt>{l('Effective Multiplier', '有效伤害乘数', '有效傷害乘數', '유효 피해 배율')}</dt><dd>{activeType.effectiveMultiplier == null ? '-' : `${formatCalculationValue(activeType.effectiveMultiplier, 3, language)}x`}</dd></div>
        </dl>
        {!!activeType.breakdown?.length && <ol className="skill-formula-lines compact">{activeType.breakdown.map((line, index) => <li key={`${line}-${index}`}>{localize(line)}</li>)}</ol>}
        {!!activeType.effectiveBreakdown?.length && <div className="skill-effective-breakdown">
          <strong>{l('Enemy Defence and Damage Taken', '敌人防御与承伤', '敵人防禦與承受傷害', '적 방어 및 받는 피해')}</strong>
          <ol className="skill-formula-lines compact">{activeType.effectiveBreakdown.map((line, index) => <li key={`${line}-${index}`}>{localize(line)}</li>)}</ol>
        </div>}
      </>}
    </section>}

    <section className="skill-detail-block">
      <h3>{l('Active Effects', '当前生效效果', '目前生效效果', '활성 효과')}</h3>
      <div className="skill-effect-groups">{effects.map((effect) => <div key={effect.key}>
        <strong>{effect.label}</strong>
        {effect.values.length
          ? <ul>{effect.values.map((value) => <li key={value}>{localizeEffect(value)}</li>)}</ul>
          : <span>{l('None', '无', '無', '없음')}</span>}
      </div>)}</div>
    </section>

    <section className="skill-detail-block">
      <h3>{l('Final DPS Formula', '最终 DPS 公式', '最終 DPS 公式', '최종 DPS 공식')}</h3>
      {details?.dpsFormula?.length
        ? <ol className="skill-formula-lines">{details.dpsFormula.map((line, index) => <li key={`${line}-${index}`}>{localize(line)}</li>)}</ol>
        : <p className="skill-detail-empty">{l('No hit DPS formula is available for this skill.', '当前技能没有可用的击中 DPS 公式。', '目前技能沒有可用的擊中 DPS 公式。', '이 스킬에는 사용 가능한 적중 DPS 공식이 없습니다.')}</p>}
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
  const l = (en: string, zhCN: string, zhTW: string, koKR: string) => uiText(lang, en, zhCN, zhTW, koKR)
  const importedBuildCode = useTreeStore((state) => state.importedBuildCode)
  const weaponSet = useTreeStore((state) => state.activeWeaponSet)
  const setWeaponSet = useTreeStore((state) => state.setActiveWeaponSet)
  const calcResult = useTreeStore((state) => state.calcResult)
  const calcLoading = useTreeStore((state) => state.calcLoading)
  const calcError = useTreeStore((state) => state.calcError)
  const runCalculation = useTreeStore((state) => state.runCalculation)
  const rankSkillsByDps = useTreeStore((state) => state.rankSkillsByDps)
  const allocatedNodes = useTreeStore((state) => state.allocatedNodes)
  const calculationProfiles = useTreeStore((state) => state.calculationProfiles)
  const activeCalculationProfileId = useTreeStore((state) => state.activeCalculationProfileId)
  const [selectedId, setSelectedId] = useState('')
  const [inspectorOpen, setInspectorOpen] = useState(true)
  const [inspectorPage, setInspectorPage] = useState<'overview' | 'calculation'>('overview')
  const [calcMode, setCalcMode] = useState<SkillCalculationMode>('EFFECTIVE')
  const [skillCalculationSelection, setSkillCalculationSelection] = useState<{
    groupId: string
    activeSkillIndex?: number
    statSetIndex?: number
    minionSkillIndex?: number
    minionStatSetIndex?: number
  }>({ groupId: '' })
  const [catalog, setCatalog] = useState<SkillCatalog | null>(null)
  const [tooltip, setTooltip] = useState<GemTooltipTarget | null>(null)
  const [dpsRanking, setDpsRanking] = useState<Record<string, { dps: number; valid: boolean }> | null>(null)
  const [rankingLoading, setRankingLoading] = useState(false)
  const [rankingError, setRankingError] = useState('')
  const rankingRequestId = useRef(0)

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
  const orderedGroups = useMemo(() => {
    if (!dpsRanking) return skills.groups
    const originalIndex = new Map(skills.groups.map((group, index) => [group.id, index]))
    return [...skills.groups].sort((left, right) => {
      const leftRank = dpsRanking[left.id]
      const rightRank = dpsRanking[right.id]
      if (leftRank?.valid !== rightRank?.valid) return leftRank?.valid ? -1 : 1
      const dpsDifference = (rightRank?.dps || 0) - (leftRank?.dps || 0)
      return dpsDifference || (originalIndex.get(left.id) || 0) - (originalIndex.get(right.id) || 0)
    })
  }, [dpsRanking, skills.groups])

  const restoreSkillOrder = () => {
    rankingRequestId.current += 1
    setDpsRanking(null)
    setRankingLoading(false)
    setRankingError('')
  }

  const toggleDpsRanking = async () => {
    if (dpsRanking) {
      restoreSkillOrder()
      return
    }
    const requestId = ++rankingRequestId.current
    setRankingLoading(true)
    setRankingError('')
    try {
      const entries = await rankSkillsByDps(skills.groups.map((group) => group.id), weaponSet)
      if (requestId !== rankingRequestId.current) return
      setDpsRanking(Object.fromEntries(entries.map((entry) => [entry.groupId, {
        dps: entry.dps,
        valid: entry.valid,
      }])))
    } catch (error) {
      if (requestId !== rankingRequestId.current) return
      setRankingError(error instanceof Error ? error.message : String(error))
    } finally {
      if (requestId === rankingRequestId.current) setRankingLoading(false)
    }
  }

  useEffect(() => {
    restoreSkillOrder()
  }, [importedBuildCode, weaponSet, allocatedNodes, calculationProfiles, activeCalculationProfileId])

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
  const minionSkillIndex = selected && skillCalculationSelection.groupId === selected.id
    ? skillCalculationSelection.minionSkillIndex
    : undefined
  const minionStatSetIndex = selected && skillCalculationSelection.groupId === selected.id
    ? skillCalculationSelection.minionStatSetIndex
    : undefined
  const calculationKey = selected
    ? `${importedBuildCode}:${weaponSet}:${selected.id}:${calcMode}:${activeSkillIndex || ''}:${statSetIndex || ''}:${minionSkillIndex || ''}:${minionStatSetIndex || ''}`
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
      minionSkillIndex,
      minionStatSetIndex,
    })
  }, [selected?.id, importedBuildCode, weaponSet, calcMode, activeSkillIndex, statSetIndex, minionSkillIndex, minionStatSetIndex, calcLoading, calculationKey, runCalculation])

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
      <h2>{l('No skill data', '没有技能数据', '沒有技能數據', '스킬 데이터 없음')}</h2>
      <p>{l('Import a complete PoB2 build to view skill groups.', '导入完整 PoB2 构筑后，这里会显示独立的技能组。', '匯入完整 PoB2 構築後，此處會顯示獨立的技能組。', '완전한 PoB2 빌드를 가져오면 여기에 개별 스킬 그룹이 표시됩니다.')}</p>
    </section>
  }

  return <section className={`skills-workspace${inspectorOpen ? ' inspector-open' : ''}`}>
    <div className="skill-groups-stage">
      <header>
        <div className="skill-groups-header-actions">
          <label>{l('Weapon set', '武器组', '武器組', '무기 세트')}</label>
          <div className="skill-weapon-set-control" role="group" aria-label={l('Weapon set', '武器组', '武器組', '무기 세트')}>
            {([1, 2] as const).map((value) => <button
              key={value}
              type="button"
              className={weaponSet === value ? 'active' : ''}
              aria-pressed={weaponSet === value}
              onClick={() => setWeaponSet(value)}
            >{value === 1 ? 'I' : 'II'}</button>)}
          </div>
          <span>{l('Skill groups', '技能组', '技能組', '스킬 그룹')}</span>
          <button
            type="button"
            className={`skill-dps-sort${dpsRanking ? ' active' : ''}`}
            disabled={rankingLoading}
            onClick={() => void toggleDpsRanking()}
            title={rankingError || (dpsRanking
              ? l('Restore imported skill order', '恢复导入时的技能组顺序', '恢復匯入時的技能組順序', '가져온 스킬 순서 복원')
              : l('Sort by effective DPS, highest first', '按有效 DPS 从高到低排序', '依有效 DPS 由高至低排序', '유효 DPS가 높은 순으로 정렬'))}
          >
            {rankingLoading ? <LoaderCircle className="spinning" /> : dpsRanking ? <RotateCcw /> : <ArrowDownWideNarrow />}
            {rankingLoading
              ? l('Calculating', '计算中', '計算中', '계산 중')
              : dpsRanking
                ? l('Restore', '恢复顺序', '恢復順序', '복원')
                : l('Effective DPS', '有效 DPS 排序', '有效 DPS 排序', '유효 DPS')}
          </button>
          {rankingError && <span className="skill-dps-sort-error" title={rankingError}>!</span>}
        </div>
        <div className="skill-groups-header-meta">
          <strong>{skills.groups.length}</strong>
          {!inspectorOpen && <button
            type="button"
            className="skill-inspector-toggle"
            onClick={() => setInspectorOpen(true)}
            title={l('Open skill details', '打开技能详情', '開啟技能詳情', '스킬 상세 정보 열기')}
            aria-label={l('Open skill details', '打开技能详情', '開啟技能詳情', '스킬 상세 정보 열기')}
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
          <div className="skill-group-rows">{orderedGroups.map((group) => {
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
              <small>{dpsRanking
                ? dpsRanking[group.id]?.valid
                  ? `${l('Effective DPS', '有效 DPS', '有效 DPS', '유효 DPS')} ${formatCalculationValue(dpsRanking[group.id].dps, 1, lang)}`
                  : l('No effective DPS', '无有效 DPS', '無有效 DPS', '유효 DPS 없음')
                : calculatedLevel
                  ? `${l('Effective level', '实际等级', '實際等級', '유효 레벨')} ${calculatedLevel}`
                  : `${l('Gem level', '宝石等级', '寶石等級', '젬 레벨')} ${main.level}`}</small>
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
          <span>{l('Skill details', '技能详情', '技能詳情', '스킬 상세 정보')}</span>
          <h2>{mainName}</h2>
          <small>{translateGameText(mainSkill?.gemType || (mainSkill?.type === 'support' ? 'Support' : 'Skill Gem'), lang)}</small>
        </div>
        <button
          type="button"
          className="skill-inspector-close"
          onClick={() => setInspectorOpen(false)}
          title={l('Close skill details', '关闭技能详情', '關閉技能詳情', '스킬 상세 정보 닫기')}
          aria-label={l('Close skill details', '关闭技能详情', '關閉技能詳情', '스킬 상세 정보 닫기')}
        ><X /></button>
      </header>
      <nav className="skill-inspector-tabs" aria-label={l('Skill detail pages', '技能详情页面', '技能詳情頁面', '스킬 상세 페이지')}>
        <button type="button" className={inspectorPage === 'overview' ? 'active' : ''} onClick={() => setInspectorPage('overview')}>{l('Overview', '概览', '概覽', '개요')}</button>
        <button type="button" className={inspectorPage === 'calculation' ? 'active' : ''} onClick={() => setInspectorPage('calculation')}>{l('Damage Calculation', '伤害计算', '傷害計算', '피해 계산')}</button>
      </nav>
      <div className="skill-inspector-scroll">
        {inspectorPage === 'calculation' && <>
          <SkillCalculationPanel
            details={calculationDetails}
            result={selectedCalculation}
            loading={calcLoading}
            groupName={mainName}
            activeSkillIndex={activeSkillIndex}
            statSetIndex={statSetIndex}
            minionSkillIndex={minionSkillIndex}
            minionStatSetIndex={minionStatSetIndex}
            calcMode={calcMode}
            language={lang}
            catalog={catalog}
            onActiveSkillChange={(value) => setSkillCalculationSelection({
              groupId: selected.id,
              activeSkillIndex: value,
            })}
            onStatSetChange={(value) => setSkillCalculationSelection({
              groupId: selected.id,
              activeSkillIndex: activeSkillIndex ?? calculationDetails?.activeSkillIndex,
              statSetIndex: value,
            })}
            onMinionSkillChange={(value) => setSkillCalculationSelection({
              ...skillCalculationSelection,
              groupId: selected.id,
              minionSkillIndex: value,
              minionStatSetIndex: undefined,
            })}
            onMinionStatSetChange={(value) => setSkillCalculationSelection({
              ...skillCalculationSelection,
              groupId: selected.id,
              minionSkillIndex: minionSkillIndex ?? calculationDetails?.minionSkillIndex,
              minionStatSetIndex: value,
            })}
            onCalcModeChange={setCalcMode}
          />
          {calcError && lastCalculationKey.current === calculationKey && <p className="skill-calculation-error">{calcError}</p>}
          <SkillDamageCalculationDetails
            details={calculationDetails}
            loading={calcLoading}
            language={lang}
            catalog={catalog}
            statSetIndex={calculationDetails?.actor === 'minion'
              ? (minionStatSetIndex ?? calculationDetails?.minionStatSetIndex ?? 1)
              : (statSetIndex ?? calculationDetails?.statSetIndex ?? 1)}
          />
        </>}
        {inspectorPage === 'overview' && <>
        <section className="skill-inspector-overview">
          {description
            ? <p className="skill-description">{description}</p>
            : <p className="skill-description muted">{l('No upstream description available', '上游暂无技能描述', '上游暫無技能描述', '원본 스킬 설명이 없습니다')}</p>}
          {!!tags.length && <div className="skill-tags">
            {tags.map((tag) => <span key={tag}>{tag}</span>)}
          </div>}
          <dl>
            <div><dt>{l('Gem level', '宝石等级', '寶石等級', '젬 레벨')}</dt><dd>{mainGem.level}</dd></div>
            <div><dt>{l('Effective level', '实际等级', '實際等級', '유효 레벨')}</dt><dd>{calcLoading ? '...' : (selectedCalculation?.SkillLevel ?? '-')}</dd></div>
            <div><dt>{l('Quality', '品质', '品質', '퀄리티')}</dt><dd>{mainGem.quality}%</dd></div>
            <div><dt>{l('Variant', '变体', '變體', '변형')}</dt><dd>{mainGem.variantId || '-'}</dd></div>
          </dl>
        </section>
        <section className="skill-inspector-section">
          <h3><span>{l('Support gems', '辅助宝石', '輔助寶石', '보조 젬')}</span><small>{supports.length}</small></h3>
          <div className="skill-support-list">{supports.map((gem, index) => {
            const detail = resolveSkillCatalogEntry(gem, catalog)
            const name = getLocalizedSkillName(gem, detail, lang)
            const supportDescription = getLocalizedSkillDescription(detail, lang)
            const effectLines = getLocalizedSupportEffectLines(detail, gem.quality, lang)
            return <div
              className="skill-support-row"
              key={`${gem.gemId}-${index}`}
              onMouseEnter={(event) => showTooltip(event, gem, detail)}
              onMouseLeave={() => setTooltip(null)}
            >
              <FallbackImage src={detail?.icon || undefined} alt="" fallback={<span>{name.slice(0, 1)}</span>} />
              <div>
                <strong>{name}</strong>
                {supportDescription && <p>{supportDescription}</p>}
                {effectLines.length > 0 && <ul className="skill-support-effects">
                  {effectLines.map((line) => <li key={line}>{line}</li>)}
                </ul>}
              </div>
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

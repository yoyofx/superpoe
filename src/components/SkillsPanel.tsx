import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
} from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown, ChevronRight, CircleHelp, Info, LoaderCircle, PanelLeftClose, PanelLeftOpen, PanelRightOpen, Pencil, Sparkles, X } from 'lucide-react'
import { FallbackImage } from '@/components/FallbackImage'
import { GemTooltip, type GemTooltipTarget } from '@/components/GemTooltip'
import { getImportedCalculationModeFromCode, getImportedCalculationModeFromObject } from '@/engine/calculationConfig'
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
import { parseSkillsCode, parseSkillsObject } from '@/engine/skills'
import { translateCalculationStat, translateCalculationTerm, translateCalculationText } from '@/i18n/calculationTranslations'
import { translateGameText, type Language } from '@/i18n/translationLoader'
import { useTranslation } from '@/i18n/useTranslation'
import { formatUiNumber, uiText, type UiMessage } from '@/i18n/uiLocale'
import { getActiveBuildSession, useTreeStore } from '@/store/treeStore'
import type { CalcResult, SkillCalculationDetails, SkillCalculationMode, SkillDpsEntry, SkillLevelReference } from '@/types/calc'

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
type DamageBucket = 'added' | 'increased' | 'gain' | 'convert' | 'more' | 'levels'

function SkillGemEditor({
  gem,
  language,
  onChange,
}: {
  gem: NonNullable<ReturnType<typeof parseSkillsObject>['groups']>[number]['gems'][number]
  language: Language
  onChange: (attributes: Record<string, string>) => void
}) {
  const l = (en: string, zhCN: string, zhTW: string, koKR: string) => uiText(language, en, zhCN, zhTW, koKR)
  const [level, setLevel] = useState(String(gem.level))
  const [quality, setQuality] = useState(String(gem.quality))

  useEffect(() => {
    setLevel(String(gem.level))
    setQuality(String(gem.quality))
  }, [gem.level, gem.quality])

  const commitNumber = (value: string, key: 'level' | 'quality', minimum: number, maximum: number, fallback: number) => {
    const parsed = Number(value)
    const next = Number.isFinite(parsed) ? Math.min(maximum, Math.max(minimum, Math.round(parsed))) : fallback
    const nextValue = String(next)
    if (key === 'level') setLevel(nextValue)
    else setQuality(nextValue)
    if (next !== (key === 'level' ? gem.level : gem.quality)) onChange({ [key]: nextValue })
  }

  return <div className="skill-gem-editor" onClick={(event) => event.stopPropagation()} onMouseEnter={(event) => event.stopPropagation()}>
    <label title={l('Gem level', '宝石等级', '寶石等級', '젬 레벨')}>
      <span>Lv</span>
      <input
        type="number"
        min="1"
        max="40"
        value={level}
        aria-label={l('Gem level', '宝石等级', '寶石等級', '젬 레벨')}
        onChange={(event) => setLevel(event.target.value)}
        onBlur={() => commitNumber(level, 'level', 1, 40, gem.level)}
        onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur() }}
      />
    </label>
    <label title={l('Gem quality', '宝石品质', '寶石品質', '젬 퀄리티')}>
      <input
        type="number"
        min="0"
        max="100"
        value={quality}
        aria-label={l('Gem quality', '宝石品质', '寶石品質', '젬 퀄리티')}
        onChange={(event) => setQuality(event.target.value)}
        onBlur={() => commitNumber(quality, 'quality', 0, 100, gem.quality)}
        onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur() }}
      />
      <span>%</span>
    </label>
    <label className="skill-gem-enabled" title={l('Enable gem', '启用宝石', '啟用寶石', '젬 활성화')}>
      <input
        type="checkbox"
        checked={gem.enabled}
        aria-label={l('Enable gem', '启用宝石', '啟用寶石', '젬 활성화')}
        onChange={(event) => onChange({ enabled: String(event.target.checked) })}
      />
      <Check aria-hidden="true" />
    </label>
  </div>
}

function formatCalculationValue(value: number | undefined, decimals: number, language: Language): string {
  if (!Number.isFinite(value)) return '-'
  return formatUiNumber(value as number, language, { maximumFractionDigits: decimals })
}

function formatDpsValue(value: number | undefined, language: Language): string {
  if (!Number.isFinite(value)) return '-'
  const numeric = value as number
  const absolute = Math.abs(numeric)
  if (absolute >= 1_000_000) return `${formatCalculationValue(numeric / 1_000_000, 1, language)}M`
  if (absolute >= 1_000) return `${formatCalculationValue(numeric / 1_000, 1, language)}k`
  return formatCalculationValue(numeric, 0, language)
}

function isSyntheticDpsEntry(name: string): boolean {
  return /^(?:Best .+ DPS|Full (?:Impale|Decay|DoT|Culling) DPS)$/i.test(name.trim())
}

function normalizeSkillOptionName(value: string | undefined): string {
  return (value || '')
    .replace(/\^[0-9A-Za-z]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleLowerCase()
}

function skillNamesMatch(left: string | undefined, right: string | undefined): boolean {
  const leftName = normalizeSkillOptionName(left)
  const rightName = normalizeSkillOptionName(right)
  return Boolean(leftName && rightName && (
    leftName === rightName
    || leftName.startsWith(`${rightName}:`)
    || rightName.startsWith(`${leftName}:`)
  ))
}

function skillMetadataMatches(left: string | undefined, right: string | undefined): boolean {
  const leftName = normalizeSkillOptionName(left)
  const rightName = normalizeSkillOptionName(right)
  return Boolean(leftName && rightName && (
    skillNamesMatch(leftName, rightName)
    || leftName.includes(rightName)
    || rightName.includes(leftName)
  ))
}

function getDpsSkillNameCandidates(entry: SkillDpsEntry): string[] {
  const candidates = [entry.name, entry.skillPart]
  if (entry.skillPart) candidates.push(entry.skillPart.split(':', 1)[0])
  return [...new Set(candidates
    .map(normalizeSkillOptionName)
    .filter(Boolean))]
}

function findActiveSkillOptionIndex(details: SkillCalculationDetails, entry: SkillDpsEntry): number | undefined {
  const candidates = getDpsSkillNameCandidates(entry)
  if (!candidates.length) return undefined
  const match = details.activeSkills
    .map((option) => {
      const optionNameMatches = candidates.some((candidate) => skillNamesMatch(option.label, candidate))
      if (!optionNameMatches) return { option, score: -1 }
      let score = 10
      if (entry.skillId && option.skillId === entry.skillId) score += 1000
      if (entry.trigger && option.trigger && skillMetadataMatches(entry.trigger, option.trigger)) score += 100
      if (entry.skillPart && option.skillPart && skillMetadataMatches(entry.skillPart, option.skillPart)) score += 50
      return { option, score }
    })
    .filter((candidate) => candidate.score >= 0)
    .sort((left, right) => right.score - left.score)[0]?.option
  return match?.index
}

interface SkillDpsSnapshot {
  allEntries: SkillDpsEntry[]
  fullEntries: SkillDpsEntry[]
  fullDps?: number
}

type NormalizedSkillDpsEntry = SkillDpsEntry & {
  rowKey: string
  totalDps: number
}

function SkillDpsDrawer({
  fullEntries,
  allEntries,
  fullDps,
  groups,
  catalog,
  language,
  loading,
  error,
  selectedGroupId,
  onSelectEntry,
  onToggleGroup,
  onClose,
}: {
  fullEntries: SkillDpsEntry[]
  allEntries: SkillDpsEntry[]
  fullDps?: number
  groups: ReturnType<typeof parseSkillsObject>['groups']
  catalog: SkillCatalog | null
  language: Language
  loading: boolean
  error: string | null
  selectedGroupId?: string
  onSelectEntry: (entry: SkillDpsEntry, groupId: string) => void
  onToggleGroup: (groupId: string, include: boolean) => void
  onClose: () => void
}) {
  const l = (en: string, zhCN: string, zhTW: string, koKR: string) => uiText(language, en, zhCN, zhTW, koKR)
  const [expandedKey, setExpandedKey] = useState<string | null>(null)
  const normalizeEntries = (entries: SkillDpsEntry[], includeSynthetic: boolean): NormalizedSkillDpsEntry[] => entries
    .map((entry, index) => ({
      ...entry,
      rowKey: [entry.groupId || '', entry.skillId || '', entry.name, entry.trigger || '', entry.skillPart || '', index].join('|'),
      totalDps: (entry.dps || 0) * (entry.count || 1),
    }))
    .filter((entry) => (includeSynthetic || !isSyntheticDpsEntry(entry.name)) && entry.totalDps > 0)
    .sort((left, right) => right.totalDps - left.totalDps)
  const includedEntries = useMemo(() => normalizeEntries(fullEntries, false), [fullEntries])
  const orderedEntries = useMemo(() => normalizeEntries(allEntries, false), [allEntries])
  const unIncludedEntries = useMemo(() => orderedEntries.filter((entry) => {
    if (!entry.groupId) return true
    return !groups.find((group) => group.id === entry.groupId)?.includeInFullDps
  }), [groups, orderedEntries])
  const highestDps = unIncludedEntries[0]?.totalDps || 1

  const getSkillPresentation = (entry: SkillDpsEntry) => {
    const entryCandidates = getDpsSkillNameCandidates(entry)
    const matchesEntry = (gem: (typeof groups)[number]['gems'][number]) => Boolean(
      (entry.skillId && gem.skillId === entry.skillId)
      || entryCandidates.some((candidate) => skillNamesMatch(gem.name, candidate)),
    )
    const scoredGroups = groups.map((item, index) => {
      let score = 0
      if (item.gems.some(matchesEntry)) score += 20
      if (entry.trigger && item.gems.some((gem) => skillMetadataMatches(entry.trigger, gem.name))) score += 100
      if (entry.skillPart && item.gems.some((gem) => skillMetadataMatches(entry.skillPart, gem.name))) score += 10
      return { item, index, score }
    })
    const group = entry.groupId
      ? groups.find((item) => item.id === entry.groupId)
      : scoredGroups
        .filter((candidate) => candidate.score > 0)
        .sort((left, right) => right.score - left.score || left.index - right.index)[0]?.item
    const groupGem = group?.gems[0]
    const matchingGem = group?.gems.find(matchesEntry)
    const gemLike = {
      name: entry.name,
      skillId: entry.skillId || '',
      gemId: entry.skillId || '',
      variantId: '',
    }
    const displayGem = matchingGem || gemLike
    const detail = resolveSkillCatalogEntry(displayGem, catalog) || resolveSkillCatalogName(entry.name, catalog)
    const localizedName = getLocalizedSkillName(displayGem, detail, language)
    return { group, groupGem, matchingGem, detail, localizedName }
  }

  const renderEntry = (entry: NormalizedSkillDpsEntry, index: number, section: 'full' | 'ranking') => {
    const { group, groupGem, detail, localizedName } = getSkillPresentation(entry)
    const entryKey = `${section}:${entry.rowKey}`
    const expanded = expandedKey === entryKey
    const kindLabel = entry.kind === 'trigger' || entry.trigger
      ? l('Trigger', '触发', '觸發', '트리거')
      : entry.kind === 'minion'
        ? l('Minion', '召唤物', '召喚物', '미니언')
        : entry.kind === 'mirage'
          ? l('Mirage', '幻影', '幻影', '미라지')
          : entry.kind === 'dot'
            ? 'DOT'
            : ''
    const source = entry.trigger || entry.skillPart || ''
    const selectionEntry = group?.id && entry.groupId !== group.id
      ? { ...entry, groupId: group.id }
      : entry
    const toggleEnabled = Boolean(group?.id)
    const handleSelect = () => {
      setExpandedKey((current) => current === entryKey ? null : entryKey)
      if (group?.id) onSelectEntry(selectionEntry, group.id)
    }
    return <article
      key={entryKey}
      className={`skill-dps-entry${expanded ? ' expanded' : ''}${group?.id === selectedGroupId ? ' related' : ''}${section === 'full' ? ' full' : ''}`}
      role={group?.id ? 'button' : undefined}
      tabIndex={group?.id ? 0 : -1}
      onClick={handleSelect}
      onKeyDown={(event) => {
        if (!group?.id || (event.key !== 'Enter' && event.key !== ' ')) return
        event.preventDefault()
        handleSelect()
      }}
    >
      <div className="skill-dps-entry-main">
        <span className="skill-dps-entry-rank">{index + 1}</span>
        <span className="skill-dps-entry-icon">
          <FallbackImage src={detail?.icon || undefined} alt="" fallback={<Sparkles />} />
        </span>
        <span className="skill-dps-entry-copy">
          <strong>{localizedName || entry.name}</strong>
          <small>
            {kindLabel && <em>{kindLabel}</em>}
            {source && <span>{source}</span>}
            {!kindLabel && !source && <span>{l('Calculated skill', '已计算技能', '已計算技能', '계산된 스킬')}</span>}
          </small>
        </span>
        <span className="skill-dps-entry-value">
          <span className="skill-dps-entry-number">
            <strong>{formatDpsValue(entry.totalDps, language)}</strong>
            <ChevronDown className="skill-dps-entry-chevron" />
          </span>
          {section === 'ranking' && <span className="skill-dps-entry-meter" aria-hidden="true"><i style={{ width: `${Math.max(3, entry.totalDps / highestDps * 100)}%` }} /></span>}
        </span>
      </div>
      {expanded && <div className="skill-dps-entry-details">
        <div><span>{l('Skill DPS', '技能 DPS', '技能 DPS', '스킬 DPS')}</span><strong>{formatCalculationValue(entry.dps, 1, language)}</strong></div>
        {entry.count !== 1 && <div><span>{l('Count', '次数', '次數', '횟수')}</span><strong>x{formatCalculationValue(entry.count, 2, language)}</strong></div>}
        {entry.skillPart && <div><span>{l('Skill part', '技能部件', '技能部件', '스킬 부위')}</span><strong>{entry.skillPart}</strong></div>}
        {entry.trigger && <div><span>{l('Trigger source', '触发来源', '觸發來源', '트리거 출처')}</span><strong>{entry.trigger}</strong></div>}
        {group && <div><span>{l('Skill group', '技能组', '技能組', '스킬 그룹')}</span><strong>{groupGem ? getLocalizedSkillName(groupGem, resolveSkillCatalogEntry(groupGem, catalog), language) : group.id}</strong></div>}
        {toggleEnabled && group && <label
          className="skill-dps-include-toggle"
          title={l('This setting applies to the whole skill group.', '此设置对整个技能组生效。', '此設定對整個技能組生效。', '이 설정은 전체 스킬 그룹에 적용됩니다.')}
          onClick={(event) => event.stopPropagation()}
        >
          <span>
            <strong>{l('Include in Full DPS', '计入完整 DPS', '計入完整 DPS', '전체 DPS에 포함')}</strong>
            <small>{l('Applies to this skill group', '按技能组生效', '按技能組生效', '스킬 그룹 단위')}</small>
          </span>
          <input
            type="checkbox"
            checked={group.includeInFullDps}
            disabled={!group.enabled || loading}
            aria-label={l('Include skill group in Full DPS', '将技能组计入完整 DPS', '將技能組計入完整 DPS', '스킬 그룹을 전체 DPS에 포함')}
            onChange={(event) => onToggleGroup(group.id, event.target.checked)}
          />
        </label>}
      </div>}
    </article>
  }

  return <aside className="skill-dps-drawer" aria-label={l('Skill DPS', '技能 DPS', '技能 DPS', '스킬 DPS')}>
    <header className="skill-dps-drawer-header">
      <div>
        <span>{l('Skill DPS', '技能 DPS', '技能 DPS', '스킬 DPS')}</span>
        <small>{l('Runtime skills, including triggers', '包含触发技能的运行时技能', '包含觸發技能的執行時技能', '트리거를 포함한 런타임 스킬')}</small>
      </div>
      <button
        type="button"
        className="skill-dps-drawer-close"
        onClick={onClose}
        title={l('Close Skill DPS', '关闭技能 DPS', '關閉技能 DPS', '스킬 DPS 닫기')}
        aria-label={l('Close Skill DPS', '关闭技能 DPS', '關閉技能 DPS', '스킬 DPS 닫기')}
      ><PanelLeftClose /></button>
    </header>
    <div className="skill-dps-drawer-meta">
      <span>{l('Full DPS sources and all runtime skills', '完整 DPS 来源与全部运行时技能', '完整 DPS 來源與全部執行時技能', '전체 DPS 원천 및 모든 런타임 스킬')}</span>
      {loading && <LoaderCircle className="spinning" aria-label={l('Calculating', '计算中', '計算中', '계산 중')} />}
    </div>
    <div className="skill-dps-drawer-list">
      {error && <p className="skill-dps-drawer-message error">{error}</p>}
      {!error && loading && !allEntries.length && <p className="skill-dps-drawer-message">{l('Calculating skill DPS...', '正在计算技能 DPS…', '正在計算技能 DPS…', '스킬 DPS 계산 중...')}</p>}
      <section className="skill-dps-section skill-dps-section-full">
        <header className="skill-dps-section-header">
          <div>
            <h3>{l('Included in Full DPS', '计入完整 DPS', '計入完整 DPS', '전체 DPS에 포함')}</h3>
            <small>{l('Skill sources; derived damage stays in the total', '技能来源；派生伤害仍计入总值', '技能來源；衍生傷害仍計入總值', '스킬 원천; 파생 피해는 총합에 포함')}</small>
          </div>
          <strong>{formatDpsValue(fullDps, language)} <small>DPS</small></strong>
        </header>
        {includedEntries.length
          ? <div className="skill-dps-section-list">{includedEntries.map((entry, index) => renderEntry(entry, index, 'full'))}</div>
          : <p className="skill-dps-drawer-message">{l('No direct skill source is included. Derived damage remains in the total.', '当前没有可显示的直接技能来源，派生伤害仍计入总值。', '目前沒有可顯示的直接技能來源，衍生傷害仍計入總值。', '표시할 직접 스킬 원천이 없습니다. 파생 피해는 총합에 포함됩니다.')}</p>}
      </section>
      <section className="skill-dps-section skill-dps-section-ranking">
        <header className="skill-dps-section-header">
          <div>
            <h3>{l('Skill DPS Ranking', '技能 DPS 排序', '技能 DPS 排序', '스킬 DPS 순위')}</h3>
            <small>{l('Skills not included in Full DPS', '未计入完整 DPS 的技能', '未計入完整 DPS 的技能', '전체 DPS에 포함되지 않은 스킬')}</small>
          </div>
          {loading && <LoaderCircle className="spinning" aria-hidden="true" />}
        </header>
        {!unIncludedEntries.length && !loading && <p className="skill-dps-drawer-message">{orderedEntries.length
          ? l('All direct skills are included in Full DPS.', '所有直接技能都已计入完整 DPS。', '所有直接技能都已計入完整 DPS。', '모든 직접 스킬이 전체 DPS에 포함되어 있습니다.')
          : l('No individual skill DPS is available.', '暂无独立技能 DPS 数据。', '暫無獨立技能 DPS 資料。', '개별 스킬 DPS가 없습니다.')}</p>}
        <div className="skill-dps-section-list">{unIncludedEntries.map((entry, index) => renderEntry(entry, index, 'ranking'))}</div>
      </section>
    </div>
  </aside>
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
    .map((entry) => ({ ...entry, average: entry.finalAverage ?? ((entry.hitMin || 0) + (entry.hitMax || 0)) / 2 }))
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
  skillName,
}: {
  details?: SkillCalculationDetails
  loading: boolean
  language: Language
  catalog: SkillCatalog | null
  statSetIndex: number
  skillName: string
}) {
  const l = (en: string, zhCN: string, zhTW: string, koKR: string) => uiText(language, en, zhCN, zhTW, koKR)
  const availableTypes = (details?.damageTypes || []).filter((entry) => entry.type !== 'all'
    && [entry.hitMin, entry.hitMax, entry.addedMin, entry.addedMax].some((value) => value != null && value !== 0))
  const [selectedType, setSelectedType] = useState<SpecificDamageType | 'all'>('all')
  const [selectedBucket, setSelectedBucket] = useState<DamageBucket>('added')
  const [interpretationOpen, setInterpretationOpen] = useState(false)
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
  const localizeDamageSource = (value: string, bucket: DamageBucket) => {
    const source = localizeSource(value)
    if (!/^(?:Skill:)?Trinity$/i.test(value.trim())) return source
    if (bucket === 'more') return `${source} · ${l('Resonance', '共振', '共振', '공명')}`
    if (bucket === 'convert') return `${source} · ${l('additional Gem Quality effect', '宝石品质附加效果', '寶石品質附加效果', '젬 퀄리티 추가 효과')}`
    return source
  }
  const typeLabel = (value: string) => {
    const weapon = value.match(/^(mainHand|offHand):(.+)$/)
    if (weapon) {
      const hand = weapon[1] === 'mainHand' ? l('Main Hand', '主手', '主手', '주 무기') : l('Off Hand', '副手', '副手', '보조 무기')
      const labels = DAMAGE_TYPE_LABELS[weapon[2] as keyof typeof DAMAGE_TYPE_LABELS]
      return `${hand} · ${labels ? labels[language] : weapon[2]}`
    }
    if (value === 'elemental') return l('Elemental', '元素', '元素', '원소')
    if (value === 'nonChaos') return l('Non-Chaos', '非混沌', '非混沌', '비카오스')
    if (value === 'random') return l('Random Element', '随机元素', '隨機元素', '무작위 원소')
    const labels = DAMAGE_TYPE_LABELS[value as keyof typeof DAMAGE_TYPE_LABELS]
    return labels ? labels[language] : value
  }
  const bucketOptions: Array<{ key: DamageBucket; label: string }> = [
    { key: 'added', label: l('Added', '点伤', '附加傷害', '추가') },
    { key: 'increased', label: l('Increased', '提高', '增加', '증가') },
    { key: 'gain', label: l('Gain', '额外获得', '額外獲得', '추가 획득') },
    { key: 'convert', label: l('Convert', '转换', '轉換', '전환') },
    { key: 'more', label: l('More', '总增', '更多', '증폭') },
    { key: 'levels', label: l('Level Scaling', '等级成长', '等級成長', '레벨 성장') },
  ]
  const sourceRows: Array<{
    key: string
    value: string
    source: string
    scope: string
    stat: string
    kind?: 'skillDamage'
    transfer?: { fromType: string; toType: string }
  }> = []
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
      transfer: { fromType: entry.fromType, toType: entry.toType },
    })
  } else if (selectedBucket === 'convert') {
    for (const [index, entry] of (details?.conversions || []).entries()) sourceRows.push({
      key: `${entry.source}:${entry.stat}:${entry.fromType}:${entry.toType}:${index}`,
      value: `${formatCalculationValue(entry.value, 2, language)}%`,
      source: entry.source,
      scope: `${typeLabel(entry.fromType)} → ${typeLabel(entry.toType)}`,
      stat: entry.stat,
      transfer: { fromType: entry.fromType, toType: entry.toType },
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
    average: entry.finalAverage ?? ((entry.hitMin || 0) + (entry.hitMax || 0)) / 2,
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
  const gainSourceCount = new Set((details?.gains || []).map((entry) => `${entry.source}:${entry.stat}:${entry.value}`)).size

  const baseDamagePools = new Map<SpecificDamageType, number>()
  const interpretedBaseSources: Array<{
    key: string
    kind: 'skill' | 'weapon' | 'added'
    source: string
    damageType: SpecificDamageType
    min: number
    max: number
    average: number
  }> = []
  const addToBasePool = (damageType: string, value: number) => {
    if (!(damageType in DAMAGE_TYPE_LABELS) || damageType === 'all' || !Number.isFinite(value)) return
    const type = damageType as SpecificDamageType
    baseDamagePools.set(type, (baseDamagePools.get(type) || 0) + value)
  }
  for (const [index, entry] of (details?.skillDamage || []).entries()) {
    const average = (entry.min + entry.max) / 2
    addToBasePool(entry.damageType, average)
    interpretedBaseSources.push({ key: `skill:${index}:${entry.damageType}`, kind: 'skill', source: entry.source, damageType: entry.damageType as SpecificDamageType, min: entry.min, max: entry.max, average })
  }
  for (const [index, entry] of (details?.weaponDamage || []).entries()) {
    const average = (entry.min + entry.max) / 2
    addToBasePool(entry.damageType, average)
    interpretedBaseSources.push({ key: `weapon:${index}:${entry.damageType}`, kind: 'weapon', source: entry.source, damageType: entry.damageType as SpecificDamageType, min: entry.min, max: entry.max, average })
  }
  const addedDamageRows = new Map<string, { source: string; damageType: string; min: number; max: number }>()
  for (const entry of details?.modifiers || []) {
    if (entry.bucket !== 'addedMin' && entry.bucket !== 'addedMax') continue
    const key = `${entry.source}:${entry.damageType}`
    const row = addedDamageRows.get(key) || { source: entry.source, damageType: entry.damageType, min: 0, max: 0 }
    if (entry.bucket === 'addedMin') row.min += entry.value
    else row.max += entry.value
    addedDamageRows.set(key, row)
  }
  for (const [key, row] of addedDamageRows) {
    if (!(row.damageType in DAMAGE_TYPE_LABELS) || row.damageType === 'all') continue
    const average = (row.min + row.max) / 2
    addToBasePool(row.damageType, average)
    interpretedBaseSources.push({ key: `added:${key}`, kind: 'added', source: row.source, damageType: row.damageType as SpecificDamageType, min: row.min, max: row.max, average })
  }

  const sourcePool = (fromType: string) => {
    const value = (type: SpecificDamageType) => baseDamagePools.get(type) || 0
    if (fromType === 'all') return [...baseDamagePools.values()].reduce((sum, entry) => sum + entry, 0)
    if (fromType === 'elemental') return value('lightning') + value('cold') + value('fire')
    if (fromType === 'nonChaos') return value('physical') + value('lightning') + value('cold') + value('fire')
    return value(fromType as SpecificDamageType)
  }
  const interpretedGains = (details?.gains || []).map((entry) => ({
    ...entry,
    rawContribution: sourcePool(entry.fromType) * entry.value / 100,
  }))
  const gainContributions = new Map<SpecificDamageType, number>()
  for (const entry of interpretedGains) {
    if (!(entry.toType in DAMAGE_TYPE_LABELS)) continue
    const type = entry.toType as SpecificDamageType
    gainContributions.set(type, (gainContributions.get(type) || 0) + entry.rawContribution)
  }
  const interpretedPoolTypes = [...baseDamagePools.keys(), ...gainContributions.keys()]
    .filter((type, index, list) => list.indexOf(type) === index)
  const interpretedPools = interpretedPoolTypes.map((type) => ({
    type,
    base: baseDamagePools.get(type) || 0,
    gain: gainContributions.get(type) || 0,
  })).map((entry) => ({ ...entry, total: entry.base + entry.gain }))
    .filter((entry) => entry.total > 0)
    .sort((left, right) => right.total - left.total)
  const largestInterpretedPool = interpretedPools[0]?.total || 0
  const largestInterpretedType = interpretedPools[0]?.type
  const structureExplanation = dominantType && largestInterpretedType
    ? dominantType.type === largestInterpretedType
      ? l(
        `${typeLabel(dominantType.type)} has the largest recognised pool before later scaling and remains the largest final damage type.`,
        `${typeLabel(dominantType.type)}在进入后续乘区前就拥有最大的已识别伤害池，并且最终仍是占比最高的伤害类型。`,
        `${typeLabel(dominantType.type)}在進入後續乘區前就擁有最大的已識別傷害池，並且最終仍是佔比最高的傷害類型。`,
        `${typeLabel(dominantType.type)}은(는) 후속 배율 전에도 가장 큰 피해 풀을 가지며 최종 피해에서도 가장 큰 비중을 유지합니다.`,
      )
      : l(
        `${typeLabel(largestInterpretedType)} has the largest recognised pool before later scaling, but ${typeLabel(dominantType.type)} becomes the largest final type after modifiers and enemy defence are applied.`,
        `进入后续乘区前，最大的已识别伤害池是${typeLabel(largestInterpretedType)}；应用类型修正与敌人防御后，${typeLabel(dominantType.type)}成为最终占比最高的类型。`,
        `進入後續乘區前，最大的已識別傷害池是${typeLabel(largestInterpretedType)}；套用類型修正與敵人防禦後，${typeLabel(dominantType.type)}成為最終佔比最高的類型。`,
        `후속 배율 전 가장 큰 피해 풀은 ${typeLabel(largestInterpretedType)}이지만 유형 보정과 적 방어 적용 후에는 ${typeLabel(dominantType.type)}이(가) 가장 큰 최종 유형이 됩니다.`,
      )
    : ''
  const simpleDps = (details?.averageHit || 0) * (details?.speed || 0)
  const usesSimpleDpsFormula = Boolean(details?.totalDps && Math.abs(simpleDps - details.totalDps) / details.totalDps < 0.005)
  const expectedCritMultiplier = details?.critChance != null && details?.critMultiplier != null
    ? 1 + details.critChance / 100 * (details.critMultiplier - 1)
    : undefined
  const selectedSkillLabel = details?.activeSkills?.find((entry) => entry.index === details.activeSkillIndex)?.label
    || details?.activeSkills?.[0]?.label
  const interpretedSkillName = localizeEffect(selectedSkillLabel || skillName)
  const documentZoom = Number.parseFloat(document.documentElement.style.zoom) || 1
  const interpretationViewportStyle = {
    '--skill-interpretation-max-width': `${Math.max(280, window.innerWidth / documentZoom - 32)}px`,
    '--skill-interpretation-max-height': `${Math.max(320, window.innerHeight / documentZoom - 32)}px`,
  } as CSSProperties

  useEffect(() => {
    if (!interpretationOpen) return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setInterpretationOpen(false)
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [interpretationOpen])

  if (loading) return <div className="skill-detail-loading">{l('Building damage calculation details...', '正在生成伤害计算详情...', '正在建立傷害計算詳情...', '피해 계산 상세 정보 생성 중...')}</div>

  return <div className="skill-damage-detail-page">
    <section className="skill-detail-block">
      <h3><span>{l('Current Damage Structure', '当前伤害结构', '目前傷害結構', '현재 피해 구조')}</span><button
        type="button"
        className="skill-interpretation-trigger"
        onClick={() => setInterpretationOpen(true)}
        title={l('Explain this skill damage', '查看当前技能的伤害解读', '查看目前技能的傷害解讀', '현재 스킬 피해 해설 보기')}
        aria-label={l('Explain this skill damage', '查看当前技能的伤害解读', '查看目前技能的傷害解讀', '현재 스킬 피해 해설 보기')}
      ><CircleHelp /></button></h3>
      <div className="skill-damage-insights">
        <div><span>{l('Primary damage', '主要伤害', '主要傷害', '주요 피해')}</span><strong>{dominantType ? typeLabel(dominantType.type) : '-'}</strong><small>{dominantType && compositionTotal ? `${formatCalculationValue(dominantType.average / compositionTotal * 100, 1, language)}% ${l('of final damage', '最终伤害', '最終傷害', '최종 피해')}` : '-'}</small></div>
        <div><span>{l('Highest Increased', '最高提高 (Increased)', '最高增加 (Increased)', '가장 높은 증가')}</span><strong>{strongestIncrease ? `${formatCalculationValue(strongestIncrease.increased, 0, language)}%` : '-'}</strong><small>{strongestIncrease ? typeLabel(strongestIncrease.type) : '-'}</small></div>
        <div><span>{l('More sources', '独立总增 (More) 来源', '更多 (More) 來源', '증폭 출처')}</span><strong>{moreSourceCount}</strong><small>{moreSourceCount ? l('multiplicative', '乘法叠加', '乘法疊加', '곱연산') : l('none detected', '当前未检测到', '目前未偵測到', '감지되지 않음')}</small></div>
        <div><span>{l('Gain as Extra', '额外获得 (Gain)', '額外獲得 (Gain)', '추가 획득')}</span><strong>{gainSourceCount}</strong><small>{l('active sources', '生效来源', '生效來源', '활성 출처')}</small></div>
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
              : bucket.key === 'convert' ? l('damage conversion', '伤害转换', '傷害轉換', '피해 전환')
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
          : localizeDamageSource(row.source, selectedBucket)}</span>
        <small>{row.scope}</small>
        <code>{selectedBucket === 'convert' && row.transfer
          ? `${typeLabel(row.transfer.fromType)} ${l('damage converted to', '伤害转换为', '傷害轉換為', '피해를 다음으로 전환')} ${typeLabel(row.transfer.toType)}`
          : translateCalculationStat(row.stat, language)}</code>
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
    {interpretationOpen && createPortal(<div
      className="skill-interpretation-backdrop"
      role="presentation"
      style={interpretationViewportStyle}
      onMouseDown={(event) => { if (event.target === event.currentTarget) setInterpretationOpen(false) }}
    >
      <section className="skill-interpretation-dialog" role="dialog" aria-modal="true" aria-labelledby="skill-interpretation-title">
        <header>
          <div><small>{l('Damage interpretation', '伤害解读', '傷害解讀', '피해 해설')}</small><h2 id="skill-interpretation-title">{interpretedSkillName}</h2></div>
          <button type="button" onClick={() => setInterpretationOpen(false)} title={l('Close', '关闭', '關閉', '닫기')} aria-label={l('Close', '关闭', '關閉', '닫기')}><X /></button>
        </header>
        <div className="skill-interpretation-scroll">
          <section className="skill-interpretation-lead">
            <span>{l('Core conclusion', '核心结论', '核心結論', '핵심 결론')}</span>
            <p>{dominantType && compositionTotal
              ? l(
                `${typeLabel(dominantType.type)} is the largest final damage type at ${formatCalculationValue(dominantType.average / compositionTotal * 100, 1, language)}%. Gain adds new damage without replacing the skill's original damage.`,
                `${typeLabel(dominantType.type)}是当前最大的最终伤害类型，占比 ${formatCalculationValue(dominantType.average / compositionTotal * 100, 1, language)}%。Gain 会增加新的伤害，不会替换技能原有伤害。`,
                `${typeLabel(dominantType.type)}是目前最大的最終傷害類型，佔比 ${formatCalculationValue(dominantType.average / compositionTotal * 100, 1, language)}%。Gain 會增加新的傷害，不會取代技能原有傷害。`,
                `${typeLabel(dominantType.type)}이(가) 현재 가장 큰 최종 피해 유형이며 비중은 ${formatCalculationValue(dominantType.average / compositionTotal * 100, 1, language)}%입니다. 추가 획득은 기존 피해를 대체하지 않고 새 피해를 더합니다.`,
              )
              : l('The current calculation does not contain enough hit damage to identify a dominant damage type.', '当前计算没有足够的击中伤害用于判断主要伤害类型。', '目前計算沒有足夠的擊中傷害用於判斷主要傷害類型。', '현재 계산에는 주요 피해 유형을 판단할 충분한 적중 피해가 없습니다.')}</p>
            {structureExplanation && <p>{structureExplanation}</p>}
          </section>

          {!!interpretedBaseSources.length && <section className="skill-interpretation-section">
            <div className="skill-interpretation-heading"><h3>{l('Base and added damage', '基础与点伤来源', '基礎與附加傷害來源', '기본 및 추가 피해')}</h3><small>{l('The starting pool used by Gain and later modifiers', 'Gain 与后续修正使用的起始伤害池', 'Gain 與後續修正使用的起始傷害池', '추가 획득 및 후속 보정이 사용하는 시작 피해 풀')}</small></div>
            <div className="skill-interpretation-base-sources">{interpretedBaseSources.map((entry) => <div key={entry.key}>
              <span><i className={`damage-${entry.damageType}`} />{typeLabel(entry.damageType)}</span>
              <strong>{entry.kind === 'skill'
                ? `${l('Skill', '技能', '技能', '스킬')}：${localizeEffect(entry.source)}`
                : localizeSource(entry.source)}</strong>
              <small>{formatCalculationValue(entry.min, 1, language)} - {formatCalculationValue(entry.max, 1, language)}</small>
              <em>{l('Average', '平均', '平均', '평균')} {formatCalculationValue(entry.average, 1, language)}</em>
            </div>)}</div>
          </section>}

          {!!interpretedPools.length && <section className="skill-interpretation-section">
            <div className="skill-interpretation-heading"><h3>{l('Pool before later scaling', '进入后续乘区前', '進入後續乘區前', '후속 배율 적용 전')}</h3><small>{l('Recognised base and Gain averages', '已识别基础伤害与 Gain 平均值', '已識別基礎傷害與 Gain 平均值', '인식된 기본 및 추가 획득 평균')}</small></div>
            <div className="skill-interpretation-pools">{interpretedPools.map((entry) => <div key={entry.type}>
              <div><i className={`damage-${entry.type}`} /><strong>{typeLabel(entry.type)}</strong><span>{formatCalculationValue(entry.total, 1, language)}</span></div>
              <div className="skill-interpretation-bar"><span className={`damage-${entry.type}`} style={{ width: `${largestInterpretedPool ? entry.total / largestInterpretedPool * 100 : 0}%` }} /></div>
              <small>{l('Base', '基础', '基礎', '기본')} {formatCalculationValue(entry.base, 1, language)}{entry.gain > 0 ? ` + Gain ${formatCalculationValue(entry.gain, 1, language)}` : ''}</small>
            </div>)}</div>
          </section>}

          <section className="skill-interpretation-section">
            <div className="skill-interpretation-heading"><h3>{l('Gain sources', 'Gain 来源', 'Gain 來源', '추가 획득 출처')}</h3><small>{l('Raw contribution before Increased and More', '进入 Increased 与 More 前的原始贡献', '進入 Increased 與 More 前的原始貢獻', '증가 및 증폭 전 원시 기여')}</small></div>
            {interpretedGains.length ? <div className="skill-interpretation-gains">{interpretedGains.map((entry, index) => <div key={`${entry.source}:${entry.stat}:${entry.fromType}:${entry.toType}:${index}`}>
              <strong>{localizeDamageSource(entry.source, 'gain')}</strong>
              <span>{typeLabel(entry.fromType)} <b>{formatCalculationValue(entry.value, 2, language)}%</b> → {typeLabel(entry.toType)}</span>
              <em>{entry.rawContribution > 0 ? `≈ +${formatCalculationValue(entry.rawContribution, 1, language)}` : '-'}</em>
              {entry.rawContribution > 0 && <code>{formatCalculationValue(sourcePool(entry.fromType), 1, language)} × {formatCalculationValue(entry.value, 2, language)}% = {formatCalculationValue(entry.rawContribution, 1, language)}</code>}
            </div>)}</div> : <p className="skill-interpretation-empty">{l('No active Gain source was detected for this skill.', '当前技能没有检测到生效的 Gain 来源。', '目前技能沒有偵測到生效的 Gain 來源。', '현재 스킬에서 활성 추가 획득 출처가 감지되지 않았습니다.')}</p>}
            {!!interpretedGains.length && <p className="skill-interpretation-note">{l(
              'Gain copies a percentage of the eligible source pool into a new damage type. The original damage remains, and the gained portion then receives matching Increased, More, critical and enemy-defence modifiers as its new type.',
              'Gain 会按比例把符合条件的来源伤害复制成新的伤害类型；原伤害仍然保留。复制出的部分随后按新类型接受符合条件的 Increased、More、暴击与敌人防御修正。',
              'Gain 會按比例把符合條件的來源傷害複製成新的傷害類型；原傷害仍然保留。複製出的部分隨後按新類型接受符合條件的 Increased、More、暴擊與敵人防禦修正。',
              '추가 획득은 조건에 맞는 원본 피해 풀의 일정 비율을 새 피해 유형으로 복사합니다. 원본 피해는 유지되며 복사된 피해는 새 유형에 맞는 증가, 증폭, 치명타 및 적 방어 보정을 받습니다.',
            )}</p>}
          </section>

          {!!details?.conversions?.length && <section className="skill-interpretation-section">
            <div className="skill-interpretation-heading"><h3>{l('Conversion', '伤害转换', '傷害轉換', '피해 전환')}</h3><small>{l('Moves existing damage instead of adding a copy', '转移已有伤害，不额外复制一份', '轉移已有傷害，不額外複製一份', '기존 피해를 복사하지 않고 이동')}</small></div>
            <div className="skill-interpretation-conversions">{details.conversions.map((entry, index) => <div key={`${entry.source}:${entry.stat}:${entry.fromType}:${entry.toType}:${index}`}>
              <strong>{localizeDamageSource(entry.source, 'convert')}</strong>
              <span>{typeLabel(entry.fromType)} → {typeLabel(entry.toType)}</span>
              <em>{formatCalculationValue(entry.value, 2, language)}%</em>
            </div>)}</div>
            <p className="skill-interpretation-note">{l(
              'Conversion removes the converted share from its source type and moves it to the target type. PoB2 resolves competing conversion limits before applying the later modifiers shown below.',
              '转换会从来源类型中移走对应比例，并加入目标类型。多个转换发生竞争时，由 PoB2 先处理转换上限，再进入下面的后续乘区。',
              '轉換會從來源類型中移走對應比例，並加入目標類型。多個轉換發生競爭時，由 PoB2 先處理轉換上限，再進入下面的後續乘區。',
              '전환은 원본 유형에서 해당 비율을 제거해 대상 유형으로 옮깁니다. 여러 전환이 경쟁하면 PoB2가 전환 한도를 먼저 처리한 뒤 아래의 후속 배율을 적용합니다.',
            )}</p>
          </section>}

          {!!composition.length && <section className="skill-interpretation-section">
            <div className="skill-interpretation-heading"><h3>{l('Later scaling', '后续乘区', '後續乘區', '후속 배율')}</h3><small>{l('Each type uses only matching modifiers', '每种类型只应用符合条件的修正', '每種類型只套用符合條件的修正', '각 유형에는 조건에 맞는 보정만 적용')}</small></div>
            <div className="skill-interpretation-scaling">
              <div className="skill-interpretation-scaling-head"><span>{l('Type', '类型', '類型', '유형')}</span><small>{l('Starting pool', '起始池', '起始池', '시작 풀')}</small><small>Increased</small><small>More</small><small>{l('Effective', '有效承伤', '有效承傷', '유효')}</small><small>{l('Expected crit', '暴击期望', '暴擊期望', '기대 치명타')}</small><strong>{l('Final average', '最终平均', '最終平均', '최종 평균')}</strong></div>
              {composition.map((entry) => {
                const interpretedPool = interpretedPools.find((pool) => pool.type === entry.type)
                return <div key={entry.type}>
                  <span><i className={`damage-${entry.type}`} />{typeLabel(entry.type)}</span>
                  <small>{interpretedPool ? formatCalculationValue(interpretedPool.total, 1, language) : '-'}</small>
                  <small><b>{formatCalculationValue(1 + entry.increased / 100, 3, language)}x</b><em>+{formatCalculationValue(entry.increased, 1, language)}%</em></small>
                  <small><b>{formatCalculationValue(1 + entry.more / 100, 3, language)}x</b><em>+{formatCalculationValue(entry.more, 1, language)}%</em></small>
                  <small><b>{entry.effectiveMultiplier == null ? '-' : `${formatCalculationValue(entry.effectiveMultiplier, 3, language)}x`}</b></small>
                  <small><b>{expectedCritMultiplier == null ? '-' : `${formatCalculationValue(expectedCritMultiplier, 3, language)}x`}</b></small>
                  <strong>{formatCalculationValue(entry.average, 1, language)}</strong>
                </div>
              })}
            </div>
            <p className="skill-interpretation-note">{l(
              'Attack, spell, projectile, and elemental modifiers can cover several damage types when their conditions match; type-specific modifiers only scale that type. Enemy resistance and penetration are applied separately. Final Average already includes critical weighting and follows PoB2 runtime output.',
              '攻击、法术、投射物和元素修正在条件匹配时可以覆盖多种伤害；类型专属修正只放大对应类型。敌人抗性与穿透会按类型分别应用。“最终平均”已经包含暴击期望加权，并以 PoB2 运行时结果为准。',
              '攻擊、法術、投射物和元素修正在條件符合時可以涵蓋多種傷害；類型專屬修正只放大對應類型。敵人抗性與穿透會按類型分別套用。「最終平均」已包含暴擊期望加權，並以 PoB2 執行階段結果為準。',
              '공격, 주문, 투사체, 원소 보정은 조건이 맞으면 여러 피해 유형에 적용되며 유형 전용 보정은 해당 유형만 증폭합니다. 적 저항과 관통은 유형별로 적용됩니다. 최종 평균은 치명타 기대값을 이미 포함하며 PoB2 런타임 결과를 따릅니다.',
            )}</p>
          </section>}

          <section className="skill-interpretation-section">
            <div className="skill-interpretation-heading"><h3>{l('From hit to DPS', '从击中到 DPS', '從擊中到 DPS', '적중에서 DPS까지')}</h3><small>{l('Critical weighting and action frequency', '暴击加权与攻击/施法频率', '暴擊加權與攻擊/施法頻率', '치명타 가중치와 행동 빈도')}</small></div>
            <div className="skill-interpretation-dps-metrics">
              <div><span>{l('Average hit', '平均击中', '平均擊中', '평균 적중')}</span><strong>{formatCalculationValue(details?.averageHit, 1, language)}</strong></div>
              <div><span>{l('Critical chance', '暴击率', '暴擊率', '치명타 확률')}</span><strong>{formatCalculationValue(details?.critChance, 2, language)}%</strong></div>
              <div><span>{l('Critical damage', '暴击伤害', '暴擊傷害', '치명타 피해')}</span><strong>{details?.critMultiplier == null ? '-' : `${formatCalculationValue(details.critMultiplier, 3, language)}x`}</strong></div>
              <div><span>{l('Expected critical multiplier', '期望暴击倍率', '期望暴擊倍率', '기대 치명타 배율')}</span><strong>{expectedCritMultiplier == null ? '-' : `${formatCalculationValue(expectedCritMultiplier, 3, language)}x`}</strong></div>
              <div><span>{l('Rate', '攻击/施法速率', '攻擊/施法速度', '공격/시전 속도')}</span><strong>{formatCalculationValue(details?.speed, 3, language)}/s</strong></div>
              <div><span>{l('Final DPS', '最终 DPS', '最終 DPS', '최종 DPS')}</span><strong>{formatCalculationValue(details?.totalDps, 1, language)}</strong></div>
            </div>
            {expectedCritMultiplier != null && details?.critChance != null && details?.critMultiplier != null && <div className="skill-interpretation-crit-equation">
              <span>{l('Expected critical multiplier', '期望暴击倍率', '期望暴擊倍率', '기대 치명타 배율')}</span>
              <code>(1 - {formatCalculationValue(details.critChance, 2, language)}%) × 1 + {formatCalculationValue(details.critChance, 2, language)}% × {formatCalculationValue(details.critMultiplier, 3, language)} = {formatCalculationValue(expectedCritMultiplier, 3, language)}x</code>
              <small>{l(
                'Average Hit already includes this weighting; it is then multiplied by the action rate to produce hit DPS.',
                '平均击中已经包含这次暴击概率加权；随后再乘攻击/施法速率，得到击中 DPS。',
                '平均擊中已包含這次暴擊機率加權；隨後再乘攻擊/施法速度，得到擊中 DPS。',
                '평균 적중에는 이 치명타 확률 가중치가 이미 포함되며, 이후 행동 속도를 곱해 적중 DPS를 구합니다.',
              )}</small>
            </div>}
            {usesSimpleDpsFormula
              ? <div className="skill-interpretation-equation"><span>{formatCalculationValue(details?.averageHit, 1, language)}</span><i>×</i><span>{formatCalculationValue(details?.speed, 3, language)}/s</span><i>=</i><strong>{formatCalculationValue(details?.totalDps, 1, language)} DPS</strong></div>
              : <p className="skill-interpretation-note">{l(
                'This skill uses additional trigger, repeat, overlap or count factors, so final DPS is not only Average Hit × Rate. The displayed DPS follows the complete PoB2 formula.',
                '这个技能还包含触发、重复、重叠或数量倍率，因此最终 DPS 不只是“平均击中 × 速率”；显示结果以 PoB2 的完整公式为准。',
                '這個技能還包含觸發、重複、重疊或數量倍率，因此最終 DPS 不只是「平均擊中 × 速度」；顯示結果以 PoB2 的完整公式為準。',
                '이 스킬에는 발동, 반복, 중첩 또는 개수 배율이 추가로 포함되어 최종 DPS가 단순히 평균 적중 × 속도만으로 계산되지 않습니다. 표시 결과는 PoB2 전체 공식을 따릅니다.',
              )}</p>}
          </section>
        </div>
      </section>
    </div>, document.body)}
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
  const pobBuildRevision = useTreeStore((state) => state.pobBuildRevision)
  const getActivePobCode = useTreeStore((state) => state.getActivePobCode)
  const weaponSet = useTreeStore((state) => state.activeWeaponSet)
  const setWeaponSet = useTreeStore((state) => state.setActiveWeaponSet)
  const calcResult = useTreeStore((state) => state.calcResult)
  const calcLoading = useTreeStore((state) => state.calcLoading)
  const calcError = useTreeStore((state) => state.calcError)
  const calculationProfiles = useTreeStore((state) => state.calculationProfiles)
  const activeCalculationProfileId = useTreeStore((state) => state.activeCalculationProfileId)
  const runCalculation = useTreeStore((state) => state.runCalculation)
  const updateSkillGem = useTreeStore((state) => state.updateSkillGem)
  const updateSkillGroup = useTreeStore((state) => state.updateSkillGroup)
  const setActiveSkillSet = useTreeStore((state) => state.setActiveSkillSet)
  const setMainSocketGroup = useTreeStore((state) => state.setMainSocketGroup)
  const [selectedId, setSelectedId] = useState('')
  const [inspectorOpen, setInspectorOpen] = useState(true)
  const [skillEditMode, setSkillEditMode] = useState(false)
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
  const [dpsDrawerOpen, setDpsDrawerOpen] = useState(true)
  const [pendingDpsSelection, setPendingDpsSelection] = useState<{
    groupId: string
    entry: SkillDpsEntry
  } | null>(null)
  const [skillDpsSnapshot, setSkillDpsSnapshot] = useState<SkillDpsSnapshot | null>(null)
  const dpsSnapshotContextRef = useRef('')
  const activePobCode = useMemo(() => getActivePobCode() || '', [getActivePobCode, pobBuildRevision])

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

  const session = getActiveBuildSession()
  const skills = useMemo(() => activePobCode
    ? session
      ? parseSkillsObject(session.object)
      : parseSkillsCode(activePobCode)
    : { activeSkillSetId: '', skillSets: [], activeGroupId: '', groups: [] }, [activePobCode, pobBuildRevision, session])
  const orderedGroups = skills.groups

  useEffect(() => {
    if (!activePobCode) {
      setCalcMode('EFFECTIVE')
      return
    }
    setCalcMode(session
      ? getImportedCalculationModeFromObject(session.object)
      : getImportedCalculationModeFromCode(activePobCode))
  }, [activePobCode, pobBuildRevision, session])
  const selected = skills.groups.find((group) => group.id === selectedId)
    || skills.groups.find((group) => group.id === skills.activeGroupId)
    || skills.groups[0]
  useEffect(() => {
    setSkillEditMode(false)
  }, [activePobCode, selected?.id])
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
  const activeCalculationProfile = calculationProfiles.find((profile) => profile.id === activeCalculationProfileId)
  const dpsContextKey = useMemo(() => JSON.stringify([
    activePobCode,
    pobBuildRevision,
    weaponSet,
    calcMode,
    activeCalculationProfileId,
    Object.entries(activeCalculationProfile?.values || {}).sort(([left], [right]) => left.localeCompare(right)),
  ]), [activePobCode, pobBuildRevision, weaponSet, calcMode, activeCalculationProfileId, activeCalculationProfile?.values])
  const calculationKey = selected
    ? `${activePobCode}:${pobBuildRevision}:${weaponSet}:${selected.id}:${calcMode}:${activeSkillIndex || ''}:${statSetIndex || ''}:${minionSkillIndex || ''}:${minionStatSetIndex || ''}`
    : ''
  const lastCalculationKey = useRef('')

  useEffect(() => {
    if (dpsSnapshotContextRef.current && dpsSnapshotContextRef.current !== dpsContextKey) {
      setSkillDpsSnapshot(null)
    }
    dpsSnapshotContextRef.current = ''
  }, [dpsContextKey])

  useEffect(() => {
    const allEntries = calcResult?.AllSkillDPS ?? calcResult?.SkillDPS
    const fullEntries = calcResult?.FullSkillDPS ?? (Array.isArray(calcResult?.SkillDPS)
      ? calcResult.SkillDPS.filter((entry) => Boolean(
        entry.groupId && skills.groups.find((group) => group.id === entry.groupId)?.includeInFullDps,
      ))
      : undefined)
    if (calcLoading || !Array.isArray(allEntries) || !Array.isArray(fullEntries) || dpsSnapshotContextRef.current === dpsContextKey) return
    setSkillDpsSnapshot({
      allEntries: allEntries.map((entry) => ({ ...entry })),
      fullEntries: fullEntries.map((entry) => ({ ...entry })),
      fullDps: calcResult?.FullDPS,
    })
    dpsSnapshotContextRef.current = dpsContextKey
  }, [calcLoading, calcResult, dpsContextKey, skills.groups])

  useEffect(() => {
    if (!selected || !activePobCode || calcLoading || lastCalculationKey.current === calculationKey) return
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
  }, [selected?.id, activePobCode, pobBuildRevision, weaponSet, calcMode, activeSkillIndex, statSetIndex, minionSkillIndex, minionStatSetIndex, calcLoading, calculationKey, runCalculation])

  const selectedCalculation = !calcLoading && lastCalculationKey.current === calculationKey ? calcResult : null
  const calculationDetails = selectedCalculation?.SkillDetails

  useEffect(() => {
    if (!pendingDpsSelection || !selected || pendingDpsSelection.groupId !== selected.id || calcLoading || !calculationDetails) return
    const matchedIndex = findActiveSkillOptionIndex(calculationDetails, pendingDpsSelection.entry)
    if (matchedIndex == null) {
      // The runtime may omit a non-damaging or unsupported triggered skill from
      // the selectable list. Do not replace the user's current selection.
      setPendingDpsSelection(null)
      return
    }
    setSkillCalculationSelection((current) => {
      if (current.groupId === selected.id && current.activeSkillIndex === matchedIndex) return current
      return {
        ...current,
        groupId: selected.id,
        activeSkillIndex: matchedIndex,
      }
    })
    setPendingDpsSelection(null)
  }, [pendingDpsSelection, selected?.id, calcLoading, calculationDetails])

  const showTooltip = (
    event: MouseEvent<HTMLElement>,
    gem: NonNullable<typeof selected>['gems'][number],
    detail: ReturnType<typeof resolveSkillCatalogEntry>,
  ) => setTooltip({ gem, detail, x: event.clientX, y: event.clientY })

  const selectedSkillIndex = selected ? Math.max(0, Number(selected.id) - 1) : 0
  const updateSelectedGem = (gemIndex: number, attributes: Record<string, string>) => {
    updateSkillGem(skills.activeSkillSetId, selectedSkillIndex, gemIndex, attributes)
  }
  const updateSelectedGroup = (attributes: Record<string, string>) => {
    updateSkillGroup(skills.activeSkillSetId, selectedSkillIndex, attributes)
  }

  if (!selected) {
    return <section className="workspace-empty">
      <Sparkles />
      <h2>{l('No skill data', '没有技能数据', '沒有技能數據', '스킬 데이터 없음')}</h2>
      <p>{l('Import a complete PoB2 build to view skill groups.', '导入完整 PoB2 构筑后，这里会显示独立的技能组。', '匯入完整 PoB2 構築後，此處會顯示獨立的技能組。', '완전한 PoB2 빌드를 가져오면 여기에 개별 스킬 그룹이 표시됩니다.')}</p>
    </section>
  }

  return <section className={`skills-workspace${inspectorOpen ? ' inspector-open' : ''}${dpsDrawerOpen ? ' dps-drawer-open' : ''}`}>
    {dpsDrawerOpen
      ? <SkillDpsDrawer
        fullEntries={skillDpsSnapshot?.fullEntries || []}
        allEntries={skillDpsSnapshot?.allEntries || []}
        fullDps={skillDpsSnapshot?.fullDps}
        groups={skills.groups}
        catalog={catalog}
        language={lang}
        loading={calcLoading}
        error={skillDpsSnapshot ? null : calcError}
        selectedGroupId={selected.id}
        onSelectEntry={(entry, groupId) => {
          setSelectedId(groupId)
          setInspectorOpen(true)
          setInspectorPage('calculation')
          setPendingDpsSelection({ groupId, entry })
          setSkillCalculationSelection((current) => ({
            ...current,
            groupId,
            activeSkillIndex: undefined,
          }))
        }}
        onToggleGroup={(groupId, include) => {
          const groupIndex = skills.groups.findIndex((group) => group.id === groupId)
          if (groupIndex >= 0) updateSkillGroup(skills.activeSkillSetId, groupIndex, { includeInFullDPS: String(include) })
        }}
        onClose={() => setDpsDrawerOpen(false)}
      />
      : <button
        type="button"
        className="skill-dps-rail"
        onClick={() => setDpsDrawerOpen(true)}
        title={l('Open Skill DPS drawer', '打开技能 DPS 抽屉', '開啟技能 DPS 抽屜', '스킬 DPS 서랍 열기')}
        aria-label={l('Open Skill DPS drawer', '打开技能 DPS 抽屉', '開啟技能 DPS 抽屜', '스킬 DPS 서랍 열기')}
      >
        <PanelLeftOpen aria-hidden="true" />
        <strong>{l('Skill DPS', '技能 DPS', '技能 DPS', '스킬 DPS')}</strong>
        <ChevronRight aria-hidden="true" />
      </button>}
    <div className="skill-groups-stage">
      <header>
        <div className="skill-groups-header-actions">
          {skills.skillSets.length > 1 && <select
            className="skill-set-select"
            value={skills.activeSkillSetId}
            onChange={(event) => setActiveSkillSet(event.target.value)}
            aria-label={l('Skill set', '技能组方案', '技能組方案', '스킬 세트')}
            title={l('Active skill set', '当前技能组方案', '目前技能組方案', '활성 스킬 세트')}
          >
            {skills.skillSets.map((skillSet) => <option key={skillSet.id} value={skillSet.id}>{skillSet.title}</option>)}
          </select>}
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
              <small>{calculatedLevel
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
          className="skill-edit-toggle"
          onClick={() => setSkillEditMode((value) => !value)}
          title={skillEditMode
            ? l('Finish skill editing', '完成技能编辑', '完成技能編輯', '스킬 편집 완료')
            : l('Edit skill setup', '编辑技能配置', '編輯技能配置', '스킬 설정 편집')}
          aria-label={skillEditMode
            ? l('Finish skill editing', '完成技能编辑', '完成技能編輯', '스킬 편집 완료')
            : l('Edit skill setup', '编辑技能配置', '編輯技能配置', '스킬 설정 편집')}
        >{skillEditMode ? <Check /> : <Pencil />}</button>
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
            skillName={mainName}
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
          {skillEditMode && <div className="skill-group-settings">
            <label>
              <input
                type="checkbox"
                checked={selected.enabled}
                onChange={(event) => updateSelectedGroup({ enabled: String(event.target.checked) })}
              />
              <span>{l('Skill group enabled', '启用技能组', '啟用技能組', '스킬 그룹 활성화')}</span>
            </label>
            <label>
              <input
                type="checkbox"
                checked={selected.includeInFullDps}
                onChange={(event) => updateSelectedGroup({ includeInFullDPS: String(event.target.checked) })}
              />
              <span>{l('Include in full DPS', '计入完整 DPS', '計入完整 DPS', '전체 DPS에 포함')}</span>
            </label>
            <button
              type="button"
              className={skills.activeGroupId === selected.id ? 'active' : ''}
              onClick={() => setMainSocketGroup(selected.id)}
              disabled={skills.activeGroupId === selected.id}
            >{skills.activeGroupId === selected.id
              ? l('Main skill group', '当前主技能组', '目前主技能組', '주 스킬 그룹')
              : l('Set as main skill', '设为主技能', '設為主技能', '주 스킬로 설정')}</button>
          </div>}
          {skillEditMode && <section className="skill-gem-settings">
            <h3>{l('Skill gem settings', '技能宝石设置', '技能寶石設定', '스킬 젬 설정')}</h3>
            <SkillGemEditor
              gem={mainGem}
              language={lang}
              onChange={(attributes) => updateSelectedGem(0, attributes)}
            />
          </section>}
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
              {skillEditMode
                ? <SkillGemEditor
                    gem={gem}
                    language={lang}
                    onChange={(attributes) => updateSelectedGem(index + 1, attributes)}
                  />
                : <small>Lv. {gem.level}</small>}
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

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
type DamageBucket = 'added' | 'increased' | 'gain' | 'more'

function formatCalculationValue(value: number | undefined, decimals = 0): string {
  if (!Number.isFinite(value)) return '-'
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: decimals }).format(value as number)
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
  const zh = language === 'zh-rCN'
  const chance = kind === 'chance'
  const label = chance ? (zh ? '暴击率' : 'Critical Chance') : (zh ? '暴击伤害' : 'Critical Damage')
  const displayValue = loading
    ? '...'
    : chance
      ? `${formatCalculationValue(value, 2)}%`
      : `x${formatCalculationValue(multiplier, 2)}`
  const lines = breakdown || []
  const critBonus = Number.isFinite(multiplier) ? ((multiplier as number) - 1) * 100 : undefined

  return <div className="skill-critical-metric" tabIndex={0} aria-label={`${label} ${displayValue}`}>
    <dt>{label}<Info aria-hidden="true" /></dt>
    <dd>{displayValue}</dd>
    <div className="skill-critical-tooltip" role="tooltip">
      <header><span>{label}</span><strong>{displayValue}</strong></header>
      {!chance && Number.isFinite(critBonus) && <p>
        <span>{zh ? '暴击伤害加成' : 'Critical damage bonus'}</span>
        <b>+{formatCalculationValue(critBonus, 1)}%</b>
      </p>}
      {lines.length
        ? <ol>{lines.map((line, index) => <li key={`${line}-${index}`}>{translateCalculationText(line, language)}</li>)}</ol>
        : <p className="empty">{chance
          ? (zh ? '当前没有额外的暴击率计算步骤。' : 'No additional critical chance calculation steps.')
          : (zh ? '当前倍率已包含所有生效的暴击伤害加成。' : 'The multiplier includes all active critical damage bonuses.')}</p>}
    </div>
  </div>
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
  language,
  catalog,
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
  language: Language
  catalog: SkillCatalog | null
  onActiveSkillChange: (value: number) => void
  onStatSetChange: (value: number) => void
  onCalcModeChange: (value: SkillCalculationMode) => void
}) {
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
  const localizeSkillOption = (value: string) => {
    const entry = resolveSkillCatalogName(value, catalog)
    return entry ? getLocalizedSkillName({ name: entry.name }, entry, language) : translateCalculationText(value, language)
  }
  return <section className="skill-calculation-panel">
    <div className="skill-calculation-controls">
      <label><span>{zh ? '插槽组' : 'Socket Group'}</span><strong>{groupName}</strong></label>
      <label><span>{zh ? '启用技能' : 'Active Skill'}</span><select
        value={selectedActiveSkill}
        disabled={!activeSkills.length || loading}
        onChange={(event) => onActiveSkillChange(Number(event.target.value))}
      >{(activeSkills.length ? activeSkills : [{ index: 1, label: groupName }]).map((option) => <option key={option.index} value={option.index}>{localizeSkillOption(option.label)}</option>)}</select></label>
      <label><span>{zh ? '技能形态' : 'Stat Set'}</span><select
        value={selectedStatSet}
        disabled={!statSets.length || loading}
        onChange={(event) => onStatSetChange(Number(event.target.value))}
      >{(statSets.length ? statSets : [{ index: 1, label: '-' }]).map((option) => <option key={option.index} value={option.index}>{translateCalculationText(option.label, language)}</option>)}</select></label>
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
    {!!composition.length && <div className="skill-damage-composition">
      <div className="skill-composition-heading"><span>{zh ? '最终伤害构成' : 'Final Damage Mix'}</span><small>{zh ? '按平均击中伤害' : 'By average hit'}</small></div>
      <div className="skill-composition-bar" aria-label={zh ? '最终伤害构成' : 'Final damage mix'}>{composition.map((entry) => {
        const percent = compositionTotal ? entry.average / compositionTotal * 100 : 0
        return <span key={entry.type} className={`damage-${entry.type}`} style={{ width: `${percent}%` }} title={`${zh ? DAMAGE_TYPE_LABELS[entry.type].zh : DAMAGE_TYPE_LABELS[entry.type].en} ${formatCalculationValue(percent, 1)}%`} />
      })}</div>
      <div className="skill-composition-legend">{composition.map((entry) => {
        const percent = compositionTotal ? entry.average / compositionTotal * 100 : 0
        return <div key={entry.type}><i className={`damage-${entry.type}`} /><span>{zh ? DAMAGE_TYPE_LABELS[entry.type].zh : DAMAGE_TYPE_LABELS[entry.type].en}</span><strong>{formatCalculationValue(percent, 1)}%</strong></div>
      })}</div>
    </div>}
    <dl className="skill-damage-summary">
      <div><dt>{zh ? '平均击中伤害' : 'Average Hit'}</dt><dd>{loading ? '...' : formatCalculationValue(details?.averageHit ?? result?.AverageHit, 1)}</dd></div>
      <div><dt>{zh ? '攻击/施法速率' : 'Attack/Cast Rate'}</dt><dd>{loading ? '...' : `${formatCalculationValue(details?.speed ?? result?.Speed, 2)}/s`}</dd></div>
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
      <div><dt>{zh ? '技能 DPS' : 'Skill DPS'}</dt><dd>{loading ? '...' : formatCalculationValue(details?.totalDps ?? result?.TotalDPS, 1)}</dd></div>
    </dl>
  </section>
}

function SkillDamageCalculationDetails({
  details,
  loading,
  language,
  catalog,
}: {
  details?: SkillCalculationDetails
  loading: boolean
  language: Language
  catalog: SkillCatalog | null
}) {
  const zh = language === 'zh-rCN'
  const availableTypes = (details?.damageTypes || []).filter((entry) => entry.type !== 'all'
    && [entry.hitMin, entry.hitMax, entry.addedMin, entry.addedMax].some((value) => value != null && value !== 0))
  const [selectedType, setSelectedType] = useState<SpecificDamageType | 'all'>('all')
  const [selectedBucket, setSelectedBucket] = useState<DamageBucket>('added')
  const activeType = availableTypes.find((entry) => entry.type === selectedType) || availableTypes[0]
  const effects = [
    { key: 'auras', label: zh ? '光环与增益技能' : 'Aura and Buff Skills', values: details?.effects?.aurasAndBuffs || [] },
    { key: 'combat', label: zh ? '战斗增益' : 'Combat Buffs', values: details?.effects?.combatBuffs || [] },
    { key: 'debuffs', label: zh ? '诅咒与减益' : 'Curses and Debuffs', values: details?.effects?.cursesAndDebuffs || [] },
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
      if (fullName !== item[2] || !zh) return `${zh ? '装备' : 'Item'}：${fullName}`
      const parts = item[2].split(',').map((part) => part.trim())
      const baseName = parts[parts.length - 1] || item[2]
      const localizedBase = localize(baseName)
      return localizedBase !== baseName ? `装备：${localizedBase}（#${item[1]}）` : `装备 #${item[1]}`
    }
    const skill = value.match(/^Skill:(.+)$/)
    if (skill) {
      const entry = resolveSkillCatalogName(skill[1], catalog)
      const name = entry ? getLocalizedSkillName({ name: entry.name }, entry, language) : localize(skill[1])
      return `${zh ? '技能' : 'Skill'}：${name}`
    }
    const tree = value.match(/^Tree(?::(.+))?$/)
    if (tree) return tree[1] ? (zh ? `天赋树 · 节点 ${tree[1]}` : `Passive Tree · Node ${tree[1]}`) : (zh ? '天赋树' : 'Passive Tree')
    const config = value.match(/^Config(?::(.+))?$/)
    if (config) return config[1] ? (zh ? `配置 · ${config[1]}` : `Configuration · ${config[1]}`) : (zh ? '配置' : 'Configuration')
    return localize(value)
  }
  const typeLabel = (value: string) => {
    const weapon = value.match(/^(mainHand|offHand):(.+)$/)
    if (weapon) {
      const hand = weapon[1] === 'mainHand' ? (zh ? '主手' : 'Main Hand') : (zh ? '副手' : 'Off Hand')
      const labels = DAMAGE_TYPE_LABELS[weapon[2] as keyof typeof DAMAGE_TYPE_LABELS]
      return `${hand} · ${labels ? (zh ? labels.zh : labels.en) : weapon[2]}`
    }
    if (value === 'elemental') return zh ? '元素' : 'Elemental'
    if (value === 'random') return zh ? '随机元素' : 'Random Element'
    const labels = DAMAGE_TYPE_LABELS[value as keyof typeof DAMAGE_TYPE_LABELS]
    return labels ? (zh ? labels.zh : labels.en) : value
  }
  const bucketOptions: Array<{ key: DamageBucket; label: string }> = [
    { key: 'added', label: zh ? '点伤' : 'Added' },
    { key: 'increased', label: zh ? '提高' : 'Increased' },
    { key: 'gain', label: zh ? '额外获得' : 'Gain' },
    { key: 'more', label: zh ? '总增' : 'More' },
  ]
  const sourceRows: Array<{ key: string; value: string; source: string; scope: string; stat: string; kind?: 'skillDamage' }> = []
  if (selectedBucket === 'added') {
    const rows = new Map<string, { min: number; max: number; source: string; damageType: string; stats: Set<string> }>()
    for (const entry of details?.skillDamage || []) {
      const title = entry.damageType.slice(0, 1).toUpperCase() + entry.damageType.slice(1)
      const level = entry.skillLevel == null ? '' : ` · ${zh ? '等级' : 'Level'} ${formatCalculationValue(entry.skillLevel)}`
      const baseMultiplier = Number.isFinite(entry.baseMultiplier) && Math.abs(entry.baseMultiplier - 1) > 0.0001
        ? ` · ${zh ? '基础倍率' : 'Base multiplier'} x${formatCalculationValue(entry.baseMultiplier, 3)}`
        : ''
      sourceRows.push({
        key: `skill:${entry.source}:${entry.damageType}`,
        value: `${formatCalculationValue(entry.min, 1)} - ${formatCalculationValue(entry.max, 1)}`,
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
      value: `${formatCalculationValue(row.min, 1)} - ${formatCalculationValue(row.max, 1)}`,
      source: row.source,
      scope: typeLabel(row.damageType),
      stat: [...row.stats].join(' / '),
    })
  } else if (selectedBucket === 'gain') {
    for (const [index, entry] of (details?.gains || []).entries()) sourceRows.push({
      key: `${entry.source}:${entry.stat}:${entry.fromType}:${entry.toType}:${index}`,
      value: `${formatCalculationValue(entry.value, 2)}%`,
      source: entry.source,
      scope: `${typeLabel(entry.fromType)} → ${typeLabel(entry.toType)}`,
      stat: entry.stat,
    })
  } else {
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
      value: `${formatCalculationValue(row.value, 2)}%`,
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

  if (loading) return <div className="skill-detail-loading">{zh ? '正在生成伤害计算详情...' : 'Building damage calculation details...'}</div>

  return <div className="skill-damage-detail-page">
    <section className="skill-detail-block">
      <h3>{zh ? '当前伤害结构' : 'Current Damage Structure'}</h3>
      <div className="skill-damage-insights">
        <div><span>{zh ? '主要伤害' : 'Primary damage'}</span><strong>{dominantType ? typeLabel(dominantType.type) : '-'}</strong><small>{dominantType && compositionTotal ? `${formatCalculationValue(dominantType.average / compositionTotal * 100, 1)}% ${zh ? '最终伤害' : 'of final damage'}` : '-'}</small></div>
        <div><span>{zh ? '最高提高 (Increased)' : 'Highest Increased'}</span><strong>{strongestIncrease ? `${formatCalculationValue(strongestIncrease.increased)}%` : '-'}</strong><small>{strongestIncrease ? typeLabel(strongestIncrease.type) : '-'}</small></div>
        <div><span>{zh ? '独立总增 (More) 来源' : 'More sources'}</span><strong>{moreSourceCount}</strong><small>{moreSourceCount ? (zh ? '乘法叠加' : 'multiplicative') : (zh ? '当前未检测到' : 'none detected')}</small></div>
        <div><span>{zh ? '额外获得 (Gain)' : 'Gain as Extra'}</span><strong>{details?.gains?.length || 0}</strong><small>{zh ? '生效来源' : 'active sources'}</small></div>
      </div>
    </section>

    <section className="skill-detail-block">
      <h3>{zh ? '伤害来源' : 'Damage Sources'} <small>{sourceRows.length}</small></h3>
      <div className="skill-bucket-switch" role="tablist" aria-label={zh ? '伤害乘区' : 'Damage buckets'}>{bucketOptions.map((bucket) => <button
        key={bucket.key}
        type="button"
        role="tab"
        aria-selected={selectedBucket === bucket.key}
        className={selectedBucket === bucket.key ? 'active' : ''}
        onClick={() => setSelectedBucket(bucket.key)}
      ><span>{bucket.label}</span><small>{bucket.key === 'added'
        ? (zh ? '基础伤害' : 'base damage')
        : bucket.key === 'increased' ? (zh ? '同乘区相加' : 'additive')
          : bucket.key === 'gain' ? (zh ? '额外获得' : 'as extra')
            : (zh ? '独立相乘' : 'multiplicative')}</small></button>)}</div>
      {sourceRows.length ? <div className="skill-source-list">{sourceRows.map((row) => <div key={row.key}>
        <strong>{row.value}</strong>
        <span>{row.kind === 'skillDamage'
          ? `${zh ? '技能伤害' : 'Skill Damage'} · ${localizeEffect(row.source)}`
          : localizeSource(row.source)}</span>
        <small>{row.scope}</small>
        <code>{translateCalculationStat(row.stat, language)}</code>
      </div>)}</div> : <p className="skill-detail-empty">{zh ? '当前技能在这个乘区没有可用来源。' : 'No active sources in this bucket.'}</p>}
    </section>

    {!!availableTypes.length && <section className="skill-detail-block">
      <h3>{zh ? '伤害类型计算链' : 'Damage Type Calculation'}</h3>
      <div className="skill-damage-type-switch" role="tablist" aria-label={zh ? '伤害类型' : 'Damage type'}>
        <button
          type="button"
          role="tab"
          aria-selected={selectedType === 'all'}
          className={selectedType === 'all' ? 'active' : ''}
          onClick={() => setSelectedType('all')}
        >{zh ? '总计' : 'Total'}</button>
        {availableTypes.map((entry) => <button
          type="button"
          role="tab"
          aria-selected={entry.type === selectedType}
          className={entry.type === selectedType ? 'active' : ''}
          key={entry.type}
          onClick={() => setSelectedType(entry.type as SpecificDamageType)}
        >{zh ? DAMAGE_TYPE_LABELS[entry.type].zh : DAMAGE_TYPE_LABELS[entry.type].en}</button>)}
      </div>
      {selectedType === 'all' && <>
        <dl className="skill-type-summary skill-total-summary">
          <div><dt>{zh ? '总击中范围' : 'Total Hit Range'}</dt><dd>{formatCalculationValue(totalDamage?.hitMin)} - {formatCalculationValue(totalDamage?.hitMax)}</dd></div>
          <div><dt>{zh ? '平均击中' : 'Average Hit'}</dt><dd>{formatCalculationValue(details?.averageHit, 1)}</dd></div>
          <div><dt>{zh ? '最终 DPS' : 'Final DPS'}</dt><dd>{formatCalculationValue(details?.totalDps, 1)}</dd></div>
        </dl>
        <div className="skill-total-damage-chain">{composition.map((entry) => <div key={entry.type}>
          <i className={`damage-${entry.type}`} />
          <strong>{typeLabel(entry.type)}</strong>
          <span>{formatCalculationValue(entry.hitMin)} - {formatCalculationValue(entry.hitMax)}</span>
          <small>{compositionTotal ? `${formatCalculationValue(entry.average / compositionTotal * 100, 1)}%` : '-'}</small>
          <em>{entry.effectiveMultiplier == null ? '-' : `${formatCalculationValue(entry.effectiveMultiplier, 3)}x`}</em>
        </div>)}</div>
        {!!details?.averageHitBreakdown?.length && <div className="skill-average-hit-breakdown">
          <strong>{zh ? '暴击与非暴击汇总' : 'Critical and Non-critical Summary'}</strong>
          <ol className="skill-formula-lines compact">{details.averageHitBreakdown.map((line, index) => <li key={`${line}-${index}`}>{localize(line)}</li>)}</ol>
        </div>}
      </>}
      {selectedType !== 'all' && activeType && <>
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
      <h3>{zh ? '当前生效效果' : 'Active Effects'}</h3>
      <div className="skill-effect-groups">{effects.map((effect) => <div key={effect.key}>
        <strong>{effect.label}</strong>
        {effect.values.length
          ? <ul>{effect.values.map((value) => <li key={value}>{localizeEffect(value)}</li>)}</ul>
          : <span>{zh ? '无' : 'None'}</span>}
      </div>)}</div>
    </section>

    <section className="skill-detail-block">
      <h3>{zh ? '最终 DPS 公式' : 'Final DPS Formula'}</h3>
      {details?.dpsFormula?.length
        ? <ol className="skill-formula-lines">{details.dpsFormula.map((line, index) => <li key={`${line}-${index}`}>{localize(line)}</li>)}</ol>
        : <p className="skill-detail-empty">{zh ? '当前技能没有可用的击中 DPS 公式。' : 'No hit DPS formula is available for this skill.'}</p>}
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
  }>({ groupId: '' })
  const [catalog, setCatalog] = useState<SkillCatalog | null>(null)
  const [tooltip, setTooltip] = useState<GemTooltipTarget | null>(null)
  const [dpsRanking, setDpsRanking] = useState<Record<string, { dps: number; valid: boolean }> | null>(null)
  const [rankingLoading, setRankingLoading] = useState(false)
  const [rankingError, setRankingError] = useState('')
  const rankingRequestId = useRef(0)
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
          <button
            type="button"
            className={`skill-dps-sort${dpsRanking ? ' active' : ''}`}
            disabled={rankingLoading}
            onClick={() => void toggleDpsRanking()}
            title={rankingError || (dpsRanking
              ? (zh ? '恢复导入时的技能组顺序' : 'Restore imported skill order')
              : (zh ? '按有效 DPS 从高到低排序' : 'Sort by effective DPS, highest first'))}
          >
            {rankingLoading ? <LoaderCircle className="spinning" /> : dpsRanking ? <RotateCcw /> : <ArrowDownWideNarrow />}
            {rankingLoading
              ? (zh ? '计算中' : 'Calculating')
              : dpsRanking
                ? (zh ? '恢复顺序' : 'Restore')
                : (zh ? '有效 DPS 排序' : 'Effective DPS')}
          </button>
          {rankingError && <span className="skill-dps-sort-error" title={rankingError}>!</span>}
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
                  ? `${zh ? '有效 DPS' : 'Effective DPS'} ${formatCalculationValue(dpsRanking[group.id].dps, 1)}`
                  : (zh ? '无有效 DPS' : 'No effective DPS')
                : calculatedLevel
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
        {inspectorPage === 'calculation' && <>
          <SkillCalculationPanel
            details={calculationDetails}
            result={selectedCalculation}
            loading={calcLoading}
            zh={zh}
            groupName={mainName}
            activeSkillIndex={activeSkillIndex}
            statSetIndex={statSetIndex}
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
            onCalcModeChange={setCalcMode}
          />
          {calcError && lastCalculationKey.current === calculationKey && <p className="skill-calculation-error">{calcError}</p>}
          <SkillDamageCalculationDetails
            details={calculationDetails}
            loading={calcLoading}
            language={lang}
            catalog={catalog}
          />
        </>}
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

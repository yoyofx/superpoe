import { memo, useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown, ChevronRight, PackageOpen, Upload } from 'lucide-react'
import { FallbackImage } from '@/components/FallbackImage'
import { decodeCodeToXml } from '@/engine/buildCode'
import {
  aggregateEquipmentAffixes,
  type EquipmentAffixCategory,
  type EquipmentAffixSummary,
} from '@/engine/equipmentAffixes'
import { parseEquipmentXml } from '@/engine/equipment'
import { aggregateEquipmentSemantics, type EquipmentSemanticView } from '@/engine/equipmentSemantics'
import { deriveItemDisplayRequirements, deriveItemDisplayStats, deriveWeaponComparisonStats } from '@/engine/itemDisplayStats'
import { loadItemBaseData, resolveItemBaseData, type ItemBaseData } from '@/engine/itemBaseData'
import { loadItemIconIndex, resolveItemIcon, resolveItemIconName, type ItemIconIndex } from '@/engine/itemIcons'
import {
  loadRuneDetails,
  resolveRuneDetail,
  resolveRuneVariant,
  type RuneDetailIndex,
} from '@/engine/runeDetails'
import { translateGameText, type Language } from '@/i18n/translationLoader'
import { useTranslation } from '@/i18n/useTranslation'
import { useTreeStore } from '@/store/treeStore'
import type { EquipmentItem, EquipmentSet, EquipmentSlot } from '@/types/equipment'
import type { EquipmentItemSemantics } from '@/types/equipmentSemantics'
import { inspectEquipment } from '@/engine/pobLuaClient'
import {
  fitPaperDoll,
  getActivePaperDollSlots,
  getPaperDollSlotsForWeaponSet,
  PAPER_DOLL_HEIGHT,
  PAPER_DOLL_WEAPON_SET_CONTROLS,
  PAPER_DOLL_WIDTH,
  paperDollRectStyle,
  type PaperDollSize,
  type PaperDollSlotLayout,
} from '@/engine/paperDollLayout'

const SLOT_KEYS: Record<string, string> = {
  'Weapon 1': 'equipment.slot.weapon1',
  'Weapon 2': 'equipment.slot.weapon2',
  'Weapon 1 Swap': 'equipment.slot.weapon1',
  'Weapon 2 Swap': 'equipment.slot.weapon2',
  Helmet: 'equipment.slot.helmet',
  Gloves: 'equipment.slot.gloves',
  'Body Armour': 'equipment.slot.bodyArmour',
  Boots: 'equipment.slot.boots',
  'Ring 1': 'equipment.slot.ring1',
  'Ring 2': 'equipment.slot.ring2',
  Amulet: 'equipment.slot.amulet',
  Belt: 'equipment.slot.belt',
  'Charm 1': 'equipment.slot.charm1',
  'Charm 2': 'equipment.slot.charm2',
  'Charm 3': 'equipment.slot.charm3',
  'Flask 1': 'equipment.slot.flask1',
  'Flask 2': 'equipment.slot.flask2',
}

const RARITY_CLASS: Record<string, string> = {
  NORMAL: 'rarity-normal',
  MAGIC: 'rarity-magic',
  RARE: 'rarity-rare',
  UNIQUE: 'rarity-unique',
  RELIC: 'rarity-relic',
}

const ITEM_STAT_LABELS: Record<string, { en: string; zh: string }> = {
  quality: { en: 'Quality', zh: '品质' },
  physicalDamage: { en: 'Physical Damage', zh: '物理伤害' },
  elementalDamage: { en: 'Elemental Damage', zh: '元素伤害' },
  chaosDamage: { en: 'Chaos Damage', zh: '混沌伤害' },
  criticalHitChance: { en: 'Critical Hit Chance', zh: '暴击率' },
  attacksPerSecond: { en: 'Attacks per Second', zh: '每秒攻击次数' },
  reloadTime: { en: 'Reload Time', zh: '装填时间' },
  blockChance: { en: 'Chance to Block', zh: '格挡几率' },
  armour: { en: 'Armour', zh: '护甲' },
  evasion: { en: 'Evasion Rating', zh: '闪避值' },
  energyShield: { en: 'Energy Shield', zh: '能量护盾' },
  runicWard: { en: 'Runic Ward', zh: '符文结界' },
  lifeRecovery: { en: 'Life Recovery', zh: '生命恢复' },
  manaRecovery: { en: 'Mana Recovery', zh: '魔力恢复' },
  duration: { en: 'Duration', zh: '持续时间' },
  charges: { en: 'Charges Used / Maximum', zh: '消耗充能 / 最大充能' },
}

const MODIFIER_GROUP_ORDER = ['enchant', 'rune', 'implicit', 'explicit'] as const

function translateItemName(value: string, rarity: string, language: Language): string {
  const translated = translateGameText(value, language)
  if (language === 'en' || translated !== value || rarity.toUpperCase() !== 'RARE') return translated

  const parts = value.split(/\s+/).filter(Boolean)
  const translatedParts = parts.map((part) => translateGameText(part, language))
  return translatedParts.some((part, index) => part !== parts[index]) ? translatedParts.join(' ') : value
}

function itemClassLabel(item: EquipmentItem, base: ItemBaseData | undefined, language: Language): string {
  if (/\bQuarterstaff\b/i.test(item.baseType)) {
    if (language === 'zh-rCN') return '节杖'
    if (language === 'zh-rTW') return '細杖'
    return translateGameText('Quarterstaff', language)
  }
  return translateGameText(base?.subType || base?.type || item.baseType, language)
}

type EquipmentAffixGroup = 'attack' | 'defence' | 'attributes' | 'important' | 'other'

const AFFIX_CATEGORY_ORDER: EquipmentAffixCategory[] = [
  'addedDamage',
  'skillLevels',
  'offence',
  'resources',
  'resistances',
  'defences',
  'attributes',
  'utility',
  'special',
]

const AFFIX_GROUP_ORDER: EquipmentAffixGroup[] = ['attack', 'defence', 'attributes', 'important', 'other']

const AFFIX_GROUP_LABELS: Record<EquipmentAffixGroup, { en: string; zh: string }> = {
  attack: { en: 'Offence', zh: '进攻' },
  defence: { en: 'Defence', zh: '防御' },
  attributes: { en: 'Attributes', zh: '属性' },
  important: { en: 'Important', zh: '重要' },
  other: { en: 'Other', zh: '其他' },
}

const IMPORTANT_AFFIX_PATTERN = /accuracy|chance to hit|penetrat|enemies?.*resistance|resistance.*enemies?|breaks? armour|armour break|ignore[sd]? armour|damage over time|bleed(?:ing)?|poison|ignite|命中|穿透|敌人.*抗性|抗性.*敌人|减抗|破甲|无视护甲|持续伤害|流血|中毒|点燃/i
const BONDED_AFFIX_PATTERN = /^\s*(?:bonded|羁绊)\s*[:：]/i
const FLASK_AFFIX_PATTERN = /flasks?|药剂|藥劑/i
const ENEMY_STUN_THRESHOLD_PATTERN = /enem(?:y|ies).*stun threshold|stun threshold.*enem(?:y|ies)|敌人.*晕眩(?:阈值|门槛)|敵人.*暈眩(?:閾值|門檻)/i

function getAffixGroup(summary: EquipmentAffixSummary): EquipmentAffixGroup {
  const { category, text } = summary
  if (summary.sources.every((source) => /^(?:Flask|Charm)\s+\d+$/i.test(source.slotName))) return 'other'
  if (FLASK_AFFIX_PATTERN.test(text)) return 'other'
  if (BONDED_AFFIX_PATTERN.test(text)) return 'other'
  if (ENEMY_STUN_THRESHOLD_PATTERN.test(text)) return 'important'
  if (IMPORTANT_AFFIX_PATTERN.test(text)) return 'important'
  if (category === 'addedDamage' || category === 'skillLevels' || category === 'offence') return 'attack'
  if (category === 'resources' || category === 'resistances' || category === 'defences') return 'defence'
  if (category === 'attributes') return 'attributes'
  return 'other'
}

function getSocketSlotInfo(slotName: string): { parent: string; index: number } | null {
  const match = slotName.match(/^(.+?)\s+(?:Jewel Socket|Abyssal Socket|珠宝(?:插槽|孔)|珠寶(?:插槽|孔))\s*(\d+)$/i)
  return match ? { parent: match[1].trim(), index: Number(match[2]) } : null
}

function AffixSummaryRow({
  summary,
  expanded,
  onToggle,
  onSelectSource,
}: {
  summary: EquipmentAffixSummary
  expanded: boolean
  onToggle: () => void
  onSelectSource: (itemId: string) => void
}) {
  const { t, lang } = useTranslation()
  const translatedText = translateGameText(summary.text, lang)

  return (
    <div className={`equipment-affix ${expanded ? 'expanded' : ''}`}>
      <button className="equipment-affix-row" type="button" onClick={onToggle} aria-expanded={expanded}>
        <ChevronRight />
        <span>{translatedText}</span>
        <small>{summary.sources.length > 1 ? summary.sources.length : ''}</small>
      </button>
      {expanded && <div className="equipment-affix-sources">
        {summary.sources.map((source, index) => {
          const socketSlot = getSocketSlotInfo(source.slotName)
          const slotLabel = socketSlot
            ? `${t(SLOT_KEYS[socketSlot.parent] || socketSlot.parent)} · ${lang === 'zh-rCN' ? '珠宝' : 'Jewel'} ${socketSlot.index}`
            : t(SLOT_KEYS[source.slotName] || source.slotName)
          return <button key={`${source.itemId}-${source.line}-${index}`} type="button" onClick={() => onSelectSource(source.itemId)}>
            <span>{slotLabel}</span>
            <strong>{translateGameText(source.itemName, lang)}</strong>
            {source.rune && <i>{lang === 'zh-rCN' ? '符文' : 'Rune'}</i>}
          </button>
        })}
      </div>}
    </div>
  )
}

const EquipmentAffixSidebar = memo(function EquipmentAffixSidebar({
  activeSet,
  itemSets,
  weaponSet,
  affixesByGroup,
  affixCount,
  semanticView,
  semanticsLoading,
  collapsedCategories,
  expandedAffixes,
  onSelectSet,
  onSelectSemanticView,
  onToggleCategory,
  onToggleAffix,
  onSelectSource,
}: {
  activeSet: EquipmentSet
  itemSets: EquipmentSet[]
  weaponSet: 1 | 2
  affixesByGroup: Map<EquipmentAffixGroup, EquipmentAffixSummary[]>
  affixCount: number
  semanticView: EquipmentSemanticView | 'all'
  semanticsLoading: boolean
  collapsedCategories: Set<EquipmentAffixGroup>
  expandedAffixes: Set<string>
  onSelectSet: (setId: string) => void
  onSelectSemanticView: (view: EquipmentSemanticView | 'all') => void
  onToggleCategory: (group: EquipmentAffixGroup) => void
  onToggleAffix: (key: string) => void
  onSelectSource: (itemId: string) => void
}) {
  const { t, lang } = useTranslation()

  return (
    <aside className="equipment-loadouts">
      <div className="equipment-affix-heading">
        <span>{lang === 'zh-rCN' ? '已装备词缀' : 'Equipped modifiers'}</span>
        <strong>{lang === 'zh-rCN' ? `武器组 ${weaponSet === 1 ? 'I' : 'II'}` : `Weapon set ${weaponSet === 1 ? 'I' : 'II'}`}</strong>
      </div>
      <div className="equipment-semantic-tabs" role="tablist" aria-label={lang === 'zh-rCN' ? '装备词缀视图' : 'Equipment modifier view'}>
        {(['offence', 'defence', 'all'] as const).map((view) => {
          const label = view === 'offence'
            ? (lang === 'zh-rCN' ? '进攻' : 'Offence')
            : view === 'defence' ? (lang === 'zh-rCN' ? '防御' : 'Defence') : (lang === 'zh-rCN' ? '全部' : 'All')
          return <button
            key={view}
            type="button"
            role="tab"
            aria-selected={semanticView === view}
            className={semanticView === view ? 'active' : ''}
            onClick={() => onSelectSemanticView(view)}
          >{label}</button>
        })}
      </div>
      <label className="equipment-loadout-select">
        <span>{lang === 'zh-rCN' ? '装备方案' : 'Loadout'}</span>
        <select value={activeSet.id} onChange={(event) => onSelectSet(event.target.value)}>
          {itemSets.map((set, index) => {
            const title = /^Set \d+$/i.test(set.title) ? t('equipment.defaultSet', { number: index + 1 }) : set.title
            return <option key={set.id} value={set.id}>{title}</option>
          })}
        </select>
      </label>
      <div className="equipment-affix-list">
        {AFFIX_GROUP_ORDER.map((group) => {
          const summaries = affixesByGroup.get(group)
          if (!summaries?.length) return null
          const collapsed = collapsedCategories.has(group)
          const label = AFFIX_GROUP_LABELS[group]
          return <section className="equipment-affix-category" key={group}>
            <button
              className="equipment-affix-category-toggle"
              type="button"
              onClick={() => onToggleCategory(group)}
              aria-expanded={!collapsed}
            >
              <span>{lang === 'zh-rCN' ? label.zh : label.en}</span>
              <small>{summaries.length}</small>
              {collapsed ? <ChevronRight /> : <ChevronDown />}
            </button>
            {!collapsed && summaries.map((summary) => <AffixSummaryRow
              key={summary.key}
              summary={summary}
              expanded={expandedAffixes.has(summary.key)}
              onToggle={() => onToggleAffix(summary.key)}
              onSelectSource={onSelectSource}
            />)}
          </section>
        })}
        {!affixCount && <div className="equipment-affix-empty">{semanticsLoading && semanticView !== 'all'
          ? (lang === 'zh-rCN' ? '装备数据分析中' : 'Analysing equipment')
          : (lang === 'zh-rCN' ? '当前装备没有可汇总的词缀' : 'No equipped modifiers to summarize')}</div>}
      </div>
    </aside>
  )
})

function SocketedRunes({
  item,
  index,
  details,
  slotName,
  socketedItems = [],
  compact = false,
  onSelectSocketedItem,
}: {
  item: EquipmentItem
  index: ItemIconIndex | null
  details: RuneDetailIndex | null
  slotName?: string
  socketedItems?: EquipmentItem[]
  compact?: boolean
  onSelectSocketedItem?: (item: EquipmentItem) => void
}) {
  const { lang } = useTranslation()
  useTreeStore((state) => state.translationRevision)
  const [tooltip, setTooltip] = useState<{
    x: number
    y: number
    above: boolean
    imageUrl?: string
    label: string
    type: string
    category: string
    stats: string[]
  } | null>(null)
  const socketContents = item.runes.map((rune) => ({ rune, item: undefined as EquipmentItem | undefined }))
  const normalizeSocketContent = (value: string) => value.replace(/[^a-z0-9]+/gi, '').toLowerCase()
  for (const socketedItem of socketedItems) {
    const aliases = new Set([socketedItem.name, socketedItem.baseType].map(normalizeSocketContent))
    const placeholderIndex = socketContents.findIndex((content) => !content.item && aliases.has(normalizeSocketContent(content.rune)))
    if (placeholderIndex >= 0) socketContents[placeholderIndex] = { rune: '', item: socketedItem }
    else socketContents.push({ rune: '', item: socketedItem })
  }
  const socketCount = Math.max(item.socketCount, socketContents.length)
  if (!socketCount) return null

  const typeLabel = (value: string) => {
    if (lang !== 'zh-rCN') return value
    return ({ Rune: '符文', SoulCore: '灵魂核心', Idol: '雕像', CongealedMist: '凝结迷雾', Jewel: '珠宝', Skill: '技能' } as Record<string, string>)[value] || value
  }
  const categoryLabel = (value: string) => {
    if (lang !== 'zh-rCN') return value
    return ({ weapon: '武器', wand: '法杖', staff: '长杖', sceptre: '权杖', shield: '盾牌', buckler: '圆盾', armour: '护甲', helmet: '头盔', 'body armour': '胸甲', gloves: '手套', boots: '鞋子', skill: '装备授予' } as Record<string, string>)[value] || value
  }
  const translateRuneStat = (value: string) => {
    if (!value.startsWith('Bonded:')) return translateGameText(value, lang)
    const translated = translateGameText(value.slice('Bonded:'.length).trim(), lang)
    return lang === 'zh-rCN' ? `羁绊：${translated}` : `Bonded: ${translated}`
  }

  return (
    <div className={compact ? 'socket-overlay' : 'socket-detail-list'} onMouseLeave={() => setTooltip(null)}>
      {Array.from({ length: socketCount }, (_, socketIndex) => {
        const content = socketContents[socketIndex]
        const rune = content?.rune || ''
        const socketedItem = content?.item
        const imageUrl = socketedItem ? resolveItemIcon(socketedItem, index) : (rune ? resolveItemIconName(rune, index) : undefined)
        const detail = rune ? resolveRuneDetail(rune, details) : undefined
        const label = socketedItem
          ? translateGameText(socketedItem.name, lang)
          : (rune ? detail?.localizedNames?.[lang] || translateGameText(rune, lang) : '')
        const resolved = resolveRuneVariant(detail, item, slotName)
        const centerLastSocket = compact && socketCount % 2 === 1 && socketIndex === socketCount - 1
        const tooltipType = socketedItem ? typeLabel('Jewel') : typeLabel(resolved?.variant.type || '')
        const tooltipCategory = socketedItem ? translateGameText(socketedItem.baseType, lang) : categoryLabel(resolved?.category || '')
        const tooltipStats = socketedItem
          ? socketedItem.lines.map((line) => translateGameText(line.replace(/\{[^}]+\}/g, ''), lang))
          : (resolved?.variant.localizedStats?.[lang] || resolved?.variant.stats || []).map(translateRuneStat)
        return (
          <span
            key={`${rune}-${socketedItem?.id || ''}-${socketIndex}`}
            className={`${centerLastSocket ? 'socket-entry center-last' : 'socket-entry'} ${socketedItem && onSelectSocketedItem ? 'selectable' : ''}`}
            onClick={(event) => {
              if (!socketedItem || !onSelectSocketedItem) return
              event.stopPropagation()
              onSelectSocketedItem(socketedItem)
            }}
            onMouseOver={(event) => {
              if (!rune && !socketedItem) return
              const rect = event.currentTarget.getBoundingClientRect()
              const above = rect.top > 190
              setTooltip({
                x: Math.max(170, Math.min(window.innerWidth - 170, rect.left + rect.width / 2)),
                y: above ? rect.top - 9 : rect.bottom + 9,
                above,
                imageUrl,
                label,
                type: tooltipType,
                category: tooltipCategory,
                stats: tooltipStats,
              })
            }}
          >
            <span className="rune-socket" aria-label={label || 'Empty socket'}>
              <FallbackImage src={imageUrl} alt={label} fallback={<span>{socketedItem ? 'J' : (rune ? 'R' : '')}</span>} />
            </span>
            {!compact && <span className="socket-copy"><strong>{label || 'Empty'}</strong><small>{socketedItem ? `${typeLabel('Jewel')} · ${tooltipCategory}` : (resolved ? `${typeLabel(resolved.variant.type)} · ${categoryLabel(resolved.category)}` : (rune ? 'Rune / Soul Core / Idol' : 'Empty socket'))}</small></span>}
          </span>
        )
      })}
      {tooltip && createPortal(
        <div
          className={`rune-tooltip ${tooltip.above ? 'above' : 'below'}`}
          style={{ left: tooltip.x, top: tooltip.y }}
          role="tooltip"
        >
          <header>
            <span className="rune-tooltip-icon"><FallbackImage src={tooltip.imageUrl} alt="" /></span>
            <span><strong>{tooltip.label}</strong><small>{[tooltip.type, tooltip.category].filter(Boolean).join(' · ')}</small></span>
          </header>
          {tooltip.stats.length
            ? <div className="rune-tooltip-stats">{tooltip.stats.map((stat, statIndex) => <p key={`${stat}-${statIndex}`} className={stat.startsWith('Bonded:') || stat.startsWith('羁绊：') ? 'bonded' : ''}>{stat}</p>)}</div>
            : <p className="rune-tooltip-empty">{lang === 'zh-rCN' ? '暂无可用的详细词条' : 'No detailed modifier data available'}</p>}
        </div>,
        document.body,
      )}
    </div>
  )
}

function ItemDetail({ item, base, itemIconIndex, runeDetails, slotName, socketedItems }: { item: EquipmentItem; base?: ItemBaseData; itemIconIndex: ItemIconIndex | null; runeDetails: RuneDetailIndex | null; slotName?: string; socketedItems?: EquipmentItem[] }) {
  const { t, lang } = useTranslation()
  useTreeStore((state) => state.translationRevision)
  const translateItemText = (value: string) => translateGameText(value.replace(/\{[^}]+\}/g, ''), lang)
  const rarityClass = RARITY_CLASS[item.rarity] || RARITY_CLASS.NORMAL
  const rarityKey = rarityClass.replace('rarity-', '')
  const runicHeader = /^(?:Runeforged|Runemastered)\b/i.test(item.baseType)
  const displayStats = deriveItemDisplayStats(item, base)
  const weaponComparisonStats = deriveWeaponComparisonStats(item, base)
  const modifiers = (item.modifiers || item.lines.map((line) => ({ text: line.replace(/\{[^}]+\}/g, ''), tags: [], group: 'explicit' as const })))
    .filter((modifier) => !/^Bonded\s*:/i.test(modifier.text))
  const modifierGroups = MODIFIER_GROUP_ORDER
    .map((group) => ({ group, entries: modifiers.filter((modifier) => modifier.group === group) }))
    .filter(({ entries }) => entries.length)
  const requirements = base?.requirements || {}
  const displayRequirements = deriveItemDisplayRequirements(item, base)
  const attributeRequirements = ([
    ['str', '力量', 'Str'],
    ['dex', '敏捷', 'Dex'],
    ['int', '智慧', 'Int'],
  ] as const).filter(([field]) => requirements[field])
  const propertyType = itemClassLabel(item, base, lang)

  return (
    <aside className="equipment-inspector">
      <header className={`inspector-title item-header-${rarityKey} ${runicHeader ? 'runic-item-header' : ''} ${rarityClass}`}>
        <div className="item-header-copy">
          <h2>{translateItemName(item.name, item.rarity, lang)}</h2>
          {item.name !== item.baseType && <p>{translateItemText(item.baseType)}</p>}
        </div>
      </header>

      <div className="inspector-scroll">
        <div className="item-property-type">
          {propertyType}{item.itemLevel ? `: ${t('equipment.itemLevel', { value: item.itemLevel })}` : ''}
        </div>
        {displayStats.length > 0 && <div className="item-display-stats">
          {displayStats.map((stat) => <div key={stat.key}>
            <span>{ITEM_STAT_LABELS[stat.key]?.[lang === 'zh-rCN' ? 'zh' : 'en'] || stat.key}:</span>
            <strong className={[stat.tone ? `stat-${stat.tone}` : '', stat.augmented ? 'stat-augmented' : ''].filter(Boolean).join(' ')}>
              {stat.segments
                ? stat.segments.map((segment, index) => <span className={`stat-${segment.tone}`} key={`${segment.tone}-${segment.value}`}>{index ? ', ' : ''}{segment.value}</span>)
                : stat.value}
            </strong>
          </div>)}
        </div>}
        <div className="item-metadata">
          {item.levelReq && <span>{t('equipment.levelReq', { value: item.levelReq })}</span>}
          {attributeRequirements.map(([field, zhLabel, enLabel]) => {
            const value = displayRequirements[field] || requirements[field]
            const augmented = value !== requirements[field]
            return <span key={field}>
              {lang === 'zh-rCN'
                ? <><strong className={augmented ? 'requirement-augmented' : ''}>{value}</strong> {zhLabel}</>
                : <>{enLabel} <strong className={augmented ? 'requirement-augmented' : ''}>{value}</strong></>}
            </span>
          })}
          {item.sockets && <span>{t('equipment.sockets', { value: item.sockets })}</span>}
        </div>

        <div className="item-modifiers">
          {modifierGroups.map(({ group, entries }) => <section className={`modifier-group modifier-${group}`} key={group}>
            {entries.map((modifier, index) => {
              const styleTag = modifier.tags.find((tag) => ['crafted', 'fractured', 'mutated', 'rune', 'enchant'].includes(tag))
              return <p key={`${modifier.text}-${index}`} className={styleTag ? `mod-${styleTag}` : ''}>{translateItemText(modifier.text)}</p>
            })}
          </section>)}
        </div>

        {weaponComparisonStats.length > 0 && <div className="weapon-comparison-stats">
          {weaponComparisonStats.map((stat) => <span key={stat.key}>
            <strong>{stat.key}</strong> {stat.value}
          </span>)}
        </div>}

        {!!Math.max(item.socketCount, socketedItems?.length || 0) && <>
          <div className="inspector-section-title"><span>{lang === 'zh-rCN' ? '孔位镶嵌物' : 'Socketed items'}</span><small>{Math.max(item.socketCount, item.runes.length + (socketedItems?.length || 0))}</small></div>
          <SocketedRunes item={item} index={itemIconIndex} details={runeDetails} slotName={slotName} socketedItems={socketedItems} />
        </>}
      </div>
    </aside>
  )
}

function PaperDollSlot({
  layout,
  item,
  imageUrl,
  itemIconIndex,
  runeDetails,
  socketedItems,
  selected,
  activeWeaponSet,
  onSelect,
  onSelectSocketedItem,
}: {
  layout: PaperDollSlotLayout
  item?: EquipmentItem
  imageUrl?: string
  itemIconIndex: ItemIconIndex | null
  runeDetails: RuneDetailIndex | null
  socketedItems?: EquipmentItem[]
  selected: boolean
  activeWeaponSet: 1 | 2
  onSelect: () => void
  onSelectSocketedItem: (item: EquipmentItem) => void
}) {
  const { t, lang } = useTranslation()
  useTreeStore((state) => state.translationRevision)
  const slotName = layout.slotName
  const slotLabel = t(SLOT_KEYS[slotName] || slotName)
  const itemName = item ? translateGameText(item.name, lang) : ''
  const rarityClass = item ? RARITY_CLASS[item.rarity] || RARITY_CLASS.NORMAL : 'slot-empty'
  const weaponClass = layout.weaponSet
    ? `weapon-slot ${layout.weaponSet === activeWeaponSet ? 'active-weapon-set' : 'inactive-weapon-set'}`
    : ''
  const setLabel = layout.weaponSet ? ` ${layout.weaponSet === 1 ? 'I' : 'II'}` : ''

  return (
    <button
      onClick={onSelect}
      disabled={!item && !layout.weaponSet}
      title={item ? undefined : `${slotLabel}${setLabel}`}
      aria-label={item ? `${slotLabel}${setLabel}: ${itemName}` : `${slotLabel}${setLabel}`}
      className={`paper-doll-slot ${weaponClass} ${rarityClass} ${selected ? 'selected' : ''}`}
      style={paperDollRectStyle(layout.rect)}
    >
      {item && <FallbackImage
        className="slot-item-image"
        src={imageUrl}
        alt={itemName}
        fallback={<span className="missing-item-glyph">{itemName.slice(0, 1)}</span>}
      />}
      {item && <SocketedRunes
        item={item}
        index={itemIconIndex}
        details={runeDetails}
        slotName={slotName}
        socketedItems={socketedItems}
        compact
        onSelectSocketedItem={onSelectSocketedItem}
      />}
    </button>
  )
}

function usePaperDollSize() {
  const hostRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState<PaperDollSize>({ width: 0, height: 0, scale: 0 })

  useLayoutEffect(() => {
    const host = hostRef.current
    if (!host) return
    const update = () => setSize(fitPaperDoll(host.clientWidth, host.clientHeight))
    update()
    const observer = new ResizeObserver(update)
    observer.observe(host)
    return () => observer.disconnect()
  }, [])

  return { hostRef, size }
}

export function EquipmentPanel() {
  const { t, lang } = useTranslation()
  const importedBuildCode = useTreeStore((state) => state.importedBuildCode)
  const [itemIconIndex, setItemIconIndex] = useState<ItemIconIndex | null>(null)
  const [runeDetails, setRuneDetails] = useState<RuneDetailIndex | null>(null)
  const [itemBases, setItemBases] = useState<Record<string, ItemBaseData>>({})
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selectedSetId, setSelectedSetId] = useState<string | null>(null)
  const [weaponSet, setWeaponSet] = useState<1 | 2>(1)
  const [paperDollBackgroundAvailable, setPaperDollBackgroundAvailable] = useState(true)
  const [collapsedCategories, setCollapsedCategories] = useState<Set<EquipmentAffixGroup>>(new Set())
  const [expandedAffixes, setExpandedAffixes] = useState<Set<string>>(new Set())
  const [semanticView, setSemanticView] = useState<EquipmentSemanticView | 'all'>('offence')
  const [semanticsById, setSemanticsById] = useState<Record<string, EquipmentItemSemantics>>({})
  const [semanticsLoading, setSemanticsLoading] = useState(false)
  const { hostRef, size: paperDollSize } = usePaperDollSize()

  useEffect(() => {
    let mounted = true
    loadItemIconIndex().then((index) => mounted && setItemIconIndex(index))
    loadRuneDetails().then((details) => mounted && setRuneDetails(details))
    loadItemBaseData().then((index) => mounted && setItemBases(index.bases)).catch(() => {})
    return () => { mounted = false }
  }, [])

  const equipment = useMemo(() => {
    if (!importedBuildCode) return null
    try { return parseEquipmentXml(decodeCodeToXml(importedBuildCode)) } catch { return null }
  }, [importedBuildCode])
  const activeSetId = selectedSetId || equipment?.activeItemSetId
  const activeSet = equipment?.itemSets.find((set) => set.id === activeSetId) || equipment?.itemSets[0]
  const activeSlotNames = new Set(getActivePaperDollSlots(weaponSet).map((slot) => slot.slotName))
  const equipped = activeSet?.slots.filter((slot) => activeSlotNames.has(slot.name) && slot.itemId) || []
  const affixInput = useMemo(() => ({
    activeSet,
    weaponSet,
    itemsById: equipment?.itemsById || {},
  }), [activeSet, equipment?.itemsById, weaponSet])
  const deferredAffixInput = useDeferredValue(affixInput)
  const affixSlots = useMemo(() => {
    if (!deferredAffixInput.activeSet) return []
    const visibleSlots = new Set(getActivePaperDollSlots(deferredAffixInput.weaponSet).map((slot) => slot.slotName))
    const result: EquipmentSlot[] = deferredAffixInput.activeSet.slots
      .filter((slot) => slot.active && slot.itemId && visibleSlots.has(slot.name))
    for (const slot of deferredAffixInput.activeSet.slots) {
      const socketSlot = getSocketSlotInfo(slot.name)
      if (slot.active && slot.itemId && socketSlot && visibleSlots.has(socketSlot.parent)) result.push(slot)
    }
    return result
  }, [deferredAffixInput])
  const allAffixSummaries = useMemo(
    () => aggregateEquipmentAffixes(affixSlots, deferredAffixInput.itemsById),
    [affixSlots, deferredAffixInput.itemsById],
  )
  const affixSummaries = useMemo(() => semanticView === 'all'
    ? allAffixSummaries
    : aggregateEquipmentSemantics(affixSlots, deferredAffixInput.itemsById, semanticsById, semanticView),
  [affixSlots, deferredAffixInput.itemsById, allAffixSummaries, semanticView, semanticsById])
  const affixesByGroup = useMemo(() => {
    const groups = new Map<EquipmentAffixGroup, EquipmentAffixSummary[]>()
    const ordered = [...affixSummaries].sort((left, right) => (
      AFFIX_CATEGORY_ORDER.indexOf(left.category) - AFFIX_CATEGORY_ORDER.indexOf(right.category)
    ))
    for (const summary of ordered) {
      const group = getAffixGroup(summary)
      const entries = groups.get(group) || []
      entries.push(summary)
      groups.set(group, entries)
    }
    return groups
  }, [affixSummaries])
  const firstItem = equipped.map((slot) => equipment?.itemsById[slot.itemId]).find(Boolean)
  const selected = (selectedId && equipment?.itemsById[selectedId]) || firstItem
  const selectedSlotName = selected ? activeSet?.slots.find((slot) => slot.itemId === selected.id)?.name : undefined

  useEffect(() => {
    let cancelled = false
    const items = Object.values(equipment?.itemsById || {}).filter((item) => item.raw)
    if (!items.length) {
      setSemanticsById({})
      setSemanticsLoading(false)
      return () => { cancelled = true }
    }
    setSemanticsById({})
    setSemanticsLoading(true)
    void inspectEquipment(items.map(({ id, raw }) => ({ id, raw })))
      .then((result) => {
        if (!cancelled) setSemanticsById(result.items)
      })
      .catch(() => {
        if (!cancelled) setSemanticsById({})
      })
      .finally(() => {
        if (!cancelled) setSemanticsLoading(false)
      })
    return () => { cancelled = true }
  }, [equipment])

  useEffect(() => {
    if (activeSet) setWeaponSet(activeSet.useSecondWeaponSet ? 2 : 1)
  }, [activeSet?.id, activeSet?.useSecondWeaponSet])

  useEffect(() => {
    setCollapsedCategories(new Set())
    setExpandedAffixes(new Set())
  }, [activeSet?.id])

  const handleSelectSet = useCallback((setId: string) => {
    setSelectedSetId(setId)
    setSelectedId(null)
  }, [])
  const handleToggleCategory = useCallback((group: EquipmentAffixGroup) => {
    setCollapsedCategories((current) => {
      const next = new Set(current)
      if (next.has(group)) next.delete(group)
      else next.add(group)
      return next
    })
  }, [])
  const handleToggleAffix = useCallback((key: string) => {
    setExpandedAffixes((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])

  const itemForSlot = (slotName: string) => {
    const slot = activeSet?.slots.find((entry) => entry.name === slotName)
    return slot ? equipment?.itemsById[slot.itemId] : undefined
  }

  const socketedItemsForSlot = (slotName: string) => activeSet?.slots
    .map((slot) => {
      const socketSlot = getSocketSlotInfo(slot.name)
      return socketSlot && socketSlot.parent.toLowerCase() === slotName.toLowerCase()
        ? { order: socketSlot.index, item: equipment?.itemsById[slot.itemId] }
        : null
    })
    .filter((entry): entry is { order: number; item: EquipmentItem } => Boolean(entry?.item))
    .sort((a, b) => a.order - b.order)
    .map((entry) => entry.item) || []

  const paperDollStyle = {
    width: `${paperDollSize.width}px`,
    height: `${paperDollSize.height}px`,
    '--paper-socket-size': `${Math.max(16, 72 * paperDollSize.scale)}px`,
    '--paper-socket-gap': `${Math.max(2, 10 * paperDollSize.scale)}px`,
  } as CSSProperties

  if (!equipment || !activeSet) {
    return (
      <section className="workspace-empty equipment-empty">
        <PackageOpen />
        <h2>{t('equipment.title')}</h2>
        <p>{t('equipment.importHint')}</p>
        <button className="primary-command" onClick={() => window.dispatchEvent(new Event('open-import-menu'))}><Upload />{t('toolbar.import')}</button>
      </section>
    )
  }

  return (
    <section className="equipment-workspace">
      <EquipmentAffixSidebar
        activeSet={activeSet}
        itemSets={equipment.itemSets}
        weaponSet={deferredAffixInput.weaponSet}
        affixesByGroup={affixesByGroup}
        affixCount={affixSummaries.length}
        semanticView={semanticView}
        semanticsLoading={semanticsLoading}
        collapsedCategories={collapsedCategories}
        expandedAffixes={expandedAffixes}
        onSelectSet={handleSelectSet}
        onSelectSemanticView={setSemanticView}
        onToggleCategory={handleToggleCategory}
        onToggleAffix={handleToggleAffix}
        onSelectSource={setSelectedId}
      />

      <div className="paper-doll-stage">
        <header className="paper-doll-heading"><span>{t('equipment.title')}</span><small>{lang === 'zh-rCN' ? '选择装备查看完整属性' : 'Select an item to inspect its properties'}</small></header>
        <div ref={hostRef} className="paper-doll-frame-host">
          <div
            className={`paper-doll-frame ${paperDollBackgroundAvailable ? '' : 'background-missing'}`}
            style={paperDollStyle}
            data-source-width={PAPER_DOLL_WIDTH}
            data-source-height={PAPER_DOLL_HEIGHT}
          >
            {paperDollBackgroundAvailable && <img
              className="paper-doll-background"
              src="/assets/ui/workbench/equip-bg-D8S81SLb.png"
              alt=""
              onError={() => setPaperDollBackgroundAvailable(false)}
            />}
            {PAPER_DOLL_WEAPON_SET_CONTROLS.map((control) => {
              const roman = control.weaponSet === 1 ? 'I' : 'II'
              const label = lang === 'zh-rCN' ? `切换到武器组 ${roman}` : `Switch to weapon set ${roman}`
              return <button
                key={`${control.side}-${control.weaponSet}`}
                type="button"
                className={`paper-doll-weapon-set-control ${weaponSet === control.weaponSet ? 'active' : ''}`}
                style={paperDollRectStyle(control.rect)}
                title={label}
                aria-label={label}
                aria-pressed={weaponSet === control.weaponSet}
                onClick={() => setWeaponSet(control.weaponSet)}
              />
            })}
            {getPaperDollSlotsForWeaponSet(weaponSet).map((slot) => {
              const item = itemForSlot(slot.slotName)
              const imageUrl = item ? resolveItemIcon(item, itemIconIndex) : undefined
              const socketedItems = socketedItemsForSlot(slot.slotName)
              return <PaperDollSlot
                key={slot.slotName}
                layout={slot}
                item={item}
                imageUrl={imageUrl}
                itemIconIndex={itemIconIndex}
                runeDetails={runeDetails}
                socketedItems={socketedItems}
                selected={item?.id === selected?.id || socketedItems.some((socketedItem) => socketedItem.id === selected?.id)}
                activeWeaponSet={weaponSet}
                onSelect={() => {
                  if (slot.weaponSet) setWeaponSet(slot.weaponSet)
                  if (item) setSelectedId(item.id)
                }}
                onSelectSocketedItem={(socketedItem) => setSelectedId(socketedItem.id)}
              />
            })}
          </div>
        </div>
      </div>

      {selected
        ? <ItemDetail item={selected} base={resolveItemBaseData(selected.baseType, itemBases)} itemIconIndex={itemIconIndex} runeDetails={runeDetails} slotName={selectedSlotName} socketedItems={selectedSlotName ? socketedItemsForSlot(selectedSlotName) : []} />
        : <aside className="equipment-inspector empty-inspector"><ChevronRight /><span>{lang === 'zh-rCN' ? '选择一件装备' : 'Select an item'}</span></aside>}
    </section>
  )
}

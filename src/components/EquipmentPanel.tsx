import { memo, useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent } from 'react'
import { createPortal } from 'react-dom'
import { ArrowLeftRight, Bookmark, Check, ChevronDown, ChevronRight, Clipboard, Gem, PackageOpen, PanelRightOpen, Search, Sparkles, Upload, X } from 'lucide-react'
import { FallbackImage } from '@/components/FallbackImage'
import {
  type EquipmentAffixCategory,
  type EquipmentAffixSemanticGroup,
  type EquipmentAffixSummary,
} from '@/engine/equipmentAffixes'
import { parseEquipmentCode, parseEquipmentObject } from '@/engine/equipment'
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
import { LANGUAGE_LOCALES, uiText, type UiMessage } from '@/i18n/uiLocale'
import { getActiveBuildSession, useTreeStore } from '@/store/treeStore'
import type { PassiveJewel } from '@/engine/buildCode'
import type { EquipmentItem, EquipmentSet, EquipmentSlot } from '@/types/equipment'
import type { EquipmentItemSemantics } from '@/types/equipmentSemantics'
import type { EquipmentLibraryEntry } from '@/types/market'
import { EquipmentLibraryPicker } from '@/components/equipment/EquipmentLibraryPicker'
import { EquipmentDetailQuickNav, type EquipmentDetailQuickNavSection } from '@/components/equipment/EquipmentDetailQuickNav'
import type { CalcResult } from '@/types/calc'
import { inspectEquipment } from '@/engine/pobLuaClient'
import { EquipmentDifferenceTooltip } from '@/equipmentDifference/components/EquipmentDifferenceTooltip'
import type { BuildContextSnapshot } from '@/equipmentDifference'
import {
  fitPaperDoll,
  getActivePaperDollSlots,
  getPaperDollSlotsForWeaponSet,
  PAPER_DOLL_DISPLAY_HEIGHT,
  PAPER_DOLL_HEIGHT,
  PAPER_DOLL_WEAPON_SET_CONTROLS,
  PAPER_DOLL_WIDTH,
  PAPER_DOLL_VIEW_TOP,
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

const ITEM_STAT_LABELS: Record<string, UiMessage> = {
  quality: { en: 'Quality', 'zh-rCN': '品质', 'zh-rTW': '品質', 'ko-KR': '퀄리티' },
  physicalDamage: { en: 'Physical Damage', 'zh-rCN': '物理伤害', 'zh-rTW': '物理傷害', 'ko-KR': '물리 피해' },
  elementalDamage: { en: 'Elemental Damage', 'zh-rCN': '元素伤害', 'zh-rTW': '元素傷害', 'ko-KR': '원소 피해' },
  chaosDamage: { en: 'Chaos Damage', 'zh-rCN': '混沌伤害', 'zh-rTW': '混沌傷害', 'ko-KR': '카오스 피해' },
  criticalHitChance: { en: 'Critical Hit Chance', 'zh-rCN': '暴击率', 'zh-rTW': '暴擊率', 'ko-KR': '치명타 확률' },
  attacksPerSecond: { en: 'Attacks per Second', 'zh-rCN': '每秒攻击次数', 'zh-rTW': '每秒攻擊次數', 'ko-KR': '초당 공격 횟수' },
  reloadTime: { en: 'Reload Time', 'zh-rCN': '装填时间', 'zh-rTW': '裝填時間', 'ko-KR': '재장전 시간' },
  blockChance: { en: 'Chance to Block', 'zh-rCN': '格挡几率', 'zh-rTW': '格擋機率', 'ko-KR': '막기 확률' },
  armour: { en: 'Armour', 'zh-rCN': '护甲', 'zh-rTW': '護甲', 'ko-KR': '방어도' },
  evasion: { en: 'Evasion Rating', 'zh-rCN': '闪避值', 'zh-rTW': '閃避值', 'ko-KR': '회피' },
  energyShield: { en: 'Energy Shield', 'zh-rCN': '能量护盾', 'zh-rTW': '能量護盾', 'ko-KR': '에너지 보호막' },
  runicWard: { en: 'Runic Ward', 'zh-rCN': '符文结界', 'zh-rTW': '符文結界', 'ko-KR': '룬 수호' },
  lifeRecovery: { en: 'Life Recovery', 'zh-rCN': '生命恢复', 'zh-rTW': '生命恢復', 'ko-KR': '생명력 회복' },
  manaRecovery: { en: 'Mana Recovery', 'zh-rCN': '魔力恢复', 'zh-rTW': '魔力恢復', 'ko-KR': '마나 회복' },
  duration: { en: 'Duration', 'zh-rCN': '持续时间', 'zh-rTW': '持續時間', 'ko-KR': '지속시간' },
  charges: { en: 'Charges Used / Maximum', 'zh-rCN': '消耗充能 / 最大充能', 'zh-rTW': '消耗充能 / 最大充能', 'ko-KR': '충전 소모 / 최대' },
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
    return ({ en: 'Quarterstaff', 'zh-rCN': '节杖', 'zh-rTW': '細杖', 'ko-KR': '쿼터스태프' } satisfies UiMessage)[language]
  }
  return translateGameText(base?.subType || base?.type || item.baseType, language)
}

type EquipmentAffixGroup = 'attack' | 'defence' | 'life' | 'mana' | 'resistances' | 'defenceOther' | 'attributes' | 'important' | 'other' | EquipmentAffixSemanticGroup
type EquipmentSidebarView = EquipmentSemanticView | 'character'

interface EquipmentContextMenuState {
  itemId: string
  slotName: string
  left: number
  top: number
}

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

const DEFENCE_GROUP_ORDER: EquipmentAffixGroup[] = ['life', 'mana', 'resistances', 'defenceOther']
const OFFENCE_GROUP_ORDER: EquipmentAffixGroup[] = [
  'flatDamage',
  'increased',
  'gain',
  'moreLess',
  'skillLevels',
  'speed',
  'critical',
  'accuracyPenetration',
  'ailments',
  'offenceOther',
  'grantedSkills',
]

const AFFIX_GROUP_LABELS: Record<EquipmentAffixGroup, UiMessage> = {
  attack: { en: 'Offence', 'zh-rCN': '进攻', 'zh-rTW': '進攻', 'ko-KR': '공격' },
  defence: { en: 'Defence', 'zh-rCN': '防御', 'zh-rTW': '防禦', 'ko-KR': '방어' },
  life: { en: 'Life', 'zh-rCN': '生命', 'zh-rTW': '生命', 'ko-KR': '생명력' },
  mana: { en: 'Mana', 'zh-rCN': '魔力', 'zh-rTW': '魔力', 'ko-KR': '마나' },
  resistances: { en: 'Resistances', 'zh-rCN': '抗性', 'zh-rTW': '抗性', 'ko-KR': '저항' },
  defenceOther: { en: 'Other Defences', 'zh-rCN': '其他防御', 'zh-rTW': '其他防禦', 'ko-KR': '기타 방어' },
  attributes: { en: 'Attributes', 'zh-rCN': '属性', 'zh-rTW': '屬性', 'ko-KR': '속성' },
  important: { en: 'Important', 'zh-rCN': '重要', 'zh-rTW': '重要', 'ko-KR': '중요' },
  other: { en: 'Other', 'zh-rCN': '其他', 'zh-rTW': '其他', 'ko-KR': '기타' },
  flatDamage: { en: 'Flat Damage', 'zh-rCN': '点伤', 'zh-rTW': '點傷', 'ko-KR': '고정 피해' },
  increased: { en: 'Increased', 'zh-rCN': '提高', 'zh-rTW': '增加', 'ko-KR': '증가' },
  gain: { en: 'Gain', 'zh-rCN': '额外获得', 'zh-rTW': '額外獲得', 'ko-KR': '추가 획득' },
  moreLess: { en: 'More / Less', 'zh-rCN': '总增 / 总降', 'zh-rTW': '更多 / 更少', 'ko-KR': '증폭 / 감폭' },
  skillLevels: { en: 'Skill Level +', 'zh-rCN': '技能等级 +', 'zh-rTW': '技能等級 +', 'ko-KR': '스킬 레벨 +' },
  grantedSkills: { en: 'Granted Skills', 'zh-rCN': '装备技能', 'zh-rTW': '裝備技能', 'ko-KR': '부여된 스킬' },
  speed: { en: 'Speed', 'zh-rCN': '速度', 'zh-rTW': '速度', 'ko-KR': '속도' },
  critical: { en: 'Critical', 'zh-rCN': '暴击', 'zh-rTW': '暴擊', 'ko-KR': '치명타' },
  accuracyPenetration: { en: 'Accuracy / Penetration', 'zh-rCN': '命中 / 穿透', 'zh-rTW': '命中 / 穿透', 'ko-KR': '정확도 / 관통' },
  ailments: { en: 'Ailments / DoT', 'zh-rCN': '异常 / 持续伤害', 'zh-rTW': '異常 / 持續傷害', 'ko-KR': '상태 이상 / 지속 피해' },
  offenceOther: { en: 'Other Offence', 'zh-rCN': '其他进攻', 'zh-rTW': '其他進攻', 'ko-KR': '기타 공격' },
}

const RECIPIENT_LABELS: Record<Exclude<NonNullable<EquipmentAffixSummary['recipient']>, 'player'>, UiMessage> = {
  minion: { en: 'Minion', 'zh-rCN': '召唤物', 'zh-rTW': '召喚物', 'ko-KR': '소환수' },
  companion: { en: 'Companion', 'zh-rCN': '同伴', 'zh-rTW': '同伴', 'ko-KR': '동료' },
  ally: { en: 'Allies', 'zh-rCN': '友军', 'zh-rTW': '友軍', 'ko-KR': '동료' },
  'player-and-allies': { en: 'You + Allies', 'zh-rCN': '自身与友军', 'zh-rTW': '自身與友軍', 'ko-KR': '나와 동료' },
  enemy: { en: 'Enemy', 'zh-rCN': '敌人', 'zh-rTW': '敵人', 'ko-KR': '적' },
}

const IMPORTANT_AFFIX_PATTERN = /accuracy|chance to hit|penetrat|enemies?.*resistance|resistance.*enemies?|breaks? armour|armour break|ignore[sd]? armour|damage over time|bleed(?:ing)?|poison|ignite|命中|穿透|敌人.*抗性|抗性.*敌人|减抗|破甲|无视护甲|持续伤害|流血|中毒|点燃/i
const BONDED_AFFIX_PATTERN = /^\s*(?:bonded|羁绊)\s*[:：]/i
const FLASK_AFFIX_PATTERN = /flasks?|药剂|藥劑/i
const ENEMY_STUN_THRESHOLD_PATTERN = /enem(?:y|ies).*stun threshold|stun threshold.*enem(?:y|ies)|敌人.*晕眩(?:阈值|门槛)|敵人.*暈眩(?:閾值|門檻)/i

function getAffixGroup(summary: EquipmentAffixSummary): EquipmentAffixGroup {
  const { category, text } = summary
  if (summary.semanticGroup) return summary.semanticGroup
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

function getDefenceAffixGroup(summary: EquipmentAffixSummary): EquipmentAffixGroup {
  if (summary.category === 'resistances') return 'resistances'
  if (/\blife\b/i.test(summary.text)) return 'life'
  if (/\bmana\b/i.test(summary.text)) return 'mana'
  return 'defenceOther'
}

function defenceAffixRank(summary: EquipmentAffixSummary): number {
  const text = summary.text.toLowerCase()
  const maximumOffset = /maximum/.test(text) ? 10 : 0
  if (/all elemental resistances?/.test(text)) return maximumOffset
  if (/fire resistance/.test(text)) return 1 + maximumOffset
  if (/cold resistance/.test(text)) return 2 + maximumOffset
  if (/lightning resistance/.test(text)) return 3 + maximumOffset
  if (/chaos resistance/.test(text)) return 4 + maximumOffset
  return 20
}

function getSocketSlotInfo(slotName: string): { parent: string; index: number } | null {
  const match = slotName.match(/^(.+?)\s+(?:Jewel Socket|Abyssal Socket|珠宝(?:插槽|孔)|珠寶(?:插槽|孔))\s*(\d+)$/i)
  return match ? { parent: match[1].trim(), index: Number(match[2]) } : null
}

interface JewelStripEntry {
  key: string
  item: EquipmentItem
  sourceLabel: string
  sourceKind: 'tree' | 'equipment'
  slotName?: string
}

interface JewelStripTooltipState {
  entry: JewelStripEntry
  x: number
  y: number
  above: boolean
}

function makeFallbackJewelItem(jewel: PassiveJewel, raw: string): EquipmentItem {
  return {
    id: jewel.itemId,
    rarity: jewel.rarity,
    name: jewel.name || 'Unknown Jewel',
    baseType: jewel.baseType || jewel.name || 'Jewel',
    socketCount: 0,
    runes: [],
    lines: jewel.lines,
    modifiers: jewel.lines.map((line) => ({ text: line.replace(/\{[^}]+\}/g, '').trim(), tags: [], group: 'explicit' as const })),
    raw,
  }
}

function JewelStripIcon({ entry, index, size = 'small' }: { entry: JewelStripEntry; index: ItemIconIndex | null; size?: 'small' | 'large' }) {
  const imageUrl = resolveItemIcon(entry.item, index)
  return <span className={`equipment-jewel-icon equipment-jewel-icon-${size} ${RARITY_CLASS[entry.item.rarity] || 'rarity-normal'}`}>
    <FallbackImage src={imageUrl} alt="" fallback={<span>J</span>} />
  </span>
}

function JewelStripButton({
  entry,
  index,
  size = 'large',
  selected,
  onSelect,
  onHover,
  onLeave,
}: {
  entry: JewelStripEntry
  index: ItemIconIndex | null
  size?: 'small' | 'large'
  selected: boolean
  onSelect: (entry: JewelStripEntry) => void
  onHover: (event: MouseEvent<HTMLButtonElement>, entry: JewelStripEntry) => void
  onLeave: () => void
}) {
  const { lang } = useTranslation()
  const label = translateItemName(entry.item.name, entry.item.rarity, lang)
  return <button
    type="button"
    className={`equipment-jewel-entry ${selected ? 'selected' : ''}`}
    aria-label={label}
    title={label}
    onClick={() => onSelect(entry)}
    onMouseEnter={(event) => onHover(event, entry)}
    onMouseLeave={onLeave}
  >
    <JewelStripIcon entry={entry} index={index} size={size} />
  </button>
}

function JewelStripTooltip({ tooltip, index, language }: { tooltip: JewelStripTooltipState; index: ItemIconIndex | null; language: Language }) {
  const { entry } = tooltip
  const itemName = translateItemName(entry.item.name, entry.item.rarity, language)
  const baseType = entry.item.baseType && entry.item.baseType !== entry.item.name
    ? translateGameText(entry.item.baseType, language)
    : ''
  const lines = entry.item.lines
    .map((line) => translateGameText(line.replace(/\{[^}]+\}/g, ''), language))
    .filter(Boolean)
    .slice(0, 8)
  return createPortal(
    <div className={`equipment-jewel-tooltip ${tooltip.above ? 'above' : 'below'}`} style={{ left: tooltip.x, top: tooltip.y }} role="tooltip">
      <header>
        <span className="equipment-jewel-tooltip-icon"><JewelStripIcon entry={entry} index={index} size="large" /></span>
        <span>
          <strong>{itemName}</strong>
          {baseType && <small>{baseType}</small>}
          <small>{entry.sourceLabel}</small>
        </span>
      </header>
      {lines.length > 0
        ? <div className="equipment-jewel-tooltip-lines">{lines.map((line, lineIndex) => <p key={`${line}-${lineIndex}`}>{line}</p>)}</div>
        : <p className="equipment-jewel-tooltip-empty">{uiText(language, 'No detailed modifier data available', '暂无可用的详细词条', '暫無可用的詳細詞綴', '사용 가능한 상세 속성이 없습니다')}</p>}
    </div>,
    document.body,
  )
}

function JewelStripBar({
  entries,
  itemIconIndex,
  selectedId,
  onSelect,
  onHover,
  onLeave,
}: {
  entries: JewelStripEntry[]
  itemIconIndex: ItemIconIndex | null
  selectedId: string | null
  onSelect: (entry: JewelStripEntry) => void
  onHover: (event: MouseEvent<HTMLButtonElement>, entry: JewelStripEntry) => void
  onLeave: () => void
}) {
  const { lang } = useTranslation()
  const [expanded, setExpanded] = useState(false)
  const [popoverPosition, setPopoverPosition] = useState<{ left: number; top: number; width: number } | null>(null)
  const stripRef = useRef<HTMLDivElement>(null)

  const updatePopoverPosition = useCallback(() => {
    const strip = stripRef.current
    if (!strip) return
    const rect = strip.getBoundingClientRect()
    const width = Math.min(420, Math.max(220, window.innerWidth - 24))
    setPopoverPosition({
      left: Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)),
      top: rect.bottom + 7,
      width,
    })
  }, [])

  useEffect(() => {
    if (!expanded) return
    updatePopoverPosition()
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target
      if (target instanceof Element && target.closest('.equipment-jewel-strip, .equipment-jewel-popover')) return
      setExpanded(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setExpanded(false)
    }
    document.addEventListener('pointerdown', closeOnOutsidePointer)
    document.addEventListener('keydown', closeOnEscape)
    window.addEventListener('resize', updatePopoverPosition)
    window.addEventListener('scroll', updatePopoverPosition, true)
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer)
      document.removeEventListener('keydown', closeOnEscape)
      window.removeEventListener('resize', updatePopoverPosition)
      window.removeEventListener('scroll', updatePopoverPosition, true)
    }
  }, [expanded, updatePopoverPosition])

  useEffect(() => {
    if (!entries.length) setExpanded(false)
  }, [entries.length])

  const handleSelect = useCallback((entry: JewelStripEntry) => {
    setExpanded(false)
    onSelect(entry)
  }, [onSelect])

  const label = uiText(lang, 'Jewel Box', '珠宝匣', '珠寶匣', '주얼 보관함')
  const equippedLabel = uiText(lang, 'Equipped jewels', '已装备珠宝', '已裝備珠寶', '장착된 주얼')
  const closeLabel = uiText(lang, 'Close jewel box', '关闭珠宝匣', '關閉珠寶匣', '주얼 보관함 닫기')

  return <div ref={stripRef} className={`equipment-jewel-strip ${expanded ? 'expanded' : ''}`}>
    <button
      type="button"
      className="equipment-jewel-label"
      disabled={!entries.length}
      aria-expanded={expanded}
      aria-haspopup="dialog"
      aria-label={`${label} (${entries.length})`}
      title={entries.length ? equippedLabel : uiText(lang, 'No equipped jewels', '没有已装备珠宝', '沒有已裝備珠寶', '장착된 주얼 없음')}
      onClick={() => {
        if (!entries.length) return
        setExpanded((current) => !current)
      }}
    >
      <Gem className="equipment-jewel-label-icon" aria-hidden="true" />
      <strong>{label}</strong>
      <small>{entries.length}</small>
      <ChevronDown className="equipment-jewel-label-toggle" aria-hidden="true" />
    </button>
    {expanded && popoverPosition && createPortal(
      <div
        className="equipment-jewel-popover"
        role="dialog"
        aria-label={equippedLabel}
        style={{ left: popoverPosition.left, top: popoverPosition.top, width: popoverPosition.width }}
      >
        <header className="equipment-jewel-popover-heading">
          <span>
            <strong>{label}</strong>
            <small>{entries.length}</small>
          </span>
          <button type="button" onClick={() => setExpanded(false)} aria-label={closeLabel} title={closeLabel}>
            <X aria-hidden="true" />
          </button>
        </header>
        <div className="equipment-jewel-popover-list" aria-label={equippedLabel}>
          {entries.map((entry) => <JewelStripButton
            key={entry.key}
            entry={entry}
            index={itemIconIndex}
            size="small"
            selected={entry.item.id === selectedId}
            onSelect={handleSelect}
            onHover={onHover}
            onLeave={onLeave}
          />)}
        </div>
      </div>,
      document.body,
    )}
  </div>
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
  onSelectSource: (itemId: string, slotName?: string) => void
}) {
  const { t, lang } = useTranslation()
  const translatedText = translateGameText(summary.text, lang)
  const recipient = summary.recipient && summary.recipient !== 'player'
    ? RECIPIENT_LABELS[summary.recipient]
    : undefined

  return (
    <div className={`equipment-affix ${expanded ? 'expanded' : ''}`}>
      <button className="equipment-affix-row" type="button" onClick={onToggle} aria-expanded={expanded}>
        <ChevronRight />
        <span>{recipient && <em className="equipment-affix-recipient">{recipient[lang]}</em>}{translatedText}</span>
        <small>{summary.sources.length > 1 ? summary.sources.length : ''}</small>
      </button>
      {expanded && <div className="equipment-affix-sources">
        {summary.sources.map((source, index) => {
          const socketSlot = getSocketSlotInfo(source.slotName)
          const slotLabel = socketSlot
            ? `${t(SLOT_KEYS[socketSlot.parent] || socketSlot.parent)} · ${uiText(lang, 'Jewel', '珠宝', '珠寶', '주얼')} ${socketSlot.index}`
            : t(SLOT_KEYS[source.slotName] || source.slotName)
          return <button key={`${source.itemId}-${source.line}-${index}`} type="button" onClick={() => onSelectSource(source.itemId, source.slotName)}>
            <span>{slotLabel}</span>
            <strong>{translateGameText(source.itemName, lang)}</strong>
            {source.rune && <i>{uiText(lang, 'Rune', '符文', '符文', '룬')}</i>}
          </button>
        })}
      </div>}
    </div>
  )
}

function characterNumber(value: number | undefined, suffix = ''): string {
  return value == null ? '-' : `${Math.round(value)}${suffix}`
}

function CharacterSummary({ result, loading, error, onCalculate }: {
  result: CalcResult | null
  loading: boolean
  error: string | null
  onCalculate: () => void
}) {
  const { lang } = useTranslation()
  const l = (en: string, zhCN: string, zhTW: string, koKR: string) => uiText(lang, en, zhCN, zhTW, koKR)

  if (loading) return <div className="equipment-character-state">{l('Calculating character stats', '人物数据计算中', '正在計算角色數據', '캐릭터 능력치 계산 중')}</div>
  if (error) return <div className="equipment-character-state error"><span>{error}</span><button type="button" onClick={onCalculate}>{l('Retry', '重新计算', '重新計算', '다시 계산')}</button></div>
  if (!result) return <div className="equipment-character-state"><button type="button" onClick={onCalculate}>{l('Calculate character stats', '计算人物数据', '計算角色數據', '캐릭터 능력치 계산')}</button></div>

  const movement = (result.EffectiveMovementSpeedMod ?? result.MovementSpeedMod ?? 1) * 100
  const block = result.EffectiveBlockChance ?? result.BlockChance
  const rows = (entries: Array<[string, string]>) => entries.map(([label, value]) => (
    <div className="equipment-character-row" key={label}><span>{label}</span><strong>{value}</strong></div>
  ))

  return <div className="equipment-character-summary">
    <section>
      <h3>{l('Attributes', '属性', '屬性', '속성')}</h3>
      {rows([
        [l('Attributes', '属性', '屬性', '속성'), `${characterNumber(result.Str)}/${characterNumber(result.Dex)}/${characterNumber(result.Int)}`],
        [l('Movement Speed', '移动速度', '移動速度', '이동 속도'), characterNumber(movement, '%')],
      ])}
    </section>
    <section>
      <h3>{l('Defence', '防御', '防禦', '방어')}</h3>
      {rows([
        [l('Life', '生命值', '生命', '생명력'), characterNumber(result.Life)],
        [l('Energy Shield', '能量护盾', '能量護盾', '에너지 보호막'), characterNumber(result.EnergyShield)],
        [l('Spirit', '精魂', '精魂', '정신력'), characterNumber(result.Spirit)],
        [l('Mana', '魔力', '魔力', '마나'), characterNumber(result.Mana)],
        [l('Armour', '护甲', '護甲', '방어도'), characterNumber(result.Armour)],
        [l('Physical Damage Reduction', '物理伤害减免', '物理傷害減免', '물리 피해 감소'), characterNumber(result.PhysicalDamageReduction ?? result.ArmourPhysicalDamageReduction, '%')],
        [l('Evasion Rating', '闪避值', '閃避值', '회피'), characterNumber(result.Evasion)],
        [l('Evade Chance', '闪避率', '閃避率', '회피 확률'), characterNumber(result.EvadeChance, '%')],
        [l('Deflect Chance', '偏斜几率', '偏斜機率', '빗겨내기 확률'), characterNumber(result.DeflectChance, '%')],
        [l('Deflect Effect', '偏斜效果', '偏斜效果', '빗겨내기 효과'), characterNumber(result.DeflectEffect, '%')],
        [l('Block Chance', '格挡率', '格擋率', '막기 확률'), characterNumber(block, '%')],
        [l('Resistances', '抗性', '抗性', '저항'), `${characterNumber(result.FireResist, '%')}/${characterNumber(result.ColdResist, '%')}/${characterNumber(result.LightningResist, '%')}/${characterNumber(result.ChaosResist, '%')}`],
      ])}
    </section>
    <section>
      <h3>{l('Charges', '充能球', '充能球', '충전')}</h3>
      {rows([
        [l('Maximum Power Charges', '暴击球数量上限', '暴擊球數量上限', '최대 권능 충전'), characterNumber(result.PowerChargesMax)],
        [l('Maximum Frenzy Charges', '狂怒球数量上限', '狂怒球數量上限', '최대 격분 충전'), characterNumber(result.FrenzyChargesMax)],
        [l('Maximum Endurance Charges', '耐力球数量上限', '耐力球數量上限', '최대 인내 충전'), characterNumber(result.EnduranceChargesMax)],
      ])}
    </section>
  </div>
}

const EquipmentAffixSidebar = memo(function EquipmentAffixSidebar({
  activeSet,
  itemSets,
  weaponSet,
  affixesByGroup,
  affixCount,
  semanticView,
  semanticsLoading,
  calcResult,
  calcLoading,
  calcError,
  collapsedCategories,
  expandedAffixes,
  onSelectSet,
  onSelectSemanticView,
  onToggleCategory,
  onToggleAffix,
  onSelectSource,
  onCalculate,
}: {
  activeSet: EquipmentSet
  itemSets: EquipmentSet[]
  weaponSet: 1 | 2
  affixesByGroup: Map<EquipmentAffixGroup, EquipmentAffixSummary[]>
  affixCount: number
  semanticView: EquipmentSidebarView
  semanticsLoading: boolean
  calcResult: CalcResult | null
  calcLoading: boolean
  calcError: string | null
  collapsedCategories: Set<EquipmentAffixGroup>
  expandedAffixes: Set<string>
  onSelectSet: (setId: string) => void
  onSelectSemanticView: (view: EquipmentSidebarView) => void
  onToggleCategory: (group: EquipmentAffixGroup) => void
  onToggleAffix: (key: string) => void
  onSelectSource: (itemId: string, slotName?: string) => void
  onCalculate: () => void
}) {
  const { t, lang } = useTranslation()
  const l = (en: string, zhCN: string, zhTW: string, koKR: string) => uiText(lang, en, zhCN, zhTW, koKR)
  const groupOrder = semanticView === 'offence'
    ? OFFENCE_GROUP_ORDER
    : semanticView === 'defence' ? DEFENCE_GROUP_ORDER : []

  return (
    <aside className="equipment-loadouts">
      <div className="equipment-affix-heading">
        <span>{semanticView === 'character'
          ? l('Character', '人物面板', '角色面板', '캐릭터')
          : l('Equipped modifiers', '已装备词缀', '已裝備詞綴', '장착 속성')}</span>
        <strong>{l('Weapon set', '武器组', '武器組', '무기 세트')} {weaponSet === 1 ? 'I' : 'II'}</strong>
      </div>
      <div className="equipment-semantic-tabs" role="tablist" aria-label={l('Equipment modifier view', '装备词缀视图', '裝備詞綴檢視', '장비 속성 보기')}>
        {(['character', 'offence', 'defence'] as const).map((view) => {
          const label = view === 'character'
            ? l('Character', '人物', '角色', '캐릭터')
            : view === 'offence'
            ? l('Offence', '进攻', '進攻', '공격')
            : l('Defence', '防御', '防禦', '방어')
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
      {semanticView === 'character' ? <CharacterSummary result={calcResult} loading={calcLoading} error={calcError} onCalculate={onCalculate} /> : <>
      <label className="equipment-loadout-select">
        <span>{l('Loadout', '装备方案', '裝備配置', '장비 구성')}</span>
        <select value={activeSet.id} onChange={(event) => onSelectSet(event.target.value)}>
          {itemSets.map((set, index) => {
            const title = /^Set \d+$/i.test(set.title) ? t('equipment.defaultSet', { number: index + 1 }) : set.title
            return <option key={set.id} value={set.id}>{title}</option>
          })}
        </select>
      </label>
      <div className="equipment-affix-list">
        {groupOrder.map((group) => {
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
              <span>{label[lang]}</span>
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
        {!affixCount && <div className="equipment-affix-empty">{semanticsLoading
          ? l('Analysing equipment', '装备数据分析中', '正在分析裝備數據', '장비 분석 중')
          : l('No equipped modifiers to summarize', '当前装备没有可汇总的词缀', '目前裝備沒有可彙總的詞綴', '요약할 장착 속성이 없습니다')}</div>}
      </div>
      </>}
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
  onSelectSocketedItem?: (item: EquipmentItem, slotName?: string) => void
}) {
  const { lang } = useTranslation()
  const l = (en: string, zhCN: string, zhTW: string, koKR: string) => uiText(lang, en, zhCN, zhTW, koKR)
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

  const typeLabels: Record<string, UiMessage> = {
    Rune: { en: 'Rune', 'zh-rCN': '符文', 'zh-rTW': '符文', 'ko-KR': '룬' },
    SoulCore: { en: 'Soul Core', 'zh-rCN': '灵魂核心', 'zh-rTW': '靈魂核心', 'ko-KR': '영혼 핵' },
    Idol: { en: 'Idol', 'zh-rCN': '雕像', 'zh-rTW': '雕像', 'ko-KR': '우상' },
    CongealedMist: { en: 'Congealed Mist', 'zh-rCN': '凝结迷雾', 'zh-rTW': '凝結迷霧', 'ko-KR': '응결된 안개' },
    Jewel: { en: 'Jewel', 'zh-rCN': '珠宝', 'zh-rTW': '珠寶', 'ko-KR': '주얼' },
    Skill: { en: 'Skill', 'zh-rCN': '技能', 'zh-rTW': '技能', 'ko-KR': '스킬' },
  }
  const categoryLabels: Record<string, UiMessage> = {
    weapon: { en: 'Weapon', 'zh-rCN': '武器', 'zh-rTW': '武器', 'ko-KR': '무기' },
    wand: { en: 'Wand', 'zh-rCN': '法杖', 'zh-rTW': '法杖', 'ko-KR': '마법봉' },
    staff: { en: 'Staff', 'zh-rCN': '长杖', 'zh-rTW': '長杖', 'ko-KR': '지팡이' },
    sceptre: { en: 'Sceptre', 'zh-rCN': '权杖', 'zh-rTW': '權杖', 'ko-KR': '셉터' },
    shield: { en: 'Shield', 'zh-rCN': '盾牌', 'zh-rTW': '盾牌', 'ko-KR': '방패' },
    buckler: { en: 'Buckler', 'zh-rCN': '圆盾', 'zh-rTW': '圓盾', 'ko-KR': '버클러' },
    armour: { en: 'Armour', 'zh-rCN': '护甲', 'zh-rTW': '護甲', 'ko-KR': '방어구' },
    helmet: { en: 'Helmet', 'zh-rCN': '头盔', 'zh-rTW': '頭盔', 'ko-KR': '투구' },
    'body armour': { en: 'Body Armour', 'zh-rCN': '胸甲', 'zh-rTW': '胸甲', 'ko-KR': '갑옷' },
    gloves: { en: 'Gloves', 'zh-rCN': '手套', 'zh-rTW': '手套', 'ko-KR': '장갑' },
    boots: { en: 'Boots', 'zh-rCN': '鞋子', 'zh-rTW': '鞋子', 'ko-KR': '장화' },
    skill: { en: 'Granted by equipment', 'zh-rCN': '装备授予', 'zh-rTW': '裝備賦予', 'ko-KR': '장비 부여' },
  }
  const typeLabel = (value: string) => typeLabels[value]?.[lang] || translateGameText(value, lang)
  const categoryLabel = (value: string) => categoryLabels[value.toLowerCase()]?.[lang] || translateGameText(value, lang)
  const translateRuneStat = (value: string) => {
    if (!value.startsWith('Bonded:')) return translateGameText(value, lang)
    const translated = translateGameText(value.slice('Bonded:'.length).trim(), lang)
    return `${l('Bonded', '羁绊', '羈絆', '결속')}: ${translated}`
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
              onSelectSocketedItem(socketedItem, `${slotName} Jewel Socket ${socketIndex + 1}`)
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
            <span className="rune-socket" aria-label={label || l('Empty socket', '空插槽', '空插槽', '빈 홈')}>
              <FallbackImage src={imageUrl} alt={label} fallback={<span>{socketedItem ? 'J' : (rune ? 'R' : '')}</span>} />
            </span>
            {!compact && <span className="socket-copy"><strong>{label || l('Empty', '空', '空', '비어 있음')}</strong><small>{socketedItem ? `${typeLabel('Jewel')} · ${tooltipCategory}` : (resolved ? `${typeLabel(resolved.variant.type)} · ${categoryLabel(resolved.category)}` : (rune ? `${typeLabel('Rune')} / ${typeLabel('SoulCore')} / ${typeLabel('Idol')}` : l('Empty socket', '空插槽', '空插槽', '빈 홈')))}</small></span>}
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
            : <p className="rune-tooltip-empty">{l('No detailed modifier data available', '暂无可用的详细词条', '暫無可用的詳細詞綴', '사용 가능한 상세 속성이 없습니다')}</p>}
        </div>,
        document.body,
      )}
    </div>
  )
}

function ItemDetail({ item, base, semantics, itemIconIndex, runeDetails, slotName, socketedItems, buildContext, onSave, onPriceCheck, onFindBetter, onReplace, onClose }: { item: EquipmentItem; base?: ItemBaseData; semantics?: EquipmentItemSemantics; itemIconIndex: ItemIconIndex | null; runeDetails: RuneDetailIndex | null; slotName?: string; socketedItems?: EquipmentItem[]; buildContext: BuildContextSnapshot | null; onSave: () => Promise<void>; onPriceCheck: () => void; onFindBetter?: () => void; onReplace?: () => void; onClose: () => void }) {
  const { t, lang } = useTranslation()
  const l = (en: string, zhCN: string, zhTW: string, koKR: string) => uiText(lang, en, zhCN, zhTW, koKR)
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'error'>('idle')
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [tradeMenuOpen, setTradeMenuOpen] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const propertiesRef = useRef<HTMLDivElement>(null)
  const requirementsRef = useRef<HTMLDivElement>(null)
  const modifiersRef = useRef<HTMLDivElement>(null)
  const differenceRef = useRef<HTMLDivElement>(null)
  useTreeStore((state) => state.translationRevision)
  const translateItemText = (value: string) => translateGameText(value.replace(/\{[^}]+\}/g, ''), lang)
  const rarityClass = RARITY_CLASS[item.rarity] || RARITY_CLASS.NORMAL
  const rarityKey = rarityClass.replace('rarity-', '')
  const runicHeader = /^(?:Runeforged|Runemastered)\b/i.test(item.baseType)
  const displayStats = deriveItemDisplayStats(item, base)
  const weaponComparisonStats = deriveWeaponComparisonStats(item, base)
  const normalizeModifierText = (value: string) => value.replace(/\{[^}]+\}/g, '').replace(/\s+/g, ' ').trim().toLowerCase()
  const semanticLineByKey = new Map((semantics?.lines || []).map((line) => [normalizeModifierText(line.text), line]))
  const modifiers = (item.modifiers || item.lines.map((line) => ({ text: line.replace(/\{[^}]+\}/g, ''), tags: [], group: 'explicit' as const })))
    .map((modifier) => ({
      ...modifier,
      unsupported: semantics
        ? !(semanticLineByKey.get(normalizeModifierText(modifier.text))?.parsed ?? true)
        : false,
    }))
  const modifierGroups = MODIFIER_GROUP_ORDER
    .map((group) => ({ group, entries: modifiers.filter((modifier) => modifier.group === group) }))
    .filter(({ entries }) => entries.length)
  const requirements = base?.requirements || {}
  const displayRequirements = deriveItemDisplayRequirements(item, base)
  const attributeRequirements = ([
    ['str', l('Str', '力量', '力量', '힘')],
    ['dex', l('Dex', '敏捷', '敏捷', '민첩')],
    ['int', l('Int', '智慧', '智慧', '지능')],
  ] as const).filter(([field]) => requirements[field])
  const propertyType = itemClassLabel(item, base, lang)
  const quickNavigationSections: EquipmentDetailQuickNavSection[] = [
    { id: 'properties', targetRef: propertiesRef },
    ...((attributeRequirements.length > 0 || Boolean(item.levelReq) || Boolean(item.sockets)) ? [{ id: 'requirements' as const, targetRef: requirementsRef }] : []),
    { id: 'modifiers', targetRef: modifiersRef },
    ...((buildContext && item.raw) ? [{ id: 'difference' as const, targetRef: differenceRef, targetSelector: '.equipment-difference-summary' }] : []),
  ]
  const handleCopyToPob = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(item.raw)
      setCopyState('copied')
      window.setTimeout(() => setCopyState('idle'), 2000)
    } catch {
      setCopyState('error')
      window.setTimeout(() => setCopyState('idle'), 3000)
    }
  }, [item.raw])

  useEffect(() => {
    setCopyState('idle')
    setSaveState('idle')
    setTradeMenuOpen(false)
  }, [item.id])

  useEffect(() => {
    if (!tradeMenuOpen) return
    const closeMenu = (event: globalThis.MouseEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest('.equipment-trade-split')) setTradeMenuOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setTradeMenuOpen(false)
    }
    document.addEventListener('mousedown', closeMenu)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('mousedown', closeMenu)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [tradeMenuOpen])

  return (
    <aside className="equipment-inspector equipment-inspector-floating">
      <header className={`inspector-title item-header-${rarityKey} ${runicHeader ? 'runic-item-header' : ''} ${rarityClass}`}>
        <div className="item-header-copy">
          <h2>{translateItemName(item.name, item.rarity, lang)}</h2>
          {item.name !== item.baseType && <p>{translateItemText(item.baseType)}</p>}
        </div>
      </header>

      <div className="equipment-inspector-actions" role="toolbar" aria-label={l('Item actions', '装备功能', '裝備功能', '아이템 작업')}>
        <button
          type="button"
          className="equipment-copy-pob"
          disabled={saveState === 'saving' || saveState === 'saved'}
          onClick={() => {
            setSaveState('saving')
            void onSave().then(() => setSaveState('saved')).catch(() => setSaveState('error'))
          }}
          title={l('Save to library', '收藏到仓库', '收藏至倉庫', '보관함에 저장')}
        >
          {saveState === 'saved' ? <Check /> : <Bookmark />}
          <span>{saveState === 'saved' ? l('Saved', '已收藏', '已收藏', '저장됨') : saveState === 'error' ? l('Save failed', '收藏失败', '收藏失敗', '저장 실패') : l('Save to library', '收藏到仓库', '收藏至倉庫', '보관함에 저장')}</span>
        </button>
        {onFindBetter ? <div className="equipment-trade-split">
          <button
            type="button"
            className="equipment-copy-pob equipment-trade-primary"
            onClick={onFindBetter}
            title={l('Find a better replacement for this equipped item', '查找当前装备的更好替代品', '尋找目前裝備的更好替代品', '장착한 장비의 더 나은 대체품 찾기')}
          >
            <Sparkles />
            <span>{l('Find a better item', '找到更好的', '找更好的', '더 나은 장비 찾기')}</span>
          </button>
          <button
            type="button"
            className="equipment-trade-menu-toggle"
            aria-haspopup="menu"
            aria-expanded={tradeMenuOpen}
            onClick={() => setTradeMenuOpen((open) => !open)}
            title={l('More trade actions', '更多交易操作', '更多交易操作', '추가 거래 작업')}
            aria-label={l('More trade actions', '更多交易操作', '更多交易操作', '추가 거래 작업')}
          ><ChevronDown /></button>
          {tradeMenuOpen && <div className="equipment-trade-menu" role="menu">
            <button type="button" role="menuitem" onClick={() => { setTradeMenuOpen(false); onPriceCheck() }} title={l('Configure price check', '选择词条并查价', '選擇詞綴並查價', '속성을 선택하여 가격 확인')}><Search /><span>{l('Price check', '查价', '查價', '가격 확인')}</span></button>
          </div>}
        </div> : <button
          type="button"
          className="equipment-copy-pob"
          onClick={onPriceCheck}
          title={l('Configure price check', '选择词条并查价', '選擇詞綴並查價', '속성을 선택하여 가격 확인')}
        >
          <Search />
          <span>{l('Price check', '查价', '查價', '가격 확인')}</span>
        </button>}
        {onReplace && <button
          type="button"
          className="equipment-copy-pob"
          onClick={onReplace}
          title={l('Change this equipment from the equipment library', '从装备仓库更换当前装备', '從裝備倉庫更換目前裝備', '장비 보관함에서 현재 장비 변경')}
        >
          <ArrowLeftRight />
          <span>{l('Change equipment', '更换装备', '更換裝備', '장비 변경')}</span>
        </button>}
        <button
          type="button"
          className={`equipment-copy-pob${copyState === 'error' ? ' copy-error' : ''}`}
          onClick={() => void handleCopyToPob()}
          title={t(copyState === 'error' ? 'equipment.copyPobFailed' : 'equipment.copyPob')}
          aria-live="polite"
        >
          {copyState === 'copied' ? <Check /> : <Clipboard />}
          <span>{t(copyState === 'copied' ? 'equipment.copiedPob' : copyState === 'error' ? 'equipment.copyPobFailed' : 'equipment.copyPob')}</span>
        </button>
        <button
          type="button"
          className="equipment-inspector-close"
          onClick={onClose}
          title={t('equipment.closeDetails')}
          aria-label={t('equipment.closeDetails')}
        ><X /></button>
      </div>

      <div className="inspector-scroll" ref={scrollRef}>
        <EquipmentDetailQuickNav containerRef={scrollRef} sections={quickNavigationSections} language={lang} />
        <div ref={propertiesRef} className="equipment-detail-section equipment-detail-properties">
          <div className="item-property-type">
          {propertyType}{item.itemLevel ? `: ${t('equipment.itemLevel', { value: item.itemLevel })}` : ''}
          </div>
        {displayStats.length > 0 && <div className="item-display-stats">
          {displayStats.map((stat) => <div key={stat.key}>
            <span>{ITEM_STAT_LABELS[stat.key]?.[lang] || stat.key}:</span>
            <strong className={[stat.tone ? `stat-${stat.tone}` : '', stat.augmented ? 'stat-augmented' : ''].filter(Boolean).join(' ')}>
              {stat.segments
                ? stat.segments.map((segment, index) => <span className={`stat-${segment.tone}`} key={`${segment.tone}-${segment.value}`}>{index ? ', ' : ''}{segment.value}</span>)
                : stat.value}
            </strong>
          </div>)}
        </div>}
        </div>
        {(attributeRequirements.length > 0 || Boolean(item.levelReq) || Boolean(item.sockets)) && <div ref={requirementsRef} className="equipment-detail-section equipment-detail-requirements item-metadata">
          {item.levelReq && <span>{t('equipment.levelReq', { value: item.levelReq })}</span>}
          {attributeRequirements.map(([field, label]) => {
            const value = displayRequirements[field] || requirements[field]
            const augmented = value !== requirements[field]
            return <span key={field}>
              {label} <strong className={augmented ? 'requirement-augmented' : ''}>{value}</strong>
            </span>
          })}
          {item.sockets && <span>{t('equipment.sockets', { value: item.sockets })}</span>}
        </div>}

        <div ref={modifiersRef} className="equipment-detail-section equipment-detail-modifiers item-modifiers">
          {modifierGroups.map(({ group, entries }) => <section className={`modifier-group modifier-${group}`} key={group}>
            {entries.map((modifier, index) => {
              const styleTag = modifier.tags.find((tag) => ['crafted', 'fractured', 'mutated', 'rune', 'enchant'].includes(tag))
              return <p key={`${modifier.text}-${index}`} className={`${styleTag ? `mod-${styleTag} ` : ''}${modifier.unsupported ? 'item-modifier-unsupported' : ''}`}>
                {translateItemText(modifier.text)}{modifier.unsupported && <em>unsupported</em>}
              </p>
            })}
          </section>)}
        </div>

        {buildContext && item.raw && <div ref={differenceRef} className="equipment-detail-section equipment-detail-difference"><EquipmentDifferenceTooltip
          context={buildContext}
          item={item}
          language={lang}
          sourceSlotName={slotName}
          slotOnlyTooltips={Boolean(slotName)}
        /></div>}

        {weaponComparisonStats.length > 0 && <div className="weapon-comparison-stats">
          {weaponComparisonStats.map((stat) => <span key={stat.key}>
            <strong>{stat.key}</strong> {stat.value}
          </span>)}
        </div>}

        {!!Math.max(item.socketCount, socketedItems?.length || 0) && <>
          <div className="inspector-section-title"><span>{l('Socketed items', '孔位镶嵌物', '插槽鑲嵌物', '홈에 장착된 아이템')}</span><small>{Math.max(item.socketCount, item.runes.length + (socketedItems?.length || 0))}</small></div>
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
  onContextMenu,
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
  onContextMenu: (event: MouseEvent<HTMLButtonElement>) => void
  onSelectSocketedItem: (item: EquipmentItem, slotName?: string) => void
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
      onContextMenu={onContextMenu}
      disabled={!item && !layout.weaponSet}
      title={item ? undefined : `${slotLabel}${setLabel}`}
      aria-label={item ? `${slotLabel}${setLabel}: ${itemName}` : `${slotLabel}${setLabel}`}
      className={`paper-doll-slot slot-${slotName.toLowerCase().replace(/\s+/g, '-')} ${weaponClass} ${rarityClass} ${selected ? 'selected' : ''}`}
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

export function EquipmentPanel({ buildId, realm = 'global' }: { buildId?: string | null; realm?: 'cn' | 'global' }) {
  const { t, lang } = useTranslation()
  const l = (en: string, zhCN: string, zhTW: string, koKR: string) => uiText(lang, en, zhCN, zhTW, koKR)
  const pobBuildRevision = useTreeStore((state) => state.pobBuildRevision)
  // The active session can change without changing its internal revision
  // (for example when opening a saved build whose first revision is 0).
  // Subscribe to the imported code so derived XML/equipment snapshots are
  // rebuilt instead of retaining the empty snapshot from the initial render.
  const importedBuildCode = useTreeStore((state) => state.importedBuildCode)
  const getActivePobCode = useTreeStore((state) => state.getActivePobCode)
  const getActivePobXml = useTreeStore((state) => state.getActivePobXml)
  const calcResult = useTreeStore((state) => state.calcResult)
  const calcLoading = useTreeStore((state) => state.calcLoading)
  const calcError = useTreeStore((state) => state.calcError)
  const calculationProfiles = useTreeStore((state) => state.calculationProfiles)
  const activeCalculationProfileId = useTreeStore((state) => state.activeCalculationProfileId)
  const runCalculation = useTreeStore((state) => state.runCalculation)
  const weaponSet = useTreeStore((state) => state.activeWeaponSet)
  const treeData = useTreeStore((state) => state.treeData)
  const getActivePobTreeJewelItems = useTreeStore((state) => state.getActivePobTreeJewelItems)
  const getActivePobTreeJewelRaw = useTreeStore((state) => state.getActivePobTreeJewelRaw)
  const setWeaponSet = useTreeStore((state) => state.setActiveWeaponSet)
  const setActiveItemSet = useTreeStore((state) => state.setActiveItemSet)
  const replaceEquipmentSlotWithRaw = useTreeStore((state) => state.replaceEquipmentSlotWithRaw)
  const [itemIconIndex, setItemIconIndex] = useState<ItemIconIndex | null>(null)
  const [runeDetails, setRuneDetails] = useState<RuneDetailIndex | null>(null)
  const [itemBases, setItemBases] = useState<Record<string, ItemBaseData>>({})
  const [selectedId, setSelectedId] = useState<string | null>(null)
  // Keep the concrete slot the user clicked. An item can be referenced by
  // both weapon sets, so looking up a slot by itemId alone is ambiguous.
  const [selectedSlotNameHint, setSelectedSlotNameHint] = useState<string | null>(null)
  const [inspectorOpen, setInspectorOpen] = useState(false)
  const [paperDollBackgroundAvailable, setPaperDollBackgroundAvailable] = useState(true)
  const [collapsedCategories, setCollapsedCategories] = useState<Set<EquipmentAffixGroup>>(new Set())
  const [expandedAffixes, setExpandedAffixes] = useState<Set<string>>(new Set())
  const [semanticView, setSemanticView] = useState<EquipmentSidebarView>('character')
  const [semanticsById, setSemanticsById] = useState<Record<string, EquipmentItemSemantics>>({})
  const [semanticsLoading, setSemanticsLoading] = useState(false)
  const [replacementOpen, setReplacementOpen] = useState(false)
  const [contextMenu, setContextMenu] = useState<EquipmentContextMenuState | null>(null)
  const [jewelTooltip, setJewelTooltip] = useState<JewelStripTooltipState | null>(null)
  const { hostRef, size: paperDollSize } = usePaperDollSize()
  const lastCalculationSelection = useRef<string | null>(null)
  const activePobCode = useMemo(() => getActivePobCode() || '', [getActivePobCode, importedBuildCode, pobBuildRevision])
  const activePobXml = useMemo(() => getActivePobXml() || '', [getActivePobXml, importedBuildCode, buildId, pobBuildRevision])
  const activeCalculationOverrides = useMemo(() => {
    const profile = calculationProfiles.find((candidate) => candidate.id === activeCalculationProfileId)
    return profile?.values && Object.keys(profile.values).length ? { ...profile.values } : undefined
  }, [activeCalculationProfileId, calculationProfiles])

  useEffect(() => {
    let mounted = true
    loadItemIconIndex().then((index) => mounted && setItemIconIndex(index))
    loadRuneDetails().then((details) => mounted && setRuneDetails(details))
    loadItemBaseData().then((index) => mounted && setItemBases(index.bases)).catch(() => {})
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

  useEffect(() => {
    if (!contextMenu) return
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target
      if (target instanceof Element && target.closest('.equipment-context-menu')) return
      setContextMenu(null)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setContextMenu(null)
    }
    document.addEventListener('pointerdown', closeOnOutsidePointer)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [contextMenu])

  const equipment = useMemo(() => {
    if (!activePobCode) return null
    try {
      const session = getActiveBuildSession()
      return session ? parseEquipmentObject(session.object) : parseEquipmentCode(activePobCode)
    } catch { return null }
  }, [activePobCode, pobBuildRevision])
  // The parsed PoB XML is the source of truth for the active item set. A
  // local set selection can outlive a build switch and make the paper doll
  // render one set while the comparison engine evaluates another one.
  const activeSet = equipment?.itemSets.find((set) => set.id === equipment.activeItemSetId) || equipment?.itemSets[0]
  const equipmentDifferenceContext = useMemo<BuildContextSnapshot | null>(() => {
    if (!activePobXml || !activeSet) return null
    return {
      xml: activePobXml,
      buildRevision: pobBuildRevision,
      activeItemSetId: activeSet.id,
      activeWeaponSet: weaponSet,
    }
  }, [activePobXml, activeSet?.id, pobBuildRevision, weaponSet])

  const calculateCharacter = useCallback(() => runCalculation({
    itemSetId: activeSet?.id,
    weaponSet,
    characterOnly: true,
  }), [activeSet?.id, weaponSet, runCalculation])

  useEffect(() => {
    if (semanticView !== 'character' || !activePobCode || !activeSet || calcLoading) return
    const selection = `${activePobCode}:${pobBuildRevision}:${activeSet.id}:${weaponSet}`
    if (lastCalculationSelection.current === selection) return
    lastCalculationSelection.current = selection
    void calculateCharacter()
  }, [semanticView, activePobCode, pobBuildRevision, activeSet?.id, weaponSet, calcLoading, calculateCharacter])

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
  const affixSummaries = useMemo(() => semanticView === 'character'
    ? []
    : aggregateEquipmentSemantics(affixSlots, deferredAffixInput.itemsById, semanticsById, semanticView),
  [affixSlots, deferredAffixInput.itemsById, semanticView, semanticsById])
  const affixesByGroup = useMemo(() => {
    const groups = new Map<EquipmentAffixGroup, EquipmentAffixSummary[]>()
    const ordered = [...affixSummaries].sort((left, right) => {
      if (semanticView === 'defence' && left.category === 'resistances' && right.category === 'resistances') {
        return defenceAffixRank(left) - defenceAffixRank(right)
      }
      return AFFIX_CATEGORY_ORDER.indexOf(left.category) - AFFIX_CATEGORY_ORDER.indexOf(right.category)
    })
    for (const summary of ordered) {
      const group = semanticView === 'defence' ? getDefenceAffixGroup(summary) : getAffixGroup(summary)
      const entries = groups.get(group) || []
      entries.push(summary)
      groups.set(group, entries)
    }
    return groups
  }, [affixSummaries, semanticView])
  const isVisibleSelectionSlot = (slotName: string) => {
    if (activeSlotNames.has(slotName)) return true
    const socket = getSocketSlotInfo(slotName)
    return Boolean(socket && activeSlotNames.has(socket.parent))
  }
  const firstItem = equipped.map((slot) => equipment?.itemsById[slot.itemId]).find(Boolean)
  // Do not reuse a selected id from a previous build/set. Item ids are local
  // to a PoB document, so the same id can refer to a completely different
  // item after loading another build.
  const selected = selectedId && activeSet?.slots.some((slot) =>
    slot.itemId === selectedId && slot.active && isVisibleSelectionSlot(slot.name),
  )
    ? equipment?.itemsById[selectedId]
    : firstItem
  const selectedSlotName = selected
    ? activeSet?.slots.find((slot) => slot.itemId === selected.id && slot.name === selectedSlotNameHint && isVisibleSelectionSlot(slot.name))?.name
      || activeSet?.slots.find((slot) => slot.itemId === selected.id && isVisibleSelectionSlot(slot.name))?.name
    : undefined
  const libraryBuildId = buildId || 'unsaved-build'

  const saveItem = useCallback(async (item: EquipmentItem, slotName?: string) => {
    if (!window.pob2Market || !activeSet) throw new Error('Equipment library is unavailable')
    const iconUrl = resolveItemIcon(item, itemIconIndex)
    const libraryLocale = lang === 'en' ? undefined : LANGUAGE_LOCALES[lang]
    await window.pob2Market.saveEquipmentItem({
      raw: item.raw,
      iconUrl,
      ...(libraryLocale ? { localized: { [libraryLocale]: {
        name: translateItemName(item.name || item.baseType, item.rarity, lang),
        baseType: translateGameText(item.baseType || item.name, lang),
      } } } : {}),
      source: { kind: 'equipment-favorite', buildId: libraryBuildId, equipmentSetId: activeSet.id, itemId: item.id, slotName },
    })
  }, [activeSet, itemIconIndex, lang, libraryBuildId])

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
    setCollapsedCategories(new Set())
    setExpandedAffixes(new Set())
  }, [activeSet?.id])

  const handleSelectSet = useCallback((setId: string) => {
    setActiveItemSet(setId)
    setSelectedId(null)
    setSelectedSlotNameHint(null)
  }, [setActiveItemSet])
  const handleSelectItem = useCallback((itemId: string, slotName?: string) => {
    setSelectedId(itemId)
    setSelectedSlotNameHint(slotName || null)
    setInspectorOpen(true)
  }, [])

  const handleItemContextMenu = useCallback((event: MouseEvent<HTMLButtonElement>, itemId: string, slotName: string) => {
    event.preventDefault()
    event.stopPropagation()
    const menuWidth = 236
    const menuHeight = 190
    setContextMenu({
      itemId,
      slotName,
      left: Math.max(8, Math.min(event.clientX, window.innerWidth - menuWidth - 8)),
      top: Math.max(8, Math.min(event.clientY, window.innerHeight - menuHeight - 8)),
    })
  }, [])

  const replaceSelectedSlot = useCallback((entry: EquipmentLibraryEntry) => {
    if (!activeSet || !selectedSlotName || !entry.item.raw) return
    try {
      const replacementId = replaceEquipmentSlotWithRaw(activeSet.id, selectedSlotName, entry.item.raw)
      setSelectedId(replacementId)
      setReplacementOpen(false)
    } catch (reason) {
      console.error('Failed to replace equipment slot', reason)
    }
  }, [activeSet, replaceEquipmentSlotWithRaw, selectedSlotName])
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

  const activeTreeJewelItems = useMemo(() => getActivePobTreeJewelItems(), [getActivePobTreeJewelItems, pobBuildRevision])
  const jewelStripEntries = useMemo<JewelStripEntry[]>(() => {
    if (!equipment || !activeSet) return []

    const treeEntries = Object.entries(activeTreeJewelItems).map(([nodeId, jewel]) => {
      const raw = getActivePobTreeJewelRaw(nodeId)?.raw || ''
      const item = equipment.itemsById[jewel.itemId] || makeFallbackJewelItem(jewel, raw)
      const nodeName = treeData?.nodes[nodeId]?.name
      return {
        key: `tree:${nodeId}:${jewel.itemId}`,
        item,
        sourceKind: 'tree' as const,
        sourceLabel: `${l('Passive tree', '天赋树', '天賦樹', '패시브 트리')} · ${nodeName ? translateGameText(nodeName, lang) : nodeId}`,
      }
    })

    const visibleParentNames = new Set(getActivePaperDollSlots(weaponSet).map((slot) => slot.slotName.toLowerCase()))
    const equipmentEntries = activeSet.slots.flatMap((slot) => {
      if (!slot.active || !slot.itemId) return []
      const socket = getSocketSlotInfo(slot.name)
      if (!socket || !visibleParentNames.has(socket.parent.toLowerCase())) return []
      const item = equipment.itemsById[slot.itemId]
      if (!item) return []
      const parentSlot = activeSet.slots.find((candidate) => candidate.name.toLowerCase() === socket.parent.toLowerCase())
      const parentItem = parentSlot ? equipment.itemsById[parentSlot.itemId] : undefined
      const parentName = parentItem
        ? translateItemName(parentItem.name, parentItem.rarity, lang)
        : translateGameText(socket.parent, lang)
      return [{
        key: `equipment:${activeSet.id}:${slot.name}:${slot.itemId}`,
        item,
        sourceKind: 'equipment' as const,
        slotName: slot.name,
        sourceLabel: `${l('Equipment', '装备', '裝備', '장비')} · ${parentName} · ${uiText(lang, 'Socket', '插槽', '插槽', '홈')} ${socket.index}`,
      }]
    })

    return [...treeEntries, ...equipmentEntries]
  }, [activeSet, activeTreeJewelItems, equipment, getActivePobTreeJewelRaw, lang, l, pobBuildRevision, treeData, weaponSet])

  const handleJewelHover = useCallback((event: MouseEvent<HTMLButtonElement>, entry: JewelStripEntry) => {
    const rect = event.currentTarget.getBoundingClientRect()
    const above = rect.top > 250
    setJewelTooltip({
      entry,
      x: Math.max(190, Math.min(window.innerWidth - 190, rect.left + rect.width / 2)),
      y: above ? rect.top - 9 : rect.bottom + 9,
      above,
    })
  }, [])

  const handleJewelSelect = useCallback((entry: JewelStripEntry) => {
    setJewelTooltip(null)
    handleSelectItem(entry.item.id, entry.slotName)
  }, [handleSelectItem])

  const paperDollStyle = {
    width: `${paperDollSize.width}px`,
    height: `${paperDollSize.height}px`,
    '--paper-socket-size': `${Math.max(16, 72 * paperDollSize.scale)}px`,
    '--paper-socket-gap': `${Math.max(2, 10 * paperDollSize.scale)}px`,
    '--paper-doll-background-top': `${-PAPER_DOLL_VIEW_TOP / PAPER_DOLL_DISPLAY_HEIGHT * 100}%`,
    '--paper-doll-background-height': `${PAPER_DOLL_HEIGHT / PAPER_DOLL_DISPLAY_HEIGHT * 100}%`,
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
    <section className={`equipment-workspace${inspectorOpen ? ' inspector-open' : ''}`}>
      <EquipmentAffixSidebar
        activeSet={activeSet}
        itemSets={equipment.itemSets}
        weaponSet={deferredAffixInput.weaponSet}
        affixesByGroup={affixesByGroup}
        affixCount={affixSummaries.length}
        semanticView={semanticView}
        semanticsLoading={semanticsLoading}
        calcResult={calcResult}
        calcLoading={calcLoading}
        calcError={calcError}
        collapsedCategories={collapsedCategories}
        expandedAffixes={expandedAffixes}
        onSelectSet={handleSelectSet}
        onSelectSemanticView={setSemanticView}
        onToggleCategory={handleToggleCategory}
        onToggleAffix={handleToggleAffix}
        onSelectSource={handleSelectItem}
        onCalculate={() => { void calculateCharacter() }}
      />

      <div className="paper-doll-stage">
        <header className="paper-doll-heading">
          <div className="paper-doll-heading-main">
            <span>{t('equipment.title')}</span>
            <JewelStripBar
              entries={jewelStripEntries}
              itemIconIndex={itemIconIndex}
              selectedId={selectedId}
              onSelect={handleJewelSelect}
              onHover={handleJewelHover}
              onLeave={() => setJewelTooltip(null)}
            />
          </div>
          <div className="paper-doll-heading-actions">
            <small>{l('Select an item to inspect its properties', '选择装备查看完整属性', '選擇裝備以查看完整屬性', '아이템을 선택하여 전체 속성을 확인하세요')}</small>
            {!inspectorOpen && selected && <button
              type="button"
              className="equipment-inspector-toggle"
              onClick={() => setInspectorOpen(true)}
              title={l('Open item details', '打开装备详情', '開啟裝備詳情', '아이템 상세 정보 열기')}
              aria-label={l('Open item details', '打开装备详情', '開啟裝備詳情', '아이템 상세 정보 열기')}
            ><PanelRightOpen /></button>}
          </div>
        </header>
        <div ref={hostRef} className="paper-doll-frame-host">
          <div
            className={`paper-doll-frame ${paperDollBackgroundAvailable ? '' : 'background-missing'}`}
            style={paperDollStyle}
            data-source-width={PAPER_DOLL_WIDTH}
            data-source-height={PAPER_DOLL_HEIGHT}
            data-display-height={PAPER_DOLL_DISPLAY_HEIGHT}
          >
            {paperDollBackgroundAvailable && <img
              className="paper-doll-background"
              src="/assets/ui/workbench/equip-bg-D8S81SLb.png"
              alt=""
              onError={() => setPaperDollBackgroundAvailable(false)}
            />}
            {PAPER_DOLL_WEAPON_SET_CONTROLS.map((control) => {
              const roman = control.weaponSet === 1 ? 'I' : 'II'
              const label = `${l('Switch to weapon set', '切换到武器组', '切換至武器組', '무기 세트로 전환')} ${roman}`
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
                  if (item) handleSelectItem(item.id, slot.slotName)
                }}
                onContextMenu={(event) => {
                  event.preventDefault()
                  if (slot.weaponSet) setWeaponSet(slot.weaponSet)
                  if (item) handleItemContextMenu(event, item.id, slot.slotName)
                }}
                onSelectSocketedItem={(socketedItem, socketSlotName) => handleSelectItem(socketedItem.id, socketSlotName)}
              />
            })}
          </div>
        </div>
        {jewelTooltip && <JewelStripTooltip tooltip={jewelTooltip} index={itemIconIndex} language={lang} />}
      </div>

      {inspectorOpen && selected && <ItemDetail
        key={selected.id}
        item={selected}
        semantics={semanticsById[selected.id]}
        base={resolveItemBaseData(selected.baseType, itemBases)}
        itemIconIndex={itemIconIndex}
        runeDetails={runeDetails}
        slotName={selectedSlotName}
        socketedItems={selectedSlotName ? socketedItemsForSlot(selectedSlotName) : []}
        buildContext={equipmentDifferenceContext}
        onSave={() => saveItem(selected, selectedSlotName)}
        onPriceCheck={() => { void window.superpoePriceCheck?.open({ source: { kind: 'raw', raw: selected.raw } }) }}
        onFindBetter={selectedSlotName && activePobXml ? () => { void window.superpoeFindBetter?.open({
          source: { kind: 'raw', raw: selected.raw },
          mode: 'find-better',
          slotName: selectedSlotName,
          buildContext: {
            xml: activePobXml,
            slotName: selectedSlotName,
            buildRevision: pobBuildRevision,
            activeItemSetId: activeSet.id,
            activeWeaponSet: weaponSet,
            buildItemId: selected.id,
            configOverrides: activeCalculationOverrides,
          },
        }) } : undefined}
        onReplace={selectedSlotName ? () => setReplacementOpen(true) : undefined}
        onClose={() => setInspectorOpen(false)}
      />}
      {replacementOpen && <EquipmentLibraryPicker
        mode={selectedSlotName && getSocketSlotInfo(selectedSlotName) ? 'jewel' : 'equipment'}
        title={{ en: 'Change equipment', 'zh-rCN': '更换装备', 'zh-rTW': '更換裝備', 'ko-KR': '장비 변경' }}
        currentSlot={selectedSlotName}
        differenceContext={equipmentDifferenceContext}
        differenceSlotName={selectedSlotName}
        queryContext={{ kind: selectedSlotName && getSocketSlotInfo(selectedSlotName) ? 'jewel-slot' : 'equipment-slot', slotName: selectedSlotName }}
        onClose={() => setReplacementOpen(false)}
        onSelect={replaceSelectedSlot}
      />}
      {contextMenu && (() => {
        const contextItem = equipment?.itemsById[contextMenu.itemId]
        if (!contextItem) return null
        const contextSlotName = contextMenu.slotName
        const closeContextMenu = () => setContextMenu(null)
        const saveFromContextMenu = () => {
          closeContextMenu()
          void saveItem(contextItem, contextSlotName).catch((reason) => console.error('Failed to save equipment item', reason))
        }
        const priceCheckFromContextMenu = () => {
          closeContextMenu()
          void window.superpoePriceCheck?.open({ source: { kind: 'raw', raw: contextItem.raw } })
        }
        const replaceFromContextMenu = () => {
          setSelectedId(contextItem.id)
          setSelectedSlotNameHint(contextSlotName)
          setReplacementOpen(true)
          closeContextMenu()
        }
        const copyFromContextMenu = () => {
          closeContextMenu()
          void navigator.clipboard.writeText(contextItem.raw).catch((reason) => console.error('Failed to copy PoB item', reason))
        }
        return createPortal(
          <div
            className="equipment-context-menu"
            style={{ left: contextMenu.left, top: contextMenu.top }}
            role="menu"
            aria-label={l('Equipment actions', '装备操作', '裝備操作', '장비 작업')}
          >
            <button type="button" role="menuitem" onClick={saveFromContextMenu}><Bookmark /><span>{l('Save to library', '收藏到仓库', '收藏至倉庫', '보관함에 저장')}</span></button>
            <button type="button" role="menuitem" onClick={priceCheckFromContextMenu}><Search /><span>{l('Price check', '查价', '查價', '가격 확인')}</span></button>
            <button type="button" role="menuitem" onClick={replaceFromContextMenu}><ArrowLeftRight /><span>{l('Change equipment', '更换装备', '更換裝備', '장비 변경')}</span></button>
            <button type="button" role="menuitem" onClick={copyFromContextMenu}><Clipboard /><span>{l('Copy PoB item', '复制 PoB 词条', '複製 PoB 詞綴', 'PoB 아이템 복사')}</span></button>
          </div>,
          document.body,
        )
      })()}
    </section>
  )
}

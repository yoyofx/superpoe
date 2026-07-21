import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronRight, PackageOpen, ShieldCheck, Swords, Upload } from 'lucide-react'
import { decodeCodeToXml } from '@/engine/buildCode'
import { parseEquipmentXml } from '@/engine/equipment'
import { loadItemIconIndex, resolveItemIcon, resolveItemIconName, type ItemIconIndex } from '@/engine/itemIcons'
import {
  loadRuneDetails,
  resolveRuneDetail,
  resolveRuneVariant,
  type RuneDetailIndex,
} from '@/engine/runeDetails'
import { translateGameText } from '@/i18n/translationLoader'
import { useTranslation } from '@/i18n/useTranslation'
import { useTreeStore } from '@/store/treeStore'
import type { EquipmentItem } from '@/types/equipment'
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
}

function SocketedRunes({
  item,
  index,
  details,
  slotName,
  socketedItems = [],
  compact = false,
}: {
  item: EquipmentItem
  index: ItemIconIndex | null
  details: RuneDetailIndex | null
  slotName?: string
  socketedItems?: EquipmentItem[]
  compact?: boolean
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
  const socketContents = [
    ...item.runes.map((rune) => ({ rune, item: undefined as EquipmentItem | undefined })),
    ...socketedItems.map((socketedItem) => ({ rune: '', item: socketedItem })),
  ]
  const socketCount = Math.max(item.socketCount, socketContents.length)
  if (!socketCount) return null

  const typeLabel = (value: string) => {
    if (lang !== 'zh-rCN') return value
    return ({ Rune: '符文', SoulCore: '灵魂核心', Idol: '雕像', CongealedMist: '凝结迷雾', Jewel: '珠宝' } as Record<string, string>)[value] || value
  }
  const categoryLabel = (value: string) => {
    if (lang !== 'zh-rCN') return value
    return ({ weapon: '武器', wand: '法杖', staff: '长杖', sceptre: '权杖', shield: '盾牌', buckler: '圆盾', armour: '护甲', helmet: '头盔', 'body armour': '胸甲', gloves: '手套', boots: '鞋子' } as Record<string, string>)[value] || value
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
          : (resolved?.variant.stats || []).map(translateRuneStat)
        return (
          <span
            key={`${rune}-${socketIndex}`}
            className={centerLastSocket ? 'socket-entry center-last' : 'socket-entry'}
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
              {imageUrl ? <img src={imageUrl} alt={label} /> : <span>{socketedItem ? 'J' : (rune ? 'R' : '')}</span>}
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
            <span className="rune-tooltip-icon">{tooltip.imageUrl && <img src={tooltip.imageUrl} alt="" />}</span>
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

function ItemDetail({ item, imageUrl, itemIconIndex, runeDetails, slotName, socketedItems }: { item: EquipmentItem; imageUrl?: string; itemIconIndex: ItemIconIndex | null; runeDetails: RuneDetailIndex | null; slotName?: string; socketedItems?: EquipmentItem[] }) {
  const { t, lang } = useTranslation()
  useTreeStore((state) => state.translationRevision)
  const translateItemText = (value: string) => translateGameText(value.replace(/\{[^}]+\}/g, ''), lang)
  const rarityClass = RARITY_CLASS[item.rarity] || RARITY_CLASS.NORMAL

  return (
    <aside className="equipment-inspector">
      <header className={`inspector-title ${rarityClass}`}>
        <span>{lang === 'zh-rCN' ? '已选择装备' : 'Selected item'}</span>
        <h2>{translateItemText(item.name)}</h2>
        <p>{translateItemText(item.baseType)}</p>
      </header>

      <div className="inspector-scroll">
        <div className="item-art-frame">{imageUrl && <img src={imageUrl} alt="" />}</div>
        <div className="item-metadata">
          {item.itemLevel && <span>{t('equipment.itemLevel', { value: item.itemLevel })}</span>}
          {item.levelReq && <span>{t('equipment.levelReq', { value: item.levelReq })}</span>}
          {item.quality && <span>{t('equipment.quality', { value: item.quality })}</span>}
          {item.sockets && <span>{t('equipment.sockets', { value: item.sockets })}</span>}
        </div>

        <div className="ornament-rule" />
        <div className="item-modifiers">
          {item.lines.map((line, index) => (
            <p key={`${line}-${index}`} className={line.includes('{') ? 'mod-special' : ''}>{translateItemText(line)}</p>
          ))}
        </div>

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
      {imageUrl
        ? <img className="slot-item-image" src={imageUrl} alt={itemName} />
        : item && <span className="missing-item-glyph">{itemName.slice(0, 1)}</span>}
      {item && <SocketedRunes item={item} index={itemIconIndex} details={runeDetails} slotName={slotName} socketedItems={socketedItems} compact />}
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
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selectedSetId, setSelectedSetId] = useState<string | null>(null)
  const [weaponSet, setWeaponSet] = useState<1 | 2>(1)
  const { hostRef, size: paperDollSize } = usePaperDollSize()

  useEffect(() => {
    let mounted = true
    loadItemIconIndex().then((index) => mounted && setItemIconIndex(index))
    loadRuneDetails().then((details) => mounted && setRuneDetails(details))
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
  const firstItem = equipped.map((slot) => equipment?.itemsById[slot.itemId]).find(Boolean)
  const selected = (selectedId && equipment?.itemsById[selectedId]) || firstItem
  const selectedSlotName = selected ? activeSet?.slots.find((slot) => slot.itemId === selected.id)?.name : undefined
  const selectedImageUrl = selected ? resolveItemIcon(selected, itemIconIndex) : undefined

  useEffect(() => {
    if (activeSet) setWeaponSet(activeSet.useSecondWeaponSet ? 2 : 1)
  }, [activeSet?.id, activeSet?.useSecondWeaponSet])

  const itemForSlot = (slotName: string) => {
    const slot = activeSet?.slots.find((entry) => entry.name === slotName)
    return slot ? equipment?.itemsById[slot.itemId] : undefined
  }

  const socketedItemsForSlot = (slotName: string) => activeSet?.slots
    .map((slot) => {
      const match = slot.name.match(/^(.+?)\s+(?:Jewel Socket|珠宝(?:插槽|孔)|珠寶(?:插槽|孔))\s*(\d+)$/i)
      return match && match[1].trim().toLowerCase() === slotName.toLowerCase()
        ? { order: Number(match[2]), item: equipment?.itemsById[slot.itemId] }
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
      <aside className="equipment-loadouts">
        <div className="side-heading"><span>{lang === 'zh-rCN' ? '装备配置' : 'Equipment loadout'}</span><strong>{equipped.length} / 15</strong></div>
        <div className="loadout-list">
          {equipment.itemSets.map((set, index) => {
            const active = set.id === activeSet.id
            const title = /^Set \d+$/i.test(set.title) ? t('equipment.defaultSet', { number: index + 1 }) : set.title
            const setWeapon = set.useSecondWeaponSet ? 2 : 1
            const visibleNames = new Set(getActivePaperDollSlots(setWeapon).map((slot) => slot.slotName))
            return <button key={set.id} className={active ? 'active' : ''} onClick={() => { setSelectedSetId(set.id); setSelectedId(null) }}>
              <span className="loadout-index">{index + 1}</span><span><strong>{title}</strong><small>{set.slots.filter((slot) => slot.itemId && visibleNames.has(slot.name)).length} {lang === 'zh-rCN' ? '件装备' : 'items'}</small></span>{active && <Check />}
            </button>
          })}
        </div>

        <div className="side-heading weapon-heading"><span>{t('equipment.weaponSet')}</span></div>
        <div className="weapon-set-switch">
          <button className={weaponSet === 1 ? 'active' : ''} onClick={() => setWeaponSet(1)}><Swords /><span><strong>I</strong><small>{lang === 'zh-rCN' ? '主武器组' : 'Primary'}</small></span></button>
          <button className={weaponSet === 2 ? 'active' : ''} onClick={() => setWeaponSet(2)}><Swords /><span><strong>II</strong><small>{lang === 'zh-rCN' ? '副武器组' : 'Secondary'}</small></span></button>
        </div>

        <div className="equipment-summary">
          <div><ShieldCheck /><span>{lang === 'zh-rCN' ? '装备完整度' : 'Equipment status'}</span><strong>{Math.round(equipped.length / 15 * 100)}%</strong></div>
          <div><Swords /><span>{lang === 'zh-rCN' ? '当前武器组' : 'Weapon set'}</span><strong>{weaponSet === 1 ? 'I' : 'II'}</strong></div>
        </div>
      </aside>

      <div className="paper-doll-stage">
        <header className="paper-doll-heading"><span>{t('equipment.title')}</span><small>{lang === 'zh-rCN' ? '选择装备查看完整属性' : 'Select an item to inspect its properties'}</small></header>
        <div ref={hostRef} className="paper-doll-frame-host">
          <div
            className="paper-doll-frame"
            style={paperDollStyle}
            data-source-width={PAPER_DOLL_WIDTH}
            data-source-height={PAPER_DOLL_HEIGHT}
          >
            <img className="paper-doll-background" src="/assets/ui/workbench/equip-bg-D8S81SLb.png" alt="" />
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
                selected={item?.id === selected?.id}
                activeWeaponSet={weaponSet}
                onSelect={() => {
                  if (slot.weaponSet) setWeaponSet(slot.weaponSet)
                  if (item) setSelectedId(item.id)
                }}
              />
            })}
          </div>
        </div>
      </div>

      {selected
        ? <ItemDetail item={selected} imageUrl={selectedImageUrl} itemIconIndex={itemIconIndex} runeDetails={runeDetails} slotName={selectedSlotName} socketedItems={selectedSlotName ? socketedItemsForSlot(selectedSlotName) : []} />
        : <aside className="equipment-inspector empty-inspector"><ChevronRight /><span>{lang === 'zh-rCN' ? '选择一件装备' : 'Select an item'}</span></aside>}
    </section>
  )
}

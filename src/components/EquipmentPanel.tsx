import { useEffect, useMemo, useState } from 'react'
import { Check, ChevronRight, PackageOpen, ShieldCheck, Swords, Upload } from 'lucide-react'
import { decodeCodeToXml } from '@/engine/buildCode'
import { parseEquipmentXml } from '@/engine/equipment'
import { loadItemIconIndex, resolveItemIcon, resolveItemIconName, type ItemIconIndex } from '@/engine/itemIcons'
import { translateGameText } from '@/i18n/translationLoader'
import { useTranslation } from '@/i18n/useTranslation'
import { useTreeStore } from '@/store/treeStore'
import type { EquipmentItem } from '@/types/equipment'

const SLOT_KEYS: Record<string, string> = {
  'Weapon 1': 'equipment.slot.weapon1',
  'Weapon 2': 'equipment.slot.weapon2',
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

const PAPER_DOLL_SLOTS = [
  { name: 'Weapon 1', className: 'slot-weapon-one' },
  { name: 'Weapon 2', className: 'slot-weapon-two' },
  { name: 'Helmet', className: 'slot-helmet' },
  { name: 'Body Armour', className: 'slot-body-armour' },
  { name: 'Gloves', className: 'slot-gloves' },
  { name: 'Boots', className: 'slot-boots' },
  { name: 'Amulet', className: 'slot-amulet' },
  { name: 'Ring 1', className: 'slot-ring-one' },
  { name: 'Ring 2', className: 'slot-ring-two' },
  { name: 'Belt', className: 'slot-belt' },
  { name: 'Flask 1', className: 'slot-flask-one' },
  { name: 'Charm 1', className: 'slot-charm-one' },
  { name: 'Charm 2', className: 'slot-charm-two' },
  { name: 'Charm 3', className: 'slot-charm-three' },
  { name: 'Flask 2', className: 'slot-flask-two' },
] as const
const PAPER_DOLL_SLOT_NAMES = new Set<string>(PAPER_DOLL_SLOTS.map((slot) => slot.name))

const RARITY_CLASS: Record<string, string> = {
  NORMAL: 'rarity-normal',
  MAGIC: 'rarity-magic',
  RARE: 'rarity-rare',
  UNIQUE: 'rarity-unique',
}

function SocketedRunes({ item, index, compact = false }: { item: EquipmentItem; index: ItemIconIndex | null; compact?: boolean }) {
  const { lang } = useTranslation()
  useTreeStore((state) => state.translationRevision)
  if (!item.socketCount) return null

  return (
    <div className={compact ? 'socket-overlay' : 'socket-detail-list'}>
      {Array.from({ length: item.socketCount }, (_, socketIndex) => {
        const rune = item.runes[socketIndex] || ''
        const imageUrl = rune ? resolveItemIconName(rune, index) : undefined
        const label = rune ? translateGameText(rune, lang) : ''
        const centerLastSocket = compact && item.socketCount % 2 === 1 && socketIndex === item.socketCount - 1
        return (
          <span key={`${rune}-${socketIndex}`} className={centerLastSocket ? 'socket-entry center-last' : 'socket-entry'}>
            <span className="rune-socket" title={label || 'Empty socket'}>
              {imageUrl ? <img src={imageUrl} alt={label} /> : <span>{rune ? 'R' : ''}</span>}
            </span>
            {!compact && <span className="socket-copy"><strong>{label || 'Empty'}</strong><small>{rune ? 'Rune / Soul Core / Idol' : 'Empty socket'}</small></span>}
          </span>
        )
      })}
    </div>
  )
}

function ItemDetail({ item, imageUrl, itemIconIndex }: { item: EquipmentItem; imageUrl?: string; itemIconIndex: ItemIconIndex | null }) {
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

        {!!item.socketCount && <>
          <div className="inspector-section-title"><span>{lang === 'zh-rCN' ? '孔位镶嵌物' : 'Socketed items'}</span><small>{item.socketCount}</small></div>
          <SocketedRunes item={item} index={itemIconIndex} />
        </>}
      </div>
    </aside>
  )
}

function PaperDollSlot({
  slotName,
  item,
  imageUrl,
  itemIconIndex,
  className,
  selected,
  onSelect,
}: {
  slotName: string
  item?: EquipmentItem
  imageUrl?: string
  itemIconIndex: ItemIconIndex | null
  className: string
  selected: boolean
  onSelect: () => void
}) {
  const { t, lang } = useTranslation()
  useTreeStore((state) => state.translationRevision)
  const slotLabel = t(SLOT_KEYS[slotName] || slotName)
  const itemName = item ? translateGameText(item.name, lang) : ''
  const rarityClass = item ? RARITY_CLASS[item.rarity] || RARITY_CLASS.NORMAL : 'slot-empty'

  return (
    <button
      onClick={onSelect}
      disabled={!item}
      title={item ? `${slotLabel}: ${itemName}` : slotLabel}
      className={`paper-doll-slot ${className} ${rarityClass} ${selected ? 'selected' : ''}`}
    >
      {imageUrl ? <img className="slot-item-image" src={imageUrl} alt={itemName} /> : <span className="empty-slot-label">{itemName || slotLabel}</span>}
      {item && <SocketedRunes item={item} index={itemIconIndex} compact />}
      <span className="slot-label">{slotLabel}</span>
    </button>
  )
}

export function EquipmentPanel() {
  const { t, lang } = useTranslation()
  const importedBuildCode = useTreeStore((state) => state.importedBuildCode)
  const [itemIconIndex, setItemIconIndex] = useState<ItemIconIndex | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selectedSetId, setSelectedSetId] = useState<string | null>(null)
  const [weaponSet, setWeaponSet] = useState<1 | 2>(1)

  useEffect(() => {
    let mounted = true
    loadItemIconIndex().then((index) => mounted && setItemIconIndex(index))
    return () => { mounted = false }
  }, [])

  const equipment = useMemo(() => {
    if (!importedBuildCode) return null
    try { return parseEquipmentXml(decodeCodeToXml(importedBuildCode)) } catch { return null }
  }, [importedBuildCode])
  const activeSetId = selectedSetId || equipment?.activeItemSetId
  const activeSet = equipment?.itemSets.find((set) => set.id === activeSetId) || equipment?.itemSets[0]
  const equipped = activeSet?.slots.filter((slot) => PAPER_DOLL_SLOT_NAMES.has(slot.name) && slot.itemId) || []
  const firstItem = equipped.map((slot) => equipment?.itemsById[slot.itemId]).find(Boolean)
  const selected = (selectedId && equipment?.itemsById[selectedId]) || firstItem
  const selectedImageUrl = selected ? resolveItemIcon(selected, itemIconIndex) : undefined

  useEffect(() => {
    if (activeSet) setWeaponSet(activeSet.useSecondWeaponSet ? 2 : 1)
  }, [activeSet?.id, activeSet?.useSecondWeaponSet])

  const itemForSlot = (slotName: string) => {
    const resolvedName = weaponSet === 2 && slotName.startsWith('Weapon ') ? `${slotName} Swap` : slotName
    const slot = activeSet?.slots.find((entry) => entry.name === resolvedName)
    return slot ? equipment?.itemsById[slot.itemId] : undefined
  }

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
            return <button key={set.id} className={active ? 'active' : ''} onClick={() => { setSelectedSetId(set.id); setSelectedId(null) }}>
              <span className="loadout-index">{index + 1}</span><span><strong>{title}</strong><small>{set.slots.filter((slot) => slot.itemId && PAPER_DOLL_SLOT_NAMES.has(slot.name)).length} {lang === 'zh-rCN' ? '件装备' : 'items'}</small></span>{active && <Check />}
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
        <div className="paper-doll-frame">
          {PAPER_DOLL_SLOTS.map((slot) => {
            const item = itemForSlot(slot.name)
            const imageUrl = item ? resolveItemIcon(item, itemIconIndex) : undefined
            return <PaperDollSlot
              key={slot.name}
              slotName={slot.name}
              item={item}
              imageUrl={imageUrl}
              itemIconIndex={itemIconIndex}
              className={slot.className}
              selected={item?.id === selected?.id}
              onSelect={() => item && setSelectedId(item.id)}
            />
          })}
        </div>
      </div>

      {selected
        ? <ItemDetail item={selected} imageUrl={selectedImageUrl} itemIconIndex={itemIconIndex} />
        : <aside className="equipment-inspector empty-inspector"><ChevronRight /><span>{lang === 'zh-rCN' ? '选择一件装备' : 'Select an item'}</span></aside>}
    </section>
  )
}

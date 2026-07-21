import { useEffect, useMemo, useState } from 'react'
import { decodeCodeToXml } from '@/engine/buildCode'
import { parseEquipmentXml } from '@/engine/equipment'
import { useTreeStore } from '@/store/treeStore'
import type { EquipmentItem } from '@/types/equipment'
import { useTranslation } from '@/i18n/useTranslation'
import { translateGameText } from '@/i18n/translationLoader'
import { loadItemIconIndex, resolveItemIcon, resolveItemIconName, type ItemIconIndex } from '@/engine/itemIcons'

const SLOT_KEYS: Record<string, string> = {
  'Weapon 1': 'equipment.slot.weapon1', 'Weapon 2': 'equipment.slot.weapon2',
  Helmet: 'equipment.slot.helmet', Gloves: 'equipment.slot.gloves',
  'Body Armour': 'equipment.slot.bodyArmour', Boots: 'equipment.slot.boots',
  'Ring 1': 'equipment.slot.ring1', 'Ring 2': 'equipment.slot.ring2',
  Amulet: 'equipment.slot.amulet', Belt: 'equipment.slot.belt',
  'Charm 1': 'equipment.slot.charm1', 'Charm 2': 'equipment.slot.charm2',
  'Charm 3': 'equipment.slot.charm3', 'Flask 1': 'equipment.slot.flask1',
  'Flask 2': 'equipment.slot.flask2',
}

const PAPER_DOLL_SLOTS = [
  { name: 'Weapon 1', className: 'col-start-1 row-start-1 row-span-4' },
  { name: 'Helmet', className: 'col-start-3 row-start-1 row-span-2' },
  { name: 'Weapon 2', className: 'col-start-5 row-start-1 row-span-4' },
  { name: 'Ring 1', className: 'col-start-2 row-start-3' },
  { name: 'Body Armour', className: 'col-start-3 row-start-3 row-span-3' },
  { name: 'Amulet', className: 'col-start-4 row-start-3' },
  { name: 'Gloves', className: 'col-start-2 row-start-4 row-span-2' },
  { name: 'Ring 2', className: 'col-start-4 row-start-4' },
  { name: 'Boots', className: 'col-start-4 row-start-5 row-span-2' },
  { name: 'Belt', className: 'col-start-3 row-start-6' },
  { name: 'Flask 1', className: 'col-start-1 row-start-6 row-span-2' },
  { name: 'Charm 1', className: 'col-start-2 row-start-7' },
  { name: 'Charm 2', className: 'col-start-3 row-start-7' },
  { name: 'Charm 3', className: 'col-start-4 row-start-7' },
  { name: 'Flask 2', className: 'col-start-5 row-start-6 row-span-2' },
] as const

const RARITY_STYLE: Record<string, string> = {
  NORMAL: 'border-gray-500 text-gray-200',
  MAGIC: 'border-blue-500/80 text-blue-300',
  RARE: 'border-yellow-500/80 text-yellow-300',
  UNIQUE: 'border-orange-600/90 text-orange-400',
}

function SocketedRunes({ item, index, compact = false }: { item: EquipmentItem; index: ItemIconIndex | null; compact?: boolean }) {
  const { lang } = useTranslation()
  useTreeStore((state) => state.translationRevision)
  if (!item.socketCount) return null
  return (
    <div className={compact ? 'absolute left-1/2 top-1/2 grid max-h-[calc(100%-18px)] -translate-x-1/2 -translate-y-1/2 grid-cols-2 gap-1' : 'flex flex-wrap justify-center gap-1.5 py-3'}>
      {Array.from({ length: item.socketCount }, (_, socketIndex) => {
        const rune = item.runes[socketIndex] || ''
        const imageUrl = rune ? resolveItemIconName(rune, index) : undefined
        const label = rune ? translateGameText(rune, lang) : ''
        const centerLastSocket = compact && item.socketCount % 2 === 1 && socketIndex === item.socketCount - 1
        return (
          <span
            key={`${rune}-${socketIndex}`}
            className={compact
              ? centerLastSocket ? 'col-span-2 justify-self-center' : ''
              : 'flex items-center gap-1.5 text-xs text-[#c8c0ae]'}
          >
            <span title={label || 'Empty socket'} className={`${compact ? 'h-[22px] w-[22px]' : 'h-9 w-9'} flex shrink-0 items-center justify-center overflow-hidden rounded-full border border-[#a18b55] bg-[#16130d] shadow-[0_0_0_1px_rgba(0,0,0,.75)]`}>
              {imageUrl ? <img src={imageUrl} alt={label} className="h-full w-full object-contain" /> : <span className={compact ? 'text-[9px] text-[#d2b879]' : 'text-[11px] text-[#d2b879]'}>{rune ? 'R' : ''}</span>}
            </span>
            {!compact && <span>{label || 'Empty'}</span>}
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
  return (
    <section className="min-h-0 flex-1 overflow-y-auto border-l border-[#403a31] bg-[#11100e] p-5">
      <div className={`border-b pb-3 text-center ${RARITY_STYLE[item.rarity] || RARITY_STYLE.NORMAL}`}>
        {imageUrl && <img src={imageUrl} alt="" className="mx-auto mb-2 h-20 w-20 object-contain" />}
        <h3 className="font-serif text-lg font-semibold">{translateItemText(item.name)}</h3>
        <p className="mt-0.5 text-sm opacity-80">{translateItemText(item.baseType)}</p>
      </div>
      <div className="flex flex-wrap justify-center gap-x-4 gap-y-1 border-b border-[#302c26] py-3 text-[11px] text-gray-400">
        {item.itemLevel && <span>{t('equipment.itemLevel', { value: item.itemLevel })}</span>}
        {item.levelReq && <span>{t('equipment.levelReq', { value: item.levelReq })}</span>}
        {item.quality && <span>{t('equipment.quality', { value: item.quality })}</span>}
        {item.sockets && <span>{t('equipment.sockets', { value: item.sockets })}</span>}
      </div>
      <SocketedRunes item={item} index={itemIconIndex} />
      <div className="space-y-1.5 py-4 text-center text-xs leading-relaxed text-[#b8b3a8]">
        {item.lines.map((line, index) => (
          <p key={`${line}-${index}`} className={line.includes('{') ? 'text-blue-300/90' : ''}>
            {translateItemText(line)}
          </p>
        ))}
      </div>
    </section>
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
  return (
    <button
      onClick={onSelect}
      disabled={!item}
      title={item ? `${slotLabel}: ${itemName}` : slotLabel}
      className={`${className} relative min-h-0 overflow-hidden border bg-[#202932] transition-colors ${
        item
          ? `${RARITY_STYLE[item.rarity] || RARITY_STYLE.NORMAL} hover:bg-[#29333c] ${selected ? 'ring-1 ring-[#d5bd7b]' : ''}`
          : 'border-[#303944] text-gray-600'
      }`}
    >
      {imageUrl ? (
        <img src={imageUrl} alt={itemName} className="absolute inset-1 h-[calc(100%-8px)] w-[calc(100%-8px)] object-contain" />
      ) : (
        <span className="absolute inset-2 flex items-center justify-center text-center text-[10px] leading-tight">
          {itemName || t('equipment.empty')}
        </span>
      )}
      {item && <SocketedRunes item={item} index={itemIconIndex} compact />}
      <span className="absolute inset-x-0 bottom-0 bg-black/65 px-1 py-0.5 text-[8px] text-gray-400">
        {slotLabel}
      </span>
    </button>
  )
}

export function EquipmentPanel() {
  const { t } = useTranslation()
  const importedBuildCode = useTreeStore((state) => state.importedBuildCode)
  const [itemIconIndex, setItemIconIndex] = useState<Awaited<ReturnType<typeof loadItemIconIndex>>>(null)
  useEffect(() => {
    let mounted = true
    loadItemIconIndex().then((index) => {
      if (mounted) setItemIconIndex(index)
    })
    return () => { mounted = false }
  }, [])
  const equipment = useMemo(() => {
    if (!importedBuildCode) return null
    try { return parseEquipmentXml(decodeCodeToXml(importedBuildCode)) } catch { return null }
  }, [importedBuildCode])
  const activeSet = equipment?.itemSets.find((set) => set.id === equipment.activeItemSetId) || equipment?.itemSets[0]
  const equipped = activeSet?.slots.filter((slot) => !slot.name.endsWith(' Swap')) || []
  const firstItem = equipped.map((slot) => equipment?.itemsById[slot.itemId]).find(Boolean)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [weaponSet, setWeaponSet] = useState<1 | 2>(activeSet?.useSecondWeaponSet ? 2 : 1)
  const selected = (selectedId && equipment?.itemsById[selectedId]) || firstItem
  const selectedImageUrl = selected ? resolveItemIcon(selected, itemIconIndex) : undefined
  const setTitle = activeSet?.title?.match(/^Set (\d+)$/i)
    ? t('equipment.defaultSet', { number: activeSet.title.match(/\d+/)?.[0] || '1' })
    : activeSet?.title || t('equipment.currentBuild')

  const itemForSlot = (slotName: string) => {
    const resolvedName = weaponSet === 2 && slotName.startsWith('Weapon ')
      ? `${slotName} Swap`
      : slotName
    const slot = activeSet?.slots.find((entry) => entry.name === resolvedName)
    return slot ? equipment?.itemsById[slot.itemId] : undefined
  }

  return (
    <div className="fixed bottom-3 right-3 top-20 z-50 flex w-[min(900px,calc(100vw-24px))] flex-col overflow-hidden rounded-md border border-[#51483b] bg-[#171613]/98 shadow-2xl">
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-[#403a31] px-4">
        <div>
          <h2 className="text-sm font-semibold text-[#d8c69a]">{t('equipment.title')}</h2>
          <p className="text-[10px] text-gray-500">{setTitle}</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[11px] text-gray-500">{t('equipment.count', { count: equipped.length })}</span>
          <button onClick={() => window.dispatchEvent(new Event('close-equipment-panel'))} aria-label={t('equipment.close')} title={t('equipment.close')}
            className="flex h-7 w-7 items-center justify-center text-lg text-gray-500 transition-colors hover:bg-[#292620] hover:text-gray-200">×</button>
        </div>
      </header>
      {!equipment || !activeSet ? (
        <div className="flex flex-1 items-center justify-center p-8 text-center text-sm text-gray-500">
          {t('equipment.importHint')}
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 max-lg:flex-col">
          <div className="w-[460px] shrink-0 overflow-y-auto p-5 max-lg:w-full">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-[10px] font-semibold uppercase text-gray-500">{t('equipment.configuration')}</span>
              <div className="flex gap-1" aria-label={t('equipment.weaponSet')}>
                {([1, 2] as const).map((set) => (
                  <button key={set} onClick={() => setWeaponSet(set)}
                    className={`h-8 w-8 border text-xs transition-colors ${weaponSet === set ? 'border-[#81909d] bg-[#37434e] text-white' : 'border-[#3b4650] bg-[#242d35] text-gray-500 hover:text-gray-300'}`}>
                    {set === 1 ? 'I' : 'II'}
                  </button>
                ))}
              </div>
            </div>
            <div className="grid h-[454px] grid-cols-[repeat(5,76px)] grid-rows-[repeat(7,58px)] justify-center gap-1.5">
              {PAPER_DOLL_SLOTS.map((slot) => {
                const item = itemForSlot(slot.name)
                const imageUrl = item ? resolveItemIcon(item, itemIconIndex) : undefined
                return <PaperDollSlot key={slot.name} slotName={slot.name} item={item} className={slot.className}
                  imageUrl={imageUrl} itemIconIndex={itemIconIndex} selected={item?.id === selected?.id} onSelect={() => item && setSelectedId(item.id)} />
              })}
            </div>
          </div>
          {selected && <ItemDetail item={selected} imageUrl={selectedImageUrl} itemIconIndex={itemIconIndex} />}
        </div>
      )}
    </div>
  )
}

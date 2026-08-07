import type { HTMLAttributes, ReactNode } from 'react'
import type { CanonicalItemModifierView, CanonicalItemView } from '@/types/market'
import { translateGameText, type Language } from '@/i18n/translationLoader'
import { uiText } from '@/i18n/uiLocale'

interface EquipmentItemInspectorProps {
  view: CanonicalItemView
  language: Language
  sourceLabels?: string[]
  price?: string
  tags?: string[]
  note?: string
  headerAction?: ReactNode
  headerProps?: Omit<HTMLAttributes<HTMLElement>, 'className'>
}

export function equipmentItemName(view: CanonicalItemView, language: Language): string {
  return language === 'zh-rCN' ? view.localized?.['zh-CN']?.name || view.name : translateGameText(view.name, language)
}

export function equipmentItemBaseType(view: CanonicalItemView, language: Language): string {
  return language === 'zh-rCN' ? view.localized?.['zh-CN']?.baseType || view.baseType : translateGameText(view.baseType, language)
}

function modifierText(modifier: CanonicalItemModifierView, language: Language): string {
  return language === 'zh-rCN' ? modifier.localized?.['zh-CN'] || modifier.text : translateGameText(modifier.text, language)
}

export function EquipmentItemInspector({ view, language, sourceLabels = [], price, tags = [], note, headerAction, headerProps }: EquipmentItemInspectorProps) {
  const l = (en: string, zhCN: string, zhTW: string, koKR: string) => uiText(language, en, zhCN, zhTW, koKR)
  const rarityKey = view.rarity.toLowerCase()
  const modifierGroups = (['implicit', 'enchant', 'rune', 'explicit'] as const)
    .map((group) => ({ group, entries: view.modifiers.filter((modifier) => modifier.group === group) }))
    .filter(({ entries }) => entries.length)

  return <>
    <header className={`inspector-title item-header-${rarityKey} rarity-${rarityKey}`} {...headerProps}>
      <div className="item-header-copy"><h2>{equipmentItemName(view, language)}</h2><p>{equipmentItemBaseType(view, language)}</p></div>
      {headerAction}
    </header>
    <div className="inspector-scroll">
      <div className="item-property-type">{equipmentItemBaseType(view, language)}</div>
      {sourceLabels.length > 0 && <div className="library-item-inspector-sources">{sourceLabels.map((label, index) => <span key={`${label}-${index}`}>{label}</span>)}</div>}
      {price && <div className="library-item-inspector-price">{price}</div>}
      <div className="item-metadata">
        <span>{l('Rarity', '稀有度', '稀有度', '희귀도')} <strong>{view.rarity}</strong></span>
        {view.itemLevel != null && <span>{l('Item level', '物品等级', '物品等級', '아이템 레벨')} <strong>{view.itemLevel}</strong></span>}
        {view.quality != null && <span>{l('Quality', '品质', '品質', '퀄리티')} <strong>{view.quality}%</strong></span>}
        {view.sockets && <span>{l('Sockets', '孔位', '插槽', '홈')} <strong>{view.sockets}</strong></span>}
        {view.corrupted && <span className="library-item-inspector-corrupted">{l('Corrupted', '已腐化', '已汙染', '타락')}</span>}
      </div>
      <div className="item-modifiers">
        {modifierGroups.map(({ group, entries }) => <section className={`modifier-group modifier-${group}`} key={group}>{entries.map((modifier) => {
          const styleTag = modifier.sourceTags.find((tag) => ['crafted', 'fractured', 'mutated', 'rune', 'enchant'].includes(tag))
          return <p key={modifier.id} className={styleTag ? `mod-${styleTag}` : ''}>{modifierText(modifier, language)}</p>
        })}</section>)}
        {!modifierGroups.length && <p>{l('No modifier snapshot', '暂无词条快照', '暫無詞綴快照', '속성 스냅샷 없음')}</p>}
      </div>
      {(tags.length > 0 || note) && <div className="library-item-inspector-notes">{tags.length > 0 && <span>{tags.join(' · ')}</span>}{note && <p>{note}</p>}</div>}
    </div>
  </>
}

import type { HTMLAttributes, ReactNode } from 'react'
import type { CanonicalItemDisplayStat, CanonicalItemModifierView, CanonicalItemView } from '@/types/market'
import { normalizeDisplayTags, translateGameText, type Language } from '@/i18n/translationLoader'
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
  return language === 'zh-rCN' ? view.localized?.['zh-CN']?.name || translateGameText(view.name, language) : translateGameText(view.name, language)
}

export function equipmentItemBaseType(view: CanonicalItemView, language: Language): string {
  return language === 'zh-rCN' ? view.localized?.['zh-CN']?.baseType || translateGameText(view.baseType, language) : translateGameText(view.baseType, language)
}

function modifierText(modifier: CanonicalItemModifierView, language: Language): string {
  const translated = language === 'zh-rCN' ? modifier.localized?.['zh-CN'] || translateGameText(modifier.text, language) : translateGameText(modifier.text, language)
  return normalizeDisplayTags(translated)
}

function displayStatLabel(key: string, language: Language): string {
  const labels: Record<string, [string, string, string, string]> = {
    Armour: ['Armour', '护甲', '護甲', '방어도'],
    Evasion: ['Evasion Rating', '闪避值', '閃避值', '회피'],
    'Evasion Rating': ['Evasion Rating', '闪避值', '閃避值', '회피'],
    EnergyShield: ['Energy Shield', '能量护盾', '能量護盾', '에너지 보호막'],
    'Energy Shield': ['Energy Shield', '能量护盾', '能量護盾', '에너지 보호막'],
    Ward: ['Ward', '符文结界', '符文結界', '룬 결계'],
    BlockChance: ['Block Chance', '格挡几率', '格擋機率', '막기 확률'],
    Spirit: ['Spirit', '精魂', '精魂', '정신력'],
    CharmSlots: ['Charm Slots', '咒符栏位', '咒符欄位', '부적 슬롯'],
    PhysicalDamage: ['Physical Damage', '物理伤害', '物理傷害', '물리 피해'],
    'Physical Damage': ['Physical Damage', '物理伤害', '物理傷害', '물리 피해'],
    FireDamage: ['Fire Damage', '火焰伤害', '火焰傷害', '화염 피해'],
    'Fire Damage': ['Fire Damage', '火焰伤害', '火焰傷害', '화염 피해'],
    ColdDamage: ['Cold Damage', '冰霜伤害', '冰霜傷害', '냉기 피해'],
    'Cold Damage': ['Cold Damage', '冰霜伤害', '冰霜傷害', '냉기 피해'],
    LightningDamage: ['Lightning Damage', '闪电伤害', '閃電傷害', '번개 피해'],
    'Lightning Damage': ['Lightning Damage', '闪电伤害', '閃電傷害', '번개 피해'],
    ChaosDamage: ['Chaos Damage', '混沌伤害', '混沌傷害', '카오스 피해'],
    'Chaos Damage': ['Chaos Damage', '混沌伤害', '混沌傷害', '카오스 피해'],
    CriticalChance: ['Critical Chance', '暴击率', '暴擊率', '치명타 확률'],
    'Critical Strike Chance': ['Critical Chance', '暴击率', '暴擊率', '치명타 확률'],
    AttackRate: ['Attacks per Second', '每秒攻击次数', '每秒攻擊次數', '초당 공격 횟수'],
    'Attacks per Second': ['Attacks per Second', '每秒攻击次数', '每秒攻擊次數', '초당 공격 횟수'],
    WeaponRange: ['Weapon Range', '武器范围', '武器範圍', '무기 범위'],
    Level: ['Level', '等级', '等級', '레벨'],
    Strength: ['Strength', '力量', '力量', '힘'],
    Dexterity: ['Dexterity', '敏捷', '敏捷', '민첩'],
    Intelligence: ['Intelligence', '智慧', '智慧', '지능'],
  }
  const label = labels[key]
  return label ? uiText(language, ...label) : normalizeDisplayTags(translateGameText(key, language))
}

function DisplayStatList({ stats, language, className }: { stats: CanonicalItemDisplayStat[] | undefined; language: Language; className: string }) {
  if (!stats?.length) return null
  return <div className={className}>{stats.map((stat) => <span key={`${stat.key}-${stat.values.join('|')}`}><label>{displayStatLabel(stat.key, language)}</label><strong>{stat.values.join(' - ')}</strong></span>)}</div>
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
      <DisplayStatList stats={view.properties} language={language} className="item-display-stats" />
      <DisplayStatList stats={view.requirements} language={language} className="item-requirements" />
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

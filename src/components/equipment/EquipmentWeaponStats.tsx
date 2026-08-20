import type { Language } from '@/i18n/translationLoader'
import { formatUiNumber, uiText } from '@/i18n/uiLocale'
import type { WeaponComparisonStat } from '@/engine/itemDisplayStats'

interface EquipmentWeaponStatsProps {
  stats: WeaponComparisonStat[]
  language: Language
  className?: string
}

/** Compact local weapon metrics for equipment cards and detail views. */
export function EquipmentWeaponStats({ stats, language, className = '' }: EquipmentWeaponStatsProps) {
  const byKey = new Map(stats.map((stat) => [stat.key, stat.value]))
  if (!byKey.has('DPS')) return null

  const value = (key: 'DPS' | 'pDPS' | 'eDPS') => {
    const parsed = Number(byKey.get(key) || 0)
    return formatUiNumber(Number.isFinite(parsed) ? parsed : 0, language, {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    })
  }
  const label = uiText(language, 'Local weapon DPS', '装备自身 DPS', '裝備自身 DPS', '장비 자체 DPS')
  return <div className={`equipment-weapon-stats${className ? ` ${className}` : ''}`} aria-label={label} title={label}>
    <span><b>DPS</b><strong>{value('DPS')}</strong></span>
    <span><b>pDPS</b><strong>{value('pDPS')}</strong></span>
    <span><b>eDPS</b><strong>{value('eDPS')}</strong></span>
  </div>
}

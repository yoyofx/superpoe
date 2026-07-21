import { useState, useCallback } from 'react'
import { useTreeStore } from '@/store/treeStore'
import { useTranslation } from '@/i18n/useTranslation'
import type { CalcResult } from '@/types/calc'

type SectionKey = 'attributes' | 'offence' | 'defence'

function fmt(n: number | undefined, decimals = 1): string {
  if (n === undefined || n === null) return '-'
  return Number(n).toFixed(decimals)
}

export function StatTable({ page = false }: { page?: boolean }) {
  const { t } = useTranslation()
  const calcResult = useTreeStore((s) => s.calcResult)
  const calcLoading = useTreeStore((s) => s.calcLoading)
  const calcError = useTreeStore((s) => s.calcError)

  const [openSections, setOpenSections] = useState<Record<SectionKey, boolean>>({
    attributes: true,
    offence: true,
    defence: true,
  })
  const containerClass = page
    ? 'calculation-panel'
    : 'fixed bottom-4 right-4 z-30 min-w-[240px] max-w-[300px] max-h-[70vh] overflow-y-auto rounded border border-[#454137] bg-[#111311]/95 shadow-xl'

  const toggle = useCallback((sec: SectionKey) => {
    setOpenSections((prev) => ({ ...prev, [sec]: !prev[sec] }))
  }, [])

  const renderSection = (sec: SectionKey, children: React.ReactNode) => {
    const isOpen = openSections[sec]
    return (
      <div className="border-b border-gray-700 last:border-b-0">
        <button
          onClick={() => toggle(sec)}
          className="w-full flex items-center justify-between px-3 py-2 text-sm font-semibold
                     text-gray-300 hover:bg-gray-800/50 transition-colors"
        >
          <span>{t(`stats.${sec}`)}</span>
          <svg
            className={`w-3 h-3 text-gray-500 transition-transform ${isOpen ? 'rotate-90' : ''}`}
            fill="none" stroke="currentColor" viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </button>
        {isOpen && (
          <div className="px-3 pb-3 space-y-1.5">
            {children}
          </div>
        )}
      </div>
    )
  }

  const renderRow = (label: string, value: React.ReactNode) => (
    <div className="flex justify-between items-center text-xs">
      <span className="text-gray-400">{label}</span>
      <span className="text-gray-200 font-mono">{value}</span>
    </div>
  )

  // Loading state
  if (calcLoading) {
    if (page) {
      return <section className="calculation-state">
        <svg className="animate-spin" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
        <h2>{t('stats.calculating')}</h2>
      </section>
    }
    return (
      <div className={`${containerClass} p-4`}>
        <div className="flex items-center gap-2 text-sm text-gray-400">
          <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
          {t('stats.calculating')}
        </div>
      </div>
    )
  }

  // Error state
  if (calcError) {
    if (page) {
      return <section className="calculation-state error-state">
        <span>!</span>
        <h2>{t('stats.error')}</h2>
        <p>{calcError}</p>
      </section>
    }
    return (
      <div className={`${containerClass} border-red-700/50 p-4`}>
        <p className="text-xs text-red-400 mb-1 font-semibold">{t('stats.error')}</p>
        <p className="text-xs text-red-300 break-words">{calcError}</p>
      </div>
    )
  }

  // Empty state
  if (!calcResult) {
    if (page) {
      return <section className="calculation-state">
        <span>∑</span>
        <h2>{t('stats.empty')}</h2>
        <p>{t('toolbar.calcTitle')}</p>
      </section>
    }
    return (
      <div className={`${containerClass} p-4`}>
        <p className="text-xs text-gray-500">{t('stats.empty')}</p>
      </div>
    )
  }

  // Data state
  const r: CalcResult = calcResult

  return (
    <div className={containerClass}>
      {renderSection('attributes', <>
        {renderRow(t('stats.str'), r.Str)}
        {renderRow(t('stats.dex'), r.Dex)}
        {renderRow(t('stats.int'), r.Int)}
        {renderRow(t('stats.life'), `${r.Life} (${r.LifeUnreserved} unres.)`)}
        {renderRow(t('stats.es'), r.EnergyShield)}
        {renderRow(t('stats.mana'), `${r.Mana} (${r.ManaUnreserved} unres.)`)}
        {renderRow(t('stats.level'), r.CharacterLevel)}
        {r.ClassName && renderRow(t('stats.class'), r.ClassName)}
        {r.AscendClassName && renderRow(t('stats.ascendancy'), r.AscendClassName)}
      </>)}

      {renderSection('offence', <>
        {renderRow(t('stats.totalDps'), fmt(r.TotalDPS, 0))}
        {renderRow(t('stats.fullDps'), fmt(r.FullDPS, 0))}
        {r.FullDotDPS !== undefined && renderRow(t('stats.fullDotDps'), fmt(r.FullDotDPS, 0))}
        {renderRow(t('stats.averageHit'), fmt(r.AverageHit, 0))}
        {renderRow(t('stats.speed'), fmt(r.Speed, 2))}
        {renderRow(t('stats.critChance'), `${fmt(r.CritChance, 1)}%`)}
        {renderRow(t('stats.critMultiplier'), `${fmt(r.CritMultiplier, 0)}%`)}
      </>)}

      {renderSection('defence', <>
        {renderRow(t('stats.armour'), r.Armour)}
        {renderRow(t('stats.evasion'), r.Evasion)}
        {renderRow(t('stats.block'), fmt(r.BlockChance, 0) + '%')}
        {renderRow(t('stats.spellBlock'), fmt(r.SpellBlockChance, 0) + '%')}
        {renderRow(t('stats.fireResist'), `${r.FireResist}% (${r.FireResistTotal}%)`)}
        {renderRow(t('stats.coldResist'), `${r.ColdResist}% (${r.ColdResistTotal}%)`)}
        {renderRow(t('stats.lightningResist'), `${r.LightningResist}% (${r.LightningResistTotal}%)`)}
        {renderRow(t('stats.chaosResist'), `${r.ChaosResist}% (${r.ChaosResistTotal}%)`)}
        {renderRow(t('stats.lifeRegen'), fmt(r.LifeRegen, 1))}
        {renderRow(t('stats.manaRegen'), fmt(r.ManaRegen, 1))}
        {renderRow(t('stats.esRegen'), fmt(r.EnergyShieldRegen, 1))}
        {renderRow(t('stats.movementSpeed'), `${fmt(r.MovementSpeedMod, 1)}%`)}
        {renderRow(t('stats.actionSpeed'), `${fmt(r.ActionSpeedMod, 1)}%`)}
        {renderRow(t('stats.ward'), fmt(r.Ward, 0))}
      </>)}

      {/* Charges */}
      <div className="border-b border-gray-700 last:border-b-0">
        <div className="w-full flex items-center justify-between px-3 py-2 text-sm font-semibold text-gray-300">
          <span>{t('stats.charges')}</span>
        </div>
        <div className="px-3 pb-3 space-y-1.5">
          {renderRow(t('stats.powerCharges'), r.PowerChargesMax)}
          {renderRow(t('stats.frenzyCharges'), r.FrenzyChargesMax)}
          {renderRow(t('stats.enduranceCharges'), r.EnduranceChargesMax)}
        </div>
      </div>

      {/* Skill DPS breakdown */}
      {r.SkillDPS && r.SkillDPS.length > 0 && (
        <div className="border-b border-gray-700 last:border-b-0">
          <div className="w-full flex items-center justify-between px-3 py-2 text-sm font-semibold text-gray-300">
            <span>{t('stats.skills')}</span>
          </div>
          <div className="px-3 pb-3 space-y-1.5">
            {r.SkillDPS.map((skill, i) => (
              <div key={i} className="flex justify-between items-center text-xs">
                <span className="text-gray-400 truncate max-w-[140px]">
                  {skill.name}
                  {skill.trigger && <span className="text-amber-500 ml-1">({skill.trigger})</span>}
                </span>
                <span className="text-gray-200 font-mono">
                  {fmt(skill.dps, 0)}
                  {skill.count > 1 && (
                    <span className="text-gray-500 ml-1">x{skill.count}</span>
                  )}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

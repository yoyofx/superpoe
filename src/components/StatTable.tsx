import { useState, useCallback } from 'react'
import { useTreeStore } from '@/store/treeStore'
import type { CalcResult } from '@/types/calc'

type SectionKey = 'attributes' | 'offence' | 'defence'

const SECTION_LABELS: Record<SectionKey, string> = {
  attributes: 'Attributes',
  offence: 'Offence',
  defence: 'Defence',
}

function fmt(n: number | undefined, decimals = 1): string {
  if (n === undefined || n === null) return '-'
  return Number(n).toFixed(decimals)
}

export function StatTable() {
  const calcResult = useTreeStore((s) => s.calcResult)
  const calcLoading = useTreeStore((s) => s.calcLoading)
  const calcError = useTreeStore((s) => s.calcError)

  const [openSections, setOpenSections] = useState<Record<SectionKey, boolean>>({
    attributes: true,
    offence: true,
    defence: true,
  })

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
          <span>{SECTION_LABELS[sec]}</span>
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
    return (
      <div className="fixed bottom-4 right-4 z-30 bg-gray-900/90 backdrop-blur rounded-lg
                      border border-gray-700 p-4 shadow-xl min-w-[240px] max-w-[300px]">
        <div className="flex items-center gap-2 text-sm text-gray-400">
          <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
          Calculating...
        </div>
      </div>
    )
  }

  // Error state
  if (calcError) {
    return (
      <div className="fixed bottom-4 right-4 z-30 bg-gray-900/90 backdrop-blur rounded-lg
                      border border-red-700/50 p-4 shadow-xl min-w-[240px] max-w-[300px]">
        <p className="text-xs text-red-400 mb-1 font-semibold">Calculation Error</p>
        <p className="text-xs text-red-300 break-words">{calcError}</p>
      </div>
    )
  }

  // Empty state
  if (!calcResult) {
    return (
      <div className="fixed bottom-4 right-4 z-30 bg-gray-900/90 backdrop-blur rounded-lg
                      border border-gray-700 p-4 shadow-xl min-w-[240px] max-w-[300px]">
        <p className="text-xs text-gray-500">No calculation yet</p>
      </div>
    )
  }

  // Data state
  const r: CalcResult = calcResult

  return (
    <div className="fixed bottom-4 right-4 z-30 bg-gray-900/90 backdrop-blur rounded-lg
                    border border-gray-700 shadow-xl min-w-[240px] max-w-[300px]
                    max-h-[70vh] overflow-y-auto">
      {renderSection('attributes', <>
        {renderRow('Strength', r.Str)}
        {renderRow('Dexterity', r.Dex)}
        {renderRow('Intelligence', r.Int)}
        {renderRow('Life', `${r.Life} (${r.LifeUnreserved} unres.)`)}
        {renderRow('Energy Shield', r.EnergyShield)}
        {renderRow('Mana', `${r.Mana} (${r.ManaUnreserved} unres.)`)}
        {renderRow('Level', r.CharacterLevel)}
        {r.ClassName && renderRow('Class', r.ClassName)}
        {r.AscendClassName && renderRow('Ascendancy', r.AscendClassName)}
      </>)}

      {renderSection('offence', <>
        {renderRow('Total DPS', fmt(r.TotalDPS, 0))}
        {renderRow('Full DPS', fmt(r.FullDPS, 0))}
        {r.FullDotDPS !== undefined && renderRow('Full DoT DPS', fmt(r.FullDotDPS, 0))}
        {renderRow('Average Hit', fmt(r.AverageHit, 0))}
        {renderRow('Speed', fmt(r.Speed, 2))}
        {renderRow('Crit Chance', `${fmt(r.CritChance, 1)}%`)}
        {renderRow('Crit Multiplier', `${fmt(r.CritMultiplier, 0)}%`)}
      </>)}

      {renderSection('defence', <>
        {renderRow('Armour', r.Armour)}
        {renderRow('Evasion', r.Evasion)}
        {renderRow('Block', fmt(r.BlockChance, 0) + '%')}
        {renderRow('Spell Block', fmt(r.SpellBlockChance, 0) + '%')}
        {renderRow('Fire Resist', `${r.FireResist}% (${r.FireResistTotal}%)`)}
        {renderRow('Cold Resist', `${r.ColdResist}% (${r.ColdResistTotal}%)`)}
        {renderRow('Lightning Resist', `${r.LightningResist}% (${r.LightningResistTotal}%)`)}
        {renderRow('Chaos Resist', `${r.ChaosResist}% (${r.ChaosResistTotal}%)`)}
        {renderRow('Life Regen', fmt(r.LifeRegen, 1))}
        {renderRow('Mana Regen', fmt(r.ManaRegen, 1))}
        {renderRow('Movement Speed', `${fmt(r.MovementSpeedMod, 1)}%`)}
        {renderRow('Ward', fmt(r.Ward, 0))}
      </>)}
    </div>
  )
}

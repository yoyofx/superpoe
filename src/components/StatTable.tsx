import { useState, useCallback } from 'react'
import { useTreeStore } from '@/store/treeStore'
import { useTranslation } from '@/i18n/useTranslation'
import type { CalcResult } from '@/types/calc'
import type { Language } from '@/i18n/translationLoader'
import { formatUiNumber, uiText } from '@/i18n/uiLocale'
import { translateGameText } from '@/i18n/translationLoader'

type SectionKey = 'attributes' | 'offence' | 'defence'

function fmt(n: number | undefined, language: Language, decimals = 1): string {
  if (n === undefined || n === null) return '-'
  return formatUiNumber(Number(n), language, { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
}

export function StatTable({ page = false }: { page?: boolean }) {
  const { t, lang } = useTranslation()
  const calcResult = useTreeStore((s) => s.calcResult)
  const calcLoading = useTreeStore((s) => s.calcLoading)
  const calcError = useTreeStore((s) => s.calcError)
  const l = (en: string, zhCN: string, zhTW: string, koKR: string) => uiText(lang, en, zhCN, zhTW, koKR)

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
      <section className={`calc-section calc-${sec}`}>
        <button
          onClick={() => toggle(sec)}
          className="calc-section-toggle"
        >
          <span>{t(`stats.${sec}`)}</span>
          <svg
            className={isOpen ? 'open' : ''}
            fill="none" stroke="currentColor" viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </button>
        {isOpen && (
          <div className="calc-rows">
            {children}
          </div>
        )}
      </section>
    )
  }

  const renderRow = (label: string, value: React.ReactNode) => (
    <div className="calc-row">
      <span>{label}</span>
      <strong>{value}</strong>
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
      {page && <header className="calculation-heading">
        <span>{l('BUILD ANALYSIS', '构筑分析', '構築分析', '빌드 분석')}</span>
        <h2>{l('Offence, defence and resources', '进攻、防御与资源总览', '攻擊、防禦與資源總覽', '공격, 방어 및 자원')}</h2>
        <small>{l('Values from the latest calculation of the current build', '数值来自当前构筑的最近一次计算', '數值來自目前構築的最近一次計算', '현재 빌드의 최근 계산 결과입니다')}</small>
      </header>}
      <div className="calc-column">
        {renderSection('attributes', <>
          {renderRow(t('stats.str'), r.Str)}
          {renderRow(t('stats.dex'), r.Dex)}
          {renderRow(t('stats.int'), r.Int)}
          {renderRow(t('stats.life'), `${formatUiNumber(r.Life, lang)} (${formatUiNumber(r.LifeUnreserved, lang)} ${l('unreserved', '未保留', '未保留', '미점유')})`)}
          {renderRow(t('stats.es'), r.EnergyShield)}
          {renderRow(t('stats.mana'), `${formatUiNumber(r.Mana, lang)} (${formatUiNumber(r.ManaUnreserved, lang)} ${l('unreserved', '未保留', '未保留', '미점유')})`)}
          {renderRow(t('stats.level'), r.CharacterLevel)}
          {r.ClassName && renderRow(t('stats.class'), translateGameText(r.ClassName, lang))}
          {r.AscendClassName && renderRow(t('stats.ascendancy'), translateGameText(r.AscendClassName, lang))}
        </>)}
        <section className="calc-section calc-charges">
          <div className="calc-section-label"><span>{t('stats.charges')}</span></div>
          <div className="calc-rows">
            {renderRow(t('stats.powerCharges'), r.PowerChargesMax)}
            {renderRow(t('stats.frenzyCharges'), r.FrenzyChargesMax)}
            {renderRow(t('stats.enduranceCharges'), r.EnduranceChargesMax)}
          </div>
        </section>
      </div>

      <div className="calc-column">
        {renderSection('offence', <>
          {renderRow(t('stats.totalDps'), fmt(r.TotalDPS, lang, 0))}
          {renderRow(t('stats.fullDps'), fmt(r.FullDPS, lang, 0))}
          {r.FullDotDPS !== undefined && renderRow(t('stats.fullDotDps'), fmt(r.FullDotDPS, lang, 0))}
          {renderRow(t('stats.averageHit'), fmt(r.AverageHit, lang, 0))}
          {renderRow(t('stats.speed'), fmt(r.Speed, lang, 2))}
          {renderRow(t('stats.critChance'), `${fmt(r.CritChance, lang, 1)}%`)}
          {renderRow(t('stats.critMultiplier'), `${fmt(r.CritMultiplier, lang, 0)}%`)}
        </>)}
        {r.SkillDPS && r.SkillDPS.length > 0 && (
          <section className="calc-section calc-skills">
            <div className="calc-section-label"><span>{t('stats.skills')}</span></div>
            <div className="calc-rows">
              {r.SkillDPS.map((skill, i) => (
                <div key={i} className="calc-row skill-dps-row">
                  <span>{skill.name}{skill.trigger && <em>({skill.trigger})</em>}</span>
                  <strong>{fmt(skill.dps, lang, 0)}{skill.count > 1 && <small>x{skill.count}</small>}</strong>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>

      <div className="calc-column">
        {renderSection('defence', <>
          {renderRow(t('stats.armour'), r.Armour)}
          {renderRow(t('stats.evasion'), r.Evasion)}
          {renderRow(t('stats.block'), fmt(r.BlockChance, lang, 0) + '%')}
          {renderRow(t('stats.spellBlock'), fmt(r.SpellBlockChance, lang, 0) + '%')}
          {renderRow(t('stats.fireResist'), `${r.FireResist}% (${r.FireResistTotal}%)`)}
          {renderRow(t('stats.coldResist'), `${r.ColdResist}% (${r.ColdResistTotal}%)`)}
          {renderRow(t('stats.lightningResist'), `${r.LightningResist}% (${r.LightningResistTotal}%)`)}
          {renderRow(t('stats.chaosResist'), `${r.ChaosResist}% (${r.ChaosResistTotal}%)`)}
          {renderRow(t('stats.lifeRegen'), fmt(r.LifeRegen, lang, 1))}
          {renderRow(t('stats.manaRegen'), fmt(r.ManaRegen, lang, 1))}
          {renderRow(t('stats.esRegen'), fmt(r.EnergyShieldRegen, lang, 1))}
          {renderRow(t('stats.movementSpeed'), `${fmt(r.MovementSpeedMod, lang, 1)}%`)}
          {renderRow(t('stats.actionSpeed'), `${fmt(r.ActionSpeedMod, lang, 1)}%`)}
          {renderRow(t('stats.ward'), fmt(r.Ward, lang, 0))}
        </>)}
      </div>
    </div>
  )
}

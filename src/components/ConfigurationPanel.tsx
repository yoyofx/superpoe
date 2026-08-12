import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertCircle,
  Copy,
  LoaderCircle,
  Plus,
  RotateCcw,
  Search,
  SlidersHorizontal,
  Trash2,
} from 'lucide-react'
import { useTreeStore } from '@/store/treeStore'
import type { CalculationConfigOption, CalculationConfigValue } from '@/types/calc'
import { useTranslation } from '@/i18n/useTranslation'
import { localizeCalculationConfigOption } from '@/i18n/configurationTranslations'
import type { Language } from '@/i18n/translationLoader'
import { uiText, type UiMessage } from '@/i18n/uiLocale'

const SECTION_LABELS: Record<string, UiMessage> = {
  General: { en: 'General', 'zh-rCN': '通用', 'zh-rTW': '一般', 'ko-KR': '일반' },
  'Skill Options': { en: 'Skill Options', 'zh-rCN': '技能选项', 'zh-rTW': '技能選項', 'ko-KR': '스킬 옵션' },
  'When In Combat': { en: 'When In Combat', 'zh-rCN': '战斗状态', 'zh-rTW': '戰鬥狀態', 'ko-KR': '전투 중' },
  'For Effective DPS': { en: 'For Effective DPS', 'zh-rCN': '有效 DPS', 'zh-rTW': '有效 DPS', 'ko-KR': '유효 DPS' },
  'Enemy Stats': { en: 'Enemy Stats', 'zh-rCN': '敌人数据', 'zh-rTW': '敵人資料', 'ko-KR': '적 능력치' },
  'Custom Modifiers': { en: 'Custom Modifiers', 'zh-rCN': '自定义修正', 'zh-rTW': '自訂修正', 'ko-KR': '사용자 지정 보정' },
  'Quest Rewards': { en: 'Quest Rewards', 'zh-rCN': '剧情奖励', 'zh-rTW': '任務獎勵', 'ko-KR': '퀘스트 보상' },
}

function hasOwn(object: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(object, key)
}

function effectiveValue(option: CalculationConfigOption, overrides: Record<string, CalculationConfigValue>) {
  if (hasOwn(overrides, option.key)) return overrides[option.key]
  return option.value ?? option.defaultValue
}

function ConfigControl({
  option,
  overrides,
  disabled,
  language,
  onChange,
}: {
  option: CalculationConfigOption
  overrides: Record<string, CalculationConfigValue>
  disabled: boolean
  language: Language
  onChange: (value?: CalculationConfigValue) => void
}) {
  const value = effectiveValue(option, overrides)
  const changed = hasOwn(overrides, option.key)
  const reset = changed && <button
    type="button"
    className="config-option-reset"
    onClick={() => onChange(undefined)}
    title={uiText(language, 'Restore imported value', '恢复导入值', '恢復匯入值', '가져온 값 복원')}
    aria-label={uiText(language, 'Restore imported value', '恢复导入值', '恢復匯入值', '가져온 값 복원')}
  ><RotateCcw /></button>

  if (option.type === 'check') {
    return <div className="config-option-control check-control">
      <input
        type="checkbox"
        checked={Boolean(value)}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      {reset}
    </div>
  }

  if (option.type === 'list') {
    const choices = option.choices || []
    const selected = Math.max(0, choices.findIndex((choice) => choice.value === value))
    return <div className="config-option-control">
      <select
        value={selected}
        disabled={disabled || !choices.length}
        onChange={(event) => onChange(choices[Number(event.target.value)]?.value)}
      >
        {choices.map((choice, index) => <option key={`${option.key}-${index}`} value={index}>{choice.label}</option>)}
      </select>
      {reset}
    </div>
  }

  if (option.type === 'text') {
    return <div className="config-option-control text-control">
      <textarea
        value={String(value ?? '')}
        disabled={disabled}
        spellCheck={false}
        placeholder={option.placeholder == null ? '' : String(option.placeholder)}
        onChange={(event) => onChange(event.target.value)}
      />
      {reset}
    </div>
  }

  return <div className="config-option-control">
    <input
      type="number"
      step={option.type === 'float' ? 'any' : 1}
      value={typeof value === 'number' ? value : ''}
      disabled={disabled}
      placeholder={option.placeholder == null ? '' : String(option.placeholder)}
      onChange={(event) => {
        if (!event.target.value) onChange(undefined)
        else onChange(Number(event.target.value))
      }}
    />
    {reset}
  </div>
}

export function ConfigurationPanel() {
  const { lang, t } = useTranslation()
  const l = (en: string, zhCN: string, zhTW: string, koKR: string) => uiText(lang, en, zhCN, zhTW, koKR)
  const pobBuildRevision = useTreeStore((state) => state.pobBuildRevision)
  const getActivePobCode = useTreeStore((state) => state.getActivePobCode)
  const allocatedNodes = useTreeStore((state) => state.allocatedNodes)
  const activeWeaponSet = useTreeStore((state) => state.activeWeaponSet)
  const profiles = useTreeStore((state) => state.calculationProfiles)
  const activeProfileId = useTreeStore((state) => state.activeCalculationProfileId)
  const snapshot = useTreeStore((state) => state.calculationConfig)
  const loading = useTreeStore((state) => state.calcLoading)
  const error = useTreeStore((state) => state.calcError)
  const runCalculation = useTreeStore((state) => state.runCalculation)
  const setActiveProfile = useTreeStore((state) => state.setActiveCalculationProfile)
  const addProfile = useTreeStore((state) => state.addCalculationProfile)
  const renameProfile = useTreeStore((state) => state.renameCalculationProfile)
  const deleteProfile = useTreeStore((state) => state.deleteCalculationProfile)
  const setValue = useTreeStore((state) => state.setCalculationConfigValue)
  const resetConfig = useTreeStore((state) => state.resetCalculationConfig)
  const [query, setQuery] = useState('')
  const [showAll, setShowAll] = useState(false)
  const [retryNonce, setRetryNonce] = useState(0)
  const lastCalculationKey = useRef('')
  const activeProfile = profiles.find((profile) => profile.id === activeProfileId) || profiles[0]
  const overrides = activeProfile?.values || {}
  const activePobCode = useMemo(() => getActivePobCode() || '', [getActivePobCode, pobBuildRevision])
  const profileName = activeProfile?.id === 'default' && activeProfile.name === 'Default'
    ? l('Default', '默认', '預設', '기본')
    : activeProfile?.name || ''
  const calculationKey = `${activePobCode}:${pobBuildRevision}:${activeWeaponSet}:${activeProfileId}:${JSON.stringify(overrides)}:${retryNonce}`

  useEffect(() => {
    if (!activePobCode || !allocatedNodes.size || loading || lastCalculationKey.current === calculationKey) return
    const timer = window.setTimeout(() => {
      lastCalculationKey.current = calculationKey
      void runCalculation({ weaponSet: activeWeaponSet, includeConfig: true })
    }, snapshot ? 160 : 0)
    return () => window.clearTimeout(timer)
  }, [activePobCode, activeWeaponSet, allocatedNodes.size, calculationKey, loading, pobBuildRevision, runCalculation, snapshot])

  const localizedOptions = useMemo(() => (snapshot?.options || [])
    .map((option) => localizeCalculationConfigOption(option, lang)), [lang, snapshot?.options, t])

  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase()
    return localizedOptions.filter((option) => {
      if (!showAll && !option.visible && !hasOwn(overrides, option.key)) return false
      if (!normalized) return true
      const source = snapshot?.options.find((entry) => entry.key === option.key)
      return `${option.label}\n${source?.label || ''}\n${option.key}\n${option.tooltip || ''}\n${source?.tooltip || ''}`
        .toLocaleLowerCase()
        .includes(normalized)
    })
  }, [localizedOptions, overrides, query, showAll, snapshot?.options])

  const sections = useMemo(() => (snapshot?.sections || []).map((section) => ({
    name: section,
    options: filtered.filter((option) => option.section === section),
  })).filter((section) => section.options.length), [filtered, snapshot?.sections])
  const definitionUnavailable = !loading && !snapshot && lastCalculationKey.current === calculationKey

  if (!activePobCode || !allocatedNodes.size) {
    return <section className="configuration-empty">
      <SlidersHorizontal />
      <h2>{l('No build to configure', '没有可配置的构筑', '沒有可設定的構築', '설정할 빌드가 없습니다')}</h2>
      <p>{l('Import a complete build to manage skill damage conditions.', '导入完整构筑后即可管理技能伤害计算条件。', '匯入完整構築後即可管理技能傷害計算條件。', '완전한 빌드를 가져와 스킬 피해 계산 조건을 관리하세요.')}</p>
    </section>
  }

  return <section className="configuration-workspace">
    <header className="configuration-header">
      <div>
        <span>{l('Skill damage calculation conditions', '技能伤害计算条件', '技能傷害計算條件', '스킬 피해 계산 조건')}</span>
        <h1>{l('Damage configuration', '伤害配置', '傷害設定', '피해 설정')}</h1>
      </div>
      <div className="configuration-runtime-state">
        {loading && <><LoaderCircle className="spinning" />{l('Recalculating', '正在重新计算', '正在重新計算', '다시 계산 중')}</>}
        {!loading && snapshot && <>{l(`${filtered.length} options`, `${filtered.length} 项配置`, `${filtered.length} 項設定`, `옵션 ${filtered.length}개`)}</>}
      </div>
    </header>

    <div className="configuration-toolbar">
      <label className="configuration-profile-select">
        <span>{l('Local profile', '本地方案', '本機方案', '로컬 프로필')}</span>
        <select value={activeProfileId} onChange={(event) => setActiveProfile(event.target.value)}>
          {profiles.map((profile) => <option key={profile.id} value={profile.id}>
            {profile.id === 'default' && profile.name === 'Default' ? l('Default', '默认', '預設', '기본') : profile.name}
          </option>)}
        </select>
      </label>
      <input
        className="configuration-profile-name"
        value={profileName}
        maxLength={48}
        aria-label={l('Profile name', '方案名称', '方案名稱', '프로필 이름')}
        onChange={(event) => activeProfile && renameProfile(activeProfile.id, event.target.value)}
      />
      <button className="icon-command compact" onClick={() => addProfile(false)} title={l('New profile', '新建方案', '新增方案', '새 프로필')} aria-label={l('New profile', '新建方案', '新增方案', '새 프로필')}><Plus /></button>
      <button className="icon-command compact" onClick={() => addProfile(true)} title={l('Duplicate profile', '复制方案', '複製方案', '프로필 복제')} aria-label={l('Duplicate profile', '复制方案', '複製方案', '프로필 복제')}><Copy /></button>
      <button className="icon-command compact" disabled={profiles.length <= 1} onClick={() => activeProfile && deleteProfile(activeProfile.id)} title={l('Delete profile', '删除方案', '刪除方案', '프로필 삭제')} aria-label={l('Delete profile', '删除方案', '刪除方案', '프로필 삭제')}><Trash2 /></button>
      <span className="configuration-toolbar-spacer" />
      <button className="secondary-command" disabled={!Object.keys(overrides).length} onClick={resetConfig}><RotateCcw />{l('Restore imported', '恢复导入值', '恢復匯入值', '가져온 값 복원')}</button>
    </div>

    <div className="configuration-filter-bar">
      <label className="configuration-search">
        <Search />
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={l('Search options or keys', '搜索配置名称或键', '搜尋設定名稱或鍵', '옵션 또는 키 검색')} />
      </label>
      <label className="configuration-show-all">
        <input type="checkbox" checked={showAll} onChange={(event) => setShowAll(event.target.checked)} />
        <span>{l('Show all configurations', '显示全部配置', '顯示所有設定', '모든 설정 표시')}</span>
      </label>
    </div>

    {error && <p className="configuration-error"><AlertCircle />{error}</p>}
    {definitionUnavailable && !error && <div className="configuration-error configuration-definition-error">
      <AlertCircle />
      <span>{l('The PoB2 runtime did not return configuration definitions. Restart the desktop app and retry.', 'PoB2 运行时未返回配置定义，请重启桌面应用后重试。', 'PoB2 執行階段未傳回設定定義，請重新啟動桌面應用程式後重試。', 'PoB2 런타임이 설정 정의를 반환하지 않았습니다. 데스크톱 앱을 다시 시작하고 재시도하세요.')}</span>
      <button className="secondary-command" onClick={() => setRetryNonce((value) => value + 1)}>{l('Retry', '重试', '重試', '다시 시도')}</button>
    </div>}
    {!snapshot && !error && !definitionUnavailable && <div className="configuration-loading"><LoaderCircle className="spinning" />{l('Loading PoB2 configuration...', '正在读取 PoB2 配置定义...', '正在讀取 PoB2 設定定義...', 'PoB2 설정 불러오는 중...')}</div>}

    {snapshot && <div className="configuration-sections">
      {sections.map((section) => <section className="configuration-section" key={section.name}>
        <header>
          <h2>{SECTION_LABELS[section.name]?.[lang] || section.name}</h2>
          <span>{section.options.length}</span>
        </header>
        <div className="configuration-options">
          {section.options.map((option) => {
            const changed = hasOwn(overrides, option.key)
            return <label
              className={`configuration-option${changed ? ' changed' : ''}${option.valid ? '' : ' invalid'}${option.type === 'text' ? ' wide' : ''}`}
              key={option.key}
              title={option.tooltip}
            >
              <span className="configuration-option-copy">
                <strong>{option.label || option.key}</strong>
                <small>{option.key}</small>
              </span>
              <ConfigControl
                option={option}
                overrides={overrides}
                disabled={loading}
                language={lang}
                onChange={(value) => setValue(option.key, value)}
              />
            </label>
          })}
        </div>
      </section>)}
      {!sections.length && <p className="configuration-no-results">{l('No matching configuration options', '没有匹配的配置项', '沒有符合的設定項目', '일치하는 설정 옵션이 없습니다')}</p>}
    </div>}
  </section>
}

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

const SECTION_LABELS: Record<string, string> = {
  General: '通用',
  'Skill Options': '技能选项',
  'When In Combat': '战斗状态',
  'For Effective DPS': '有效 DPS',
  'Enemy Stats': '敌人数据',
  'Custom Modifiers': '自定义修正',
  'Quest Rewards': '剧情奖励',
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
  onChange,
}: {
  option: CalculationConfigOption
  overrides: Record<string, CalculationConfigValue>
  disabled: boolean
  onChange: (value?: CalculationConfigValue) => void
}) {
  const value = effectiveValue(option, overrides)
  const changed = hasOwn(overrides, option.key)
  const reset = changed && <button
    type="button"
    className="config-option-reset"
    onClick={() => onChange(undefined)}
    title="恢复导入值"
    aria-label="恢复导入值"
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
  const zh = lang === 'zh-rCN'
  const importedBuildCode = useTreeStore((state) => state.importedBuildCode)
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
  const profileName = activeProfile?.id === 'default' && activeProfile.name === 'Default' && zh
    ? '默认'
    : activeProfile?.name || ''
  const calculationKey = `${importedBuildCode || ''}:${activeWeaponSet}:${activeProfileId}:${JSON.stringify(overrides)}:${retryNonce}`

  useEffect(() => {
    if (!importedBuildCode || !allocatedNodes.size || loading || lastCalculationKey.current === calculationKey) return
    const timer = window.setTimeout(() => {
      lastCalculationKey.current = calculationKey
      void runCalculation({ weaponSet: activeWeaponSet, includeConfig: true })
    }, snapshot ? 160 : 0)
    return () => window.clearTimeout(timer)
  }, [activeWeaponSet, allocatedNodes.size, calculationKey, importedBuildCode, loading, runCalculation, snapshot])

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

  if (!importedBuildCode || !allocatedNodes.size) {
    return <section className="configuration-empty">
      <SlidersHorizontal />
      <h2>{zh ? '没有可配置的构筑' : 'No build to configure'}</h2>
      <p>{zh ? '导入完整构筑后即可管理技能伤害计算条件。' : 'Import a complete build to manage skill damage conditions.'}</p>
    </section>
  }

  return <section className="configuration-workspace">
    <header className="configuration-header">
      <div>
        <span>{zh ? '技能伤害计算条件' : 'Skill damage calculation conditions'}</span>
        <h1>{zh ? '伤害配置' : 'Damage configuration'}</h1>
      </div>
      <div className="configuration-runtime-state">
        {loading && <><LoaderCircle className="spinning" />{zh ? '正在重新计算' : 'Recalculating'}</>}
        {!loading && snapshot && <>{zh ? `${filtered.length} 项配置` : `${filtered.length} options`}</>}
      </div>
    </header>

    <div className="configuration-toolbar">
      <label className="configuration-profile-select">
        <span>{zh ? '本地方案' : 'Local profile'}</span>
        <select value={activeProfileId} onChange={(event) => setActiveProfile(event.target.value)}>
          {profiles.map((profile) => <option key={profile.id} value={profile.id}>
            {profile.id === 'default' && profile.name === 'Default' && zh ? '默认' : profile.name}
          </option>)}
        </select>
      </label>
      <input
        className="configuration-profile-name"
        value={profileName}
        maxLength={48}
        aria-label={zh ? '方案名称' : 'Profile name'}
        onChange={(event) => activeProfile && renameProfile(activeProfile.id, event.target.value)}
      />
      <button className="icon-command compact" onClick={() => addProfile(false)} title={zh ? '新建方案' : 'New profile'} aria-label={zh ? '新建方案' : 'New profile'}><Plus /></button>
      <button className="icon-command compact" onClick={() => addProfile(true)} title={zh ? '复制方案' : 'Duplicate profile'} aria-label={zh ? '复制方案' : 'Duplicate profile'}><Copy /></button>
      <button className="icon-command compact" disabled={profiles.length <= 1} onClick={() => activeProfile && deleteProfile(activeProfile.id)} title={zh ? '删除方案' : 'Delete profile'} aria-label={zh ? '删除方案' : 'Delete profile'}><Trash2 /></button>
      <span className="configuration-toolbar-spacer" />
      <button className="secondary-command" disabled={!Object.keys(overrides).length} onClick={resetConfig}><RotateCcw />{zh ? '恢复导入值' : 'Restore imported'}</button>
    </div>

    <div className="configuration-filter-bar">
      <label className="configuration-search">
        <Search />
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={zh ? '搜索配置名称或键' : 'Search options or keys'} />
      </label>
      <label className="configuration-show-all">
        <input type="checkbox" checked={showAll} onChange={(event) => setShowAll(event.target.checked)} />
        <span>{zh ? '显示全部配置' : 'Show all configurations'}</span>
      </label>
    </div>

    {error && <p className="configuration-error"><AlertCircle />{error}</p>}
    {definitionUnavailable && !error && <div className="configuration-error configuration-definition-error">
      <AlertCircle />
      <span>{zh ? 'PoB2 运行时未返回配置定义，请重启桌面应用后重试。' : 'The PoB2 runtime did not return configuration definitions. Restart the desktop app and retry.'}</span>
      <button className="secondary-command" onClick={() => setRetryNonce((value) => value + 1)}>{zh ? '重试' : 'Retry'}</button>
    </div>}
    {!snapshot && !error && !definitionUnavailable && <div className="configuration-loading"><LoaderCircle className="spinning" />{zh ? '正在读取 PoB2 配置定义...' : 'Loading PoB2 configuration...'}</div>}

    {snapshot && <div className="configuration-sections">
      {sections.map((section) => <section className="configuration-section" key={section.name}>
        <header>
          <h2>{zh ? SECTION_LABELS[section.name] || section.name : section.name}</h2>
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
                onChange={(value) => setValue(option.key, value)}
              />
            </label>
          })}
        </div>
      </section>)}
      {!sections.length && <p className="configuration-no-results">{zh ? '没有匹配的配置项' : 'No matching configuration options'}</p>}
    </div>}
  </section>
}

import { useEffect } from 'react'
import { Globe2, Info, Languages, ShieldAlert, X } from 'lucide-react'
import { SUPERPOE_NAME, SUPERPOE_VERSION_LABEL } from '@/engine/appVersion'
import type { AppSettings } from '@/engine/appSettings'
import { LANGUAGE_OPTIONS, type Language } from '@/i18n/translationLoader'
import { useTranslation } from '@/i18n/useTranslation'

interface GlobalSettingsDialogProps {
  open: boolean
  settings: AppSettings
  onChange: (settings: AppSettings) => void
  onClose: () => void
}

export function GlobalSettingsDialog({ open, settings, onChange, onClose }: GlobalSettingsDialogProps) {
  const { lang, setLanguage } = useTranslation()
  const zh = lang === 'zh-rCN'

  useEffect(() => {
    if (!open) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose, open])

  if (!open) return null

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="workflow-dialog settings-dialog" role="dialog" aria-modal="true" aria-labelledby="global-settings-title">
        <header className="dialog-header">
          <div><span>{zh ? '应用配置' : 'Application preferences'}</span><h2 id="global-settings-title">{zh ? '全局设置' : 'Global settings'}</h2></div>
          <button className="icon-command" onClick={onClose} aria-label={zh ? '关闭' : 'Close'}><X /></button>
        </header>

        <div className="settings-body">
          <section className="settings-section">
            <header><Languages /><h3>{zh ? '界面语言' : 'Interface language'}</h3></header>
            <label className="settings-row">
              <span>{zh ? '语言' : 'Language'}</span>
              <select value={lang} onChange={(event) => setLanguage(event.target.value as Language)}>
                {LANGUAGE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
          </section>

          <section className="settings-section">
            <header><Globe2 /><h3>{zh ? '构筑默认值' : 'Build defaults'}</h3></header>
            <div className="settings-row settings-realm-row">
              <span>{zh ? '默认服务器' : 'Default realm'}</span>
              <div className="realm-selector">
                <button type="button" className={settings.defaultRealm === 'cn' ? 'active cn' : ''} onClick={() => onChange({ ...settings, defaultRealm: 'cn' })}>{zh ? '腾讯服' : 'Tencent CN'}</button>
                <button type="button" className={settings.defaultRealm === 'global' ? 'active global' : ''} onClick={() => onChange({ ...settings, defaultRealm: 'global' })}>{zh ? '国际服' : 'Global'}</button>
              </div>
            </div>
          </section>

          <section className="settings-section">
            <header><ShieldAlert /><h3>{zh ? '编辑保护' : 'Editing protection'}</h3></header>
            <label className="settings-row settings-toggle-row">
              <span>{zh ? '离开未保存构筑前确认' : 'Confirm before leaving an unsaved build'}</span>
              <input type="checkbox" checked={settings.confirmUnsavedExit} onChange={(event) => onChange({ ...settings, confirmUnsavedExit: event.target.checked })} />
            </label>
          </section>

          <section className="settings-section settings-about">
            <header><Info /><h3>{zh ? '关于' : 'About'}</h3></header>
            <div className="settings-row"><span>{zh ? '应用' : 'Application'}</span><strong>{SUPERPOE_NAME}</strong></div>
            <div className="settings-row"><span>{zh ? '版本' : 'Version'}</span><strong>{SUPERPOE_VERSION_LABEL}</strong></div>
          </section>
        </div>

        <footer className="dialog-footer"><span /><button className="primary-command" onClick={onClose}>{zh ? '完成' : 'Done'}</button></footer>
      </section>
    </div>
  )
}

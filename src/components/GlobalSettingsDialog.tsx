import { useEffect, useState } from 'react'
import { Globe2, Info, Languages, Plus, RefreshCw, ShieldAlert, Trash2, X } from 'lucide-react'
import { SUPERPOE_NAME, SUPERPOE_VERSION_LABEL } from '@/engine/appVersion'
import type { AppSettings, UpdateChannel } from '@/engine/appSettings'
import { LANGUAGE_OPTIONS, type Language } from '@/i18n/translationLoader'
import { useTranslation } from '@/i18n/useTranslation'
import { triggerManualUpdateCheck } from '@/components/UpdateDialog'

interface GlobalSettingsDialogProps {
  open: boolean
  settings: AppSettings
  onChange: (settings: AppSettings) => void
  onClose: () => void
}

export function GlobalSettingsDialog({ open, settings, onChange, onClose }: GlobalSettingsDialogProps) {
  const { lang, setLanguage } = useTranslation()
  const zh = lang === 'zh-rCN'
  const [checking, setChecking] = useState(false)
  const [checkResult, setCheckResult] = useState<string | null>(null)
  const [proxyDraft, setProxyDraft] = useState('')

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

          <section className="settings-section">
            <header><RefreshCw /><h3>{zh ? '自动更新' : 'Auto Update'}</h3></header>
            <label className="settings-row">
              <span>{zh ? '更新通道' : 'Update channel'}</span>
              <select value={settings.updateChannel} onChange={(event) => onChange({ ...settings, updateChannel: event.target.value as UpdateChannel })}>
                <option value="release">{zh ? '正式通道 (Release)' : 'Release'}</option>
                <option value="dev">{zh ? '预览通道 (Dev)' : 'Dev'}</option>
              </select>
            </label>
            <label className="settings-row">
              <span>{zh ? '检查间隔（分钟）' : 'Check interval (minutes)'}</span>
              <input type="number" min={10} step={10} value={settings.updateCheckIntervalMinutes} onChange={(event) => {
                const val = parseInt(event.target.value, 10)
                if (val >= 10) onChange({ ...settings, updateCheckIntervalMinutes: val })
              }} style={{ width: '5em' }} />
            </label>
            <div className="settings-row">
              <span>{zh ? '手动检查' : 'Manual check'}</span>
              <button type="button" className="secondary-command" disabled={checking} onClick={async () => {
                setChecking(true)
                setCheckResult(null)
                const found = await triggerManualUpdateCheck()
                setCheckResult(found ? (zh ? '发现新版本' : 'Update found') : (zh ? '已是最新版本' : 'Up to date'))
                setChecking(false)
              }}>
                {checking ? (zh ? '检查中...' : 'Checking...') : (zh ? '立即检查' : 'Check now')}
              </button>
              {checkResult && <span className="update-check-result">{checkResult}</span>}
            </div>
            <div className="settings-proxy-block">
              <div className="settings-row settings-proxy-header">
                <span>{zh ? 'GitHub 代理域名（用户配置）' : 'GitHub proxy domains (user)'}</span>
              </div>
              <p className="settings-proxy-hint">
                {zh
                  ? '直连失败后按列表依次重试。拼接规则：{代理域名}/https://github.com/... 内置代理始终生效。'
                  : 'On direct failure, proxies are tried in order as {proxy}/https://github.com/... Built-in proxies always apply.'}
              </p>
              {settings.proxyDomains.length > 0 && (
                <ul className="settings-proxy-list">
                  {settings.proxyDomains.map((domain) => (
                    <li key={domain} className="settings-proxy-item">
                      <span title={domain}>{domain}</span>
                      <button
                        type="button"
                        className="icon-command"
                        aria-label={zh ? '删除代理' : 'Remove proxy'}
                        onClick={() => onChange({ ...settings, proxyDomains: settings.proxyDomains.filter((d) => d !== domain) })}
                      >
                        <Trash2 />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <div className="settings-proxy-add">
                <input
                  type="url"
                  value={proxyDraft}
                  placeholder="https://example-proxy.example"
                  onChange={(event) => setProxyDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key !== 'Enter') return
                    event.preventDefault()
                    const normalized = proxyDraft.trim().replace(/\/+$/, '')
                    if (!normalized || settings.proxyDomains.includes(normalized)) return
                    onChange({ ...settings, proxyDomains: [...settings.proxyDomains, normalized] })
                    setProxyDraft('')
                  }}
                />
                <button
                  type="button"
                  className="secondary-command"
                  onClick={() => {
                    const normalized = proxyDraft.trim().replace(/\/+$/, '')
                    if (!normalized || settings.proxyDomains.includes(normalized)) return
                    onChange({ ...settings, proxyDomains: [...settings.proxyDomains, normalized] })
                    setProxyDraft('')
                  }}
                >
                  <Plus /> {zh ? '添加' : 'Add'}
                </button>
              </div>
            </div>
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

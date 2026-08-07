import { useEffect, useState } from 'react'
import { FileCog, Globe2, Info, Languages, MonitorCog, Plus, RefreshCw, ShieldAlert, Trash2, X } from 'lucide-react'
import { SUPERPOE_NAME, SUPERPOE_VERSION_LABEL } from '@/engine/appVersion'
import { MAX_UI_SCALE_PERCENT, MIN_UI_SCALE_PERCENT, UI_SCALE_STEP_PERCENT, type AppSettings, type UpdateChannel } from '@/engine/appSettings'
import { LANGUAGE_OPTIONS, type Language } from '@/i18n/translationLoader'
import { useTranslation } from '@/i18n/useTranslation'
import { uiText } from '@/i18n/uiLocale'
import { triggerManualUpdateCheck } from '@/components/UpdateDialog'

interface GlobalSettingsDialogProps {
  open: boolean
  settings: AppSettings
  onChange: (settings: AppSettings) => void
  onClose: () => void
}

export function GlobalSettingsDialog({ open, settings, onChange, onClose }: GlobalSettingsDialogProps) {
  const { lang, setLanguage } = useTranslation()
  const l = (en: string, zhCN: string, zhTW: string, koKR: string) => uiText(lang, en, zhCN, zhTW, koKR)
  const [checking, setChecking] = useState(false)
  const [checkResult, setCheckResult] = useState<string | null>(null)
  const [associationResult, setAssociationResult] = useState<string | null>(null)
  const [registeringAssociation, setRegisteringAssociation] = useState(false)
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
          <div><span>{l('Application preferences', '应用配置', '應用程式偏好設定', '애플리케이션 설정')}</span><h2 id="global-settings-title">{l('Global settings', '全局设置', '全域設定', '전역 설정')}</h2></div>
          <button className="icon-command" onClick={onClose} aria-label={l('Close', '关闭', '關閉', '닫기')}><X /></button>
        </header>

        <div className="settings-body">
          <section className="settings-section">
            <header><Languages /><h3>{l('Interface language', '界面语言', '介面語言', '인터페이스 언어')}</h3></header>
            <label className="settings-row">
              <span>{l('Language', '语言', '語言', '언어')}</span>
              <select value={lang} onChange={(event) => setLanguage(event.target.value as Language)}>
                {LANGUAGE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
          </section>

          <section className="settings-section">
            <header><MonitorCog /><h3>{l('Display', '界面显示', '介面顯示', '화면 표시')}</h3></header>
            <label className="settings-row settings-scale-row">
              <span>{l('Interface scale', '界面缩放', '介面縮放', '인터페이스 배율')}</span>
              <div className="settings-scale-control">
                <input
                  type="range"
                  min={MIN_UI_SCALE_PERCENT}
                  max={MAX_UI_SCALE_PERCENT}
                  step={UI_SCALE_STEP_PERCENT}
                  value={settings.uiScalePercent}
                  onChange={(event) => onChange({ ...settings, uiScalePercent: Number(event.target.value) })}
                />
                <output>{settings.uiScalePercent}%</output>
              </div>
            </label>
          </section>

          <section className="settings-section">
            <header><Globe2 /><h3>{l('Build defaults', '构筑默认值', '構築預設值', '빌드 기본값')}</h3></header>
            <div className="settings-row settings-realm-row">
              <span>{l('Default realm', '默认服务器', '預設伺服器', '기본 서버')}</span>
              <div className="realm-selector">
                <button type="button" className={settings.defaultRealm === 'cn' ? 'active cn' : ''} onClick={() => onChange({ ...settings, defaultRealm: 'cn' })}>{l('Tencent CN', '腾讯服', '騰訊服', '텐센트 중국 서버')}</button>
                <button type="button" className={settings.defaultRealm === 'global' ? 'active global' : ''} onClick={() => onChange({ ...settings, defaultRealm: 'global' })}>{l('Global', '国际服', '國際服', '글로벌')}</button>
              </div>
            </div>
          </section>

          <section className="settings-section">
            <header><ShieldAlert /><h3>{l('Editing protection', '编辑保护', '編輯保護', '편집 보호')}</h3></header>
            <label className="settings-row settings-toggle-row">
              <span>{l('Confirm before leaving an unsaved build', '离开未保存构筑前确认', '離開未儲存構築前確認', '저장하지 않은 빌드를 나가기 전에 확인')}</span>
              <input type="checkbox" checked={settings.confirmUnsavedExit} onChange={(event) => onChange({ ...settings, confirmUnsavedExit: event.target.checked })} />
            </label>
          </section>

          <section className="settings-section">
            <header><FileCog /><h3>{l('File associations', '文件关联', '檔案關聯', '파일 연결')}</h3></header>
            <div className="settings-row settings-file-association-row">
              <span><strong>.spoe</strong> {l('build files', '构筑文件', '構築檔案', '빌드 파일')}</span>
              <div className="settings-file-association-control">
                <button type="button" className="secondary-command" disabled={registeringAssociation || !window.pob2Desktop} onClick={async () => {
                  setRegisteringAssociation(true)
                  setAssociationResult(null)
                  try {
                    const result = await window.pob2Desktop?.registerBuildFileAssociation()
                    if (!result?.registered) {
                      setAssociationResult(l('Not supported on this system', '当前系统暂不支持', '目前系統暫不支援', '현재 시스템에서는 지원되지 않음'))
                    } else if (result.isDefault) {
                      setAssociationResult(l('Registered as the default app', '已注册为默认打开程序', '已註冊為預設開啟程式', '기본 앱으로 등록됨'))
                    } else {
                      setAssociationResult(l('Registered; confirm it in system settings', '已注册，请在系统设置中确认', '已註冊，請在系統設定中確認', '등록됨. 시스템 설정에서 확인하세요'))
                    }
                  } catch {
                    setAssociationResult(l('Registration failed', '注册失败', '註冊失敗', '등록 실패'))
                  } finally {
                    setRegisteringAssociation(false)
                  }
                }}>
                  {registeringAssociation
                    ? l('Registering...', '正在注册...', '正在註冊...', '등록 중...')
                    : l('Register as default', '注册为默认程序', '註冊為預設程式', '기본 앱으로 등록')}
                </button>
                {!window.pob2Desktop && <small>{l('Desktop app only', '仅桌面版', '僅限桌面版', '데스크톱 앱 전용')}</small>}
                {associationResult && <small>{associationResult}</small>}
              </div>
            </div>
          </section>

          <section className="settings-section">
            <header><RefreshCw /><h3>{l('Auto update', '自动更新', '自動更新', '자동 업데이트')}</h3></header>
            <label className="settings-row">
              <span>{l('Update channel', '更新通道', '更新頻道', '업데이트 채널')}</span>
              <select value={settings.updateChannel} onChange={(event) => onChange({ ...settings, updateChannel: event.target.value as UpdateChannel })}>
                <option value="release">{l('Release', '正式通道 (Release)', '正式頻道 (Release)', '정식 채널 (Release)')}</option>
                <option value="dev">{l('Dev', '预览通道 (Dev)', '預覽頻道 (Dev)', '미리보기 채널 (Dev)')}</option>
              </select>
            </label>
            <label className="settings-row">
              <span>{l('Check interval (minutes)', '检查间隔（分钟）', '檢查間隔（分鐘）', '확인 간격(분)')}</span>
              <input type="number" min={10} step={10} value={settings.updateCheckIntervalMinutes} onChange={(event) => {
                const val = parseInt(event.target.value, 10)
                if (val >= 10) onChange({ ...settings, updateCheckIntervalMinutes: val })
              }} style={{ width: '5em' }} />
            </label>
            <div className="settings-row">
              <span>{l('Manual check', '手动检查', '手動檢查', '수동 확인')}</span>
              <button type="button" className="secondary-command" disabled={checking} onClick={async () => {
                setChecking(true)
                setCheckResult(null)
                const status = await triggerManualUpdateCheck(settings.updateChannel)
                if (status === 'available') {
                  setCheckResult(l('Update found', '发现新版本', '發現新版本', '새 버전 발견'))
                } else if (status === 'up-to-date') {
                  const channel = settings.updateChannel === 'dev'
                    ? l('dev', '预览', '預覽', '미리보기')
                    : l('release', '正式', '正式', '정식')
                  setCheckResult(l(`Up to date (${channel} channel)`, `已是最新版本（${channel}通道）`, `已是最新版本（${channel}頻道）`, `최신 버전입니다(${channel} 채널)`))
                } else if (status === 'unavailable') {
                  setCheckResult(l('Update checks require the desktop app', '仅桌面版支持检查更新', '僅桌面版支援檢查更新', '업데이트 확인은 데스크톱 앱에서만 지원됩니다'))
                } else {
                  setCheckResult(l('Check failed (network/proxy)', '检查失败（网络/代理）', '檢查失敗（網路/代理）', '확인 실패(네트워크/프록시)'))
                }
                setChecking(false)
              }}>
                {checking ? l('Checking...', '检查中...', '檢查中...', '확인 중...') : l('Check now', '立即检查', '立即檢查', '지금 확인')}
              </button>
              {checkResult && <span className="update-check-result">{checkResult}</span>}
            </div>
            <div className="settings-proxy-block">
              <div className="settings-row settings-proxy-header">
                <span>{l('GitHub proxy domains (user)', 'GitHub 代理域名（用户配置）', 'GitHub 代理網域（使用者設定）', 'GitHub 프록시 도메인(사용자 설정)')}</span>
              </div>
              <p className="settings-proxy-hint">
                {l('On direct failure, proxies are tried in order as {proxy}/https://github.com/... Built-in proxies always apply.', '直连失败后按列表依次重试。拼接规则：{代理域名}/https://github.com/... 内置代理始终生效。', '直接連線失敗後會依序嘗試代理。組合規則：{代理網域}/https://github.com/... 內建代理永遠有效。', '직접 연결에 실패하면 {proxy}/https://github.com/... 형식으로 프록시를 순서대로 시도합니다. 기본 프록시는 항상 적용됩니다.')}
              </p>
              {settings.proxyDomains.length > 0 && (
                <ul className="settings-proxy-list">
                  {settings.proxyDomains.map((domain) => (
                    <li key={domain} className="settings-proxy-item">
                      <span title={domain}>{domain}</span>
                      <button
                        type="button"
                        className="icon-command"
                        aria-label={l('Remove proxy', '删除代理', '移除代理', '프록시 제거')}
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
                  <Plus /> {l('Add', '添加', '新增', '추가')}
                </button>
              </div>
            </div>
          </section>

          <section className="settings-section settings-about">
            <header><Info /><h3>{l('About', '关于', '關於', '정보')}</h3></header>
            <div className="settings-row"><span>{l('Application', '应用', '應用程式', '애플리케이션')}</span><strong>{SUPERPOE_NAME}</strong></div>
            <div className="settings-row"><span>{l('Version', '版本', '版本', '버전')}</span><strong>{SUPERPOE_VERSION_LABEL}</strong></div>
          </section>
        </div>

        <footer className="dialog-footer"><span /><button className="primary-command" onClick={onClose}>{l('Done', '完成', '完成', '완료')}</button></footer>
      </section>
    </div>
  )
}

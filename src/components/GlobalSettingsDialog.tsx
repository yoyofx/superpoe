import { useEffect, useState } from 'react'
import { Activity, ArchiveRestore, Download, FileCog, Globe2, Info, Keyboard, Languages, MonitorCog, RefreshCw, ShieldAlert, ShieldCheck, Upload, X } from 'lucide-react'
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
  backupBusy: boolean
  backupNotice: string | null
  onBackupExport: () => void
  onBackupImport: () => void
}

export function GlobalSettingsDialog({ open, settings, onChange, onClose, backupBusy, backupNotice, onBackupExport, onBackupImport }: GlobalSettingsDialogProps) {
  const { lang, setLanguage } = useTranslation()
  const l = (en: string, zhCN: string, zhTW: string, koKR: string) => uiText(lang, en, zhCN, zhTW, koKR)
  const [checking, setChecking] = useState(false)
  const [checkResult, setCheckResult] = useState<string | null>(null)
  const [associationResult, setAssociationResult] = useState<string | null>(null)
  const [registeringAssociation, setRegisteringAssociation] = useState(false)
  const [elevationResult, setElevationResult] = useState<string | null>(null)
  const [elevating, setElevating] = useState(false)

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
            <header><Keyboard /><h3>{l('Price checker', '查价器', '查價器', '가격 확인')}</h3></header>
            <label className="settings-row settings-toggle-row">
              <span>{l('Enable the in-game price check hotkey', '启用游戏内查价热键', '啟用遊戲內查價快捷鍵', '게임 내 가격 확인 단축키 사용')}</span>
              <input type="checkbox" checked={settings.priceCheckEnabled} onChange={(event) => onChange({ ...settings, priceCheckEnabled: event.target.checked })} />
            </label>
            <label className="settings-row">
              <span>{l('Hotkey', '热键', '快捷鍵', '단축키')}</span>
              <input value={settings.priceCheckHotkey} readOnly disabled={!settings.priceCheckEnabled} onKeyDown={(event) => {
                event.preventDefault()
                if (['Control', 'Shift', 'Alt', 'Meta'].includes(event.key)) return
                const key = event.key.length === 1 ? event.key.toUpperCase() : event.key
                const parts = [event.ctrlKey || event.metaKey ? 'Ctrl' : '', event.altKey ? 'Alt' : '', event.shiftKey ? 'Shift' : '', key].filter(Boolean)
                onChange({ ...settings, priceCheckHotkey: parts.join('+') })
              }} />
            </label>
            <div className="settings-row settings-file-association-row">
              <span>{l('Administrator permissions', '管理员权限', '管理員權限', '관리자 권한')}</span>
              <div className="settings-file-association-control">
                <button type="button" className="secondary-command" disabled={elevating || !window.pob2Desktop} onClick={async () => {
                  setElevating(true)
                  setElevationResult(null)
                  try {
                    const result = await window.pob2Desktop?.restartAsAdministrator()
                    if (result?.status === 'started') {
                      setElevationResult(l('Restarting with administrator permissions...', '正在以管理员权限重启...', '正在以管理員權限重新啟動...', '관리자 권한으로 다시 시작하는 중...'))
                    } else if (result?.status === 'already-elevated') {
                      setElevationResult(l('Already running as administrator', '当前已是管理员权限', '目前已是管理員權限', '이미 관리자 권한으로 실행 중'))
                    } else if (result?.status === 'unsupported') {
                      setElevationResult(l('Windows only', '仅支持 Windows', '僅支援 Windows', 'Windows 전용'))
                    } else {
                      setElevationResult(l('UAC request cancelled', '已取消 UAC 提权', '已取消 UAC 提權', 'UAC 요청이 취소됨'))
                    }
                  } catch {
                    setElevationResult(l('Unable to restart as administrator', '无法以管理员权限重启', '無法以管理員權限重新啟動', '관리자 권한으로 다시 시작할 수 없음'))
                  } finally {
                    setElevating(false)
                  }
                }}>
                  <ShieldCheck />{elevating ? l('Restarting...', '重启中...', '重新啟動中...', '다시 시작 중...') : l('Restart as administrator', '以管理员身份重启', '以管理員身份重新啟動', '관리자 권한으로 다시 시작')}
                </button>
                {!window.pob2Desktop && <small>{l('Desktop app only', '仅桌面版', '僅限桌面版', '데스크톱 앱 전용')}</small>}
                {elevationResult && <small>{elevationResult}</small>}
              </div>
            </div>
          </section>
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
            <header><Activity /><h3>{l('Usage metrics', '使用统计', '使用統計', '사용 통계')}</h3></header>
            <label className="settings-row settings-toggle-row">
              <span>{l('Share anonymous operation metrics', '分享匿名使用统计', '分享匿名使用統計', '익명 사용 통계 공유')}</span>
              <input type="checkbox" checked={settings.analyticsEnabled} onChange={(event) => onChange({ ...settings, analyticsEnabled: event.target.checked })} />
            </label>
            <p className="settings-backup-hint">{l(
              'Only fixed operation events are sent. Build codes, equipment data, account details and tokens are never included.',
              '仅发送固定的操作事件，不会包含构筑代码、装备数据、账号信息或令牌。',
              '只會傳送固定的操作事件，不會包含構築代碼、裝備資料、帳號資訊或權杖。',
              '고정된 작업 이벤트만 전송되며 빌드 코드, 장비 데이터, 계정 정보 또는 토큰은 포함되지 않습니다.',
            )}</p>
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
            <header><ArchiveRestore /><h3>{l('Data backup', '数据备份', '資料備份', '데이터 백업')}</h3></header>
            <p className="settings-backup-hint">{l(
              'Move builds, settings, equipment library and market data to another device. Login sessions and downloadable caches are not included.',
              '可迁移构筑、设置、装备仓库和市场数据。登录状态与可重新下载的缓存不会包含在备份中。',
              '可移轉構築、設定、裝備倉庫與市場資料。登入狀態與可重新下載的快取不會包含在備份中。',
              '빌드, 설정, 장비 보관함과 시장 데이터를 다른 기기로 옮깁니다. 로그인 세션과 다시 받을 수 있는 캐시는 포함되지 않습니다.',
            )}</p>
            <div className="settings-row settings-file-association-row">
              <span>{l('Portable backup', '可迁移备份', '可攜式備份', '이동식 백업')}</span>
              <div className="settings-file-association-control settings-backup-control">
                <button type="button" className="secondary-command" disabled={backupBusy} onClick={onBackupExport}><Download />{l('Export', '导出', '匯出', '내보내기')}</button>
                <button type="button" className="secondary-command" disabled={backupBusy} onClick={onBackupImport}><Upload />{l('Restore', '恢复', '恢復', '복원')}</button>
                {backupNotice && <small role="status" aria-live="polite">{backupNotice}</small>}
              </div>
            </div>
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

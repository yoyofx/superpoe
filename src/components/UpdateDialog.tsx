import { useCallback, useEffect, useRef, useState } from 'react'
import { Download, RefreshCw, X } from 'lucide-react'
import type { UpdateInfo } from '@/electron'
import type { AppSettings } from '@/engine/appSettings'
import { useTranslation } from '@/i18n/useTranslation'
import { formatUiDate, uiText } from '@/i18n/uiLocale'

interface UpdateDialogProps {
  settings: AppSettings
  visible?: boolean
}

export function UpdateDialog({ settings, visible = true }: UpdateDialogProps) {
  const { lang } = useTranslation()
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null)
  const [showPrompt, setShowPrompt] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [forceInstall, setForceInstall] = useState(true)
  const configSyncedRef = useRef(false)

  // Sync update timing to the main process whenever settings change.
  // Downloads use the built-in proxy fallback; custom proxy domains are no
  // longer exposed or applied.
  useEffect(() => {
    if (!window.pob2Updater) return
    window.pob2Updater.setConfig({
      channel: settings.updateChannel,
      intervalMinutes: settings.updateCheckIntervalMinutes,
    })
    if (configSyncedRef.current) {
      window.pob2Updater.restartTimer()
    }
    configSyncedRef.current = true
  }, [settings.updateChannel, settings.updateCheckIntervalMinutes])

  // Listen for update-available from main process (periodic check)
  useEffect(() => {
    if (!window.pob2Updater) return
    const off = window.pob2Updater.onUpdateAvailable((info) => {
      setUpdateInfo(info)
      setForceInstall(true)
      setShowPrompt(true)
      setError(null)
    })
    window.pob2Updater.ready()
    return off
  }, [])

  // Listen for manual check trigger from custom event
  useEffect(() => {
    const handler = (e: Event) => {
      if (e instanceof CustomEvent && e.detail) {
        setUpdateInfo(e.detail as UpdateInfo)
        setForceInstall(true)
        setShowPrompt(true)
        setError(null)
      }
    }
    window.addEventListener('superpoe:update-found', handler)
    return () => window.removeEventListener('superpoe:update-found', handler)
  }, [])

  useEffect(() => {
    if (!window.pob2Updater) return
    return window.pob2Updater.onDownloadProgress((percent) => {
      setProgress(percent)
    })
  }, [])

  useEffect(() => {
    if (!window.pob2Updater) return
    return window.pob2Updater.onDownloadComplete(() => {
      setDownloading(false)
      setShowPrompt(false)
    })
  }, [])

  useEffect(() => {
    if (!window.pob2Updater) return
    return window.pob2Updater.onDownloadError((message) => {
      setDownloading(false)
      setError(message)
    })
  }, [])

  const handleUpdate = useCallback(() => {
    if (!window.pob2Updater || !updateInfo) return
    setDownloading(true)
    setProgress(0)
    setError(null)
    void window.pob2Updater.download(updateInfo, { forceInstall })
  }, [forceInstall, updateInfo])

  const handleDismiss = useCallback(() => {
    setShowPrompt(false)
    setDownloading(false)
    setError(null)
  }, [])

  if (!visible || !showPrompt || !updateInfo) return null

  const l = (en: string, zhCN: string, zhTW: string, koKR: string) => uiText(lang, en, zhCN, zhTW, koKR)

  return (
    <div className="modal-backdrop update-dialog-backdrop" role="presentation">
      <section className="workflow-dialog update-dialog" role="dialog" aria-modal="true" aria-labelledby="update-dialog-title">
        <header className="dialog-header">
          <div>
            <span>{l('Application Update', '应用更新', '應用程式更新', '애플리케이션 업데이트')}</span>
            <h2 id="update-dialog-title">
              {l('Update Available', '发现新版本', '發現新版本', '업데이트 사용 가능')}
            </h2>
          </div>
          {!downloading && <button className="icon-command" onClick={handleDismiss} aria-label={l('Close', '关闭', '關閉', '닫기')}><X /></button>}
        </header>

        <div className="settings-body">
          <div className="update-info">
            <p>
              {l(`Version ${updateInfo.version} is available (current: ${updateInfo.currentVersion})`, `新版本 ${updateInfo.version} 可用（当前版本：${updateInfo.currentVersion}）`, `新版本 ${updateInfo.version} 可用（目前版本：${updateInfo.currentVersion}）`, `새 버전 ${updateInfo.version}을 사용할 수 있습니다 (현재: ${updateInfo.currentVersion})`)}
            </p>
            <p className="update-channel-label">
              {l('Channel', '更新通道', '更新頻道', '채널')}: <strong>{updateInfo.channel === 'dev' ? l('Dev', '预览通道', '預覽頻道', '개발') : l('Release', '正式通道', '正式頻道', '정식')}</strong>
            </p>
            {updateInfo.releaseDate && (
              <p className="update-date">
                {l('Released', '发布时间', '發布時間', '출시일')}: {formatUiDate(updateInfo.releaseDate, lang)}
              </p>
            )}
          </div>

          <label className="settings-row settings-toggle-row">
            <span>
              {l('Install automatically', '自动安装', '自動安裝', '자동 설치')}
            </span>
            <input
              type="checkbox"
              checked={forceInstall}
              disabled={downloading}
              onChange={(event) => setForceInstall(event.target.checked)}
            />
          </label>

          {downloading && (
            <div className="update-progress">
              <div className="update-progress-bar">
                <div className="update-progress-fill" style={{ width: `${progress}%` }} />
              </div>
              <span className="update-progress-text">{progress}%</span>
            </div>
          )}

          {error && (
            <p className="update-error">{l('Download failed', '下载失败', '下載失敗', '다운로드 실패')}: {error}</p>
          )}
        </div>

        <footer className="dialog-footer">
          <span />
          {downloading ? (
            <button className="secondary-command" disabled>
              <Download /> {l('Downloading...', '下载中...', '下載中...', '다운로드 중...')}
            </button>
          ) : (
            <>
              <button className="secondary-command" onClick={handleDismiss}>
                {l('Later', '稍后提醒', '稍後提醒', '나중에')}
              </button>
              <button className="primary-command" onClick={handleUpdate}>
                <RefreshCw /> {l('Update Now', '立即更新', '立即更新', '지금 업데이트')}
              </button>
            </>
          )}
        </footer>
      </section>
    </div>
  )
}

/** Trigger a manual update check. Dispatches custom event if update found. */
export async function triggerManualUpdateCheck(channel?: 'release' | 'dev'): Promise<'available' | 'up-to-date' | 'error' | 'unavailable'> {
  if (!window.pob2Updater) return 'unavailable'
  // Pass channel explicitly so check does not depend on async set-config race.
  if (channel) {
    window.pob2Updater.setConfig({ channel })
  }
  const result = await window.pob2Updater.check(channel)
  if (result.status === 'available' && result.update) {
    window.dispatchEvent(new CustomEvent('superpoe:update-found', { detail: result.update }))
    return 'available'
  }
  return result.status
}

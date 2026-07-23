import { useCallback, useEffect, useRef, useState } from 'react'
import { Download, RefreshCw, X } from 'lucide-react'
import type { UpdateInfo } from '@/electron'
import type { AppSettings } from '@/engine/appSettings'

interface UpdateDialogProps {
  settings: AppSettings
}

export function UpdateDialog({ settings }: UpdateDialogProps) {
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null)
  const [showPrompt, setShowPrompt] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const configSyncedRef = useRef(false)

  // Sync config and proxy domains to main process whenever settings change
  useEffect(() => {
    if (!window.pob2Updater) return
    window.pob2Updater.setConfig({
      channel: settings.updateChannel,
      intervalMinutes: settings.updateCheckIntervalMinutes,
    })
    window.pob2Updater.setProxyDomains(settings.proxyDomains)
    if (configSyncedRef.current) {
      window.pob2Updater.restartTimer()
    }
    configSyncedRef.current = true
  }, [settings.updateChannel, settings.updateCheckIntervalMinutes, settings.proxyDomains])

  // Listen for update-available from main process (periodic check)
  useEffect(() => {
    if (!window.pob2Updater) return
    const off = window.pob2Updater.onUpdateAvailable((info) => {
      setUpdateInfo(info)
      setShowPrompt(true)
      setError(null)
    })
    return off
  }, [])

  // Listen for manual check trigger from custom event
  useEffect(() => {
    const handler = (e: Event) => {
      if (e instanceof CustomEvent && e.detail) {
        setUpdateInfo(e.detail as UpdateInfo)
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
    void window.pob2Updater.download(updateInfo)
  }, [updateInfo])

  const handleDismiss = useCallback(() => {
    setShowPrompt(false)
    setDownloading(false)
    setError(null)
  }, [])

  if (!showPrompt || !updateInfo) return null

  const zh = document.documentElement.lang === 'zh-rCN' ||
    navigator.language.startsWith('zh')

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="workflow-dialog update-dialog" role="dialog" aria-modal="true" aria-labelledby="update-dialog-title">
        <header className="dialog-header">
          <div>
            <span>{zh ? '应用更新' : 'Application Update'}</span>
            <h2 id="update-dialog-title">
              {zh ? '发现新版本' : 'Update Available'}
            </h2>
          </div>
          {!downloading && <button className="icon-command" onClick={handleDismiss} aria-label={zh ? '关闭' : 'Close'}><X /></button>}
        </header>

        <div className="settings-body">
          <div className="update-info">
            <p>
              {zh
                ? `新版本 ${updateInfo.version} 可用（当前版本：${updateInfo.currentVersion}）`
                : `Version ${updateInfo.version} is available (current: ${updateInfo.currentVersion})`}
            </p>
            <p className="update-channel-label">
              {zh ? '更新通道' : 'Channel'}: <strong>{updateInfo.channel === 'dev' ? (zh ? '预览通道' : 'Dev') : (zh ? '正式通道' : 'Release')}</strong>
            </p>
            {updateInfo.releaseDate && (
              <p className="update-date">
                {zh ? '发布时间' : 'Released'}: {new Date(updateInfo.releaseDate).toLocaleDateString()}
              </p>
            )}
          </div>

          {downloading && (
            <div className="update-progress">
              <div className="update-progress-bar">
                <div className="update-progress-fill" style={{ width: `${progress}%` }} />
              </div>
              <span className="update-progress-text">{progress}%</span>
            </div>
          )}

          {error && (
            <p className="update-error">{zh ? '下载失败' : 'Download failed'}: {error}</p>
          )}
        </div>

        <footer className="dialog-footer">
          <span />
          {downloading ? (
            <button className="secondary-command" disabled>
              <Download /> {zh ? '下载中...' : 'Downloading...'}
            </button>
          ) : (
            <>
              <button className="secondary-command" onClick={handleDismiss}>
                {zh ? '稍后提醒' : 'Later'}
              </button>
              <button className="primary-command" onClick={handleUpdate}>
                <RefreshCw /> {zh ? '立即更新' : 'Update Now'}
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

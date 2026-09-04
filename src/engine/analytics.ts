/**
 * Anonymous desktop operation metrics.
 *
 * This module intentionally accepts only a closed set of event names. Do not
 * add user input, build data, item text, account identifiers, or tokens to
 * this API. Baidu Tongji may collect its own basic request dimensions (such
 * as platform and IP) but SuperPoE never sends application content here.
 */

export const BAIDU_TONGJI_SITE_ID = '725c4f84e1ae27957234928bcb47a47d'

export type AnalyticsEvent =
  | 'app_start'
  | 'workspace_ready'
  | 'build_create'
  | 'build_open'
  | 'build_import'
  | 'build_save'
  | 'build_export'
  | 'auth_login_success'
  | 'auth_login_failure'
  | 'auth_register_success'
  | 'auth_register_failure'
  | 'auth_password_reset_request'
  | 'auth_password_reset_success'
  | 'auth_logout'
  | 'view_center'
  | 'view_editor_equipment'
  | 'view_editor_skills'
  | 'view_editor_passive'
  | 'view_editor_analysis'
  | 'view_equipment_library'
  | 'view_trade_center'
  | 'view_market_monitoring'
  | 'view_voice_community'

type TongjiQueue = Array<unknown[]>

declare global {
  interface Window {
    _hmt?: TongjiQueue
  }
}

let enabled = false
let scriptRequested = false

function isDesktopRenderer(): boolean {
  return typeof window !== 'undefined' && Boolean(window.pob2Desktop)
}

function ensureQueue(): TongjiQueue | null {
  if (!isDesktopRenderer()) return null
  window._hmt = window._hmt || []
  return window._hmt
}

function loadScript(): void {
  if (!enabled || !isDesktopRenderer() || scriptRequested || typeof document === 'undefined') return
  if (document.querySelector('script[data-superpoe-tongji="true"]')) {
    scriptRequested = true
    return
  }
  scriptRequested = true
  const script = document.createElement('script')
  script.async = true
  script.src = `https://hm.baidu.com/hm.js?${BAIDU_TONGJI_SITE_ID}`
  script.dataset.superpoeTongji = 'true'
  script.onerror = () => {
    // Metrics must never affect the application when the network is blocked.
    scriptRequested = false
  }
  document.head.appendChild(script)
}

export function configureAnalytics(value: boolean): void {
  enabled = value === true
  if (enabled) {
    ensureQueue()
    loadScript()
  }
}

export function trackAnalytics(event: AnalyticsEvent): void {
  if (!enabled) return
  const queue = ensureQueue()
  if (!queue) return
  loadScript()
  queue.push(['_trackEvent', 'desktop', event])
}

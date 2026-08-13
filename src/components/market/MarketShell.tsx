import { Archive, ArrowLeft, BellRing, Coins, Settings, Store } from 'lucide-react'
import { MarketPanel } from '@/components/market/MarketPanel'
import { MonitoringWorkspace } from '@/components/market/MonitoringWorkspace'
import { SUPERPOE_NAME, SUPERPOE_VERSION_LABEL } from '@/engine/appVersion'
import { useTranslation } from '@/i18n/useTranslation'
import { MAX_ACTIVE_PURCHASE_TARGETS, type MarketMonitoringSnapshot } from '@/types/market'
import type { BuildRealm } from '@/types/tree'
import { GameRuntimeIndicator } from '@/components/GameRuntimeIndicator'
import { CurrencyMarketWorkspace } from '@/components/market/currency/CurrencyMarketWorkspace'
import { uiText } from '@/i18n/uiLocale'

export type MarketWorkspaceView = 'market' | 'currency' | 'monitoring'

interface MarketShellProps {
  realm: BuildRealm
  suspended?: boolean
  view: MarketWorkspaceView
  onViewChange: (view: MarketWorkspaceView) => void
  monitoring: MarketMonitoringSnapshot | null
  backTarget: 'center' | 'editor' | 'library'
  buildName?: string
  onBack: () => void
  onLibrary: () => void
  onSettings: () => void
}
export function MarketShell({ realm, suspended, view, onViewChange, monitoring, backTarget, buildName, onBack, onLibrary, onSettings }: MarketShellProps) {
  const { lang } = useTranslation()
  const l = (en: string, zhCN: string, zhTW: string, koKR: string) => uiText(lang, en, zhCN, zhTW, koKR)
  const armedCount = monitoring?.purchaseTargets.filter((target) => target.status === 'armed').length || 0
  const connectedCount = monitoring?.targets.filter((target) => target.connectionStatus === 'connected').length || 0
  const pendingCount = monitoring?.targets.reduce((total, target) => total + target.pendingOpportunityCount, 0) || 0
  const isActivelyMonitoring = armedCount > 0 && !monitoring?.globalPaused
  const backLabel = backTarget === 'editor'
    ? l(`Back to build: ${buildName || 'Untitled build'}`, `返回构筑：${buildName || '未命名构筑'}`, `返回構築：${buildName || '未命名構築'}`, `빌드로 돌아가기: ${buildName || '이름 없는 빌드'}`)
    : backTarget === 'library'
      ? l('Back to equipment library', '返回装备仓库', '返回裝備倉庫', '장비 라이브러리로 돌아가기')
    : l('Back to build center', '返回构筑中心', '返回構築中心', '빌드 센터로 돌아가기')
  return <>
    <header className="workbench-header market-shell-header">
      <div className="app-command-bar">
        <div className="app-brand" aria-label={SUPERPOE_NAME}>
          <img className="app-brand-logo" src="/assets/ui/superpoe2-logo.png" alt="" />
          <span><strong>{SUPERPOE_NAME}</strong><small>{SUPERPOE_VERSION_LABEL}</small></span>
        </div>
        <div className="market-shell-title">
          <button className="icon-command compact" onClick={onBack} title={backLabel} aria-label={backLabel}><ArrowLeft /></button>
          <span><strong>{l('Trade Center', '交易中心', '交易中心', '거래 센터')}</strong><small>{l('Market, library, currency prices, and live monitoring', '集市、装备仓库、通货行情与实时监控', '市集、裝備倉庫、通貨行情與即時監控', '거래소, 장비 라이브러리, 화폐 시세 및 실시간 모니터링')}</small></span>
        </div>
        <div className="command-actions">
          <button className="secondary-command toolbar-library-command" onClick={onLibrary} title={l('Open equipment library', '打开装备仓库', '開啟裝備倉庫', '장비 라이브러리 열기')} aria-label={l('Open equipment library', '打开装备仓库', '開啟裝備倉庫', '장비 라이브러리 열기')}><Archive /><span>{l('Equipment library', '装备仓库', '裝備倉庫', '장비 라이브러리')}</span></button>
          <GameRuntimeIndicator />
          <button className="icon-command" onClick={onSettings} title={l('Global settings', '全局设置', '全域設定', '전역 설정')} aria-label={l('Global settings', '全局设置', '全域設定', '전역 설정')}><Settings /></button>
        </div>
      </div>
      <div className="workspace-tabs-bar">
        <nav className="workspace-tabs" aria-label={l('Trade Center workspace', '交易中心页面', '交易中心頁面', '거래 센터 작업 공간')}>
          <button className={view === 'market' ? 'active' : ''} aria-current={view === 'market' ? 'page' : undefined} onClick={() => onViewChange('market')}><Store /><span>{l('Market & Library', '集市与仓库', '市集與倉庫', '거래소 및 라이브러리')}</span></button>
          <button className={[view === 'monitoring' ? 'active' : '', 'monitoring-entry', isActivelyMonitoring ? 'is-monitoring' : ''].filter(Boolean).join(' ')} aria-current={view === 'monitoring' ? 'page' : undefined} onClick={() => onViewChange('monitoring')}><span className="monitoring-tab-icon" aria-hidden="true"><BellRing /></span><span>{l('Live Monitoring', '实时监控', '即時監控', '실시간 모니터링')}</span>{monitoring && <small className="monitoring-tab-count" title={l(`${armedCount}/${MAX_ACTIVE_PURCHASE_TARGETS} monitoring, ${connectedCount} connected`, `监控中 ${armedCount}/${MAX_ACTIVE_PURCHASE_TARGETS}，Live 已连接 ${connectedCount}`, `監控中 ${armedCount}/${MAX_ACTIVE_PURCHASE_TARGETS}，Live 已連線 ${connectedCount}`, `${armedCount}/${MAX_ACTIVE_PURCHASE_TARGETS} 모니터링, ${connectedCount} 연결됨`)}>{languagePrefix(lang, armedCount)}{armedCount}/{MAX_ACTIVE_PURCHASE_TARGETS}</small>}{pendingCount > 0 && <small className="monitoring-tab-alert" title={l(`${pendingCount} pending opportunities`, `${pendingCount} 个待处理机会`, `${pendingCount} 個待處理機會`, `대기 중인 기회 ${pendingCount}개`)}>{pendingCount}</small>}</button>
          <button className={view === 'currency' ? 'active' : ''} aria-current={view === 'currency' ? 'page' : undefined} onClick={() => onViewChange('currency')}><Coins /><span>{l('Currency Market', '通货行情', '通貨行情', '화폐 시세')}</span></button>
        </nav>
      </div>
    </header>
    <main className="workspace-view">{view === 'market' ? <MarketPanel realm={realm} suspended={suspended} /> : view === 'currency' ? <CurrencyMarketWorkspace realm={realm} /> : <MonitoringWorkspace />}</main>
  </>
}

function languagePrefix(language: ReturnType<typeof useTranslation>['lang'], count: number): string {
  if (!count) return ''
  return uiText(language, '', '监控 ', '監控 ', '모니터링 ')
}

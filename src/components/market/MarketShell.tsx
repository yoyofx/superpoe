import { ArrowLeft, BellRing, Coins, Settings, Store } from 'lucide-react'
import { MarketPanel } from '@/components/market/MarketPanel'
import { MonitoringWorkspace } from '@/components/market/MonitoringWorkspace'
import { SUPERPOE_NAME, SUPERPOE_VERSION_LABEL } from '@/engine/appVersion'
import { useTranslation } from '@/i18n/useTranslation'
import { MAX_ACTIVE_PURCHASE_TARGETS, type MarketMonitoringSnapshot } from '@/types/market'
import type { BuildRealm } from '@/types/tree'
import { GameRuntimeIndicator } from '@/components/GameRuntimeIndicator'
import { CurrencyMarketWorkspace } from '@/components/market/currency/CurrencyMarketWorkspace'

export type MarketWorkspaceView = 'market' | 'currency' | 'monitoring'

interface MarketShellProps {
  realm: BuildRealm
  suspended?: boolean
  view: MarketWorkspaceView
  onViewChange: (view: MarketWorkspaceView) => void
  monitoring: MarketMonitoringSnapshot | null
  backTarget: 'center' | 'editor'
  buildName?: string
  onBack: () => void
  onSettings: () => void
}
export function MarketShell({ realm, suspended, view, onViewChange, monitoring, backTarget, buildName, onBack, onSettings }: MarketShellProps) {
  const { lang } = useTranslation()
  const zh = lang === 'zh-rCN'
  const armedCount = monitoring?.purchaseTargets.filter((target) => target.status === 'armed').length || 0
  const connectedCount = monitoring?.targets.filter((target) => target.connectionStatus === 'connected').length || 0
  const pendingCount = monitoring?.targets.reduce((total, target) => total + target.pendingOpportunityCount, 0) || 0
  const isActivelyMonitoring = armedCount > 0 && !monitoring?.globalPaused
  const backLabel = backTarget === 'editor'
    ? (zh ? `返回构筑：${buildName || '未命名构筑'}` : `Back to build: ${buildName || 'Untitled build'}`)
    : (zh ? '返回构筑中心' : 'Back to build center')
  return <>
    <header className="workbench-header market-shell-header">
      <div className="app-command-bar">
        <div className="app-brand" aria-label={SUPERPOE_NAME}>
          <img className="app-brand-logo" src="/assets/ui/superpoe2-logo.png" alt="" />
          <span><strong>{SUPERPOE_NAME}</strong><small>{SUPERPOE_VERSION_LABEL}</small></span>
        </div>
        <div className="market-shell-title">
          <button className="icon-command compact" onClick={onBack} title={backLabel} aria-label={backLabel}><ArrowLeft /></button>
          <span><strong>{zh ? '交易中心' : 'Trade Center'}</strong><small>{zh ? '集市、装备仓库、通货行情与实时监控' : 'Market, library, currency prices, and live monitoring'}</small></span>
        </div>
        <div className="command-actions">
          <GameRuntimeIndicator />
          <button className="icon-command" onClick={onSettings} title={zh ? '全局设置' : 'Global settings'} aria-label={zh ? '全局设置' : 'Global settings'}><Settings /></button>
        </div>
      </div>
      <div className="workspace-tabs-bar">
        <nav className="workspace-tabs" aria-label={zh ? '交易中心页面' : 'Trade Center workspace'}>
          <button className={view === 'market' ? 'active' : ''} aria-current={view === 'market' ? 'page' : undefined} onClick={() => onViewChange('market')}><Store /><span>{zh ? '集市与仓库' : 'Market & Library'}</span></button>
          <button className={[view === 'monitoring' ? 'active' : '', 'monitoring-entry', isActivelyMonitoring ? 'is-monitoring' : ''].filter(Boolean).join(' ')} aria-current={view === 'monitoring' ? 'page' : undefined} onClick={() => onViewChange('monitoring')}><span className="monitoring-tab-icon" aria-hidden="true"><BellRing /></span><span>{zh ? '实时监控' : 'Live Monitoring'}</span>{monitoring && <small className="monitoring-tab-count" title={zh ? `监控中 ${armedCount}/${MAX_ACTIVE_PURCHASE_TARGETS}，Live 已连接 ${connectedCount}` : `${armedCount}/${MAX_ACTIVE_PURCHASE_TARGETS} monitoring, ${connectedCount} connected`}>{zh ? '监控 ' : ''}{armedCount}/{MAX_ACTIVE_PURCHASE_TARGETS}</small>}{pendingCount > 0 && <small className="monitoring-tab-alert" title={zh ? `${pendingCount} 个待处理机会` : `${pendingCount} pending opportunities`}>{pendingCount}</small>}</button>
          <button className={view === 'currency' ? 'active' : ''} aria-current={view === 'currency' ? 'page' : undefined} onClick={() => onViewChange('currency')}><Coins /><span>{zh ? '通货行情' : 'Currency Market'}</span></button>
        </nav>
      </div>
    </header>
    <main className="workspace-view">{view === 'market' ? <MarketPanel realm={realm} suspended={suspended} /> : view === 'currency' ? <CurrencyMarketWorkspace realm={realm} zh={zh} /> : <MonitoringWorkspace zh={zh} />}</main>
  </>
}

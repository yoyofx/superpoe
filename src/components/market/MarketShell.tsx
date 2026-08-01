import { useEffect, useState } from 'react'
import { ArrowLeft, BellRing, Settings, Store } from 'lucide-react'
import { MarketPanel } from '@/components/market/MarketPanel'
import { MonitoringWorkspace } from '@/components/market/MonitoringWorkspace'
import { SUPERPOE_NAME, SUPERPOE_VERSION_LABEL } from '@/engine/appVersion'
import { useTranslation } from '@/i18n/useTranslation'
import type { MarketMonitoringSnapshot } from '@/types/market'
import type { BuildRealm } from '@/types/tree'
import { GameRuntimeIndicator } from '@/components/GameRuntimeIndicator'

interface MarketShellProps {
  realm: BuildRealm
  suspended?: boolean
  onBack: () => void
  onSettings: () => void
}
export function MarketShell({ realm, suspended, onBack, onSettings }: MarketShellProps) {
  const { lang } = useTranslation()
  const zh = lang === 'zh-rCN'
  const [view, setView] = useState<'market' | 'monitoring'>('market')
  const [monitoring, setMonitoring] = useState<MarketMonitoringSnapshot | null>(null)
  const marketBridge = window.pob2Market

  useEffect(() => {
    if (!marketBridge) return
    let active = true
    void marketBridge.getMonitoring().then((snapshot) => { if (active) setMonitoring(snapshot) }).catch(() => {})
    const unsubscribe = marketBridge.onMonitoringChanged((snapshot) => { if (active) setMonitoring(snapshot) })
    const unsubscribeOpenMonitoring = marketBridge.onOpenMonitoring(() => { if (active) setView('monitoring') })
    return () => { active = false; unsubscribe(); unsubscribeOpenMonitoring() }
  }, [marketBridge])

  const armedCount = monitoring?.targets.filter((target) => target.connectionStatus !== 'disabled').length || 0
  const connectedCount = monitoring?.targets.filter((target) => target.connectionStatus === 'connected').length || 0
  const pendingCount = monitoring?.targets.reduce((total, target) => total + target.pendingOpportunityCount, 0) || 0
  return <>
    <header className="workbench-header market-shell-header">
      <div className="app-command-bar">
        <div className="app-brand" aria-label={SUPERPOE_NAME}>
          <img className="app-brand-logo" src="/assets/ui/superpoe2-logo.png" alt="" />
          <span><strong>{SUPERPOE_NAME}</strong><small>{SUPERPOE_VERSION_LABEL}</small></span>
        </div>
        <div className="market-shell-title">
          <button className="icon-command compact" onClick={onBack} title={zh ? '返回构筑中心' : 'Back to build center'} aria-label={zh ? '返回构筑中心' : 'Back to build center'}><ArrowLeft /></button>
          <span><strong>{zh ? '官方集市' : 'Official Market'}</strong><small>{zh ? '浏览和收藏官方交易装备' : 'Browse official trade listings'}</small></span>
          <GameRuntimeIndicator />
        </div>
        <div className="command-actions">
          <button className="icon-command" onClick={onSettings} title={zh ? '全局设置' : 'Global settings'} aria-label={zh ? '全局设置' : 'Global settings'}><Settings /></button>
        </div>
      </div>
      <div className="workspace-tabs-bar">
        <nav className="workspace-tabs" aria-label={zh ? '应用工作区' : 'Application workspace'}>
          <button className={view === 'market' ? 'active' : ''} aria-current={view === 'market' ? 'page' : undefined} onClick={() => setView('market')}><Store /><span>{zh ? '集市与仓库' : 'Market & Library'}</span></button>
          <button className={view === 'monitoring' ? 'active' : ''} aria-current={view === 'monitoring' ? 'page' : undefined} onClick={() => setView('monitoring')}><BellRing /><span>{zh ? '实时监控' : 'Live Monitoring'}</span>{monitoring && <small className="monitoring-tab-count" title={zh ? `已连接 ${connectedCount}/${armedCount}，待处理 ${pendingCount}` : `${connectedCount}/${armedCount} connected, ${pendingCount} pending`}>{connectedCount}/{armedCount} · {pendingCount}</small>}</button>
        </nav>
      </div>
    </header>
    <main className="workspace-view">{view === 'market' ? <MarketPanel realm={realm} suspended={suspended} /> : <MonitoringWorkspace zh={zh} />}</main>
  </>
}

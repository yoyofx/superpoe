import { ArrowLeft, Settings, Store } from 'lucide-react'
import { MarketPanel } from '@/components/market/MarketPanel'
import { SUPERPOE_NAME, SUPERPOE_VERSION_LABEL } from '@/engine/appVersion'
import { useTranslation } from '@/i18n/useTranslation'
import type { BuildRealm } from '@/types/tree'

interface MarketShellProps {
  realm: BuildRealm
  suspended?: boolean
  onBack: () => void
  onSettings: () => void
}
export function MarketShell({ realm, suspended, onBack, onSettings }: MarketShellProps) {
  const { lang } = useTranslation()
  const zh = lang === 'zh-rCN'
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
        </div>
        <div className="command-actions">
          <button className="icon-command" onClick={onSettings} title={zh ? '全局设置' : 'Global settings'} aria-label={zh ? '全局设置' : 'Global settings'}><Settings /></button>
        </div>
      </div>
      <div className="workspace-tabs-bar">
        <nav className="workspace-tabs" aria-label={zh ? '应用工作区' : 'Application workspace'}>
          <button className="active" aria-current="page"><Store /><span>{zh ? '集市' : 'Market'}</span></button>
        </nav>
      </div>
    </header>
    <main className="workspace-view"><MarketPanel realm={realm} suspended={suspended} /></main>
  </>
}

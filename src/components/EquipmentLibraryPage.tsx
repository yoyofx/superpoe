import { ArrowLeft, Settings } from 'lucide-react'
import { EquipmentLibraryWorkspace } from '@/components/market/EquipmentLibraryWorkspace'
import { GameRuntimeIndicator } from '@/components/GameRuntimeIndicator'
import { SUPERPOE_NAME, SUPERPOE_VERSION_LABEL } from '@/engine/appVersion'
import { useTranslation } from '@/i18n/useTranslation'
import type { BuildRealm } from '@/types/tree'

interface EquipmentLibraryPageProps {
  realm: BuildRealm
  onCenter: () => void
  onSettings: () => void
}

export function EquipmentLibraryPage({ realm, onCenter, onSettings }: EquipmentLibraryPageProps) {
  const { lang } = useTranslation()
  const zh = lang === 'zh-rCN'
  return <>
    <header className="workbench-header equipment-library-shell-header">
      <div className="app-command-bar">
        <div className="app-brand" aria-label={SUPERPOE_NAME}>
          <img className="app-brand-logo" src="/assets/ui/superpoe2-logo.png" alt="" />
          <span><strong>{SUPERPOE_NAME}</strong><small>{SUPERPOE_VERSION_LABEL}</small></span>
        </div>
        <div className="market-shell-title">
          <button className="icon-command compact" onClick={onCenter} title={zh ? '返回构筑中心' : 'Back to build center'} aria-label={zh ? '返回构筑中心' : 'Back to build center'}><ArrowLeft /></button>
          <span><strong>{zh ? '装备仓库' : 'Equipment Library'}</strong><small>{zh ? '目录管理、装备收藏与详情查看' : 'Directories, equipment favorites, and item details'}</small></span>
        </div>
        <div className="command-actions">
          <GameRuntimeIndicator />
          <button className="icon-command" onClick={onSettings} title={zh ? '全局设置' : 'Global settings'} aria-label={zh ? '全局设置' : 'Global settings'}><Settings /></button>
        </div>
      </div>
    </header>
    <main className="workspace-view equipment-library-shell-view">
      <EquipmentLibraryWorkspace realm={realm} zh={zh} />
    </main>
  </>
}

import { ArrowLeft, Settings } from 'lucide-react'
import { EquipmentLibraryWorkspace } from '@/components/market/EquipmentLibraryWorkspace'
import { GameRuntimeIndicator } from '@/components/GameRuntimeIndicator'
import { SUPERPOE_NAME, SUPERPOE_VERSION_LABEL } from '@/engine/appVersion'
import { useTranslation } from '@/i18n/useTranslation'
import type { BuildRealm } from '@/types/tree'
import { uiText } from '@/i18n/uiLocale'

interface EquipmentLibraryPageProps {
  realm: BuildRealm
  onCenter: () => void
  onSettings: () => void
}

export function EquipmentLibraryPage({ realm, onCenter, onSettings }: EquipmentLibraryPageProps) {
  const { lang } = useTranslation()
  const l = (en: string, zhCN: string, zhTW: string, koKR: string) => uiText(lang, en, zhCN, zhTW, koKR)
  return <>
    <header className="workbench-header equipment-library-shell-header">
      <div className="app-command-bar">
        <div className="app-brand" aria-label={SUPERPOE_NAME}>
          <img className="app-brand-logo" src="/assets/ui/superpoe2-logo.png" alt="" />
          <span><strong>{SUPERPOE_NAME}</strong><small>{SUPERPOE_VERSION_LABEL}</small></span>
        </div>
        <div className="market-shell-title">
          <button className="icon-command compact" onClick={onCenter} title={l('Back to build center', '返回构筑中心', '返回構築中心', '빌드 센터로 돌아가기')} aria-label={l('Back to build center', '返回构筑中心', '返回構築中心', '빌드 센터로 돌아가기')}><ArrowLeft /></button>
          <span><strong>{l('Equipment Library', '装备仓库', '裝備倉庫', '장비 라이브러리')}</strong><small>{l('Market favorites, build imports, and custom items', '集市收藏、构建导入与自定义装备', '市集收藏、構築匯入與自訂裝備', '거래소 즐겨찾기, 빌드 가져오기 및 사용자 지정 장비')}</small></span>
        </div>
        <div className="command-actions">
          <GameRuntimeIndicator />
          <button className="icon-command" onClick={onSettings} title={l('Global settings', '全局设置', '全域設定', '전역 설정')} aria-label={l('Global settings', '全局设置', '全域設定', '전역 설정')}><Settings /></button>
        </div>
      </div>
    </header>
    <main className="workspace-view equipment-library-shell-view">
      <EquipmentLibraryWorkspace realm={realm} />
    </main>
  </>
}

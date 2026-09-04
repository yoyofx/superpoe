import { ArrowLeft, Headphones, Settings } from 'lucide-react'
import { EquipmentLibraryWorkspace } from '@/components/market/EquipmentLibraryWorkspace'
import { GameRuntimeIndicator } from '@/components/GameRuntimeIndicator'
import { SUPERPOE_NAME, SUPERPOE_VERSION_LABEL } from '@/engine/appVersion'
import { useTranslation } from '@/i18n/useTranslation'
import type { BuildRealm } from '@/types/tree'
import { uiText } from '@/i18n/uiLocale'
import { AccountStatus } from '@/components/AuthGate'

interface EquipmentLibraryPageProps {
  realm: BuildRealm
  onBack: () => void
  onSettings: () => void
  onCommunity: () => void
}

export function EquipmentLibraryPage({ realm, onBack, onSettings, onCommunity }: EquipmentLibraryPageProps) {
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
          <button className="icon-command compact" onClick={onBack} title={l('Back to previous page', '返回上一页', '返回上一頁', '이전 페이지로 돌아가기')} aria-label={l('Back to previous page', '返回上一页', '返回上一頁', '이전 페이지로 돌아가기')}><ArrowLeft /></button>
          <span><strong>{l('Equipment Library', '装备仓库', '裝備倉庫', '장비 라이브러리')}</strong><small>{l('Market favorites, build imports, and custom items', '集市收藏、构筑导入与自定义装备', '市集收藏、構築匯入與自訂裝備', '거래소 즐겨찾기, 빌드 가져오기 및 사용자 지정 장비')}</small></span>
        </div>
        <div className="command-actions">
          <GameRuntimeIndicator />
          <button className="icon-command" onClick={onCommunity} title={l('Open voice community', '打开语音社区', '開啟語音社群', '음성 커뮤니티 열기')} aria-label={l('Open voice community', '打开语音社区', '開啟語音社群', '음성 커뮤니티 열기')}><Headphones /></button>
          <button className="icon-command" onClick={onSettings} title={l('Global settings', '全局设置', '全域設定', '전역 설정')} aria-label={l('Global settings', '全局设置', '全域設定', '전역 설정')}><Settings /></button>
          <AccountStatus />
        </div>
      </div>
    </header>
    <main className="workspace-view equipment-library-shell-view">
      <EquipmentLibraryWorkspace realm={realm} />
    </main>
  </>
}

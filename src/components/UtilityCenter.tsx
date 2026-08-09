import { FileInput, Plus, Store, Wrench } from 'lucide-react'
import { BuildCenterNav } from '@/components/BuildCenter'
import { SUPERPOE_NAME, SUPERPOE_VERSION_LABEL } from '@/engine/appVersion'
import { useTranslation } from '@/i18n/useTranslation'
import { uiText } from '@/i18n/uiLocale'

interface UtilityCenterProps {
  onCenter: () => void
  onLibrary: () => void
  onTradeCenter: () => void
  onAbout: () => void
  onCreate: () => void
  onImport: () => void
}

export function UtilityCenter({ onCenter, onLibrary, onTradeCenter, onAbout, onCreate, onImport }: UtilityCenterProps) {
  const { lang } = useTranslation()
  const l = (en: string, zhCN: string, zhTW: string, koKR: string) => uiText(lang, en, zhCN, zhTW, koKR)
  return (
    <div className="build-center utility-center">
      <BuildCenterNav active="utilities" onCenter={onCenter} onLibrary={onLibrary} onTradeCenter={onTradeCenter} onUtilities={() => {}} onAbout={onAbout} />
      <header className="center-app-bar utility-center-header">
        <div className="build-center-page-heading">
          <Wrench aria-hidden="true" />
          <div><span>{l('WORKSPACE', '工作区', '工作區', '작업 공간')}</span><h1>{l('Utilities', '实用工具', '實用工具', '유틸리티')}</h1></div>
        </div>
      </header>
      <main className="build-center-content utility-center-content">
        <p className="utility-center-intro">{l('Common build actions and workspace entry points.', '常用构筑操作和工作区入口。', '常用構築操作與工作區入口。', '자주 사용하는 빌드 작업과 작업 공간을 엽니다.')}</p>
        <section className="utility-command-list" aria-label={l('Utilities', '实用工具', '實用工具', '유틸리티')}>
          <button className="utility-command" onClick={onCreate}>
            <span className="utility-command-icon"><Plus /></span>
            <span><strong>{l('New build', '新建构筑', '新增構築', '새 빌드')}</strong><small>{l('Start editing from a blank build', '从空白构筑开始编辑', '從空白構築開始編輯', '빈 빌드에서 편집을 시작합니다')}</small></span>
          </button>
          <button className="utility-command" onClick={onImport}>
            <span className="utility-command-icon"><FileInput /></span>
            <span><strong>{l('Import build', '导入构筑', '匯入構築', '빌드 가져오기')}</strong><small>{l('Import PoB Code or a WeGame share link', '导入 PoB Code 或 WeGame 分享链接', '匯入 PoB Code 或 WeGame 分享連結', 'PoB Code 또는 WeGame 공유 링크를 가져옵니다')}</small></span>
          </button>
          <button className="utility-command" onClick={onTradeCenter}>
            <span className="utility-command-icon"><Store /></span>
            <span><strong>{l('Trade center', '交易中心', '交易中心', '거래 센터')}</strong><small>{l('Open market, stash, and live monitoring', '打开集市、仓库和实时监控', '開啟市集、倉庫與即時監控', '거래소, 보관함 및 실시간 모니터링을 엽니다')}</small></span>
          </button>
        </section>
        <footer className="utility-center-footer">{SUPERPOE_NAME} · {SUPERPOE_VERSION_LABEL}</footer>
      </main>
    </div>
  )
}

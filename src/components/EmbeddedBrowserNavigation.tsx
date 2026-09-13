import { Archive, ArrowLeft, BookOpen, Headphones, Info, LayoutDashboard, Store } from 'lucide-react'

import { SUPERPOE_NAME } from '@/engine/appVersion'
import { uiText } from '@/i18n/uiLocale'
import { useTranslation } from '@/i18n/useTranslation'

export type EmbeddedBrowserModule = 'community' | 'reference'

interface EmbeddedBrowserNavigationProps {
  active: EmbeddedBrowserModule
  showModuleLinks?: boolean
  onBack: () => void
  onCenter: () => void
  onLibrary: () => void
  onTradeCenter: () => void
  onCommunity: () => void
  onReference: () => void
  onAbout: () => void
}

export function EmbeddedBrowserNavigation({
  active,
  showModuleLinks = true,
  onBack,
  onCenter,
  onLibrary,
  onTradeCenter,
  onCommunity,
  onReference,
  onAbout,
}: EmbeddedBrowserNavigationProps) {
  const { lang } = useTranslation()
  const l = (en: string, zhCN: string, zhTW: string, koKR: string) => uiText(lang, en, zhCN, zhTW, koKR)
  const entries = [
    { key: 'center', icon: LayoutDashboard, label: l('Builds', '构筑', '構築', '빌드'), title: l('Build center', '构筑中心', '構築中心', '빌드 센터'), onClick: onCenter },
    { key: 'library', icon: Archive, label: l('Library', '仓库', '倉庫', '보관함'), title: l('Equipment library', '装备仓库', '裝備倉庫', '장비 라이브러리'), onClick: onLibrary },
    { key: 'trade', icon: Store, label: l('Trade', '交易', '交易', '거래'), title: l('Trade center', '交易中心', '交易中心', '거래 센터'), onClick: onTradeCenter },
    { key: 'community', icon: Headphones, label: l('Community', '社区', '社群', '커뮤니티'), title: l('Voice community', '语音社区', '語音社群', '음성 커뮤니티'), onClick: onCommunity },
    { key: 'reference', icon: BookOpen, label: l('Reference', '资料', '資料', '참고'), title: l('Reference', '资料参考', '資料參考', '참고 자료'), onClick: onReference },
    { key: 'about', icon: Info, label: l('About', '关于', '關於', '정보'), title: l('About SuperPoE', '关于 SuperPoE', '關於 SuperPoE', 'SuperPoE 정보'), onClick: onAbout },
  ] as const

  return (
    <div className="embedded-browser-app-navigation" aria-label={l('SuperPoE navigation', 'SuperPoE 导航', 'SuperPoE 導覽', 'SuperPoE 탐색')}>
      <button className="embedded-browser-back" type="button" onClick={onBack} title={l('Back to previous page', '返回上一页', '返回上一頁', '이전 페이지로 돌아가기')} aria-label={l('Back to previous page', '返回上一页', '返回上一頁', '이전 페이지로 돌아가기')}>
        <ArrowLeft aria-hidden="true" />
        <span>{l('Back', '返回', '返回', '뒤로')}</span>
      </button>
      {showModuleLinks && <span className="embedded-browser-nav-divider" aria-hidden="true" />}
      <span className="embedded-browser-app-name" title={SUPERPOE_NAME}>{SUPERPOE_NAME}</span>
      {showModuleLinks && <nav className="embedded-browser-module-links" aria-label={l('App modules', '应用模块', '應用模組', '앱 모듈')}>
        {entries.map(({ key, icon: Icon, label, title, onClick }) => (
          <button key={key} type="button" className={`embedded-browser-module-link${active === key ? ' active' : ''}`} onClick={onClick} aria-current={active === key ? 'page' : undefined} title={title}>
            <Icon aria-hidden="true" />
            <span>{label}</span>
          </button>
        ))}
      </nav>}
    </div>
  )
}

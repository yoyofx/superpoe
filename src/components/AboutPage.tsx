import { Info } from 'lucide-react'
import { BuildCenterNav } from '@/components/BuildCenter'
import { SUPERPOE_NAME, SUPERPOE_VERSION_LABEL } from '@/engine/appVersion'
import { useTranslation } from '@/i18n/useTranslation'
import { uiText } from '@/i18n/uiLocale'

interface AboutPageProps {
  onCenter: () => void
  onLibrary: () => void
  onTradeCenter: () => void
  onUtilities: () => void
}

export function AboutPage({ onCenter, onLibrary, onTradeCenter, onUtilities }: AboutPageProps) {
  const { lang } = useTranslation()
  const l = (en: string, zhCN: string, zhTW: string, koKR: string) => uiText(lang, en, zhCN, zhTW, koKR)
  return (
    <div className="build-center about-page">
      <BuildCenterNav active="about" onCenter={onCenter} onLibrary={onLibrary} onTradeCenter={onTradeCenter} onUtilities={onUtilities} onAbout={() => {}} />
      <header className="center-app-bar about-page-header">
        <div className="build-center-page-heading">
          <Info aria-hidden="true" />
          <div><span>{l('APPLICATION', '应用信息', '應用程式資訊', '애플리케이션')}</span><h1>{l('About', '关于', '關於', '정보')}</h1></div>
        </div>
      </header>
      <main className="build-center-content about-page-content">
        <section className="about-summary">
          <img src="/assets/ui/superpoe2-logo.png" alt="" />
          <div><h2>{SUPERPOE_NAME}</h2><p>{l('Path of Exile 2 build analysis and management tool', 'Path of Exile 2 构筑分析与管理工具', 'Path of Exile 2 構築分析與管理工具', 'Path of Exile 2 빌드 분석 및 관리 도구')}</p></div>
        </section>
        <dl className="about-details">
          <div><dt>{l('Application version', '应用版本', '應用程式版本', '애플리케이션 버전')}</dt><dd>{SUPERPOE_VERSION_LABEL}</dd></div>
          <div><dt>{l('Game version', '游戏版本', '遊戲版本', '게임 버전')}</dt><dd>PoE2 0.5.0</dd></div>
          <div><dt>{l('Calculation engine', '计算引擎', '計算引擎', '계산 엔진')}</dt><dd>PoB Lua Runtime</dd></div>
        </dl>
      </main>
    </div>
  )
}

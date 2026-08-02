import { Info } from 'lucide-react'
import { BuildCenterNav } from '@/components/BuildCenter'
import { SUPERPOE_NAME, SUPERPOE_VERSION_LABEL } from '@/engine/appVersion'
import { useTranslation } from '@/i18n/useTranslation'

interface AboutPageProps {
  onCenter: () => void
  onTradeCenter: () => void
  onUtilities: () => void
}

export function AboutPage({ onCenter, onTradeCenter, onUtilities }: AboutPageProps) {
  const { lang } = useTranslation()
  const zh = lang === 'zh-rCN'
  return (
    <div className="build-center about-page">
      <BuildCenterNav active="about" onCenter={onCenter} onTradeCenter={onTradeCenter} onUtilities={onUtilities} onAbout={() => {}} />
      <header className="center-app-bar about-page-header">
        <div className="build-center-page-heading">
          <Info aria-hidden="true" />
          <div><span>{zh ? '应用信息' : 'APPLICATION'}</span><h1>{zh ? '关于' : 'About'}</h1></div>
        </div>
      </header>
      <main className="build-center-content about-page-content">
        <section className="about-summary">
          <img src="/assets/ui/superpoe2-logo.png" alt="" />
          <div><h2>{SUPERPOE_NAME}</h2><p>{zh ? 'Path of Exile 2 构筑分析与管理工具' : 'Path of Exile 2 build analysis and management tool'}</p></div>
        </section>
        <dl className="about-details">
          <div><dt>{zh ? '应用版本' : 'Application version'}</dt><dd>{SUPERPOE_VERSION_LABEL}</dd></div>
          <div><dt>{zh ? '游戏版本' : 'Game version'}</dt><dd>PoE2 0.5.0</dd></div>
          <div><dt>{zh ? '计算引擎' : 'Calculation engine'}</dt><dd>PoB Lua Runtime</dd></div>
        </dl>
      </main>
    </div>
  )
}

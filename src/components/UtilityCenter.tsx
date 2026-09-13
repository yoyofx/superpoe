import { BookOpen, ExternalLink, Headphones } from 'lucide-react'
import { BuildCenterNav } from '@/components/BuildCenter'
import { SUPERPOE_NAME, SUPERPOE_VERSION_LABEL } from '@/engine/appVersion'
import { useTranslation } from '@/i18n/useTranslation'
import { uiText } from '@/i18n/uiLocale'
import { AccountStatus } from '@/components/AuthGate'

interface UtilityCenterProps {
  onCenter: () => void
  onLibrary: () => void
  onTradeCenter: () => void
  onCommunity: () => void
  onAbout: () => void
  onNinja: () => void
  onPoe2db: () => void
}

export function UtilityCenter({ onCenter, onLibrary, onTradeCenter, onCommunity, onAbout, onNinja, onPoe2db }: UtilityCenterProps) {
  const { lang } = useTranslation()
  const l = (en: string, zhCN: string, zhTW: string, koKR: string) => uiText(lang, en, zhCN, zhTW, koKR)
  return (
    <div className="build-center utility-center">
      <BuildCenterNav active="reference" onCenter={onCenter} onLibrary={onLibrary} onTradeCenter={onTradeCenter} onCommunity={onCommunity} onReference={() => {}} onAbout={onAbout} />
      <header className="center-app-bar utility-center-header">
        <div className="center-actions utility-center-actions"><button type="button" className="icon-command toolbar-community-button" onClick={onCommunity} title={l('Open voice community', '打开语音社区', '開啟語音社群', '음성 커뮤니티 열기')} aria-label={l('Open voice community', '打开语音社区', '開啟語音社群', '음성 커뮤니티 열기')}><Headphones /></button><AccountStatus /></div>
        <div className="build-center-page-heading">
          <BookOpen aria-hidden="true" />
          <div><span>{l('REFERENCE', '资料参考', '資料參考', '참고 자료')}</span><h1>{l('Reference', '资料参考', '資料參考', '참고 자료')}</h1></div>
        </div>
      </header>
      <main className="build-center-content utility-center-content">
        <p className="utility-center-intro">{l('External resources for build planning and game data.', '用于构筑规划和游戏资料查询的外部资源。', '用於構築規劃與遊戲資料查詢的外部資源。', '빌드 계획과 게임 정보를 위한 외부 리소스입니다.')}</p>
        <section className="utility-command-list" aria-label={l('Reference websites', '资料参考网站', '資料參考網站', '참고 웹사이트')}>
          <button className="utility-command reference-command" onClick={onNinja}>
            <span className="utility-command-icon"><BookOpen /></span>
            <span><strong>{l('Ninja builds', '忍者网', '忍者網', '닌자 빌드')}</strong><small>{l('Global PoE2 build reference', '全球 PoE2 构筑参考', '全球 PoE2 構築參考', '전 세계 PoE2 빌드 참고')}</small></span>
            <ExternalLink className="utility-command-arrow" aria-hidden="true" />
          </button>
          <button className="utility-command reference-command" onClick={onPoe2db}>
            <span className="utility-command-icon"><BookOpen /></span>
            <span><strong>{l('PoE2DB', '编年史', '編年史', 'PoE2DB')}</strong><small>{l('PoE2 game encyclopedia', 'PoE2 游戏百科资料', 'PoE2 遊戲百科資料', 'PoE2 게임 백과사전')}</small></span>
            <ExternalLink className="utility-command-arrow" aria-hidden="true" />
          </button>
        </section>
        <footer className="utility-center-footer">{SUPERPOE_NAME} · {SUPERPOE_VERSION_LABEL}</footer>
      </main>
    </div>
  )
}

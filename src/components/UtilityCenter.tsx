import { FileInput, Plus, Store, Wrench } from 'lucide-react'
import { BuildCenterNav } from '@/components/BuildCenter'
import { SUPERPOE_NAME, SUPERPOE_VERSION_LABEL } from '@/engine/appVersion'
import { useTranslation } from '@/i18n/useTranslation'

interface UtilityCenterProps {
  onCenter: () => void
  onTradeCenter: () => void
  onAbout: () => void
  onCreate: () => void
  onImport: () => void
}

export function UtilityCenter({ onCenter, onTradeCenter, onAbout, onCreate, onImport }: UtilityCenterProps) {
  const { lang } = useTranslation()
  const zh = lang === 'zh-rCN'
  return (
    <div className="build-center utility-center">
      <BuildCenterNav active="utilities" onCenter={onCenter} onTradeCenter={onTradeCenter} onUtilities={() => {}} onAbout={onAbout} />
      <header className="center-app-bar utility-center-header">
        <div className="build-center-page-heading">
          <Wrench aria-hidden="true" />
          <div><span>{zh ? '工作区' : 'WORKSPACE'}</span><h1>{zh ? '实用工具' : 'Utilities'}</h1></div>
        </div>
      </header>
      <main className="build-center-content utility-center-content">
        <p className="utility-center-intro">{zh ? '常用构筑操作和工作区入口。' : 'Common build actions and workspace entry points.'}</p>
        <section className="utility-command-list" aria-label={zh ? '实用工具' : 'Utilities'}>
          <button className="utility-command" onClick={onCreate}>
            <span className="utility-command-icon"><Plus /></span>
            <span><strong>{zh ? '新建构筑' : 'New build'}</strong><small>{zh ? '从空白构筑开始编辑' : 'Start editing from a blank build'}</small></span>
          </button>
          <button className="utility-command" onClick={onImport}>
            <span className="utility-command-icon"><FileInput /></span>
            <span><strong>{zh ? '导入构筑' : 'Import build'}</strong><small>{zh ? '导入 PoB Code 或本地构筑数据' : 'Import PoB Code or local build data'}</small></span>
          </button>
          <button className="utility-command" onClick={onTradeCenter}>
            <span className="utility-command-icon"><Store /></span>
            <span><strong>{zh ? '交易中心' : 'Trade center'}</strong><small>{zh ? '打开集市、仓库和实时监控' : 'Open market, stash, and live monitoring'}</small></span>
          </button>
        </section>
        <footer className="utility-center-footer">{SUPERPOE_NAME} · {SUPERPOE_VERSION_LABEL}</footer>
      </main>
    </div>
  )
}

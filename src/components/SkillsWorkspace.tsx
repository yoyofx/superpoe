import { useState } from 'react'
import { SlidersHorizontal, Sparkles } from 'lucide-react'
import { ConfigurationPanel } from '@/components/ConfigurationPanel'
import { SkillsPanel } from '@/components/SkillsPanel'
import { useTranslation } from '@/i18n/useTranslation'
import { uiText } from '@/i18n/uiLocale'

type SkillsWorkspacePage = 'groups' | 'configuration'

export function SkillsWorkspace() {
  const { lang } = useTranslation()
  const l = (en: string, zhCN: string, zhTW: string, koKR: string) => uiText(lang, en, zhCN, zhTW, koKR)
  const [page, setPage] = useState<SkillsWorkspacePage>('groups')

  return <section className="skills-module">
    <nav className="skills-module-tabs" aria-label={l('Skills workspace', '技能工作区', '技能工作區', '스킬 작업 영역')}>
      <button
        type="button"
        className={page === 'groups' ? 'active' : ''}
        aria-pressed={page === 'groups'}
        onClick={() => setPage('groups')}
      ><Sparkles />{l('Skill groups', '技能组', '技能組', '스킬 그룹')}</button>
      <button
        type="button"
        className={page === 'configuration' ? 'active' : ''}
        aria-pressed={page === 'configuration'}
        onClick={() => setPage('configuration')}
      ><SlidersHorizontal />{l('Damage configuration', '伤害配置', '傷害設定', '피해 설정')}</button>
    </nav>
    <div className="skills-module-content">
      {page === 'groups' ? <SkillsPanel /> : <ConfigurationPanel />}
    </div>
  </section>
}

import { useState } from 'react'
import { SlidersHorizontal, Sparkles } from 'lucide-react'
import { ConfigurationPanel } from '@/components/ConfigurationPanel'
import { SkillsPanel } from '@/components/SkillsPanel'
import { useTranslation } from '@/i18n/useTranslation'

type SkillsWorkspacePage = 'groups' | 'configuration'

export function SkillsWorkspace() {
  const { lang } = useTranslation()
  const zh = lang === 'zh-rCN'
  const [page, setPage] = useState<SkillsWorkspacePage>('groups')

  return <section className="skills-module">
    <nav className="skills-module-tabs" aria-label={zh ? '技能工作区' : 'Skills workspace'}>
      <button
        type="button"
        className={page === 'groups' ? 'active' : ''}
        aria-pressed={page === 'groups'}
        onClick={() => setPage('groups')}
      ><Sparkles />{zh ? '技能组' : 'Skill groups'}</button>
      <button
        type="button"
        className={page === 'configuration' ? 'active' : ''}
        aria-pressed={page === 'configuration'}
        onClick={() => setPage('configuration')}
      ><SlidersHorizontal />{zh ? '伤害配置' : 'Damage configuration'}</button>
    </nav>
    <div className="skills-module-content">
      {page === 'groups' ? <SkillsPanel /> : <ConfigurationPanel />}
    </div>
  </section>
}

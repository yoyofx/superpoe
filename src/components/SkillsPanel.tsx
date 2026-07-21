import { useEffect, useMemo, useState } from 'react'
import { Check, Sparkles } from 'lucide-react'
import { decodeCodeToXml } from '@/engine/buildCode'
import { loadItemIconIndex, resolveItemIconName, type ItemIconIndex } from '@/engine/itemIcons'
import { parseSkillsXml } from '@/engine/skills'
import { translateGameText } from '@/i18n/translationLoader'
import { useTranslation } from '@/i18n/useTranslation'
import { useTreeStore } from '@/store/treeStore'

export function SkillsPanel() {
  const { lang } = useTranslation()
  const importedBuildCode = useTreeStore((state) => state.importedBuildCode)
  const [selectedId, setSelectedId] = useState('1')
  const [iconIndex, setIconIndex] = useState<ItemIconIndex | null>(null)
  const zh = lang === 'zh-rCN'

  useEffect(() => {
    let mounted = true
    loadItemIconIndex().then((index) => mounted && setIconIndex(index))
    return () => { mounted = false }
  }, [])

  const skills = useMemo(() => {
    if (!importedBuildCode) return { activeSkillSetId: '', groups: [] }
    try { return parseSkillsXml(decodeCodeToXml(importedBuildCode)) } catch { return { activeSkillSetId: '', groups: [] } }
  }, [importedBuildCode])
  const selected = skills.groups.find((group) => group.id === selectedId) || skills.groups[0]

  if (!selected) return <section className="workspace-empty"><Sparkles /><h2>{zh ? '没有技能数据' : 'No skill data'}</h2><p>{zh ? '导入完整 PoB2 构筑后，这里会显示独立的技能组。' : 'Import a complete PoB2 build to view skill groups.'}</p></section>

  const mainGem = selected.gems[0]
  const supports = selected.gems.slice(1)
  return <section className="skills-workspace">
    <aside className="skill-groups-panel">
      <header><span>{zh ? '技能组' : 'Skill groups'}</span><strong>{skills.groups.length}</strong></header>
      <div>{skills.groups.map((group) => {
        const main = group.gems[0]
        const label = translateGameText(main.name, lang)
        const image = resolveItemIconName(main.name, iconIndex)
        return <button key={group.id} className={group.id === selected.id ? 'active' : ''} onClick={() => setSelectedId(group.id)}>{image ? <img src={image} alt="" /> : <span>{label.slice(0, 1)}</span>}<span><strong>{label}</strong><small>{Math.max(0, group.gems.length - 1)} {zh ? '个辅助' : 'supports'}</small></span>{group.enabled && <Check />}</button>
      })}</div>
    </aside>
    <div className="skill-link-stage">
      <header><span>{zh ? '当前技能组' : 'Current skill group'}</span><small>{selected.enabled ? (zh ? '已启用' : 'Enabled') : (zh ? '已禁用' : 'Disabled')}</small></header>
      <div className="skill-stage-frame">
        <div className="main-skill-node">{resolveItemIconName(mainGem.name, iconIndex) ? <img src={resolveItemIconName(mainGem.name, iconIndex)} alt="" /> : <Sparkles />}<strong>{translateGameText(mainGem.name, lang)}</strong><small>Lv. {mainGem.level} · Q {mainGem.quality}%</small></div>
        <div className="support-link-line" />
        <div className="support-skill-grid">{supports.map((gem, index) => {
          const image = resolveItemIconName(gem.name, iconIndex)
          return <div key={`${gem.skillId}-${index}`}>{image ? <img src={image} alt="" /> : <span>{gem.name.slice(0, 1)}</span>}<strong>{translateGameText(gem.name, lang)}</strong><small>Lv. {gem.level} · Q {gem.quality}%</small></div>
        })}</div>
      </div>
    </div>
    <aside className="skill-inspector">
      <header><span>{zh ? '技能详情' : 'Skill details'}</span><h2>{translateGameText(mainGem.name, lang)}</h2></header>
      <dl><div><dt>{zh ? '等级' : 'Level'}</dt><dd>{mainGem.level}</dd></div><div><dt>{zh ? '品质' : 'Quality'}</dt><dd>{mainGem.quality}%</dd></div><div><dt>{zh ? '变体' : 'Variant'}</dt><dd>{mainGem.variantId || '-'}</dd></div><div><dt>{zh ? '计算关联' : 'Calculation'}</dt><dd>{selected.includeInFullDps ? (zh ? '计入完整 DPS' : 'Included in Full DPS') : (zh ? '主技能计算' : 'Main skill')}</dd></div></dl>
      <div className="skill-inspector-section"><h3>{zh ? '辅助技能' : 'Support skills'}</h3>{supports.map((gem, index) => <p key={`${gem.gemId}-${index}`}><span>{translateGameText(gem.name, lang)}</span><small>Lv. {gem.level}</small></p>)}</div>
    </aside>
  </section>
}

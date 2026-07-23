import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
} from 'react'
import { Sparkles } from 'lucide-react'
import { FallbackImage } from '@/components/FallbackImage'
import { GemTooltip, type GemTooltipTarget } from '@/components/GemTooltip'
import { decodeCodeToXml } from '@/engine/buildCode'
import {
  getLocalizedSkillDescription,
  getLocalizedSkillName,
  getLocalizedSkillTags,
  loadSkillCatalog,
  resolveSkillCatalogEntry,
  type SkillCatalog,
} from '@/engine/skillCatalog'
import { parseSkillsXml } from '@/engine/skills'
import { translateGameText } from '@/i18n/translationLoader'
import { useTranslation } from '@/i18n/useTranslation'
import { useTreeStore } from '@/store/treeStore'

const SKILL_PANEL_WIDTH = 1540
const SKILL_PANEL_HEIGHT = 1200

interface SkillPanelSize {
  width: number
  height: number
  scale: number
}

type SkillPanelStyle = CSSProperties & { '--skill-panel-scale': string }

function useSkillPanelSize(enabled: boolean) {
  const hostRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState<SkillPanelSize>({ width: 0, height: 0, scale: 0 })

  useLayoutEffect(() => {
    if (!enabled) return
    const host = hostRef.current
    if (!host) return
    const update = () => {
      const scale = Math.min(
        Math.max(0, host.clientWidth - 16) / SKILL_PANEL_WIDTH,
        Math.max(0, host.clientHeight - 16) / SKILL_PANEL_HEIGHT,
        1,
      )
      setSize({
        width: SKILL_PANEL_WIDTH * scale,
        height: SKILL_PANEL_HEIGHT * scale,
        scale,
      })
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(host)
    return () => observer.disconnect()
  }, [enabled])

  return { hostRef, size }
}

export function SkillsPanel() {
  const { lang } = useTranslation()
  const importedBuildCode = useTreeStore((state) => state.importedBuildCode)
  const [selectedId, setSelectedId] = useState('1')
  const [catalog, setCatalog] = useState<SkillCatalog | null>(null)
  const [tooltip, setTooltip] = useState<GemTooltipTarget | null>(null)
  const zh = lang === 'zh-rCN'

  useEffect(() => {
    let mounted = true
    loadSkillCatalog().then((value) => mounted && setCatalog(value))
    return () => { mounted = false }
  }, [])

  const buildXml = useMemo(() => {
    if (!importedBuildCode) return ''
    try {
      return decodeCodeToXml(importedBuildCode)
    } catch {
      return ''
    }
  }, [importedBuildCode])
  const skills = useMemo(() => buildXml
    ? parseSkillsXml(buildXml)
    : { activeSkillSetId: '', groups: [] }, [buildXml])
  const selected = skills.groups.find((group) => group.id === selectedId) || skills.groups[0]
  const { hostRef, size: panelSize } = useSkillPanelSize(Boolean(selected))

  const showTooltip = (
    event: MouseEvent<HTMLElement>,
    gem: NonNullable<typeof selected>['gems'][number],
    detail: ReturnType<typeof resolveSkillCatalogEntry>,
  ) => setTooltip({ gem, detail, x: event.clientX, y: event.clientY })

  if (!selected) {
    return <section className="workspace-empty">
      <Sparkles />
      <h2>{zh ? '没有技能数据' : 'No skill data'}</h2>
      <p>{zh ? '导入完整 PoB2 构筑后，这里会显示独立的技能组。' : 'Import a complete PoB2 build to view skill groups.'}</p>
    </section>
  }

  return <section className="skills-workspace">
    <div className="skill-groups-stage">
      <header><span>{zh ? '技能组' : 'Skill groups'}</span><strong>{skills.groups.length}</strong></header>
      <div className="skill-panel-host" ref={hostRef}>
        <div
          className="skill-panel-frame"
          style={panelSize.scale > 0 ? {
            width: panelSize.width,
            height: panelSize.height,
            '--skill-panel-scale': String(panelSize.scale),
          } as SkillPanelStyle : undefined}
        >
          <div className="skill-group-rows">{skills.groups.map((group) => {
        const main = group.gems[0]
        const groupSupports = group.gems.slice(1)
        const mainDetail = resolveSkillCatalogEntry(main, catalog)
        const label = getLocalizedSkillName(main, mainDetail, lang)
        return <article
          key={group.id}
          className={`skill-group-row${group.id === selected.id ? ' active' : ''}${group.enabled ? '' : ' disabled'}`}
          role="button"
          tabIndex={0}
          aria-pressed={group.id === selected.id}
          onClick={() => setSelectedId(group.id)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault()
              setSelectedId(group.id)
            }
          }}
        >
          <div className="skill-row-intro">
            <div
              className="skill-row-main-icon"
              onMouseEnter={(event) => showTooltip(event, main, mainDetail)}
              onMouseLeave={() => setTooltip(null)}
            >
              <FallbackImage src={mainDetail?.icon || undefined} alt="" fallback={<Sparkles />} />
            </div>
            <div className="skill-group-copy">
              <strong>{label}</strong>
              <small>{zh ? `等级 ${main.level}${main.level >= 20 ? '（最高等级）' : ''}` : `Level ${main.level}${main.level >= 20 ? ' (Max Level)' : ''}`}</small>
            </div>
          </div>
          <div className="skill-row-gems">
            <div className="skill-row-primary-placeholder" aria-hidden="true" />
            {Array.from({ length: 5 }, (_, index) => {
              const gem = groupSupports[index]
              if (!gem) return <div className="skill-row-support-slot empty" key={`empty-${index}`} />
              const detail = resolveSkillCatalogEntry(gem, catalog)
              const supportName = getLocalizedSkillName(gem, detail, lang)
              return <div
                className="skill-row-support-slot"
                key={`${gem.skillId}-${index}`}
                title={supportName}
                onMouseEnter={(event) => showTooltip(event, gem, detail)}
                onMouseLeave={() => setTooltip(null)}
              >
                <FallbackImage src={detail?.icon || undefined} alt="" fallback={<span>{supportName.slice(0, 1)}</span>} />
              </div>
            })}
          </div>
            </article>
          })}</div>
        </div>
      </div>
    </div>

    <aside className="skill-inspector">{(() => {
      const mainGem = selected.gems[0]
      const mainSkill = resolveSkillCatalogEntry(mainGem, catalog)
      const supports = selected.gems.slice(1)
      const mainName = getLocalizedSkillName(mainGem, mainSkill, lang)
      const description = getLocalizedSkillDescription(mainSkill, lang)
      const tags = getLocalizedSkillTags(mainSkill, lang)
      return <>
      <header>
        <div className="skill-inspector-icon">
          <FallbackImage src={mainSkill?.icon || undefined} alt="" fallback={<Sparkles />} />
        </div>
        <div>
          <span>{zh ? '技能详情' : 'Skill details'}</span>
          <h2>{mainName}</h2>
          <small>{translateGameText(mainSkill?.gemType || (mainSkill?.type === 'support' ? 'Support' : 'Skill Gem'), lang)}</small>
        </div>
      </header>
      <div className="skill-inspector-scroll">
        <section className="skill-inspector-overview">
          {description
            ? <p className="skill-description">{description}</p>
            : <p className="skill-description muted">{zh ? '上游暂无技能描述' : 'No upstream description available'}</p>}
          {!!tags.length && <div className="skill-tags">
            {tags.map((tag) => <span key={tag}>{tag}</span>)}
          </div>}
          <dl>
            <div><dt>{zh ? '等级' : 'Level'}</dt><dd>{mainGem.level}</dd></div>
            <div><dt>{zh ? '品质' : 'Quality'}</dt><dd>{mainGem.quality}%</dd></div>
            <div><dt>{zh ? '变体' : 'Variant'}</dt><dd>{mainGem.variantId || '-'}</dd></div>
            <div><dt>{zh ? '计算关联' : 'Calculation'}</dt><dd>{selected.includeInFullDps ? (zh ? '计入完整 DPS' : 'Included in Full DPS') : (zh ? '主技能计算' : 'Main skill')}</dd></div>
          </dl>
        </section>
        <section className="skill-inspector-section">
          <h3><span>{zh ? '辅助宝石' : 'Support gems'}</span><small>{supports.length}</small></h3>
          <div className="skill-support-list">{supports.map((gem, index) => {
            const detail = resolveSkillCatalogEntry(gem, catalog)
            const name = getLocalizedSkillName(gem, detail, lang)
            const supportDescription = getLocalizedSkillDescription(detail, lang)
            return <div
              className="skill-support-row"
              key={`${gem.gemId}-${index}`}
              onMouseEnter={(event) => showTooltip(event, gem, detail)}
              onMouseLeave={() => setTooltip(null)}
            >
              <FallbackImage src={detail?.icon || undefined} alt="" fallback={<span>{name.slice(0, 1)}</span>} />
              <div><strong>{name}</strong>{supportDescription && <p>{supportDescription}</p>}</div>
              <small>Lv. {gem.level}</small>
            </div>
          })}</div>
        </section>
      </div>
      </>
    })()}</aside>
    <GemTooltip target={tooltip} language={lang} />
  </section>
}

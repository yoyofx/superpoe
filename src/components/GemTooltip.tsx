import { useMemo, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { FallbackImage } from '@/components/FallbackImage'
import {
  getLocalizedSkillDescription,
  getLocalizedSkillName,
  type SkillCatalogEntry,
} from '@/engine/skillCatalog'
import type { BuildGem } from '@/engine/skills'
import { translateGameText, type Language } from '@/i18n/translationLoader'

export interface GemTooltipTarget {
  gem: BuildGem
  detail?: SkillCatalogEntry
  x: number
  y: number
}

interface GemTooltipProps {
  target: GemTooltipTarget | null
  language: Language
}

interface GemTooltipLine {
  kind: 'line' | 'separator'
  text?: string
  center?: boolean
  tone?: 'normal' | 'info' | 'magic' | 'description'
}

const POB_MARKUP = /\^x[0-9a-f]{6}|\^[0-9a-z]/gi

const SHORT_COLORS: Record<string, string> = {
  '0': '#000000',
  '1': '#dd0022',
  '2': '#33ff77',
  '3': '#8888ff',
  '4': '#ffff77',
  '5': '#af6025',
  '6': '#74cabf',
  '7': '#c8c8c8',
  '8': '#7f7f7f',
  '9': '#ffffff',
}

export function stripPobMarkup(value: string): string {
  return value.replace(POB_MARKUP, '').trim()
}

function buildDisplayLines(
  gem: BuildGem,
  detail: SkillCatalogEntry | undefined,
  language: Language,
): GemTooltipLine[] {
  const lines: GemTooltipLine[] = []
  if (detail?.tagString) lines.push({ kind: 'line', text: detail.tagString })
  const labels = language === 'zh-rCN'
    ? { category: '类别', tier: '阶级', level: '等级', max: '（最高等级）', quality: '品质' }
    : { category: 'Category', tier: 'Tier', level: 'Level', max: ' (Max)', quality: 'Quality' }
  if (detail?.gemFamily) lines.push({ kind: 'line', text: `${labels.category}: ${translateGameText(detail.gemFamily, language)}`, tone: 'info' })
  if (detail?.tier) lines.push({ kind: 'line', text: `${labels.tier}: ${detail.tier}`, tone: 'info' })
  const max = detail?.naturalMaxLevel != null && gem.level >= detail.naturalMaxLevel ? labels.max : ''
  lines.push({ kind: 'line', text: `${labels.level}: ${gem.level}${max}`, tone: 'info' })
  if (gem.quality > 0) lines.push({ kind: 'line', text: `${labels.quality}: +${gem.quality}%`, tone: 'magic' })
  const description = getLocalizedSkillDescription(detail, language)
  if (description) {
    lines.push({ kind: 'separator' })
    lines.push({ kind: 'line', text: description, center: true, tone: 'description' })
  }
  return lines
}

interface PobTextSegment {
  text: string
  color?: string
}

export function parsePobTextSegments(value: string): PobTextSegment[] {
  const segments: PobTextSegment[] = []
  let color: string | undefined
  let cursor = 0
  for (const match of value.matchAll(POB_MARKUP)) {
    const index = match.index ?? 0
    if (index > cursor) segments.push({ text: value.slice(cursor, index), color })
    const code = match[0]
    color = code.toLowerCase().startsWith('^x')
      ? `#${code.slice(2)}`
      : SHORT_COLORS[code.slice(1).toLowerCase()]
    cursor = index + code.length
  }
  if (cursor < value.length) segments.push({ text: value.slice(cursor), color })
  return segments
}

function renderPobLine(line: GemTooltipLine, language: Language): ReactNode {
  const raw = stripPobMarkup(line.text || '')
  const translated = translateGameText(raw, language)
  if (translated !== raw) return translated
  return parsePobTextSegments(line.text || '').map((segment, index) => (
    <span key={index} style={segment.color ? { color: segment.color } : undefined}>{segment.text}</span>
  ))
}

export function GemTooltip({ target, language }: GemTooltipProps) {
  const lines = useMemo(() => {
    if (!target) return []
    return buildDisplayLines(target.gem, target.detail, language)
  }, [language, target])

  if (!target) return null

  const detail = target.detail
  const name = getLocalizedSkillName(target.gem, detail, language)
  const gemType = translateGameText(detail?.gemType || (detail?.type === 'support' ? 'Support' : 'Skill Gem'), language)
  const left = Math.max(8, Math.min(target.x + 18, window.innerWidth - 608))
  const above = target.y > window.innerHeight * 0.58
  const top = above ? Math.max(8, target.y - 14) : Math.min(window.innerHeight - 8, target.y + 18)

  return createPortal(<div
    className={`gem-tooltip${above ? ' above' : ''}`}
    style={{ left, top }}
    role="tooltip"
  >
    <header className="gem-tooltip-header">
      <div className="gem-tooltip-icon">
        <FallbackImage src={detail?.icon || undefined} alt="" fallback={<span>{name.slice(0, 1)}</span>} />
        <img className="gem-tooltip-icon-frame" src="/assets/ui/skillpanelskilliconframe.png" alt="" />
      </div>
      <div><strong>{name}</strong><small>{gemType}</small></div>
    </header>
    <div className="gem-tooltip-body">
      {lines.map((line, index) => {
        if (line.kind === 'separator') return <div className="gem-tooltip-separator" key={index} />
        return <p
          className={`${line.tone || 'normal'}${line.center ? ' centered' : ''}`}
          key={index}
        >{renderPobLine(line, language)}</p>
      })}
    </div>
  </div>, document.body)
}

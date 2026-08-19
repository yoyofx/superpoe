import { Activity, CircleGauge, List, Tags } from 'lucide-react'
import { useEffect, useState, type RefObject } from 'react'
import { uiText } from '@/i18n/uiLocale'
import type { Language } from '@/i18n/translationLoader'

export type EquipmentDetailSectionId = 'properties' | 'requirements' | 'modifiers' | 'difference'

export interface EquipmentDetailQuickNavSection {
  id: EquipmentDetailSectionId
  targetRef: RefObject<HTMLElement | null>
  targetSelector?: string
}

interface EquipmentDetailQuickNavProps {
  containerRef: RefObject<HTMLDivElement | null>
  sections: EquipmentDetailQuickNavSection[]
  language: Language
}

const SECTION_ICONS = {
  properties: List,
  requirements: CircleGauge,
  modifiers: Tags,
  difference: Activity,
} as const

function sectionLabel(id: EquipmentDetailSectionId, language: Language): string {
  const labels: Record<EquipmentDetailSectionId, readonly [string, string, string, string]> = {
    properties: ['Item properties', '装备属性', '裝備屬性', '장비 속성'],
    requirements: ['Requirements', '装备需求', '裝備需求', '장비 요구 사항'],
    modifiers: ['Modifiers', '词缀', '詞綴', '속성'],
    difference: ['Difference conclusion', '差异结论', '差異結論', '차이 결론'],
  }
  return uiText(language, ...labels[id])
}

function resolveTarget(section: EquipmentDetailQuickNavSection): HTMLElement | null {
  const root = section.targetRef.current
  if (!root) return null
  if (!section.targetSelector) return root
  return root.querySelector<HTMLElement>(section.targetSelector) || root
}

function resolveScrollContainer(source: HTMLDivElement): HTMLElement {
  let current: HTMLElement | null = source
  while (current) {
    const overflowY = window.getComputedStyle(current).overflowY
    if (overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay') return current
    current = current.parentElement
  }
  return source
}

export function EquipmentDetailQuickNav({ containerRef, sections, language }: EquipmentDetailQuickNavProps) {
  const [activeId, setActiveId] = useState<EquipmentDetailSectionId>(sections[0]?.id || 'properties')
  const [canScroll, setCanScroll] = useState(false)

  useEffect(() => {
    const source = containerRef.current
    if (!source || sections.length < 2) {
      setCanScroll(false)
      return
    }
    const container = resolveScrollContainer(source)

    let frame = 0
    const sync = () => {
      if (frame) return
      frame = window.requestAnimationFrame(() => {
        frame = 0
        setCanScroll(container.scrollHeight > container.clientHeight + 24)
        const threshold = container.getBoundingClientRect().top + 18
        let nextActive = sections[0]?.id || 'properties'
        for (const section of sections) {
          const target = resolveTarget(section)
          if (target && target.getBoundingClientRect().top <= threshold) nextActive = section.id
        }
        setActiveId(nextActive)
      })
    }

    sync()
    container.addEventListener('scroll', sync, { passive: true })
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(sync) : null
    observer?.observe(container)
    sections.forEach((section) => {
      const target = resolveTarget(section)
      if (target) observer?.observe(target)
    })
    return () => {
      container.removeEventListener('scroll', sync)
      observer?.disconnect()
      if (frame) window.cancelAnimationFrame(frame)
    }
  }, [containerRef, sections])

  if (!canScroll || sections.length < 2) return null

  const quickNavigationLabel = uiText(language, 'Quick navigation', '快速定位', '快速定位', '빠른 이동')
  return <nav className="equipment-detail-quick-nav" aria-label={quickNavigationLabel}>
    <div className="equipment-detail-quick-nav-list">
      {sections.map((section) => {
        const Icon = SECTION_ICONS[section.id]
        const label = sectionLabel(section.id, language)
        return <button
          key={section.id}
          type="button"
          className={activeId === section.id ? 'active' : ''}
          aria-label={label}
          aria-current={activeId === section.id ? 'location' : undefined}
          title={label}
          onClick={() => {
            const source = containerRef.current
            const container = source ? resolveScrollContainer(source) : null
            const target = resolveTarget(section)
            if (!container || !target) return
            const containerRect = container.getBoundingClientRect()
            const targetRect = target.getBoundingClientRect()
            const top = Math.max(0, container.scrollTop + targetRect.top - containerRect.top - 12)
            container.scrollTo({ top, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
          }}
        ><Icon aria-hidden="true" /></button>
      })}
    </div>
  </nav>
}

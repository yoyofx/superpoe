import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  getLocalizedSkillDescription,
  getLocalizedSkillName,
  resolveSkillCatalogEntry,
  resolveSkillCatalogName,
  normalizeSkillCatalog,
  type SkillCatalog,
} from '@/engine/skillCatalog'

const catalog = JSON.parse(readFileSync('public/data/skill-catalog.json', 'utf8')) as SkillCatalog

describe('canonical skill catalog', () => {
  it('rejects malformed catalogues and removes dangling aliases', () => {
    const entryId = Object.keys(catalog.entries)[0]
    expect(normalizeSkillCatalog({ lookup: {} })).toBeNull()
    expect(normalizeSkillCatalog({ entries: { [entryId]: catalog.entries[entryId] }, lookup: { valid: entryId, missing: 'other' } })?.lookup)
      .toEqual({ valid: entryId })
  })

  it('gives every user-visible skill a local icon', () => {
    const visible = Object.values(catalog.entries).filter((entry) => entry.userVisible)
    expect(visible.length).toBeGreaterThan(900)
    for (const entry of visible) {
      expect(entry.icon, entry.id).toMatch(/^\/assets\//)
      expect(existsSync(`public${entry.icon}`), entry.id).toBe(true)
    }
  })

  it('resolves active and support gems by stable PoB identifiers', () => {
    expect(resolveSkillCatalogEntry({
      name: 'Unknown',
      skillId: 'SparkPlayer',
      gemId: '',
      variantId: '',
    }, catalog)?.name).toBe('Spark')
    expect(resolveSkillCatalogEntry({
      name: 'Unknown',
      skillId: 'SupportPiercePlayerThree',
      gemId: '',
      variantId: '',
    }, catalog)?.name).toBe('Pierce III')
  })

  it('contains upstream descriptions without inventing missing text', () => {
    expect(resolveSkillCatalogName('Spear Throw', catalog)?.description).toContain('Hurl your Spear')
    expect(resolveSkillCatalogName('Feeding Frenzy II', catalog)?.description).toBeFalsy()
  })

  it('contains localized descriptions for item-granted skills', () => {
    const skill = resolveSkillCatalogName('Acidic Concoction', catalog)
    expect(skill?.localizedNames?.['zh-rCN']).toBe('酸性灵药')
    expect(skill?.localizedDescriptions?.['zh-rCN']).toContain('消耗魔力药剂')
    expect(getLocalizedSkillName({ name: 'Acidic Concoction' }, skill, 'zh-rCN')).toBe('酸性灵药')
    expect(getLocalizedSkillDescription(skill, 'zh-rCN')).toContain('消耗魔力药剂')
    expect(getLocalizedSkillDescription(skill, 'en')).toBe(skill?.description)
  })

  it('resolves lineage supports supplied by both PoB and the PoE2DB catalogue', () => {
    const morrigan = resolveSkillCatalogName("Morrigan's Insight", catalog)
    expect(morrigan?.id).toBe('SupportMorrigansInsight')
    expect(resolveSkillCatalogName("Mórrigan's Insight", catalog)?.id).toBe('SupportMorrigansInsight')
    expect(morrigan?.localizedNames?.['zh-rCN']).toBe('莫丽根的洞察')
    expect(morrigan?.localizedDescriptions?.['zh-rCN']).toContain('自然交换')

    const atziri = resolveSkillCatalogName("Atziri's Communion", catalog)
    expect(atziri?.type).toBe('support')
    expect(atziri?.description).toContain('Reserve Life instead of Spirit')
    expect(atziri?.localizedNames?.['zh-rCN']).toBe('阿兹里的圣礼')
    expect(atziri?.localizedDescriptions?.['zh-rCN']).toContain('保留生命')
  })
})

import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  getLocalizedSkillDescription,
  getLocalizedSkillName,
  getLocalizedSupportEffectLines,
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

  it('contains precomputed support-gem effect lines', () => {
    expect(catalog.schemaVersion).toBeGreaterThanOrEqual(2)
    expect(catalog.entries.SupportConsideredCastingPlayer.effectLines).toEqual([
      'Cost Multiplier: 115%',
      'Supported Spell Skills have 15% less Cast Speed',
      'Supported Spells deal 35% more Damage',
    ])
    expect(catalog.entries.SupportHandOfChayulaPlayer.effectLinesByQuality?.['1'])
      .toContain('101% increased duration of socketed Curses')
    expect(getLocalizedSupportEffectLines(catalog.entries.SupportConsideredCastingPlayer, 0, 'zh-rCN')[0])
      .toBe('消耗倍率 115%')
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

  it('links ascendancy secondary forms to exportable parent skill items', () => {
    expect(catalog.entries.ExplosiveTeleportSandDjinn.plannerParentSkillId).toBe('SummonSandDjinnPlayer')
    expect(catalog.entries.ChilledGroundBurstWaterDjinn.plannerParentSkillId).toBe('SummonWaterDjinnPlayer')
    expect(catalog.entries.MeteorFireDjinn.plannerParentSkillId).toBe('SummonFireDjinnPlayer')

    const linked = Object.values(catalog.entries).filter((entry) => entry.plannerParentSkillId)
    expect(linked.length).toBeGreaterThan(20)
    for (const entry of linked) {
      expect(entry.type, entry.id).not.toBe('support')
      const parent = catalog.entries[entry.plannerParentSkillId!]
      expect(parent, entry.id).toBeDefined()
      expect([...parent.gameIds, ...parent.gemIds].some((id) => id.startsWith('Metadata/Items/')), entry.id).toBe(true)
    }
  })

  it('gives every ascendancy skill form a planner item id', () => {
    const ascendancySkills = Object.values(catalog.entries).filter((entry) => entry.isAscendancySkill)
    expect(ascendancySkills.length).toBeGreaterThan(60)
    for (const entry of ascendancySkills) {
      expect(entry.plannerSkillId, entry.id).toMatch(/^Metadata\/Items\//)
    }

    const primaryPlannerIds = new Set(ascendancySkills.map((entry) => entry.plannerSkillId))
    expect(primaryPlannerIds.size).toBeGreaterThan(40)
  })
})

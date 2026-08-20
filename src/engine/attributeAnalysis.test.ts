import { describe, expect, it } from 'vitest'
import {
  ATTRIBUTE_PROBE_CATALOG,
  buildProbePoint,
  classifyProbeSeries,
  detectBaselineFindings,
  getAnalysisSkillScope,
  getPowerStatValue,
  isProbeApplicable,
} from '@/engine/attributeAnalysis'
import type { CalcResult } from '@/types/calc'

const result = (powerStats: Record<string, number>) => ({ PowerStats: powerStats } as CalcResult)

describe('attribute analysis evidence model', () => {
  it('prefers the canonical direct defence value over stale PowerStats cache data', () => {
    expect(getPowerStatValue({ Evasion: 125, PowerStats: { Evasion: 0 } } as unknown as CalcResult, 'Evasion')).toBe(125)
  })

  it('contains the complete static defense probe set', () => {
    const defenseIds = ATTRIBUTE_PROBE_CATALOG.filter((probe) => probe.primaryDimension === 'defense').map((probe) => probe.id)
    expect(defenseIds).toHaveLength(17)
    expect(defenseIds).toEqual(expect.arrayContaining([
      'maximum-life',
      'maximum-energy-shield',
      'armour',
      'evasion',
      'deflection',
      'fire-resistance',
      'cold-resistance',
      'lightning-resistance',
      'chaos-resistance',
      'block-chance',
      'spell-block-chance',
      'maximum-fire-resistance',
      'maximum-cold-resistance',
      'maximum-lightning-resistance',
      'maximum-chaos-resistance',
      'physical-damage-reduction',
      'ward',
    ]))
  })

  it('declares a report metric for every catalog probe', () => {
    expect(ATTRIBUTE_PROBE_CATALOG.every((probe) => probe.affectedMetrics.includes(probe.primaryMetric))).toBe(true)
  })

  it('includes deflection as a calculable defense probe when the build has it', () => {
    const probe = ATTRIBUTE_PROBE_CATALOG.find((entry) => entry.id === 'deflection')!
    expect(probe.affectedMetrics).toEqual(['DeflectionRating', 'DeflectChance', 'DeflectEffect', 'TotalEHP'])
    expect(isProbeApplicable(probe, result({ DeflectionRating: 100 }), true)).toBe(true)
    expect(isProbeApplicable(probe, result({ DeflectionRating: 0 }), true)).toBe(false)
  })

  it('only includes block and Ward probes when the build has the mechanic', () => {
    const block = ATTRIBUTE_PROBE_CATALOG.find((entry) => entry.id === 'block-chance')!
    const spellBlock = ATTRIBUTE_PROBE_CATALOG.find((entry) => entry.id === 'spell-block-chance')!
    const ward = ATTRIBUTE_PROBE_CATALOG.find((entry) => entry.id === 'ward')!
    expect(isProbeApplicable(block, result({ BlockChance: 1 }), true)).toBe(true)
    expect(isProbeApplicable(block, result({ BlockChance: 0 }), true)).toBe(false)
    expect(isProbeApplicable(spellBlock, result({ SpellBlockChance: 1 }), true)).toBe(true)
    expect(isProbeApplicable(spellBlock, result({ SpellBlockChance: 0 }), true)).toBe(false)
    expect(isProbeApplicable(ward, result({ Ward: 100 }), true)).toBe(true)
    expect(isProbeApplicable(ward, result({ Ward: 0 }), true)).toBe(false)
  })

  it('keeps zero baselines absolute instead of inventing a percentage', () => {
    const probe = ATTRIBUTE_PROBE_CATALOG.find((entry) => entry.id === 'maximum-life')!
    const point = buildProbePoint(probe, 1, result({ TotalEHP: 0, Life: 0 }), result({ TotalEHP: 10, Life: 10 }))
    expect(point.metrics.TotalEHP.absoluteDelta).toBe(10)
    expect(point.metrics.TotalEHP.relativeDelta).toBeNull()
  })

  it('marks a falling multi-point result as limited and non-monotonic', () => {
    const probe = ATTRIBUTE_PROBE_CATALOG.find((entry) => entry.id === 'generic-damage')!
    const points = [
      buildProbePoint(probe, 5, result({ FullDPS: 100 }), result({ FullDPS: 110 })),
      buildProbePoint(probe, 10, result({ FullDPS: 100 }), result({ FullDPS: 108 })),
    ]
    expect(classifyProbeSeries(points, 'FullDPS')).toEqual({ curve: 'non-monotonic', confidence: 'limited', warnings: ['non-monotonic'] })
  })

  it('treats missing Full DPS selection as an automatic fallback, not a warning', () => {
    const findings = detectBaselineFindings({ ...result({ FireResistTotal: 75, ColdResistTotal: 75, LightningResistTotal: 75 }), TotalDPS: 100 } as CalcResult, false)
    expect(findings).toEqual([])
  })

  it('uses all positive DPS entries and separates attack and spell probes', () => {
    const baseline = {
      AllSkillDPS: [
        { name: 'Attack', dps: 100, count: 1, skillType: 'attack' as const },
        { name: 'Spell', dps: 80, count: 1, skillType: 'spell' as const },
        { name: 'Ignite', dps: 20, count: 1, kind: 'dot' as const },
      ],
    } as CalcResult
    const generic = ATTRIBUTE_PROBE_CATALOG.find((entry) => entry.id === 'generic-damage')!
    const attack = ATTRIBUTE_PROBE_CATALOG.find((entry) => entry.id === 'attack-speed')!
    const spell = ATTRIBUTE_PROBE_CATALOG.find((entry) => entry.id === 'cast-speed')!
    expect(isProbeApplicable(generic, baseline, false)).toBe(true)
    expect(isProbeApplicable(attack, baseline, false)).toBe(true)
    expect(isProbeApplicable(spell, baseline, false)).toBe(true)
    expect(isProbeApplicable(attack, { AllSkillDPS: [{ name: 'Spell', dps: 80, count: 1, skillType: 'spell' }] } as CalcResult, false)).toBe(false)
  })

  it('uses the configured Full DPS rows before falling back to all rows', () => {
    const scope = getAnalysisSkillScope({
      FullSkillDPS: [{ name: 'Configured attack', dps: 100, count: 1, skillType: 'attack' }],
      AllSkillDPS: [
        { name: 'Configured attack', dps: 100, count: 1, skillType: 'attack' },
        { name: 'Unselected spell', dps: 200, count: 1, skillType: 'spell' },
      ],
    } as CalcResult, true)
    expect(scope.mode).toBe('full-dps')
    expect(scope.entries.map((entry) => entry.name)).toEqual(['Configured attack'])
    expect(scope.spell).toHaveLength(0)
  })

  it('reports each elemental resistance below the target', () => {
    const findings = detectBaselineFindings(result({ FireResistTotal: 70, ColdResistTotal: 60, LightningResistTotal: 75 }), true)
    expect(findings.map((finding) => finding.id)).toEqual(['fire-resistance', 'cold-resistance'])
  })
})

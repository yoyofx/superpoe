import { calculationCache, createCalculationCacheKeys } from '@/engine/calculationCache'
import { calculateBuild } from '@/engine/pobLuaClient'
import {
  buildProbePoint,
  classifyProbeSeries,
  getAnalysisSkillScope,
  isProbeApplicable,
  type AttributeProbeDefinition,
  type ProbeSeriesResult,
} from '@/engine/attributeAnalysis'
import type { CalcResult, SkillCalculationMode, SkillDpsEntry, SkillDamageBreakdown } from '@/types/calc'

export interface InvestmentAnalysisRequest {
  code: string
  xml: string
  weaponSet: 1 | 2
  calcMode: SkillCalculationMode
  baseOverrides: Record<string, boolean | number | string>
  baseline: CalcResult
  /** Character-only MAIN output used by the equipment panel for defence values. */
  defenseBaseline?: CalcResult
  probes: AttributeProbeDefinition[]
  hasFullDpsSelection: boolean
  isCurrent: () => boolean
  onProgress?: (completed: number, total: number) => void
}

function withCustomMod(base: Record<string, boolean | number | string>, mod: string): Record<string, boolean | number | string> {
  const existing = typeof base.customMods === 'string' ? base.customMods.trim() : ''
  return { ...base, customMods: [existing, mod].filter(Boolean).join('\n') }
}

export async function calculateAnalysisResult(
  code: string,
  xml: string,
  weaponSet: 1 | 2,
  calcMode: SkillCalculationMode | undefined,
  configOverrides: Record<string, boolean | number | string>,
  options: { characterOnly?: boolean; skillGroupId?: string; activeSkillIndex?: number } = {},
): Promise<CalcResult> {
  const selection = {
    calcMode,
    characterOnly: options.characterOnly,
    skillGroupId: options.skillGroupId,
    activeSkillIndex: options.activeSkillIndex,
  }
  const keys = createCalculationCacheKeys({ code, xml, weaponSet, calcMode, configOverrides, selection })
  const cached = calculationCache.get(keys.resultKey)
  if (cached) return cached
  const response = await calculateBuild({
    code,
    xml,
    calcMode,
    characterOnly: options.characterOnly,
    skillGroupId: options.skillGroupId,
    activeSkillIndex: options.activeSkillIndex,
    configOverrides,
  })
  if (!response.success || response.error || !response.data) throw new Error(response.error || 'Calculation returned no data')
  calculationCache.set(keys, response.data)
  return response.data
}

/**
 * Resolves the same primary skill that drives the analysis page and requests
 * its PoB detail payload. The aggregate analysis still uses every entry in
 * the scope; this detail result is only the representative skill for the
 * layer-by-layer report.
 */
export interface AnalysisScopeDetailResult {
  representative: CalcResult
  finalDamageDps: Record<string, number>
}

async function resolveScopeEntryDetail(
  code: string,
  xml: string,
  weaponSet: 1 | 2,
  calcMode: SkillCalculationMode,
  configOverrides: Record<string, boolean | number | string>,
  entry: SkillDpsEntry,
  baseline: CalcResult,
): Promise<CalcResult> {
  if (!entry.groupId) return baseline
  const currentSkill = baseline.SkillDetails?.activeSkills.find((skill) => skill.index === baseline.SkillDetails?.activeSkillIndex)
  if (currentSkill && entry.skillId && currentSkill.skillId === entry.skillId
    && (!entry.skillPart || !currentSkill.skillPart || currentSkill.skillPart === entry.skillPart)) return baseline

  const groupResult = await calculateAnalysisResult(code, xml, weaponSet, calcMode, configOverrides, { skillGroupId: entry.groupId })
  const activeSkills = groupResult.SkillDetails?.activeSkills || []
  const matchingIndex = activeSkills.findIndex((skill) => {
    if (entry.skillId && skill.skillId === entry.skillId) {
      return !entry.skillPart || !skill.skillPart || skill.skillPart === entry.skillPart
    }
    return !entry.skillId && skill.label === entry.name
  })
  if (matchingIndex < 0 || matchingIndex + 1 === groupResult.SkillDetails?.activeSkillIndex) return groupResult
  return calculateAnalysisResult(code, xml, weaponSet, calcMode, configOverrides, {
    skillGroupId: entry.groupId,
    activeSkillIndex: matchingIndex + 1,
  })
}

export async function calculateAnalysisScopeDetail(
  code: string,
  xml: string,
  weaponSet: 1 | 2,
  calcMode: SkillCalculationMode,
  configOverrides: Record<string, boolean | number | string>,
  baseline: CalcResult,
  hasFullDpsSelection: boolean,
): Promise<AnalysisScopeDetailResult> {
  const scope = getAnalysisSkillScope(baseline, hasFullDpsSelection)
  const entries = [...scope.entries].sort((left, right) => right.dps - left.dps)
  const primary = entries[0]
  if (!primary) return { representative: baseline, finalDamageDps: {} }

  const finalDamageDps: AnalysisScopeDetailResult['finalDamageDps'] = {}
  let representative = baseline
  for (const entry of entries) {
    if (!entry.groupId && entry !== primary) continue
    let detail: CalcResult
    try {
      detail = await resolveScopeEntryDetail(code, xml, weaponSet, calcMode, configOverrides, entry, baseline)
    } catch {
      continue
    }
    if (entry === primary) representative = detail
    for (const damageType of detail.SkillDetails?.damageTypes || []) {
      if (damageType.type === 'all' || !Number.isFinite(damageType.finalDps)) continue
      finalDamageDps[damageType.type] = (finalDamageDps[damageType.type] || 0) + damageType.finalDps! * Math.max(1, entry.count || 1)
    }
  }
  return { representative, finalDamageDps }
}

/** Owns the probe queue so renderer state only receives complete, context-valid series. */
export async function runInvestmentProbeBatch(request: InvestmentAnalysisRequest): Promise<ProbeSeriesResult[]> {
  const skillScope = getAnalysisSkillScope(request.baseline, request.hasFullDpsSelection)
  const defenseBaseline = request.defenseBaseline || request.baseline
  const probes = request.probes.filter((probe) => isProbeApplicable(probe, probe.primaryDimension === 'defense' ? defenseBaseline : request.baseline, request.hasFullDpsSelection, skillScope))
  const total = probes.reduce((sum, probe) => sum + probe.points.length, 0)
  let completed = 0
  const series: ProbeSeriesResult[] = []
  request.onProgress?.(0, total)

  for (const probe of probes) {
    const points = []
    for (const point of probe.points) {
      if (!request.isCurrent()) return []
      try {
        const isDefenseProbe = probe.primaryDimension === 'defense'
        const probeBaseline = isDefenseProbe ? defenseBaseline : request.baseline
        const result = await calculateAnalysisResult(
          request.code,
          request.xml,
          request.weaponSet,
          isDefenseProbe ? undefined : request.calcMode,
          withCustomMod(request.baseOverrides, probe.mutation.format(point)),
          { characterOnly: isDefenseProbe },
        )
        points.push(buildProbePoint(probe, point, probeBaseline, result))
      } catch (error) {
        points.push({ input: point, mod: probe.mutation.format(point), metrics: {}, error: error instanceof Error ? error.message : String(error) })
      }
      completed += 1
      request.onProgress?.(completed, total)
    }
    series.push({ probe, points, ...classifyProbeSeries(points, probe.primaryMetric) })
  }
  return series
}

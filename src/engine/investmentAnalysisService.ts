import { calculationCache, createCalculationCacheKeys } from '@/engine/calculationCache'
import { calculateBuild } from '@/engine/pobLuaClient'
import {
  buildProbePoint,
  classifyProbeSeries,
  getMetricDefinition,
  getAnalysisSkillScope,
  isProbeApplicable,
  normalizeProbePoint,
  type AttributeProbeDefinition,
  type ProbePointResult,
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

const AMPLIFIED_PROBE_POINTS = [5, 10] as const

function shouldAmplifyProbe(probe: AttributeProbeDefinition, point: ProbePointResult): boolean {
  if (probe.pointUnit === 'level') return false
  const primaryDelta = point.metrics[probe.primaryMetric]?.absoluteDelta
  if (primaryDelta == null || !Number.isFinite(primaryDelta)) return false
  return Math.abs(primaryDelta) < (getMetricDefinition(probe.primaryMetric)?.epsilon ?? 0)
}

function hasStableLocalSlope(points: Array<{ samplePoint: number; point: ProbePointResult }>, metricKey: string): boolean {
  const slopes = points.map(({ samplePoint, point }) => {
    const delta = point.metrics[metricKey]?.absoluteDelta
    return delta == null || !Number.isFinite(delta) ? null : delta / samplePoint
  })
  if (slopes.some((value): value is null => value == null)) return false
  const values = slopes as number[]
  const scale = Math.max(1, ...values.map((value) => Math.abs(value)))
  const spread = Math.max(...values) - Math.min(...values)
  return spread / scale < .08
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
 * Resolves the same skill details that drive the analysis page. The aggregate
 * result is kept for the scope overview, while each successful entry is also
 * returned so the report can inspect skills independently.
 */
export interface AnalysisSkillDetail {
  id: string
  entry: SkillDpsEntry
  detail: CalcResult
  finalDamageDps: Record<string, number>
}

export interface AnalysisScopeDetailResult {
  representative: CalcResult
  skills: AnalysisSkillDetail[]
  finalDamageDps: Record<string, number>
}

function analysisSkillId(entry: SkillDpsEntry, index: number): string {
  return [entry.groupId || '', entry.skillId || '', entry.skillPart || '', entry.name, entry.kind || '', index].join('|')
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
  if (!primary) return { representative: baseline, skills: [], finalDamageDps: {} }

  const finalDamageDps: AnalysisScopeDetailResult['finalDamageDps'] = {}
  const skills: AnalysisSkillDetail[] = []
  let representative = baseline
  for (const [index, entry] of entries.entries()) {
    if (!entry.groupId && entry !== primary) continue
    let detail: CalcResult
    try {
      detail = await resolveScopeEntryDetail(code, xml, weaponSet, calcMode, configOverrides, entry, baseline)
    } catch {
      continue
    }
    if (entry === primary) representative = detail
    const skillFinalDamageDps: Record<string, number> = {}
    for (const damageType of detail.SkillDetails?.damageTypes || []) {
      if (damageType.type === 'all' || !Number.isFinite(damageType.finalDps)) continue
      const value = damageType.finalDps! * Math.max(1, entry.count || 1)
      skillFinalDamageDps[damageType.type] = (skillFinalDamageDps[damageType.type] || 0) + value
      finalDamageDps[damageType.type] = (finalDamageDps[damageType.type] || 0) + value
    }
    skills.push({ id: analysisSkillId(entry, index), entry, detail, finalDamageDps: skillFinalDamageDps })
  }
  return { representative, skills, finalDamageDps }
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
    const points: ProbePointResult[] = []
    for (const point of probe.points) {
      if (!request.isCurrent()) return []
      const isDefenseProbe = probe.primaryDimension === 'defense'
      const probeBaseline = isDefenseProbe ? defenseBaseline : request.baseline
      const calculatePoint = async (samplePoint: number): Promise<ProbePointResult> => {
        const result = await calculateAnalysisResult(
          request.code,
          request.xml,
          request.weaponSet,
          isDefenseProbe ? undefined : request.calcMode,
          withCustomMod(request.baseOverrides, probe.mutation.format(samplePoint)),
          { characterOnly: isDefenseProbe },
        )
        return buildProbePoint(probe, samplePoint, probeBaseline, result)
      }

      let directPoint: ProbePointResult
      try {
        directPoint = await calculatePoint(point)
      } catch (error) {
        points.push({ input: point, mod: probe.mutation.format(point), metrics: {}, error: error instanceof Error ? error.message : String(error) })
        completed += 1
        request.onProgress?.(completed, total)
        continue
      }

      let displayPoint = directPoint
      let sampling: ProbeSeriesResult['sampling'] = { mode: 'direct' }
      if (point === 1 && shouldAmplifyProbe(probe, directPoint)) {
        const amplified: Array<{ samplePoint: number; point: ProbePointResult }> = []
        for (const samplePoint of AMPLIFIED_PROBE_POINTS) {
          if (!request.isCurrent()) return []
          try {
            amplified.push({ samplePoint, point: await calculatePoint(samplePoint) })
          } catch {
            amplified.length = 0
            break
          }
        }
        if (amplified.length === AMPLIFIED_PROBE_POINTS.length && hasStableLocalSlope(amplified, probe.primaryMetric)) {
          const sample = amplified[amplified.length - 1]
          displayPoint = normalizeProbePoint(sample.point, sample.samplePoint, point, probe.mutation.format(point))
          sampling = { mode: 'amplified', samplePoint: sample.samplePoint }
        }
      }

      points.push(displayPoint)
      completed += 1
      request.onProgress?.(completed, total)
    }
    const classification = classifyProbeSeries(points, probe.primaryMetric)
    const sampling = points.some((point) => point.sampleInput != null)
      ? { mode: 'amplified' as const, samplePoint: points.find((point) => point.sampleInput != null)?.sampleInput }
      : { mode: 'direct' as const }
    series.push({ probe, points, ...classification, sampling })
  }
  return series
}

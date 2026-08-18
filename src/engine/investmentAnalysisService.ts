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
import type { CalcResult, SkillCalculationMode } from '@/types/calc'

export interface InvestmentAnalysisRequest {
  code: string
  xml: string
  weaponSet: 1 | 2
  calcMode: SkillCalculationMode
  baseOverrides: Record<string, boolean | number | string>
  baseline: CalcResult
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
  calcMode: SkillCalculationMode,
  configOverrides: Record<string, boolean | number | string>,
): Promise<CalcResult> {
  const keys = createCalculationCacheKeys({ code, xml, weaponSet, calcMode, configOverrides, selection: { calcMode } })
  const cached = calculationCache.get(keys.resultKey)
  if (cached) return cached
  const response = await calculateBuild({ code, xml, calcMode, configOverrides })
  if (!response.success || response.error || !response.data) throw new Error(response.error || 'Calculation returned no data')
  calculationCache.set(keys, response.data)
  return response.data
}

/** Owns the probe queue so renderer state only receives complete, context-valid series. */
export async function runInvestmentProbeBatch(request: InvestmentAnalysisRequest): Promise<ProbeSeriesResult[]> {
  const skillScope = getAnalysisSkillScope(request.baseline, request.hasFullDpsSelection)
  const probes = request.probes.filter((probe) => isProbeApplicable(probe, request.baseline, request.hasFullDpsSelection, skillScope))
  const total = probes.reduce((sum, probe) => sum + probe.points.length, 0)
  let completed = 0
  const series: ProbeSeriesResult[] = []
  request.onProgress?.(0, total)

  for (const probe of probes) {
    const points = []
    for (const point of probe.points) {
      if (!request.isCurrent()) return []
      try {
        const result = await calculateAnalysisResult(request.code, request.xml, request.weaponSet, request.calcMode, withCustomMod(request.baseOverrides, probe.mutation.format(point)))
        points.push(buildProbePoint(probe, point, request.baseline, result))
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

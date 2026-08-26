import { calculationCache, createCalculationCacheKeys } from '@/engine/calculationCache'
import { calculateAttributeProbeBatch, calculateBuild } from '@/engine/pobLuaClient'
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
import type { AttributeProbeBatchInput, AttributeProbeCalculationJob, CalcResult, SkillCalculationActorSelection, SkillCalculationMode, SkillDpsEntry, SkillDamageBreakdown } from '@/types/calc'

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
  onPartialResults?: (series: ProbeSeriesResult[]) => void
}

function withCustomMod(base: Record<string, boolean | number | string>, mod: string): Record<string, boolean | number | string> {
  const existing = typeof base.customMods === 'string' ? base.customMods.trim() : ''
  return { ...base, customMods: [existing, mod].filter(Boolean).join('\n') }
}

const AMPLIFIED_PROBE_POINT = 10

// These modifiers are locally smooth enough to use one larger sample when a
// direct +1 probe falls below the metric resolution. Threshold, cap, crit and
// skill-level probes remain exact +1 calculations.
const LOCALLY_LINEAR_PROBE_IDS = new Set([
  'base-physical-damage', 'base-fire-damage', 'base-cold-damage', 'base-lightning-damage', 'base-chaos-damage',
  'generic-damage', 'attack-damage', 'spell-damage', 'elemental-damage', 'physical-damage',
  'fire-damage', 'cold-damage', 'lightning-damage', 'chaos-damage', 'gain-extra-elemental',
  'attack-speed', 'cast-speed',
  'base-life', 'base-energy-shield', 'base-armour', 'base-evasion', 'base-deflection', 'base-ward',
  'maximum-life', 'maximum-energy-shield', 'armour', 'evasion', 'deflection', 'ward',
])

function shouldAmplifyProbe(probe: AttributeProbeDefinition, point: ProbePointResult): boolean {
  if (probe.pointUnit === 'level' || !LOCALLY_LINEAR_PROBE_IDS.has(probe.id)) return false
  const primaryDelta = point.metrics[probe.primaryMetric]?.absoluteDelta
  if (primaryDelta == null || !Number.isFinite(primaryDelta)) return false
  return Math.abs(primaryDelta) < (getMetricDefinition(probe.primaryMetric)?.epsilon ?? 0)
}

interface ProbeJob {
  probe: AttributeProbeDefinition
  input: number
  baseline: CalcResult
  job: AttributeProbeCalculationJob
}

function createProbeJob(
  request: InvestmentAnalysisRequest,
  probe: AttributeProbeDefinition,
  point: number,
  index: number,
  baseline: CalcResult,
): ProbeJob {
  const isDefenseProbe = probe.primaryDimension === 'defense'
  return {
    probe,
    input: point,
    baseline,
    job: {
      id: `${probe.id}:${point}:${index}`,
      characterOnly: isDefenseProbe,
      calcMode: isDefenseProbe ? undefined : request.calcMode,
      includeAllDps: !isDefenseProbe && !request.hasFullDpsSelection,
      configOverrides: withCustomMod(request.baseOverrides, probe.mutation.format(point)),
    },
  }
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
  options: { characterOnly?: boolean; skillGroupId?: string; activeSkillIndex?: number; skillPartIndex?: number; statSetIndex?: number; actor?: SkillCalculationActorSelection; minionSkillIndex?: number; minionStatSetIndex?: number } = {},
): Promise<CalcResult> {
  const selection = {
    calcMode,
    characterOnly: options.characterOnly,
    skillGroupId: options.skillGroupId,
    activeSkillIndex: options.activeSkillIndex,
    skillPartIndex: options.skillPartIndex,
    statSetIndex: options.statSetIndex,
    actor: options.actor,
    minionSkillIndex: options.minionSkillIndex,
    minionStatSetIndex: options.minionStatSetIndex,
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
    skillPartIndex: options.skillPartIndex,
    statSetIndex: options.statSetIndex,
    actor: options.actor,
    minionSkillIndex: options.minionSkillIndex,
    minionStatSetIndex: options.minionStatSetIndex,
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
  isDefault: boolean
}

export interface AnalysisScopeDetailResult {
  representative: CalcResult
  skills: AnalysisSkillDetail[]
  finalDamageDps: Record<string, number>
}

interface AnalysisFormSelection {
  actor?: SkillCalculationActorSelection
  skillPartIndex?: number
  statSetIndex?: number
  minionSkillIndex?: number
  minionStatSetIndex?: number
}

function analysisSkillId(entry: SkillDpsEntry, index: number, selection: AnalysisFormSelection): string {
  return [
    entry.groupId || '', entry.skillId || '', entry.skillPart || '', entry.name, entry.kind || '', index,
    selection.actor || 'auto', selection.statSetIndex ?? 'default',
    selection.skillPartIndex ?? 'default',
    selection.minionSkillIndex ?? 'default', selection.minionStatSetIndex ?? 'default',
  ].join('|')
}

async function resolveScopeEntryDetail(
  code: string,
  xml: string,
  weaponSet: 1 | 2,
  calcMode: SkillCalculationMode,
  configOverrides: Record<string, boolean | number | string>,
  entry: SkillDpsEntry,
  baseline: CalcResult,
  selection: AnalysisFormSelection = {},
): Promise<CalcResult> {
  if (!entry.groupId) return baseline
  const baselineDetails = baseline.SkillDetails
  const currentSkill = baselineDetails?.activeSkills.find((skill) => skill.index === baselineDetails.activeSkillIndex)
  const matchesCurrentSkill = Boolean(currentSkill && entry.skillId && currentSkill.skillId === entry.skillId
    && (!entry.skillPart || !currentSkill.skillPart || currentSkill.skillPart === entry.skillPart))
  const requestedActor = selection.actor
  const isDefaultActor = requestedActor == null || requestedActor === 'auto'
  if (matchesCurrentSkill && isDefaultActor
    && selection.minionSkillIndex == null
    && selection.minionStatSetIndex == null
    && (selection.statSetIndex == null || baselineDetails?.statSetIndex === selection.statSetIndex)) return baseline

  const groupResult = await calculateAnalysisResult(code, xml, weaponSet, calcMode, configOverrides, { skillGroupId: entry.groupId })
  const groupDetails = groupResult.SkillDetails
  const activeSkills = groupDetails?.activeSkills || []
  const matchingIndex = activeSkills.findIndex((skill) => {
    if (entry.skillId && skill.skillId === entry.skillId) {
      return !entry.skillPart || !skill.skillPart || skill.skillPart === entry.skillPart
    }
    return !entry.skillId && skill.label === entry.name
  })
  const resolvedMatchingIndex = matchingIndex >= 0
    ? matchingIndex
    : entry.skillId
      ? activeSkills.findIndex((skill) => skill.skillId === entry.skillId)
      : -1
  if (resolvedMatchingIndex < 0) return groupResult
  const activeSkillIndex = resolvedMatchingIndex + 1
  if (activeSkillIndex === groupDetails?.activeSkillIndex
    && isDefaultActor
    && selection.minionSkillIndex == null
    && selection.minionStatSetIndex == null
    && (selection.statSetIndex == null || groupDetails?.statSetIndex === selection.statSetIndex)) return groupResult
  return calculateAnalysisResult(code, xml, weaponSet, calcMode, configOverrides, {
    skillGroupId: entry.groupId,
    activeSkillIndex,
    ...selection,
  })
}

function formSelectionKey(selection: AnalysisFormSelection): string {
  return [
    selection.actor || 'auto',
    selection.statSetIndex ?? '',
    selection.skillPartIndex ?? '',
    selection.minionSkillIndex ?? '',
    selection.minionStatSetIndex ?? '',
  ].join(':')
}

/**
 * PoB exposes ordinary skill forms as stat sets, while minion skills add a
 * second form axis: the selected minion skill also has its own stat sets.
 * Keep the default calculation first and then enumerate every other valid
 * combination so the UI cannot silently lose a form.
 */
function getAnalysisFormSelections(detail: CalcResult): AnalysisFormSelection[] {
  const details = detail.SkillDetails
  if (!details) return [{}]

  const selections: AnalysisFormSelection[] = [{}]
  const seen = new Set([formSelectionKey({})])
  const add = (selection: AnalysisFormSelection) => {
    const key = formSelectionKey(selection)
    if (seen.has(key)) return
    seen.add(key)
    selections.push(selection)
  }

  if (details.actor === 'minion') {
    const minionSkills = details.minionSkills?.length
      ? details.minionSkills
      : [{ index: details.minionSkillIndex || 1, label: '', statSets: details.minionStatSets || [] }]
    for (const minionSkill of minionSkills) {
      const statSets = minionSkill.statSets?.length
        ? minionSkill.statSets
        : minionSkill.index === (details.minionSkillIndex || 1)
          ? details.minionStatSets || []
          : []
      if (statSets.length) {
        for (const statSet of statSets) {
          const isCurrent = minionSkill.index === (details.minionSkillIndex || 1)
            && statSet.index === (details.minionStatSetIndex || 1)
          if (!isCurrent) add({ actor: 'minion', minionSkillIndex: minionSkill.index, minionStatSetIndex: statSet.index })
        }
      } else if (minionSkill.index !== (details.minionSkillIndex || 1)) {
        add({ actor: 'minion', minionSkillIndex: minionSkill.index })
      }
    }
    return selections
  }

  const skillParts = details.skillParts?.length
    ? details.skillParts
    : [{ index: details.skillPartIndex || 1, label: '' }]
  const statSets = details.statSets?.length
    ? details.statSets
    : [{ index: details.statSetIndex || 1, label: '' }]
  for (const skillPart of skillParts) {
    for (const statSet of statSets) {
      const isCurrent = skillPart.index === (details.skillPartIndex || 1)
        && statSet.index === (details.statSetIndex || 1)
      if (!isCurrent) add({ actor: 'player', skillPartIndex: skillPart.index, statSetIndex: statSet.index })
    }
  }
  return selections
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
    let defaultDetail: CalcResult
    try {
      defaultDetail = await resolveScopeEntryDetail(code, xml, weaponSet, calcMode, configOverrides, entry, baseline)
    } catch {
      continue
    }
    if (entry === primary) representative = defaultDetail

    for (const [formIndex, selection] of getAnalysisFormSelections(defaultDetail).entries()) {
      let detail = defaultDetail
      if (formIndex > 0) {
        try {
          detail = await resolveScopeEntryDetail(code, xml, weaponSet, calcMode, configOverrides, entry, baseline, selection)
        } catch {
          // One unavailable form should not hide the other forms of the skill.
          continue
        }
      }
      // For summon builds the selected actor is the minion, while the
      // top-level TotalDPS still belongs to the player environment.
      const calculatedDps = Number.isFinite(detail.SkillDetails?.totalDps)
        ? detail.SkillDetails!.totalDps!
        : Number.isFinite(detail.TotalDPS) ? detail.TotalDPS : entry.dps
      const skillEntry = { ...entry, dps: calculatedDps }
      const skillFinalDamageDps: Record<string, number> = {}
      for (const damageType of detail.SkillDetails?.damageTypes || []) {
        if (damageType.type === 'all' || !Number.isFinite(damageType.finalDps)) continue
        const value = damageType.finalDps! * Math.max(1, entry.count || 1)
        skillFinalDamageDps[damageType.type] = (skillFinalDamageDps[damageType.type] || 0) + value
        if (formIndex === 0) {
          finalDamageDps[damageType.type] = (finalDamageDps[damageType.type] || 0) + value
        }
      }
      skills.push({
        id: analysisSkillId(entry, index, selection),
        entry: skillEntry,
        detail,
        finalDamageDps: skillFinalDamageDps,
        isDefault: formIndex === 0,
      })
    }
  }
  return { representative, skills, finalDamageDps }
}

/** Owns the probe queue so renderer state only receives context-valid series. */
export async function runInvestmentProbeBatch(request: InvestmentAnalysisRequest): Promise<ProbeSeriesResult[]> {
  const skillScope = getAnalysisSkillScope(request.baseline, request.hasFullDpsSelection)
  const defenseBaseline = request.defenseBaseline || request.baseline
  const probes = request.probes.filter((probe) => isProbeApplicable(probe, probe.primaryDimension === 'defense' ? defenseBaseline : request.baseline, request.hasFullDpsSelection, skillScope))
  const directJobs = probes.flatMap((probe) => probe.points.map((point, index) => createProbeJob(
    request,
    probe,
    point,
    index,
    probe.primaryDimension === 'defense' ? defenseBaseline : request.baseline,
  )))
  const total = directJobs.length
  let progressTotal = total
  let completed = 0
  request.onProgress?.(0, total)

  const runJobs = async (jobs: ProbeJob[]): Promise<Map<string, ProbePointResult>> => {
    const results = new Map<string, ProbePointResult>()
    if (!jobs.length) return results
    if (!request.isCurrent()) return results

    const batchInput: AttributeProbeBatchInput = {
      code: request.code,
      xml: request.xml,
      jobs: jobs.map(({ job }) => job),
    }
    const startedAt = performance.now()
    const batch = await calculateAttributeProbeBatch(batchInput)
    if (batch.success && batch.data) {
      if (import.meta.env.DEV) {
        console.debug('[Analysis] attribute probe batch', {
          jobs: jobs.length,
          wallMs: Math.round(performance.now() - startedAt),
          runtimeMs: Math.round(batch.performance?.elapsedMs || 0),
        })
      }
      const entries = new Map(batch.data.map((entry) => [entry.id, entry]))
      for (const job of jobs) {
        const entry = entries.get(job.job.id)
        if (entry?.success && entry.data) {
          results.set(job.job.id, buildProbePoint(job.probe, job.input, job.baseline, entry.data))
        } else {
          results.set(job.job.id, {
            input: job.input,
            mod: job.probe.mutation.format(job.input),
            metrics: {},
            error: entry?.error || batch.error || 'Attribute probe calculation returned no data',
          })
        }
        completed += 1
        request.onProgress?.(completed, progressTotal)
      }
      return results
    }

    // Keep the previous per-job path as a runtime fallback. It also makes a
    // batch protocol failure non-fatal for users with an older native sidecar.
    if (import.meta.env.DEV) console.warn('[Analysis] attribute probe batch unavailable; falling back to individual calculations', batch.error)
    for (const job of jobs) {
      if (!request.isCurrent()) return results
      try {
        const isDefenseProbe = job.probe.primaryDimension === 'defense'
        const result = await calculateAnalysisResult(
          request.code,
          request.xml,
          request.weaponSet,
          isDefenseProbe ? undefined : request.calcMode,
          job.job.configOverrides,
          { characterOnly: isDefenseProbe },
        )
        results.set(job.job.id, buildProbePoint(job.probe, job.input, job.baseline, result))
      } catch (error) {
        results.set(job.job.id, {
          input: job.input,
          mod: job.probe.mutation.format(job.input),
          metrics: {},
          error: error instanceof Error ? error.message : String(error),
        })
      }
      completed += 1
      request.onProgress?.(completed, progressTotal)
    }
    return results
  }

  const buildSeries = (
    phaseProbes: AttributeProbeDefinition[],
    directResults: Map<string, ProbePointResult>,
    amplifiedJobs: Array<ProbeJob & { direct: ProbePointResult }>,
    amplifiedResults: Map<string, ProbePointResult>,
  ): ProbeSeriesResult[] => phaseProbes.map((probe) => {
    const points: ProbePointResult[] = []
    for (const job of directJobs.filter((entry) => entry.probe === probe)) {
      const direct = directResults.get(job.job.id)
      if (!direct) continue
      let displayPoint = direct
      const amplified = amplifiedJobs.find((entry) => entry.probe === probe)
      const amplifiedPoint = amplified ? amplifiedResults.get(amplified.job.id) : undefined
      if (amplified && amplifiedPoint && !amplifiedPoint.error
        && hasStableLocalSlope([
          { samplePoint: job.input, point: direct },
          { samplePoint: AMPLIFIED_PROBE_POINT, point: amplifiedPoint },
        ], probe.primaryMetric)) {
        displayPoint = normalizeProbePoint(amplifiedPoint, AMPLIFIED_PROBE_POINT, job.input, probe.mutation.format(job.input))
      }
      points.push(displayPoint)
    }
    const classification = classifyProbeSeries(points, probe.primaryMetric)
    const sampledPoint = points.find((point) => point.sampleInput != null)?.sampleInput
    return {
      probe,
      points,
      ...classification,
      sampling: sampledPoint != null ? { mode: 'amplified', samplePoint: sampledPoint } : { mode: 'direct' },
    }
  })

  const runPhase = async (phaseProbes: AttributeProbeDefinition[]) => {
    const phaseJobs = directJobs.filter((entry) => phaseProbes.includes(entry.probe))
    const directResults = await runJobs(phaseJobs)
    if (!request.isCurrent()) return []

    const amplifiedJobs: Array<ProbeJob & { direct: ProbePointResult }> = []
    for (const job of phaseJobs) {
      const direct = directResults.get(job.job.id)
      if (!direct || direct.error || job.input !== 1 || !shouldAmplifyProbe(job.probe, direct)) continue
      amplifiedJobs.push({
        ...createProbeJob(request, job.probe, AMPLIFIED_PROBE_POINT, 0, job.baseline),
        direct,
      })
    }

    let amplifiedResults = new Map<string, ProbePointResult>()
    if (amplifiedJobs.length) {
      progressTotal += amplifiedJobs.length
      request.onProgress?.(completed, progressTotal)
      amplifiedResults = await runJobs(amplifiedJobs)
    }
    return buildSeries(phaseProbes, directResults, amplifiedJobs, amplifiedResults)
  }

  const attackProbes = probes.filter((probe) => probe.primaryDimension === 'attack')
  const defenseProbes = probes.filter((probe) => probe.primaryDimension === 'defense')
  const series: ProbeSeriesResult[] = []
  const attackSeries = await runPhase(attackProbes)
  if (!request.isCurrent()) return []
  series.push(...attackSeries)
  request.onPartialResults?.(series.slice())
  const defenseSeries = await runPhase(defenseProbes)
  if (!request.isCurrent()) return []
  series.push(...defenseSeries)
  request.onPartialResults?.(series.slice())
  return series
}

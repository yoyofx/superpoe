import type { CalcApiResponse, RankSkillsInput, SkillCalculationSelection, SkillDpsRankResponse } from '@/types/calc'
import type { EquipmentInspectionItem, EquipmentInspectionResult } from '@/types/equipmentSemantics'

interface WorkerRequest {
  id: number
  type: 'init' | 'calculate' | 'inspectEquipment' | 'rankSkills'
  payload?: unknown
}

interface WorkerResponse {
  id: number
  success: boolean
  data?: unknown
  error?: string
}

export interface CalculateBuildInput extends SkillCalculationSelection {
  code: string
  xml: string
}

const BACKEND_FALLBACK = import.meta.env.VITE_CALC_BACKEND_FALLBACK === 'true'

let worker: Worker | null = null
let workerInitPromise: Promise<void> | null = null
let engineInitPromise: Promise<'luajit' | 'wasmoon'> | null = null
let nativeBackendFailed = false
let nextId = 1
const pending = new Map<number, {
  resolve: (value: unknown) => void
  reject: (reason?: unknown) => void
}>()

function getWorker(): Worker {
  if (worker) return worker
  worker = new Worker(new URL('./pobLuaWorker.ts', import.meta.url), { type: 'module' })
  worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
    const message = event.data
    const request = pending.get(message.id)
    if (!request) return
    pending.delete(message.id)
    if (message.success) request.resolve(message.data)
    else request.reject(new Error(message.error || 'PoB Lua worker failed'))
  }
  worker.onerror = (event) => {
    const error = new Error(event.message || 'PoB Lua worker crashed')
    for (const request of pending.values()) request.reject(error)
    pending.clear()
    worker?.terminate()
    worker = null
    workerInitPromise = null
  }
  return worker
}

function callWorker<T>(type: WorkerRequest['type'], payload?: unknown): Promise<T> {
  const id = nextId++
  const request: WorkerRequest = { id, type, payload }
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (value: unknown) => void, reject })
    getWorker().postMessage(request)
  })
}

export async function initPobLuaWorker(): Promise<void> {
  if (!workerInitPromise) {
    workerInitPromise = callWorker<void>('init').catch((error) => {
      workerInitPromise = null
      throw error
    })
  }
  await workerInitPromise
}

export async function initPobLuaEngine(): Promise<'luajit' | 'wasmoon'> {
  if (!engineInitPromise) {
    engineInitPromise = (async () => {
      if (!nativeBackendFailed && window.pob2Desktop?.initPobLua) {
        const status = await window.pob2Desktop.initPobLua()
        if (status.available && status.backend === 'luajit') return 'luajit'
      }
      await initPobLuaWorker()
      return 'wasmoon'
    })().catch((error) => {
      engineInitPromise = null
      throw error
    })
  }
  return engineInitPromise
}

export async function inspectEquipment(items: EquipmentInspectionItem[]): Promise<EquipmentInspectionResult> {
  await initPobLuaWorker()
  const result = await callWorker<EquipmentInspectionResult>('inspectEquipment', { items })
  if (import.meta.env.DEV) {
    const { initMs, parseMs, cacheHits, cacheMisses } = result.performance
    console.debug(`[PoB Lua] equipment init=${initMs.toFixed(1)}ms parse=${parseMs.toFixed(1)}ms hits=${cacheHits} misses=${cacheMisses}`)
  }
  return result
}

async function calculateViaBackend(input: CalculateBuildInput): Promise<CalcApiResponse> {
  const response = await fetch('/api/build/calculate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: input.code }),
  })
  const data: CalcApiResponse = await response.json()
  if (!response.ok) return { success: false, error: data.error || `Backend calculate failed: HTTP ${response.status}` }
  return data
}

export async function calculateBuild(input: CalculateBuildInput): Promise<CalcApiResponse> {
  try {
    if (window.pob2Desktop?.calculatePobLua) {
      const backend = await initPobLuaEngine()
      if (backend === 'luajit') {
        try {
          return await window.pob2Desktop.calculatePobLua(input)
        } catch (error) {
          nativeBackendFailed = true
          engineInitPromise = null
          console.warn('[PoB Lua] Native backend failed; switching to Wasmoon.', error)
        }
      }
    }
    await initPobLuaWorker()
    return await callWorker<CalcApiResponse>('calculate', input)
  } catch (err) {
    if (BACKEND_FALLBACK) return calculateViaBackend(input)
    const message = err instanceof Error ? err.message : String(err)
    return {
      success: false,
      error: `Front-end PoB Lua engine is not ready: ${message}`,
    }
  }
}

export async function rankSkillsByEffectiveDps(input: RankSkillsInput): Promise<SkillDpsRankResponse> {
  try {
    if (window.pob2Desktop?.rankPobLuaSkills) {
      const backend = await initPobLuaEngine()
      if (backend === 'luajit') {
        try {
          return await window.pob2Desktop.rankPobLuaSkills(input)
        } catch (error) {
          nativeBackendFailed = true
          engineInitPromise = null
          console.warn('[PoB Lua] Native skill ranking failed; switching to Wasmoon.', error)
        }
      }
    }
    await initPobLuaWorker()
    return await callWorker<SkillDpsRankResponse>('rankSkills', input)
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) }
  }
}

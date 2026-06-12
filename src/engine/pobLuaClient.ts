import type { CalcApiResponse } from '@/types/calc'

interface WorkerRequest {
  id: number
  type: 'init' | 'calculate'
  payload?: unknown
}

interface WorkerResponse {
  id: number
  success: boolean
  data?: unknown
  error?: string
}

export interface CalculateBuildInput {
  code: string
  xml: string
}

const BACKEND_FALLBACK = import.meta.env.VITE_CALC_BACKEND_FALLBACK === 'true'

let worker: Worker | null = null
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
  await callWorker<void>('init')
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

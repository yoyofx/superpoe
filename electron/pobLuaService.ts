import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createInterface, type Interface as ReadlineInterface } from 'node:readline'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import type { CanonicalEquipmentItem, CanonicalItemView, FindBetterSearchOptions } from '../src/types/market.js'
import type { EquipmentDifferenceRequest, EquipmentDifferenceResult } from '../src/equipmentDifference/types.js'
import type { AttributeProbeBatchInput } from '../src/types/calc.js'

interface SidecarResponse {
  id?: number
  type?: string
  protocolVersion?: number
  runtime?: string
  success?: boolean
  data?: unknown
  error?: string
}

export interface PobLuaStatus {
  available: boolean
  backend: 'luajit' | 'wasmoon'
  runtime?: string
  error?: string
}

export interface PobItemNormalizationResult {
  success: boolean
  item?: CanonicalEquipmentItem
  view?: CanonicalItemView
  error?: string
}

interface PendingRequest {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timer: NodeJS.Timeout
}

const PROTOCOL_VERSION = 1
const START_TIMEOUT_MS = 20_000
const REQUEST_TIMEOUT_MS = 45_000

export class PobLuaService {
  private child: ChildProcessWithoutNullStreams | null = null
  private lines: ReadlineInterface | null = null
  private startPromise: Promise<PobLuaStatus> | null = null
  private status: PobLuaStatus = { available: false, backend: 'wasmoon' }
  private nextId = 1
  private pending = new Map<number, PendingRequest>()
  private cachedInput: string | null = null
  private cachedResult: unknown = null

  private resourcePaths(): { executable: string; runner: string; bundle: string; projectBundle: string } {
    const platformArch = process.platform === 'darwin' ? 'darwin-arm64' : `${process.platform}-${process.arch}`
    const executableName = process.platform === 'win32' ? 'luajit.exe' : 'luajit'
    if (app.isPackaged) {
      return {
        executable: path.join(process.resourcesPath, 'pob-lua-runtime', platformArch, executableName),
        runner: path.join(process.resourcesPath, 'pob-lua-sidecar', 'pob-lua-runner.lua'),
        bundle: path.join(process.resourcesPath, 'pob-lua'),
        projectBundle: path.join(process.resourcesPath, 'superpoe-lua'),
      }
    }
    const root = app.getAppPath()
    return {
      executable: path.join(root, 'native', 'bin', platformArch, executableName),
      runner: path.join(root, 'native', 'pob-lua-runner.lua'),
      bundle: path.join(root, 'public', 'pob-lua'),
      projectBundle: path.join(root, 'public', 'superpoe-lua'),
    }
  }

  initialize(): Promise<PobLuaStatus> {
    if (!this.startPromise) {
      this.startPromise = Promise.resolve().then(() => this.start()).catch((error) => {
        const message = error instanceof Error ? error.message : String(error)
        this.stopChild(new Error(message))
        this.status = { available: false, backend: 'wasmoon', error: message }
        return this.status
      })
    }
    return this.startPromise
  }

  private start(): Promise<PobLuaStatus> {
    const resources = this.resourcePaths()
    for (const [label, resourcePath] of Object.entries(resources)) {
      if (!existsSync(resourcePath)) throw new Error(`Missing native PoB ${label}: ${resourcePath}`)
    }

    const startedAt = Date.now()
    return new Promise<PobLuaStatus>((resolve, reject) => {
      const child = spawn(resources.executable, [resources.runner, resources.bundle, resources.projectBundle], {
        cwd: resources.bundle,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      })
      this.child = child
      this.lines = createInterface({ input: child.stdout })
      const timer = setTimeout(() => reject(new Error('LuaJIT sidecar initialization timed out')), START_TIMEOUT_MS)

      const onStartupLine = (line: string) => {
        let message: SidecarResponse
        try {
          message = JSON.parse(line) as SidecarResponse
        } catch {
          reject(new Error(`LuaJIT sidecar returned invalid startup data: ${line.slice(0, 200)}`))
          return
        }
        if (message.type !== 'ready') {
          reject(new Error('LuaJIT sidecar did not send a ready message'))
          return
        }
        if (message.protocolVersion !== PROTOCOL_VERSION) {
          reject(new Error(`LuaJIT protocol mismatch: expected ${PROTOCOL_VERSION}, got ${message.protocolVersion}`))
          return
        }
        clearTimeout(timer)
        this.lines?.removeListener('line', onStartupLine)
        this.lines?.on('line', (responseLine) => this.handleLine(responseLine))
        this.status = { available: true, backend: 'luajit', runtime: message.runtime }
        console.info(`[PoB LuaJIT] Ready in ${Date.now() - startedAt}ms (${message.runtime || 'LuaJIT'})`)
        resolve(this.status)
      }

      this.lines.on('line', onStartupLine)
      child.stderr.on('data', (chunk) => console.warn(`[PoB LuaJIT] ${String(chunk).trimEnd()}`))
      child.once('error', (error) => reject(error))
      child.once('exit', (code, signal) => {
        clearTimeout(timer)
        const error = new Error(`LuaJIT sidecar exited (${signal || code || 'unknown'})`)
        this.stopChild(error)
        this.status = { available: false, backend: 'wasmoon', error: error.message }
        this.startPromise = null
      })
    })
  }

  private handleLine(line: string): void {
    let message: SidecarResponse
    try {
      message = JSON.parse(line) as SidecarResponse
    } catch {
      this.stopChild(new Error(`LuaJIT sidecar returned invalid JSON: ${line.slice(0, 200)}`))
      return
    }
    if (typeof message.id !== 'number') return
    const request = this.pending.get(message.id)
    if (!request) return
    clearTimeout(request.timer)
    this.pending.delete(message.id)
    if (message.success) request.resolve(message.data)
    else request.reject(new Error(message.error || 'LuaJIT sidecar request failed'))
  }

  private stopChild(error: Error): void {
    for (const request of this.pending.values()) {
      clearTimeout(request.timer)
      request.reject(error)
    }
    this.pending.clear()
    this.lines?.close()
    this.lines = null
    if (this.child && !this.child.killed) this.child.kill()
    this.child = null
    this.cachedInput = null
    this.cachedResult = null
  }

  async calculate(input: {
    xml: string
    characterOnly?: boolean
    skillGroupId?: string
    calcMode?: 'UNBUFFED' | 'BUFFED' | 'COMBAT' | 'EFFECTIVE'
    activeSkillIndex?: number
    statSetIndex?: number
    actor?: 'auto' | 'player' | 'minion'
    minionSkillIndex?: number
    minionStatSetIndex?: number
    configOverrides?: Record<string, boolean | number | string>
    includeConfig?: boolean
  }): Promise<unknown> {
    const status = await this.initialize()
    if (!status.available || !this.child) throw new Error(status.error || 'LuaJIT sidecar is unavailable')
    const cacheKey = JSON.stringify(input)
    if (cacheKey === this.cachedInput) return this.cachedResult

    const result = await this.request('calculate', input)
    this.cachedInput = cacheKey
    this.cachedResult = result
    return result
  }

  async calculateAttributeProbeBatch(input: AttributeProbeBatchInput): Promise<unknown> {
    const status = await this.initialize()
    if (!status.available || !this.child) throw new Error(status.error || 'LuaJIT sidecar is unavailable')
    return this.request('calculateAttributeProbeBatch', input)
  }

  async rankSkills(input: {
    xml: string
    groupIds: string[]
    configOverrides?: Record<string, boolean | number | string>
  }): Promise<unknown> {
    const status = await this.initialize()
    if (!status.available || !this.child) throw new Error(status.error || 'LuaJIT sidecar is unavailable')
    return this.request('rankSkills', input)
  }

  async generateTradeQuery(input: {
    xml: string
    slotName: string
    configOverrides?: Record<string, boolean | number | string>
    options?: FindBetterSearchOptions
  }): Promise<unknown> {
    const status = await this.initialize()
    if (!status.available || !this.child) throw new Error(status.error || 'LuaJIT sidecar is unavailable')
    // The project-owned Lua generator reads search options from the request
    // payload itself (maxPrice, maxLevel, sockets, statWeights, ...). The
    // renderer-facing API keeps them grouped under `options`; flatten them at
    // this boundary so those filters are actually included in the generated
    // official-trade query. Keep the rest of the build context unchanged.
    const { options, ...context } = input
    return this.request('generateTradeQuery', {
      ...context,
      ...(options || {}),
    })
  }

  async compareEquipment(input: EquipmentDifferenceRequest & { contextKey: string }): Promise<EquipmentDifferenceResult> {
    const status = await this.initialize()
    if (!status.available || !this.child) throw new Error(status.error || 'LuaJIT sidecar is unavailable')
    return this.request('compareEquipment', input) as Promise<EquipmentDifferenceResult>
  }

  async normalizeItem(raw: string): Promise<PobItemNormalizationResult> {
    const status = await this.initialize()
    if (!status.available || !this.child) throw new Error(status.error || 'LuaJIT sidecar is unavailable')
    return this.request('normalizeItem', { raw }) as Promise<PobItemNormalizationResult>
  }

  private request(type: string, payload: unknown): Promise<unknown> {
    if (!this.child) return Promise.reject(new Error('LuaJIT sidecar is not running'))
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`LuaJIT ${type} request timed out`))
      }, REQUEST_TIMEOUT_MS)
      this.pending.set(id, { resolve, reject, timer })
      this.child?.stdin.write(`${JSON.stringify({ id, type, payload })}\n`, (error) => {
        if (!error) return
        clearTimeout(timer)
        this.pending.delete(id)
        reject(error)
      })
    })
  }

  dispose(): void {
    this.stopChild(new Error('LuaJIT sidecar stopped'))
    this.startPromise = null
  }
}

import type { CalcApiResponse, SkillCalculationSelection } from '@/types/calc'
import {
  calculateWithLuaEngine,
  compareEquipmentWithLuaEngine,
  inspectEquipmentWithLuaEngine,
  inspectJewelRadiusWithLuaEngine,
  installBuildHelpers,
  installHostCompatibility,
  rankSkillsWithLuaEngine,
  type PobLuaManifest,
} from '@/engine/pobLuaRuntime'
import type {
  EquipmentInspectionItem,
  EquipmentInspectionResult,
  EquipmentItemSemantics,
} from '@/types/equipmentSemantics'
import type { EquipmentDifferenceRequest, EquipmentDifferenceResult } from '@/equipmentDifference/types'
import { LuaFactory } from 'wasmoon'
import wasmUrl from 'wasmoon/dist/glue.wasm?url'

interface WorkerRequest {
  id: number
  type: 'init' | 'calculate' | 'inspectEquipment' | 'inspectJewelRadius' | 'rankSkills' | 'compareEquipment'
  payload?: ({ code?: string; xml?: string } & SkillCalculationSelection)
    | { items?: EquipmentInspectionItem[] }
    | EquipmentDifferenceRequest
}

interface WorkerResponse {
  id: number
  success: boolean
  data?: unknown
  error?: string
}

let initPromise: Promise<void> | null = null
let manifest: PobLuaManifest | null = null
let projectManifest: PobLuaManifest | null = null
const fileCache = new Map<string, string>()
let luaFactory: LuaFactory | null = null
let luaWasm: Awaited<ReturnType<LuaFactory['getLuaModule']>> | null = null
let lua: Awaited<ReturnType<LuaFactory['createEngine']>> | null = null
let mountedFiles = false
let initDurationMs = 0
let operationQueue = Promise.resolve()
const equipmentCache = new Map<string, EquipmentItemSemantics>()
const EQUIPMENT_ANALYSIS_SCHEMA_VERSION = '4'
const MOUNT_FETCH_CONCURRENCY = 24

const TRADE_HELPERS_PATCHES: Array<[string, string]> = [
  [
    ':gsub("{.-} to {.-}", string.format("(%s to %s)", numberPattern, numberPattern))',
    ':gsub("{.-} to {.-}", function()\n\t\t\t\treturn string.format("(%s to %s)", numberPattern, numberPattern)\n\t\t\tend)',
  ],
  [
    '"%%%+%?(%%%-%?" .. numberPattern .. ")")',
    'function()\n\t\t\t\t\treturn "%%%+%?(%%%-%?" .. numberPattern .. ")"\n\t\t\t\tend)',
  ],
]

function applyBrowserCompatibility(path: string, source: string): string {
  let patched = source
  if (path === 'Classes/TradeHelpers.lua') {
    for (const [original, replacement] of TRADE_HELPERS_PATCHES) {
      if (!patched.includes(original)) throw new Error(`Browser compatibility patch no longer matches: ${path}`)
      patched = patched.replace(original, replacement)
    }
  }
  if (path === 'Modules/CalcOffence.lua') {
    for (const expression of ['entry.distance', 'entry.capped', 'entry.excess']) {
      const original = `string.len(${expression})`
      const replacement = `string.len(tostring(${expression}))`
      if (!patched.includes(original)) throw new Error(`Browser compatibility patch no longer matches: ${path}`)
      patched = patched.split(original).join(replacement)
    }
  }
  return patched
}

function assetUrl(bundle: 'pob-lua' | 'superpoe-lua', path: string): string {
  if (self.location.protocol === 'file:') {
    return new URL(`../${bundle}/${path}`, self.location.href).href
  }
  return new URL(`/${bundle}/${path}`, self.location.origin).href
}

function respond(message: WorkerResponse) {
  self.postMessage(message)
}

async function fetchText(bundle: 'pob-lua' | 'superpoe-lua', path: string): Promise<string> {
  const cacheKey = `${bundle}:${path}`
  const cached = fileCache.get(cacheKey)
  if (cached != null) return cached
  const response = await fetch(assetUrl(bundle, path))
  if (!response.ok) throw new Error(`Missing ${bundle} file: ${path}`)
  const text = await response.text()
  fileCache.set(cacheKey, text)
  return text
}

async function loadManifest(bundle: 'pob-lua' | 'superpoe-lua'): Promise<PobLuaManifest> {
  if (bundle === 'pob-lua' && manifest) return manifest
  if (bundle === 'superpoe-lua' && projectManifest) return projectManifest
  const response = await fetch(assetUrl(bundle, 'manifest.json'))
  if (!response.ok) {
    throw new Error(`Missing /${bundle}/manifest.json. Run python scripts/build_pob_lua_bundle.py first.`)
  }
  const loaded = await response.json() as PobLuaManifest
  if (bundle === 'pob-lua') manifest = loaded
  else projectManifest = loaded
  return loaded
}

async function init(): Promise<void> {
  if (!initPromise) {
    initPromise = (async () => {
      const startedAt = performance.now()
      const loadedManifest = await loadManifest('pob-lua')
      const loadedProjectManifest = await loadManifest('superpoe-lua')
      const required = new Set(['HeadlessWrapper.lua', 'Launch.lua'])
      for (const file of required) {
        if (!loadedManifest.files.some((entry) => entry.path === file)) {
          throw new Error(`Lua bundle missing required file: ${file}`)
        }
      }
      if (loadedProjectManifest.name !== 'superpoe') {
        throw new Error('Invalid /superpoe-lua/manifest.json')
      }

      luaFactory = new LuaFactory(wasmUrl)
      luaWasm = await luaFactory.getLuaModule()
      await mountBundleFiles(loadedManifest, loadedProjectManifest)
      lua = await luaFactory.createEngine()
      installHostCompatibility(lua)
      lua.doFileSync('/HeadlessWrapper.lua')
      installBuildHelpers(lua)
      initDurationMs = performance.now() - startedAt
    })()
  }
  return initPromise
}

async function mountBundleFiles(loadedManifest: PobLuaManifest, loadedProjectManifest: PobLuaManifest): Promise<void> {
  if (!luaFactory || !luaWasm || mountedFiles) return
  const luaEntries = loadedManifest.files.filter((entry) => entry.path.endsWith('.lua'))
  for (let start = 0; start < luaEntries.length; start += MOUNT_FETCH_CONCURRENCY) {
    const batch = luaEntries.slice(start, start + MOUNT_FETCH_CONCURRENCY)
    const files = await Promise.all(batch.map(async (entry) => ({
      path: entry.path,
      text: applyBrowserCompatibility(entry.path, await fetchText('pob-lua', entry.path)),
    })))
    for (const file of files) {
      luaFactory.mountFileSync(luaWasm, `/${file.path}`, file.text)
    }
  }
  const projectEntries = loadedProjectManifest.files.filter((entry) => entry.path.endsWith('.lua'))
  for (let start = 0; start < projectEntries.length; start += MOUNT_FETCH_CONCURRENCY) {
    const batch = projectEntries.slice(start, start + MOUNT_FETCH_CONCURRENCY)
    const files = await Promise.all(batch.map(async (entry) => ({
      path: entry.path,
      text: await fetchText('superpoe-lua', entry.path),
    })))
    for (const file of files) {
      luaFactory.mountFileSync(luaWasm, `/superpoe-lua/${file.path}`, file.text)
    }
  }
  // A minimal manifest makes Launch.lua treat the runtime as repository/dev
  // mode, which disables the desktop updater in the browser worker.
  luaFactory.mountFileSync(luaWasm, '/manifest.xml', '<PoBVersion><Version number="browser"/></PoBVersion>')
  mountedFiles = true
}

async function calculate(payload: ({ code?: string; xml?: string } & SkillCalculationSelection) | undefined): Promise<CalcApiResponse> {
  if (!payload?.xml) return { success: false, error: 'Missing build XML for front-end calculation' }
  await init()
  if (!lua) return { success: false, error: 'Lua VM was not initialized' }
  return calculateWithLuaEngine(lua, payload.xml, payload)
}

async function equipmentCacheKey(raw: string): Promise<string> {
  const version = manifest?.version || 'unknown'
  const bytes = new TextEncoder().encode(`${EQUIPMENT_ANALYSIS_SCHEMA_VERSION}\0${version}\0${raw}`)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('')
}

async function inspectEquipment(payload: { items?: EquipmentInspectionItem[] } | undefined): Promise<EquipmentInspectionResult> {
  await init()
  if (!lua) throw new Error('Lua VM was not initialized')

  const items = payload?.items || []
  const output: EquipmentInspectionResult = {
    items: {},
    errors: {},
    performance: { initMs: initDurationMs, parseMs: 0, cacheHits: 0, cacheMisses: 0 },
  }
  const missing: Array<{ item: EquipmentInspectionItem; key: string }> = []

  for (const item of items) {
    const key = await equipmentCacheKey(item.raw)
    const cached = equipmentCache.get(key)
    if (cached) {
      output.items[item.id] = cached
      output.performance.cacheHits += 1
    } else {
      missing.push({ item, key })
      output.performance.cacheMisses += 1
    }
  }

  if (missing.length) {
    const startedAt = performance.now()
    const inspected = inspectEquipmentWithLuaEngine(lua, missing.map(({ item }) => item.raw))
    output.performance.parseMs = performance.now() - startedAt
    missing.forEach(({ item, key }, index) => {
      const semantics = inspected.results[index]
      if (semantics) {
        equipmentCache.set(key, semantics)
        output.items[item.id] = semantics
      } else {
        output.errors[item.id] = inspected.errors[index] || 'PoB did not return equipment semantics'
      }
    })
  }

  return output
}

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const request = event.data
  operationQueue = operationQueue.then(async () => {
    try {
      if (request.type === 'init') {
        await init()
        respond({ id: request.id, success: true })
        return
      }
      if (request.type === 'calculate') {
        const result = await calculate(request.payload as ({ code?: string; xml?: string } & SkillCalculationSelection) | undefined)
        respond({ id: request.id, success: true, data: result })
        return
      }
      if (request.type === 'inspectEquipment') {
        const result = await inspectEquipment(request.payload as { items?: EquipmentInspectionItem[] } | undefined)
        respond({ id: request.id, success: true, data: result })
        return
      }
      if (request.type === 'inspectJewelRadius') {
        const payload = request.payload as { xml?: string } | undefined
        const result = inspectJewelRadiusWithLuaEngine(lua!, payload?.xml || '')
        respond({ id: request.id, success: true, data: result })
        return
      }
      if (request.type === 'rankSkills') {
        const payload = request.payload as { xml?: string; groupIds?: string[]; configOverrides?: SkillCalculationSelection['configOverrides'] } | undefined
        const result = rankSkillsWithLuaEngine(lua!, payload?.xml || '', payload?.groupIds || [], payload?.configOverrides)
        respond({ id: request.id, success: true, data: result })
        return
      }
      if (request.type === 'compareEquipment') {
        const payload = request.payload as EquipmentDifferenceRequest & { contextKey?: string }
        const contextKey = payload?.contextKey
          || String(payload?.context?.buildRevision || '') + ':' + String(payload?.context?.activeItemSetId || '')
        const result = compareEquipmentWithLuaEngine(lua!, payload, contextKey)
        respond({ id: request.id, success: true, data: result as EquipmentDifferenceResult })
        return
      }
      respond({ id: request.id, success: false, error: `Unknown worker request: ${request.type}` })
    } catch (err) {
      respond({
        id: request.id,
        success: false,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  })
}

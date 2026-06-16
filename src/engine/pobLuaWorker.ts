import type { CalcApiResponse } from '@/types/calc'
import { calculateWithLuaEngine, installBuildHelpers, installHostCompatibility, type PobLuaManifest } from '@/engine/pobLuaRuntime'
import { LuaFactory } from 'wasmoon'
import wasmUrl from 'wasmoon/dist/glue.wasm?url'

interface WorkerRequest {
  id: number
  type: 'init' | 'calculate'
  payload?: { code?: string; xml?: string }
}

interface WorkerResponse {
  id: number
  success: boolean
  data?: unknown
  error?: string
}

let initPromise: Promise<void> | null = null
let manifest: PobLuaManifest | null = null
const fileCache = new Map<string, string>()
let luaFactory: LuaFactory | null = null
let luaWasm: Awaited<ReturnType<LuaFactory['getLuaModule']>> | null = null
let lua: Awaited<ReturnType<LuaFactory['createEngine']>> | null = null
let mountedFiles = false

function respond(message: WorkerResponse) {
  self.postMessage(message)
}

async function fetchText(path: string): Promise<string> {
  const cached = fileCache.get(path)
  if (cached != null) return cached
  const response = await fetch(`/pob-lua/${path}`)
  if (!response.ok) throw new Error(`Missing Lua bundle file: ${path}`)
  const text = await response.text()
  fileCache.set(path, text)
  return text
}

async function loadManifest(): Promise<PobLuaManifest> {
  if (manifest) return manifest
  const response = await fetch('/pob-lua/manifest.json')
  if (!response.ok) {
    throw new Error('Missing /pob-lua/manifest.json. Run python scripts/build_pob_lua_bundle.py first.')
  }
  manifest = await response.json() as PobLuaManifest
  return manifest
}

async function init(): Promise<void> {
  if (!initPromise) {
    initPromise = (async () => {
      const loadedManifest = await loadManifest()
      const required = new Set(['HeadlessWrapper.lua', 'Launch.lua'])
      for (const file of required) {
        if (!loadedManifest.files.some((entry) => entry.path === file)) {
          throw new Error(`Lua bundle missing required file: ${file}`)
        }
      }

      luaFactory = new LuaFactory(wasmUrl, { CI: 'true' })
      luaWasm = await luaFactory.getLuaModule()
      await mountBundleFiles(loadedManifest)
      lua = await luaFactory.createEngine()
      installHostCompatibility(lua)
      lua.doFileSync('/HeadlessWrapper.lua')
      installBuildHelpers(lua)
    })()
  }
  return initPromise
}

async function mountBundleFiles(loadedManifest: PobLuaManifest): Promise<void> {
  if (!luaFactory || !luaWasm || mountedFiles) return
  for (const entry of loadedManifest.files) {
    if (!entry.path.endsWith('.lua')) continue
    const text = await fetchText(entry.path)
    luaFactory.mountFileSync(luaWasm, `/${entry.path}`, text)
  }
  // A minimal manifest makes Launch.lua treat the runtime as repository/dev
  // mode, which disables the desktop updater in the browser worker.
  luaFactory.mountFileSync(luaWasm, '/manifest.xml', '<PoBVersion><Version number="browser"/></PoBVersion>')
  mountedFiles = true
}

async function calculate(payload: { code?: string; xml?: string } | undefined): Promise<CalcApiResponse> {
  if (!payload?.xml) return { success: false, error: 'Missing build XML for front-end calculation' }
  await init()
  if (!lua) return { success: false, error: 'Lua VM was not initialized' }
  return calculateWithLuaEngine(lua, payload.xml)
}

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const request = event.data
  void (async () => {
    try {
      if (request.type === 'init') {
        await init()
        respond({ id: request.id, success: true })
        return
      }
      if (request.type === 'calculate') {
        const result = await calculate(request.payload)
        respond({ id: request.id, success: true, data: result })
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
  })()
}

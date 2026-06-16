import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { LuaFactory } from 'wasmoon'
import { decodeBuildCode } from '@/engine/buildCode'
import {
  calculateWithLuaEngine,
  installBuildHelpers,
  installHostCompatibility,
  type PobLuaManifest,
} from '@/engine/pobLuaRuntime'

const rootDir = fileURLToPath(new URL('../..', import.meta.url))
const fixturePath = resolve(rootDir, 'builds/0.4_风暴编织者.build')
const luaBundleDir = resolve(rootDir, 'public/pob-lua')
const wasmPath = resolve(rootDir, 'node_modules/wasmoon/dist/glue.wasm')

let luaFactory: LuaFactory
let luaWasm: Awaited<ReturnType<LuaFactory['getLuaModule']>>
let lua: Awaited<ReturnType<LuaFactory['createEngine']>>

beforeAll(async () => {
  const manifest = JSON.parse(
    readFileSync(resolve(luaBundleDir, 'manifest.json'), 'utf8'),
  ) as PobLuaManifest

  luaFactory = new LuaFactory(wasmPath, { CI: 'true' })
  luaWasm = await luaFactory.getLuaModule()

  for (const entry of manifest.files) {
    if (!entry.path.endsWith('.lua')) continue
    luaFactory.mountFileSync(
      luaWasm,
      `/${entry.path}`,
      readFileSync(resolve(luaBundleDir, entry.path), 'utf8'),
    )
  }
  luaFactory.mountFileSync(luaWasm, '/manifest.xml', '<PoBVersion><Version number="browser"/></PoBVersion>')

  lua = await luaFactory.createEngine()
  installHostCompatibility(lua)
  lua.doStringSync('print = function(...) end')
  lua.doFileSync('/HeadlessWrapper.lua')
  installBuildHelpers(lua)
}, 30000)

afterAll(() => {
  lua?.global.close()
})

describe('PoB Lua front-end runtime', () => {
  it('calculates the Stormweaver import-code fixture', () => {
    const code = readFileSync(fixturePath, 'utf8').trim()
    const decoded = decodeBuildCode(code)

    const result = calculateWithLuaEngine(lua, decoded.xml)

    expect(result.success, result.error).toBe(true)
    expect(result.data).toBeDefined()
    expect(result.data?.CharacterLevel).toBe(100)
    expect(result.data?.ClassName).toBe('Sorceress')
    expect(result.data?.AscendClassName).toBe('Stormweaver')
    expect(result.data?.allocatedNodes).toBeGreaterThan(100)
    expect(result.data?.Str).toBeGreaterThan(70)
    expect(result.data?.Dex).toBeGreaterThan(70)
    expect(result.data?.Int).toBeGreaterThan(200)
    expect(result.data?.Life).toBeGreaterThan(1400)
    expect(result.data?.Mana).toBeGreaterThan(1800)
    expect(result.data?.EnergyShield).toBeGreaterThan(1800)
    expect(result.data?.FireResistTotal).toBeDefined()
    expect(result.data?.ColdResistTotal).toBeDefined()
    expect(result.data?.LightningResistTotal).toBeDefined()
    expect(result.data?.ChaosResistTotal).toBeDefined()
  }, 30000)
})

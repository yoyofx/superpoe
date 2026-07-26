import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { LuaFactory } from 'wasmoon'
import { decodeBuildCode } from '@/engine/buildCode'
import {
  calculateWithLuaEngine,
  inspectEquipmentWithLuaEngine,
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
  it('parses equipment semantics and distinguishes local modifiers', () => {
    const ring = [
      'Rarity: RARE',
      'Test Circle',
      'Ruby Ring',
      'Implicits: 0',
      '+30 to maximum Life',
      '+20% to Fire Resistance',
    ].join('\n')
    const weapon = [
      'Rarity: RARE',
      'Test Cry',
      'Sinister Quarterstaff',
      'Implicits: 0',
      '25% increased Attack Speed',
      '+3 to Level of all Attack Skills',
    ].join('\n')

    const result = inspectEquipmentWithLuaEngine(lua, [ring, weapon])

    expect(result.errors).toEqual({})
    expect(result.results).toHaveLength(2)
    const ringMods = result.results[0]?.lines.flatMap((line) => line.modifiers) || []
    expect(ringMods).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'Life', type: 'BASE', value: 30, scope: 'global' }),
      expect.objectContaining({ name: 'FireResist', type: 'BASE', value: 20, scope: 'global' }),
    ]))
    const weaponMods = result.results[1]?.lines.flatMap((line) => line.modifiers) || []
    expect(weaponMods).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'Speed', type: 'INC', value: 25, scope: 'local' }),
      expect.objectContaining({ type: 'BASE', value: 3, scope: 'global' }),
    ]))
  }, 30000)

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

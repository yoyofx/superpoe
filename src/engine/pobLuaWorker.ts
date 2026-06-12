import type { CalcApiResponse } from '@/types/calc'
import { LuaFactory } from 'wasmoon'
import wasmUrl from 'wasmoon/dist/glue.wasm?url'

interface PobLuaManifest {
  version: string
  files: Array<{ path: string; hash: string; size: number }>
}

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

function installHostCompatibility(engine: Awaited<ReturnType<LuaFactory['createEngine']>>) {
  engine.doStringSync(`
    arg = arg or {}
    unpack = table.unpack or unpack
    loadstring = loadstring or load
    math.atan2 = math.atan2 or math.atan
    local nativeStringFormat = string.format
    string.format = function(fmt, ...)
      local values = { ... }
      local index = 1
      fmt:gsub("%%[-+ #0]*%d*%.?%d*[di]", function()
        local value = values[index]
        if type(value) == "number" and value ~= math.floor(value) then
          values[index] = math.floor(value)
        end
        index = index + 1
      end)
      return nativeStringFormat(fmt, unpack(values))
    end
    jit = jit or { version = "wasmoon-lua5.4", off = function() end, opt = { start = function() end } }
    package.path = "/?.lua;/?/init.lua;/Classes/?.lua;/Modules/?.lua;/Data/?.lua;" .. package.path

    local nativeRequire = require
    local loaded = package.loaded

    local bit = {}
    local function normalize(value)
      value = value or 0
      if value < 0 then value = 0x100000000 + value end
      return value % 0x100000000
    end
    function bit.tobit(value)
      value = normalize(value)
      if value >= 0x80000000 then value = value - 0x100000000 end
      return value
    end
    function bit.band(a, b, ...)
      local result = normalize(a) & normalize(b)
      for i = 1, select("#", ...) do result = bit.band(result, select(i, ...)) end
      return result
    end
    function bit.bor(a, b, ...)
      local result = normalize(a) | normalize(b)
      for i = 1, select("#", ...) do result = bit.bor(result, select(i, ...)) end
      return result
    end
    function bit.bxor(a, b, ...)
      local result = normalize(a) ~ normalize(b)
      for i = 1, select("#", ...) do result = bit.bxor(result, select(i, ...)) end
      return result
    end
    function bit.bnot(a) return bit.tobit(~normalize(a)) end
    function bit.lshift(a, disp) return bit.tobit(normalize(a) << disp) end
    function bit.rshift(a, disp) return normalize(a) >> disp end
    function bit.arshift(a, disp) return bit.tobit(a) >> disp end
    bit.rol = function(a, disp)
      disp = disp % 32
      return bit.bor(bit.lshift(a, disp), bit.rshift(a, 32 - disp))
    end
    bit.ror = function(a, disp)
      disp = disp % 32
      return bit.bor(bit.rshift(a, disp), bit.lshift(a, 32 - disp))
    end
    bit.tohex = function(a, n)
      n = n or 8
      return string.sub(string.format("%08x", normalize(a)), -n)
    end
    loaded.bit = bit
    _G.bit = bit

    local utf8lib = {}
    utf8lib.len = function(s) return #s end
    utf8lib.sub = string.sub
    utf8lib.gsub = string.gsub
    utf8lib.find = string.find
    utf8lib.match = string.match
    utf8lib.reverse = string.reverse
    utf8lib.next = function(s, i, offset)
      i = i or 0
      offset = offset or 1
      local nextIndex = i + offset
      if nextIndex < 1 or nextIndex > #s + 1 then return nil end
      return nextIndex
    end
    loaded["lua-utf8"] = utf8lib
    _G.utf8 = _G.utf8 or utf8lib

    loaded["lcurl.safe"] = {}
    loaded["lua-profiler"] = false
    loaded["socket"] = loaded["socket"] or {}
    loaded["lpeg"] = false

    function require(name)
      if loaded[name] ~= nil then return loaded[name] end
      return nativeRequire(name)
    end
  `)
}

function detachLuaValue(value: unknown): unknown {
  if (value == null || typeof value !== 'object') return value

  const maybeDetachable = value as { $detach?: (dictType?: unknown) => unknown }
  if (typeof maybeDetachable.$detach === 'function') {
    return detachLuaValue(maybeDetachable.$detach())
  }

  if (value instanceof Map) {
    const numericKeys = [...value.keys()].filter((key) => typeof key === 'number') as number[]
    const isArrayLike = numericKeys.length === value.size
      && numericKeys.every((key) => Number.isInteger(key) && key >= 1 && key <= value.size)
    if (isArrayLike) {
      return numericKeys
        .sort((a, b) => a - b)
        .map((key) => detachLuaValue(value.get(key)))
    }

    const obj: Record<string, unknown> = {}
    for (const [key, nested] of value.entries()) {
      obj[String(key)] = detachLuaValue(nested)
    }
    return obj
  }

  if (Array.isArray(value)) return value.map((nested) => detachLuaValue(nested))

  const obj: Record<string, unknown> = {}
  for (const [key, nested] of Object.entries(value)) {
    obj[key] = detachLuaValue(nested)
  }
  return obj
}

const CALCULATION_SCRIPT = `
local xmlText = __pobBuildXml
if not xmlText or xmlText == "" then
  return { success = false, error = "Empty XML input" }
end

local loadOk, loadErr = pcall(loadBuildFromXML, xmlText, "browser-build")
if not loadOk then
  return { success = false, error = "loadBuildFromXML failed: " .. tostring(loadErr) }
end

if not build then
  return { success = false, error = "Build object not available after load" }
end

local mo = mainObject
if mo and mo.promptMsg then
  return { success = false, error = "Build load error: " .. tostring(mo.promptMsg) }
end

local calcOk, calcErr = pcall(function()
  local calcs = build.calcsTab and build.calcsTab.calcs
  if not calcs then
    error("calcs module not available")
  end
  return calcs.buildOutput(build, "MAIN")
end)

if not calcOk then
  return { success = false, error = "Calculation failed: " .. tostring(calcErr) }
end

local env = calcErr
local output = env and env.player and env.player.output
if not output then
  return { success = false, error = "No output data produced" }
end

local function safeNum(v)
  if v == nil then return nil end
  if type(v) ~= "number" then return v end
  if v ~= v then return nil end
  if v == math.huge or v == -math.huge then return nil end
  return v
end

local data = {
  Str = safeNum(output.Str),
  Dex = safeNum(output.Dex),
  Int = safeNum(output.Int),
  Life = safeNum(output.Life),
  LifeUnreserved = safeNum(output.LifeUnreserved),
  Mana = safeNum(output.Mana),
  ManaUnreserved = safeNum(output.ManaUnreserved),
  EnergyShield = safeNum(output.EnergyShield),
  Armour = safeNum(output.Armour),
  Evasion = safeNum(output.Evasion),
  ArmourPhysicalDamageReduction = safeNum(output.ArmourPhysicalDamageReduction),
  FireResist = safeNum(output.FireResist),
  FireResistTotal = safeNum(output.FireResistTotal),
  ColdResist = safeNum(output.ColdResist),
  ColdResistTotal = safeNum(output.ColdResistTotal),
  LightningResist = safeNum(output.LightningResist),
  LightningResistTotal = safeNum(output.LightningResistTotal),
  ChaosResist = safeNum(output.ChaosResist),
  ChaosResistTotal = safeNum(output.ChaosResistTotal),
  BlockChance = safeNum(output.BlockChance),
  SpellBlockChance = safeNum(output.SpellBlockChance),
  TotalDPS = safeNum(output.TotalDPS),
  FullDPS = safeNum(output.FullDPS),
  FullDotDPS = safeNum(output.FullDotDPS),
  AverageHit = safeNum(output.AverageHit),
  Speed = safeNum(output.Speed),
  HitSpeed = safeNum(output.HitSpeed),
  CritChance = safeNum(output.CritChance),
  CritMultiplier = safeNum(output.CritMultiplier),
  PowerChargesMax = safeNum(output.PowerChargesMax),
  FrenzyChargesMax = safeNum(output.FrenzyChargesMax),
  EnduranceChargesMax = safeNum(output.EnduranceChargesMax),
  MovementSpeedMod = safeNum(output.MovementSpeedMod),
  ActionSpeedMod = safeNum(output.ActionSpeedMod),
  Ward = safeNum(output.Ward),
  LifeRegen = safeNum(output.LifeRegen),
  ManaRegen = safeNum(output.ManaRegen),
  EnergyShieldRegen = safeNum(output.EnergyShieldRegen),
  CharacterLevel = safeNum(env.player and env.player.level),
  AscendClassName = build.ascendClassName,
  ClassName = build.className,
  allocatedNodes = build.spec and (function()
    local c = 0
    for _ in pairs(build.spec.allocNodes or {}) do c = c + 1 end
    return c
  end)() or 0,
}

if output.SkillDPS and #output.SkillDPS > 0 then
  data.SkillDPS = {}
  for _, skill in ipairs(output.SkillDPS) do
    table.insert(data.SkillDPS, {
      name = skill.name,
      dps = safeNum(skill.dps),
      count = skill.count,
      trigger = skill.trigger,
      skillPart = skill.skillPart,
    })
  end
end

return { success = true, data = data }
`

async function calculate(payload: { code?: string; xml?: string } | undefined): Promise<CalcApiResponse> {
  if (!payload?.xml) return { success: false, error: 'Missing build XML for front-end calculation' }
  await init()
  if (!lua) return { success: false, error: 'Lua VM was not initialized' }
  try {
    lua.global.set('__pobBuildXml', payload.xml)
    const result = detachLuaValue(lua.doStringSync(CALCULATION_SCRIPT)) as CalcApiResponse
    return result
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    }
  } finally {
    try {
      lua.global.set('__pobBuildXml', undefined)
    } catch {
      // Ignore cleanup errors; the next calculation will overwrite the value.
    }
  }
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

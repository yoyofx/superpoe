import type { CalcApiResponse } from '@/types/calc'
import type { EquipmentItemSemantics } from '@/types/equipmentSemantics'
import type { LuaFactory } from 'wasmoon'

type LuaEngine = Awaited<ReturnType<LuaFactory['createEngine']>>

export interface PobLuaManifest {
  version: string
  files: Array<{ path: string; hash: string; size: number }>
}

export function installHostCompatibility(engine: LuaEngine) {
  engine.doStringSync(`
    arg = arg or {}
    unpack = table.unpack or unpack
    loadstring = loadstring or load
    math.atan2 = math.atan2 or math.atan
    math.pow = math.pow or function(a, b) return a ^ b end
    local nativeStringFormat = string.format
    string.format = function(fmt, ...)
      local values = { ... }
      local index = 1
      fmt:gsub("%%[-+ #0]*%d*%.?%d*([cdiouxXfFeEgGqs])", function(spec)
        local value = values[index]
        if spec:match("[cdiouxX]") and type(value) == "number" then
          values[index] = math.tointeger(value) or math.tointeger(math.floor(value)) or 0
        end
        index = index + 1
      end)
      local ok, formatted = pcall(nativeStringFormat, fmt, unpack(values))
      if ok then
        return formatted
      end
      if tostring(formatted):match("number has no integer representation") then
        for i, value in ipairs(values) do
          if type(value) == "number" then
            values[i] = math.tointeger(value) or math.tointeger(math.floor(value)) or 0
          end
        end
        return nativeStringFormat(fmt, unpack(values))
      end
      error(formatted)
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

export function installBuildHelpers(engine: LuaEngine) {
  engine.doStringSync(`
    if mainObject and mainObject.promptMsg then
      mainObject.promptMsg = nil
    end
    if launch and launch.promptMsg then
      launch.promptMsg = nil
    end

    local function normalizeBuildXml(xmlText)
      if type(xmlText) ~= "string" then
        return xmlText
      end
      local legacyClassMap = {
        ["0_4"] = { [0] = 2, [1] = 8, [2] = 6, [3] = 9, [4] = 11, [5] = 1, [6] = 7, [7] = 10 },
        ["0_5"] = { [0] = 2, [1] = 8, [2] = 6, [3] = 9, [4] = 11, [5] = 1, [6] = 7, [7] = 10 },
      }
      return xmlText
        :gsub('secondaryAscendClassId="nil"', 'secondaryAscendClassId="0"')
        :gsub("secondaryAscendClassId='nil'", "secondaryAscendClassId='0'")
        :gsub("<Spec%s+[^>]->", function(tag)
          if tag:find("classInternalId=") then
            return tag
          end
          local treeVersion = tag:match('treeVersion="([^"]+)"') or tag:match("treeVersion='([^']+)'")
          local classIdText = tag:match('classId="([^"]+)"') or tag:match("classId='([^']+)'")
          local mappedClassId = treeVersion and classIdText and legacyClassMap[treeVersion] and legacyClassMap[treeVersion][tonumber(classIdText)]
          if not mappedClassId then
            return tag
          end
          return tag:gsub(">$", ' classInternalId="' .. mappedClassId .. '">')
        end)
    end

    build = build or (launch and launch.main and launch.main.modes and launch.main.modes["BUILD"])

    if type(loadBuildFromXML) ~= "function" then
      function loadBuildFromXML(xmlText, name)
        if not launch or not launch.main then
          error("PoB main object is not initialized")
        end
        launch.promptMsg = nil
        launch.main:SetMode("BUILD", false, name or "", normalizeBuildXml(xmlText))
        runCallback("OnFrame")
        build = launch.main.modes["BUILD"]
        if launch.promptMsg and tostring(launch.promptMsg):match("CalcOffence.lua") then
          launch.promptMsg = nil
        end
      end
    end

    if type(newBuild) ~= "function" then
      function newBuild()
        if GlobalCache and GlobalCache.cachedData then
          wipeGlobalCache()
        end
        if not launch or not launch.main then
          error("PoB main object is not initialized")
        end
        launch.promptMsg = nil
        launch.main:SetMode("BUILD", false, "Browser build")
        runCallback("OnFrame")
        build = launch.main.modes["BUILD"]
        if launch.promptMsg and tostring(launch.promptMsg):match("CalcOffence.lua") then
          launch.promptMsg = nil
        end
      end
    end
  `)
}

export function detachLuaValue(value: unknown): unknown {
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

export const CALCULATION_SCRIPT = `
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
  AscendClassName = build.spec and build.spec.curAscendClassName or build.ascendClassName,
  ClassName = build.spec and build.spec.curClassName or build.className,
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

export const EQUIPMENT_INSPECTION_SCRIPT = `
local results = {}
local errors = {}

local function scalarValue(value)
  local valueType = type(value)
  if valueType == "number" or valueType == "string" or valueType == "boolean" then
    return value
  end
  return nil
end

local function decodeFlags(value, source)
  local decoded = {}
  if type(value) ~= "number" then return decoded end
  for name, flag in pairs(source or {}) do
    if type(flag) == "number" and flag ~= 0 and not name:match("Mask$") and AND64(value, flag) == flag then
      table.insert(decoded, name)
    end
  end
  table.sort(decoded)
  return decoded
end

local function serializeTags(mod)
  local tags = {}
  for _, tag in ipairs(mod) do
    if type(tag) == "table" then
      local serialized = {}
      for key, value in pairs(tag) do
        if type(key) == "string" then
          local scalar = scalarValue(value)
          if scalar ~= nil then serialized[key] = scalar end
        end
      end
      table.insert(tags, serialized)
    end
  end
  return tags
end

local function signature(mod)
  local value = scalarValue(mod.value)
  return table.concat({
    tostring(mod.name or ""),
    tostring(mod.type or ""),
    tostring(value),
    tostring(mod.flags or 0),
    tostring(mod.keywordFlags or 0),
  }, "|")
end

local function serializeMod(mod, line, group, scope)
  return {
    name = tostring(mod.name or "Unknown"),
    type = tostring(mod.type or "Unknown"),
    value = scalarValue(mod.value),
    flags = decodeFlags(mod.flags or 0, ModFlag),
    keywordFlags = decodeFlags(mod.keywordFlags or 0, KeywordFlag),
    tags = serializeTags(mod),
    scope = scope,
    line = line,
    group = group,
  }
end

local function inspectItem(raw)
  local item = new("Item", raw)
  if not item or not item.base then
    error("PoB could not resolve the item base")
  end

  local globalCounts = {}
  local globalList = item.modList or (item.slotModList and item.slotModList[1]) or {}
  for _, mod in ipairs(globalList) do
    if mod.source == item.modSource then
      local key = signature(mod)
      globalCounts[key] = (globalCounts[key] or 0) + 1
    end
  end

  local lines = {}
  local groups = {
    { name = "enchant", values = item.enchantModLines },
    { name = "rune", values = item.runeModLines },
    { name = "implicit", values = item.implicitModLines },
    { name = "explicit", values = item.explicitModLines },
  }
  for _, group in ipairs(groups) do
    for _, modLine in ipairs(group.values or {}) do
      local entry = {
        text = tostring(modLine.line or modLine.extra or ""),
        group = group.name,
        parsed = not modLine.extra and modLine.modList ~= nil,
        modifiers = {},
      }
      for _, mod in ipairs(modLine.modList or {}) do
        local key = signature(mod)
        local isGlobal = (globalCounts[key] or 0) > 0
        if isGlobal then globalCounts[key] = globalCounts[key] - 1 end
        table.insert(entry.modifiers, serializeMod(mod, entry.text, group.name, isGlobal and "global" or "local"))
      end
      table.insert(lines, entry)
    end
  end

  return {
    baseType = item.baseName,
    itemType = item.type,
    lines = lines,
  }
end

for index = 1, (__pobEquipmentItemCount or 0) do
  local raw = _G["__pobEquipmentRaw" .. index]
  local ok, value = pcall(inspectItem, raw)
  if ok then
    results[index] = value
  else
    errors[index] = tostring(value)
  end
end

return { results = results, errors = errors }
`

interface DetachedEquipmentInspection {
  results?: unknown[]
  errors?: Record<string, string>
}

function asDetachedArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function normalizeEquipmentSemantics(value: unknown): EquipmentItemSemantics | undefined {
  if (!value || typeof value !== 'object') return undefined
  const record = value as Record<string, unknown>
  const lines = asDetachedArray(record.lines).flatMap((rawLine) => {
    if (!rawLine || typeof rawLine !== 'object') return []
    const line = rawLine as Record<string, unknown>
    const group = String(line.group || 'explicit') as EquipmentItemSemantics['lines'][number]['group']
    const text = String(line.text || '')
    const modifiers = asDetachedArray(line.modifiers).flatMap((rawModifier) => {
      if (!rawModifier || typeof rawModifier !== 'object') return []
      const modifier = rawModifier as Record<string, unknown>
      return [{
        name: String(modifier.name || 'Unknown'),
        type: String(modifier.type || 'Unknown'),
        value: typeof modifier.value === 'number' || typeof modifier.value === 'string' || typeof modifier.value === 'boolean'
          ? modifier.value
          : null,
        flags: asDetachedArray(modifier.flags).map(String),
        keywordFlags: asDetachedArray(modifier.keywordFlags).map(String),
        tags: asDetachedArray(modifier.tags).filter((tag): tag is Record<string, string | number | boolean> => Boolean(tag && typeof tag === 'object')),
        scope: modifier.scope === 'global' ? 'global' as const : 'local' as const,
        line: String(modifier.line || text),
        group,
      }]
    })
    return [{ text, group, parsed: line.parsed === true, modifiers }]
  })
  return {
    baseType: typeof record.baseType === 'string' ? record.baseType : undefined,
    itemType: typeof record.itemType === 'string' ? record.itemType : undefined,
    lines,
  }
}

export function inspectEquipmentWithLuaEngine(engine: LuaEngine, rawItems: string[]): {
  results: Array<EquipmentItemSemantics | undefined>
  errors: Record<number, string>
} {
  if (!rawItems.length) return { results: [], errors: {} }
  try {
    engine.global.set('__pobEquipmentItemCount', rawItems.length)
    rawItems.forEach((raw, index) => engine.global.set(`__pobEquipmentRaw${index + 1}`, raw))
    const detached = detachLuaValue(engine.doStringSync(EQUIPMENT_INSPECTION_SCRIPT)) as DetachedEquipmentInspection
    const results = Array.isArray(detached.results)
      ? detached.results.map(normalizeEquipmentSemantics)
      : []
    const errors: Record<number, string> = {}
    for (const [key, value] of Object.entries(detached.errors || {})) errors[Number(key) - 1] = value
    return { results, errors }
  } finally {
    try {
      engine.global.set('__pobEquipmentItemCount', undefined)
      rawItems.forEach((_raw, index) => engine.global.set(`__pobEquipmentRaw${index + 1}`, undefined))
    } catch {
      // The next inspection overwrites all input globals if cleanup fails.
    }
  }
}

export function calculateWithLuaEngine(engine: LuaEngine, xml: string): CalcApiResponse {
  if (!xml) return { success: false, error: 'Missing build XML for front-end calculation' }
  try {
    engine.global.set('__pobBuildXml', xml)
    return detachLuaValue(engine.doStringSync(CALCULATION_SCRIPT)) as CalcApiResponse
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    }
  } finally {
    try {
      engine.global.set('__pobBuildXml', undefined)
    } catch {
      // Ignore cleanup errors; the next calculation will overwrite the value.
    }
  }
}

import type { CalcApiResponse, SkillCalculationSelection } from '@/types/calc'
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
    local nativeTostring = tostring
    tostring = function(value, ...)
      if type(value) == "number" then
        local integer = math.tointeger(value)
        if integer ~= nil then
          return nativeTostring(integer)
        end
      end
      return nativeTostring(value, ...)
    end
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

    if modLib and type(modLib.parseMod) == "function" and not modLib.__browserParseModCompatible then
      local nativeParseMod = modLib.parseMod
      modLib.parseMod = function(line, ...)
        local normalizedLine = line
        if type(normalizedLine) == "string" then
          normalizedLine = normalizedLine:gsub(
            "^(%a+) Resistance is ([%+%-]?[%d%.]+)%%$",
            function(element, value)
              if element == "Fire" or element == "Cold" or element == "Lightning" or element == "Chaos" then
                return value .. "% to " .. element .. " Resistance"
              end
              return element .. " Resistance is " .. value .. "%"
            end
          )
          normalizedLine = normalizedLine:gsub(
            "^([%+%-]?[%d%.]+) to maximum Runic Ward$",
            "%1 to maximum Ward"
          )
          normalizedLine = normalizedLine:gsub(
            "^(%d+[%d%.]*)%% increased Runic Ward$",
            "%1%% increased Ward"
          )
          local prefixEffect = normalizedLine:match("^(%d+[%d%.]*)%% increased Effect of Prefixes$")
          if prefixEffect then
            return { modLib.createMod("LocalPrefixEffect", "INC", tonumber(prefixEffect)) }, nil
          end
          local suffixEffect = normalizedLine:match("^(%d+[%d%.]*)%% increased Effect of Suffixes$")
          if suffixEffect then
            return { modLib.createMod("LocalSuffixEffect", "INC", tonumber(suffixEffect)) }, nil
          end
        end
        local mods, extra = nativeParseMod(normalizedLine, ...)
        if type(extra) == "string" and not extra:find("%S") then
          extra = nil
        end
        return mods, extra
      end
      modLib.__browserParseModCompatible = true
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

  const entries = Object.entries(value)
  const numericEntries = entries
    .map(([key, nested]) => ({ key: Number(key), nested }))
    .filter(({ key }) => Number.isInteger(key) && key >= 1)
  if (numericEntries.length === entries.length
    && numericEntries.every(({ key }) => key <= entries.length)) {
    return numericEntries
      .sort((a, b) => a.key - b.key)
      .map(({ nested }) => detachLuaValue(nested))
  }

  const obj: Record<string, unknown> = {}
  for (const [key, nested] of entries) {
    obj[key] = detachLuaValue(nested)
  }
  return obj
}

export const CALCULATION_SCRIPT = `
local xmlText = __pobBuildXml
if not xmlText or xmlText == "" then
  return { success = false, error = "Empty XML input" }
end

local characterOnly = __pobCharacterOnly == true

xmlText = xmlText:gsub(
  "(Fire|Cold|Lightning|Chaos) Resistance is ([%+%-]?[%d%.]+)%%",
  "%2%% to %1 Resistance"
)

local loadOk, loadErr = pcall(loadBuildFromXML, xmlText, "browser-build")
if not loadOk then
  return { success = false, error = "loadBuildFromXML failed: " .. tostring(loadErr) }
end

build = (launch and launch.main and launch.main.modes and launch.main.modes["BUILD"]) or build
if not build then
  return { success = false, error = "Build object not available after load" }
end

local mo = mainObject or launch
if mo and mo.promptMsg then
  return { success = false, error = "Build load error: " .. tostring(mo.promptMsg) }
end

local calcOk, calcErr = pcall(function()
  local calcsTab = build.calcsTab
  if not calcsTab then
    error("calcs tab not available")
  end
  local overrides = {}
  if __pobConfigOverridesJson and __pobConfigOverridesJson ~= "" then
    overrides = require("dkjson").decode(__pobConfigOverridesJson) or {}
  end
  local hasOverrides = next(overrides) ~= nil
  if hasOverrides and build.configTab then
    local configSet = build.configTab.configSets[build.configTab.activeConfigSetId]
    for key, value in pairs(overrides or {}) do configSet.input[key] = value end
    build.configTab:BuildModList()
  end

  -- Loading a build already runs BuildOutput() in PoB's BUILD mode. The
  -- character panel only reads the MAIN output, so reuse that result when no
  -- configuration override was requested instead of calculating MAIN + CALCS
  -- and every Full DPS skill a second time.
  local mainSocketGroup = tonumber(build.mainSocketGroup) or 1
  if characterOnly and not hasOverrides and calcsTab.mainEnv
    and (tonumber(calcsTab.input.skill_number) or 1) == mainSocketGroup then
    return calcsTab.mainEnv
  end
  local validModes = { UNBUFFED = true, BUFFED = true, COMBAT = true, EFFECTIVE = true }
  if validModes[__pobCalcMode] then
    calcsTab.input.misc_buffMode = __pobCalcMode
  elseif not validModes[calcsTab.input.misc_buffMode] then
    calcsTab.input.misc_buffMode = "EFFECTIVE"
  end
  calcsTab.input.skill_number = tonumber(__pobSkillGroupId) or build.mainSocketGroup or 1

  local socketGroup = build.skillsTab and build.skillsTab.socketGroupList[calcsTab.input.skill_number]
  if socketGroup then
    local activeSkills = socketGroup.displaySkillListCalcs or socketGroup.displaySkillList
    local activeSkillIndex = tonumber(__pobActiveSkillIndex) or socketGroup.mainActiveSkillCalcs or 1
    if activeSkills and activeSkills[activeSkillIndex] then
      socketGroup.mainActiveSkillCalcs = activeSkillIndex
      local activeEffect = activeSkills[activeSkillIndex].activeEffect
      local source = activeEffect and activeEffect.srcInstance
      local statSetIndex = tonumber(__pobStatSetIndex)
      if statSetIndex and activeEffect and activeEffect.grantedEffect and activeEffect.grantedEffect.statSets[statSetIndex] then
        source.statSetCalcs = source.statSetCalcs or {}
        source.statSetCalcs[activeEffect.grantedEffect.id] = statSetIndex
      end
      local minionSkillIndex = tonumber(__pobMinionSkillIndex)
      if source and minionSkillIndex then source.skillMinionSkillCalcs = minionSkillIndex end
      local minionStatSetIndex = tonumber(__pobMinionStatSetIndex)
      if source and minionStatSetIndex and activeEffect.grantedEffect then
        source.skillMinionSkillStatSetIndexLookupCalcs = source.skillMinionSkillStatSetIndexLookupCalcs or {}
        local lookup = source.skillMinionSkillStatSetIndexLookupCalcs
        lookup[activeEffect.grantedEffect.id] = lookup[activeEffect.grantedEffect.id] or {}
        lookup[activeEffect.grantedEffect.id][minionSkillIndex or source.skillMinionSkillCalcs or 1] = minionStatSetIndex
      end
    end
  end
  if GlobalCache and GlobalCache.cachedData then wipeGlobalCache() end
  calcsTab.mainEnv = nil
  calcsTab.mainOutput = nil
  build.buildFlag = true
  calcsTab:BuildOutput()
  if __pobSkillGroupId or __pobCalcMode or __pobActiveSkillIndex or __pobStatSetIndex
    or __pobActor or __pobMinionSkillIndex or __pobMinionStatSetIndex then
    return calcsTab.calcsEnv
  end
  return calcsTab.mainEnv
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
  Spirit = safeNum(output.Spirit),
  EnergyShield = safeNum(output.EnergyShield),
  Armour = safeNum(output.Armour),
  Evasion = safeNum(output.Evasion),
  ArmourPhysicalDamageReduction = safeNum(output.ArmourPhysicalDamageReduction),
  PhysicalDamageReduction = safeNum(output.PhysicalDamageReduction),
  EvadeChance = safeNum(output.EvadeChance),
  DeflectChance = safeNum(output.DeflectChance),
  DeflectEffect = safeNum(output.DeflectEffect),
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
  EffectiveBlockChance = safeNum(output.EffectiveBlockChance),
  TotalDPS = safeNum(output.TotalDPS),
  FullDPS = safeNum(output.FullDPS),
  FullDotDPS = safeNum(output.FullDotDPS),
  GemLevel = safeNum(output.GemLevel),
  AverageHit = safeNum(output.AverageHit),
  Speed = safeNum(output.Speed),
  HitSpeed = safeNum(output.HitSpeed),
  CritChance = safeNum(output.CritChance),
  CritMultiplier = safeNum(output.CritMultiplier),
  PowerChargesMax = safeNum(output.PowerChargesMax),
  FrenzyChargesMax = safeNum(output.FrenzyChargesMax),
  EnduranceChargesMax = safeNum(output.EnduranceChargesMax),
  MovementSpeedMod = safeNum(output.MovementSpeedMod),
  EffectiveMovementSpeedMod = safeNum(output.EffectiveMovementSpeedMod),
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

local mainSkill = env.player and env.player.mainSkill
if output.GemLevel ~= nil then
  data.SkillLevel = safeNum(output.GemLevel)
elseif output.TotalDPS ~= nil and mainSkill and mainSkill.activeEffect then
  data.SkillLevel = safeNum((mainSkill.activeEffect.srcInstance and mainSkill.activeEffect.srcInstance.level) or mainSkill.activeEffect.level)
end

local function scalar(value)
  local valueType = type(value)
  if valueType == "string" or valueType == "number" or valueType == "boolean" then return value end
  return nil
end

local function readConfigSnapshot()
  local configTab = build and build.configTab
  if not configTab then return nil end
  local configSet = configTab.configSets[configTab.activeConfigSetId]
  if not configSet then return nil end
  local snapshot = {
    activeConfigSetId = configTab.activeConfigSetId,
    activeConfigSetTitle = configSet.title or "Default",
    sections = {},
    options = {},
  }
  local section = "General"
  local seenSections = {}
  for _, varData in ipairs(LoadModule("Modules/ConfigOptions")) do
    if varData.section then
      section = StripEscapes(varData.section)
      if not seenSections[section] then
        seenSections[section] = true
        table.insert(snapshot.sections, section)
      end
    elseif varData.var and varData.type then
      local control = configTab.varControls[varData.var]
      local visible = true
      if control then
        local shownOk, shown = pcall(function() return control:GetProperty("shown") end)
        visible = shownOk and not not shown
      end
      local current = scalar(configSet.input[varData.var])
      local defaultValue = scalar(configTab:GetDefaultState(varData.var, type(current)))
      local option = {
        key = varData.var,
        section = section,
        type = varData.type,
        label = StripEscapes(varData.label or varData.var),
        visible = visible,
        valid = visible or current == nil or current == defaultValue,
        value = current,
        defaultValue = defaultValue,
        placeholder = scalar(configSet.placeholder[varData.var]),
      }
      if type(varData.tooltip) == "string" then option.tooltip = StripEscapes(varData.tooltip) end
      if type(varData.list) == "table" then
        option.choices = {}
        for _, choice in ipairs(varData.list) do
          local value = scalar(type(choice) == "table" and choice.val or choice)
          if value ~= nil then
            table.insert(option.choices, {
              value = value,
              label = StripEscapes(type(choice) == "table" and choice.label or tostring(choice)),
            })
          end
        end
      end
      table.insert(snapshot.options, option)
    end
  end
  return snapshot
end

if not characterOnly and output.SkillDPS and #output.SkillDPS > 0 then
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

if not characterOnly then
local playerMainSkill = mainSkill
if playerMainSkill and playerMainSkill.activeEffect then
  local calcsTab = build.calcsTab
  local socketGroup = build.skillsTab and build.skillsTab.socketGroupList[calcsTab.input.skill_number]
  local displaySkills = socketGroup and (socketGroup.displaySkillListCalcs or socketGroup.displaySkillList) or {}
  local activeSkillIndex = socketGroup and (socketGroup.mainActiveSkillCalcs or 1) or 1
  local playerActiveEffect = playerMainSkill.activeEffect
  local statSetIndex = playerActiveEffect.statSetCalcs and playerActiveEffect.statSetCalcs.index or 1
  local function hasDamage(actorOutput)
    return actorOutput and ((safeNum(actorOutput.TotalDPS) or 0) ~= 0
      or (safeNum(actorOutput.AverageHit) or 0) ~= 0
      or (safeNum(actorOutput.TotalDot) or 0) ~= 0)
  end
  local minionActor = env.minion and env.minion.mainSkill and env.minion or nil
  local playerHasDamage = hasDamage(env.player.output)
  local minionHasDamage = minionActor and hasDamage(minionActor.output) or false
  local requestedActor = __pobActor or "auto"
  local detailActor = requestedActor == "minion" and minionActor or env.player
  if requestedActor == "auto" and minionActor then
    detailActor = minionActor
  end
  local mainSkill = detailActor.mainSkill
  local activeEffect = mainSkill.activeEffect
  local actorOutput = detailActor.output or {}
  local details = {
    mode = calcsTab.input.misc_buffMode,
    actor = detailActor == minionActor and "minion" or "player",
    hasMinion = minionActor ~= nil,
    playerHasDamage = playerHasDamage,
    minionHasDamage = minionHasDamage,
    minionName = minionActor and StripEscapes(minionActor.minionData and minionActor.minionData.name or "Minion") or nil,
    activeSkillIndex = activeSkillIndex,
    activeSkills = {},
    statSetIndex = statSetIndex,
    statSets = {},
    skillType = "other",
    damageSource = "skill",
    damageTypes = {},
    dpsFormula = {},
    modifiers = {},
    skillDamage = {},
    weaponDamage = {},
    gains = {},
    gainTotals = {},
    conversions = {},
    conversionTotals = {},
    effects = { aurasAndBuffs = {}, combatBuffs = {}, cursesAndDebuffs = {} },
    averageHit = safeNum(actorOutput.AverageHit),
    speed = safeNum(actorOutput.Speed),
    totalDps = safeNum(actorOutput.TotalDPS),
    critChance = safeNum(actorOutput.CritChance),
    critMultiplier = safeNum(actorOutput.CritMultiplier),
  }
  for index, skill in ipairs(displaySkills) do
    table.insert(details.activeSkills, { index = index, label = calcsTab.calcs.getActiveSkillDisplayName(skill) })
  end
  for index, statSet in ipairs(playerActiveEffect.grantedEffect.statSets or {}) do
    table.insert(details.statSets, { index = index, label = statSet.label })
  end

  if minionActor then
    details.minionSkills = {}
    details.minionStatSets = {}
    local source = playerActiveEffect.srcInstance
    details.minionSkillIndex = source.skillMinionSkillCalcs or 1
    for index, skill in ipairs(minionActor.activeSkillList or {}) do
      table.insert(details.minionSkills, { index = index, label = StripEscapes(skill.activeEffect.grantedEffect.name) })
    end
    local minionEffect = minionActor.mainSkill.activeEffect
    details.minionStatSetIndex = minionEffect.statSetCalcs and minionEffect.statSetCalcs.index or 1
    for index, statSet in ipairs(minionEffect.grantedEffect.statSets or {}) do
      table.insert(details.minionStatSets, { index = index, label = statSet.label })
    end
  end

  local grantedEffect = activeEffect.grantedEffect
  local currentReferenceLevel = details.actor == "minion"
    and safeNum(activeEffect.level)
    or safeNum(data.SkillLevel)
  currentReferenceLevel = math.max(1, math.floor(currentReferenceLevel or 1))
  details.levelReferenceCurrent = currentReferenceLevel
  details.levelReferences = {}
  local lastReferenceLevel = math.max(40, currentReferenceLevel)
  for level = math.min(currentReferenceLevel, 40), lastReferenceLevel do
    local levelStats = grantedEffect and grantedEffect.levels and grantedEffect.levels[level]
    if levelStats then
      local reference = {
        level = level,
        requiredLevel = safeNum(levelStats.levelRequirement),
        costs = {},
        spiritReservation = safeNum(levelStats.spiritReservationFlat),
        cooldown = safeNum(levelStats.cooldown),
        storedUses = safeNum(levelStats.storedUses),
        critChance = safeNum(levelStats.critChance),
        attackSpeedMultiplier = safeNum(levelStats.attackSpeedMultiplier),
        attackTime = safeNum(levelStats.attackTime),
        baseMultiplier = safeNum(levelStats.baseMultiplier),
        statSets = {},
      }
      local costNames = {}
      for resource in pairs(levelStats.cost or {}) do table.insert(costNames, resource) end
      table.sort(costNames)
      for _, resource in ipairs(costNames) do
        table.insert(reference.costs, { resource = resource, value = safeNum(levelStats.cost[resource]) })
      end
      local instance = { level = level, quality = 0, actorLevel = levelStats.levelRequirement or level }
      for index, statSet in ipairs(grantedEffect.statSets or {}) do
        local statSetLevel = statSet.levels[level] or statSet.levels[1] or {}
        local statReference = {
          index = index,
          label = StripEscapes(statSet.label or grantedEffect.name or ""),
          critChance = safeNum(statSetLevel.critChance),
          baseMultiplier = safeNum(statSetLevel.baseMultiplier),
          damageRanges = {},
          lines = {},
        }
        local stats = calcLib.buildSkillInstanceStats(instance, grantedEffect, statSet, false)
        for _, damageType in ipairs({ "physical", "lightning", "cold", "fire", "chaos" }) do
          local minimum = 0
          local maximum = 0
          local found = false
          for statName, statValue in pairs(stats) do
            if type(statName) == "string"
              and statName:find("minimum", 1, true)
              and statName:find(damageType, 1, true)
              and statName:find("damage", 1, true) then
              local maximumName = statName:gsub("minimum", "maximum", 1)
              local minimumValue = safeNum(statValue)
              local maximumValue = safeNum(stats[maximumName])
              if minimumValue and maximumValue then
                minimum = minimum + minimumValue
                maximum = maximum + maximumValue
                found = true
              end
            end
          end
          if found then
            table.insert(statReference.damageRanges, { type = damageType, min = minimum, max = maximum })
          end
        end
        for _, description in ipairs(build.data.describeStats(stats, statSet.statDescriptionScope)) do
          local line = StripEscapes(description):gsub("^%s+", ""):gsub("%s+$", "")
          if line ~= "" then table.insert(statReference.lines, line) end
        end
        table.insert(reference.statSets, statReference)
      end
      table.insert(details.levelReferences, reference)
    end
  end

  local flags = activeEffect.statSetCalcs and activeEffect.statSetCalcs.skillFlags
    or activeEffect.statSet and activeEffect.statSet.skillFlags or {}
  local skillTypes = mainSkill.skillTypes or activeEffect.grantedEffect and activeEffect.grantedEffect.skillTypes or {}
  local isAttack = flags.attack or SkillType and skillTypes[SkillType.Attack]
  local isSpell = flags.spell or SkillType and skillTypes[SkillType.Spell]
  details.skillType = isAttack and "attack" or isSpell and "spell" or "other"
  local sourceOutput = actorOutput
  local sourceBreakdown = detailActor.breakdown or {}
  local cfg = mainSkill.skillCfg
  local weaponData
  local weaponItem
  local weaponHand
  local actor = mainSkill.actor or detailActor
  if flags.weapon1Attack and actorOutput.MainHand then
    details.damageSource = "mainHand"
    sourceOutput = actorOutput.MainHand
    sourceBreakdown = sourceBreakdown.MainHand or sourceBreakdown
    cfg = mainSkill.weapon1Cfg
    weaponData = actor and actor.weaponData1
    weaponItem = actor and actor.itemList and actor.itemList["Weapon 1"]
    weaponHand = "mainHand"
  elseif flags.weapon2Attack and actorOutput.OffHand then
    details.damageSource = "offHand"
    sourceOutput = actorOutput.OffHand
    sourceBreakdown = sourceBreakdown.OffHand or sourceBreakdown
    cfg = mainSkill.weapon2Cfg
    weaponData = actor and actor.weaponData2
    weaponItem = actor and actor.itemList and actor.itemList["Weapon 2"]
    weaponHand = "offHand"
  end
  details.averageHit = safeNum(sourceOutput.AverageHit or actorOutput.AverageHit)

  if details.skillType == "spell" then
    local skillData = mainSkill.skillData or {}
    local grantedEffectLevel = activeEffect.grantedEffectLevel or {}
    local baseMultiplier = safeNum(grantedEffectLevel.baseMultiplier or skillData.baseMultiplier) or 1
    local skillName = activeEffect.grantedEffect and activeEffect.grantedEffect.name or activeEffect.name or "Skill"
    for _, damageType in ipairs({ "Physical", "Lightning", "Cold", "Fire", "Chaos" }) do
      local min = safeNum(skillData[damageType .. "Min"]) or 0
      local max = safeNum(skillData[damageType .. "Max"]) or 0
      if min ~= 0 or max ~= 0 then
        table.insert(details.skillDamage, {
          damageType = damageType:lower(),
          min = min,
          max = max,
          source = StripEscapes(skillName),
          skillLevel = details.actor == "minion" and safeNum(activeEffect.level) or data.SkillLevel,
          baseMultiplier = baseMultiplier,
        })
      end
    end
  end

  if weaponData and weaponHand then
    for _, damageType in ipairs({ "Physical", "Lightning", "Cold", "Fire", "Chaos" }) do
      local min = safeNum(weaponData[damageType .. "Min"]) or 0
      local max = safeNum(weaponData[damageType .. "Max"]) or 0
      if min ~= 0 or max ~= 0 then
        table.insert(details.weaponDamage, {
          hand = weaponHand,
          damageType = damageType:lower(),
          min = min,
          max = max,
          source = StripEscapes(weaponItem and weaponItem.modSource or details.minionName or weaponHand),
        })
      end
    end
  end

  local modList = mainSkill.skillModList
  local function copyLines(lines)
    local result = {}
    for _, line in ipairs(lines or {}) do
      if type(line) == "string" then table.insert(result, (StripEscapes(line))) end
    end
    return result
  end
  local function splitList(value)
    local result = {}
    for entry in tostring(value or ""):gmatch("[^,]+") do
      entry = entry:match("^%s*(.-)%s*$")
      if entry ~= "" then table.insert(result, (StripEscapes(entry))) end
    end
    return result
  end
  details.critChance = safeNum(sourceOutput.CritChance or actorOutput.CritChance)
  details.critMultiplier = safeNum(sourceOutput.CritMultiplier or actorOutput.CritMultiplier)
  details.critChanceBreakdown = copyLines(sourceBreakdown.CritChance)
  details.critMultiplierBreakdown = copyLines(sourceBreakdown.CritMultiplier)
  local function addModifiers(bucket, damageType, modType, names)
    for _, entry in ipairs(modList:Tabulate(modType, cfg, unpack(names))) do
      table.insert(details.modifiers, {
        bucket = bucket,
        damageType = damageType,
        stat = entry.mod.name,
        value = safeNum(entry.value) or 0,
        source = StripEscapes(entry.mod.source or "Unknown"),
      })
    end
  end
  local function addGainModifiers(fromType, toType, stat)
    for _, entry in ipairs(modList:Tabulate("BASE", cfg, stat)) do
      table.insert(details.gains, {
        fromType = fromType,
        toType = toType,
        stat = entry.mod.name,
        value = safeNum(entry.value) or 0,
        source = StripEscapes(entry.mod.source or "Unknown"),
      })
    end
  end
  local function addConversionModifiers(fromType, toType, stat)
    for _, entry in ipairs(modList:Tabulate("BASE", cfg, stat)) do
      table.insert(details.conversions, {
        fromType = fromType,
        toType = toType,
        stat = entry.mod.name,
        value = safeNum(entry.value) or 0,
        source = StripEscapes(entry.mod.source or "Unknown"),
      })
    end
  end
  details.averageHitBreakdown = copyLines(sourceBreakdown.AverageHit)
  details.dpsFormula = copyLines(detailActor.breakdown and detailActor.breakdown.TotalDPS)
  details.effects.aurasAndBuffs = splitList(actorOutput.BuffList)
  details.effects.combatBuffs = splitList(actorOutput.CombatList)
  details.effects.cursesAndDebuffs = splitList(actorOutput.CurseList)
  local damageNames = {
    physical = { "PhysicalDamage" },
    lightning = { "LightningDamage", "ElementalDamage" },
    cold = { "ColdDamage", "ElementalDamage" },
    fire = { "FireDamage", "ElementalDamage" },
    chaos = { "ChaosDamage" },
  }
  local allMore = modList:More(cfg, "Damage")
  table.insert(details.damageTypes, {
    type = "all",
    increased = safeNum(modList:Sum("INC", cfg, "Damage")) or 0,
    more = safeNum((allMore - 1) * 100) or 0,
    hitMin = safeNum(sourceOutput.TotalMin),
    hitMax = safeNum(sourceOutput.TotalMax),
    averageHit = safeNum(sourceOutput.AverageHit or actorOutput.AverageHit),
  })
  addModifiers("increased", "all", "INC", { "Damage" })
  addModifiers("more", "all", "MORE", { "Damage" })
  local damageTypeKeys = { "physical", "lightning", "cold", "fire", "chaos" }
  for _, toType in ipairs(damageTypeKeys) do
    local toTitle = toType:sub(1, 1):upper() .. toType:sub(2)
    addGainModifiers("all", toType, "DamageAs" .. toTitle)
    addGainModifiers("all", toType, "DamageGainAs" .. toTitle)
    addGainModifiers("all", toType, "SkillDamageGainAs" .. toTitle)
    addGainModifiers("elemental", toType, "SkillElementalDamageGainAs" .. toTitle)
    addGainModifiers("nonChaos", toType, "NonChaosDamageAs" .. toTitle)
    addGainModifiers("nonChaos", toType, "NonChaosDamageGainAs" .. toTitle)
    addGainModifiers("nonChaos", toType, "SkillNonChaosDamageGainAs" .. toTitle)
    addGainModifiers("elemental", toType, "ElementalDamageGainAs" .. toTitle)
    addConversionModifiers("all", toType, "SkillDamageConvertTo" .. toTitle)
    addConversionModifiers("all", toType, "DamageConvertTo" .. toTitle)
    for _, fromType in ipairs(damageTypeKeys) do
      local fromTitle = fromType:sub(1, 1):upper() .. fromType:sub(2)
      addGainModifiers(fromType, toType, fromTitle .. "DamageAs" .. toTitle)
      addGainModifiers(fromType, toType, fromTitle .. "DamageGainAs" .. toTitle)
      addGainModifiers(fromType, toType, "Skill" .. fromTitle .. "DamageGainAs" .. toTitle)
      addConversionModifiers(fromType, toType, "Skill" .. fromTitle .. "DamageConvertTo" .. toTitle)
      addConversionModifiers(fromType, toType, fromTitle .. "DamageConvertTo" .. toTitle)
      if fromType ~= "chaos" then
        addConversionModifiers(fromType, toType, "NonChaosDamageConvertTo" .. toTitle)
      end
      if fromType == "lightning" or fromType == "cold" or fromType == "fire" then
        addGainModifiers(fromType, toType, "ElementalDamageAs" .. toTitle)
        addConversionModifiers(fromType, toType, "ElementalDamageConvertTo" .. toTitle)
      end
    end
  end
  addGainModifiers("all", "random", "DamageGainAsRandom")
  addGainModifiers("physical", "random", "PhysicalDamageGainAsRandom")
  addGainModifiers("physical", "random", "PhysicalDamageGainAsColdOrLightning")
  local randomGainMods = {}
  for _, entry in ipairs(details.gains) do
    if entry.stat == "DamageGainAsRandom" or entry.stat == "PhysicalDamageGainAsRandom" or entry.stat == "PhysicalDamageGainAsColdOrLightning" then
      table.insert(randomGainMods, entry)
    end
  end
  if #randomGainMods > 0 then
    local filteredGains = {}
    for _, entry in ipairs(details.gains) do
      local derived = false
      for _, randomEntry in ipairs(randomGainMods) do
        local prefix = randomEntry.stat == "DamageGainAsRandom" and "DamageGainAs" or "PhysicalDamageGainAs"
        local isDerivedName = entry.stat == prefix .. "Fire" or entry.stat == prefix .. "Cold" or entry.stat == prefix .. "Lightning"
        local sameValue = math.abs(entry.value - randomEntry.value) < 0.0001 or math.abs(entry.value * 3 - randomEntry.value) < 0.0001
        if entry.source == randomEntry.source and isDerivedName and sameValue then derived = true break end
      end
      if not derived then table.insert(filteredGains, entry) end
    end
    details.gains = filteredGains
  end
  local gainTable = mainSkill.gainTable or {}
  local conversionTable = mainSkill.conversionTable or {}
  for _, fromType in ipairs(damageTypeKeys) do
    local fromTitle = fromType:sub(1, 1):upper() .. fromType:sub(2)
    for _, toType in ipairs(damageTypeKeys) do
      local toTitle = toType:sub(1, 1):upper() .. toType:sub(2)
      local gain = safeNum(gainTable[fromTitle] and gainTable[fromTitle][toTitle]) or 0
      local conversion = safeNum(conversionTable[fromTitle] and conversionTable[fromTitle][toTitle]) or 0
      if gain ~= 0 then table.insert(details.gainTotals, { fromType = fromType, toType = toType, value = gain * 100 }) end
      if conversion ~= 0 then table.insert(details.conversionTotals, { fromType = fromType, toType = toType, value = conversion * 100 }) end
    end
  end
  for _, damageType in ipairs(damageTypeKeys) do
    local title = damageType:sub(1, 1):upper() .. damageType:sub(2)
    local names = damageNames[damageType]
    local more = modList:More(cfg, "Damage", unpack(names))
    local moreMin = modList:More(cfg, "Min" .. title .. "Damage")
    local moreMax = modList:More(cfg, "Max" .. title .. "Damage")
    local nonCritAverage = safeNum(sourceOutput[title .. "HitAverage"])
    local critAverage = safeNum(sourceOutput[title .. "CritAverage"])
    local critChance = (safeNum(sourceOutput.CritChance or actorOutput.CritChance) or 0) / 100
    local finalAverage
    if nonCritAverage ~= nil or critAverage ~= nil then
      finalAverage = (nonCritAverage or 0) * (1 - critChance) + (critAverage or 0) * critChance
    end
    table.insert(details.damageTypes, {
      type = damageType,
      addedMin = safeNum(modList:Sum("BASE", cfg, title .. "Min")),
      addedMax = safeNum(modList:Sum("BASE", cfg, title .. "Max")),
      increased = safeNum(modList:Sum("INC", cfg, "Damage", unpack(names))) or 0,
      more = safeNum((more - 1) * 100) or 0,
      moreMin = safeNum((moreMin - 1) * 100) or 0,
      moreMax = safeNum((moreMax - 1) * 100) or 0,
      hitMin = safeNum(sourceOutput[title .. "Min"]),
      hitMax = safeNum(sourceOutput[title .. "Max"]),
      nonCritAverage = nonCritAverage,
      critAverage = critAverage,
      finalAverage = finalAverage,
      effectiveMultiplier = safeNum(sourceOutput[title .. "EffMult"]),
      breakdown = copyLines(sourceBreakdown[title]),
      effectiveBreakdown = copyLines(sourceBreakdown[title .. "EffMult"]),
    })
    addModifiers("addedMin", damageType, "BASE", { title .. "Min" })
    addModifiers("addedMax", damageType, "BASE", { title .. "Max" })
    addModifiers("increased", damageType, "INC", names)
    addModifiers("more", damageType, "MORE", names)
    addModifiers("more", damageType, "MORE", { "Min" .. title .. "Damage", "Max" .. title .. "Damage" })
  end
  data.SkillDetails = details
end
end

if __pobIncludeConfig then data.CalculationConfig = readConfigSnapshot() end

return { success = true, data = data }
`

export const SKILL_RANKING_SCRIPT = `
local xmlText = __pobBuildXml
if not xmlText or xmlText == "" then
  return { success = false, error = "Empty XML input" }
end

xmlText = xmlText:gsub(
  "(Fire|Cold|Lightning|Chaos) Resistance is ([%+%-]?[%d%.]+)%%",
  "%2%% to %1 Resistance"
)

local loadOk, loadErr = pcall(loadBuildFromXML, xmlText, "browser-skill-ranking")
if not loadOk then
  return { success = false, error = "loadBuildFromXML failed: " .. tostring(loadErr) }
end

build = (launch and launch.main and launch.main.modes and launch.main.modes["BUILD"]) or build
if not build or not build.calcsTab then
  return { success = false, error = "Build calculation object not available after load" }
end

if __pobConfigOverridesJson and __pobConfigOverridesJson ~= "" and build.configTab then
  local overrides = require("dkjson").decode(__pobConfigOverridesJson)
  local configSet = build.configTab.configSets[build.configTab.activeConfigSetId]
  for key, value in pairs(overrides or {}) do configSet.input[key] = value end
  build.configTab:BuildModList()
end

local groupIds = require("dkjson").decode(__pobSkillGroupIdsJson or "[]") or {}
local calcsTab = build.calcsTab
calcsTab.input.misc_buffMode = "EFFECTIVE"
local entries = {}

for _, groupId in ipairs(groupIds) do
  local calculated, result = pcall(function()
    calcsTab.input.skill_number = tonumber(groupId)
    if GlobalCache and GlobalCache.cachedData then wipeGlobalCache() end
    calcsTab.mainEnv = nil
    calcsTab.mainOutput = nil
    build.buildFlag = true
    calcsTab:BuildOutput()
    local env = calcsTab.calcsEnv
    local output = env and env.player and env.player.output
    local dps = output and output.TotalDPS
    if type(dps) ~= "number" or dps ~= dps or dps == math.huge or dps == -math.huge then
      return nil
    end
    return dps
  end)
  if calculated and result ~= nil then
    table.insert(entries, { groupId = tostring(groupId), dps = result, valid = true })
  else
    table.insert(entries, {
      groupId = tostring(groupId),
      dps = 0,
      valid = false,
      error = calculated and "No effective DPS output" or tostring(result),
    })
  end
end

return { success = true, data = entries }
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

local function appendTags(target, source)
  for _, tag in ipairs(source or {}) do
    table.insert(target, tag)
  end
  return target
end

local function minionRecipient(mod)
  for _, tag in ipairs(mod) do
    if type(tag) == "table" and tag.type == "SkillType"
      and SkillType and tag.skillType == SkillType.CreatesCompanion then
      return "companion"
    end
  end
  return "minion"
end

local function skillRecipient(keyword)
  local normalized = tostring(keyword or ""):lower()
  if normalized:find("companion", 1, true) then return "companion" end
  if normalized:find("minion", 1, true) then return "minion" end
  return "player"
end

local function skillLevelTag(value)
  local tag = {
    type = "SkillLevel",
    keyword = tostring(value.keyword or "all"):lower(),
  }
  for key, requirement in pairs(value.gemRequirements or {}) do
    local scalar = scalarValue(requirement)
    if type(key) == "string" and scalar ~= nil then tag[key] = scalar end
  end
  return tag
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

local function serializeMod(mod, line, group, scope, recipient, wrapper, inheritedTags)
  local name = tostring(mod.name or "Unknown")
  local value = mod.value
  local nested = type(value) == "table" and value.mod or nil
  if name == "GemProperty" and type(value) == "table"
    and value.key == "level" and type(value.value) == "number" then
    local tags = appendTags({}, inheritedTags)
    appendTags(tags, serializeTags(mod))
    table.insert(tags, skillLevelTag(value))
    return {{
      name = "SkillLevel",
      type = "BASE",
      value = value.value,
      flags = decodeFlags(mod.flags or 0, ModFlag),
      keywordFlags = decodeFlags(mod.keywordFlags or 0, KeywordFlag),
      tags = tags,
      scope = scope,
      recipient = skillRecipient(value.keyword),
      wrapper = "GemProperty",
      line = line,
      group = group,
    }}
  end
  if (name == "MinionModifier" or name == "ExtraAura") and type(nested) == "table" then
    local nestedRecipient = name == "MinionModifier"
      and minionRecipient(mod)
      or (value.onlyAllies and "ally" or "player-and-allies")
    local tags = appendTags({}, inheritedTags)
    appendTags(tags, serializeTags(mod))
    return serializeMod(nested, line, group, scope, nestedRecipient, name, tags)
  end

  local tags = appendTags({}, inheritedTags)
  appendTags(tags, serializeTags(mod))
  return {{
    name = name,
    type = tostring(mod.type or "Unknown"),
    value = scalarValue(value),
    flags = decodeFlags(mod.flags or 0, ModFlag),
    keywordFlags = decodeFlags(mod.keywordFlags or 0, KeywordFlag),
    tags = tags,
    scope = scope,
    recipient = recipient or "player",
    wrapper = wrapper,
    line = line,
    group = group,
  }}
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
        -- Empty mod lists are PoB's "Not supported in PoB yet" lines. Keep
        -- the original text so the UI can expose them without adding them to
        -- the calculation.
        parsed = not modLine.extra and modLine.modList ~= nil and #modLine.modList > 0,
        modifiers = {},
      }
      for _, mod in ipairs(modLine.modList or {}) do
        local key = signature(mod)
        local isGlobal = (globalCounts[key] or 0) > 0
        if isGlobal then globalCounts[key] = globalCounts[key] - 1 end
        local serialized = serializeMod(mod, entry.text, group.name, isGlobal and "global" or "local")
        for _, nestedMod in ipairs(serialized) do
          table.insert(entry.modifiers, nestedMod)
        end
      end
      local level, keyword = entry.text:match("^%+(%d+) to Level of all (.-) Skills$")
      if level and keyword then
        local hasSkillLevel = false
        for _, parsedMod in ipairs(entry.modifiers) do
          if parsedMod.name == "SkillLevel" then hasSkillLevel = true end
        end
        if not hasSkillLevel then
          entry.modifiers = {}
          table.insert(entry.modifiers, {
            name = "SkillLevel",
            type = "BASE",
            value = tonumber(level),
            flags = {},
            keywordFlags = {},
            tags = {{ type = "SkillLevel", keyword = keyword:lower() }},
            scope = "global",
            recipient = skillRecipient(keyword),
            wrapper = "GemProperty",
            line = entry.text,
            group = group.name,
          })
        end
      end
      table.insert(lines, entry)
    end
  end

  return {
    baseType = item.baseName,
    itemType = item.type,
    isWeapon = item.base.weapon ~= nil,
    isArmour = item.base.armour ~= nil,
    lines = lines,
  }
end

for index = 1, (__pobEquipmentItemCount or 0) do
  local raw = _G["__pobEquipmentRaw" .. index]
  local ok, value = pcall(inspectItem, raw)
  if ok then
    results[index] = value
  else
    results[index] = false
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
        recipient: ['minion', 'companion', 'ally', 'player-and-allies', 'enemy'].includes(String(modifier.recipient))
          ? String(modifier.recipient) as EquipmentItemSemantics['lines'][number]['modifiers'][number]['recipient']
          : 'player',
        wrapper: modifier.wrapper === 'MinionModifier' || modifier.wrapper === 'ExtraAura' || modifier.wrapper === 'GemProperty'
          ? modifier.wrapper as EquipmentItemSemantics['lines'][number]['modifiers'][number]['wrapper']
          : undefined,
        line: String(modifier.line || text),
        group,
      }]
    })
    return [{ text, group, parsed: line.parsed === true, modifiers }]
  })
  return {
    baseType: typeof record.baseType === 'string' ? record.baseType : undefined,
    itemType: typeof record.itemType === 'string' ? record.itemType : undefined,
    isWeapon: record.isWeapon === true,
    isArmour: record.isArmour === true,
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

export function calculateWithLuaEngine(engine: LuaEngine, xml: string, selection: SkillCalculationSelection = {}): CalcApiResponse {
  if (!xml) return { success: false, error: 'Missing build XML for front-end calculation' }
  try {
    engine.global.set('__pobBuildXml', xml)
    engine.global.set('__pobCalcMode', selection.calcMode)
    engine.global.set('__pobSkillGroupId', selection.skillGroupId)
    engine.global.set('__pobActiveSkillIndex', selection.activeSkillIndex)
    engine.global.set('__pobStatSetIndex', selection.statSetIndex)
    engine.global.set('__pobActor', selection.actor)
    engine.global.set('__pobMinionSkillIndex', selection.minionSkillIndex)
    engine.global.set('__pobMinionStatSetIndex', selection.minionStatSetIndex)
    engine.global.set('__pobCharacterOnly', selection.characterOnly == true)
    engine.global.set('__pobConfigOverridesJson', JSON.stringify(selection.configOverrides || {}))
    engine.global.set('__pobIncludeConfig', selection.includeConfig || false)
    return detachLuaValue(engine.doStringSync(CALCULATION_SCRIPT)) as CalcApiResponse
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    }
  } finally {
    try {
      engine.global.set('__pobBuildXml', undefined)
      engine.global.set('__pobCalcMode', undefined)
      engine.global.set('__pobSkillGroupId', undefined)
      engine.global.set('__pobActiveSkillIndex', undefined)
      engine.global.set('__pobStatSetIndex', undefined)
      engine.global.set('__pobActor', undefined)
      engine.global.set('__pobMinionSkillIndex', undefined)
      engine.global.set('__pobMinionStatSetIndex', undefined)
      engine.global.set('__pobCharacterOnly', undefined)
      engine.global.set('__pobConfigOverridesJson', undefined)
      engine.global.set('__pobIncludeConfig', undefined)
    } catch {
      // Ignore cleanup errors; the next calculation will overwrite the value.
    }
  }
}

export function rankSkillsWithLuaEngine(
  engine: LuaEngine,
  xml: string,
  groupIds: string[],
  configOverrides: SkillCalculationSelection['configOverrides'] = {},
): import('@/types/calc').SkillDpsRankResponse {
  if (!xml) return { success: false, error: 'Missing build XML for skill ranking' }
  try {
    engine.global.set('__pobBuildXml', xml)
    engine.global.set('__pobSkillGroupIdsJson', JSON.stringify(groupIds))
    engine.global.set('__pobConfigOverridesJson', JSON.stringify(configOverrides))
    return detachLuaValue(engine.doStringSync(SKILL_RANKING_SCRIPT)) as import('@/types/calc').SkillDpsRankResponse
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) }
  } finally {
    try {
      engine.global.set('__pobBuildXml', undefined)
      engine.global.set('__pobSkillGroupIdsJson', undefined)
      engine.global.set('__pobConfigOverridesJson', undefined)
    } catch {
      // The next operation overwrites all ranking inputs.
    }
  }
}

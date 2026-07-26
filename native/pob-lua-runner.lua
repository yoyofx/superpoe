local debugLogging = os.getenv("SUPERPOE_LUA_DEBUG") == "1"
print = function(...)
	if not debugLogging then return end
	local values = {}
	for index = 1, select("#", ...) do
		values[index] = tostring(select(index, ...))
	end
	io.stderr:write(table.concat(values, "\t"), "\n")
	io.stderr:flush()
end

local bundlePath = arg[1]
if not bundlePath or bundlePath == "" then
	error("PoB Lua bundle path is required")
end

local separator = package.config:sub(1, 1)
local function join(left, right)
	if left:sub(-1) == separator then return left .. right end
	return left .. separator .. right
end

package.path = table.concat({
	join(bundlePath, "?.lua"),
	join(bundlePath, "?" .. separator .. "init.lua"),
	join(bundlePath, "Classes" .. separator .. "?.lua"),
	join(bundlePath, "Modules" .. separator .. "?.lua"),
	join(bundlePath, "Data" .. separator .. "?.lua"),
	package.path,
}, ";")

if jit and jit.off then jit.off() end

-- SimpleGraphic embeds this module in the original PoB2 desktop runtime.
-- Calculations only require the string-compatible surface used by Common.lua.
local utf8lib = {
	len = function(value) return #value end,
	sub = string.sub,
	gsub = string.gsub,
	find = string.find,
	match = string.match,
	reverse = string.reverse,
	next = function(value, index, offset)
		index = index or 0
		offset = offset or 1
		local nextIndex = index + offset
		if nextIndex < 1 or nextIndex > #value + 1 then return nil end
		return nextIndex
	end,
}
package.loaded["lua-utf8"] = utf8lib
_G.utf8 = utf8lib

local json = require("dkjson")

local ok, loadError = pcall(dofile, join(bundlePath, "HeadlessWrapper.lua"))
if not ok then error("PoB initialization failed: " .. tostring(loadError)) end
if jit and jit.off then jit.off() end

local function safeNum(value)
	if value == nil then return nil end
	if type(value) ~= "number" then return value end
	if value ~= value or value == math.huge or value == -math.huge then return nil end
	return value
end

local function normalizeXml(xmlText)
	return xmlText:gsub(
		"(Fire|Cold|Lightning|Chaos) Resistance is ([%+%-]?[%d%.]+)%%",
		"%2%% to %1 Resistance"
	)
end

local function calculate(payload)
	local xmlText = payload and payload.xml
	if type(xmlText) ~= "string" or xmlText == "" then
		return { success = false, error = "Empty XML input" }
	end

	local loaded, loadBuildError = pcall(loadBuildFromXML, normalizeXml(xmlText), "superpoe-build")
	if not loaded then
		return { success = false, error = "loadBuildFromXML failed: " .. tostring(loadBuildError) }
	end

	build = (launch and launch.main and launch.main.modes and launch.main.modes["BUILD"]) or build
	if not build then return { success = false, error = "Build object not available after load" } end
	if launch and launch.promptMsg then
		return { success = false, error = "Build load error: " .. tostring(launch.promptMsg) }
	end

	local calculated, envOrError = pcall(function()
		local calcsTab = build.calcsTab
		if not calcsTab then error("calcs tab not available") end
		if not calcsTab.mainEnv or not calcsTab.mainOutput then
			if GlobalCache and GlobalCache.cachedData then wipeGlobalCache() end
			calcsTab:BuildOutput()
		end
		return calcsTab.mainEnv
	end)
	if not calculated then
		return { success = false, error = "Calculation failed: " .. tostring(envOrError) }
	end

	local env = envOrError
	local output = env and env.player and env.player.output
	if not output then return { success = false, error = "No output data produced" } end

	local data = {}
	local fields = {
		"Str", "Dex", "Int", "Life", "LifeUnreserved", "Mana", "ManaUnreserved", "Spirit",
		"EnergyShield", "Armour", "Evasion", "ArmourPhysicalDamageReduction", "PhysicalDamageReduction",
		"EvadeChance", "FireResist", "FireResistTotal", "ColdResist", "ColdResistTotal",
		"LightningResist", "LightningResistTotal", "ChaosResist", "ChaosResistTotal", "BlockChance",
		"SpellBlockChance", "EffectiveBlockChance", "TotalDPS", "FullDPS", "FullDotDPS", "AverageHit",
		"Speed", "HitSpeed", "CritChance", "CritMultiplier", "PowerChargesMax", "FrenzyChargesMax",
		"EnduranceChargesMax", "MovementSpeedMod", "EffectiveMovementSpeedMod", "ActionSpeedMod", "Ward",
		"LifeRegen", "ManaRegen", "EnergyShieldRegen",
	}
	for _, field in ipairs(fields) do data[field] = safeNum(output[field]) end
	data.CharacterLevel = safeNum(env.player and env.player.level)
	data.AscendClassName = build.spec and build.spec.curAscendClassName or build.ascendClassName
	data.ClassName = build.spec and build.spec.curClassName or build.className
	data.allocatedNodes = 0
	if build.spec then
		for _ in pairs(build.spec.allocNodes or {}) do data.allocatedNodes = data.allocatedNodes + 1 end
	end

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
end

local function send(value)
	io.stdout:write(json.encode(value), "\n")
	io.stdout:flush()
end

send({ type = "ready", protocolVersion = 1, runtime = jit and jit.version or "lua" })

for line in io.lines() do
	local request, _, decodeError = json.decode(line)
	if not request then
		send({ success = false, error = "Invalid JSON request: " .. tostring(decodeError) })
	else
		local handled, result = pcall(function()
			if request.type == "calculate" then return calculate(request.payload) end
			error("Unknown request type: " .. tostring(request.type))
		end)
		if handled then
			send({ id = request.id, success = true, data = result })
		else
			send({ id = request.id, success = false, error = tostring(result) })
		end
	end
end

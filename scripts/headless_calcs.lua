-- headless_calcs.lua
-- LuaJIT script: load a PoB2 build XML and output calculation results as JSON
-- Usage: luajit headless_calcs.lua '<xml-file-path>'
--   or:  luajit headless_calcs.lua --stdin < xml-text
-- Output JSON: { success: true/false, data: {...}, error: "..." }

local json = require("dkjson") or {}
if not json.encode then
	-- Fallback simple JSON encoder
	json = {
		encode = function(t)
			local function enc(v, depth)
				if depth and depth > 20 then return 'null' end
				local dt = depth or 0
				if type(v) == "nil" then return "null"
				elseif type(v) == "boolean" then return v and "true" or "false"
				elseif type(v) == "number" then return tostring(v)
				elseif type(v) == "string" then return '"' .. v:gsub('\\', '\\\\'):gsub('"', '\\"'):gsub('\n', '\\n') .. '"'
				elseif type(v) == "table" then
					local parts = {}
					local isArr = #v > 0
					if isArr then
						for _, item in ipairs(v) do
							parts[#parts+1] = enc(item, dt+1)
						end
						return "[" .. table.concat(parts, ",") .. "]"
					end
					for k, val in pairs(v) do
						if type(k) == "string" then
							parts[#parts+1] = '"' .. k .. '":' .. enc(val, dt+1)
						end
					end
					return "{" .. table.concat(parts, ",") .. "}"
				end
				return "null"
			end
			return enc(t)
		end,
		decode = function(s)
			return load("return " .. s)()
		end
	}
end

-- Parse arguments
local useStdin = arg[1] == "--stdin"
local xmlFilePath = useStdin and nil or arg[1]
local xmlText

if useStdin then
	-- Read all from stdin
	local lines = {}
	for line in io.lines() do
		lines[#lines + 1] = line
	end
	xmlText = table.concat(lines, "\n")
elseif xmlFilePath then
	-- Read from file
	local f = io.open(xmlFilePath, "rb")
	if not f then
		io.write(json.encode({success=false, error="Cannot open file: " .. xmlFilePath}))
		os.exit(1)
	end
	xmlText = f:read("*a")
	f:close()
else
	io.write(json.encode({success=false, error="Usage: luajit headless_calcs.lua <xml-file> or --stdin"}))
	os.exit(1)
end

if not xmlText or xmlText == "" then
	io.write(json.encode({success=false, error="Empty XML input"}))
	os.exit(1)
end

-- Load HeadlessWrapper (suppress startup logging)
local _print = print
print = function() end
local headlessOk, headlessErr = pcall(dofile, "HeadlessWrapper.lua")
print = _print
if not headlessOk then
	io.write(json.encode({success=false, error="HeadlessWrapper load failed: " .. tostring(headlessErr)}))
	os.exit(1)
end

-- Load the build from XML
local loadOk, loadErr = pcall(loadBuildFromXML, xmlText, "calc-build")
if not loadOk then
	io.write(json.encode({success=false, error="loadBuildFromXML failed: " .. tostring(loadErr)}))
	os.exit(1)
end

-- Check if build loaded successfully
if not build then
	io.write(json.encode({success=false, error="Build object not available after load"}))
	os.exit(1)
end

-- Check for promptMsg (indicates startup error)
local mo = mainObject
if mo and mo.promptMsg then
	io.write(json.encode({success=false, error="Build load error: " .. tostring(mo.promptMsg)}))
	os.exit(1)
end

-- Run calculation
local calcOk, calcErr = pcall(function()
	-- Call calcs.buildOutput directly (bypasses CalcsTab UI)
	local calcs = build.calcsTab and build.calcsTab.calcs
	if not calcs then
		error("calcs module not available")
	end
	local env = calcs.buildOutput(build, "MAIN")
	return env
end)

if not calcOk then
	io.write(json.encode({success=false, error="Calculation failed: " .. tostring(calcErr)}))
	os.exit(1)
end

local env = calcErr -- pcall returns result as second value when ok=true
local output = env and env.player and env.player.output

if not output then
	io.write(json.encode({success=false, error="No output data produced"}))
	os.exit(1)
end

-- Extract key stats for JSON output
-- Helper: get a value, return null for nil/NaN/Inf
local function safeNum(v)
	if v == nil then return nil end
	if type(v) ~= "number" then return v end
	if v ~= v then return nil end -- NaN check
	if v == math.huge or v == -math.huge then return nil end
	return v
end

local result = {
	success = true,
	data = {
		-- Attributes
		Str = safeNum(output.Str),
		Dex = safeNum(output.Dex),
		Int = safeNum(output.Int),

		-- Life / Mana / ES
		Life = safeNum(output.Life),
		LifeUnreserved = safeNum(output.LifeUnreserved),
		Mana = safeNum(output.Mana),
		ManaUnreserved = safeNum(output.ManaUnreserved),
		EnergyShield = safeNum(output.EnergyShield),

		-- Defences
		Armour = safeNum(output.Armour),
		Evasion = safeNum(output.Evasion),
		ArmourPhysicalDamageReduction = safeNum(output.ArmourPhysicalDamageReduction),

		-- Resistances
		FireResist = safeNum(output.FireResist),
		FireResistTotal = safeNum(output.FireResistTotal),
		ColdResist = safeNum(output.ColdResist),
		ColdResistTotal = safeNum(output.ColdResistTotal),
		LightningResist = safeNum(output.LightningResist),
		LightningResistTotal = safeNum(output.LightningResistTotal),
		ChaosResist = safeNum(output.ChaosResist),
		ChaosResistTotal = safeNum(output.ChaosResistTotal),

		-- Block
		BlockChance = safeNum(output.BlockChance),
		SpellBlockChance = safeNum(output.SpellBlockChance),

		-- DPS
		TotalDPS = safeNum(output.TotalDPS),
		FullDPS = safeNum(output.FullDPS),
		FullDotDPS = safeNum(output.FullDotDPS),
		AverageHit = safeNum(output.AverageHit),
		Speed = safeNum(output.Speed),
		HitSpeed = safeNum(output.HitSpeed),
		CritChance = safeNum(output.CritChance),
		CritMultiplier = safeNum(output.CritMultiplier),

		-- Charges
		PowerChargesMax = safeNum(output.PowerChargesMax),
		FrenzyChargesMax = safeNum(output.FrenzyChargesMax),
		EnduranceChargesMax = safeNum(output.EnduranceChargesMax),

		-- Misc
		MovementSpeedMod = safeNum(output.MovementSpeedMod),
		ActionSpeedMod = safeNum(output.ActionSpeedMod),
		Ward = safeNum(output.Ward),

		-- Regeneration
		LifeRegen = safeNum(output.LifeRegen),
		ManaRegen = safeNum(output.ManaRegen),
		EnergyShieldRegen = safeNum(output.EnergyShieldRegen),

		-- Build info
		CharacterLevel = safeNum(env.player and env.player.level),
		AscendClassName = build.ascendClassName,
		ClassName = build.className,
		allocatedNodes = build.spec and (function() local c=0; for _ in pairs(build.spec.allocNodes or {}) do c=c+1 end; return c end)() or 0,
	},
}

-- Add SkillDPS if available
if output.SkillDPS and #output.SkillDPS > 0 then
	result.data.SkillDPS = {}
	for _, skill in ipairs(output.SkillDPS) do
		table.insert(result.data.SkillDPS, {
			name = skill.name,
			dps = safeNum(skill.dps),
			count = skill.count,
			trigger = skill.trigger,
			skillPart = skill.skillPart,
		})
	end
end

io.write(json.encode(result))
os.exit(0)

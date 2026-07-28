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

local function scalar(value)
	local valueType = type(value)
	if valueType == "string" or valueType == "number" or valueType == "boolean" then return value end
	return nil
end

local function readConfigSnapshot(build)
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
		if type(payload.configOverrides) == "table" and build.configTab then
			local configSet = build.configTab.configSets[build.configTab.activeConfigSetId]
			for key, value in pairs(payload.configOverrides) do configSet.input[key] = value end
			build.configTab:BuildModList()
		end
		local validModes = { UNBUFFED = true, BUFFED = true, COMBAT = true, EFFECTIVE = true }
		if validModes[payload.calcMode] then
			calcsTab.input.misc_buffMode = payload.calcMode
		elseif not validModes[calcsTab.input.misc_buffMode] then
			calcsTab.input.misc_buffMode = "EFFECTIVE"
		end
		calcsTab.input.skill_number = tonumber(payload.skillGroupId) or build.mainSocketGroup or 1

		local socketGroup = build.skillsTab and build.skillsTab.socketGroupList[calcsTab.input.skill_number]
		if socketGroup then
			local activeSkills = socketGroup.displaySkillListCalcs or socketGroup.displaySkillList
			local activeSkillIndex = tonumber(payload.activeSkillIndex) or socketGroup.mainActiveSkillCalcs or 1
			if activeSkills and activeSkills[activeSkillIndex] then
				socketGroup.mainActiveSkillCalcs = activeSkillIndex
				local activeEffect = activeSkills[activeSkillIndex].activeEffect
				local statSetIndex = tonumber(payload.statSetIndex)
				if statSetIndex and activeEffect and activeEffect.grantedEffect and activeEffect.grantedEffect.statSets[statSetIndex] then
					local source = activeEffect.srcInstance
					source.statSetCalcs = source.statSetCalcs or {}
					source.statSetCalcs[activeEffect.grantedEffect.id] = statSetIndex
				end
			end
		end
		if GlobalCache and GlobalCache.cachedData then wipeGlobalCache() end
		calcsTab.mainEnv = nil
		calcsTab.mainOutput = nil
		build.buildFlag = true
		calcsTab:BuildOutput()
		if payload.skillGroupId or payload.calcMode or payload.activeSkillIndex or payload.statSetIndex then
			return calcsTab.calcsEnv
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
		"EvadeChance", "DeflectChance", "DeflectEffect", "FireResist", "FireResistTotal", "ColdResist", "ColdResistTotal",
		"LightningResist", "LightningResistTotal", "ChaosResist", "ChaosResistTotal", "BlockChance",
		"SpellBlockChance", "EffectiveBlockChance", "TotalDPS", "FullDPS", "FullDotDPS", "GemLevel", "AverageHit",
		"Speed", "HitSpeed", "CritChance", "CritMultiplier", "PowerChargesMax", "FrenzyChargesMax",
		"EnduranceChargesMax", "MovementSpeedMod", "EffectiveMovementSpeedMod", "ActionSpeedMod", "Ward",
		"LifeRegen", "ManaRegen", "EnergyShieldRegen",
	}
	for _, field in ipairs(fields) do data[field] = safeNum(output[field]) end
	local mainSkill = env.player and env.player.mainSkill
	if output.GemLevel ~= nil then
		data.SkillLevel = safeNum(output.GemLevel)
	elseif output.TotalDPS ~= nil and mainSkill and mainSkill.activeEffect then
		data.SkillLevel = safeNum((mainSkill.activeEffect.srcInstance and mainSkill.activeEffect.srcInstance.level) or mainSkill.activeEffect.level)
	end
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

	local mainSkill = env.player and env.player.mainSkill
	if mainSkill and mainSkill.activeEffect then
		local calcsTab = build.calcsTab
		local socketGroup = build.skillsTab and build.skillsTab.socketGroupList[calcsTab.input.skill_number]
		local displaySkills = socketGroup and (socketGroup.displaySkillListCalcs or socketGroup.displaySkillList) or {}
		local activeSkillIndex = socketGroup and (socketGroup.mainActiveSkillCalcs or 1) or 1
		local activeEffect = mainSkill.activeEffect
		local statSetIndex = activeEffect.statSetCalcs and activeEffect.statSetCalcs.index or 1
		local details = {
			mode = calcsTab.input.misc_buffMode,
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
			effects = { aurasAndBuffs = {}, combatBuffs = {}, cursesAndDebuffs = {} },
			averageHit = safeNum(output.AverageHit),
			speed = safeNum(output.Speed),
			totalDps = safeNum(output.TotalDPS),
			critChance = safeNum(output.CritChance),
			critMultiplier = safeNum(output.CritMultiplier),
		}
		for index, skill in ipairs(displaySkills) do
			table.insert(details.activeSkills, { index = index, label = calcsTab.calcs.getActiveSkillDisplayName(skill) })
		end
		for index, statSet in ipairs(activeEffect.grantedEffect.statSets or {}) do
			table.insert(details.statSets, { index = index, label = statSet.label })
		end

		local flags = activeEffect.statSetCalcs and activeEffect.statSetCalcs.skillFlags
			or activeEffect.statSet and activeEffect.statSet.skillFlags or {}
		local skillTypes = mainSkill.skillTypes or activeEffect.grantedEffect and activeEffect.grantedEffect.skillTypes or {}
		local isAttack = flags.attack or SkillType and skillTypes[SkillType.Attack]
		local isSpell = flags.spell or SkillType and skillTypes[SkillType.Spell]
		details.skillType = isAttack and "attack" or isSpell and "spell" or "other"
		local sourceOutput = output
		local sourceBreakdown = env.player.breakdown or {}
		local cfg = mainSkill.skillCfg
		local weaponData
		local weaponItem
		local weaponHand
		local actor = mainSkill.actor or env.player
		if flags.weapon1Attack and output.MainHand then
			details.damageSource = "mainHand"
			sourceOutput = output.MainHand
			sourceBreakdown = sourceBreakdown.MainHand or sourceBreakdown
			cfg = mainSkill.weapon1Cfg
			weaponData = actor and actor.weaponData1
			weaponItem = actor and actor.itemList and actor.itemList["Weapon 1"]
			weaponHand = "mainHand"
		elseif flags.weapon2Attack and output.OffHand then
			details.damageSource = "offHand"
			sourceOutput = output.OffHand
			sourceBreakdown = sourceBreakdown.OffHand or sourceBreakdown
			cfg = mainSkill.weapon2Cfg
			weaponData = actor and actor.weaponData2
			weaponItem = actor and actor.itemList and actor.itemList["Weapon 2"]
			weaponHand = "offHand"
		end
		details.averageHit = safeNum(sourceOutput.AverageHit or output.AverageHit)

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
						skillLevel = data.SkillLevel,
						baseMultiplier = baseMultiplier,
					})
				end
			end
		end

		if weaponData and weaponItem and weaponHand then
			for _, damageType in ipairs({ "Physical", "Lightning", "Cold", "Fire", "Chaos" }) do
				local min = safeNum(weaponData[damageType .. "Min"]) or 0
				local max = safeNum(weaponData[damageType .. "Max"]) or 0
				if min ~= 0 or max ~= 0 then
					table.insert(details.weaponDamage, {
						hand = weaponHand,
						damageType = damageType:lower(),
						min = min,
						max = max,
						source = StripEscapes(weaponItem.modSource or weaponHand),
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
		details.critChance = safeNum(sourceOutput.CritChance or output.CritChance)
		details.critMultiplier = safeNum(sourceOutput.CritMultiplier or output.CritMultiplier)
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
		details.averageHitBreakdown = copyLines(sourceBreakdown.AverageHit)
		details.dpsFormula = copyLines(env.player.breakdown and env.player.breakdown.TotalDPS)
		details.effects.aurasAndBuffs = splitList(output.BuffList)
		details.effects.combatBuffs = splitList(output.CombatList)
		details.effects.cursesAndDebuffs = splitList(output.CurseList)
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
			averageHit = safeNum(sourceOutput.AverageHit or output.AverageHit),
		})
		addModifiers("increased", "all", "INC", { "Damage" })
		addModifiers("more", "all", "MORE", { "Damage" })
		for _, toType in ipairs({ "physical", "lightning", "cold", "fire", "chaos" }) do
			local toTitle = toType:sub(1, 1):upper() .. toType:sub(2)
			addGainModifiers("all", toType, "DamageGainAs" .. toTitle)
			addGainModifiers("elemental", toType, "ElementalDamageGainAs" .. toTitle)
			for _, fromType in ipairs({ "physical", "lightning", "cold", "fire", "chaos" }) do
				local fromTitle = fromType:sub(1, 1):upper() .. fromType:sub(2)
				addGainModifiers(fromType, toType, fromTitle .. "DamageGainAs" .. toTitle)
			end
		end
		addGainModifiers("all", "random", "DamageGainAsRandom")
		for _, damageType in ipairs({ "physical", "lightning", "cold", "fire", "chaos" }) do
			local title = damageType:sub(1, 1):upper() .. damageType:sub(2)
			local names = damageNames[damageType]
			local more = modList:More(cfg, unpack(names))
			table.insert(details.damageTypes, {
				type = damageType,
				addedMin = safeNum(modList:Sum("BASE", cfg, title .. "Min")),
				addedMax = safeNum(modList:Sum("BASE", cfg, title .. "Max")),
				increased = safeNum(modList:Sum("INC", cfg, unpack(names))) or 0,
				more = safeNum((more - 1) * 100) or 0,
				hitMin = safeNum(sourceOutput[title .. "Min"]),
				hitMax = safeNum(sourceOutput[title .. "Max"]),
				effectiveMultiplier = safeNum(sourceOutput[title .. "EffMult"]),
				breakdown = copyLines(sourceBreakdown[title]),
				effectiveBreakdown = copyLines(sourceBreakdown[title .. "EffMult"]),
			})
			addModifiers("addedMin", damageType, "BASE", { title .. "Min" })
			addModifiers("addedMax", damageType, "BASE", { title .. "Max" })
			addModifiers("increased", damageType, "INC", names)
			addModifiers("more", damageType, "MORE", names)
		end
		data.SkillDetails = details
	end
	if payload.includeConfig then data.CalculationConfig = readConfigSnapshot(build) end

	return { success = true, data = data }
end

local function rankSkills(payload)
	local xmlText = payload and payload.xml
	if type(xmlText) ~= "string" or xmlText == "" then
		return { success = false, error = "Empty XML input" }
	end

	local loaded, loadBuildError = pcall(loadBuildFromXML, normalizeXml(xmlText), "superpoe-skill-ranking")
	if not loaded then
		return { success = false, error = "loadBuildFromXML failed: " .. tostring(loadBuildError) }
	end

	build = (launch and launch.main and launch.main.modes and launch.main.modes["BUILD"]) or build
	if not build or not build.calcsTab then
		return { success = false, error = "Build calculation object not available after load" }
	end

	if type(payload.configOverrides) == "table" and build.configTab then
		local configSet = build.configTab.configSets[build.configTab.activeConfigSetId]
		for key, value in pairs(payload.configOverrides) do configSet.input[key] = value end
		build.configTab:BuildModList()
	end

	local calcsTab = build.calcsTab
	calcsTab.input.misc_buffMode = "EFFECTIVE"
	local entries = {}
	for _, groupId in ipairs(payload.groupIds or {}) do
		local calculated, result = pcall(function()
			calcsTab.input.skill_number = tonumber(groupId)
			if GlobalCache and GlobalCache.cachedData then wipeGlobalCache() end
			calcsTab.mainEnv = nil
			calcsTab.mainOutput = nil
			build.buildFlag = true
			calcsTab:BuildOutput()
			local env = calcsTab.calcsEnv
			local output = env and env.player and env.player.output
			return safeNum(output and output.TotalDPS)
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
			if request.type == "rankSkills" then return rankSkills(request.payload) end
			error("Unknown request type: " .. tostring(request.type))
		end)
		if handled then
			send({ id = request.id, success = true, data = result })
		else
			send({ id = request.id, success = false, error = tostring(result) })
		end
	end
end

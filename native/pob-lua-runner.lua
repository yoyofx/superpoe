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

local function displayNumber(value)
	value = safeNum(value)
	if value == nil then return nil end
	return tostring(value)
end

local function displayStat(key, values)
	local normalized = {}
	for _, value in ipairs(values or {}) do
		if value ~= nil and value ~= "" then table.insert(normalized, tostring(value)) end
	end
	if #normalized == 0 then return nil end
	return { key = key, values = normalized }
end

local function normalizeItem(payload)
	local raw = payload and payload.raw
	if type(raw) ~= "string" or raw == "" then
		return { success = false, error = "Empty PoB item input" }
	end
	local okItem, itemOrError = pcall(function() return new("Item", raw) end)
	if not okItem then
		return { success = false, error = "PoB Item parse failed: " .. tostring(itemOrError) }
	end
	local item = itemOrError
	if not item or not item.baseName then
		return { success = false, error = "PoB Item base type was not recognized" }
	end
	local tradeHelpers = LoadModule("Classes/TradeHelpers")
	local properties = {}
	local requirements = {}
	local armourData = item.armourData or {}
	local function addNumberProperty(key, value)
		local display = displayNumber(value)
		if display and tonumber(display) ~= 0 then table.insert(properties, displayStat(key, { display })) end
	end
	addNumberProperty("Armour", armourData.Armour)
	addNumberProperty("Evasion", armourData.Evasion)
	addNumberProperty("EnergyShield", armourData.EnergyShield)
	addNumberProperty("Ward", armourData.Ward)
	addNumberProperty("BlockChance", armourData.BlockChance)
	addNumberProperty("Spirit", item.spiritValue)
	addNumberProperty("CharmSlots", item.charmLimit)
	local weaponData = item.weaponData and item.weaponData[1]
	if weaponData then
		local function addDamageProperty(key, min, max)
			min, max = displayNumber(min), displayNumber(max)
			if min and max and tonumber(min) ~= 0 and tonumber(max) ~= 0 then
				table.insert(properties, displayStat(key, { min .. "-" .. max }))
			end
		end
		addDamageProperty("PhysicalDamage", weaponData.PhysicalMin, weaponData.PhysicalMax)
		addDamageProperty("FireDamage", weaponData.FireMin, weaponData.FireMax)
		addDamageProperty("ColdDamage", weaponData.ColdMin, weaponData.ColdMax)
		addDamageProperty("LightningDamage", weaponData.LightningMin, weaponData.LightningMax)
		addDamageProperty("ChaosDamage", weaponData.ChaosMin, weaponData.ChaosMax)
		if displayNumber(weaponData.CritChance) then table.insert(properties, displayStat("CriticalChance", { displayNumber(weaponData.CritChance) .. "%" })) end
		if displayNumber(weaponData.AttackRate) then table.insert(properties, displayStat("AttackRate", { displayNumber(weaponData.AttackRate) })) end
		if displayNumber(weaponData.range) then table.insert(properties, displayStat("WeaponRange", { displayNumber(weaponData.range) })) end
	end
	local itemRequirements = item.requirements or {}
	local function addRequirement(key, value)
		local display = displayNumber(value)
		if display and tonumber(display) ~= 0 then table.insert(requirements, displayStat(key, { display })) end
	end
	addRequirement("Level", itemRequirements.level)
	addRequirement("Strength", itemRequirements.strMod or itemRequirements.str)
	addRequirement("Dexterity", itemRequirements.dexMod or itemRequirements.dex)
	addRequirement("Intelligence", itemRequirements.intMod or itemRequirements.int)
	local modifiers = {}
	local displayOrder = 0
	local function appendModifiers(lines, group)
		for _, modLine in ipairs(lines or {}) do
			local text = StripEscapes(modLine.line or ""):gsub("^%s+", ""):gsub("%s+$", "")
			if text ~= "" then
				local tradeIds = {}
				local optionTradeId, tradeValue = tradeHelpers.findTradeIdOption(text, group)
				local shouldNegate = false
				if optionTradeId then
					table.insert(tradeIds, optionTradeId)
				else
					local hashes
					hashes, tradeValue, shouldNegate = tradeHelpers.findTradeHash(text)
					for _, hash in ipairs(hashes or {}) do
						table.insert(tradeIds, string.format("%s.stat_%s", group, hash))
					end
				end
				local sourceTags = {}
				for _, tag in ipairs({ "rune", "enchant", "fractured", "crafted", "desecrated", "mutated", "corrupted" }) do
					if modLine[tag] then table.insert(sourceTags, tag) end
				end
				table.insert(modifiers, {
					id = group .. "-" .. displayOrder,
					displayOrder = displayOrder,
					group = group,
					sourceTags = sourceTags,
					text = text,
					tradeStatIds = tradeIds or {},
					tradeValue = safeNum(tradeValue),
					tradeValueNegated = shouldNegate or false,
				})
				displayOrder = displayOrder + 1
			end
		end
	end
	appendModifiers(item.runeModLines, "rune")
	appendModifiers(item.enchantModLines, "enchant")
	appendModifiers(item.implicitModLines, "implicit")
	appendModifiers(item.explicitModLines, "explicit")
	local itemType = item.type or (item.base and item.base.type)
	local categorySlot
	if itemType == "Body Armour" then categorySlot = "Body Armour"
	elseif itemType == "Helmet" then categorySlot = "Helmet"
	elseif itemType == "Gloves" then categorySlot = "Gloves"
	elseif itemType == "Boots" then categorySlot = "Boots"
	elseif itemType == "Amulet" then categorySlot = "Amulet"
	elseif itemType == "Ring" then categorySlot = "Ring 1"
	elseif itemType == "Belt" then categorySlot = "Belt"
	elseif itemType == "Jewel" then categorySlot = "Jewel 1"
	elseif itemType and itemType:find("Flask") then categorySlot = itemType == "Mana Flask" and "Flask 2" or "Flask 1"
	elseif itemType == "Charm" then categorySlot = "Charm 1"
	elseif itemType then categorySlot = "Weapon 1" end
	local tradeCategory = categorySlot and tradeHelpers.getTradeCategory(categorySlot, item) or nil
	local socketParts = {}
	for line in raw:gmatch("[^\r\n]+") do
		local socketLine = line:match("^Sockets:%s*(.+)$")
		if socketLine and socketLine ~= "" then table.insert(socketParts, socketLine) end
	end
	local socketText = #socketParts > 0 and table.concat(socketParts, " ") or nil
	local socketCount = tonumber(item.itemSocketCount) or tonumber(item.jewelSocketCount) or 0
	return {
		success = true,
		item = {
			format = "pob2-item",
			raw = item:BuildRaw(),
		},
		view = {
			rarity = item.rarity or "NORMAL",
			name = item.title or item.baseName,
			baseType = item.baseName,
			itemLevel = safeNum(item.itemLevel),
			quality = safeNum(item.quality),
			sockets = socketText or (socketCount > 0 and string.rep("S ", socketCount):gsub(" $", "") or nil),
			properties = properties,
			requirements = requirements,
			corrupted = item.corrupted or false,
			identified = not item.unidentified,
			tradeCategory = tradeCategory,
			modifiers = modifiers,
		},
	}
end

local function describeSupportGems(payload)
	local runtimeData = (build and build.data) or data
	if not runtimeData or not runtimeData.skills or not runtimeData.describeStats then
		return { success = false, error = "PoB skill data is unavailable" }
	end
	local entries = {}
	for _, requestGem in ipairs(payload and payload.gems or {}) do
		local skillId = type(requestGem.skillId) == "string" and requestGem.skillId or ""
		local grantedEffect = runtimeData.skills[skillId]
		local lines = {}
		local seen = {}
		if grantedEffect and grantedEffect.support then
			local level = math.max(1, math.floor(tonumber(requestGem.level) or 1))
			local quality = math.max(0, math.floor(tonumber(requestGem.quality) or 0))
			local instance = { level = level, quality = quality, actorLevel = level }
			local levelStats = grantedEffect.levels[level] or grantedEffect.levels[1] or {}
			if levelStats.manaMultiplier and levelStats.reservationMultiplier
				and levelStats.manaMultiplier == levelStats.reservationMultiplier then
				table.insert(lines, string.format("Cost & Reservation Multiplier: %d%%", levelStats.manaMultiplier + 100))
			elseif levelStats.reservationMultiplier then
				table.insert(lines, string.format("Reservation Multiplier: %d%%", levelStats.reservationMultiplier + 100))
			elseif levelStats.manaMultiplier then
				table.insert(lines, string.format("Cost Multiplier: %d%%", levelStats.manaMultiplier + 100))
			end
			if levelStats.spiritReservationFlat then
				table.insert(lines, string.format("Additional Reservation: %d Spirit", levelStats.spiritReservationFlat))
			end
			for _, statSet in ipairs(grantedEffect.statSets or {}) do
				local stats = calcLib.buildSkillInstanceStats(instance, grantedEffect, statSet, false)
				local descriptions = runtimeData.describeStats(stats, statSet.statDescriptionScope)
				for _, description in ipairs(descriptions) do
					local line = StripEscapes(description):gsub("^%s+", ""):gsub("%s+$", "")
					if line ~= "" and not seen[line] then
						seen[line] = true
						table.insert(lines, line)
					end
				end
			end
		end
		table.insert(entries, { skillId = skillId, lines = lines })
	end
	return { success = true, data = entries }
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
				local source = activeEffect and activeEffect.srcInstance
				local statSetIndex = tonumber(payload.statSetIndex)
				if statSetIndex and activeEffect and activeEffect.grantedEffect and activeEffect.grantedEffect.statSets[statSetIndex] then
					source.statSetCalcs = source.statSetCalcs or {}
					source.statSetCalcs[activeEffect.grantedEffect.id] = statSetIndex
				end
				local minionSkillIndex = tonumber(payload.minionSkillIndex)
				if source and minionSkillIndex then source.skillMinionSkillCalcs = minionSkillIndex end
				local minionStatSetIndex = tonumber(payload.minionStatSetIndex)
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
		if payload.skillGroupId or payload.calcMode or payload.activeSkillIndex or payload.statSetIndex
			or payload.actor or payload.minionSkillIndex or payload.minionStatSetIndex then
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

	local playerMainSkill = env.player and env.player.mainSkill
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
		local requestedActor = payload.actor or "auto"
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
			if request.type == "normalizeItem" then return normalizeItem(request.payload) end
			if request.type == "calculate" then return calculate(request.payload) end
			if request.type == "rankSkills" then return rankSkills(request.payload) end
			if request.type == "describeSupportGems" then return describeSupportGems(request.payload) end
			error("Unknown request type: " .. tostring(request.type))
		end)
		if handled then
			send({ id = request.id, success = true, data = result })
		else
			send({ id = request.id, success = false, error = tostring(result) })
		end
	end
end

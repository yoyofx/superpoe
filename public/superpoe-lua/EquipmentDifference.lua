-- Project-owned PoB2 equipment comparison bridge.
-- This file intentionally does not modify the upstream PoB Lua modules.

local EquipmentDifference = {}
local MAX_SESSIONS = 8

local function safeNumber(value)
	if type(value) ~= "number" or value ~= value or value == math.huge or value == -math.huge then
		return nil
	end
	return value
end

local function scalar(value)
	local valueType = type(value)
	if valueType == "number" or valueType == "string" or valueType == "boolean" then
		return value
	end
	return nil
end

local function copyOutput(output, depth)
	if type(output) ~= "table" or (depth or 0) > 2 then
		return {}
	end
	local result = {}
	for key, value in pairs(output) do
		local valueType = type(value)
		if valueType == "number" then
			local number = safeNumber(value)
			if number ~= nil then result[key] = number end
		elseif valueType == "string" or valueType == "boolean" then
			result[key] = value
		elseif key == "Minion" and valueType == "table" then
			result[key] = copyOutput(value, (depth or 0) + 1)
		end
	end
	return result
end

local function safeCondition(condition, value, output)
	if not condition then return true end
	local ok, result = pcall(condition, value, output)
	-- PoB conditions intentionally use Lua truthiness; several upstream
	-- conditions return a numeric value rather than the literal true.
	return ok and result ~= nil and result ~= false
end

local function flagMatches(flags, flag)
	if not flag then return true end
	if type(flag) == "table" then
		for _, name in ipairs(flag) do
			if not flags[name] then return false end
		end
		return true
	end
	return flags[flag] ~= nil and flags[flag] ~= false
end

local function actorFlags(actor)
	local activeSkill = actor and actor.mainSkill
	local activeEffect = activeSkill and activeSkill.activeEffect
	local statSet = activeEffect and activeEffect.statSet
	return statSet and statSet.skillFlags or {}
end

local function compareStatList(statList, actor, baseOutput, candidateOutput, actorName)
	local result = {}
	local flags = actorFlags(actor)
	for _, statData in ipairs(statList or {}) do
		if statData.stat
			and not statData.childStat
			and statData.stat ~= "SkillDPS"
			and flagMatches(flags, statData.flag)
			and (not statData.notFlag or not flagMatches(flags, statData.notFlag))
		then
			local candidateValue = safeNumber(candidateOutput[statData.stat]) or 0
			local baseValue = safeNumber(baseOutput[statData.stat]) or 0
			local delta = candidateValue - baseValue
			if statData.stat == "FullDPS" and not candidateOutput[statData.stat] then
				delta = 0
			end
			if (delta > 0.001 or delta < -0.001)
				and (not statData.condFunc
					or safeCondition(statData.condFunc, candidateValue, candidateOutput)
					or safeCondition(statData.condFunc, baseValue, baseOutput))
			then
				local positive = (statData.lowerIsBetter and delta < 0)
					or (not statData.lowerIsBetter and delta > 0)
				local displayDelta = delta * ((statData.pc or statData.mod) and 100 or 1)
				local percent
				if statData.compPercent and candidateValue ~= 0 and baseValue ~= 0 then
					percent = candidateValue / baseValue * 100 - 100
				end
				table.insert(result, {
					key = statData.stat,
					label = statData.label or statData.stat,
					actor = actorName,
					baseValue = baseValue,
					candidateValue = candidateValue,
					delta = delta,
					displayDelta = displayDelta,
					percent = percent,
					format = statData.fmt,
					positive = positive,
					lowerIsBetter = statData.lowerIsBetter == true,
					compPercent = statData.compPercent == true,
					color = positive and "positive" or "negative",
				})
			end
		end
	end
	return result
end

local function collectDiff(build, baseOutput, candidateOutput)
	local groups = {}
	local mainEnv = build.calcsTab and build.calcsTab.mainEnv
	local playerStats = compareStatList(
		build.displayStats,
		mainEnv and mainEnv.player,
		baseOutput,
		candidateOutput,
		"player"
	)
	local minionStats = {}
	if baseOutput.Minion and candidateOutput.Minion and build.minionDisplayStats then
		minionStats = compareStatList(
			build.minionDisplayStats,
			mainEnv and mainEnv.minion,
			baseOutput.Minion,
			candidateOutput.Minion,
			"minion"
		)
	end
	for _, stat in ipairs(minionStats) do table.insert(groups, stat) end
	for _, stat in ipairs(playerStats) do table.insert(groups, stat) end
	return groups
end

local function itemIsCurrent(item, selItem, buildItemId)
	if not selItem then return false end
	if buildItemId and tostring(buildItemId) ~= "" then
		return tostring(buildItemId) == tostring(selItem.id)
	end
	return item == selItem
end

local function itemSimilar(candidate, current, isUnique, sameUnique)
	if not current then return false end
	if sameUnique then return true end
	if isUnique then return false end
	return current.rarity ~= "UNIQUE"
		and current.rarity ~= "RELIC"
		and candidate.base
		and current.base
		and candidate.base.type == current.base.type
		and candidate.base.subType == current.base.subType
end

local function weaponDps(item)
	local weaponData = item and item.weaponData and item.weaponData[1]
	return weaponData and safeNumber(weaponData.TotalDPS) or nil
end

local function sortEntries(entries)
	table.sort(entries, function(left, right)
		local leftParams = {
			left.sort.empty and 1 or 0,
			left.sort.similar and 1 or 0,
			left.sort.fullDps,
			left.sort.combinedDps,
			left.sort.totalEhp,
			left.slotLabel,
			left.slotName,
		}
		local rightParams = {
			right.sort.empty and 1 or 0,
			right.sort.similar and 1 or 0,
			right.sort.fullDps,
			right.sort.combinedDps,
			right.sort.totalEhp,
			right.slotLabel,
			right.slotName,
		}
		for index = 1, #leftParams do
			local leftValue, rightValue = leftParams[index], rightParams[index]
			if leftValue ~= nil and rightValue ~= nil then
				if leftValue > rightValue then return true end
				if leftValue < rightValue then return false end
			end
		end
		return false
	end)
end

local function getSlotLabel(slot, slotName)
	if slot and type(slot.label) == "string" then return slot.label end
	return slotName
end

local function isSlotShown(slot)
	if not slot or slot.inactive then return false end
	if type(slot.shown) == "function" then
		local ok, shown = pcall(slot.shown)
		return ok and shown ~= false
	end
	return true
end

-- The renderer keeps the PoB slot name selected by the user, while PoB uses
-- the base name for weapon set I and a "Swap" name for weapon set II. The
-- same item can legitimately be referenced by both sets, so normalize the
-- requested slot against the active item set before applying slot-only
-- filtering. This stays in the project bridge and leaves upstream Lua intact.
local function normalizeActiveSlotName(itemsTab, sourceSlotName)
	if type(sourceSlotName) ~= "string" or sourceSlotName == "" then return sourceSlotName end
	local activeSet = itemsTab and itemsTab.activeItemSet
	local useSecondWeaponSet = activeSet and activeSet.useSecondWeaponSet == true
	local weaponNumber, suffix = sourceSlotName:match("^Weapon ([12])(.*)$")
	if weaponNumber then
		local cleanSuffix = suffix:gsub("^ Swap", "")
		local activeName = "Weapon " .. weaponNumber .. (useSecondWeaponSet and " Swap" or "") .. cleanSuffix
		if itemsTab.slots and itemsTab.slots[activeName] then return activeName end
	end
	return sourceSlotName
end

-- Match PoB2's single-slot comparison path for item tooltips that do not
-- already carry a concrete slot (for example an item from the library). The
-- upstream helper prefers an equipped slot, then the first empty valid jewel
-- socket, and finally the item's primary slot.
local function setContext(build, payload)
	local itemsTab = build.itemsTab
	if not itemsTab then return end
	local context = payload.context or {}
	local itemSetId = tonumber(context.activeItemSetId)
	if itemSetId and itemsTab.itemSets[itemSetId] and itemsTab.activeItemSetId ~= itemSetId then
		itemsTab:SetActiveItemSet(itemSetId, true)
	end
	local wantedWeaponSet = tonumber(context.activeWeaponSet)
	if wantedWeaponSet == 1 or wantedWeaponSet == 2 then
		local useSecond = wantedWeaponSet == 2
		if itemsTab.activeItemSet and itemsTab.activeItemSet.useSecondWeaponSet ~= useSecond then
			itemsTab.activeItemSet.useSecondWeaponSet = useSecond
			itemsTab:PopulateSlots()
		end
	end
	if type(context.configOverrides) == "table" and build.configTab then
		local configSet = build.configTab.configSets[build.configTab.activeConfigSetId]
		if configSet then
			for key, value in pairs(context.configOverrides) do
				if scalar(value) ~= nil then configSet.input[key] = value end
			end
			build.configTab:BuildModList()
		end
	end
	if build.calcsTab then
		if context.activeSkillContext then
			local skillContext = context.activeSkillContext
			if skillContext.skillGroupId then
				build.calcsTab.input.skill_number = tonumber(skillContext.skillGroupId) or build.calcsTab.input.skill_number
			end
			local validModes = { UNBUFFED = true, BUFFED = true, COMBAT = true, EFFECTIVE = true }
			if validModes[skillContext.calcMode] then
				build.calcsTab.input.misc_buffMode = skillContext.calcMode
			end
		end
		build.calcsTab.mainEnv = nil
		build.calcsTab.mainOutput = nil
		build.buildFlag = true
		build.calcsTab:BuildOutput()
	end
end

local function loadSession(payload)
	local xmlText = payload.context and payload.context.xml
	if type(xmlText) ~= "string" or xmlText == "" then
		return nil, { code = "invalid-build", message = "Empty build XML" }
	end
	if launch then launch.promptMsg = nil end
	local loaded, loadError = pcall(loadBuildFromXML, xmlText, "superpoe-equipment-difference")
	if not loaded then
		local prompt = launch and launch.promptMsg
		if launch then launch.promptMsg = nil end
		return nil, { code = "invalid-build", message = prompt and tostring(prompt) or tostring(loadError) }
	end
	local currentBuild = launch and launch.main and launch.main.modes and launch.main.modes["BUILD"] or build
	if launch and launch.promptMsg then
		local prompt = tostring(launch.promptMsg)
		launch.promptMsg = nil
		return nil, { code = "invalid-build", message = prompt }
	end
	if not currentBuild or not currentBuild.calcsTab or not currentBuild.itemsTab then
		return nil, { code = "invalid-build", message = "Build calculation object is unavailable" }
	end
	build = currentBuild
	setContext(currentBuild, payload)
	local calcFunc, calcBase = currentBuild.calcsTab:GetMiscCalculator()
	return {
		build = currentBuild,
		calcFunc = calcFunc,
		calcBase = copyOutput(calcBase),
		baseOutput = copyOutput(calcBase),
		createdAt = os.clock(),
	}, nil
end

local function addNormalItemComparisons(session, payload, item)
	local build = session.build
	local itemsTab = build.itemsTab
	itemsTab:UpdateSockets()
	local compareSlots = {}
	local sourceSlotName = normalizeActiveSlotName(itemsTab, payload.sourceSlotName)
	local slotOnly = payload.slotOnlyTooltips == true and sourceSlotName and sourceSlotName ~= ""
	-- A Find Better request is opened from one concrete equipped item. If the
	-- build changed while the dialog was preparing its search, comparing the
	-- candidate against whatever now occupies the slot would produce plausible
	-- but incorrect DPS/EHP values. Refuse that stale snapshot instead.
	local expectedItemId = payload.context and payload.context.buildItemId
	if slotOnly and expectedItemId and tostring(expectedItemId) ~= "" then
		local sourceSlot = itemsTab.slots and itemsTab.slots[sourceSlotName]
		local actualItemId = sourceSlot and sourceSlot.selItemId
		if not actualItemId or tostring(actualItemId) ~= tostring(expectedItemId) then
			return nil, { code = "stale-context", message = "The requested slot no longer contains the selected item" }
		end
	end
	for slotName, slot in pairs(itemsTab.slots or {}) do
		if (not slotOnly or slotName == sourceSlotName)
			and itemsTab:IsItemValidForSlot(item, slotName)
			and isSlotShown(slot)
			and (not slot.weaponSet or slot.weaponSet == (itemsTab.activeItemSet.useSecondWeaponSet and 2 or 1))
		then
			table.insert(compareSlots, slot)
		end
	end
	if #compareSlots == 0 then
		return nil, { code = "no-valid-slot", message = "No valid equipment slot" }
	end

	local entries = {}
	local isUnique = item.rarity == "UNIQUE" or item.rarity == "RELIC"
	local sameUniqueCount = 0
	for _, slot in ipairs(compareSlots) do
		local selItem = itemsTab.items[slot.selItemId]
		local sameUnique = isUnique and selItem and item.name == selItem.name
		if sameUnique and item.limit then sameUniqueCount = sameUniqueCount + 1 end
		local output
		local calculated, result = pcall(function()
			return session.calcFunc({
				repSlotName = slot.slotName,
				-- Keep the override key present for removals. Lua omits a table key
				-- assigned nil, which lets PoB's calculator reuse the equipped item
				-- in some cached comparisons instead of evaluating an empty slot.
				repItem = itemIsCurrent(item, selItem, payload.candidate and payload.candidate.buildItemId)
					and new("Item", "Rarity: NORMAL\n" .. (selItem.baseName or "Gloves") .. "\nItem Level: 1\nImplicits: 0")
					or item,
			})
		end)
		if calculated then output = result end
		if output then
			local stats = collectDiff(build, session.baseOutput, output)
			local entry = {
				slotName = slot.slotName,
				slotLabel = getSlotLabel(slot, slot.slotName),
				operation = itemIsCurrent(item, selItem, payload.candidate and payload.candidate.buildItemId) and "remove" or "equip",
				replacedItemId = selItem and tostring(selItem.id) or nil,
				replacedItemName = selItem and selItem.name or nil,
				changedStats = stats,
					sort = {
						empty = not selItem or slot.selItemId == 0,
						similar = itemSimilar(item, selItem, isUnique, sameUnique),
					fullDps = safeNumber(output.FullDPS),
					combinedDps = safeNumber(output.CombinedDPS),
					totalEhp = safeNumber(output.TotalEHP),
					weaponDps = weaponDps(item),
				},
				isSameUnique = sameUnique,
			}
			table.insert(entries, entry)
		end
	end

	if isUnique and item.limit and sameUniqueCount >= item.limit then
		local filtered = {}
		for _, entry in ipairs(entries) do
			if entry.isSameUnique then table.insert(filtered, entry) end
		end
		entries = filtered
	end
	for _, entry in ipairs(entries) do entry.isSameUnique = nil end
	if #entries == 0 then
		return nil, { code = "calculation-failed", message = "No comparison output was produced" }
	end
	sortEntries(entries)
	return entries, nil
end

local function addToggleComparison(session, payload, item, kind)
	local build = session.build
	local candidateId = payload.candidate and payload.candidate.buildItemId
	local currentItem = candidateId and build.itemsTab.items[tonumber(candidateId)] or nil
	local toggleItem = currentItem or item
	local toggle = kind == "flask" and { toggleFlask = toggleItem } or { toggleCharm = toggleItem }
	local calculated, output = pcall(function() return session.calcFunc(toggle) end)
	if not calculated or not output then
		return nil, { code = "calculation-failed", message = tostring(output) }
	end
	local active = kind == "flask"
		and build.calcsTab.mainEnv
		and build.calcsTab.mainEnv.flasks
		and build.calcsTab.mainEnv.flasks[toggleItem]
		or kind == "charm"
		and build.calcsTab.mainEnv
		and build.calcsTab.mainEnv.charms
		and build.calcsTab.mainEnv.charms[toggleItem]
	local slotName = toggleItem:GetPrimarySlot()
	return {{
		slotName = slotName,
		slotLabel = slotName,
		operation = active and "toggle-off" or "toggle-on",
		changedStats = collectDiff(build, session.baseOutput, output),
		sort = { empty = false, similar = false, fullDps = safeNumber(output.FullDPS), combinedDps = safeNumber(output.CombinedDPS), totalEhp = safeNumber(output.TotalEHP) },
	}}, nil
end

local function trimSessions(sessions, keepKey)
	local count = 0
	for _, value in pairs(sessions) do
		if type(value) == "table" and value.build then count = count + 1 end
	end
	while count > MAX_SESSIONS do
		local oldestKey
		local oldestTime = math.huge
		for key, value in pairs(sessions) do
			if key ~= keepKey and type(value) == "table" and value.build
				and (value.lastUsedAt or 0) < oldestTime
			then
				oldestKey = key
				oldestTime = value.lastUsedAt or 0
			end
		end
		if not oldestKey then return end
		sessions[oldestKey] = nil
		count = count - 1
	end
end

function EquipmentDifference.compare(payload, sessions)
	if type(payload) ~= "table" or type(payload.context) ~= "table" or type(payload.candidate) ~= "table" then
		return { success = false, error = { code = "invalid-item", message = "Invalid equipment comparison request" } }
	end
	sessions = sessions or {}
	local contextKey = tostring(payload.contextKey or "")
	if contextKey == "" then contextKey = tostring(payload.context.xml) end
	local session = sessions[contextKey]
	local sessionReused = session ~= nil
	local baseStartedAt = os.clock()
	if not session then
		local errorValue
		session, errorValue = loadSession(payload)
		if not session then return { success = false, error = errorValue } end
		session.lastUsedAt = os.clock()
		sessions[contextKey] = session
		trimSessions(sessions, contextKey)
	else
		session.lastUsedAt = os.clock()
	end
	local baseCalculationMs = (os.clock() - baseStartedAt) * 1000
	local itemRaw = payload.candidate.raw
	if type(itemRaw) ~= "string" or itemRaw == "" then
		return { success = false, error = { code = "invalid-item", message = "Empty candidate item" } }
	end
	local parsed, itemOrError = pcall(function() return new("Item", itemRaw) end)
	if not parsed or not itemOrError or not itemOrError.base then
		return { success = false, error = { code = "invalid-item", message = "PoB item parse failed: " .. tostring(itemOrError) } }
	end
	local candidateStartedAt = os.clock()
	local item = itemOrError
	-- When the request identifies an equipped item, use PoB's actual item
	-- object. Parsing the same raw text into a second object can hit PoB's
	-- item/full-DPS cache as an equivalent replacement and hide the removal
	-- delta. The equipped object is only used as the identity; calculations
	-- still receive the explicit empty-slot override below.
	local candidateId = payload.candidate and payload.candidate.buildItemId
	local equippedCandidate = candidateId and session.build.itemsTab.items[tonumber(candidateId)] or nil
	if equippedCandidate and tostring(equippedCandidate.id) == tostring(candidateId) then
		item = equippedCandidate
	end
	local groups, errorValue
	if item.base.flask then
		groups, errorValue = addToggleComparison(session, payload, item, "flask")
	elseif item.base.charm then
		groups, errorValue = addToggleComparison(session, payload, item, "charm")
	else
		groups, errorValue = addNormalItemComparisons(session, payload, item)
	end
	if not groups then return { success = false, contextKey = contextKey, error = errorValue } end
	return {
		success = true,
		contextKey = contextKey,
		groups = groups,
		performance = {
			sessionReused = sessionReused,
			baseCalculationMs = baseCalculationMs,
			candidateCalculationMs = (os.clock() - candidateStartedAt) * 1000,
			cacheHit = false,
		},
	}
end

return EquipmentDifference

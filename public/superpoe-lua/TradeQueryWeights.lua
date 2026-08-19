-- Project-owned bridge for PoB2 weighted item searches.
-- The upstream TradeQueryGenerator remains untouched. This module reuses its
-- modifier catalogue and calculation methods without creating any UI popup.

local dkjson = require "dkjson"
local tradeHelpers = LoadModule("Classes/TradeHelpers")

local TradeQueryWeights = {}

local function safeNumber(value)
	if type(value) ~= "number" or value ~= value or value == math.huge or value == -math.huge then
		return nil
	end
	return value
end

local function resumeWork(co)
	while coroutine.status(co) ~= "dead" do
		local ok, err = coroutine.resume(co)
		if not ok then return false, err end
	end
	return true
end

local function findSlot(itemsTab, slotName)
	if type(slotName) ~= "string" or slotName == "" then return nil end
	if itemsTab and itemsTab.slots and itemsTab.slots[slotName] then
		return itemsTab.slots[slotName]
	end
	if itemsTab and itemsTab.sockets and itemsTab.sockets[slotName] then
		return itemsTab.sockets[slotName]
	end
	return nil
end

local function statWeights(payload)
	local configured = payload and payload.statWeights
	local result = {}
	if type(configured) == "table" then
		for _, entry in ipairs(configured) do
			local stat = type(entry) == "table" and entry.stat
			local label = type(entry) == "table" and entry.label
			local weightMult = type(entry) == "table" and safeNumber(entry.weightMult)
			if type(stat) == "string" and stat ~= "" and type(label) == "string" and label ~= "" and weightMult and weightMult > 0 then
				local lowerIsBetter = type(entry) == "table" and entry.lowerIsBetter == true
				table.insert(result, {
					label = label,
					stat = stat,
					weightMult = math.min(weightMult, 1),
					transform = lowerIsBetter and function(value) return -value end or nil,
				})
			end
		end
	end
	if #result > 0 then return result end
	return {
		{ label = "Full DPS", stat = "FullDPS", weightMult = 1.0 },
		{ label = "Effective Hit Pool", stat = "TotalEHP", weightMult = 0.5 },
	}
end

local function copyModLines(lines)
	local result = {}
	for _, modLine in ipairs(lines or {}) do
		table.insert(result, modLine)
	end
	return result
end

function TradeQueryWeights.generate(build, payload)
	if type(build) ~= "table" or not build.itemsTab or not build.calcsTab then
		return { success = false, error = "Build item calculation object is unavailable" }
	end
	local slotName = payload and payload.slotName
	local slot = findSlot(build.itemsTab, slotName)
	if not slot then
		return { success = false, error = "Equipped slot is unavailable: " .. tostring(slotName) }
	end

	local existingItem = slot.selItemId and slot.selItemId ~= 0 and build.itemsTab.items[slot.selItemId] or nil
	local itemType = existingItem and existingItem.baseName or "Diamond"
	local itemCategoryQueryStr, itemCategory = tradeHelpers.getTradeCategory(slotName, existingItem)
	if not itemCategory then
		return { success = false, error = "This equipment slot is not supported for weighted search" }
	end
	-- PoB2 uses a separate modifier catalogue for base and radius jewels. The
	-- trade API category remains simply "jewel"; only the local weight category
	-- changes.
	local isRadiusJewel = itemCategory == "Jewel" and payload and payload.jewelType == "radius"
	if itemCategory == "Jewel" then
		itemCategory = isRadiusJewel and "RadiusJewel" or "BaseJewel"
	end

	local testItemRaw = "Rarity: RARE\nStat Tester\n" .. itemType
	if isRadiusJewel then
		testItemRaw = "Rarity: RARE\nStat Tester\nTime-Lost Sapphire\nRadius: Small\nImplicits: 0"
	end
	local testItem = new("Item", testItemRaw)
	local calcFunc, baseOutput = build.calcsTab:GetMiscCalculator()
	if not calcFunc or not baseOutput then
		return { success = false, error = "Build calculation output is unavailable" }
	end

	local weights = statWeights(payload)
	local baseItemOutput = calcFunc({ repSlotName = slot.slotName, repItem = testItem })
	local generator = new("TradeQueryGenerator", { itemsTab = build.itemsTab })
	local baseStatValue = generator.WeightedRatioOutputs(baseOutput, baseItemOutput, weights) * 1000
	local options = {
		statWeights = weights,
		-- PoB2 disables corruption weights when the equipped item is already
		-- corrupted. Preserve the same constraint even if the UI sends true.
		includeCorrupted = not (existingItem and existingItem.corrupted == true)
			and (not payload or payload.includeCorrupted ~= false),
		includeRunes = not payload or payload.runeBehavior == "keep",
		-- PoB2's checkbox defaults to including mirrored items.
		includeMirrored = not payload or payload.includeMirrored ~= false,
		jewelType = payload and payload.jewelType == "radius" and "Radius" or nil,
		requiredMods = {},
	}

	generator.modWeights = {}
	generator.alreadyWeightedMods = {}
	generator.tradeTypeIndex = 1
	generator.calcContext = {
		itemCategoryQueryStr = itemCategoryQueryStr,
		itemCategory = itemCategory,
		special = {},
		testItem = testItem,
		baseOutput = baseOutput,
		baseStatValue = baseStatValue,
		calcFunc = calcFunc,
		slot = slot,
		requiredMods = {},
		options = options,
	}

	local work = coroutine.create(function()
		if isRadiusJewel then
			local radiusMods = {}
			for key, entry in pairs(generator.modData["Explicit"] or {}) do
				if entry.RadiusJewel ~= nil then radiusMods[key] = entry end
			end
			generator:GenerateModWeights(radiusMods)
		else
			generator:GenerateModWeights(generator.modData["Explicit"])
		end
		generator:GenerateModWeights(generator.modData["Implicit"])
		if options.includeCorrupted then
			generator:GenerateModWeights(generator.modData["Corrupted"])
		end
		if options.includeRunes then
			generator:GenerateModWeights(generator.modData["Rune"])
		end
	end)
	local completed, workError = resumeWork(work)
	if not completed then
		return { success = false, error = "Weighted modifier calculation failed: " .. tostring(workError) }
	end

	local capturedQuery
	local capturedError
	generator.requesterCallback = function(_, queryJson, errMsg)
		capturedQuery = queryJson
		capturedError = errMsg
	end
	generator.requesterContext = nil
	local finished, finishError = pcall(function() generator:FinishQuery() end)
	if not finished then
		return { success = false, error = "Weighted query generation failed: " .. tostring(finishError) }
	end
	if capturedError then return { success = false, error = capturedError } end
	if type(capturedQuery) ~= "string" or capturedQuery == "" then
		return { success = false, error = "Weighted query generation returned no query" }
	end
	local query, decodeError = dkjson.decode(capturedQuery)
	if not query then
		return { success = false, error = "Weighted query JSON is invalid: " .. tostring(decodeError) }
	end
	-- PoB2 always fetches the weighted candidate set first. Price, Stat Value,
	-- and Stat Value / Price are local post-sort modes; sorting the official
	-- request by price here would change the candidate set.
	query.sort = { ["statgroup.0"] = "desc" }
	local root = query.query
	if type(root) == "table" then
		local filters = type(root.filters) == "table" and root.filters or {}
		if payload and safeNumber(payload.maxPrice) and payload.maxPrice > 0 then
			local price = { max = payload.maxPrice }
			if type(payload.maxPriceCurrency) == "string" and payload.maxPriceCurrency ~= "" then
				price.option = payload.maxPriceCurrency
			end
			filters.trade_filters = { filters = { price = price } }
		end
		if payload and safeNumber(payload.maxLevel) and payload.maxLevel > 0 then
			filters.req_filters = { disabled = false, filters = { lvl = { max = payload.maxLevel } } }
		end
		if payload and safeNumber(payload.sockets) and payload.sockets > 0 then
			filters.equipment_filters = { disabled = false, filters = { rune_sockets = { min = payload.sockets } } }
		end
		root.filters = filters
	end
	local statCount = query.query and query.query.stats and query.query.stats[1] and query.query.stats[1].filters
	return {
		success = true,
		query = query,
		resolved = type(statCount) == "table" and #statCount or 0,
		baseStatValue = safeNumber(baseStatValue),
	}
end

return TradeQueryWeights

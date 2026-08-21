-- Project-owned source classification for the damage structure report.
-- PoB applies passive-tree jewel effects with a Tree:<socket> source, so the
-- resolver keeps an explicit radius-source index to recover the jewel owner.
local M = {}

local function isJewel(item)
	return item and (
		item.type == "Jewel"
		or item.jewelData ~= nil
		or (item.base and item.base.type == "Jewel")
		or (item.base and item.base.subType and tostring(item.base.subType):find("Jewel", 1, true) ~= nil)
	)
end

local function itemSource(item)
	if not item then return nil end
	if item.modSource then return tostring(item.modSource) end
	if item.id ~= nil and item.name then
		return "Item:" .. tostring(item.id) .. ":" .. tostring(item.name)
	end
	return nil
end

function M.create(build, env, actor)
	local sourceTypes = {}
	local sourceTypesByItemId = {}
	local sourcePrefixes = {}
	local jewelPrefixes = {}
	local radiusSources = {}

	local function register(source, sourceType, jewel)
		if not source then return end
		local value = tostring(source)
		if jewel or sourceTypes[value] == nil then sourceTypes[value] = sourceType end
		local itemId = value:match("^Item:([^:]+):")
		if itemId then
			sourceTypesByItemId[itemId] = jewel and "jewel" or (sourceTypesByItemId[itemId] or sourceType)
			local prefix = value:match("^(Item:[^:]+:)")
			if prefix then
				sourcePrefixes[prefix] = jewel and "jewel" or (sourcePrefixes[prefix] or sourceType)
				if jewel then jewelPrefixes[prefix] = true end
			end
		end
	end

	local function registerItem(item, forcedType)
		if not item then return end
		local jewel = forcedType == "jewel" or isJewel(item)
		register(itemSource(item), jewel and "jewel" or "equipment", jewel)
	end

	local function registerItems(items)
		for _, item in pairs(items or {}) do registerItem(item) end
	end

	registerItems(env and env.player and env.player.itemList)
	registerItems(actor and actor.itemList)
	registerItems(build and build.itemsTab and build.itemsTab.items)

	local specJewels = build and build.spec and build.spec.jewels or {}
	local itemTable = build and build.itemsTab and build.itemsTab.items or {}
	for _, itemId in pairs(specJewels) do
		registerItem(itemTable[itemId] or itemTable[tonumber(itemId)], "jewel")
	end

	for _, radiusJewel in pairs(env and env.radiusJewelList or {}) do
		registerItem(radiusJewel.item, "jewel")
		local itemSourceValue = itemSource(radiusJewel.item)
		if itemSourceValue then register(itemSourceValue, "jewel", true) end
		local dataSource = radiusJewel.data and radiusJewel.data.modSource
		if dataSource then
			radiusSources[tostring(dataSource)] = true
			register(dataSource, "jewel", true)
		end
		if radiusJewel.nodeId then
			local nodeSource = "Tree:" .. tostring(radiusJewel.nodeId)
			radiusSources[nodeSource] = true
			register(nodeSource, "jewel", true)
		end
	end

	return function(source)
		if sourceTypes[source] then return sourceTypes[source] end
		if radiusSources[source] then return "jewel" end
		if type(source) == "string" then
			local itemId = source:match("^Item:([^:]+):")
			if itemId and sourceTypesByItemId[itemId] then return sourceTypesByItemId[itemId] end
			for prefix, sourceType in pairs(sourcePrefixes) do
				if source:sub(1, #prefix) == prefix then return sourceType end
			end
			for prefix in pairs(jewelPrefixes) do
				if source:sub(1, #prefix) == prefix then return "jewel" end
			end
			if source:match("^Tree:") then return "tree" end
			if source:match("^Skill:") then return "skill" end
			if source:match("^Buff:") or source:match("^Aura:") then return "buff" end
			if source:match("^Config:") or source:match("^Enemy:") then return "config" end
			if source:match("^Item:") then return "equipment" end
		end
		return nil
	end
end

return M

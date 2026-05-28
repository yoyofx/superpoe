-- validate_spec.lua
-- LuaJIT script: validates allocated passive tree nodes
-- Usage: luajit validate_spec.lua '<json-input>'
-- Input JSON: { "treeVersion":"0_4", "nodes":["id1","id2",...], "classId":"1" }
-- Output JSON: { "valid":true/false, "errors":[...], "warnings":[...] }

local json = require("dkjson") or {}
if not json.encode then
	-- Fallback simple JSON encode (dkjson may not be available)
	json = {
		encode = function(t)
			local parts = {}
			if type(t) == "table" then
				local isArr = #t > 0
				if isArr then
					for _, v in ipairs(t) do
						parts[#parts+1] = '"' .. tostring(v) .. '"'
					end
					return "[" .. table.concat(parts, ",") .. "]"
				end
				for k, v in pairs(t) do
					if type(v) == "string" then
						parts[#parts+1] = '"' .. k .. '":"' .. v .. '"'
					elseif type(v) == "boolean" then
						parts[#parts+1] = '"' .. k .. '":' .. (v and "true" or "false")
					elseif type(v) == "table" then
						parts[#parts+1] = '"' .. k .. '":' .. json.encode(v)
					end
				end
				return "{" .. table.concat(parts, ",") .. "}"
			end
			return tostring(t)
		end,
		decode = function(s)
			return load("return " .. s)()
		end
	}
end

-- Parse input
local inputStr = arg[1] or '{}'
local ok, input = pcall(json.decode, inputStr)
if not ok then
	io.write(json.encode({valid=false, errors={"Invalid JSON input: " .. tostring(input)}}))
	os.exit(1)
end

local treeVersion = input.treeVersion or "0_4"
local nodeIds = input.nodes or {}
local classId = input.classId or ""

-- Load HeadlessWrapper (suppress startup logging)
local _print = print
print = function() end  -- suppress HeadlessWrapper startup output
local headlessOk, headlessErr = pcall(dofile, "HeadlessWrapper.lua")
print = _print  -- restore print
if not headlessOk then
	io.write(json.encode({valid=false, errors={"HeadlessWrapper load failed: " .. tostring(headlessErr)}}))
	os.exit(1)
end

-- Create new build
newBuild()

-- Load tree data
local tree = main:LoadTree(treeVersion)
if not tree then
	io.write(json.encode({valid=false, errors={"Failed to load tree version: " .. treeVersion}}))
	os.exit(1)
end

local warnings = {}
local errors = {}

-- Convert node IDs from strings (JSON input) to numbers (tree.nodes keys)
-- Also build a reverse map: number -> original string for error messages
local numIds = {}
local numToOrig = {}
local invalidIds = {}
for _, nid in ipairs(nodeIds) do
	local numId = tonumber(nid)
	if numId and tree.nodes[numId] then
		numIds[#numIds + 1] = numId
		numToOrig[numId] = nid
	else
		invalidIds[#invalidIds + 1] = nid
	end
end

if #invalidIds > 0 then
	errors[#errors + 1] = "Invalid node IDs: " .. table.concat(invalidIds, ", ")
end

-- Validate connectivity: BFS from any ClassStart/AscendClassStart
if #numIds > 0 then
	local function checkConnectivity()
		local validSet = {}
		for _, numId in ipairs(numIds) do
			validSet[numId] = true
		end

		-- Find start nodes (ClassStart or AscendClassStart)
		local starts = {}
		for _, numId in ipairs(numIds) do
			local node = tree.nodes[numId]
			if node and (node.type == "ClassStart" or node.type == "AscendClassStart") then
				starts[#starts + 1] = numId
			end
		end

		if #starts == 0 then
			-- No class start among allocated: treat all as standalone (import case)
			return true
		end

		-- BFS from all start nodes
		local visited = {}
		local queue = {}
		for _, sid in ipairs(starts) do
			queue[#queue + 1] = sid
			visited[sid] = true
		end

		while #queue > 0 do
			local cur = table.remove(queue, 1)
			local curNode = tree.nodes[cur]
			if curNode then
				for _, outId in ipairs(curNode.linkedId or {}) do
					if not visited[outId] and validSet[outId] then
						visited[outId] = true
						queue[#queue + 1] = outId
					end
				end
			end
		end

		for _, numId in ipairs(numIds) do
			if not visited[numId] then
				local node = tree.nodes[numId]
				local label = numToOrig[numId] or tostring(numId)
				if node and node.dn then
					label = node.dn .. " (" .. label .. ")"
				end
				errors[#errors + 1] = "Node not connected: " .. label
			end
		end

		return #errors == 0
	end

	checkConnectivity()
end

-- Class check
if classId and classId ~= "" then
	local classStarts = {}
	for _, numId in ipairs(numIds) do
		local node = tree.nodes[numId]
		if node and (node.type == "ClassStart" or node.type == "AscendClassStart") then
			classStarts[#classStarts + 1] = numToOrig[numId] or tostring(numId)
		end
	end
	if #classStarts > 1 then
		warnings[#warnings + 1] = "Multiple class starts allocated: " .. table.concat(classStarts, ", ")
	end
end

local valid = #errors == 0
local result = { valid = valid, errors = errors, warnings = warnings }

io.write(json.encode(result))
os.exit(0)

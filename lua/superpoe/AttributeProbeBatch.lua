-- Runs attribute probes against one loaded PoB build.
-- The calculation itself remains a full PoB BuildOutput pass for every job;
-- this module only removes repeated XML loading and result serialization.
local M = {}

local function safeNum(value)
    if value == nil then return nil end
    if type(value) ~= "number" then return value end
    if value ~= value or value == math.huge or value == -math.huge then return nil end
    return value
end

local function normalizeXml(xmlText)
    return xmlText:gsub(
        "(%a+) Resistance is ([%+%-]?[%d%.]+)%%",
        function(element, value)
            if element == "Fire" or element == "Cold" or element == "Lightning" or element == "Chaos" then
                return value .. "% to " .. element .. " Resistance"
            end
            return element .. " Resistance is " .. value .. "%"
        end
    )
end

local function copyValues(source)
    local result = {}
    for key, value in pairs(source or {}) do result[key] = value end
    return result
end

local OUTPUT_FIELDS = {
    "Str", "Dex", "Int", "Life", "LifeUnreserved", "Mana", "ManaUnreserved", "Spirit",
    "EnergyShield", "Armour", "Evasion", "ArmourPhysicalDamageReduction", "PhysicalDamageReduction",
    "DeflectionRating", "EvadeChance", "DeflectChance", "DeflectEffect", "FireResist", "FireResistTotal",
    "ColdResist", "ColdResistTotal", "LightningResist", "LightningResistTotal", "ChaosResist", "ChaosResistTotal",
    "BlockChance", "SpellBlockChance", "EffectiveBlockChance", "TotalDPS", "FullDPS", "FullDotDPS",
    "GemLevel", "AverageHit", "Speed", "HitSpeed", "CritChance", "CritMultiplier", "PowerChargesMax",
    "FrenzyChargesMax", "EnduranceChargesMax", "MovementSpeedMod", "EffectiveMovementSpeedMod",
    "ActionSpeedMod", "Ward", "LifeRegen", "ManaRegen", "EnergyShieldRegen",
}

-- Probe rows read these values directly from output. TotalEHP is the only
-- primary/affected probe metric that is exposed through powerStatList.
local REQUIRED_POWER_STATS = { TotalEHP = true }

local function readPowerStats(build, output)
    local powerStats = {}
    local powerStatList = build and build.data and build.data.powerStatList
    if powerStatList and powerStatList.GetFromOutput then
        for _, statData in ipairs(powerStatList) do
            if statData.stat and REQUIRED_POWER_STATS[statData.stat] then
                local readOk, value = pcall(powerStatList.GetFromOutput, output, statData)
                value = readOk and safeNum(value) or nil
                if type(value) == "number" then powerStats[statData.stat] = value end
            end
        end
    end
    return powerStats
end

local function snapshot(build, env, output, allDpsTotal)
    local data = {}
    for _, field in ipairs(OUTPUT_FIELDS) do data[field] = safeNum(output[field]) end
    data.AllDPS = safeNum(allDpsTotal)
    data.PowerStats = readPowerStats(build, output)
    data.CharacterLevel = safeNum(env.player and env.player.level)
    data.allocatedNodes = 0
    if build.spec then
        for _ in pairs(build.spec.allocNodes or {}) do data.allocatedNodes = data.allocatedNodes + 1 end
    end
    return data
end

local function resetConfigInput(configSet, initialInput)
    if not configSet or not configSet.input then return end
    for key in pairs(configSet.input) do configSet.input[key] = nil end
    for key, value in pairs(initialInput) do configSet.input[key] = value end
end

local function calculateAllDps(build, output, fullSkillDpsOutput, characterOnly, includeAllDps)
    local allDpsTotal = safeNum(output.FullDPS)
    if characterOnly or includeAllDps ~= true then return allDpsTotal end

    local calcsTab = build.calcsTab
    local socketGroups = build.skillsTab and build.skillsTab.socketGroupList
    local needsAllSkillPass = not fullSkillDpsOutput or #fullSkillDpsOutput == 0
    if socketGroups then
        for _, socketGroup in ipairs(socketGroups) do
            if socketGroup.enabled and not socketGroup.includeInFullDPS then
                needsAllSkillPass = true
                break
            end
        end
    end
    if not needsAllSkillPass or not calcsTab or not calcsTab.calcs or not socketGroups then
        return allDpsTotal
    end

    local originalInclude = {}
    for index, socketGroup in ipairs(socketGroups) do
        originalInclude[index] = socketGroup.includeInFullDPS
        if socketGroup.enabled then socketGroup.includeInFullDPS = true end
    end
    local rebuiltOk, rebuilt = pcall(function()
        return calcsTab.calcs.calcFullDPS(build, "CALCULATOR", {}, { env = nil })
    end)
    for index, socketGroup in ipairs(socketGroups) do
        socketGroup.includeInFullDPS = originalInclude[index]
    end
    if rebuiltOk and rebuilt and rebuilt.skills and #rebuilt.skills > 0 then
        return safeNum(rebuilt.combinedDPS)
    end
    return allDpsTotal
end

local function calculateJob(build, initialInput, initialSkillNumber, initialBuffMode, initialActiveSkills, job)
    local calcsTab = build.calcsTab
    local configTab = build.configTab
    local configSet = configTab and configTab.configSets[configTab.activeConfigSetId]
    resetConfigInput(configSet, initialInput)
    calcsTab.input.skill_number = initialSkillNumber
    calcsTab.input.misc_buffMode = initialBuffMode
    for index, activeSkillIndex in pairs(initialActiveSkills) do
        local socketGroup = build.skillsTab and build.skillsTab.socketGroupList[index]
        if socketGroup then socketGroup.mainActiveSkillCalcs = activeSkillIndex end
    end

    local overrides = type(job.configOverrides) == "table" and job.configOverrides or {}
    local hasOverrides = next(overrides) ~= nil
    if hasOverrides and configSet then
        for key, value in pairs(overrides) do configSet.input[key] = value end
        configTab:BuildModList()
    end

    local characterOnly = job.characterOnly == true
    local validModes = { UNBUFFED = true, BUFFED = true, COMBAT = true, EFFECTIVE = true }
    if validModes[job.calcMode] then
        calcsTab.input.misc_buffMode = job.calcMode
    elseif not validModes[calcsTab.input.misc_buffMode] then
        calcsTab.input.misc_buffMode = "EFFECTIVE"
    end
    calcsTab.input.skill_number = tonumber(job.skillGroupId) or build.mainSocketGroup or 1

    local socketGroup = build.skillsTab and build.skillsTab.socketGroupList[calcsTab.input.skill_number]
    if socketGroup then
        local activeSkills = socketGroup.displaySkillListCalcs or socketGroup.displaySkillList
        local activeSkillIndex = tonumber(job.activeSkillIndex) or socketGroup.mainActiveSkillCalcs or 1
        if activeSkills and activeSkills[activeSkillIndex] then
            socketGroup.mainActiveSkillCalcs = activeSkillIndex
            local activeEffect = activeSkills[activeSkillIndex].activeEffect
            local source = activeEffect and activeEffect.srcInstance
            local statSetIndex = tonumber(job.statSetIndex)
            if statSetIndex and activeEffect and activeEffect.grantedEffect and activeEffect.grantedEffect.statSets[statSetIndex] then
                source.statSetCalcs = source.statSetCalcs or {}
                source.statSetCalcs[activeEffect.grantedEffect.id] = statSetIndex
            end
            local minionSkillIndex = tonumber(job.minionSkillIndex)
            if source and minionSkillIndex then source.skillMinionSkillCalcs = minionSkillIndex end
            local minionStatSetIndex = tonumber(job.minionStatSetIndex)
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
    local calculated, envOrError = pcall(function()
        calcsTab:BuildOutput()
        if job.skillGroupId or job.calcMode or job.activeSkillIndex or job.statSetIndex
            or job.actor or job.minionSkillIndex or job.minionStatSetIndex then
            return calcsTab.calcsEnv
        end
        return calcsTab.mainEnv
    end)
    if not calculated then error("Calculation failed: " .. tostring(envOrError)) end

    local env = envOrError
    local output = env and env.player and env.player.output
    if not output then error("No output data produced") end
    local allSkillDpsOutput = output.SkillDPS
    local allDpsTotal = calculateAllDps(build, output, allSkillDpsOutput, characterOnly, job.includeAllDps)
    return snapshot(build, env, output, allDpsTotal)
end

function M.calculate(payload)
    if type(payload) ~= "table" or type(payload.xml) ~= "string" or payload.xml == "" then
        return { success = false, error = "Empty XML input" }
    end
    local startedAt = os.clock()
    if launch then launch.promptMsg = nil end
    local loaded, loadError = pcall(loadBuildFromXML, normalizeXml(payload.xml), "superpoe-attribute-probes")
    if not loaded then
        local prompt = launch and launch.promptMsg
        if launch then launch.promptMsg = nil end
        if prompt then return { success = false, error = "Build load error: " .. tostring(prompt) } end
        return { success = false, error = "loadBuildFromXML failed: " .. tostring(loadError) }
    end
    build = (launch and launch.main and launch.main.modes and launch.main.modes["BUILD"]) or build
    if not build or not build.calcsTab then return { success = false, error = "Build calculation object not available after load" } end
    if launch and launch.promptMsg then
        local prompt = tostring(launch.promptMsg)
        launch.promptMsg = nil
        return { success = false, error = "Build load error: " .. prompt }
    end

    local calcsTab = build.calcsTab
    local configTab = build.configTab
    local configSet = configTab and configTab.configSets[configTab.activeConfigSetId]
    local initialInput = copyValues(configSet and configSet.input)
    local initialSkillNumber = calcsTab.input.skill_number
    local initialBuffMode = calcsTab.input.misc_buffMode
    local initialActiveSkills = {}
    for index, socketGroup in ipairs(build.skillsTab and build.skillsTab.socketGroupList or {}) do
        initialActiveSkills[index] = socketGroup.mainActiveSkillCalcs
    end

    local results = {}
    for index, job in ipairs(payload.jobs or {}) do
        local id = tostring(job.id or index)
        local calculated, result = pcall(calculateJob, build, initialInput, initialSkillNumber, initialBuffMode, initialActiveSkills, job)
        if calculated then
            results[index] = { id = id, success = true, data = result }
        else
            results[index] = { id = id, success = false, error = tostring(result) }
        end
    end
    return {
        success = true,
        data = results,
        performance = { jobCount = #results, elapsedMs = (os.clock() - startedAt) * 1000 },
    }
end

return M

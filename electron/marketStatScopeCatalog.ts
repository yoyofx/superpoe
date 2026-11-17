import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { LuaFactory } from 'wasmoon'
import { buildMarketStatScopeData, type MarketStatScopeData, type PobScopeSource } from '../src/engine/marketStatScope.js'

/** Evaluate trusted, bundled PoB data as Lua rather than guessing its table syntax. */
export async function loadMarketStatScopes(dataRoot: string, descriptors: Array<[string, string]>,
  localizers: Array<(name: string) => string> = []): Promise<MarketStatScopeData> {
  const lua = await new LuaFactory().createEngine({ functionTimeout: 15000 })
  const read = (file: string) => readFileSync(path.join(dataRoot, file), 'utf8').replace(/^\uFEFF/, '')
  try {
    lua.doStringSync(`scopeBases = {}; scopeBaseVariants = {}; scopeMods = {}; scopeUniques = {}
      scopeBaseSink = setmetatable({}, {__index = scopeBases, __newindex = function(_, name, base)
        scopeBases[name] = base
        scopeBaseVariants[name] = scopeBaseVariants[name] or {}
        table.insert(scopeBaseVariants[name], base)
      end})`)
    for (const file of readdirSync(path.join(dataRoot, 'Bases')).filter((name) => name.endsWith('.lua')).sort()) {
      lua.doStringSync(`(function(...)\n${read('Bases/' + file)}\nend)(scopeBaseSink)`)
    }
    for (const file of ['ModItem', 'ModJewel', 'ModFlask', 'ModCharm', 'ModItemExclusive']) {
      lua.doStringSync(`scopeMods[${JSON.stringify(file)}] = (function()\n${read(file + '.lua')}\nend)()`)
    }
    for (const file of readdirSync(path.join(dataRoot, 'Uniques')).filter((name) => name.endsWith('.lua')).sort()) {
      lua.doStringSync(`for _, raw in ipairs((function()\n${read('Uniques/' + file)}\nend)()) do table.insert(scopeUniques, raw) end`)
    }
    // The bundled deterministic-key patch uses table.sort after dkjson's _ENV
    // guard. Capture table locally for Lua 5.4 without modifying bundled files.
    const json = 'local table = table\n' + readFileSync(path.join(dataRoot, '..', 'dkjson.lua'), 'utf8')
    const encoded = lua.doStringSync(`local json = (function()\n${json}\nend)()
      local out = { bases = scopeBases, baseVariants = scopeBaseVariants, uniques = scopeUniques, mods = {}, exclusive = {} }
      for file, mods in pairs(scopeMods) do
        local rows = {}
        for id, mod in pairs(mods) do
          local hashes, lines, descriptions = setmetatable({}, {__jsontype='array'}), setmetatable({}, {__jsontype='array'}), setmetatable({}, {__jsontype='array'})
          for hash, text in pairs(mod.tradeHashes or {}) do
            table.insert(hashes, tostring(hash)); table.insert(descriptions, { tostring(hash), text })
          end
          for _, line in ipairs(mod) do table.insert(lines, line) end
          table.insert(rows, { id=tostring(id), group=mod.group, level=mod.level, statOrder=mod.statOrder, affix=mod.affix,
            type=mod.type, weightKey=mod.weightKey, weightVal=mod.weightVal,
            weightMultiplierKey=mod.weightMultiplierKey, weightMultiplierVal=mod.weightMultiplierVal, hashes=hashes, lines=lines, descriptions=descriptions })
        end
        if file == 'ModItemExclusive' then out.exclusive = rows else out.mods[file] = rows end
      end
      return json.encode(out)`)
    return buildMarketStatScopeData(JSON.parse(encoded) as PobScopeSource, descriptors, localizers)
  } finally { lua.global.close() }
}

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { LuaFactory } from 'wasmoon'
import { decodeBuildCode } from '@/engine/buildCode'
import {
  calculateWithLuaEngine,
  inspectEquipmentWithLuaEngine,
  installBuildHelpers,
  installHostCompatibility,
  rankSkillsWithLuaEngine,
  type PobLuaManifest,
} from '@/engine/pobLuaRuntime'

const rootDir = fileURLToPath(new URL('../..', import.meta.url))
const fixturePath = resolve(rootDir, 'builds/0.4_风暴编织者.build')
const luaBundleDir = resolve(rootDir, 'public/pob-lua')
const projectLuaBundleDir = resolve(rootDir, 'public/superpoe-lua')
const wasmPath = resolve(rootDir, 'node_modules/wasmoon/dist/glue.wasm')

let luaFactory: LuaFactory
let luaWasm: Awaited<ReturnType<LuaFactory['getLuaModule']>>
let lua: Awaited<ReturnType<LuaFactory['createEngine']>>

beforeAll(async () => {
  const manifest = JSON.parse(
    readFileSync(resolve(luaBundleDir, 'manifest.json'), 'utf8'),
  ) as PobLuaManifest

  luaFactory = new LuaFactory(wasmPath)
  luaWasm = await luaFactory.getLuaModule()

  for (const entry of manifest.files) {
    if (!entry.path.endsWith('.lua')) continue
    luaFactory.mountFileSync(
      luaWasm,
      `/${entry.path}`,
      readFileSync(resolve(luaBundleDir, entry.path), 'utf8'),
    )
  }
  const projectManifest = JSON.parse(
    readFileSync(resolve(projectLuaBundleDir, 'manifest.json'), 'utf8'),
  ) as PobLuaManifest
  for (const entry of projectManifest.files) {
    if (!entry.path.endsWith('.lua')) continue
    luaFactory.mountFileSync(
      luaWasm,
      `/superpoe-lua/${entry.path}`,
      readFileSync(resolve(projectLuaBundleDir, entry.path), 'utf8'),
    )
  }
  luaFactory.mountFileSync(luaWasm, '/manifest.xml', '<PoBVersion><Version number="browser"/></PoBVersion>')

  lua = await luaFactory.createEngine()
  installHostCompatibility(lua)
  lua.doStringSync('print = function(...) end')
  lua.doFileSync('/HeadlessWrapper.lua')
  installBuildHelpers(lua)
}, 30000)

afterAll(() => {
  lua?.global.close()
})

describe('PoB Lua front-end runtime', () => {
  it('loads the project equipment bridge from its separate Lua bundle', () => {
    expect(lua.doStringSync('return type(require("EquipmentDifference").compare)')).toBe('function')
  })

  it('formats integral floats like the LuaJIT runtime used by desktop PoB2', () => {
    expect(lua.doStringSync('return tostring(90.0)')).toBe('90')
    expect(lua.doStringSync('return tostring(90.25)')).toBe('90.25')
  })

  it('parses equipment semantics and distinguishes local modifiers', () => {
    const ring = [
      'Rarity: RARE',
      'Test Circle',
      'Ruby Ring',
      'Implicits: 0',
      '+30 to maximum Life',
      'Fire Resistance is +44%',
    ].join('\n')
    const weapon = [
      'Rarity: RARE',
      'Test Cry',
      'Sinister Quarterstaff',
      'Implicits: 0',
      '25% increased Attack Speed',
      '+3 to Level of all Attack Skills',
    ].join('\n')

    const result = inspectEquipmentWithLuaEngine(lua, [ring, weapon])

    expect(result.errors).toEqual({})
    expect(result.results).toHaveLength(2)
    const ringMods = result.results[0]?.lines.flatMap((line) => line.modifiers) || []
    expect(ringMods).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'Life', type: 'BASE', value: 30, scope: 'global' }),
      expect.objectContaining({ name: 'FireResist', type: 'BASE', value: 44, scope: 'global' }),
    ]))
    const weaponMods = result.results[1]?.lines.flatMap((line) => line.modifiers) || []
    expect(weaponMods).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'Speed', type: 'INC', value: 25, scope: 'local' }),
      expect.objectContaining({ type: 'BASE', value: 3, scope: 'global' }),
    ]))
  }, 30000)

  it('calculates local armour values without introducing decimal modifier text', () => {
    lua.global.set('__testArmourItemRaw', [
      'Rarity: RARE',
      'Hate Hold',
      'Runeforged Grand Bracers',
      'Item Level: 83',
      'Quality: +20%',
      'Implicits: 0',
      '+166 to Evasion Rating',
      '90% increased Evasion Rating',
      '40% increased Evasion Rating',
    ].join('\n'))

    const evasion = lua.doStringSync(`
      local item = new("Item", __testArmourItemRaw)
      return item.armourData and item.armourData.Evasion
    `)

    expect(evasion).toBe(759)
  })

  it('unwraps minion, companion and ally equipment modifiers with recipients', () => {
    const summonItem = [
      'Rarity: RARE',
      'Test Circle',
      'Ruby Ring',
      'Implicits: 0',
      'Minions deal 10% increased Damage',
      'Companions deal 12% increased Damage',
      'Allies in your Presence Gain 20% of Damage as Extra Chaos Damage',
      'Allies in your Presence deal 1 to 15 added Attack Lightning Damage',
      'You and Allies in your Presence have 12% increased Attack Speed',
    ].join('\n')

    const result = inspectEquipmentWithLuaEngine(lua, [summonItem])
    const modifiers = result.results[0]?.lines.flatMap((line) => line.modifiers) || []

    expect(result.errors).toEqual({})
    expect(modifiers).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'Damage', type: 'INC', value: 10, recipient: 'minion', wrapper: 'MinionModifier' }),
      expect.objectContaining({ name: 'Damage', type: 'INC', value: 12, recipient: 'companion', wrapper: 'MinionModifier' }),
      expect.objectContaining({ name: 'DamageGainAsChaos', type: 'BASE', value: 20, recipient: 'ally', wrapper: 'ExtraAura' }),
      expect.objectContaining({ name: 'LightningMin', type: 'BASE', value: 1, recipient: 'ally', wrapper: 'ExtraAura' }),
      expect.objectContaining({ name: 'LightningMax', type: 'BASE', value: 15, recipient: 'ally', wrapper: 'ExtraAura' }),
      expect.objectContaining({ name: 'Speed', type: 'BASE', value: 12, recipient: 'player-and-allies', wrapper: 'ExtraAura' }),
    ]))
  }, 30000)

  it('extracts and scopes attack, spell, elemental, projectile, melee and minion skill levels', () => {
    const skillItem = [
      'Rarity: RARE',
      'Test Level',
      'Ruby Ring',
      'Implicits: 0',
      '+3 to Level of all Attack Skills',
      '+3 to Level of all Melee Skills',
      '+2 to Level of all Projectile Skills',
      '+2 to Level of all Spell Skills',
      '+2 to Level of all Cold Skills',
      '+1 to Level of all Fire Skills',
      '+1 to Level of all Lightning Skills',
      '+1 to Level of all Chaos Skills',
      '+2 to Level of all Physical Skills',
      '+2 to Level of all Minion Skills',
    ].join('\n')

    const result = inspectEquipmentWithLuaEngine(lua, [skillItem])
    const modifiers = result.results[0]?.lines.flatMap((line) => line.modifiers) || []
    const skillLevels = modifiers.filter((modifier) => modifier.name === 'SkillLevel')
    const keywordOf = (modifier: (typeof skillLevels)[number]) => modifier.tags.find((tag) => tag.type === 'SkillLevel')?.keyword

    expect(result.errors).toEqual({})
    expect(skillLevels.map(keywordOf)).toEqual(expect.arrayContaining([
      'attack', 'melee', 'projectile', 'spell', 'cold', 'fire', 'lightning', 'chaos', 'physical', 'minion',
    ]))
    expect(skillLevels).toHaveLength(10)
    expect(skillLevels).toEqual(expect.arrayContaining([
      expect.objectContaining({ value: 3, recipient: 'player', wrapper: 'GemProperty' }),
      expect.objectContaining({ value: 2, recipient: 'minion', wrapper: 'GemProperty' }),
    ]))
  }, 30000)

  it('calculates the Stormweaver import-code fixture', () => {
    const code = readFileSync(fixturePath, 'utf8').trim()
    const decoded = decodeBuildCode(code)

    const result = calculateWithLuaEngine(lua, decoded.xml)

    expect(result.success, result.error).toBe(true)
    expect(result.data).toBeDefined()
    expect(result.data?.CharacterLevel).toBe(100)
    expect(result.data?.ClassName).toBe('Sorceress')
    expect(result.data?.AscendClassName).toBe('Stormweaver')
    expect(result.data?.allocatedNodes).toBeGreaterThan(100)
    expect(result.data?.Str).toBeGreaterThan(70)
    expect(result.data?.Dex).toBeGreaterThan(70)
    expect(result.data?.Int).toBeGreaterThan(200)
    expect(result.data?.Life).toBeGreaterThan(1400)
    expect(result.data?.Mana).toBeGreaterThan(1800)
    expect(result.data?.EnergyShield).toBeGreaterThan(1800)
    expect(result.data?.Spirit).toBeDefined()
    expect(result.data?.PhysicalDamageReduction).toBeDefined()
    expect(result.data?.DeflectChance).toBeDefined()
    expect(result.data?.DeflectEffect).toBeDefined()
    expect(result.data?.EffectiveBlockChance).toBeDefined()
    expect(result.data?.EffectiveMovementSpeedMod).toBeDefined()
    expect(result.data?.FireResistTotal).toBeDefined()
    expect(result.data?.ColdResistTotal).toBeDefined()
    expect(result.data?.LightningResistTotal).toBeDefined()
    expect(result.data?.ChaosResistTotal).toBeDefined()
    expect(['attack', 'spell', 'other']).toContain(result.data?.SkillDetails?.skillType)
    if (result.data?.SkillDetails?.skillType === 'spell') {
      expect(result.data.SkillDetails.skillDamage?.length).toBeGreaterThan(0)
      expect(result.data.SkillDetails.weaponDamage).toEqual([])
    } else if (result.data?.SkillDetails?.skillType === 'attack') {
      expect(result.data.SkillDetails.skillDamage).toEqual([])
    }

    const ranking = rankSkillsWithLuaEngine(lua, decoded.xml, ['1'])
    expect(ranking.success, ranking.error).toBe(true)
    expect(ranking.data).toHaveLength(1)
    expect(ranking.data?.map((entry) => entry.groupId)).toEqual(['1'])
    expect(ranking.data?.every((entry) => Number.isFinite(entry.dps))).toBe(true)

    const minionXml = decoded.xml.replace(
      /<Skill mainActiveSkillCalcs="1"[\s\S]*?<\/Skill>/,
      '<Skill mainActiveSkillCalcs="1" includeInFullDPS="nil" enabled="true" mainActiveSkill="1">\n'
        + '<Gem level="20" skillId="SummonSkeletalSnipersPlayer" enabled="true" enableGlobal2="false" enableGlobal1="true" '
        + 'gemId="Metadata/Items/Gems/SkillGemSkeletalSniper" nameSpec="Skeletal Sniper" variantId="SkeletalSniper" quality="0" count="1"/>\n'
        + '</Skill>',
    )
    const minionResult = calculateWithLuaEngine(lua, minionXml, { skillGroupId: '1', actor: 'auto' })
    expect(minionResult.success, minionResult.error).toBe(true)
    expect(minionResult.data?.SkillDetails).toEqual(expect.objectContaining({
      actor: 'minion',
      hasMinion: true,
      playerHasDamage: false,
      minionHasDamage: true,
      minionName: 'Skeletal Sniper',
    }))
    expect(minionResult.data?.SkillDetails?.minionSkills?.length).toBeGreaterThan(1)
    expect(minionResult.data?.SkillDetails?.totalDps).toBeGreaterThan(0)

    const alternateMinionSkill = calculateWithLuaEngine(lua, minionXml, {
      skillGroupId: '1',
      actor: 'minion',
      minionSkillIndex: 2,
    })
    expect(alternateMinionSkill.success, alternateMinionSkill.error).toBe(true)
    expect(alternateMinionSkill.data?.SkillDetails?.minionSkillIndex).toBe(2)
  }, 30000)
})

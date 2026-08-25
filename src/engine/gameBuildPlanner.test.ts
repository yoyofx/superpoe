import { deflate } from 'pako'
import { describe, expect, it } from 'vitest'
import { createGameBuildPlanner, sanitizeBuildPlannerFileName, serializeGameBuildPlanner } from '@/engine/gameBuildPlanner'
import type { SkillCatalog } from '@/engine/skillCatalog'
import type { TreeData } from '@/types/tree'

function buildCode(xml: string): string {
  const bytes = deflate(new TextEncoder().encode(xml))
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_')
}

const treeData = {
  constants: {
    classes: {
      Mercenary: {
        name: 'Mercenary',
        displayName: 'Mercenary',
        integerId: 3,
        ascendancies: [{ id: 'Gemling Legionnaire', name: 'Gemling Legionnaire', internalId: 'Mercenary3' }],
      },
    },
  },
} as unknown as TreeData

const catalog: SkillCatalog = {
  schemaVersion: 1,
  stats: {},
  entries: {
    Spear: {
      id: 'Spear', name: 'Spear', type: 'active', userVisible: true,
      gemIds: ['Metadata/Items/Gems/SkillGemPlayerDefaultSpear'],
      gameIds: ['Metadata/Items/Gem/SkillGemPlayerDefaultSpear'], variantIds: [], aliases: [], tags: [],
    },
    Pierce: {
      id: 'Pierce', name: 'Pierce', type: 'support', userVisible: true,
      gemIds: ['Metadata/Items/Gems/SupportGemPierce'], gameIds: [], variantIds: [], aliases: [], tags: [],
    },
  },
  lookup: { spearplayer: 'Spear', supportpierce: 'Pierce' },
}

describe('game Build Planner export', () => {
  it('preserves UTF-8 Chinese inventory recommendation text', () => {
    const json = serializeGameBuildPlanner({
      name: '抓嗷嗷虎当宝宝',
      inventory_slots: [{
        inventory_id: 'Amulet1',
        additional_text: '所有法术技能等级 +4\n魔力再生率提高 25%',
      }],
    })

    expect(JSON.parse(json)).toEqual({
      name: '抓嗷嗷虎当宝宝',
      inventory_slots: [{
        inventory_id: 'Amulet1',
        additional_text: '所有法术技能等级 +4\n魔力再生率提高 25%',
      }],
    })
  })

  it('maps passives, weapon sets, skills, supports and inventory hints', () => {
    const code = buildCode(`<PathOfBuilding2>
      <Skills activeSkillSet="1"><SkillSet id="1"><Skill enabled="true">
        <Gem nameSpec="Spear" skillId="SpearPlayer" level="20" quality="0" enabled="true"/>
        <Gem nameSpec="Pierce" skillId="SupportPierce" level="1" quality="0" enabled="true"/>
      </Skill></SkillSet></Skills>
      <Items activeItemSet="1">
        <Item id="1"><![CDATA[Rarity: UNIQUE
Kalandra's Touch
Ring
Implicits: 0
+20 to Strength]]></Item>
        <ItemSet id="1" title="Set 1"><Slot name="Ring 1" itemId="1" active="true"/></ItemSet>
      </Items>
    </PathOfBuilding2>`)
    const result = createGameBuildPlanner({
      name: 'Planner Test', sourceUrl: 'https://example.test/build', treeVersion: '0_5', treeData,
      selectedClassId: 'Mercenary', selectedAscendancyId: 'Gemling Legionnaire',
      allocatedNodes: ['100', '101'], nodeWeaponSets: { '101': 2 }, nodeAttributeSelections: { '100': 1 },
      importedBuildCode: code,
      passiveMap: { schemaVersion: 1, treeVersion: '0_5', source: 'test', sourceVersion: 'test', nodes: { '100': 'strength89', '101': 'deflect38' } },
      skillCatalog: catalog,
    })

    expect(result.build.ascendancy).toBe('Mercenary3')
    expect(result.build.passives).toEqual([
      { id: 'strength89', additional_text: '<red>{Strength +5}' },
      { id: 'deflect38', weapon_set: 2 },
    ])
    expect(result.build.skills).toEqual([{
      id: 'Metadata/Items/Gem/SkillGemPlayerDefaultSpear',
      support_skills: ['Metadata/Items/Gems/SupportGemPierce'],
    }])
    expect(result.build.inventory_slots).toEqual([{
      inventory_id: 'Ring1', unique_name: "Kalandra's Touch", additional_text: 'Ring\n+20 to Strength',
    }])
    expect(result.missingPassiveIds).toEqual([])
    expect(result.missingSkills).toEqual([])
    expect(result.skippedSkills).toEqual([])
  })

  it('reports unmapped passives instead of silently dropping them', () => {
    const result = createGameBuildPlanner({
      name: 'Missing', treeVersion: '0_5', treeData, selectedClassId: 'Mercenary',
      selectedAscendancyId: '', allocatedNodes: ['404'], nodeWeaponSets: {}, nodeAttributeSelections: {},
      passiveMap: { schemaVersion: 1, treeVersion: '0_5', source: 'test', sourceVersion: 'test', nodes: {} },
      skillCatalog: null,
    })
    expect(result.missingPassiveIds).toEqual(['404'])
    expect(result.build.passives).toBeUndefined()
  })

  it('exports mapped granted and meta gems while skipping entries without item ids', () => {
    const incompatibleCatalog: SkillCatalog = {
      ...catalog,
      entries: {
        ...catalog.entries,
        ExplosiveTeleportSandDjinn: {
          id: 'ExplosiveTeleportSandDjinn', name: "Kelari's Deception", type: 'hidden', userVisible: false,
          gemIds: [], gameIds: [], variantIds: [], aliases: [], tags: [],
          plannerParentSkillId: 'SummonSandDjinnPlayer',
        },
        SummonSandDjinnPlayer: {
          id: 'SummonSandDjinnPlayer', name: 'Kelari, the Tainted Sands', type: 'active', userVisible: true,
          gemIds: ['Metadata/Items/Gems/SkillGemAscendancySummonSandDjinn'],
          gameIds: ['Metadata/Items/Gem/SkillGemAscendancySummonSandDjinn'],
          variantIds: [], aliases: [], tags: ['minion'],
        },
        ChilledGroundBurstWaterDjinn: {
          id: 'ChilledGroundBurstWaterDjinn', name: "Navira's Fracturing", type: 'hidden', userVisible: false,
          gemIds: [], gameIds: [], variantIds: [], aliases: [], tags: [],
          plannerParentSkillId: 'SummonWaterDjinnPlayer',
        },
        SummonWaterDjinnPlayer: {
          id: 'SummonWaterDjinnPlayer', name: 'Navira, the Last Mirage', type: 'active', userVisible: true,
          gemIds: ['Metadata/Items/Gems/SkillGemAscendancySummonWaterDjinn'],
          gameIds: ['Metadata/Items/Gem/SkillGemAscendancySummonWaterDjinn'],
          variantIds: [], aliases: [], tags: ['minion'],
        },
        Meta: {
          id: 'Meta', name: 'Cast on Minion Death', type: 'active', userVisible: true,
          gemIds: ['Metadata/Items/Gems/SkillGemCastOnMinionDeath'], gameIds: [],
          variantIds: [], aliases: [], tags: ['meta'],
        },
        Granted: {
          id: 'Granted', name: 'Spiraling Conspiracy', type: 'granted', userVisible: true,
          gemIds: ['Metadata/Items/Gems/SkillGemSpiralingConspiracy'],
          gameIds: ['Metadata/Items/Gems/SkillGemSpiralingConspiracy'],
          variantIds: [], aliases: [], tags: ['minion'],
        },
        SkeletalWarrior: {
          id: 'SkeletalWarrior', name: 'Skeletal Warrior', type: 'granted', userVisible: true,
          gemIds: ['Metadata/Items/Gems/SkillGemSkeletalWarrior'],
          gameIds: ['Metadata/Items/Gems/SkillGemSkeletalWarriorWeaponSkill'],
          variantIds: [], aliases: [], tags: ['minion'],
        },
      },
      lookup: {
        ...catalog.lookup,
        explosiveteleportsanddjinn: 'ExplosiveTeleportSandDjinn',
        chilledgroundburstwaterdjinn: 'ChilledGroundBurstWaterDjinn',
        metacastonminiondeathplayer: 'Meta',
        summonspiralingconspiracyplayer: 'Granted',
        summonskeletalwarriorsplayer: 'SkeletalWarrior',
      },
    }
    const code = buildCode(`<PathOfBuilding2><Skills activeSkillSet="1"><SkillSet id="1">
      <Skill><Gem nameSpec="Kelari's Deception" skillId="ExplosiveTeleportSandDjinn"/></Skill>
      <Skill><Gem nameSpec="Navira's Fracturing" skillId="ChilledGroundBurstWaterDjinn"/></Skill>
      <Skill><Gem nameSpec="Cast on Minion Death" skillId="MetaCastOnMinionDeathPlayer"/></Skill>
      <Skill><Gem nameSpec="Spiraling Conspiracy" skillId="SummonSpiralingConspiracyPlayer"/></Skill>
      <Skill><Gem nameSpec="Skeletal Warrior" skillId="SummonSkeletalWarriorsPlayer"/></Skill>
      <Skill><Gem nameSpec="Spectre: Coconut Crab" skillId="SpectreCoconutCrab"/></Skill>
    </SkillSet></Skills></PathOfBuilding2>`)
    const result = createGameBuildPlanner({
      name: 'Compatibility', treeVersion: '0_5', treeData, selectedClassId: 'Mercenary',
      selectedAscendancyId: '', allocatedNodes: [], nodeWeaponSets: {}, nodeAttributeSelections: {},
      importedBuildCode: code,
      passiveMap: { schemaVersion: 1, treeVersion: '0_5', source: 'test', sourceVersion: 'test', nodes: {} },
      skillCatalog: incompatibleCatalog,
    })

    expect(result.missingSkills).toEqual([])
    expect(result.build.skills).toEqual([
      { id: 'Metadata/Items/Gem/SkillGemAscendancySummonSandDjinn' },
      { id: 'Metadata/Items/Gem/SkillGemAscendancySummonWaterDjinn' },
      { id: 'Metadata/Items/Gems/SkillGemCastOnMinionDeath' },
      { id: 'Metadata/Items/Gems/SkillGemSpiralingConspiracy' },
      { id: 'Metadata/Items/Gems/SkillGemSkeletalWarriorWeaponSkill' },
    ])
    expect(result.skippedSkills).toEqual([
      { name: 'Spectre: Coconut Crab', reason: 'spectre' },
    ])
  })

  it('does not block installation on unsupported or disabled skills', () => {
    const unsupportedCatalog: SkillCatalog = {
      ...catalog,
      entries: {
        ...catalog.entries,
        Poe2DbSkill: {
          id: 'Poe2DB:ItemGrantedSkill', name: 'Item Granted Skill', type: 'active', userVisible: true,
          gemIds: [], gameIds: [], variantIds: [], aliases: [], tags: [],
        },
      },
      lookup: {
        ...catalog.lookup,
        itemgrantedskill: 'Poe2DbSkill',
      },
    }
    const code = buildCode(`<PathOfBuilding2><Skills activeSkillSet="1"><SkillSet id="1">
      <Skill enabled="true"><Gem nameSpec="Spear" skillId="SpearPlayer"/>
        <Gem nameSpec="Unreleased Support" skillId="SupportUnreleasedPlayer"/>
      </Skill>
      <Skill enabled="true"><Gem nameSpec="Item Granted Skill" skillId="ItemGrantedSkill"/></Skill>
      <Skill enabled="true"><Gem nameSpec="Unknown Active Skill" skillId="UnknownActivePlayer"/></Skill>
      <Skill enabled="false"><Gem nameSpec="Missing Disabled Skill" skillId="MissingDisabledPlayer"/></Skill>
    </SkillSet></Skills></PathOfBuilding2>`)
    const result = createGameBuildPlanner({
      name: 'Compatibility', treeVersion: '0_5', treeData, selectedClassId: 'Mercenary',
      selectedAscendancyId: '', allocatedNodes: [], nodeWeaponSets: {}, nodeAttributeSelections: {},
      importedBuildCode: code,
      passiveMap: { schemaVersion: 1, treeVersion: '0_5', source: 'test', sourceVersion: 'test', nodes: {} },
      skillCatalog: unsupportedCatalog,
    })

    expect(result.missingSkills).toEqual([])
    expect(result.build.skills).toEqual([{ id: 'Metadata/Items/Gem/SkillGemPlayerDefaultSpear' }])
    expect(result.skippedSkills).toEqual([
      { name: 'Unreleased Support', reason: 'unsupported' },
      { name: 'Item Granted Skill', reason: 'unsupported' },
      { name: 'Unknown Active Skill', reason: 'unsupported' },
    ])
  })

  it('skips PoB hidden item-granted Thorns skill without blocking export', () => {
    const thornsCatalog: SkillCatalog = {
      ...catalog,
      entries: {
        ...catalog.entries,
        ThornsPlayer: {
          id: 'ThornsPlayer', name: 'Thorns', type: 'hidden', userVisible: false,
          gemIds: [], gameIds: [], variantIds: [], aliases: ['Thorns'], tags: [],
        },
      },
      lookup: { ...catalog.lookup, thornsplayer: 'ThornsPlayer', thorns: 'ThornsPlayer' },
    }
    const code = buildCode(`<PathOfBuilding2><Skills activeSkillSet="1"><SkillSet id="1">
      <Skill><Gem nameSpec="Spear" skillId="SpearPlayer"/></Skill>
      <Skill><Gem nameSpec="Thorns" skillId="ThornsPlayer"/></Skill>
    </SkillSet></Skills></PathOfBuilding2>`)
    const result = createGameBuildPlanner({
      name: 'Thorns', treeVersion: '0_5', treeData, selectedClassId: 'Mercenary',
      selectedAscendancyId: '', allocatedNodes: [], nodeWeaponSets: {}, nodeAttributeSelections: {},
      importedBuildCode: code,
      passiveMap: { schemaVersion: 1, treeVersion: '0_5', source: 'test', sourceVersion: 'test', nodes: {} },
      skillCatalog: thornsCatalog,
    })

    expect(result.missingSkills).toEqual([])
    expect(result.build.skills).toEqual([{ id: 'Metadata/Items/Gem/SkillGemPlayerDefaultSpear' }])
    expect(result.skippedSkills).toEqual([{ name: 'Thorns', reason: 'granted' }])
  })

  it('silently excludes embedded equipment sockets from unsupported slot warnings', () => {
    const code = buildCode(`<PathOfBuilding2><Items activeItemSet="1">
      <Item id="1"><![CDATA[Rarity: RARE\nJewel\nTime-Lost Jewel\nImplicits: 0]]></Item>
      <ItemSet id="1"><Slot name="Gloves Abyssal Socket 1" itemId="1" active="true"/></ItemSet>
    </Items></PathOfBuilding2>`)
    const result = createGameBuildPlanner({
      name: 'Socket', treeVersion: '0_5', treeData, selectedClassId: 'Mercenary',
      selectedAscendancyId: '', allocatedNodes: [], nodeWeaponSets: {}, nodeAttributeSelections: {},
      importedBuildCode: code,
      passiveMap: { schemaVersion: 1, treeVersion: '0_5', source: 'test', sourceVersion: 'test', nodes: {} },
      skillCatalog: catalog,
    })

    expect(result.omittedInventorySlots).toEqual([])
    expect(result.skippedInventorySlots).toEqual([
      { name: 'Gloves Abyssal Socket 1', reason: 'embedded-socket' },
    ])
  })

  it('sanitizes Windows file names', () => {
    expect(sanitizeBuildPlannerFileName('A:B / C')).toBe('A B C.build')
  })
})

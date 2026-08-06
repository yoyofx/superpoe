import { describe, expect, it } from 'vitest'
import { deflate } from 'pako'
import { compareBuildCodes } from '@/engine/buildDiff'

function encodeXml(xml: string): string {
  return Buffer.from(deflate(new TextEncoder().encode(xml))).toString('base64url')
}

describe('build update diff', () => {
  it('ignores PoB item ids when the equipment content is unchanged', () => {
    const left = encodeXml(
      '<PathOfBuilding2><Build level="90" className="Sorceress"/>' +
      '<Tree activeSpec="1"><Spec treeVersion="0_5" classId="3" nodes="1,2"/></Tree>' +
      '<Items activeItemSet="1"><Item id="1">Rarity: NORMAL\nQuarterstaff</Item><ItemSet id="1"><Slot name="Weapon 1" itemId="1"/></ItemSet></Items>' +
      '<Skills activeSkillSet="1"><SkillSet id="1"><Skill><Gem nameSpec="Spark" skillId="Spark" level="20" quality="20"/></Skill></SkillSet></Skills>' +
      '</PathOfBuilding2>',
    )
    const right = encodeXml(
      '<PathOfBuilding2><Build className="Sorceress" level="90"/>' +
      '<Tree activeSpec="1"><Spec treeVersion="0_5" classId="3" nodes="1,2"/></Tree>' +
      '<Items activeItemSet="1"><Item id="99">Rarity: NORMAL\nQuarterstaff</Item><ItemSet id="1"><Slot name="Weapon 1" itemId="99"/></ItemSet></Items>' +
      '<Skills activeSkillSet="1"><SkillSet id="1"><Skill><Gem nameSpec="Spark" skillId="Spark" level="20" quality="20"/></Skill></SkillSet></Skills></PathOfBuilding2>',
    )

    const diff = compareBuildCodes(left, right)

    expect(diff.hasChanges).toBe(false)
    expect(diff.total).toBe(0)
  })

  it('summarizes changes across build, tree, equipment, skills, and other settings', () => {
    const left = encodeXml(
      '<PathOfBuilding2><Build level="90" className="Sorceress" mainSocketGroup="1"/>' +
      '<Tree activeSpec="1"><Spec treeVersion="0_5" classId="3" ascendClassId="1" classInternalId="3" ascendancyInternalId="Sorceress1" nodes="1,2"><WeaponSet1 nodes="1"/></Spec></Tree>' +
      '<Items activeItemSet="1"><Item id="1">Rarity: RARE\nOld Staff\nQuarterstaff\nImplicits: 0\n+10 to Strength</Item><ItemSet id="1"><Slot name="Weapon 1" itemId="1"/></ItemSet></Items>' +
      '<Skills activeSkillSet="1"><SkillSet id="1"><Skill enabled="true"><Gem nameSpec="Spark" skillId="Spark" level="20" quality="20"/></Skill></SkillSet></Skills>' +
      '<Config><Input name="enemy" value="normal"/></Config></PathOfBuilding2>',
    )
    const right = encodeXml(
      '<PathOfBuilding2><Build level="91" className="Sorceress" mainSocketGroup="1"/>' +
      '<Tree activeSpec="1"><Spec treeVersion="0_5" classId="3" ascendClassId="1" classInternalId="3" ascendancyInternalId="Sorceress1" nodes="1,3"><WeaponSet1 nodes="1"/></Spec></Tree>' +
      '<Items activeItemSet="1"><Item id="9">Rarity: RARE\nNew Staff\nQuarterstaff\nImplicits: 0\n+20 to Strength</Item><ItemSet id="1"><Slot name="Weapon 1" itemId="9"/></ItemSet></Items>' +
      '<Skills activeSkillSet="1"><SkillSet id="1"><Skill enabled="true"><Gem nameSpec="Spark" skillId="Spark" level="21" quality="20"/></Skill></SkillSet></Skills>' +
      '<Config><Input name="enemy" value="boss"/></Config></PathOfBuilding2>',
    )

    const diff = compareBuildCodes(left, right)

    expect(diff.hasChanges).toBe(true)
    expect(diff.build.changed).toBe(1)
    expect(diff.tree.added).toBe(1)
    expect(diff.tree.removed).toBe(1)
    expect(diff.equipment.changed).toBe(1)
    expect(diff.skills.changed).toBe(1)
    expect(diff.other.changed).toBe(1)
    expect(diff.total).toBeGreaterThan(0)
  })
})

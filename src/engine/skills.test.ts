import { describe, expect, it } from 'vitest'
import { parseSkillsXml } from '@/engine/skills'

describe('parseSkillsXml', () => {
  it('keeps skill gems separate from equipment sockets', () => {
    const result = parseSkillsXml(`<?xml version="1.0"?><PathOfBuilding2><Build mainSocketGroup="1"/><Skills activeSkillSet="1"><SkillSet id="1"><Skill enabled="true"><Gem nameSpec="Spark" skillId="SparkPlayer" level="20" quality="20"/><Gem nameSpec="Pierce" skillId="SupportPierce" level="1" quality="0"/></Skill></SkillSet></Skills></PathOfBuilding2>`)
    expect(result.activeGroupId).toBe('1')
    expect(result.groups).toHaveLength(1)
    expect(result.groups[0].gems.map((gem) => gem.name)).toEqual(['Spark', 'Pierce'])
  })

  it('exposes all SkillSets while parsing only the active set groups', () => {
    const result = parseSkillsXml(`<?xml version="1.0"?><PathOfBuilding2><Build mainSocketGroup="1"/><Skills activeSkillSet="2"><SkillSet id="1" title="Mapping"><Skill><Gem nameSpec="Spark" skillId="SparkPlayer"/></Skill></SkillSet><SkillSet id="2" title="Boss"><Skill><Gem nameSpec="Comet" skillId="CometPlayer"/></Skill></SkillSet></Skills></PathOfBuilding2>`)

    expect(result.skillSets).toEqual([
      { id: '1', title: 'Mapping' },
      { id: '2', title: 'Boss' },
    ])
    expect(result.activeSkillSetId).toBe('2')
    expect(result.groups[0].gems[0]?.name).toBe('Comet')
  })
})

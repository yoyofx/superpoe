import { describe, expect, it } from 'vitest'
import { parseSkillsXml } from '@/engine/skills'

describe('parseSkillsXml', () => {
  it('keeps skill gems separate from equipment sockets', () => {
    const result = parseSkillsXml(`<?xml version="1.0"?><PathOfBuilding2><Build mainSocketGroup="1"/><Skills activeSkillSet="1"><SkillSet id="1"><Skill enabled="true"><Gem nameSpec="Spark" skillId="SparkPlayer" level="20" quality="20"/><Gem nameSpec="Pierce" skillId="SupportPierce" level="1" quality="0"/></Skill></SkillSet></Skills></PathOfBuilding2>`)
    expect(result.activeGroupId).toBe('1')
    expect(result.groups).toHaveLength(1)
    expect(result.groups[0].gems.map((gem) => gem.name)).toEqual(['Spark', 'Pierce'])
  })
})

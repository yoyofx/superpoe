import { describe, expect, it } from 'vitest'
import { decodeCodeToXml, encodeXmlToCode } from '@/engine/buildCode'
import { mergeBuildUpdateCode } from '@/engine/buildUpdateMerge'

function code(xml: string): string {
  return encodeXmlToCode(xml)
}

describe('selective build update merge', () => {
  it('keeps unchecked root sections unchanged', () => {
    const base = code(
      '<PathOfBuilding2><Build level="90"/><Tree><Spec nodes="1"/></Tree>'
      + '<Items><Item id="1">Old item</Item><ItemSet id="1"/></Items>'
      + '<Skills><SkillSet id="1"><Skill><Gem skillId="spark" level="20"/></Skill></SkillSet></Skills>'
      + '<Config><Input name="enemy" value="normal"/></Config></PathOfBuilding2>',
    )
    const remote = code(
      '<PathOfBuilding2><Build level="91"/><Tree><Spec nodes="2"/></Tree>'
      + '<Items><Item id="9">New item</Item><ItemSet id="1"/></Items>'
      + '<Skills><SkillSet id="1"><Skill><Gem skillId="spark" level="21"/></Skill></SkillSet></Skills>'
      + '<Config><Input name="enemy" value="boss"/></Config></PathOfBuilding2>',
    )

    const merged = decodeCodeToXml(mergeBuildUpdateCode(base, remote, new Set(['skills'])))
    expect(merged).toContain('<Build level="90"></Build>')
    expect(merged).toContain('<Tree><Spec nodes="1"></Spec></Tree>')
    expect(merged).toContain('<Item id="1">Old item</Item>')
    expect(merged).toContain('level="21"')
    expect(merged).toContain('value="normal"')
  })

  it('remaps remote tree jewel references when equipment is not selected', () => {
    const base = code(
      '<PathOfBuilding2><Tree><Spec nodes="1"><Sockets><Socket nodeId="1" itemId="1"/></Sockets></Spec></Tree>'
      + '<Items><Item id="1">Old jewel</Item></Items></PathOfBuilding2>',
    )
    const remote = code(
      '<PathOfBuilding2><Tree><Spec nodes="2"><Sockets><Socket nodeId="2" itemId="1"/><Socket nodeId="3" itemId="1"/></Sockets></Spec></Tree>'
      + '<Items><Item id="1">Remote jewel</Item></Items></PathOfBuilding2>',
    )

    const merged = decodeCodeToXml(mergeBuildUpdateCode(base, remote, new Set(['tree'])))
    expect(merged).toContain('nodes="2"')
    expect(merged).toContain('<Item id="1">Old jewel</Item>')
    expect(merged).toContain('<Item id="2">Remote jewel</Item>')
    expect(merged).toContain('nodeId="2" itemId="2"')
    expect(merged).toContain('nodeId="3" itemId="2"')
  })

  it('preserves current tree jewel references when only equipment is selected', () => {
    const base = code(
      '<PathOfBuilding2><Tree><Spec nodes="1"><Sockets><Socket nodeId="1" itemId="1"/></Sockets></Spec></Tree>'
      + '<Items><Item id="1">Old jewel</Item></Items></PathOfBuilding2>',
    )
    const remote = code(
      '<PathOfBuilding2><Tree><Spec nodes="2"/></Tree>'
      + '<Items><Item id="1">Remote jewel</Item><Item id="9">New gear</Item></Items></PathOfBuilding2>',
    )

    const merged = decodeCodeToXml(mergeBuildUpdateCode(base, remote, new Set(['equipment'])))
    expect(merged).toContain('nodes="1"')
    expect(merged).toContain('<Item id="1">Remote jewel</Item>')
    expect(merged).toContain('<Item id="10">Old jewel</Item>')
    expect(merged).toContain('nodeId="1" itemId="10"')
  })
})

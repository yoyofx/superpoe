import { describe, expect, it } from 'vitest'
import { deflate } from 'pako'
import { decodeCodeToXml } from '@/engine/buildCode'
import { PobBuildObject } from '@/engine/pobBuildObject'
import { createActiveBuildSession } from '@/engine/pobBuildSession'

function encodeXml(xml: string): string {
  return Buffer.from(deflate(new TextEncoder().encode(xml))).toString('base64url')
}

const sourceXml = '<?xml version="1.0" encoding="UTF-8"?><PathOfBuilding2><Build level="90"/><Unknown custom="keep"><Nested>value &amp; more</Nested></Unknown><!--keep this--></PathOfBuilding2>'

function buildPath(object: PobBuildObject, elementName: string): number[] {
  const index = object.root.children.findIndex((node) => node.kind === 'element' && node.elem === elementName)
  if (index < 0) throw new Error(`Missing ${elementName} test node`)
  return [index]
}

describe('PobBuildObject', () => {
  it('keeps the original XML until an edit is applied', () => {
    const object = PobBuildObject.fromXml(sourceXml)

    expect(object.toXml()).toBe(sourceXml)
    expect(object.revision).toBe(0)
    expect(object.dirty).toBe(false)
  })

  it('edits an XML node without dropping unknown nodes or comments', () => {
    const object = PobBuildObject.fromXml(sourceXml)
    const change = object.apply({
      type: 'set-attribute',
      path: buildPath(object, 'Build'),
      name: 'level',
      value: '91',
      section: 'build',
    })

    expect(change).toEqual({ changed: true, revision: 1, sections: ['build'] })
    expect(object.toXml()).toContain('<?xml version="1.0" encoding="UTF-8"?>')
    expect(object.toXml()).toContain('<Build level="91"></Build>')
    expect(object.toXml()).toContain('<Unknown custom="keep"><Nested>value &amp; more</Nested></Unknown>')
    expect(object.toXml()).toContain('<!--keep this-->')
  })

  it('round-trips Code through the object without changing untouched XML', () => {
    const code = encodeXml(sourceXml)
    const object = PobBuildObject.fromCode(code)

    expect(decodeCodeToXml(object.toCode())).toBe(sourceXml)
    expect(object.snapshot().contentHash).toMatch(/^fnv1a:/)
  })

  it('forks an independent object', () => {
    const object = PobBuildObject.fromXml(sourceXml)
    const fork = object.fork()

    fork.apply({ type: 'set-attribute', path: buildPath(fork, 'Build'), name: 'level', value: '92' })

    expect(object.toXml()).toBe(sourceXml)
    expect(fork.toXml()).toContain('<Build level="92"></Build>')
  })

  it('updates a uniquely selected PoB element without rebuilding other sections', () => {
    const xml = '<?xml version="1.0"?><PathOfBuilding2><Items><ItemSet id="1"><Slot name="Weapon 1" itemId="1"/></ItemSet><Item id="1">Rarity: NORMAL\nSimple Wand</Item></Items><Skills><SkillSet id="1"><Skill enabled="true"><Gem skillId="skill.one" level="1"/></Skill></SkillSet></Skills></PathOfBuilding2>'
    const object = PobBuildObject.fromXml(xml)

    expect(object.apply({
      type: 'set-attribute-selector',
      selector: { elem: 'Gem', attributes: { skillId: 'skill.one' } },
      name: 'level',
      value: '20',
      section: 'skills',
    })).toEqual({ changed: true, revision: 1, sections: ['skills'] })
    expect(object.apply({
      type: 'set-text-selector',
      selector: { elem: 'Item', attributes: { id: '1' } },
      value: 'Rarity: NORMAL\nSimple Wand\nQuality: 20%',
      section: 'items',
    })).toEqual({ changed: true, revision: 2, sections: ['items'] })
    expect(object.toXml()).toContain('<Gem skillId="skill.one" level="20"></Gem>')
    expect(object.toXml()).toContain('Quality: 20%')
    expect(object.toXml()).toContain('<Slot name="Weapon 1" itemId="1"></Slot>')
  })

  it('edits equipment selection, slots, and raw without rebuilding the Items section', () => {
    const xml = '<?xml version="1.0"?><PathOfBuilding2><Items activeItemSet="1" useSecondWeaponSet="false"><Item id="1" custom="keep">Rarity: NORMAL\nOld Wand</Item><Item id="2">Rarity: NORMAL\nNew Wand</Item><ItemSet id="1" useSecondWeaponSet="false"><Slot name="Weapon 1" itemId="1"/></ItemSet><ItemSet id="2" title="Swap" custom="keep"><Slot name="Weapon 1" itemId="1"/></ItemSet></Items><Config activeConfigSet="2"><ConfigSet id="1" title="Mapping"><Input name="conditionMoving" boolean="false"/></ConfigSet><ConfigSet id="2" title="Boss" custom="keep"><Input name="conditionMoving" boolean="true"/><Unknown value="keep"/></ConfigSet></Config><Unknown value="keep"/></PathOfBuilding2>'
    const object = PobBuildObject.fromXml(xml)

    expect(object.apply({
      type: 'set-equipment-selection',
      itemSetId: '2',
      useSecondWeaponSet: true,
      section: 'items',
    })).toEqual({ changed: true, revision: 1, sections: ['items'] })
    expect(object.toXml()).toContain('<Items activeItemSet="2" useSecondWeaponSet="true">')
    expect(object.toXml()).toContain('<ItemSet id="2" title="Swap" custom="keep" useSecondWeaponSet="true">')

    object.apply({ type: 'set-equipment-slot', itemSetId: '2', slotName: 'Weapon 1', itemId: '2', section: 'items' })
    object.apply({ type: 'replace-item-raw', itemId: '2', raw: 'Rarity: UNIQUE\nNew Wand\nQuality: 20%', section: 'items' })
    expect(object.toXml()).toContain('<Slot name="Weapon 1" itemId="2"></Slot>')
    expect(object.toXml()).toContain('Rarity: UNIQUE\nNew Wand\nQuality: 20%')
    expect(object.toXml()).toContain('<Item id="1" custom="keep">Rarity: NORMAL\nOld Wand</Item>')
    expect(object.toXml()).toContain('<Unknown value="keep"></Unknown>')
    expect(object.toXml()).toContain('<Config activeConfigSet="2">')
    expect(object.toXml()).toContain('<ConfigSet id="1" title="Mapping"><Input name="conditionMoving" boolean="false"></Input></ConfigSet>')
    expect(object.toXml()).toContain('<ConfigSet id="2" title="Boss" custom="keep"><Input name="conditionMoving" boolean="true"></Input><Unknown value="keep"></Unknown></ConfigSet>')
  })

  it('adds a canonical Raw item and points a slot at its new id', () => {
    const xml = '<?xml version="1.0"?><PathOfBuilding2><Items><Item id="1">Rarity: NORMAL\nOld Wand</Item><ItemSet id="1"><Slot name="Weapon 1" itemId="1"/></ItemSet><Unknown value="keep"/></Items></PathOfBuilding2>'
    const object = PobBuildObject.fromXml(xml)

    expect(object.apply({
      type: 'replace-equipment-slot-raw',
      itemSetId: '1',
      slotName: 'Weapon 1',
      raw: 'Rarity: UNIQUE\nNew Wand\nQuality: 20%',
      section: 'items',
    })).toEqual({ changed: true, revision: 1, sections: ['items'] })
    expect(object.toXml()).toContain('<Item id="2">Rarity: UNIQUE\nNew Wand\nQuality: 20%</Item>')
    expect(object.toXml()).toContain('<Slot name="Weapon 1" itemId="2"></Slot>')
    expect(object.toXml()).toContain('<Unknown value="keep"></Unknown>')
  })

  it('updates a skill gem by stable SkillSet and ordered group/gem indexes', () => {
    const xml = '<?xml version="1.0"?><PathOfBuilding2><Skills activeSkillSet="1"><SkillSet id="1"><Skill enabled="true"><Gem skillId="skill.one" level="1" quality="0" custom="keep"/><Gem skillId="support.one" level="1"/></Skill></SkillSet></Skills><Build mainSocketGroup="1"/></PathOfBuilding2>'
    const object = PobBuildObject.fromXml(xml)

    expect(object.apply({
      type: 'update-skill-gem',
      skillSetId: '1',
      skillIndex: 0,
      gemIndex: 0,
      attributes: { level: '20', quality: '20', enabled: 'true' },
      section: 'skills',
    })).toEqual({ changed: true, revision: 1, sections: ['skills'] })
    expect(object.apply({ type: 'set-main-socket-group', groupId: '2', section: 'skills' })).toEqual({ changed: true, revision: 2, sections: ['skills'] })
    expect(object.toXml()).toContain('<Gem skillId="skill.one" level="20" quality="20" custom="keep" enabled="true"></Gem>')
    expect(object.toXml()).toContain('<Build mainSocketGroup="2"></Build>')
  })

  it('updates skill-group attributes without rebuilding the surrounding XML', () => {
    const xml = '<?xml version="1.0"?><PathOfBuilding2><Skills activeSkillSet="1"><SkillSet id="1"><Skill enabled="true"><Gem skillId="skill.one"/></Skill><Skill enabled="true"><Gem skillId="skill.two"/></Skill></SkillSet></Skills><Unknown value="keep"/></PathOfBuilding2>'
    const object = PobBuildObject.fromXml(xml)

    expect(object.apply({
      type: 'update-skill-group',
      skillSetId: '1',
      skillIndex: 1,
      attributes: { enabled: 'false', includeInFullDPS: 'true' },
      section: 'skills',
    })).toEqual({ changed: true, revision: 1, sections: ['skills'] })
    expect(object.toXml()).toContain('<Skill enabled="false" includeInFullDPS="true">')
    expect(object.toXml()).toContain('<Unknown value="keep"></Unknown>')
  })

  it('switches the active SkillSet without rebuilding other skill sets', () => {
    const xml = '<?xml version="1.0"?><PathOfBuilding2><Skills activeSkillSet="1" custom="keep"><SkillSet id="1"><Skill><Gem skillId="skill.one"/></Skill></SkillSet><SkillSet id="2" title="Boss"><Skill><Gem skillId="skill.two"/></Skill></SkillSet></Skills><Config activeConfigSet="2"><ConfigSet id="1" title="Mapping"><Input name="conditionMoving" boolean="false"/></ConfigSet><ConfigSet id="2" title="Boss"><Input name="conditionMoving" boolean="true"/></ConfigSet></Config><Unknown value="keep"/></PathOfBuilding2>'
    const object = PobBuildObject.fromXml(xml)

    expect(object.apply({ type: 'set-active-skill-set', skillSetId: '2', section: 'skills' })).toEqual({
      changed: true,
      revision: 1,
      sections: ['skills'],
    })
    expect(object.toXml()).toContain('<Skills activeSkillSet="2" custom="keep">')
    expect(object.toXml()).toContain('<SkillSet id="1"><Skill><Gem skillId="skill.one"></Gem></Skill></SkillSet>')
    expect(object.toXml()).toContain('<SkillSet id="2" title="Boss"><Skill><Gem skillId="skill.two"></Gem></Skill></SkillSet>')
    expect(object.toXml()).toContain('<Config activeConfigSet="2"><ConfigSet id="1" title="Mapping"><Input name="conditionMoving" boolean="false"></Input></ConfigSet><ConfigSet id="2" title="Boss"><Input name="conditionMoving" boolean="true"></Input></ConfigSet></Config>')
    expect(object.toXml()).toContain('<Unknown value="keep"></Unknown>')
  })

  it('updates the active Tree Spec without dropping unknown Tree content', () => {
    const xml = '<?xml version="1.0"?><PathOfBuilding2><Tree activeSpec="2" custom="keep"><Spec treeVersion="0_5" classId="1" nodes="old-one"><URL><Text>legacy</Text></URL><WeaponSet1 nodes="old-one"/></Spec><Spec treeVersion="0_5" classId="2" nodes="old-two" custom="preserve"><WeaponSet1 nodes="old-two"><Future value="keep"/></WeaponSet1><UnknownTree value="keep"/></Spec></Tree><Config activeConfigSet="2"><ConfigSet id="1"/><ConfigSet id="2"/></Config></PathOfBuilding2>'
    const object = PobBuildObject.fromXml(xml)

    expect(object.apply({
      type: 'replace-tree-state',
      state: {
        treeVersion: '0_5',
        classId: '6',
        ascendClassId: '1',
        classInternalId: '7',
        ascendancyInternalId: 'Sorceress1',
        className: 'Sorceress',
        ascendancyName: 'Stormweaver',
        nodes: ['100', '200'],
        weaponSet1Nodes: ['100'],
        weaponSet2Nodes: ['200'],
        attributeOverride: { strNodes: ['100'], dexNodes: [], intNodes: ['200'] },
      },
      section: 'tree',
    })).toEqual({ changed: true, revision: 1, sections: ['tree'] })
    expect(object.toXml()).toContain('<Tree activeSpec="2" custom="keep">')
    expect(object.toXml()).toContain('<Spec treeVersion="0_5" classId="1" nodes="old-one"><URL><Text>legacy</Text></URL><WeaponSet1 nodes="old-one"></WeaponSet1></Spec>')
    expect(object.toXml()).toContain('<Spec treeVersion="0_5" classId="6" nodes="100,200" custom="preserve" ascendClassId="1" classInternalId="7" ascendancyInternalId="Sorceress1" className="Sorceress" ascendClassName="Stormweaver"><WeaponSet1 nodes="100"><Future value="keep"></Future></WeaponSet1><UnknownTree value="keep"></UnknownTree><WeaponSet2 nodes="200"></WeaponSet2><Overrides><AttributeOverride strNodes="100" dexNodes="" intNodes="200"></AttributeOverride></Overrides></Spec>')
    expect(object.toXml()).toContain('<Config activeConfigSet="2"><ConfigSet id="1"></ConfigSet><ConfigSet id="2"></ConfigSet></Config>')
  })

  it('reads mastery selections and passive jewel sockets from the active XML Spec', () => {
    const object = PobBuildObject.fromXml('<?xml version="1.0"?><PathOfBuilding2><Tree activeSpec="2"><Spec treeVersion="0_5" nodes="old" masteryEffects="{100,200}"/><Spec treeVersion="0_5" classId="6" ascendClassId="1" nodes="100,300" masteryEffects="{100,200},{300,400}"><Sockets><Socket nodeId="100" itemId="12"/></Sockets><UnknownTree value="keep"/></Spec></Tree></PathOfBuilding2>')

    expect(object.getTreeState()).toMatchObject({
      classId: '6',
      nodes: ['100', '300'],
      masterySelections: { '100': '200', '300': '400' },
      jewelSockets: { '100': '12' },
    })
    expect(object.getTreeSpecStates().specs).toHaveLength(2)
    expect(object.getTreeSpecStates().activeSpecIndex).toBe(2)
  })

  it('switches active Tree Spec without rewriting either Spec', () => {
    const object = PobBuildObject.fromXml('<?xml version="1.0"?><PathOfBuilding2><Tree activeSpec="1"><Spec treeVersion="0_5" nodes="100"><Unknown value="one"/></Spec><Spec treeVersion="0_5" nodes="200"><Unknown value="two"/></Spec></Tree></PathOfBuilding2>')
    expect(object.apply({ type: 'set-active-tree-spec', specIndex: 2, section: 'tree' })).toEqual({ changed: true, revision: 1, sections: ['tree'] })
    expect(object.getTreeState().nodes).toEqual(['200'])
    expect(object.toXml()).toContain('<Tree activeSpec="2"><Spec treeVersion="0_5" nodes="100"><Unknown value="one"></Unknown></Spec><Spec treeVersion="0_5" nodes="200"><Unknown value="two"></Unknown></Spec></Tree>')
  })

  it('updates mastery selections and a passive jewel socket without rebuilding the Spec', () => {
    const object = PobBuildObject.fromXml('<?xml version="1.0"?><PathOfBuilding2><Tree activeSpec="1"><Spec treeVersion="0_5" nodes="100" masteryEffects="{100,200}"><Sockets><UnknownSocket value="keep"/><Socket nodeId="100" itemId="12"/></Sockets><UnknownTree value="keep"/></Spec></Tree></PathOfBuilding2>')

    expect(object.apply({
      type: 'replace-tree-state',
      state: { treeVersion: '0_5', classId: '', ascendClassId: '', nodes: ['100'], masterySelections: { '100': '201' }, jewelSockets: { '100': '13', '300': '14' } },
      section: 'tree',
    }).changed).toBe(true)
    expect(object.toXml()).toContain('masteryEffects="{100,201}"')
    expect(object.toXml()).toContain('<Socket nodeId="100" itemId="13"></Socket><Socket nodeId="300" itemId="14"></Socket>')
    expect(object.toXml()).toContain('<UnknownSocket value="keep"></UnknownSocket>')
    expect(object.toXml()).toContain('<UnknownTree value="keep"></UnknownTree>')

    expect(object.apply({ type: 'set-tree-jewel-socket', nodeId: '300', itemId: '15', section: 'tree' }).changed).toBe(true)
    expect(object.getTreeState().jewelSockets).toEqual({ '100': '13', '300': '15' })
    expect(object.apply({ type: 'set-tree-jewel-socket', nodeId: '100', section: 'tree' }).changed).toBe(true)
    expect(object.getTreeState().jewelSockets).toEqual({ '300': '15' })
  })

  it('restores XML snapshots and recalculates dirty state', () => {
    const xml = '<?xml version="1.0"?><PathOfBuilding2><Build level="90"/><Unknown value="keep"/></PathOfBuilding2>'
    const object = PobBuildObject.fromXml(xml)

    object.apply({ type: 'set-attribute', path: [0], name: 'level', value: '91' })
    const editedXml = object.toXml()
    expect(object.dirty).toBe(true)
    expect(object.restoreXml(xml)).toEqual({ changed: true, revision: 2, sections: ['all'] })
    expect(object.toXml()).toBe(xml)
    expect(object.dirty).toBe(false)
    expect(object.restoreXml(editedXml).changed).toBe(true)
    expect(object.dirty).toBe(true)
  })

  it('rejects missing equipment and skill references before changing the object', () => {
    const object = PobBuildObject.fromXml('<?xml version="1.0"?><PathOfBuilding2><Items><ItemSet id="1"/></Items><Skills><SkillSet id="1"/></Skills></PathOfBuilding2>')
    expect(() => object.apply({ type: 'set-equipment-slot', itemSetId: '1', slotName: 'Weapon 1', itemId: '1' })).toThrow('expected exactly one')
    expect(() => object.apply({ type: 'update-skill-gem', skillSetId: '1', skillIndex: 0, gemIndex: 0, attributes: { level: '2' } })).toThrow('was not found')
    expect(object.revision).toBe(0)
  })

  it('rejects ambiguous selectors instead of changing an arbitrary skill or item', () => {
    const object = PobBuildObject.fromXml('<?xml version="1.0"?><PathOfBuilding2><Skills><SkillSet id="1"><Skill><Gem skillId="duplicate"/></Skill><Skill><Gem skillId="duplicate"/></Skill></SkillSet></Skills></PathOfBuilding2>')
    expect(() => object.apply({
      type: 'set-attribute-selector',
      selector: { elem: 'Gem', attributes: { skillId: 'duplicate' } },
      name: 'level',
      value: '10',
    })).toThrow('matched 2 elements')
    expect(object.revision).toBe(0)
  })

  it('rejects use after dispose', () => {
    const object = PobBuildObject.fromXml(sourceXml)
    object.dispose()

    expect(() => object.toXml()).toThrow('PobBuildObject has been disposed')
  })
})

describe('ActiveBuildSession', () => {
  it('owns one object and releases it as a unit', () => {
    const session = createActiveBuildSession('build-1', encodeXml(sourceXml))

    expect(session.buildId).toBe('build-1')
    expect(session.revision).toBe(0)
    session.apply({ type: 'set-attribute', path: buildPath(session.object, 'Build'), name: 'level', value: '91' })
    expect(session.dirty).toBe(true)

    session.dispose()
    expect(() => session.revision).toThrow('ActiveBuildSession has been disposed')
    expect(() => session.object.toXml()).toThrow('PobBuildObject has been disposed')
  })
})

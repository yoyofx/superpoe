import { decodeBuildCode, decodeCodeToXml, encodeXmlToCode, type NodeJewels } from '@/engine/buildCode'
import { normalizePobBuildXml } from '@/engine/pobItemCompatibility'
import {
  clonePobXmlDocument,
  findPobXmlElements,
  getPobXmlElementAtPath,
  parsePobXml,
  replacePobXmlElementText,
  serializePobXml,
  type PobXmlElementSelector,
  type PobXmlDocument,
  type PobXmlElement,
  getPobXmlDirectChildren,
} from '@/engine/pobXmlAst'

export type PobSkillGemAttribute = string | undefined

export interface PobTreeState {
  treeVersion: string
  classId: string
  ascendClassId: string
  classInternalId?: string
  ascendancyInternalId?: string
  className?: string
  ascendancyName?: string
  secondaryAscendClassId?: string
  nodes: string[]
  masterySelections?: Record<string, string>
  jewelSockets?: Record<string, string>
  weaponSet1Nodes?: string[]
  weaponSet2Nodes?: string[]
  attributeOverride?: {
    strNodes?: string[]
    dexNodes?: string[]
    intNodes?: string[]
  }
}

export type PobBuildCommand =
  | { type: 'set-attribute'; path: number[]; name: string; value: string; section?: string }
  | { type: 'set-attribute-selector'; selector: PobXmlElementSelector; name: string; value: string; section?: string }
  | { type: 'set-text-selector'; selector: PobXmlElementSelector; value: string; section?: string }
  | { type: 'set-equipment-selection'; itemSetId: string; useSecondWeaponSet: boolean; section?: string }
  | { type: 'set-equipment-slot'; itemSetId: string; slotName: string; itemId: string; section?: string }
  | { type: 'replace-equipment-slot-raw'; itemSetId: string; slotName: string; raw: string; section?: string }
  | { type: 'replace-item-raw'; itemId: string; raw: string; section?: string }
  | {
    type: 'update-skill-gem'
    skillSetId: string
    skillIndex: number
    gemIndex: number
    attributes: Record<string, PobSkillGemAttribute>
    section?: string
  }
  | {
    type: 'update-skill-group'
    skillSetId: string
    skillIndex: number
    attributes: Record<string, PobSkillGemAttribute>
    section?: string
  }
  | { type: 'set-active-skill-set'; skillSetId: string; section?: string }
  | { type: 'set-main-socket-group'; groupId: string; section?: string }
  | { type: 'set-active-tree-spec'; specIndex: number; section?: string }
  | { type: 'set-tree-jewel-socket'; nodeId: string; itemId?: string; section?: string }
  | { type: 'bind-tree-jewel-raw'; nodeId: string; raw: string; dynamic?: boolean; section?: string }
  | { type: 'replace-tree-state'; state: PobTreeState; section?: string }

export interface PobBuildChange {
  changed: boolean
  revision: number
  sections: string[]
}

export interface PobBuildSnapshot {
  revision: number
  xml: string
  contentHash: string
}

function hashText(value: string): string {
  // Runtime identity only; persistent file integrity continues to use SHA-256.
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return `fnv1a:${(hash >>> 0).toString(16).padStart(8, '0')}`
}

export class PobBuildObject {
  private readonly document: PobXmlDocument
  private readonly originalXml: string
  private changed = false
  private disposed = false
  private currentRevision = 0

  private constructor(document: PobXmlDocument, originalXml: string) {
    this.document = document
    this.originalXml = originalXml
  }

  static fromXml(xml: string): PobBuildObject {
    const normalizedXml = normalizePobBuildXml(xml).xml
    return new PobBuildObject(parsePobXml(normalizedXml), normalizedXml)
  }

  static fromCode(code: string): PobBuildObject {
    return PobBuildObject.fromXml(decodeCodeToXml(code))
  }

  get root(): PobXmlElement {
    this.assertActive()
    return this.document.root
  }

  get revision(): number {
    this.assertActive()
    return this.currentRevision
  }

  get dirty(): boolean {
    this.assertActive()
    return this.changed
  }

  apply(command: PobBuildCommand): PobBuildChange {
    this.assertActive()
    const target = command.type === 'set-attribute'
      ? getPobXmlElementAtPath(this.document.root, command.path)
      : command.type === 'set-attribute-selector' || command.type === 'set-text-selector'
        ? this.resolveSelector(command.selector)
        : null

    let changed = false
    if (command.type === 'set-attribute' || command.type === 'set-attribute-selector') {
      if (!target) throw new Error('Cannot apply PoB command: XML selector/path does not resolve to exactly one element')
      changed = target.attrib[command.name] !== command.value
      if (changed) target.attrib[command.name] = command.value
    } else if (command.type === 'set-text-selector') {
      if (!target) throw new Error('Cannot apply PoB command: XML selector/path does not resolve to exactly one element')
      changed = replacePobXmlElementText(target, command.value)
    } else if (command.type === 'set-equipment-selection') {
      changed = this.setEquipmentSelection(command.itemSetId, command.useSecondWeaponSet)
    } else if (command.type === 'set-equipment-slot') {
      changed = this.setEquipmentSlot(command.itemSetId, command.slotName, command.itemId)
    } else if (command.type === 'replace-equipment-slot-raw') {
      changed = this.replaceEquipmentSlotRaw(command.itemSetId, command.slotName, command.raw)
    } else if (command.type === 'replace-item-raw') {
      const item = this.resolveSelector({ elem: 'Item', attributes: { id: command.itemId } })
      changed = replacePobXmlElementText(item, command.raw)
    } else if (command.type === 'update-skill-gem') {
      changed = this.updateSkillGem(command)
    } else if (command.type === 'update-skill-group') {
      changed = this.updateSkillGroup(command)
    } else if (command.type === 'set-active-skill-set') {
      changed = this.setActiveSkillSet(command.skillSetId)
    } else if (command.type === 'set-main-socket-group') {
      const build = getPobXmlDirectChildren(this.document.root, 'Build')
      if (build.length !== 1) throw new Error(`PoB XML contains ${build.length} Build elements; expected exactly one`)
      if (!/^\d+$/.test(command.groupId) || Number(command.groupId) < 1) {
        throw new Error('Skill group id must be a positive integer')
      }
      changed = build[0].attrib.mainSocketGroup !== command.groupId
      if (changed) build[0].attrib.mainSocketGroup = command.groupId
    } else if (command.type === 'set-active-tree-spec') {
      changed = this.setActiveTreeSpec(command.specIndex)
    } else if (command.type === 'set-tree-jewel-socket') {
      changed = this.setTreeJewelSocket(command.nodeId, command.itemId)
    } else if (command.type === 'bind-tree-jewel-raw') {
      changed = this.bindTreeJewelRaw(command.nodeId, command.raw, command.dynamic === true)
    } else if (command.type === 'replace-tree-state') {
      changed = this.replaceTreeState(command.state)
    }
    if (!changed) return { changed: false, revision: this.currentRevision, sections: [] }
    this.changed = true
    this.currentRevision += 1
    return { changed: true, revision: this.currentRevision, sections: 'section' in command && command.section ? [command.section] : [] }
  }

  snapshot(): PobBuildSnapshot {
    this.assertActive()
    const xml = this.toXml()
    return { revision: this.currentRevision, xml, contentHash: hashText(xml) }
  }

  /** Read the active Tree Spec from the canonical XML object. */
  getTreeState(): PobTreeState {
    const states = this.getTreeSpecStates()
    return states.specs[states.activeSpecIndex - 1] || states.specs[0]
  }

  /** Read every Tree Spec while preserving the XML order and active index. */
  getTreeSpecStates(): { activeSpecIndex: number; specs: PobTreeState[] } {
    this.assertActive()
    const tree = getPobXmlDirectChildren(this.document.root, 'Tree')[0]
    if (!tree) throw new Error('PoB XML contains no Tree section')
    const specs = getPobXmlDirectChildren(tree, 'Spec')
    if (!specs.length) throw new Error('PoB XML contains no Tree Spec elements')
    const requestedIndex = Number.parseInt(tree.attrib.activeSpec || '1', 10)
    const activeSpecIndex = Number.isInteger(requestedIndex) && requestedIndex >= 1 && requestedIndex <= specs.length ? requestedIndex : 1
    const parseSpec = (spec: PobXmlElement): PobTreeState => {
    const parseIds = (value?: string) => (value || '').split(',').map((id) => id.trim()).filter(Boolean)
    const childAttrs = (elem: string) => getPobXmlDirectChildren(spec, elem)[0]?.attrib || {}
    const override = getPobXmlDirectChildren(spec, 'Overrides')[0]
    const attribute = override ? getPobXmlDirectChildren(override, 'AttributeOverride')[0] : undefined
    const masterySelections: Record<string, string> = {}
    for (const match of (spec.attrib.masteryEffects || '').matchAll(/\{(\d+),(\d+)\}/g)) masterySelections[match[1]] = match[2]
    const jewelSockets: Record<string, string> = {}
    const sockets = getPobXmlDirectChildren(spec, 'Sockets')[0]
    for (const socket of sockets ? getPobXmlDirectChildren(sockets, 'Socket') : []) {
      if (socket.attrib.nodeId && socket.attrib.itemId) jewelSockets[socket.attrib.nodeId] = socket.attrib.itemId
    }
    return {
      treeVersion: spec.attrib.treeVersion || '',
      classId: spec.attrib.classId || '',
      ascendClassId: spec.attrib.ascendClassId || '',
      classInternalId: spec.attrib.classInternalId,
      ascendancyInternalId: spec.attrib.ascendancyInternalId,
      className: spec.attrib.className,
      ascendancyName: spec.attrib.ascendClassName,
      secondaryAscendClassId: spec.attrib.secondaryAscendClassId,
      nodes: parseIds(spec.attrib.nodes),
      masterySelections,
      jewelSockets,
      weaponSet1Nodes: parseIds(childAttrs('WeaponSet1').nodes),
      weaponSet2Nodes: parseIds(childAttrs('WeaponSet2').nodes),
      attributeOverride: {
        strNodes: parseIds(attribute?.attrib.strNodes),
        dexNodes: parseIds(attribute?.attrib.dexNodes),
        intNodes: parseIds(attribute?.attrib.intNodes),
      },
    }
    }
    return { activeSpecIndex, specs: specs.map(parseSpec) }
  }

  /** Resolve passive jewel item records from the current XML snapshot. */
  getPassiveJewelItems(): NodeJewels {
    this.assertActive()
    try {
      return decodeBuildCode(this.toCode()).nodeJewels
    } catch {
      return {}
    }
  }

  /** Read the exact Raw text for an Item kept in the canonical XML object. */
  getItemRaw(itemId: string): string | null {
    this.assertActive()
    const normalizedId = itemId.trim()
    if (!normalizedId) return null
    const items = getPobXmlDirectChildren(this.document.root, 'Items')
    if (items.length !== 1) return null
    const item = getPobXmlDirectChildren(items[0], 'Item').find((entry) => entry.attrib.id === normalizedId)
    if (!item) return null
    const raw = item.children
      .map((child) => child.kind === 'text' || child.kind === 'cdata' ? child.value : '')
      .join('')
      .trim()
    return raw || null
  }

  /** Read the Raw text referenced by a passive jewel socket. */
  getPassiveJewelRaw(nodeId: string): { itemId: string; raw: string } | null {
    const itemId = this.getTreeState().jewelSockets?.[nodeId.trim()]
    if (!itemId) return null
    const raw = this.getItemRaw(itemId)
    return raw ? { itemId, raw } : null
  }

  restoreXml(xml: string, section = 'all'): PobBuildChange {
    this.assertActive()
    const currentXml = this.toXml()
    if (currentXml === xml) return { changed: false, revision: this.currentRevision, sections: [] }

    // Parse before mutating the live document so a malformed history entry
    // cannot leave the active build half-restored.
    const restored = parsePobXml(xml)
    this.document.nodes = restored.nodes
    this.document.root = restored.root
    this.changed = xml !== this.originalXml
    this.currentRevision += 1
    return { changed: true, revision: this.currentRevision, sections: [section] }
  }

  toXml(): string {
    this.assertActive()
    return this.changed ? serializePobXml(this.document) : this.originalXml
  }

  toCode(): string {
    this.assertActive()
    return encodeXmlToCode(this.toXml())
  }

  fork(): PobBuildObject {
    this.assertActive()
    return new PobBuildObject(clonePobXmlDocument(this.document), this.toXml())
  }

  dispose(): void {
    this.disposed = true
  }

  private resolveSelector(selector: PobXmlElementSelector): PobXmlElement {
    const matches = findPobXmlElements(this.document.root, selector)
    if (matches.length !== 1) {
      throw new Error(`PoB XML selector matched ${matches.length} elements; expected exactly one`)
    }
    return matches[0]
  }

  private setEquipmentSelection(itemSetId: string, useSecondWeaponSet: boolean): boolean {
    if (!itemSetId.trim()) throw new Error('Item set id is required')
    const items = getPobXmlDirectChildren(this.document.root, 'Items')
    if (items.length !== 1) throw new Error(`PoB XML contains ${items.length} Items sections; expected exactly one`)
    const itemSets = getPobXmlDirectChildren(items[0], 'ItemSet').filter((entry) => entry.attrib.id === itemSetId)
    if (itemSets.length !== 1) throw new Error(`ItemSet "${itemSetId}" matched ${itemSets.length} elements; expected exactly one`)
    const itemSet = itemSets[0]
    const value = String(useSecondWeaponSet)
    const changed = items[0].attrib.activeItemSet !== itemSetId
      || items[0].attrib.useSecondWeaponSet !== value
      || itemSet.attrib.useSecondWeaponSet !== value
    if (!changed) return false
    items[0].attrib.activeItemSet = itemSetId
    items[0].attrib.useSecondWeaponSet = value
    itemSet.attrib.useSecondWeaponSet = value
    return true
  }

  private setEquipmentSlot(itemSetId: string, slotName: string, itemId: string): boolean {
    if (!itemSetId.trim() || !slotName.trim()) throw new Error('Item set id and slot name are required')
    const items = getPobXmlDirectChildren(this.document.root, 'Items')
    if (items.length !== 1) throw new Error(`PoB XML contains ${items.length} Items sections; expected exactly one`)
    const itemSets = getPobXmlDirectChildren(items[0], 'ItemSet').filter((entry) => entry.attrib.id === itemSetId)
    if (itemSets.length !== 1) throw new Error(`ItemSet "${itemSetId}" matched ${itemSets.length} elements; expected exactly one`)
    const itemSet = itemSets[0]
    const slots = getPobXmlDirectChildren(itemSet, 'Slot').filter((entry) => entry.attrib.name === slotName)
    if (slots.length !== 1) throw new Error(`ItemSet "${itemSetId}" contains ${slots.length} slots named "${slotName}"; expected exactly one`)
    const slot = slots[0]
    if (slot.attrib.itemId === itemId) return false
    slot.attrib.itemId = itemId
    return true
  }

  private replaceEquipmentSlotRaw(itemSetId: string, slotName: string, raw: string): boolean {
    const normalizedRaw = raw.trim()
    if (!normalizedRaw) throw new Error('Equipment Raw cannot be empty')
    if (!itemSetId.trim() || !slotName.trim()) throw new Error('Item set id and slot name are required')
    const itemsSections = getPobXmlDirectChildren(this.document.root, 'Items')
    if (itemsSections.length !== 1) throw new Error(`PoB XML contains ${itemsSections.length} Items sections; expected exactly one`)
    const items = itemsSections[0]
    const itemSets = getPobXmlDirectChildren(items, 'ItemSet').filter((entry) => entry.attrib.id === itemSetId)
    if (itemSets.length !== 1) throw new Error(`ItemSet "${itemSetId}" matched ${itemSets.length} elements; expected exactly one`)
    const itemSet = itemSets[0]
    const slots = getPobXmlDirectChildren(itemSet, 'Slot').filter((entry) => entry.attrib.name === slotName)
    if (slots.length !== 1) throw new Error(`ItemSet "${itemSetId}" contains ${slots.length} slots named "${slotName}"; expected exactly one`)

    const itemNodes = getPobXmlDirectChildren(items, 'Item')
    const usedIds = new Set(itemNodes.map((item) => item.attrib.id).filter(Boolean))
    let nextNumericId = itemNodes.reduce((max, item) => {
      const value = Number(item.attrib.id)
      return Number.isInteger(value) && value > max ? value : max
    }, 0) + 1
    while (usedIds.has(String(nextNumericId))) nextNumericId += 1
    const itemId = String(nextNumericId)
    const newItem: PobXmlElement = {
      kind: 'element',
      elem: 'Item',
      attrib: { id: itemId },
      children: [{ kind: 'text', value: normalizedRaw }],
    }
    const firstItemSetIndex = items.children.findIndex((child) => child.kind === 'element' && child.elem === 'ItemSet')
    if (firstItemSetIndex < 0) items.children.push(newItem)
    else items.children.splice(firstItemSetIndex, 0, newItem)
    slots[0].attrib.itemId = itemId
    return true
  }

  private updateSkillGem(command: Extract<PobBuildCommand, { type: 'update-skill-gem' }>): boolean {
    if (!Number.isInteger(command.skillIndex) || command.skillIndex < 0) throw new Error('Skill index must be a non-negative integer')
    if (!Number.isInteger(command.gemIndex) || command.gemIndex < 0) throw new Error('Gem index must be a non-negative integer')
    const skills = getPobXmlDirectChildren(this.document.root, 'Skills')
    if (skills.length !== 1) throw new Error(`PoB XML contains ${skills.length} Skills sections; expected exactly one`)
    const skillSets = getPobXmlDirectChildren(skills[0], 'SkillSet').filter((entry) => entry.attrib.id === command.skillSetId)
    if (skillSets.length !== 1) throw new Error(`SkillSet "${command.skillSetId}" matched ${skillSets.length} elements; expected exactly one`)
    const skillSet = skillSets[0]
    const groups = getPobXmlDirectChildren(skillSet, 'Skill')
    const group = groups[command.skillIndex]
    if (!group) throw new Error(`Skill group index ${command.skillIndex} was not found in SkillSet "${command.skillSetId}"`)
    const gems = getPobXmlDirectChildren(group, 'Gem')
    const gem = gems[command.gemIndex]
    if (!gem) throw new Error(`Gem index ${command.gemIndex} was not found in skill group ${command.skillIndex}`)
    let changed = false
    for (const [name, value] of Object.entries(command.attributes)) {
      if (value === undefined) {
        if (!(name in gem.attrib)) continue
        delete gem.attrib[name]
        changed = true
      } else if (gem.attrib[name] !== value) {
        gem.attrib[name] = value
        changed = true
      }
    }
    return changed
  }

  private updateSkillGroup(command: Extract<PobBuildCommand, { type: 'update-skill-group' }>): boolean {
    if (!Number.isInteger(command.skillIndex) || command.skillIndex < 0) throw new Error('Skill index must be a non-negative integer')
    const skills = getPobXmlDirectChildren(this.document.root, 'Skills')
    if (skills.length !== 1) throw new Error(`PoB XML contains ${skills.length} Skills sections; expected exactly one`)
    const skillSets = getPobXmlDirectChildren(skills[0], 'SkillSet').filter((entry) => entry.attrib.id === command.skillSetId)
    if (skillSets.length !== 1) throw new Error(`SkillSet "${command.skillSetId}" matched ${skillSets.length} elements; expected exactly one`)
    const groups = getPobXmlDirectChildren(skillSets[0], 'Skill')
    const group = groups[command.skillIndex]
    if (!group) throw new Error(`Skill group index ${command.skillIndex} was not found in SkillSet "${command.skillSetId}"`)
    let changed = false
    for (const [name, value] of Object.entries(command.attributes)) {
      if (value === undefined) {
        if (!(name in group.attrib)) continue
        delete group.attrib[name]
        changed = true
      } else if (group.attrib[name] !== value) {
        group.attrib[name] = value
        changed = true
      }
    }
    return changed
  }

  private setActiveSkillSet(skillSetId: string): boolean {
    if (!skillSetId.trim()) throw new Error('Skill set id is required')
    const skills = getPobXmlDirectChildren(this.document.root, 'Skills')
    if (skills.length !== 1) throw new Error(`PoB XML contains ${skills.length} Skills sections; expected exactly one`)
    const skillSets = getPobXmlDirectChildren(skills[0], 'SkillSet').filter((entry) => entry.attrib.id === skillSetId)
    if (skillSets.length !== 1) throw new Error(`SkillSet "${skillSetId}" matched ${skillSets.length} elements; expected exactly one`)
    if (skills[0].attrib.activeSkillSet === skillSetId) return false
    skills[0].attrib.activeSkillSet = skillSetId
    return true
  }

  private replaceTreeState(state: PobTreeState): boolean {
    if (!state.treeVersion.trim()) throw new Error('Tree version is required')
    const trees = getPobXmlDirectChildren(this.document.root, 'Tree')
    if (trees.length !== 1) throw new Error(`PoB XML contains ${trees.length} Tree sections; expected exactly one`)
    const specs = getPobXmlDirectChildren(trees[0], 'Spec')
    if (!specs.length) throw new Error('PoB XML contains no Tree Spec elements')

    const requestedIndex = Number.parseInt(trees[0].attrib.activeSpec || '1', 10)
    const spec = specs[(Number.isInteger(requestedIndex) && requestedIndex >= 1 ? requestedIndex : 1) - 1] || specs[0]
    let changed = false
    const setAttribute = (name: string, value: string | undefined, removeWhenMissing = false) => {
      if (value == null || value === '') {
        if (removeWhenMissing && name in spec.attrib) {
          delete spec.attrib[name]
          changed = true
        }
        return
      }
      if (spec.attrib[name] !== value) {
        spec.attrib[name] = value
        changed = true
      }
    }

    setAttribute('treeVersion', state.treeVersion)
    setAttribute('classId', state.classId)
    setAttribute('ascendClassId', state.ascendClassId)
    setAttribute('classInternalId', state.classInternalId, true)
    setAttribute('ascendancyInternalId', state.ascendancyInternalId, true)
    setAttribute('className', state.className, true)
    setAttribute('ascendClassName', state.ascendancyName, true)
    if (state.secondaryAscendClassId !== undefined) setAttribute('secondaryAscendClassId', state.secondaryAscendClassId)
    setAttribute('nodes', state.nodes.join(','))
    if (state.masterySelections !== undefined) {
      const masteryEffects = Object.entries(state.masterySelections)
        .filter(([nodeId, effectId]) => nodeId && effectId)
        .sort(([nodeA], [nodeB]) => Number(nodeA) - Number(nodeB))
        .map(([nodeId, effectId]) => `{${nodeId},${effectId}}`)
        .join(',')
      setAttribute('masteryEffects', masteryEffects)
    }

    const upsertChild = (elem: string, attributes: Record<string, string>, shouldExist: boolean) => {
      const indexes = spec.children
        .map((child, index) => child.kind === 'element' && child.elem === elem ? index : -1)
        .filter((index) => index >= 0)
      if (!shouldExist) {
        if (indexes.length) {
          spec.children = spec.children.filter((_, index) => !indexes.includes(index))
          changed = true
        }
        return
      }
      const firstIndex = indexes[0]
      const current = firstIndex == null ? null : spec.children[firstIndex]
      if (current?.kind === 'element') {
        if (JSON.stringify(current.attrib) !== JSON.stringify(attributes)) {
          current.attrib = { ...attributes }
          changed = true
        }
        if (indexes.length > 1) {
          spec.children = spec.children.filter((_, index) => index === firstIndex || !indexes.includes(index))
          changed = true
        }
        return
      }
      spec.children.push({ kind: 'element', elem, attrib: { ...attributes }, children: [] })
      changed = true
    }

    const weaponSet1Nodes = state.weaponSet1Nodes || []
    const weaponSet2Nodes = state.weaponSet2Nodes || []
    upsertChild('WeaponSet1', { nodes: weaponSet1Nodes.join(',') }, weaponSet1Nodes.length > 0)
    upsertChild('WeaponSet2', { nodes: weaponSet2Nodes.join(',') }, weaponSet2Nodes.length > 0)

    if (state.jewelSockets !== undefined) {
      const socketEntries = Object.entries(state.jewelSockets)
        .filter(([nodeId, itemId]) => nodeId && itemId)
        .sort(([nodeA], [nodeB]) => Number(nodeA) - Number(nodeB))
      const sockets = getPobXmlDirectChildren(spec, 'Sockets')
      const target = sockets[0]
      if (!socketEntries.length) {
        if (target && target.children.some((child) => child.kind === 'element' && child.elem === 'Socket')) {
          target.children = target.children.filter((child) => child.kind !== 'element' || child.elem !== 'Socket')
          changed = true
        }
      } else if (target) {
        const nextChildren: PobXmlElement[] = socketEntries.map(([nodeId, itemId]) => ({
          kind: 'element', elem: 'Socket', attrib: { nodeId, itemId }, children: [],
        }))
        const socketIndexes = target.children
          .map((child, index) => child.kind === 'element' && child.elem === 'Socket' ? index : -1)
          .filter((index) => index >= 0)
        const currentAttrs = socketIndexes.map((index) => (target.children[index] as PobXmlElement).attrib)
        const nextAttrs = nextChildren.map((socket) => socket.attrib)
        if (JSON.stringify(currentAttrs) !== JSON.stringify(nextAttrs) || socketIndexes.length !== nextChildren.length) {
          const updatedChildren = [...target.children]
          for (let index = socketIndexes.length - 1; index >= nextChildren.length; index -= 1) updatedChildren.splice(socketIndexes[index], 1)
          const retainedIndexes = updatedChildren
            .map((child, index) => child.kind === 'element' && child.elem === 'Socket' ? index : -1)
            .filter((index) => index >= 0)
          nextChildren.forEach((child, index) => {
            if (retainedIndexes[index] != null) updatedChildren[retainedIndexes[index]] = child
            else updatedChildren.push(child)
          })
          target.children = updatedChildren
          changed = true
        }
      } else {
        spec.children.push({
          kind: 'element', elem: 'Sockets', attrib: {},
          children: socketEntries.map(([nodeId, itemId]) => ({ kind: 'element', elem: 'Socket', attrib: { nodeId, itemId }, children: [] })),
        })
        changed = true
      }
    }

    const override = state.attributeOverride
    const overrideValues = {
      strNodes: (override?.strNodes || []).join(','),
      dexNodes: (override?.dexNodes || []).join(','),
      intNodes: (override?.intNodes || []).join(','),
    }
    const hasOverride = Object.values(overrideValues).some(Boolean)
    const overrides = getPobXmlDirectChildren(spec, 'Overrides')
    if (!hasOverride) {
      if (overrides.length) {
        spec.children = spec.children.filter((child) => child.kind !== 'element' || child.elem !== 'Overrides')
        changed = true
      }
    } else {
      const target = overrides[0]
      if (target) {
        const attributes = getPobXmlDirectChildren(target, 'AttributeOverride')
        const attribute = attributes[0]
        if (attribute) {
          if (JSON.stringify(attribute.attrib) !== JSON.stringify(overrideValues)) {
            attribute.attrib = { ...overrideValues }
            changed = true
          }
          if (attributes.length > 1) {
            target.children = target.children.filter((child) => child.kind !== 'element' || child.elem !== 'AttributeOverride' || child === attribute)
            changed = true
          }
        } else {
          target.children.push({ kind: 'element', elem: 'AttributeOverride', attrib: { ...overrideValues }, children: [] })
          changed = true
        }
      } else {
        spec.children.push({
          kind: 'element',
          elem: 'Overrides',
          attrib: {},
          children: [{ kind: 'element', elem: 'AttributeOverride', attrib: { ...overrideValues }, children: [] }],
        })
        changed = true
      }
    }

    return changed
  }

  private setTreeJewelSocket(nodeId: string, itemId?: string): boolean {
    if (!nodeId.trim()) throw new Error('Tree jewel socket node id is required')
    const tree = getPobXmlDirectChildren(this.document.root, 'Tree')[0]
    if (!tree) throw new Error('PoB XML contains no Tree section')
    const specs = getPobXmlDirectChildren(tree, 'Spec')
    if (!specs.length) throw new Error('PoB XML contains no Tree Spec elements')
    const requestedIndex = Number.parseInt(tree.attrib.activeSpec || '1', 10)
    const spec = specs[(Number.isInteger(requestedIndex) && requestedIndex >= 1 ? requestedIndex : 1) - 1] || specs[0]
    let sockets = getPobXmlDirectChildren(spec, 'Sockets')[0]
    const existing = sockets ? getPobXmlDirectChildren(sockets, 'Socket').find((socket) => socket.attrib.nodeId === nodeId) : undefined
    if (!itemId?.trim()) {
      if (!existing) return false
      sockets!.children = sockets!.children.filter((child) => child !== existing)
      return true
    }
    if (existing) {
      if (existing.attrib.itemId === itemId) return false
      existing.attrib.itemId = itemId
      return true
    }
    if (!sockets) {
      sockets = { kind: 'element', elem: 'Sockets', attrib: {}, children: [] }
      spec.children.push(sockets)
    }
    sockets.children.push({ kind: 'element', elem: 'Socket', attrib: { nodeId, itemId }, children: [] })
    return true
  }

  /** Add a library item to Items and bind its new id to a passive jewel socket. */
  private bindTreeJewelRaw(nodeId: string, raw: string, dynamic = false): boolean {
    const normalizedRaw = raw.trim()
    if (!nodeId.trim()) throw new Error('Tree jewel socket node id is required')
    if (!normalizedRaw) throw new Error('Jewel Raw cannot be empty')
    if (!this.getTreeState().nodes.includes(nodeId)) {
      const hasVoicesGrant = /Allocates\s+[1-5]\s+Sinister\s+Jewel\s+sockets?/i.test(this.toXml())
      if (!dynamic || !hasVoicesGrant) throw new Error('Tree jewel socket must be allocated before binding')
    }
    const itemsSections = getPobXmlDirectChildren(this.document.root, 'Items')
    if (itemsSections.length !== 1) throw new Error(`PoB XML contains ${itemsSections.length} Items sections; expected exactly one`)
    const items = itemsSections[0]
    const itemNodes = getPobXmlDirectChildren(items, 'Item')
    const usedIds = new Set(itemNodes.map((item) => item.attrib.id).filter(Boolean))
    let nextNumericId = itemNodes.reduce((max, item) => {
      const value = Number(item.attrib.id)
      return Number.isInteger(value) && value > max ? value : max
    }, 0) + 1
    while (usedIds.has(String(nextNumericId))) nextNumericId += 1
    const itemId = String(nextNumericId)
    const newItem: PobXmlElement = {
      kind: 'element',
      elem: 'Item',
      attrib: { id: itemId },
      children: [{ kind: 'text', value: normalizedRaw }],
    }
    const firstItemSetIndex = items.children.findIndex((child) => child.kind === 'element' && child.elem === 'ItemSet')
    if (firstItemSetIndex < 0) items.children.push(newItem)
    else items.children.splice(firstItemSetIndex, 0, newItem)
    this.setTreeJewelSocket(nodeId, itemId)
    return true
  }

  private setActiveTreeSpec(specIndex: number): boolean {
    if (!Number.isInteger(specIndex) || specIndex < 1) throw new Error('Tree Spec index must be a positive integer')
    const tree = getPobXmlDirectChildren(this.document.root, 'Tree')[0]
    if (!tree) throw new Error('PoB XML contains no Tree section')
    const specs = getPobXmlDirectChildren(tree, 'Spec')
    if (specIndex > specs.length) throw new Error(`Tree Spec index ${specIndex} was not found`)
    const value = String(specIndex)
    if (tree.attrib.activeSpec === value) return false
    tree.attrib.activeSpec = value
    return true
  }

  private assertActive(): void {
    if (this.disposed) throw new Error('PobBuildObject has been disposed')
  }
}

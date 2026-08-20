import { decodeCodeToXml, encodeXmlToCode } from '@/engine/buildCode'
import { normalizePobBuildCode } from '@/engine/pobItemCompatibility'
import {
  clonePobXmlNode,
  findPobXmlElements,
  getPobXmlDirectChildren,
  parsePobXml,
  serializePobXml,
  type PobXmlElement,
  type PobXmlNode,
} from '@/engine/pobXmlAst'
import type { BuildUpdateSection } from '@/engine/buildDiff'

const KNOWN_ROOT_SECTIONS = new Set(['Build', 'Tree', 'Items', 'Skills'])

function isElement(node: PobXmlNode, name?: string): node is PobXmlElement {
  return node.kind === 'element' && (name == null || node.elem.toLowerCase() === name.toLowerCase())
}

function directSection(root: PobXmlElement, name: string): PobXmlElement | undefined {
  return getPobXmlDirectChildren(root).find((child) => child.elem.toLowerCase() === name.toLowerCase())
}

function cloneElement(element: PobXmlElement): PobXmlElement {
  const cloned = clonePobXmlNode(element)
  if (cloned.kind !== 'element') throw new Error('Cannot clone a non-element PoB section')
  return cloned
}

function replaceDirectSection(root: PobXmlElement, name: string, replacement: PobXmlElement | undefined): void {
  let inserted = false
  const nextChildren: PobXmlNode[] = []
  for (const child of root.children) {
    if (!isElement(child, name)) {
      nextChildren.push(child)
      continue
    }
    if (replacement && !inserted) {
      nextChildren.push(cloneElement(replacement))
      inserted = true
    }
  }
  if (replacement && !inserted) nextChildren.push(cloneElement(replacement))
  root.children = nextChildren
}

function replaceOtherSections(baseRoot: PobXmlElement, remoteRoot: PobXmlElement): void {
  baseRoot.attrib = { ...remoteRoot.attrib }
  const remoteOther = getPobXmlDirectChildren(remoteRoot)
    .filter((child) => !KNOWN_ROOT_SECTIONS.has(child.elem))
    .map(cloneElement)
  baseRoot.children = baseRoot.children.filter((child) => child.kind !== 'element' || KNOWN_ROOT_SECTIONS.has(child.elem))
  baseRoot.children.push(...remoteOther)
}

function serializeElement(element: PobXmlElement): string {
  return serializePobXml({ nodes: [element], root: element })
}

function getItems(root: PobXmlElement): PobXmlElement | undefined {
  return directSection(root, 'Items')
}

function getItemElements(items: PobXmlElement | undefined): PobXmlElement[] {
  return items ? getPobXmlDirectChildren(items, 'Item') : []
}

function itemMap(items: PobXmlElement | undefined): Map<string, PobXmlElement> {
  return new Map(getItemElements(items)
    .filter((item) => item.attrib.id)
    .map((item) => [item.attrib.id, item]))
}

function nextItemId(items: PobXmlElement): string {
  const used = new Set(getItemElements(items).map((item) => item.attrib.id).filter(Boolean))
  const numericIds = [...used]
    .map((id) => Number(id))
    .filter((id) => Number.isSafeInteger(id) && id >= 0)
  let candidate = numericIds.length ? Math.max(...numericIds) + 1 : 1
  while (used.has(String(candidate))) candidate += 1
  return String(candidate)
}

function ensureItems(root: PobXmlElement): PobXmlElement {
  const existing = getItems(root)
  if (existing) return existing
  const created: PobXmlElement = { kind: 'element', elem: 'Items', attrib: {}, children: [] }
  root.children.push(created)
  return created
}

function ensureItemReference(targetItems: PobXmlElement, sourceItem: PobXmlElement, preferredId: string): string {
  const existing = getItemElements(targetItems).find((item) => item.attrib.id === preferredId)
  if (!existing) {
    const cloned = cloneElement(sourceItem)
    cloned.attrib.id = preferredId
    targetItems.children.push(cloned)
    return preferredId
  }
  if (serializeElement(existing) === serializeElement(sourceItem)) return preferredId

  const nextId = nextItemId(targetItems)
  const cloned = cloneElement(sourceItem)
  cloned.attrib.id = nextId
  targetItems.children.push(cloned)
  return nextId
}

function reconcileTreeJewelReferences(
  tree: PobXmlElement | undefined,
  sourceItems: PobXmlElement | undefined,
  targetItems: PobXmlElement,
): void {
  if (!tree || !sourceItems) return
  const sourceById = itemMap(sourceItems)
  const remappedIds = new Map<string, string>()
  for (const socket of findPobXmlElements(tree, { elem: 'Socket' })) {
    const itemId = socket.attrib.itemId
    if (!itemId) continue
    const existingRemap = remappedIds.get(itemId)
    if (existingRemap) {
      socket.attrib.itemId = existingRemap
      continue
    }
    const sourceItem = sourceById.get(itemId)
    if (!sourceItem) continue
    const targetId = ensureItemReference(targetItems, sourceItem, itemId)
    remappedIds.set(itemId, targetId)
    socket.attrib.itemId = targetId
  }
}

function allSectionsSelected(sections: ReadonlySet<BuildUpdateSection>): boolean {
  return sections.size === 5
    && sections.has('build')
    && sections.has('tree')
    && sections.has('equipment')
    && sections.has('skills')
    && sections.has('other')
}

/**
 * Merge a remote PoB code into the saved code, replacing only selected root
 * sections. Tree/Items are reconciled because passive jewel sockets reference
 * Item ids outside the Tree section.
 */
export function mergeBuildUpdateCode(
  baseCode: string,
  remoteCode: string,
  selectedSections: ReadonlySet<BuildUpdateSection>,
): string {
  const selected = new Set(selectedSections)
  if (!selected.size) return baseCode.trim()
  const normalizedRemote = normalizePobBuildCode(remoteCode)
  if (!baseCode.trim()) {
    if (allSectionsSelected(selected)) return normalizedRemote
    throw new Error('Cannot partially update a build without an existing PoB code')
  }
  const normalizedBase = normalizePobBuildCode(baseCode)
  if (allSectionsSelected(selected)) return normalizedRemote

  const baseDocument = parsePobXml(decodeCodeToXml(normalizedBase))
  const remoteDocument = parsePobXml(decodeCodeToXml(normalizedRemote))
  const baseRoot = baseDocument.root
  const remoteRoot = remoteDocument.root
  const baseItemsBefore = getItems(baseRoot)
  const remoteItems = getItems(remoteRoot)
  const baseTreeBefore = directSection(baseRoot, 'Tree')

  if (selected.has('build')) replaceDirectSection(baseRoot, 'Build', directSection(remoteRoot, 'Build'))
  if (selected.has('tree')) replaceDirectSection(baseRoot, 'Tree', directSection(remoteRoot, 'Tree'))
  if (selected.has('equipment')) replaceDirectSection(baseRoot, 'Items', remoteItems)
  if (selected.has('skills')) replaceDirectSection(baseRoot, 'Skills', directSection(remoteRoot, 'Skills'))
  if (selected.has('other')) replaceOtherSections(baseRoot, remoteRoot)

  if (selected.has('tree') && !selected.has('equipment')) {
    const mergedTree = directSection(baseRoot, 'Tree')
    reconcileTreeJewelReferences(mergedTree, remoteItems, ensureItems(baseRoot))
  } else if (selected.has('equipment') && !selected.has('tree')) {
    const mergedItems = getItems(baseRoot)
    if (mergedItems) reconcileTreeJewelReferences(baseTreeBefore, baseItemsBefore, mergedItems)
  }

  return encodeXmlToCode(serializePobXml(baseDocument))
}

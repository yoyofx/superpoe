import { XMLBuilder, XMLParser } from 'fast-xml-parser'

export interface PobXmlTextNode {
  kind: 'text'
  value: string
}

export interface PobXmlCommentNode {
  kind: 'comment'
  value: string
}

export interface PobXmlCdataNode {
  kind: 'cdata'
  value: string
}

export interface PobXmlInstructionNode {
  kind: 'instruction'
  name: string
  attributes: Record<string, string>
  children: PobXmlNode[]
}

export interface PobXmlElement {
  kind: 'element'
  elem: string
  attrib: Record<string, string>
  children: PobXmlNode[]
}

export type PobXmlNode =
  | PobXmlElement
  | PobXmlTextNode
  | PobXmlCommentNode
  | PobXmlCdataNode
  | PobXmlInstructionNode

export interface PobXmlDocument {
  nodes: PobXmlNode[]
  root: PobXmlElement
}

type OrderedXmlEntry = Record<string, unknown>

const parserOptions = {
  preserveOrder: true,
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  commentPropName: '#comment',
  cdataPropName: '#cdata',
  trimValues: false,
  processEntities: false,
  suppressEmptyNode: false,
} as const

const builderOptions = {
  preserveOrder: true,
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  commentPropName: '#comment',
  cdataPropName: '#cdata',
  format: false,
  processEntities: false,
  suppressEmptyNode: false,
} as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : value == null ? [] : [value]
}

function textValue(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) return value.map(textValue).join('')
  if (isRecord(value)) {
    if ('#text' in value) return textValue(value['#text'])
    return Object.values(value).map(textValue).join('')
  }
  return ''
}

function attributesFrom(entry: OrderedXmlEntry): Record<string, string> {
  const raw = entry[':@']
  if (!isRecord(raw)) return {}
  return Object.fromEntries(
    Object.entries(raw).map(([key, value]) => [key.startsWith('@_') ? key.slice(2) : key, String(value ?? '')]),
  )
}

function nodesFromOrdered(entries: unknown[]): PobXmlNode[] {
  return entries.flatMap((entry) => {
    if (!isRecord(entry)) return []
    const attributes = attributesFrom(entry)
    return Object.entries(entry).flatMap(([name, value]): PobXmlNode[] => {
      if (name === ':@') return []
      if (name === '#text') return [{ kind: 'text', value: textValue(value) } satisfies PobXmlTextNode]
      if (name === '#comment') return [{ kind: 'comment', value: textValue(value) } satisfies PobXmlCommentNode]
      if (name === '#cdata') return [{ kind: 'cdata', value: textValue(value) } satisfies PobXmlCdataNode]

      const children = nodesFromOrdered(asArray(value))
      if (name.startsWith('?')) {
        return [{ kind: 'instruction', name, attributes, children } satisfies PobXmlInstructionNode]
      }
      return [{ kind: 'element', elem: name, attrib: attributes, children } satisfies PobXmlElement]
    })
  })
}

function orderedEntry(node: PobXmlNode): OrderedXmlEntry {
  switch (node.kind) {
    case 'text':
      return { '#text': node.value }
    case 'comment':
      return { '#comment': [{ '#text': node.value }] }
    case 'cdata':
      return { '#cdata': [{ '#text': node.value }] }
    case 'instruction':
      return {
        [node.name]: node.children.map(orderedEntry),
        ...(Object.keys(node.attributes).length
          ? { ':@': Object.fromEntries(Object.entries(node.attributes).map(([key, value]) => [`@_${key}`, value])) }
          : {}),
      }
    case 'element':
      return {
        [node.elem]: node.children.map(orderedEntry),
        ...(Object.keys(node.attrib).length
          ? { ':@': Object.fromEntries(Object.entries(node.attrib).map(([key, value]) => [`@_${key}`, value])) }
          : {}),
      }
  }
}

export function parsePobXml(xml: string): PobXmlDocument {
  if (!xml.trim()) throw new Error('Cannot parse an empty PoB XML document')
  const ordered = new XMLParser(parserOptions).parse(xml)
  if (!Array.isArray(ordered)) throw new Error('PoB XML parser did not return an ordered document')
  const nodes = nodesFromOrdered(ordered)
  const root = nodes.find((node): node is PobXmlElement => node.kind === 'element')
  if (!root || root.elem !== 'PathOfBuilding2') throw new Error('Invalid PoB XML: missing PathOfBuilding2 root')
  return { nodes, root }
}

export function serializePobXml(document: PobXmlDocument): string {
  const ordered = document.nodes.map(orderedEntry)
  return new XMLBuilder(builderOptions).build(ordered)
}

export function clonePobXmlNode(node: PobXmlNode): PobXmlNode {
  switch (node.kind) {
    case 'text': return { ...node }
    case 'comment': return { ...node }
    case 'cdata': return { ...node }
    case 'instruction': return { ...node, attributes: { ...node.attributes }, children: node.children.map(clonePobXmlNode) }
    case 'element': return { ...node, attrib: { ...node.attrib }, children: node.children.map(clonePobXmlNode) }
  }
}

export function clonePobXmlDocument(document: PobXmlDocument): PobXmlDocument {
  const nodes = document.nodes.map(clonePobXmlNode)
  const root = nodes.find((node): node is PobXmlElement => node.kind === 'element')
  if (!root) throw new Error('Cannot clone a PoB XML document without a root element')
  return { nodes, root }
}

export function getPobXmlElementAtPath(root: PobXmlElement, path: number[]): PobXmlElement | null {
  let current = root
  for (const index of path) {
    const child = current.children[index]
    if (!child || child.kind !== 'element') return null
    current = child
  }
  return current
}

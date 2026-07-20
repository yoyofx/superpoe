import { deflate, inflate } from 'pako'
import type { AscendancyClass, TreeData } from '@/types/tree'
import type { NodeAttributeSelections } from '@/engine/attributeNodes'
import type { NodeWeaponSets } from '@/engine/passiveAllocation'

const POB_BUILD_TARGET_VERSION = '0_1'

export interface EncodeClassPayload {
  classId: string
  ascendClassId: string
  classInternalId?: string
  ascendancyInternalId?: string
  className?: string
  ascendancyName?: string
}

export interface PassiveJewel {
  itemId: string
  name: string
  baseType: string
  rarity: string
  lines: string[]
}

export type NodeJewels = Record<string, PassiveJewel>

export interface EncodeBuildCodeInput extends Partial<EncodeClassPayload> {
  nodes: string[]
  treeVersion?: string
  secondaryAscendClassId?: string
  baseCode?: string
  nodeWeaponSets?: NodeWeaponSets
  nodeAttributeSelections?: NodeAttributeSelections
  nodeJewels?: NodeJewels
}

export interface EncodeBuildCodeResult {
  code: string
  xml: string
  nodeCount: number
  treeVersion: string
}

export interface DecodeBuildCodeResult {
  nodes: string[]
  nodeWeaponSets: NodeWeaponSets
  nodeAttributeSelections: NodeAttributeSelections
  nodeJewels: NodeJewels
  treeVersion: string
  classId: string
  ascendClassId: string
  classInternalId: string
  ascendancyInternalId: string
  specs: Array<{
    treeVersion: string
    classId: string
    ascendClassId: string
    classInternalId: string
    ascendancyInternalId: string
    nodeCount: number
  }>
  xml: string
}

function xmlAttr(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function normalizeBase64(code: string): string {
  const base64 = code.trim().replace(/-/g, '+').replace(/_/g, '/')
  return base64 + '='.repeat((4 - (base64.length % 4)) % 4)
}

function bytesToBinary(bytes: Uint8Array): string {
  let binary = ''
  const chunkSize = 0x8000
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
  }
  return binary
}

function binaryToBytes(binary: string): Uint8Array {
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}

export function decodeCodeToXml(code: string): string {
  const inflated = inflate(binaryToBytes(atob(normalizeBase64(code))))
  return new TextDecoder().decode(inflated)
}

function encodeXmlToCode(xml: string): string {
  const deflated = deflate(new TextEncoder().encode(xml))
  return btoa(bytesToBinary(deflated)).replace(/\+/g, '-').replace(/\//g, '_')
}

function parseAttrs(text: string): Record<string, string> {
  const attrs: Record<string, string> = {}
  const attrRe = /([\w:-]+)="([^"]*)"/g
  let match: RegExpExecArray | null
  while ((match = attrRe.exec(text))) {
    attrs[match[1]] = match[2]
      .replace(/&quot;/g, '"')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
  }
  return attrs
}

function parseIds(value: string | undefined): string[] {
  return value ? value.split(',').map((id) => id.trim()).filter(Boolean) : []
}

function parsePassiveJewelItems(xml: string): Record<string, PassiveJewel> {
  const items: Record<string, PassiveJewel> = {}
  const itemRe = /<Item\b([^>]*)>([\s\S]*?)<\/Item>/gi
  let match: RegExpExecArray | null
  while ((match = itemRe.exec(xml))) {
    const itemId = parseAttrs(match[1]).id
    if (!itemId) continue
    const lines = match[2]
      .replace(/<[^>]+>/g, '')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
    const rarity = lines[0]?.replace(/^Rarity:\s*/i, '') || 'NORMAL'
    items[itemId] = {
      itemId,
      name: lines[1] || 'Unknown Jewel',
      baseType: lines[2] || '',
      rarity,
      lines: lines.slice(3),
    }
  }
  return items
}

function weaponSetNodes(nodes: string[], nodeWeaponSets: NodeWeaponSets | undefined, mode: 1 | 2): string {
  if (!nodeWeaponSets) return ''
  const nodeSet = new Set(nodes)
  return Object.entries(nodeWeaponSets)
    .filter(([id, m]) => m === mode && nodeSet.has(id))
    .map(([id]) => id)
    .join(',')
}

function attributeOverrideXml(
  nodes: string[],
  nodeAttributeSelections: NodeAttributeSelections | undefined,
): string {
  if (!nodeAttributeSelections) return ''
  const nodeSet = new Set(nodes)
  const lists: Record<1 | 2 | 3, string[]> = { 1: [], 2: [], 3: [] }
  for (const [id, selection] of Object.entries(nodeAttributeSelections)) {
    if ((selection === 1 || selection === 2 || selection === 3) && nodeSet.has(id)) {
      lists[selection].push(id)
    }
  }
  if (!lists[1].length && !lists[2].length && !lists[3].length) return ''
  return `      <AttributeOverride strNodes="${xmlAttr(lists[1].join(','))}" dexNodes="${xmlAttr(lists[2].join(','))}" intNodes="${xmlAttr(lists[3].join(','))}"/>`
}

function jewelSocketsXml(nodeJewels: NodeJewels | undefined): string[] {
  const sockets = Object.entries(nodeJewels || {})
    .filter(([nodeId, jewel]) => Boolean(nodeId && jewel?.itemId))
    .sort(([nodeIdA], [nodeIdB]) => nodeIdA.localeCompare(nodeIdB, undefined, { numeric: true }))
    .map(([nodeId, jewel]) => `        <Socket nodeId="${xmlAttr(nodeId)}" itemId="${xmlAttr(jewel.itemId)}"/>`)
  return sockets.length
    ? ['      <Sockets>', ...sockets, '      </Sockets>']
    : ['      <Sockets/>']
}

function buildTreeXml(params: {
  treeVersion: string
  classId: string
  ascendClassId: string
  classInternalId?: string
  ascendancyInternalId?: string
  secondaryAscendClassId?: string
  nodeStr: string
  ws1: string
  ws2: string
  nodeJewels?: NodeJewels
  attributeOverride: string
}): string {
  const specAttrs = [
    `treeVersion="${xmlAttr(params.treeVersion)}"`,
    `classId="${xmlAttr(params.classId)}"`,
    `ascendClassId="${xmlAttr(params.ascendClassId)}"`,
    params.classInternalId ? `classInternalId="${xmlAttr(params.classInternalId)}"` : '',
    params.ascendancyInternalId != null ? `ascendancyInternalId="${xmlAttr(params.ascendancyInternalId)}"` : '',
    `secondaryAscendClassId="${xmlAttr(params.secondaryAscendClassId || 'nil')}"`,
    `nodes="${xmlAttr(params.nodeStr)}"`,
    'masteryEffects=""',
  ].filter(Boolean).join(' ')

  const children = [
    params.ws1 ? `      <WeaponSet1 nodes="${xmlAttr(params.ws1)}"/>` : '',
    params.ws2 ? `      <WeaponSet2 nodes="${xmlAttr(params.ws2)}"/>` : '',
    ...jewelSocketsXml(params.nodeJewels),
    params.attributeOverride ? '      <Overrides>' : '',
    params.attributeOverride,
    params.attributeOverride ? '      </Overrides>' : '',
  ].filter(Boolean)

  return [
    '  <Tree activeSpec="1">',
    `    <Spec ${specAttrs}>`,
    ...children,
    '    </Spec>',
    '  </Tree>',
  ].join('\n')
}

function buildClassNames(params: { className?: string; ascendancyName?: string }): string {
  return [
    params.className ? `className="${xmlAttr(params.className)}"` : '',
    params.ascendancyName ? `ascendClassName="${xmlAttr(params.ascendancyName)}"` : '',
  ].filter(Boolean).join(' ')
}

function replaceTreeXml(baseXml: string, treeXml: string): string {
  const treeMatch = baseXml.match(/(\n?[ \t]*<Tree\b[\s\S]*?<\/Tree>)/)
  if (treeMatch?.index != null) {
    return `${baseXml.slice(0, treeMatch.index)}\n${treeXml}${baseXml.slice(treeMatch.index + treeMatch[0].length)}`
  }
  return baseXml.replace(/<\/PathOfBuilding2>\s*$/i, `${treeXml}\n</PathOfBuilding2>`)
}

export function getEncodeClassPayload(
  treeData: TreeData | null | undefined,
  selectedClassId: string,
  selectedAscendancyId: string,
): EncodeClassPayload {
  const cls = treeData?.constants.classes[selectedClassId]
  const ascendancy: AscendancyClass | undefined = cls?.ascendancies.find((asc) => (
    asc.id === selectedAscendancyId
    || asc.name === selectedAscendancyId
    || asc.internalId === selectedAscendancyId
  ))
  const ascendancyIndex = cls && ascendancy ? cls.ascendancies.indexOf(ascendancy) : -1
  return {
    classId: selectedClassId,
    ascendClassId: ascendancyIndex >= 0 ? String(ascendancyIndex + 1) : selectedAscendancyId,
    classInternalId: cls?.integerId != null ? String(cls.integerId) : undefined,
    ascendancyInternalId: ascendancy?.internalId,
    className: cls?.name || cls?.displayName,
    ascendancyName: ascendancy?.name || ascendancy?.displayName || ascendancy?.id,
  }
}

export function encodeBuildCode(input: EncodeBuildCodeInput): EncodeBuildCodeResult {
  if (!input.nodes.length) throw new Error('Missing or empty "nodes" array')
  const treeVersion = input.treeVersion || '0_4'
  const nodeStr = input.nodes.join(',')
  const ws1 = weaponSetNodes(input.nodes, input.nodeWeaponSets, 1)
  const ws2 = weaponSetNodes(input.nodes, input.nodeWeaponSets, 2)
  const attributeOverride = attributeOverrideXml(input.nodes, input.nodeAttributeSelections)
  const nodeJewels = input.nodeJewels ?? (input.baseCode ? decodeBuildCode(input.baseCode).nodeJewels : {})
  const treeXml = buildTreeXml({
    treeVersion,
    classId: input.classId || '',
    ascendClassId: input.ascendClassId || '',
    classInternalId: input.classInternalId,
    ascendancyInternalId: input.ascendancyInternalId,
    secondaryAscendClassId: input.secondaryAscendClassId,
    nodeStr,
    ws1,
    ws2,
    nodeJewels,
    attributeOverride,
  })

  const classNames = buildClassNames({ className: input.className, ascendancyName: input.ascendancyName })
  const xml = input.baseCode
    ? replaceTreeXml(decodeCodeToXml(input.baseCode), treeXml)
    : [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<PathOfBuilding2>',
      `  <Build level="1" targetVersion="${POB_BUILD_TARGET_VERSION}" viewMode="TREE" characterLevelAutoMode="false" mainSocketGroup="1"${classNames ? ` ${classNames}` : ''}/>`,
      '  <Import exportParty="false"/>',
      treeXml,
      '</PathOfBuilding2>',
    ].join('\n')

  return {
    code: encodeXmlToCode(xml),
    xml,
    nodeCount: input.nodes.length,
    treeVersion,
  }
}

export function decodeBuildCode(code: string): DecodeBuildCodeResult {
  if (!code.trim()) throw new Error('Missing or empty "code" field')
  const xml = decodeCodeToXml(code)
  if (!xml.includes('<PathOfBuilding2')) throw new Error('Invalid XML: missing PathOfBuilding2 root')

  const result: DecodeBuildCodeResult = {
    nodes: [],
    nodeWeaponSets: {},
    nodeAttributeSelections: {},
    nodeJewels: {},
    treeVersion: '',
    classId: '',
    ascendClassId: '',
    classInternalId: '',
    ascendancyInternalId: '',
    specs: [],
    xml,
  }

  const itemMap = parsePassiveJewelItems(xml)
  const specRe = /<Spec\b([^>]*)>([\s\S]*?)<\/Spec>|<Spec\b([^>]*)\/>/gi
  let match: RegExpExecArray | null
  while ((match = specRe.exec(xml))) {
    const attrs = parseAttrs(match[1] || match[3] || '')
    if (!attrs.nodes) continue
    const body = match[2] || ''
    const ids = parseIds(attrs.nodes)
    result.nodes.push(...ids)

    const ws1 = body.match(/<WeaponSet1\b([^>]*)\/?>/i)
    const ws2 = body.match(/<WeaponSet2\b([^>]*)\/?>/i)
    for (const id of parseIds(ws1 ? parseAttrs(ws1[1]).nodes : undefined)) result.nodeWeaponSets[id] = 1
    for (const id of parseIds(ws2 ? parseAttrs(ws2[1]).nodes : undefined)) result.nodeWeaponSets[id] = 2

    const attributeOverride = body.match(/<AttributeOverride\b([^>]*)\/?>/i)
    const overrideAttrs = attributeOverride ? parseAttrs(attributeOverride[1]) : {}
    for (const id of parseIds(overrideAttrs.strNodes)) result.nodeAttributeSelections[id] = 1
    for (const id of parseIds(overrideAttrs.dexNodes)) result.nodeAttributeSelections[id] = 2
    for (const id of parseIds(overrideAttrs.intNodes)) result.nodeAttributeSelections[id] = 3

    const sockets = body.match(/<Sockets\b[^>]*>([\s\S]*?)<\/Sockets>|<Sockets\b[^>]*\/>/i)
    if (sockets?.[1]) {
      const socketRe = /<Socket\b([^>]*)\/?>/gi
      let socketMatch: RegExpExecArray | null
      while ((socketMatch = socketRe.exec(sockets[1]))) {
        const socketAttrs = parseAttrs(socketMatch[1])
        const nodeId = socketAttrs.nodeId
        const itemId = socketAttrs.itemId
        if (!nodeId || !itemId) continue
        result.nodeJewels[nodeId] = itemMap[itemId] || {
          itemId,
          name: 'Unknown Jewel',
          baseType: '',
          rarity: 'NORMAL',
          lines: [],
        }
      }
    }

    const specSummary = {
      treeVersion: attrs.treeVersion || '',
      classId: attrs.classId || '',
      ascendClassId: attrs.ascendClassId || '',
      classInternalId: attrs.classInternalId || '',
      ascendancyInternalId: attrs.ascendancyInternalId || '',
      nodeCount: ids.length,
    }
    result.specs.push(specSummary)
    if (!result.treeVersion) Object.assign(result, specSummary)
  }

  return result
}

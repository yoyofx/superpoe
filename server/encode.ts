import { FastifyInstance } from 'fastify'
import { deflateSync, inflateSync } from 'zlib'

type NodeWeaponSets = Record<string, 1 | 2>
type NodeAttributeSelections = Record<string, 1 | 2 | 3>
const POB_BUILD_TARGET_VERSION = '0_1'

function xmlAttr(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
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

function decodeBuildCode(code: string): string {
  const base64 = code.trim().replace(/-/g, '+').replace(/_/g, '/')
  return inflateSync(Buffer.from(base64, 'base64')).toString('utf-8')
}

function encodeBuildCode(xml: string): string {
  const deflated = deflateSync(Buffer.from(xml, 'utf-8'))
  return deflated.toString('base64').replace(/\+/g, '-').replace(/\//g, '_')
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
    '      <Sockets/>',
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

function buildClassNames(params: {
  className?: string
  ascendancyName?: string
}): string {
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

/** POST /api/code/encode */
export async function encodeRoute(fastify: FastifyInstance) {
  fastify.post<{
    Body: {
      nodes?: string[]
      treeVersion?: string
      classId?: string
      ascendClassId?: string
      classInternalId?: string
      ascendancyInternalId?: string
      className?: string
      ascendancyName?: string
      secondaryAscendClassId?: string
      baseCode?: string
      nodeWeaponSets?: NodeWeaponSets
      nodeAttributeSelections?: NodeAttributeSelections
    }
  }>(
    '/api/code/encode',
    async (request, reply) => {
      const {
        nodes,
        treeVersion,
        classId,
        ascendClassId,
        classInternalId,
        ascendancyInternalId,
        className,
        ascendancyName,
        secondaryAscendClassId,
        baseCode,
        nodeWeaponSets,
        nodeAttributeSelections,
      } = request.body || {}

      if (!nodes || !Array.isArray(nodes) || nodes.length === 0) {
        return reply.status(400).send({ error: 'Missing or empty "nodes" array' })
      }

      try {
        const tv = treeVersion || '0_4'
        const cid = classId || ''
        const ascendId = ascendClassId || ''
        const nodeStr = nodes.join(',')
        const ws1 = weaponSetNodes(nodes, nodeWeaponSets, 1)
        const ws2 = weaponSetNodes(nodes, nodeWeaponSets, 2)
        const attributeOverride = attributeOverrideXml(nodes, nodeAttributeSelections)
        const treeXml = buildTreeXml({
          treeVersion: tv,
          classId: cid,
          ascendClassId: ascendId,
          classInternalId,
          ascendancyInternalId,
          secondaryAscendClassId,
          nodeStr,
          ws1,
          ws2,
          attributeOverride,
        })

        const xml = baseCode
          ? replaceTreeXml(decodeBuildCode(baseCode), treeXml)
          : [
            '<?xml version="1.0" encoding="UTF-8"?>',
            '<PathOfBuilding2>',
            `  <Build level="1" targetVersion="${POB_BUILD_TARGET_VERSION}" viewMode="TREE" characterLevelAutoMode="false" mainSocketGroup="1"${buildClassNames({ className, ascendancyName }) ? ` ${buildClassNames({ className, ascendancyName })}` : ''}/>`,
            '  <Import exportParty="false"/>',
            treeXml,
            '</PathOfBuilding2>',
          ].join('\n')

        const code = encodeBuildCode(xml)

        return reply.send({
          code,
          nodeCount: nodes.length,
          treeVersion: tv,
        })
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err)
        return reply.status(500).send({ error: `Encode failed: ${msg}` })
      }
    },
  )
}

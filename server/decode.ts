import { FastifyInstance } from 'fastify'
import { inflateSync } from 'zlib'
import { XMLParser } from 'fast-xml-parser'

type NodeWeaponSets = Record<string, 1 | 2>

interface DecodeResult {
  nodes: string[]
  nodeWeaponSets: NodeWeaponSets
  treeVersion: string
  classId: string
  ascendClassId: string
  specs: unknown[]
}

function parseIds(value: unknown): string[] {
  return typeof value === 'string'
    ? value.split(',').map((s) => s.trim()).filter(Boolean)
    : []
}

function firstNode(value: unknown): Record<string, unknown> | undefined {
  if (Array.isArray(value)) return value[0] as Record<string, unknown> | undefined
  return value as Record<string, unknown> | undefined
}

function collectSpec(spec: Record<string, unknown>, result: DecodeResult) {
  const ids = parseIds(spec.nodes)
  result.nodes.push(...ids)

  for (const id of parseIds(firstNode(spec.WeaponSet1)?.nodes)) result.nodeWeaponSets[id] = 1
  for (const id of parseIds(firstNode(spec.WeaponSet2)?.nodes)) result.nodeWeaponSets[id] = 2

  result.specs.push({
    treeVersion: spec.treeVersion || '',
    classId: spec.classId || '',
    ascendClassId: spec.ascendClassId || '',
    nodeCount: ids.length,
  })

  if (!result.treeVersion) {
    result.treeVersion = String(spec.treeVersion || '')
    result.classId = String(spec.classId || '')
    result.ascendClassId = String(spec.ascendClassId || '')
  }
}

/** POST /api/build/decode */
export async function buildDecodeRoute(fastify: FastifyInstance) {
  const xmlParser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '',
    isArray: (name) => ['Spec', 'WeaponSet1', 'WeaponSet2'].includes(name),
  })

  fastify.post<{ Body: { code?: string } }>(
    '/api/build/decode',
    async (request, reply) => {
      const { code } = request.body || {}

      if (!code || typeof code !== 'string' || code.trim().length === 0) {
        return reply.status(400).send({ error: 'Missing or empty "code" field' })
      }

      try {
        const base64 = code.trim().replace(/-/g, '+').replace(/_/g, '/')
        const deflated = Buffer.from(base64, 'base64')
        const xmlText = inflateSync(deflated).toString('utf-8')
        const parsed = xmlParser.parse(xmlText)
        const root = parsed.PathOfBuilding2

        if (!root) {
          return reply.status(400).send({ error: 'Invalid XML: missing PathOfBuilding2 root' })
        }

        const result: DecodeResult = {
          nodes: [],
          nodeWeaponSets: {},
          treeVersion: '',
          classId: '',
          ascendClassId: '',
          specs: [],
        }

        const treeTab = root.Build?.Tree || root.Tree
        if (treeTab?.Spec) {
          const specList = Array.isArray(treeTab.Spec) ? treeTab.Spec : [treeTab.Spec]
          for (const spec of specList) {
            if (spec?.nodes) collectSpec(spec, result)
          }
        }

        if (result.nodes.length === 0 && root.Spec) {
          const specList = Array.isArray(root.Spec) ? root.Spec : [root.Spec]
          for (const spec of specList) {
            if (spec?.nodes) collectSpec(spec, result)
          }
        }

        return reply.send(result)
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err)
        return reply.status(400).send({ error: `Decode failed: ${message}` })
      }
    },
  )
}

import { FastifyInstance } from 'fastify'
import { inflateSync } from 'zlib'
import { XMLParser } from 'fast-xml-parser'

/**
 * POST /api/build/decode
 *
 * Body: { code: "<PoB2 export code>" }
 * Response: { nodes: string[], treeVersion: string, classId: string, ascendClassId: string }
 *
 * Decode flow:
 *   code ¡ú replace-_ with +/ ¡ú base64 decode ¡ú zlib inflate ¡ú XML parse ¡ú extract Spec nodes
 */
export async function buildDecodeRoute(fastify: FastifyInstance) {
  const xmlParser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '',
    isArray: (name) => ['Spec'].includes(name),
  })

  fastify.post<{ Body: { code?: string } }>(
    '/api/build/decode',
    async (request, reply) => {
      const { code } = request.body || {}

      if (!code || typeof code !== 'string' || code.trim().length === 0) {
        return reply.status(400).send({ error: 'Missing or empty "code" field' })
      }

      try {
        // Step 1: restore base64 alphabet (+/ from -_)
        const base64 = code.trim().replace(/-/g, '+').replace(/_/g, '/')

        // Step 2: base64 decode ¡ú Buffer
        const deflated = Buffer.from(base64, 'base64')

        // Step 3: zlib inflate
        const xmlText = inflateSync(deflated).toString('utf-8')

        // Step 4: parse XML
        const parsed = xmlParser.parse(xmlText)
        const root = parsed.PathOfBuilding2

        if (!root) {
          return reply.status(400).send({ error: 'Invalid XML: missing PathOfBuilding2 root' })
        }

        // Extract Spec nodes
        const result: {
          nodes: string[]
          treeVersion: string
          classId: string
          ascendClassId: string
          specs: unknown[]
        } = {
          nodes: [],
          treeVersion: '',
          classId: '',
          ascendClassId: '',
          specs: [],
        }

        // Try <Build><Tree><Spec> first (PoB2 export format)
        const buildNode = root.Build
        const treeTab = buildNode && buildNode.Tree
        if (!treeTab) {
          // Fallback: <Tree> as direct child of root
          const treeTab = root.Tree
          if (treeTab && treeTab.Spec) {
            const specList = Array.isArray(treeTab.Spec) ? treeTab.Spec : [treeTab.Spec]
            for (const spec of specList) {
              if (spec.nodes) {
                const ids = spec.nodes
                  .split(',')
                  .map((s: string) => s.trim())
                  .filter(Boolean)
                result.nodes.push(...ids)
                result.specs.push({
                  treeVersion: spec.treeVersion || '',
                  classId: spec.classId || '',
                  ascendClassId: spec.ascendClassId || '',
                  nodeCount: ids.length,
                })
              }
            }
          }
        } else {
          // Normal path: Build > Tree > Spec
          if (treeTab.Spec) {
            const specList = Array.isArray(treeTab.Spec) ? treeTab.Spec : [treeTab.Spec]
            for (const spec of specList) {
              if (spec.nodes) {
                const ids = spec.nodes
                  .split(',')
                  .map((s: string) => s.trim())
                  .filter(Boolean)
                result.nodes.push(...ids)
                result.specs.push({
                  treeVersion: spec.treeVersion || '',
                  classId: spec.classId || '',
                  ascendClassId: spec.ascendClassId || '',
                  nodeCount: ids.length,
                })
              }
            }
          }
        }

        // Fallback: look for <Spec> as direct child of root
        if (result.nodes.length === 0 && root.Spec) {
          const specList = Array.isArray(root.Spec) ? root.Spec : [root.Spec]
          for (const spec of specList) {
            if (spec.nodes) {
              const ids = spec.nodes
                .split(',')
                .map((s: string) => s.trim())
                .filter(Boolean)
              result.nodes.push(...ids)
            }
          }
        }

        // Use first spec's meta
        if (root.Spec && root.Spec[0]) {
          const spec = root.Spec[0]
          result.treeVersion = spec.treeVersion || ''
          result.classId = spec.classId || ''
          result.ascendClassId = spec.ascendClassId || ''
        }

        return reply.send(result)
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err)
        return reply.status(400).send({ error: `Decode failed: ${message}` })
      }
    },
  )
}

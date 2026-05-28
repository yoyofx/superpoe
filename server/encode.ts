import { FastifyInstance } from 'fastify'
import { deflateSync } from 'zlib'

/**
 * POST /api/code/encode
 *
 * Body: { nodes: string[], treeVersion?: string, classId?: string }
 * Response: { code: string }
 *
 * Encode flow:
 *   nodes ¡ú XML <Spec nodes="id1,id2,..."> ¡ú deflate ¡ú base64 ¡ú replace +/ with -_
 */
export async function encodeRoute(fastify: FastifyInstance) {
  fastify.post<{ Body: { nodes?: string[]; treeVersion?: string; classId?: string } }>(
    '/api/code/encode',
    async (request, reply) => {
      const { nodes, treeVersion, classId } = request.body || {}

      if (!nodes || !Array.isArray(nodes) || nodes.length === 0) {
        return reply.status(400).send({ error: 'Missing or empty "nodes" array' })
      }

      try {
        const tv = treeVersion || '0_4'
        const cid = classId || ''
        const nodeStr = nodes.join(',')

        // Build PoB2-compatible XML
        const xml = [
          '<?xml version="1.0" encoding="UTF-8"?>',
          '<PathOfBuilding2>',
          '  <Build>',
          `    <Tree activeSpec="1">`,
          `      <Spec treeVersion="${tv}" classId="${cid}" ascendClassId="" nodes="${nodeStr}" masteryEffects="">`,
          '      </Spec>',
          '    </Tree>',
          '  </Build>',
          '</PathOfBuilding2>',
        ].join('\n')

        // deflate + base64 encode
        const deflated = deflateSync(Buffer.from(xml, 'utf-8'))
        const code = deflated.toString('base64').replace(/\+/g, '-').replace(/\//g, '_')

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

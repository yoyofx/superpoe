import type { FastifyInstance } from 'fastify'
import { decodeBuildCode } from '../src/engine/buildCode'

/** Legacy development endpoint. The desktop app decodes directly in the renderer. */
export async function buildDecodeRoute(fastify: FastifyInstance) {
  fastify.post<{ Body: { code?: string } }>(
    '/api/build/decode',
    async (request, reply) => {
      const { code } = request.body || {}
      if (!code || typeof code !== 'string' || !code.trim()) {
        return reply.status(400).send({ error: 'Missing or empty "code" field' })
      }

      try {
        return reply.send(decodeBuildCode(code))
      } catch (reason) {
        const message = reason instanceof Error ? reason.message : String(reason)
        return reply.status(400).send({ error: `Decode failed: ${message}` })
      }
    },
  )
}

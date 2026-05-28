import { FastifyInstance } from 'fastify'
import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

/**
 * GET /api/tree-data
 * Serves tree-web.json
 */
export async function treeDataRoute(fastify: FastifyInstance) {
  let cachedData: object | null = null

  fastify.get('/api/tree-data', async (_request, reply) => {
    if (cachedData) {
      return reply.send(cachedData)
    }

    try {
      const filePath = join(__dirname, '..', 'public', 'data', 'tree-web-0_4.json')
      const raw = readFileSync(filePath, 'utf-8')
      cachedData = JSON.parse(raw)
      return reply.send(cachedData)
    } catch (err) {
      return reply.status(500).send({
        error: 'Failed to load tree data',
        detail: err instanceof Error ? err.message : String(err),
      })
    }
  })
}

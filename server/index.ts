import Fastify from 'fastify'
import { buildDecodeRoute } from './decode'
import { treeDataRoute } from './treeData'
import { validateRoute } from './validate'
import { encodeRoute } from './encode'
import { calcRoute } from './calculate'

const PORT = parseInt(process.env.PORT || '3001', 10)

async function main() {
  const fastify = Fastify({ logger: false })

  // CORS: allow Vite dev server
  fastify.addHook('onRequest', async (req, reply) => {
    reply.header('Access-Control-Allow-Origin', '*')
    reply.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
    reply.header('Access-Control-Allow-Headers', 'Content-Type')
    if (req.method === 'OPTIONS') {
      reply.status(204).send('')
      return
    }
  })

  // Routes
  await buildDecodeRoute(fastify)
  await treeDataRoute(fastify)
  await validateRoute(fastify)
  await encodeRoute(fastify)
  await calcRoute(fastify)

  // Health check
  fastify.get('/api/health', async () => ({ ok: true }))

  console.log(`\n  PoB2 Web API ready at http://localhost:${PORT}`)
  console.log(`    POST /api/build/decode`)
  console.log(`    POST /api/tree/validate`)
  console.log(`    POST /api/build/calculate`)
  console.log(`    POST /api/build/import-and-calc`)
  console.log(`    GET  /api/tree-data\n`)

  await fastify.listen({ port: PORT, host: '0.0.0.0' })
}

main().catch((err) => {
  console.error('Server start failed:', err)
  process.exit(1)
})

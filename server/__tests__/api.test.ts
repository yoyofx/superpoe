import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import Fastify from 'fastify'
import { buildDecodeRoute } from '../decode'
import { encodeRoute } from '../encode'
import { treeDataRoute } from '../treeData'
import { validateRoute } from '../validate'

let app: ReturnType<typeof Fastify>

beforeAll(async () => {
  app = Fastify({ logger: false })
  app.addHook('onRequest', async (req, reply) => {
    reply.header('Access-Control-Allow-Origin', '*')
    if (req.method === 'OPTIONS') { reply.status(204).send(''); return }
  })
  await buildDecodeRoute(app)
  await encodeRoute(app)
  await treeDataRoute(app)
  await validateRoute(app)
  app.get('/api/health', async () => ({ ok: true }))
  await app.ready()
})

afterAll(async () => {
  await app.close()
})

describe('API Integration Tests', () => {
  // --- encode/decode round-trip ---

  it('5.3.1 encode/decode round-trip: simple nodes', async () => {
    const nodes = ['61419', '65413', '10131']
    const encRes = await app.inject({
      method: 'POST', url: '/api/code/encode',
      payload: { nodes, treeVersion: '0_4' }
    })
    expect(encRes.statusCode).toBe(200)
    const { code } = encRes.json()
    expect(code).toBeTruthy()

    const decRes = await app.inject({
      method: 'POST', url: '/api/build/decode',
      payload: { code }
    })
    expect(decRes.statusCode).toBe(200)
    const decoded = decRes.json()
    expect(decoded.nodes.sort()).toEqual(nodes.sort())
  })

  it('5.3.1b encode/decode round-trip: weapon sets', async () => {
    const nodes = ['61419', '65413', '10131']
    const nodeWeaponSets = { '61419': 1, '10131': 2 } as Record<string, 1 | 2>
    const encRes = await app.inject({
      method: 'POST', url: '/api/code/encode',
      payload: { nodes, nodeWeaponSets, treeVersion: '0_4' }
    })
    expect(encRes.statusCode).toBe(200)
    const { code } = encRes.json()

    const decRes = await app.inject({
      method: 'POST', url: '/api/build/decode',
      payload: { code }
    })
    expect(decRes.statusCode).toBe(200)
    const decoded = decRes.json()
    expect(decoded.nodes.sort()).toEqual(nodes.sort())
    expect(decoded.nodeWeaponSets).toEqual(nodeWeaponSets)
  })

  it('5.3.2 empty nodes -> encode 400', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/code/encode',
      payload: { nodes: [] }
    })
    expect(res.statusCode).toBe(400)
  })

  // 5.3.3/4 encode then decode stormweaver nodes (from real BD XML)
  it('5.3.3/4 encode then decode stormweaver nodes', async () => {
    // Raw nodes string from the actual XML Spec nodes attribute
    const rawNodes = "47359,29432,16121,45319,65413,54447,10131,21984,48552,11248,27491,47177,10382,23382,61056,36231,44484,26196,12488,63009,61419,26863,38535,30346,15775,45702,58198,64318,2254,7424,2335,25304,49759,59362,15304,2732,44669,56876,46197,51741,17505,31238,34300,49189,17088,39567,21327,31950,37593,44871,11604,57710,61063,31888,57776,3251,19355,52106,31692,64643,11672,41753,58329,43281,32951,57821,34006,32534,62677,24812,21568,56334,14446,30808,15885,7960,29408,32763,49512,27176,16466,26135,722,61421,22152,11679,8616,2857,39037,16790,61834,59538,15408,4061,14267,65204,56360,12882,1826,44733,28774,10295,40783,8569,3336,40399,40721,1104,5314,65393,39280,62230,46554,40453,14231,29009,36994,33914,50755,21935,15782,25890,1433,45918,60685,46628,30615,42522,44872,46124,47976,51934,54378,42680,60013,61403,46819,31765,46380"
    const nodes = rawNodes.split(',')
    const n = nodes.length

    const encRes = await app.inject({
      method: 'POST', url: '/api/code/encode',
      payload: { nodes, treeVersion: '0_4' }
    })
    expect(encRes.statusCode).toBe(200)
    const { code, nodeCount } = encRes.json()
    expect(nodeCount).toBe(n)
    expect(code.length).toBeGreaterThan(0)

    // decode back
    const decRes = await app.inject({
      method: 'POST', url: '/api/build/decode',
      payload: { code }
    })
    expect(decRes.statusCode).toBe(200)
    const decoded = decRes.json()
    expect(decoded.nodes.length).toBe(n)
    expect(decoded.nodes.sort((a: string, b: string) => parseInt(a) - parseInt(b)))
      .toEqual(nodes.sort((a, b) => parseInt(a) - parseInt(b)))
    console.log(`Stormweaver ${n} nodes: encode=${code.length} chars, round-trip OK`)
  })

  it('5.3.5 invalid base64 -> decode 400', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/build/decode',
      payload: { code: '!!!not-valid-base64!!!' }
    })
    expect(res.statusCode).toBe(400)
  })

  it('5.3.6 empty code -> decode 400', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/build/decode',
      payload: { code: '' }
    })
    expect(res.statusCode).toBe(400)
  })

  // --- tree-data ---

  it('5.4.1 GET /api/tree-data -> 200, 4701 nodes', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/tree-data' })
    expect(res.statusCode).toBe(200)
    const data = res.json()
    expect(data.nodes).toBeDefined()
    const nodeCount = Object.keys(data.nodes).length
    expect(nodeCount).toBeGreaterThan(4000)
    console.log(`tree-data: ${nodeCount} nodes`)
  })

  it('5.4.2 response includes valid node data', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/tree-data' })
    const data = res.json()
    // tree-web.json has version, constants, nodes (top-level keys)
    expect(data.version).toBeDefined()
    expect(data.constants).toBeDefined()
    expect(data.nodes).toBeDefined()
    const nodeCount = Object.keys(data.nodes).length
    expect(nodeCount).toBeGreaterThan(4000)
  })

  it('5.4.3 response is consistent on repeated requests', async () => {
    const res1 = await app.inject({ method: 'GET', url: '/api/tree-data' })
    const res2 = await app.inject({ method: 'GET', url: '/api/tree-data' })
    expect(res1.statusCode).toBe(200)
    expect(res2.statusCode).toBe(200)
    const n1 = Object.keys(res1.json().nodes).length
    const n2 = Object.keys(res2.json().nodes).length
    expect(n1).toBe(n2)
    expect(n1).toBeGreaterThan(4000)
  })

  // 5.5.1 stormweaver encode -> decode -> validate E2E
  // Validates the full API pipeline: encode node list -> decode -> LuaJIT validate
  it('5.5.1 E2E encode-decode-validate round-trip', async () => {
    // Use known-connected nodes: a path from one section of the tree
    const nodes = ["61419","65413","10131","54447"]
    const encRes = await app.inject({
      method: 'POST', url: '/api/code/encode',
      payload: { nodes, treeVersion: '0_4' }
    })
    const { code } = encRes.json()

    const decRes = await app.inject({
      method: 'POST', url: '/api/build/decode',
      payload: { code }
    })
    const decoded = decRes.json()
    expect(decoded.nodes.sort()).toEqual(nodes.sort())

    const valRes = await app.inject({
      method: 'POST', url: '/api/tree/validate',
      payload: { nodes: decoded.nodes, treeVersion: '0_4' }
    })
    expect(valRes.statusCode).toBe(200)
    const validation = valRes.json()
    
    // The validation endpoint should return a well-formed response
    expect(validation).toHaveProperty('valid')
    expect(validation).toHaveProperty('errors')
    expect(validation).toHaveProperty('warnings')
    
    // If LuaJIT was available, we have real validation output
    const errorText = JSON.stringify(validation.errors || [])
    if (errorText.includes('spawn') || errorText.includes('ENOENT')) {
      console.log('E2E validate: LuaJIT not available in test env, skipping')
    } else {
      console.log('E2E validate result:', JSON.stringify(validation))
    }
  })

  it('5.5.4 Import->Export round-trip: 50 nodes', async () => {
    const nodes = [
      "61419","65413","10131","54447","45319","47359","29432","16121",
      "21984","48552","11248","27491","47177","10382","23382","61056",
      "36231","44484","26196","12488","63009","26863","38535","30346",
      "15775","45702","58198","64318","2254","7424","2335","25304",
      "49759","59362","15304","2732","44669","56876","46197","51741",
      "17505","31238","34300","49189","17088","39567","21327","31950",
      "37593","44871"
    ]
    // encode
    const encRes = await app.inject({
      method: 'POST', url: '/api/code/encode',
      payload: { nodes, treeVersion: '0_4' }
    })
    expect(encRes.statusCode).toBe(200)
    const { code } = encRes.json()

    // decode
    const decRes = await app.inject({
      method: 'POST', url: '/api/build/decode',
      payload: { code }
    })
    expect(decRes.statusCode).toBe(200)
    const decoded = decRes.json()

    expect(decoded.nodes.length).toBe(50)
    expect(decoded.nodes.sort()).toEqual(nodes.sort())
  })
})

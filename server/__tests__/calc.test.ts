import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import Fastify from 'fastify'
import { calcRoute } from '../calculate'
import { encodeRoute } from '../encode'
import { deflateSync } from 'zlib'
import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

let app: ReturnType<typeof Fastify>

beforeAll(async () => {
  app = Fastify({ logger: false })
  app.addHook('onRequest', async (req, reply) => {
    reply.header('Access-Control-Allow-Origin', '*')
    if (req.method === 'OPTIONS') { reply.status(204).send(''); return }
  })
  await encodeRoute(app)
  await calcRoute(app)
  await app.ready()
})

afterAll(async () => {
  await app.close()
})

describe('Calculate API', () => {
  // 6.3.1 Stormweaver build full calculation
  it('calculates stormweaver build from XML', async () => {
    const xmlPath = join(__dirname, '..', '..', 'scripts', 'spec', 'fixtures', 'stormweaver.xml')
    const xml = readFileSync(xmlPath, 'utf-8')
    
    const res = await app.inject({
      method: 'POST',
      url: '/api/build/calculate',
      payload: { xml }
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.success).toBe(true)
    expect(body.data).toBeDefined()
    
    // Verify key stats match known values from XML PlayerStat
    expect(body.data.Str).toBe(76)
    expect(body.data.Dex).toBe(82)
    expect(body.data.Int).toBe(270)
    expect(body.data.Life).toBeGreaterThan(0)
    expect(body.data.EnergyShield).toBeGreaterThan(0)
    expect(body.data.allocatedNodes).toBeGreaterThan(100)
    
    console.log(`Stormweaver calc: Str=${body.data.Str} Dex=${body.data.Dex} Int=${body.data.Int} Life=${body.data.Life} ES=${body.data.EnergyShield} nodes=${body.data.allocatedNodes}`)
  })

  // 6.3.2 Non-null key fields
  it('returns all expected stat fields', async () => {
    const xmlPath = join(__dirname, '..', '..', 'scripts', 'spec', 'fixtures', 'stormweaver.xml')
    const xml = readFileSync(xmlPath, 'utf-8')
    
    const res = await app.inject({
      method: 'POST',
      url: '/api/build/calculate',
      payload: { xml }
    })
    const data = res.json().data
    
    const required = ['Str','Dex','Int','Life','Mana','EnergyShield','Armour','Evasion',
      'FireResistTotal','ColdResistTotal','LightningResistTotal','ChaosResistTotal',
      'TotalDPS','FullDPS','AverageHit','Speed','allocatedNodes']
    
    for (const key of required) {
      expect(data).toHaveProperty(key)
      expect(data[key]).not.toBeUndefined()
    }
  })

  // 6.3.3 Empty build does not crash
  it('handles minimal valid XML without crash', async () => {
    const minimalXml = `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding2>
  <Build level="1" targetVersion="0_4" className="Sorceress" ascendClassName="Stormweaver">
    <Tree activeSpec="1">
      <Spec treeVersion="0_4" classId="6" ascendClassId="1" nodes="" masteryEffects=""/>
    </Tree>
  </Build>
</PathOfBuilding2>`
    
    const res = await app.inject({
      method: 'POST',
      url: '/api/build/calculate',
      payload: { xml: minimalXml }
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.success).toBe(true)
    expect(body.data.Str).toBeDefined()
    console.log(`Minimal build: Str=${body.data.Str} Life=${body.data.Life}`)
  })

  // 6.3.4 Calc time
  it('completes calculation within time limit', async () => {
    const xmlPath = join(__dirname, '..', '..', 'scripts', 'spec', 'fixtures', 'stormweaver.xml')
    const xml = readFileSync(xmlPath, 'utf-8')
    
    const start = Date.now()
    const res = await app.inject({
      method: 'POST',
      url: '/api/build/calculate',
      payload: { xml }
    })
    const elapsed = Date.now() - start
    
    expect(res.statusCode).toBe(200)
    expect(elapsed).toBeLessThan(15000) // < 15s
    console.log(`Stormweaver calc completed in ${elapsed}ms`)
  })

  // 6.2.2 import-and-calc endpoint
  it('import-and-calc: encode -> calc round-trip', async () => {
    const nodes = ["61419","65413","10131","54447"]
    
    // Encode
    const encRes = await app.inject({
      method: 'POST', url: '/api/code/encode',
      payload: { nodes, treeVersion: '0_4' }
    })
    const { code } = encRes.json()
    
    // Import and calculate
    const calcRes = await app.inject({
      method: 'POST', url: '/api/build/import-and-calc',
      payload: { code }
    })
    expect(calcRes.statusCode).toBe(200)
    const body = calcRes.json()
    expect(body.success).toBe(true)
    expect(body.meta).toBeDefined()
    expect(body.meta.nodeCount).toBe(4)
    console.log(`import-and-calc: ${body.meta.nodeCount} nodes, success=${body.success}`)
  })

  // Invalid input
  it('returns 400 for missing code/xml', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/build/calculate',
      payload: {}
    })
    expect(res.statusCode).toBe(400)
  })

  it('returns error for invalid code', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/build/calculate',
      payload: { code: '!!!not-valid!!!' }
    })
    expect(res.statusCode).toBe(400)
  })
})

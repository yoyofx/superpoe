import { FastifyInstance } from 'fastify'
import { spawn } from 'child_process'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { inflateSync } from 'zlib'
import { XMLParser } from 'fast-xml-parser'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const LUAJIT =
  process.env.LUAJIT_PATH ||
  'C:\\Users\\yoyofx\\AppData\\Local\\Programs\\LuaJIT\\bin\\luajit.exe'
const SRC_DIR = join(__dirname, '..', 'sources', 'src')
const CALC_SCRIPT = join(__dirname, '..', 'scripts', 'headless_calcs.lua')
const LUA_PATH = '../runtime/lua/?.lua;../runtime/lua/?/init.lua;;'
const LUA_CPATH = '../runtime/?.dll;../runtime/lua/?.dll;;'

interface CalcInput {
  xml?: string
}

interface CalcOutput {
  success: boolean
  data?: Record<string, unknown>
  error?: string
}

function callLuaJITCalc(xml: string): Promise<CalcOutput> {
  return new Promise((resolve) => {
    const child = spawn(LUAJIT, [CALC_SCRIPT, '--stdin'], {
      cwd: SRC_DIR,
      env: { ...process.env, LUA_PATH, LUA_CPATH },
      timeout: 30000,
    })

    let stdout = ''
    let stderr = ''

    child.stdout.on('data', (d: Buffer) => {
      stdout += d.toString()
    })
    child.stderr.on('data', (d: Buffer) => {
      stderr += d.toString()
    })

    child.on('close', (code) => {
      if (code !== 0) {
        resolve({
          success: false,
          error: `LuaJIT exited with code ${code}: ${stderr.trim().slice(0, 500)}`,
        })
        return
      }
      try {
        const result = JSON.parse(stdout.trim())
        resolve(result)
      } catch {
        resolve({
          success: false,
          error: `Parse error: ${stdout.slice(0, 300)}`,
        })
      }
    })

    child.on('error', (err) => {
      resolve({
        success: false,
        error: `LuaJIT spawn failed: ${err.message}`,
      })
    })

    // Write XML to stdin
    child.stdin.write(xml)
    child.stdin.end()
  })
}

/**
 * POST /api/build/calculate
 *
 * Body: { code } or { xml }
 * If "code" provided: base64decode ¡ú inflate ¡ú XML ¡ú LuaJIT calc
 * If "xml" provided: XML ¡ú LuaJIT calc directly
 * Response: { success, data: { Str, Dex, Int, Life, ES, DPS, ... }, error }
 */
export async function calcRoute(fastify: FastifyInstance) {
  fastify.post<{
    Body: { code?: string; xml?: string }
  }>(
    '/api/build/calculate',
    async (request, reply) => {
      const { code, xml } = request.body || {}

      let xmlText = xml

      // If code provided, decode it first
      if (code && !xmlText) {
        try {
          const base64 = code.replace(/-/g, '+').replace(/_/g, '/')
          const buf = Buffer.from(base64, 'base64')
          xmlText = inflateSync(buf).toString('utf-8')
        } catch {
          return reply
            .status(400)
            .send({ success: false, error: 'Failed to decode import code' })
        }
      }

      if (!xmlText) {
        return reply
          .status(400)
          .send({ success: false, error: 'Missing "code" or "xml" in body' })
      }

      // Quick validation: check it looks like a PoB2 XML
      if (!xmlText.includes('<PathOfBuilding2>')) {
        return reply
          .status(400)
          .send({ success: false, error: 'Invalid PoB2 build XML' })
      }

      try {
        const result = await callLuaJITCalc(xmlText)
        return reply.send(result)
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err)
        return reply.status(500).send({ success: false, error: msg })
      }
    },
  )

  // Convenience endpoint: import code ¡ú decode ¡ú calculate
  fastify.post<{
    Body: { code?: string }
  }>(
    '/api/build/import-and-calc',
    async (request, reply) => {
      const { code } = request.body || {}

      if (!code) {
        return reply
          .status(400)
          .send({ success: false, error: 'Missing "code"' })
      }

      try {
        // Decode
        const base64 = code.replace(/-/g, '+').replace(/_/g, '/')
        const buf = Buffer.from(base64, 'base64')
        const xmlText = inflateSync(buf).toString('utf-8')

        // Parse to extract node count
        const parser = new XMLParser({ ignoreAttributes: false })
        const root = parser.parse(xmlText)
        const specNodes =
          root?.PathOfBuilding2?.Build?.Tree?.Spec?.['@_nodes'] || ''
        const nodeCount = specNodes ? specNodes.split(',').length : 0

        // Run calculation
        const calcResult = await callLuaJITCalc(xmlText)

        return reply.send({
          ...calcResult,
          meta: {
            nodeCount,
            xmlSize: xmlText.length,
          },
        })
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err)
        return reply.status(500).send({ success: false, error: msg })
      }
    },
  )
}

import { FastifyInstance } from 'fastify'
import { spawn } from 'child_process'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// LuaJITÂ·¾¶ (À´×Ô headless-wrapper-validation.md)
const LUAJIT = process.env.LUAJIT_PATH || 'C:\\Users\\yoyofx\\AppData\\Local\\Programs\\LuaJIT\\bin\\luajit.exe'
const SRC_DIR = join(__dirname, '..', 'upstreams', 'PathOfBuilding-PoE2', 'src')
const SCRIPT = join(__dirname, '..', 'scripts', 'validate_spec.lua')
const LUA_PATH = '../runtime/lua/?.lua;../runtime/lua/?/init.lua;;'
const LUA_CPATH = '../runtime/?.dll;../runtime/lua/?.dll;;'

interface ValidateInput {
  nodes?: string[]
  treeVersion?: string
  classId?: string
}

interface ValidateOutput {
  valid: boolean
  errors: string[]
  warnings: string[]
}

function callLuaJIT(input: ValidateInput): Promise<ValidateOutput> {
  return new Promise((resolve, reject) => {
    const inputJson = JSON.stringify({
      nodes: input.nodes || [],
      treeVersion: input.treeVersion || '0_4',
      classId: input.classId || '',
    })

    const child = spawn(LUAJIT, [SCRIPT, inputJson], {
      cwd: SRC_DIR,
      env: {
        ...process.env,
        LUA_PATH,
        LUA_CPATH,
      },
      timeout: 15000,
    })

    let stdout = ''
    let stderr = ''

    child.stdout.on('data', (d: Buffer) => { stdout += d.toString() })
    child.stderr.on('data', (d: Buffer) => { stderr += d.toString() })

    child.on('close', (code) => {
      if (code !== 0) {
        resolve({
          valid: false,
          errors: [`LuaJIT exited with code ${code}: ${stderr.trim()}`],
          warnings: [],
        })
        return
      }
      try {
        const result = JSON.parse(stdout.trim())
        resolve(result)
      } catch {
        resolve({
          valid: false,
          errors: [`Parse error: ${stdout.slice(0, 200)}`],
          warnings: [],
        })
      }
    })

    child.on('error', (err) => {
      resolve({
        valid: false,
        errors: [`LuaJIT spawn failed: ${err.message}`],
        warnings: [],
      })
    })
  })
}

/**
 * POST /api/tree/validate
 * Body: { nodes: string[], treeVersion?: string, classId?: string }
 * Response: { valid: boolean, errors: string[], warnings: string[] }
 */
export async function validateRoute(fastify: FastifyInstance) {
  fastify.post<{ Body: ValidateInput }>(
    '/api/tree/validate',
    async (request, reply) => {
      const { nodes, treeVersion, classId } = request.body || {}

      if (!nodes || !Array.isArray(nodes)) {
        return reply.status(400).send({
          valid: false,
          errors: ['Missing or invalid "nodes" array'],
          warnings: [],
        })
      }

      // Quick client-side check: no empty array is always valid
      if (nodes.length === 0) {
        return reply.send({ valid: true, errors: [], warnings: [] })
      }

      try {
        const result = await callLuaJIT({ nodes, treeVersion, classId })
        return reply.send(result)
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err)
        return reply.status(500).send({
          valid: false,
          errors: [`Validation error: ${msg}`],
          warnings: [],
        })
      }
    },
  )
}

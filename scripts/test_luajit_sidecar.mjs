import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import { inflate } from 'pako'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const platformArch = `${process.platform}-${process.arch}`
const executable = process.env.SUPERPOE_LUAJIT_EXECUTABLE || path.join(
  root,
  'native',
  'bin',
  platformArch,
  process.platform === 'win32' ? 'luajit.exe' : 'luajit',
)
const runner = path.join(root, 'native', 'pob-lua-runner.lua')
const bundle = path.join(root, 'public', 'pob-lua')
const buildCodePath = process.env.SUPERPOE_BUILD_CODE_PATH
const xml = buildCodePath
  ? new TextDecoder().decode(inflate(Buffer.from(
    readFileSync(buildCodePath, 'utf8').trim().replace(/-/g, '+').replace(/_/g, '/'),
    'base64',
  )))
  : readFileSync(path.join(root, 'scripts', 'spec', 'fixtures', 'stormweaver.xml'), 'utf8')

const child = spawn(executable, [runner, bundle], {
  cwd: bundle,
  windowsHide: true,
  stdio: ['pipe', 'pipe', 'pipe'],
})
const lines = createInterface({ input: child.stdout })
let stderr = ''
child.stderr.on('data', (chunk) => { stderr += String(chunk) })

const timeout = setTimeout(() => {
  child.kill()
  throw new Error(`LuaJIT sidecar smoke test timed out\n${stderr}`)
}, 60_000)

let ready = false
lines.on('line', (line) => {
  const message = JSON.parse(line)
  if (!ready) {
    if (message.type !== 'ready' || message.protocolVersion !== 1) {
      throw new Error(`Invalid ready message: ${line}`)
    }
    ready = true
    child.stdin.write(`${JSON.stringify({ id: 1, type: 'calculate', payload: { xml } })}\n`)
    return
  }

  if (message.id !== 1 || !message.success || !message.data?.success) {
    throw new Error(`Calculation failed: ${line}\n${stderr}`)
  }
  const data = message.data.data
  if (!buildCodePath && (data.CharacterLevel !== 98 || data.ClassName !== 'Sorceress' || data.AscendClassName !== 'Stormweaver')) {
    throw new Error(`Unexpected PoB result: ${JSON.stringify(data)}`)
  }
  if (!(data.allocatedNodes > 0) || !(data.Mana > 0)) {
    throw new Error(`Incomplete PoB result: ${JSON.stringify(data)}`)
  }
  if (!Number.isFinite(data.DeflectChance) || !Number.isFinite(data.DeflectEffect)) {
    throw new Error(`Missing deflection result: ${JSON.stringify(data)}`)
  }
  clearTimeout(timeout)
  if (buildCodePath) {
    console.log(JSON.stringify(data, null, 2))
  } else {
    console.log(`LuaJIT parity fixture passed: level=${data.CharacterLevel}, nodes=${data.allocatedNodes}, mana=${data.Mana}, deflect=${data.DeflectChance}%/${data.DeflectEffect}%`)
  }
  child.kill()
})

child.once('error', (error) => {
  clearTimeout(timeout)
  throw error
})

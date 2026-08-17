import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const catalogPath = path.join(root, 'public', 'data', 'skill-catalog.json')
const bundle = path.join(root, 'public', 'pob-lua')
const projectBundle = path.join(root, 'public', 'superpoe-lua')
const runner = path.join(root, 'native', 'pob-lua-runner.lua')
const bundledExecutable = path.join(
  root,
  'native',
  'bin',
  process.platform === 'darwin' ? 'darwin-arm64' : `${process.platform}-${process.arch}`,
  process.platform === 'win32' ? 'luajit.exe' : 'luajit',
)
const executable = process.env.SUPERPOE_LUAJIT_EXECUTABLE
  || process.env.LUAJIT_PATH
  || (existsSync(bundledExecutable) ? bundledExecutable : 'luajit')
const MAX_QUALITY = 30

if (!existsSync(catalogPath)) throw new Error(`Missing skill catalog: ${catalogPath}`)
if (!existsSync(bundle)) throw new Error(`Missing PoB Lua bundle: ${bundle}`)
if (!existsSync(projectBundle)) throw new Error(`Missing SuperPoE Lua bundle: ${projectBundle}`)
if (!existsSync(runner)) throw new Error(`Missing PoB Lua runner: ${runner}`)

const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'))
const supports = Object.values(catalog.entries).filter((entry) => entry.type === 'support')
const requests = []
for (const entry of supports) {
  delete entry.effectLines
  delete entry.effectLinesByQuality
  for (let quality = 0; quality <= MAX_QUALITY; quality += 1) {
    requests.push({ skillId: entry.id, level: entry.naturalMaxLevel || 1, quality })
  }
}

const effects = await new Promise((resolve, reject) => {
  const child = spawn(executable, [runner, bundle, projectBundle], {
    cwd: bundle,
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  const lines = createInterface({ input: child.stdout })
  let stderr = ''
  let ready = false
  let settled = false
  const finish = (error, value) => {
    if (settled) return
    settled = true
    clearTimeout(timeout)
    lines.close()
    if (!child.killed) child.kill()
    if (error) reject(error)
    else resolve(value)
  }
  const timeout = setTimeout(() => finish(new Error(`Support effect export timed out\n${stderr}`)), 60_000)

  child.stderr.on('data', (chunk) => { stderr += String(chunk) })
  child.once('error', (error) => finish(error))
  child.once('exit', (code) => {
    if (!settled && code !== 0) finish(new Error(`LuaJIT exited with code ${code}\n${stderr}`))
  })
  lines.on('line', (line) => {
    let message
    try {
      message = JSON.parse(line)
    } catch (error) {
      finish(new Error(`LuaJIT returned invalid JSON: ${line.slice(0, 200)}`, { cause: error }))
      return
    }
    if (!ready) {
      if (message.type !== 'ready') {
        finish(new Error(`LuaJIT did not send a ready message: ${line.slice(0, 200)}`))
        return
      }
      ready = true
      child.stdin.end(`${JSON.stringify({
        id: 1,
        type: 'describeSupportGems',
        payload: { gems: requests },
      })}\n`)
      return
    }
    if (message.id !== 1 || !message.success || !message.data?.success || !Array.isArray(message.data.data)) {
      finish(new Error(`Support effect export failed: ${line.slice(0, 500)}\n${stderr}`))
      return
    }
    finish(null, message.data.data)
  })
})

if (effects.length !== requests.length) {
  throw new Error(`Expected ${requests.length} support effect results, received ${effects.length}`)
}

let exported = 0
let qualityVariants = 0
for (let supportIndex = 0; supportIndex < supports.length; supportIndex += 1) {
  const entry = supports[supportIndex]
  const offset = supportIndex * (MAX_QUALITY + 1)
  const baseLines = effects[offset]?.lines || []
  if (baseLines.length > 0) {
    entry.effectLines = baseLines
    exported += 1
  }
  const variants = {}
  const baseKey = JSON.stringify(baseLines)
  for (let quality = 1; quality <= MAX_QUALITY; quality += 1) {
    const lines = effects[offset + quality]?.lines || []
    if (JSON.stringify(lines) !== baseKey) variants[String(quality)] = lines
  }
  if (Object.keys(variants).length > 0) {
    entry.effectLinesByQuality = variants
    qualityVariants += Object.keys(variants).length
  }
}

catalog.schemaVersion = Math.max(2, Number(catalog.schemaVersion) || 0)
catalog.source.supportEffects = 'public/pob-lua via native/pob-lua-runner.lua'
catalog.stats.supportWithEffects = exported
catalog.stats.supportQualityVariants = qualityVariants
writeFileSync(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`, 'utf8')
console.log(`[ok] support effects ${exported}/${supports.length}, quality variants ${qualityVariants} -> ${catalogPath}`)

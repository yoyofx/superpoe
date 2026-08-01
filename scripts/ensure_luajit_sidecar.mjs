import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const platformArch = process.platform === 'darwin' ? 'darwin-arm64' : `${process.platform}-${process.arch}`
if (platformArch !== 'win32-x64' && platformArch !== 'darwin-arm64') {
  throw new Error(`Unsupported SuperPoE native target: ${platformArch}`)
}
const lock = JSON.parse(readFileSync(path.join(root, 'pob-runtime.lock.json'), 'utf8'))
const output = path.join(root, 'native', 'bin', platformArch)
const required = process.platform === 'win32'
  ? [path.join(output, 'luajit.exe'), path.join(output, 'lua51.dll')]
  : [path.join(output, 'luajit')]

const missing = required.filter((file) => !existsSync(file))
if (missing.length) {
  console.log(`Native LuaJIT is missing for ${platformArch}; building it now.`)
  execFileSync(process.execPath, [path.join(root, 'scripts', 'build_luajit_sidecar.mjs')], {
    cwd: root,
    stdio: 'inherit',
  })
}

const stillMissing = required.filter((file) => !existsSync(file))
if (stillMissing.length) {
  throw new Error(`Native LuaJIT build did not produce: ${stillMissing.join(', ')}`)
}

for (const file of required) {
  const relative = path.relative(root, file).split(path.sep).join('/')
  const expected = lock.luajit.binaries.find((binary) => binary.path === relative)
  if (!expected) throw new Error(`Native LuaJIT is not recorded in pob-runtime.lock.json: ${relative}`)
  const size = statSync(file).size
  const sha256 = createHash('sha256').update(readFileSync(file)).digest('hex')
  if (size !== expected.size || sha256 !== expected.sha256) {
    throw new Error(`Native LuaJIT checksum mismatch: ${relative}`)
  }
  if (process.platform === 'darwin' && (statSync(file).mode & 0o111) === 0) {
    throw new Error(`Native LuaJIT is not executable: ${relative}`)
  }
}

console.log(`Prebuilt native LuaJIT verified: ${platformArch}`)

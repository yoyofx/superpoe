import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const platformArch = `${process.platform}-${process.arch}`
if (platformArch !== 'win32-x64' && platformArch !== 'darwin-arm64') {
  throw new Error(`Unsupported SuperPoE native target: ${platformArch}`)
}
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

console.log(`Native LuaJIT ready: ${platformArch}`)

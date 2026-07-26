import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const lock = JSON.parse(readFileSync(path.join(root, 'pob-runtime.lock.json'), 'utf8'))
const platformArch = `${process.platform}-${process.arch}`
const output = path.join(root, 'native', 'bin', platformArch)
const checkout = mkdtempSync(path.join(tmpdir(), 'superpoe-luajit-'))

function run(command, args, options = {}) {
  execFileSync(command, args, { stdio: 'inherit', ...options })
}

run('git', ['clone', '--filter=blob:none', '--no-checkout', lock.luajit.repository, checkout])
run('git', ['checkout', '--detach', lock.luajit.commit], { cwd: checkout })
mkdirSync(output, { recursive: true })

if (process.platform === 'win32') {
  const vswhere = path.join(
    process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)',
    'Microsoft Visual Studio', 'Installer', 'vswhere.exe',
  )
  if (!existsSync(vswhere)) throw new Error('Visual Studio Build Tools with C++ are required')
  const installation = execFileSync(vswhere, [
    '-latest', '-products', '*', '-requires', 'Microsoft.VisualStudio.Component.VC.Tools.x86.x64',
    '-property', 'installationPath',
  ], { encoding: 'utf8' }).trim()
  if (!installation) throw new Error('Visual Studio C++ build tools were not found')
  const devCmd = path.join(installation, 'Common7', 'Tools', 'VsDevCmd.bat')
  const buildCommand = `call "${devCmd}" -arch=x64 -host_arch=x64 && call msvcbuild.bat`
  run('cmd.exe', ['/d', '/s', '/c', buildCommand], { cwd: path.join(checkout, 'src') })
  cpSync(path.join(checkout, 'src', 'luajit.exe'), path.join(output, 'luajit.exe'))
  cpSync(path.join(checkout, 'src', 'lua51.dll'), path.join(output, 'lua51.dll'))
} else if (process.platform === 'darwin') {
  run('make', ['-j2'], { cwd: checkout })
  cpSync(path.join(checkout, 'src', 'luajit'), path.join(output, 'luajit'), { mode: 0o755 })
} else {
  throw new Error(`Unsupported platform for SuperPoE LuaJIT: ${process.platform}`)
}

console.log(`LuaJIT ${lock.luajit.commit} -> ${output}`)

import { execFileSync } from 'node:child_process'
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const lock = JSON.parse(readFileSync(path.join(root, 'pob-runtime.lock.json'), 'utf8'))
const platformArch = `${process.platform}-${process.arch}`
const supportedTargets = new Set(['win32-x64', 'darwin-arm64'])
if (!supportedTargets.has(platformArch)) {
  throw new Error(`Unsupported SuperPoE native target: ${platformArch}`)
}
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
  const installation = existsSync(vswhere)
    ? execFileSync(vswhere, [
      '-latest', '-products', '*', '-requires', 'Microsoft.VisualStudio.Component.VC.Tools.x86.x64',
      '-property', 'installationPath',
    ], { encoding: 'utf8' }).trim()
    : ''
  if (installation) {
    const devCmd = path.join(installation, 'Common7', 'Tools', 'VsDevCmd.bat')
    const buildCommand = `call "${devCmd}" -arch=x64 -host_arch=x64 && call msvcbuild.bat`
    run('cmd.exe', ['/d', '/s', '/c', buildCommand], { cwd: path.join(checkout, 'src') })
  } else {
    const toolRoot = process.env.W64DEVKIT_ROOT
    const make = toolRoot && path.join(toolRoot, 'bin', 'mingw32-make.exe')
    if (!make || !existsSync(make)) {
      throw new Error('Visual Studio C++ Build Tools or W64DEVKIT_ROOT is required')
    }
    const env = {
      ...process.env,
      PATH: `${path.join(toolRoot, 'bin')};${process.env.SystemRoot || 'C:\\Windows'}\\System32`,
      OS: '',
      MSYSTEM: 'MINGW64',
    }
    run(make, [
      '-j2',
      'HOST_SYS=Windows',
      'HOST_MSYS=mingw',
      'TARGET_SYS=Windows',
    ], { cwd: checkout, env })
  }
  cpSync(path.join(checkout, 'src', 'luajit.exe'), path.join(output, 'luajit.exe'))
  cpSync(path.join(checkout, 'src', 'lua51.dll'), path.join(output, 'lua51.dll'))
} else if (process.platform === 'darwin') {
  run('make', ['-j2'], { cwd: checkout })
  const executable = path.join(output, 'luajit')
  cpSync(path.join(checkout, 'src', 'luajit'), executable)
  chmodSync(executable, 0o755)
} else {
  throw new Error(`Unsupported platform for SuperPoE LuaJIT: ${process.platform}`)
}

console.log(`LuaJIT ${lock.luajit.commit} -> ${output}`)

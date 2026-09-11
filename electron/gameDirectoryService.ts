import { execFile } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'
import type {
  GameDirectoryDetectionResult,
  GameDirectoryDetectionSource,
  GameDirectoryRealm,
} from '../src/types/gameDirectory.js'

const execFileAsync = promisify(execFile)
const WINDOWS_UNINSTALL_ROOTS = [
  'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
  'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
  'HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
]
const WINDOWS_GAME_EXECUTABLES = [
  'PathOfExile.exe',
  'PathOfExile_x64.exe',
  'PathOfExileSteam.exe',
  'PathOfExile_x64Steam.exe',
]
const COMMON_GAME_SUBDIRECTORIES = ['Path of Exile 2', 'poe2', '2002052']

interface GameExecutable {
  directory: string
  executablePath: string
}

function now(): string {
  return new Date().toISOString()
}

function makeResult(
  realm: GameDirectoryRealm,
  status: GameDirectoryDetectionResult['status'],
  details: Partial<Pick<GameDirectoryDetectionResult, 'directory' | 'executablePath' | 'source'>> = {},
): GameDirectoryDetectionResult {
  return { realm, status, checkedAt: now(), ...details }
}

function expandEnvironmentVariables(value: string): string {
  return value.replace(/%([^%]+)%/g, (_match, name: string) => process.env[name] || `%${name}%`)
}

function cleanPathValue(value: string): string {
  let cleaned = expandEnvironmentVariables(value.trim())
  const quoted = cleaned.match(/^"([^"]+)"/)
  if (quoted) cleaned = quoted[1]
  cleaned = cleaned.replace(/,\d+\s*$/, '').trim()
  return cleaned
}

function isExistingDirectory(value: string): boolean {
  try { return statSync(value).isDirectory() } catch { return false }
}

function findGameExecutable(candidate: string): GameExecutable | undefined {
  const cleaned = cleanPathValue(candidate)
  if (!cleaned) return undefined

  let directory = cleaned
  try {
    if (statSync(cleaned).isFile()) directory = path.dirname(cleaned)
  } catch {
    if (/\.exe$/iu.test(cleaned)) directory = path.dirname(cleaned)
  }
  if (!isExistingDirectory(directory)) return undefined

  const directories = [directory]
  for (const childName of COMMON_GAME_SUBDIRECTORIES) {
    const childDirectory = path.join(directory, childName)
    if (isExistingDirectory(childDirectory)) directories.push(childDirectory)
  }
  for (const directoryCandidate of directories) {
    for (const executableName of WINDOWS_GAME_EXECUTABLES) {
      const executablePath = path.join(directoryCandidate, executableName)
      if (existsSync(executablePath)) {
        return { directory: path.resolve(directoryCandidate), executablePath: path.resolve(executablePath) }
      }
    }
  }
  return undefined
}

async function readRegistryValue(key: string, valueName: string): Promise<string | undefined> {
  if (process.platform !== 'win32') return undefined
  const regExe = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'reg.exe')
  try {
    const { stdout } = await execFileAsync(regExe, ['QUERY', key, '/v', valueName], {
      encoding: 'utf8',
      windowsHide: true,
      maxBuffer: 256 * 1024,
    })
    const escapedName = valueName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const line = stdout.split(/\r?\n/).find((entry) => new RegExp(`^\\s*${escapedName}\\s+REG_\\w+\\s+`, 'i').test(entry))
    if (!line) return undefined
    return line.replace(new RegExp(`^\\s*${escapedName}\\s+REG_\\w+\\s+`, 'i'), '').trim() || undefined
  } catch {
    return undefined
  }
}

async function queryRegistryKeys(root: string, phrase: string): Promise<string[]> {
  if (process.platform !== 'win32') return []
  const regExe = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'reg.exe')
  try {
    const { stdout } = await execFileAsync(regExe, ['QUERY', root, '/s', '/f', phrase, '/d'], {
      encoding: 'utf8',
      windowsHide: true,
      maxBuffer: 2 * 1024 * 1024,
    })
    return [...new Set(stdout.split(/\r?\n/).map((line) => line.trim()).filter((line) => /^HKEY_(?:CURRENT_USER|LOCAL_MACHINE)\\/iu.test(line)))]
  } catch {
    return []
  }
}

async function registryCandidates(realm: GameDirectoryRealm): Promise<string[]> {
  const candidates: string[] = []
  const values = ['InstallLocation', 'InstallSource', 'DisplayIcon', 'BundleCachePath', 'UninstallString']
  const keys = realm === 'cn'
    ? WINDOWS_UNINSTALL_ROOTS.flatMap((root) => [
      `${root}\\流放之路：降临`,
      `${root}\\流放之路降临`,
    ])
    : (await Promise.all(WINDOWS_UNINSTALL_ROOTS.map((root) => queryRegistryKeys(root, 'Path of Exile 2')))).flat()

  await Promise.all(keys.map(async (key) => {
    const entries = await Promise.all(values.map(async (valueName) => readRegistryValue(key, valueName)))
    candidates.push(...entries.filter((value): value is string => Boolean(value)))
  }))
  return candidates
}

function parseVdfPath(value: string): string {
  return value.replace(/\\\\/g, '\\').replace(/\\"/g, '"')
}

async function steamLibraryCandidates(): Promise<string[]> {
  const registryPaths = await Promise.all([
    readRegistryValue('HKCU\\Software\\Valve\\Steam', 'SteamPath'),
    readRegistryValue('HKLM\\SOFTWARE\\WOW6432Node\\Valve\\Steam', 'InstallPath'),
    readRegistryValue('HKLM\\SOFTWARE\\Valve\\Steam', 'InstallPath'),
  ])
  const roots = [
    ...registryPaths,
    process.env['ProgramFiles(x86)'] ? path.join(process.env['ProgramFiles(x86)']!, 'Steam') : undefined,
    process.env.ProgramFiles ? path.join(process.env.ProgramFiles, 'Steam') : undefined,
  ]
    .filter((value): value is string => Boolean(value))
    .map((value) => path.resolve(value.replace(/\//g, '\\')))
  const uniqueRoots = [...new Set(roots)]
  const libraries = new Set<string>()
  for (const root of uniqueRoots) {
    libraries.add(root)
    const vdfPath = path.join(root, 'steamapps', 'libraryfolders.vdf')
    try {
      const content = readFileSync(vdfPath, 'utf8')
      for (const match of content.matchAll(/"path"\s+"((?:\\.|[^"])*)"/giu)) {
        const library = match[1] ? parseVdfPath(match[1]) : ''
        if (library) libraries.add(path.resolve(library.replace(/\//g, '\\')))
      }
    } catch { /* Steam may not be installed or its library file may be unavailable. */ }
  }
  return [...libraries].map((library) => path.join(library, 'steamapps', 'common', 'Path of Exile 2'))
}

function knownLocationCandidates(): string[] {
  const candidates: string[] = []
  const roots = [
    process.env.ProgramFiles,
    process.env['ProgramFiles(x86)'],
    process.env.ProgramW6432,
  ].filter((value): value is string => Boolean(value))
  for (const root of roots) candidates.push(path.join(root, 'Grinding Gear Games', 'Path of Exile 2'))

  if (process.platform === 'win32') {
    // Standalone and WeGame installations are commonly placed at the drive
    // root. Only these exact game directory names are checked; no recursive
    // drive scan is performed.
    for (let code = 65; code <= 90; code += 1) {
      const drive = `${String.fromCharCode(code)}:`
      candidates.push(path.join(drive, 'Grinding Gear Games', 'Path of Exile 2'))
      candidates.push(path.join(drive, 'WeGameApps', 'rail_apps', 'poe2'))
      candidates.push(path.join(drive, 'WeGameApps', 'rail_apps', '2002052'))
    }
  }
  return candidates
}

function inspectCandidate(
  realm: GameDirectoryRealm,
  candidate: string,
  source: GameDirectoryDetectionSource,
): GameDirectoryDetectionResult | undefined {
  const executable = findGameExecutable(candidate)
  return executable ? makeResult(realm, 'found', { ...executable, source }) : undefined
}

export function inspectGameDirectory(realm: GameDirectoryRealm, directory: string): GameDirectoryDetectionResult {
  return inspectCandidate(realm, directory, 'manual') || makeResult(realm, 'not-found')
}

export async function detectGameDirectory(
  realm: GameDirectoryRealm,
  runningExecutablePath?: string,
): Promise<GameDirectoryDetectionResult> {
  if (process.platform !== 'win32') return makeResult(realm, 'unsupported')

  const running = runningExecutablePath ? inspectCandidate(realm, runningExecutablePath, 'running-client') : undefined
  if (running) return running

  const registry = await registryCandidates(realm)
  for (const candidate of registry) {
    const result = inspectCandidate(realm, candidate, 'registry')
    if (result) return result
  }

  if (realm === 'global') {
    for (const candidate of await steamLibraryCandidates()) {
      const result = inspectCandidate(realm, candidate, 'steam-library')
      if (result) return result
    }
  }

  for (const candidate of knownLocationCandidates()) {
    const result = inspectCandidate(realm, candidate, 'known-location')
    if (result) return result
  }
  return makeResult(realm, 'not-found')
}

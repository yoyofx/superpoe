export type UpdateChannel = 'release' | 'dev'

/**
 * Compare two version strings.
 * Core numeric parts first (1.2.3); when equal, no-prerelease > prerelease;
 * prerelease tags compared lexicographically.
 * Returns >0 if a is newer than b.
 */
export function compareVersions(a: string, b: string): number {
  const parseVer = (v: string) => {
    const dashIdx = v.indexOf('-')
    const core = dashIdx >= 0 ? v.slice(0, dashIdx) : v
    const pre = dashIdx >= 0 ? v.slice(dashIdx + 1) : ''
    return { parts: core.split('.').map((part) => Number(part) || 0), pre }
  }
  const av = parseVer(a)
  const bv = parseVer(b)
  for (let i = 0; i < Math.max(av.parts.length, bv.parts.length); i++) {
    const diff = (av.parts[i] || 0) - (bv.parts[i] || 0)
    if (diff !== 0) return diff
  }
  if (!av.pre && bv.pre) return 1
  if (av.pre && !bv.pre) return -1
  if (av.pre && bv.pre) return av.pre.localeCompare(bv.pre)
  return 0
}

/**
 * Whether remote latest.yml version should be offered as an update.
 * - release: only strictly newer semver
 * - dev: any different rolling build version string
 */
export function shouldOfferUpdate(channel: UpdateChannel, remoteVersion: string, currentVersion: string): boolean {
  if (!remoteVersion || !currentVersion) return false
  if (channel === 'dev') return remoteVersion !== currentVersion
  return compareVersions(remoteVersion, currentVersion) > 0
}

/** electron-builder publish manifest filename for the current platform */
export function getLatestYmlFileName(platform: NodeJS.Platform = process.platform): string {
  if (platform === 'darwin') return 'latest-mac.yml'
  if (platform === 'linux') return 'latest-linux.yml'
  return 'latest.yml'
}

/**
 * Pick the best installer asset name from a platform-specific latest*.yml.
 * On macOS prefers .dmg over .zip and matches process arch (arm64 vs x64).
 */
export function pickInstallerFileName(
  yml: LatestYml,
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): string {
  const files = yml.files || []
  if (platform === 'win32') {
    const exe = files.find((f) => f.url.endsWith('.exe'))
    return exe?.url || yml.path
  }
  if (platform === 'darwin') {
    const isArm = arch === 'arm64'
    const matchesArch = (url: string) => (isArm ? url.includes('arm64') : !url.includes('arm64'))
    const dmgArch = files.find((f) => f.url.endsWith('.dmg') && matchesArch(f.url))
    if (dmgArch) return dmgArch.url
    const zipArch = files.find((f) => f.url.endsWith('.zip') && matchesArch(f.url))
    if (zipArch) return zipArch.url
    const dmg = files.find((f) => f.url.endsWith('.dmg'))
    if (dmg) return dmg.url
    const zip = files.find((f) => f.url.endsWith('.zip'))
    if (zip) return zip.url
    return yml.path
  }
  const appImage = files.find((f) => f.url.endsWith('.AppImage'))
  if (appImage) return appImage.url
  return yml.path
}

export interface LatestYmlFile {
  url: string
  sha512: string
  size: number
}

export interface LatestYml {
  version: string
  path: string
  sha512: string
  releaseDate: string
  files: LatestYmlFile[]
}

export function parseLatestYml(raw: string): LatestYml | null {
  try {
    const lines = raw.split('\n')
    const result: Partial<LatestYml> = {}
    const files: LatestYmlFile[] = []
    let inFiles = false
    let currentFile: Partial<LatestYmlFile> = {}

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) continue
      // Top-level keys (no indent) end the files list and apply to the document root.
      const isTopLevel = !/^\s/.test(line)

      if (trimmed.startsWith('version:')) {
        result.version = trimmed.slice('version:'.length).trim().replace(/^['"]|['"]$/g, '')
        inFiles = false
      } else if (trimmed.startsWith('path:') && (isTopLevel || !inFiles)) {
        result.path = trimmed.slice('path:'.length).trim().replace(/^['"]|['"]$/g, '')
        inFiles = false
      } else if (trimmed.startsWith('sha512:') && (isTopLevel || !inFiles)) {
        result.sha512 = trimmed.slice('sha512:'.length).trim().replace(/^['"]|['"]$/g, '')
        inFiles = false
      } else if (trimmed.startsWith('releaseDate:')) {
        result.releaseDate = trimmed.slice('releaseDate:'.length).trim().replace(/^['"]|['"]$/g, '')
        inFiles = false
      } else if (trimmed === 'files:') {
        inFiles = true
      } else if (inFiles && trimmed.startsWith('- url:')) {
        if (currentFile.url) {
          files.push(currentFile as LatestYmlFile)
        }
        currentFile = { url: trimmed.slice('- url:'.length).trim().replace(/^['"]|['"]$/g, '') }
      } else if (inFiles && !isTopLevel && trimmed.startsWith('sha512:')) {
        currentFile.sha512 = trimmed.slice('sha512:'.length).trim().replace(/^['"]|['"]$/g, '')
      } else if (inFiles && !isTopLevel && trimmed.startsWith('size:')) {
        currentFile.size = parseInt(trimmed.slice('size:'.length).trim(), 10)
      }
    }
    if (currentFile.url) files.push(currentFile as LatestYmlFile)
    result.files = files

    // path is optional in some feeds; fall back to first file url
    if (!result.path && files[0]?.url) result.path = files[0].url
    if (!result.version || !result.path) return null
    return result as LatestYml
  } catch {
    return null
  }
}

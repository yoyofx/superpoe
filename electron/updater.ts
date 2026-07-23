import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { createWriteStream, mkdirSync, existsSync, unlinkSync, readFileSync } from 'node:fs'
import { get as httpsGet } from 'node:https'
import { get as httpGet, type IncomingMessage } from 'node:http'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { parseLatestYml, pickInstallerFileName, shouldOfferUpdate, getLatestYmlFileName, type LatestYml } from './updateVersion.js'

export type UpdateChannel = 'release' | 'dev'

// Built-in GitHub proxy domains
const BUILTIN_PROXY_DOMAINS: string[] = [
  'https://gh.h233.eu.org',
  'https://rapidgit.jjda.de5.net',
  'https://gh-proxy.org',
  'https://cdn.gh-proxy.org',
  'https://edgeone.gh-proxy.org',
  'https://ghproxy.it',
  'https://github.boki.moe',
  'https://gh.jasonzeng.dev',
  'https://gh.monlor.com',
  'https://github.geekery.cn',
  'https://github.ednovas.xyz',
]

// User-configured proxy domains (set at runtime via IPC)
let userProxyDomains: string[] = []

export function setUserProxyDomains(domains: string[]): void {
  userProxyDomains = domains.map(d => d.replace(/\/+$/, ''))
}

export function getUserProxyDomains(): string[] {
  return userProxyDomains
}

/** Returns the union of built-in and user proxy domains (deduplicated) */
function getAllProxyDomains(): string[] {
  const set = new Set([...BUILTIN_PROXY_DOMAINS, ...userProxyDomains])
  return Array.from(set)
}

/** Convert a direct GitHub URL to a proxied URL: {proxyDomain}/{originalUrl} */
function toProxiedUrl(proxyDomain: string, originalUrl: string): string {
  return `${proxyDomain}/${originalUrl}`
}



export interface UpdateInfo {
  version: string
  currentVersion: string
  channel: UpdateChannel
  downloadUrl: string
  fileName: string
  releaseDate: string
}

export type UpdateCheckStatus = 'available' | 'up-to-date' | 'error'

export interface UpdateCheckResult {
  status: UpdateCheckStatus
  channel: UpdateChannel
  currentVersion: string
  /** Present when status === 'available' */
  update?: UpdateInfo
  /** Present when status === 'error' */
  error?: string
}

const DEFAULT_REPO_OWNER = 'yoyofx'
const DEFAULT_REPO_NAME = 'superpoe'
const GITHUB_BASE = 'https://github.com'

interface GithubRepoIdentity {
  owner: string
  name: string
}

/**
 * Resolve GitHub owner/name for update feeds.
 * Priority:
 * 1) SUPERPOE_GITHUB_OWNER + SUPERPOE_GITHUB_REPO
 * 2) GITHUB_REPOSITORY (owner/name) — set by GitHub Actions / local export
 * 3) package.json repository / superpoe.githubOwner|githubRepo (baked by CI)
 * 4) defaults
 */
function resolveGithubRepo(): GithubRepoIdentity {
  const envOwner = process.env.SUPERPOE_GITHUB_OWNER?.trim()
  const envName = process.env.SUPERPOE_GITHUB_REPO?.trim()
  if (envOwner && envName) return { owner: envOwner, name: envName }

  const githubRepository = process.env.GITHUB_REPOSITORY?.trim()
  if (githubRepository) {
    const [owner, name] = githubRepository.split('/')
    if (owner && name) return { owner, name }
  }

  try {
    const packagePath = path.join(app.getAppPath(), 'package.json')
    const pkg = JSON.parse(readFileSync(packagePath, 'utf8')) as {
      repository?: string | { url?: string; type?: string }
      superpoe?: { githubOwner?: string; githubRepo?: string }
    }

    const fromSuperpoeOwner = pkg.superpoe?.githubOwner?.trim()
    const fromSuperpoeName = pkg.superpoe?.githubRepo?.trim()
    if (fromSuperpoeOwner && fromSuperpoeName) {
      return { owner: fromSuperpoeOwner, name: fromSuperpoeName }
    }

    const repoUrl = typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url
    if (repoUrl) {
      // Supports:
      // - https://github.com/owner/name.git
      // - git+https://github.com/owner/name.git
      // - git@github.com:owner/name.git
      // - github:owner/name
      const match = repoUrl.match(/(?:github\.com[/:]|github:)([^/]+)\/([^/#?]+?)(?:\.git)?$/i)
      if (match?.[1] && match?.[2]) {
        return { owner: match[1], name: match[2] }
      }
    }
  } catch {
    // Fall through to defaults when package metadata is unavailable.
  }

  return { owner: DEFAULT_REPO_OWNER, name: DEFAULT_REPO_NAME }
}

function getLatestYmlUrl(channel: UpdateChannel): string {
  const { owner, name } = resolveGithubRepo()
  const manifest = getLatestYmlFileName(process.platform)
  if (channel === 'dev') {
    return `${GITHUB_BASE}/${owner}/${name}/releases/download/dev/${manifest}`
  }
  return `${GITHUB_BASE}/${owner}/${name}/releases/latest/download/${manifest}`
}

function getAssetDownloadUrl(channel: UpdateChannel, fileName: string, version: string): string {
  const { owner, name } = resolveGithubRepo()
  if (channel === 'dev') {
    return `${GITHUB_BASE}/${owner}/${name}/releases/download/dev/${fileName}`
  }
  return `${GITHUB_BASE}/${owner}/${name}/releases/download/v${version}/${fileName}`
}

/**
 * Try fetching from the direct URL first; if it fails, retry through each proxy domain.
 * Proxy URL pattern: {proxyDomain}/{originalUrl}
 */
async function fetchWithProxyFallback(originalUrl: string): Promise<string> {
  // Try direct first
  try {
    return await httpsFetch(originalUrl)
  } catch {
    // direct failed, try proxies
  }

  const proxies = getAllProxyDomains()
  let lastError: Error | undefined
  for (const proxy of proxies) {
    try {
      return await httpsFetch(toProxiedUrl(proxy, originalUrl))
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err))
    }
  }
  throw lastError ?? new Error(`Failed to fetch ${originalUrl} (no proxies configured)`)
}

/**
 * Try downloading from the direct URL first; if it fails, retry through each proxy domain.
 */
async function downloadWithProxyFallback(
  originalUrl: string,
  destPath: string,
  onProgress: (percent: number) => void,
): Promise<void> {
  // Try direct first
  try {
    await httpsDownload(originalUrl, destPath, onProgress)
    return
  } catch {
    // direct failed, try proxies
  }

  const proxies = getAllProxyDomains()
  let lastError: Error | undefined
  for (const proxy of proxies) {
    try {
      // Clean up partial file before retry
      if (existsSync(destPath)) {
        try { unlinkSync(destPath) } catch { /* ignore */ }
      }
      await httpsDownload(toProxiedUrl(proxy, originalUrl), destPath, onProgress)
      return
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err))
    }
  }
  throw lastError ?? new Error(`Failed to download ${originalUrl} (no proxies configured)`)
}

function httpsFetch(url: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const doRequest = (requestUrl: string, redirectCount: number) => {
      if (redirectCount > 5) {
        reject(new Error('Too many redirects'))
        return
      }
      const getter = requestUrl.startsWith('https://') ? httpsGet : httpGet
      getter(requestUrl, (res: IncomingMessage) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          doRequest(res.headers.location, redirectCount + 1)
          return
        }
        if (res.statusCode !== 200) {
          res.resume()
          reject(new Error(`HTTP ${res.statusCode}`))
          return
        }
        let data = ''
        res.setEncoding('utf8')
        res.on('data', (chunk: string) => { data += chunk })
        res.on('end', () => resolve(data))
        res.on('error', reject)
      }).on('error', reject)
    }
    doRequest(url, 0)
  })
}

function httpsDownload(url: string, destPath: string, onProgress: (percent: number) => void): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const doRequest = (requestUrl: string, redirectCount: number) => {
      if (redirectCount > 5) {
        reject(new Error('Too many redirects'))
        return
      }
      const getter = requestUrl.startsWith('https://') ? httpsGet : httpGet
      getter(requestUrl, (res: IncomingMessage) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          doRequest(res.headers.location, redirectCount + 1)
          return
        }
        if (res.statusCode !== 200) {
          res.resume()
          reject(new Error(`HTTP ${res.statusCode}`))
          return
        }
        const totalSize = parseInt(res.headers['content-length'] || '0', 10)
        let downloaded = 0
        const file = createWriteStream(destPath)
        res.on('data', (chunk: Buffer) => {
          downloaded += chunk.length
          if (totalSize > 0) onProgress(Math.round((downloaded / totalSize) * 100))
        })
        res.pipe(file)
        file.on('finish', () => { file.close(); resolve() })
        file.on('error', (err) => { file.close(); reject(err) })
        res.on('error', reject)
      }).on('error', reject)
    }
    doRequest(url, 0)
  })
}



let checkTimer: ReturnType<typeof setInterval> | undefined
let isDownloading = false

function sendToAllWindows(channel: string, ...args: unknown[]) {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(channel, ...args)
  }
}

async function checkForUpdate(updateChannel: UpdateChannel): Promise<UpdateCheckResult> {
  const currentVersion = app.getVersion()
  try {
    const url = getLatestYmlUrl(updateChannel)
    const raw = await fetchWithProxyFallback(url)
    const yml = parseLatestYml(raw)
    if (!yml) {
      return {
        status: 'error',
        channel: updateChannel,
        currentVersion,
        error: 'Failed to parse latest.yml',
      }
    }
    // release: only newer semver; dev: any different rolling build is an update
    const shouldUpdate = shouldOfferUpdate(updateChannel, yml.version, currentVersion)

    if (!shouldUpdate) {
      return {
        status: 'up-to-date',
        channel: updateChannel,
        currentVersion,
      }
    }

    const fileName = pickInstallerFileName(yml)
    const downloadUrl = getAssetDownloadUrl(updateChannel, fileName, yml.version)

    return {
      status: 'available',
      channel: updateChannel,
      currentVersion,
      update: {
        version: yml.version,
        currentVersion,
        channel: updateChannel,
        downloadUrl,
        fileName,
        releaseDate: yml.releaseDate || '',
      },
    }
  } catch (err) {
    return {
      status: 'error',
      channel: updateChannel,
      currentVersion,
      error: err instanceof Error ? err.message : 'Update check failed',
    }
  }
}

async function downloadAndInstall(info: UpdateInfo): Promise<void> {
  if (isDownloading) return
  isDownloading = true

  try {
    const tempDir = path.join(app.getPath('temp'), 'superpoe-update')
    if (!existsSync(tempDir)) mkdirSync(tempDir, { recursive: true })
    const destPath = path.join(tempDir, info.fileName)

    if (existsSync(destPath)) {
      try { unlinkSync(destPath) } catch { /* ignore */ }
    }

    sendToAllWindows('updater:download-progress', 0)

    await downloadWithProxyFallback(info.downloadUrl, destPath, (percent) => {
      sendToAllWindows('updater:download-progress', percent)
    })

    sendToAllWindows('updater:download-complete')

    if (process.platform === 'win32') {
      spawn(destPath, ['/S', '--force-run'], { detached: true, stdio: 'ignore' }).unref()
      setTimeout(() => app.quit(), 1000)
    } else if (process.platform === 'darwin') {
      await shell.openPath(destPath)
      setTimeout(() => app.quit(), 1000)
    } else {
      await shell.openPath(destPath)
    }
  } catch (err) {
    sendToAllWindows('updater:download-error', err instanceof Error ? err.message : 'Download failed')
  } finally {
    isDownloading = false
  }
}

export function setupAutoUpdater(getChannel: () => UpdateChannel, getIntervalMinutes: () => number): void {
  ipcMain.handle('updater:check', async (_event, channelOverride?: unknown) => {
    const channel = channelOverride === 'dev' || channelOverride === 'release'
      ? channelOverride
      : getChannel()
    return checkForUpdate(channel)
  })

  ipcMain.handle('updater:download', async (_event, info: UpdateInfo) => {
    await downloadAndInstall(info)
  })

  ipcMain.on('updater:restart-timer', () => {
    startTimer()
  })

  ipcMain.on('updater:set-proxy-domains', (_event, domains: string[]) => {
    if (Array.isArray(domains)) {
      setUserProxyDomains(domains)
    }
  })

  ipcMain.handle('updater:get-proxy-domains', () => {
    return { builtin: BUILTIN_PROXY_DOMAINS, user: getUserProxyDomains() }
  })

  const runCheck = async () => {
    const result = await checkForUpdate(getChannel())
    if (result.status === 'available' && result.update) {
      sendToAllWindows('updater:update-available', result.update)
    }
  }

  // Initial check after 10 seconds
  setTimeout(() => void runCheck(), 10_000)

  const startTimer = () => {
    clearInterval(checkTimer)
    const ms = getIntervalMinutes() * 60 * 1000
    checkTimer = setInterval(() => void runCheck(), ms)
  }
  startTimer()
}

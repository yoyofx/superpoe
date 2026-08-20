import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { appendFileSync, createWriteStream, mkdirSync, existsSync, unlinkSync, readFileSync } from 'node:fs'
import { get as httpsGet } from 'node:https'
import { get as httpGet, type IncomingMessage } from 'node:http'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { parseLatestYml, pickInstallerFileName, shouldOfferUpdate, getLatestYmlFileName, type LatestYml } from './updateVersion.js'

export type UpdateChannel = 'release' | 'dev'

// Built-in GitHub proxy domains
const BUILTIN_PROXY_DOMAINS: string[] = [
  'https://github.boki.moe',
  'https://gh-proxy.com',
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
  size?: number
  releaseDate: string
}

export interface UpdateInstallOptions {
  /** Use the installer's unattended/automatic mode when true. */
  forceInstall?: boolean
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
const DOWNLOAD_IDLE_TIMEOUT_MS = 15_000

function describeUrl(value: string): string {
  try {
    const url = new URL(value)
    return `${url.origin}${url.pathname}`
  } catch {
    return value.replace(/[?#].*$/, '')
  }
}

function updateLog(event: string, details: Record<string, unknown> = {}): void {
  const line = `${new Date().toISOString()} ${event} ${JSON.stringify(details)}\n`
  try {
    const directory = path.join(app.getPath('userData'), 'logs')
    mkdirSync(directory, { recursive: true })
    appendFileSync(path.join(directory, 'updater.log'), line, { encoding: 'utf8' })
  } catch {
    // Logging must never interrupt update checks or downloads.
  }
  console.info(`[Updater] ${event}`, details)
}

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
  const encodedFileName = encodeURIComponent(fileName)
  if (channel === 'dev') {
    return `${GITHUB_BASE}/${owner}/${name}/releases/download/dev/${encodedFileName}`
  }
  return `${GITHUB_BASE}/${owner}/${name}/releases/download/v${version}/${encodedFileName}`
}

/** Fetch through the configured proxy domains. Direct GitHub access is not
 * attempted because it is unavailable in the target network environment. */
async function fetchWithProxyFallback(originalUrl: string): Promise<string> {
  updateLog('manifest-fetch-start', { url: describeUrl(originalUrl), direct: false })
  const proxies = getAllProxyDomains()
  let lastError: Error | undefined
  for (const proxy of proxies) {
    try {
      const proxyUrl = toProxiedUrl(proxy, originalUrl)
      updateLog('manifest-fetch-attempt', { route: proxy, url: describeUrl(proxyUrl) })
      const result = await httpsFetch(proxyUrl)
      updateLog('manifest-fetch-success', { route: proxy, bytes: Buffer.byteLength(result, 'utf8') })
      return result
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err))
      updateLog('manifest-fetch-failed', { route: proxy, error: lastError.message })
    }
  }
  throw lastError ?? new Error(`Failed to fetch ${originalUrl} (no proxies configured)`)
}

/** Download through the configured proxy domains. Direct GitHub access is not
 * attempted because it is unavailable in the target network environment. */
async function downloadWithProxyFallback(
  originalUrl: string,
  destPath: string,
  onProgress: (percent: number) => void,
  expectedSize?: number,
): Promise<void> {
  updateLog('download-start', { route: 'proxy', url: describeUrl(originalUrl), expectedSize, direct: false })
  const proxies = getAllProxyDomains()
  let lastError: Error | undefined
  for (const proxy of proxies) {
    try {
      // Clean up partial file before retry
      if (existsSync(destPath)) {
        try { unlinkSync(destPath) } catch { /* ignore */ }
      }
      const proxyUrl = toProxiedUrl(proxy, originalUrl)
      updateLog('download-attempt', { route: proxy, url: describeUrl(proxyUrl), expectedSize })
      await httpsDownload(proxyUrl, destPath, onProgress, expectedSize)
      updateLog('download-success', { route: proxy, bytes: expectedSize })
      return
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err))
      updateLog('download-failed', { route: proxy, error: lastError.message })
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
          const nextUrl = new URL(res.headers.location, requestUrl).toString()
          updateLog('manifest-redirect', { from: describeUrl(requestUrl), to: describeUrl(nextUrl), status: res.statusCode })
          doRequest(nextUrl, redirectCount + 1)
          return
        }
        if (res.statusCode !== 200) {
          res.resume()
          updateLog('manifest-http-error', { url: describeUrl(requestUrl), status: res.statusCode })
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

function httpsDownload(url: string, destPath: string, onProgress: (percent: number) => void, expectedSize?: number): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const doRequest = (requestUrl: string, redirectCount: number) => {
      if (redirectCount > 5) {
        reject(new Error('Too many redirects'))
        return
      }
      const getter = requestUrl.startsWith('https://') ? httpsGet : httpGet
      let requestRef: ReturnType<typeof httpsGet> | undefined
      let idleTimer: ReturnType<typeof setTimeout> | undefined
      const clearIdleTimer = () => {
        if (idleTimer) clearTimeout(idleTimer)
        idleTimer = undefined
      }
      const armIdleTimer = () => {
        clearIdleTimer()
        idleTimer = setTimeout(() => {
          updateLog('download-idle-timeout', { url: describeUrl(requestUrl), timeoutMs: DOWNLOAD_IDLE_TIMEOUT_MS })
          requestRef?.destroy(new Error('Download stalled'))
        }, DOWNLOAD_IDLE_TIMEOUT_MS)
      }
      requestRef = getter(requestUrl, (res: IncomingMessage) => {
        armIdleTimer()
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          clearIdleTimer()
          const nextUrl = new URL(res.headers.location, requestUrl).toString()
          updateLog('download-redirect', { from: describeUrl(requestUrl), to: describeUrl(nextUrl), status: res.statusCode })
          doRequest(nextUrl, redirectCount + 1)
          return
        }
        if (res.statusCode !== 200) {
          clearIdleTimer()
          res.resume()
          updateLog('download-http-error', { url: describeUrl(requestUrl), status: res.statusCode })
          reject(new Error(`HTTP ${res.statusCode}`))
          return
        }
        const contentLength = parseInt(res.headers['content-length'] || '0', 10)
        const totalSize = contentLength > 0 ? contentLength : (expectedSize && expectedSize > 0 ? expectedSize : 0)
        let downloaded = 0
        const file = createWriteStream(destPath)
        res.on('data', (chunk: Buffer) => {
          armIdleTimer()
          downloaded += chunk.length
          if (totalSize > 0) onProgress(Math.round((downloaded / totalSize) * 100))
        })
        res.pipe(file)
        file.on('finish', () => {
          clearIdleTimer()
          file.close()
          updateLog('download-stream-finished', { url: describeUrl(requestUrl), downloaded, totalSize })
          resolve()
        })
        file.on('error', (err) => { clearIdleTimer(); file.close(); reject(err) })
        file.on('error', (err) => updateLog('download-file-error', { error: err.message }))
        res.on('error', (error) => {
          clearIdleTimer()
          updateLog('download-stream-error', { error: error instanceof Error ? error.message : String(error), downloaded })
          reject(error)
        })
      })
      armIdleTimer()
      requestRef.on('error', (error) => {
        clearIdleTimer()
        reject(error)
      })
    }
    doRequest(url, 0)
  })
}



let checkTimer: ReturnType<typeof setInterval> | undefined
let isDownloading = false
let updaterRendererReady = false
let pendingUpdate: UpdateInfo | null = null

function sendToAllWindows(channel: string, ...args: unknown[]) {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(channel, ...args)
  }
}

function flushPendingUpdate(): void {
  if (!updaterRendererReady || !pendingUpdate || BrowserWindow.getAllWindows().length === 0) return
  const update = pendingUpdate
  pendingUpdate = null
  updateLog('update-available-dispatched', { version: update.version, channel: update.channel })
  sendToAllWindows('updater:update-available', update)
}

async function checkForUpdate(updateChannel: UpdateChannel): Promise<UpdateCheckResult> {
  const currentVersion = app.getVersion()
  try {
    const url = getLatestYmlUrl(updateChannel)
    updateLog('check-start', { channel: updateChannel, currentVersion, url: describeUrl(url) })
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
    const file = yml.files.find((candidate) => candidate.url === fileName)
    updateLog('check-available', { channel: updateChannel, currentVersion, version: yml.version, fileName, size: file?.size, url: describeUrl(downloadUrl) })

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
        ...(file && Number.isFinite(file.size) && file.size > 0 ? { size: file.size } : {}),
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

async function downloadAndInstall(info: UpdateInfo, options: UpdateInstallOptions = {}): Promise<void> {
  if (isDownloading) return
  isDownloading = true

  try {
    const tempDir = path.join(app.getPath('temp'), 'superpoe-update')
    if (!existsSync(tempDir)) mkdirSync(tempDir, { recursive: true })
    // Some older electron-builder manifests used `-Setup`, while the
    // uploaded Windows installer uses `.Setup`. Try both names so an
    // otherwise valid update is not blocked by a stale/mismatched manifest.
    const fileNames: string[] = process.platform === 'win32' ? [] : [info.fileName]
    if (process.platform === 'win32') {
      const alternates = [
        info.fileName.replace(/-Setup\./i, '.Setup.'),
        info.fileName.replace(/-Setup-/i, '.Setup.'),
        info.fileName.replace(/\s+Setup\s+/i, '.Setup.'),
        info.fileName.replace(/\s+/g, '.'),
      ]
      for (const alternate of alternates) {
        if (alternate !== info.fileName && !fileNames.includes(alternate)) fileNames.push(alternate)
      }
      // Recent Windows releases use `.Setup.` in the uploaded asset name.
      // Try those normalized candidates before the stale manifest name.
      if (!fileNames.includes(info.fileName)) fileNames.push(info.fileName)
    }

    let destPath = ''
    let lastError: unknown
    for (const fileName of fileNames) {
      const candidatePath = path.join(tempDir, fileName)
      if (existsSync(candidatePath)) {
        try { unlinkSync(candidatePath) } catch { /* ignore */ }
      }
      sendToAllWindows('updater:download-progress', 0)
      const candidateUrl = fileName === info.fileName
        ? info.downloadUrl
        : getAssetDownloadUrl(info.channel, fileName, info.version)
      try {
        await downloadWithProxyFallback(candidateUrl, candidatePath, (percent) => {
          sendToAllWindows('updater:download-progress', percent)
        }, info.size)
        destPath = candidatePath
        break
      } catch (error) {
        lastError = error
      }
    }
    if (!destPath) throw lastError instanceof Error ? lastError : new Error('Update download failed')

    sendToAllWindows('updater:download-complete')

    if (process.platform === 'win32') {
      // Keep the default unattended update behavior, but let the user opt out
      // from the renderer and run the normal installer UI instead.
      const installerArgs = options?.forceInstall === false ? [] : ['/S', '--force-run']
      spawn(destPath, installerArgs, { detached: true, stdio: 'ignore', windowsHide: false }).unref()
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

  ipcMain.handle('updater:download', async (_event, info: UpdateInfo, options?: UpdateInstallOptions) => {
    await downloadAndInstall(info, options)
  })

  ipcMain.on('updater:restart-timer', () => {
    startTimer()
  })

  ipcMain.on('updater:renderer-ready', () => {
    updaterRendererReady = true
    updateLog('renderer-ready')
    flushPendingUpdate()
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
      pendingUpdate = result.update
      flushPendingUpdate()
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

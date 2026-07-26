import { app, BrowserWindow, dialog, ipcMain, Menu, net, protocol, shell } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseWeGameShareCode, requestPoe2dbBuild } from './poe2dbClient.js'
import { setupAutoUpdater } from './updater.js'
import type { UpdateChannel } from './updater.js'
import { PobLuaService } from './pobLuaService.js'

const currentDir = path.dirname(fileURLToPath(import.meta.url))
const preloadPath = path.join(currentDir, 'preload.js')
const rendererUrl = process.env.ELECTRON_RENDERER_URL
const packageMetadata = JSON.parse(readFileSync(path.join(app.getAppPath(), 'package.json'), 'utf8')) as {
  name?: string
  build?: { productName?: string }
}
const productName = packageMetadata.build?.productName || packageMetadata.name

if (!productName) throw new Error('package.json must define build.productName or name')

interface GameBuildFilePayload {
  content: string
  fileName: string
}

function validateGameBuildPayload(value: unknown): GameBuildFilePayload {
  if (!value || typeof value !== 'object') throw new Error('Invalid game build payload')
  const payload = value as Partial<GameBuildFilePayload>
  if (typeof payload.content !== 'string' || !payload.content || payload.content.length > 5_000_000) {
    throw new Error('Invalid game build content')
  }
  const parsed = JSON.parse(payload.content) as { name?: unknown }
  if (!parsed || typeof parsed !== 'object' || typeof parsed.name !== 'string') {
    throw new Error('Game build must contain a name')
  }
  const baseName = path.basename(typeof payload.fileName === 'string' ? payload.fileName : 'SuperPoE2 Build.build')
  const safeName = baseName.replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ').trim() || 'SuperPoE2 Build.build'
  return { content: payload.content, fileName: safeName.toLowerCase().endsWith('.build') ? safeName : `${safeName}.build` }
}

function getGameBuildPlannerDirectory(): string {
  if (process.platform === 'linux') {
    const steamOsPath = path.join(
      app.getPath('home'),
      '.local', 'share', 'Steam', 'steamapps', 'compatdata', '2315204395', 'pfx',
      'drive_c', 'users', 'steamuser', 'Documents', 'My Games', 'Path of Exile 2', 'BuildPlanner',
    )
    if (existsSync(path.dirname(steamOsPath))) return steamOsPath
  }
  return path.join(app.getPath('documents'), 'My Games', 'Path of Exile 2', 'BuildPlanner')
}

function writeGameBuildFile(filePath: string, content: string): void {
  mkdirSync(path.dirname(filePath), { recursive: true })
  writeFileSync(filePath, content, 'utf8')
}

const appDataPath = app.getPath('appData')
const userDataPath = path.join(appDataPath, productName)
app.setPath('userData', userDataPath)
app.setName(productName)

// Register before app ready so absolute paths like `/data/...` resolve under the
// packaged renderer root instead of the filesystem drive root (file:///D:/data/...).
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
])

function getRendererRoot(): string {
  return path.join(app.getAppPath(), 'dist')
}

/**
 * Map an app:// request to a path under dist/.
 * Supports both:
 * - app://localhost/assets/foo.png  (preferred, host = localhost)
 * - app://assets/foo.png            (host-as-path; Chromium sometimes forms this for /assets under custom schemes)
 */
function resolveAppPathname(requestUrl: string): string {
  const url = new URL(requestUrl)
  let pathname = decodeURIComponent(url.pathname || '/')
  const host = url.hostname
  if (host && host !== 'localhost' && host !== '127.0.0.1') {
    pathname = `/${host}${pathname === '/' ? '' : pathname}`
  }
  if (!pathname || pathname === '/') return '/index.html'
  return pathname
}

function registerAppProtocol(): void {
  const rendererRoot = path.normalize(getRendererRoot())
  const rootWithSep = rendererRoot.endsWith(path.sep) ? rendererRoot : rendererRoot + path.sep

  protocol.handle('app', async (request) => {
    try {
      const pathname = resolveAppPathname(request.url)
      const relativePath = pathname.replace(/^\/+/, '')
      const filePath = path.normalize(path.join(rendererRoot, relativePath))
      if (filePath !== rendererRoot && !filePath.startsWith(rootWithSep)) {
        return new Response('Forbidden', { status: 403 })
      }
      const response = await net.fetch(pathToFileURL(filePath).toString())
      if (!response.ok) {
        return new Response(`Not found: ${pathname}`, { status: 404 })
      }
      return response
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return new Response(message, { status: 500 })
    }
  })
}

function createWindow(): BrowserWindow {
  const iconPath = rendererUrl
    ? path.join(app.getAppPath(), 'build', 'icon.png')
    : path.join(process.resourcesPath, 'icon.png')
  const window = new BrowserWindow({
    title: productName,
    icon: iconPath,
    autoHideMenuBar: true,
    width: 1440,
    height: 960,
    minWidth: 1024,
    minHeight: 720,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  if (rendererUrl) {
    // Dev: Vite serves absolute `/data` paths correctly over http://
    void window.loadURL(rendererUrl)
  } else {
    // Packaged: custom scheme so root-absolute asset URLs work.
    void window.loadURL('app://localhost/index.html')
  }
  return window
}

let updateChannel: UpdateChannel = 'release'
let updateCheckIntervalMinutes = 60
const pobLuaService = new PobLuaService()

app.whenReady().then(() => {
  Menu.setApplicationMenu(null)

  if (!rendererUrl) {
    registerAppProtocol()
  }

  ipcMain.handle('pob2:import-wegame', async (_event, url: unknown) => {
    const shareCode = parseWeGameShareCode(url)
    return requestPoe2dbBuild(shareCode)
  })

  ipcMain.handle('pob2:lua-init', () => pobLuaService.initialize())
  ipcMain.handle('pob2:lua-calculate', (_event, value: unknown) => {
    if (!value || typeof value !== 'object' || typeof (value as { xml?: unknown }).xml !== 'string') {
      throw new Error('Invalid PoB Lua calculation payload')
    }
    const xml = (value as { xml: string }).xml
    if (!xml || xml.length > 10_000_000) throw new Error('Invalid PoB build XML')
    return pobLuaService.calculate({ xml })
  })

  ipcMain.handle('pob2:save-game-build', async (_event, value: unknown) => {
    const payload = validateGameBuildPayload(value)
    const result = await dialog.showSaveDialog({
      title: '保存游戏规划器文件',
      defaultPath: path.join(getGameBuildPlannerDirectory(), payload.fileName),
      filters: [{ name: 'Path of Exile 2 Build Planner', extensions: ['build'] }],
      properties: ['createDirectory', 'showOverwriteConfirmation'],
    })
    if (result.canceled || !result.filePath) return { canceled: true }
    writeGameBuildFile(result.filePath, payload.content)
    return { canceled: false, filePath: result.filePath }
  })

  ipcMain.handle('pob2:install-game-build', async (_event, value: unknown) => {
    const payload = validateGameBuildPayload(value)
    const filePath = path.join(getGameBuildPlannerDirectory(), payload.fileName)
    writeGameBuildFile(filePath, payload.content)
    return { canceled: false, filePath }
  })

  ipcMain.on('updater:set-config', (_event, config: { channel?: UpdateChannel; intervalMinutes?: number }) => {
    if (config.channel) updateChannel = config.channel
    if (config.intervalMinutes && config.intervalMinutes >= 10) updateCheckIntervalMinutes = config.intervalMinutes
  })

  setupAutoUpdater(
    () => updateChannel,
    () => updateCheckIntervalMinutes,
  )

  // Warm the native engine without delaying the first window. Missing native
  // resources are expected in browser-only development and use Wasmoon.
  void pobLuaService.initialize()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => pobLuaService.dispose())

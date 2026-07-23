import { app, BrowserWindow, ipcMain, net, protocol, shell } from 'electron'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseWeGameShareCode, requestPoe2dbBuild } from './poe2dbClient.js'
import { setupAutoUpdater } from './updater.js'
import type { UpdateChannel } from './updater.js'

const currentDir = path.dirname(fileURLToPath(import.meta.url))
const preloadPath = path.join(currentDir, 'preload.js')
const rendererUrl = process.env.ELECTRON_RENDERER_URL
const packageMetadata = JSON.parse(readFileSync(path.join(app.getAppPath(), 'package.json'), 'utf8')) as {
  name?: string
  build?: { productName?: string }
}
const productName = packageMetadata.build?.productName || packageMetadata.name

if (!productName) throw new Error('package.json must define build.productName or name')

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
  const window = new BrowserWindow({
    title: productName,
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

app.whenReady().then(() => {
  if (!rendererUrl) {
    registerAppProtocol()
  }

  ipcMain.handle('pob2:import-wegame', async (_event, url: unknown) => {
    const shareCode = parseWeGameShareCode(url)
    return requestPoe2dbBuild(shareCode)
  })

  ipcMain.on('updater:set-config', (_event, config: { channel?: UpdateChannel; intervalMinutes?: number }) => {
    if (config.channel) updateChannel = config.channel
    if (config.intervalMinutes && config.intervalMinutes >= 10) updateCheckIntervalMinutes = config.intervalMinutes
  })

  setupAutoUpdater(
    () => updateChannel,
    () => updateCheckIntervalMinutes,
  )

  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

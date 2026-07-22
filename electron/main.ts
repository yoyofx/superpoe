import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseWeGameShareCode, requestPoe2dbBuild } from './poe2dbClient.js'

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
    void window.loadURL(rendererUrl)
  } else {
    void window.loadFile(path.join(app.getAppPath(), 'dist', 'index.html'))
  }
  return window
}

app.whenReady().then(() => {
  ipcMain.handle('pob2:import-wegame', async (_event, url: unknown) => {
    const shareCode = parseWeGameShareCode(url)
    return requestPoe2dbBuild(shareCode)
  })

  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

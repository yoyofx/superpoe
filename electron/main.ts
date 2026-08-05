import { app, BrowserWindow, dialog, ipcMain, Menu, net, powerMonitor, protocol, screen, shell, type IpcMainEvent, type IpcMainInvokeEvent, type Rectangle } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { execFile } from 'node:child_process'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { parseWeGameShareCode, requestPoe2dbBuild } from './poe2dbClient.js'
import { requestPoeNinjaBuild } from './poeNinjaClient.js'
import { setupAutoUpdater } from './updater.js'
import type { UpdateChannel } from './updater.js'
import { PobLuaService } from './pobLuaService.js'
import { MarketViewManager, type MarketNavigationCommand, type MarketRealm } from './marketView.js'
import { TradeCredentialStore } from './tradeCredentialStore.js'
import { EquipmentLibraryRepository, equipmentSourceKey, pobSourceKey } from './equipmentLibraryRepository.js'
import { normalizeMarketListing } from './marketListing.js'
import type {
  EquipmentLibraryFilter, EquipmentLibraryFolderInput, EquipmentLibraryFolderPatch, EquipmentLibraryItemInput,
  EquipmentLibraryMetadataPatch, EquipmentTradeSearchRequest, LibraryItemSnapshot, LibraryTreeScope, MarketDomListingRef, MarketMonitorSettings, MonitorTaskPriority,
  MonitorTaskStatus, SavedMarketSearchInput, SavedMarketSearchPatch,
} from '../src/types/market.js'
import { OfficialTradeProvider, TradeReferenceDataCache } from './tradeService.js'
import { GameWindowService } from './gameWindowService.js'
import { MarketMonitoringCoordinator } from './marketMonitoring.js'
import { OpportunityOverlayController } from './opportunityOverlay.js'
import { CurrencyMarketService } from './currencyMarket/currencyMarketService.js'

const currentDir = path.dirname(fileURLToPath(import.meta.url))
const preloadPath = path.join(currentDir, 'preload.js')
const rendererUrl = process.env.ELECTRON_RENDERER_URL
const packageMetadata = JSON.parse(readFileSync(path.join(app.getAppPath(), 'package.json'), 'utf8')) as {
  name?: string
  build?: { productName?: string; appId?: string }
}
const productName = packageMetadata.build?.productName || packageMetadata.name
const appUserModelId = packageMetadata.build?.appId || 'com.yoyofx.superpoe'
const SUPERPOE_BUILD_EXTENSION = '.spoe'
const SUPERPOE_BUILD_FILE_CLASS = 'SuperPoE Build'
const MAX_SUPERPOE_BUILD_FILE_SIZE = 10_000_000
const execFileAsync = promisify(execFile)

if (!productName) throw new Error('package.json must define build.productName or name')

interface GameBuildFilePayload {
  content: string
  fileName: string
}

interface NativeBuildFilePayload {
  content: string
  fileName: string
}

interface NativeBuildOpenResult {
  canceled: boolean
  filePath?: string
  content?: string
  error?: string
}

function validateNativeBuildFilePayload(value: unknown): NativeBuildFilePayload {
  if (!value || typeof value !== 'object') throw new Error('Invalid SuperPoE build payload')
  const payload = value as Partial<NativeBuildFilePayload>
  if (typeof payload.content !== 'string' || !payload.content || Buffer.byteLength(payload.content, 'utf8') > MAX_SUPERPOE_BUILD_FILE_SIZE) {
    throw new Error('Invalid SuperPoE build content')
  }
  const parsed = JSON.parse(payload.content) as { format?: unknown; schemaVersion?: unknown }
  if (!parsed || parsed.format !== 'superpoe-build' || parsed.schemaVersion !== 1) {
    throw new Error('Invalid SuperPoE build format')
  }
  const baseName = path.basename(typeof payload.fileName === 'string' ? payload.fileName : 'SuperPoE Build.spoe')
  const safeName = baseName.replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ').trim() || 'SuperPoE Build.spoe'
  return {
    content: payload.content,
    fileName: safeName.toLowerCase().endsWith(SUPERPOE_BUILD_EXTENSION) ? safeName : `${safeName}${SUPERPOE_BUILD_EXTENSION}`,
  }
}

function readNativeBuildFile(filePath: string): NativeBuildOpenResult {
  const resolvedPath = path.resolve(filePath)
  if (path.extname(resolvedPath).toLowerCase() !== SUPERPOE_BUILD_EXTENSION) throw new Error('Only .spoe build files can be opened')
  const content = readFileSync(resolvedPath, 'utf8')
  if (!content || Buffer.byteLength(content, 'utf8') > MAX_SUPERPOE_BUILD_FILE_SIZE) throw new Error('Invalid SuperPoE build file size')
  return { canceled: false, filePath: resolvedPath, content }
}

async function readWindowsRegistryValue(key: string, valueName: string): Promise<string | null> {
  const regExe = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'reg.exe')
  try {
    const { stdout } = await execFileAsync(regExe, ['QUERY', key, '/v', valueName], { encoding: 'utf8', windowsHide: true })
    const escapedName = valueName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return stdout.match(new RegExp(`^\\s*${escapedName}\\s+REG_\\w+\\s+(.+?)\\s*$`, 'mi'))?.[1] ?? null
  } catch {
    return null
  }
}

async function writeWindowsRegistryValue(key: string, valueName: string | null, data: string): Promise<void> {
  const regExe = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'reg.exe')
  const valueArgs = valueName === null ? ['/ve'] : ['/v', valueName]
  await execFileAsync(regExe, ['ADD', key, ...valueArgs, '/t', 'REG_SZ', '/d', data, '/f'], { windowsHide: true })
}

async function registerWindowsBuildFileAssociation(): Promise<{ registered: true; isDefault: boolean; settingsOpened: boolean }> {
  const classesRoot = 'HKCU\\Software\\Classes'
  const executablePath = process.execPath
  const launchArguments = app.isPackaged ? [] : [app.getAppPath()]
  const openCommand = [executablePath, ...launchArguments, '%1'].map((value) => `"${value.replace(/"/g, '\\"')}"`).join(' ')
  const fileClassKey = `${classesRoot}\\${SUPERPOE_BUILD_FILE_CLASS}`

  const entries: Array<[string, string | null, string]> = [
    [`${classesRoot}\\${SUPERPOE_BUILD_EXTENSION}`, null, SUPERPOE_BUILD_FILE_CLASS],
    [`${classesRoot}\\${SUPERPOE_BUILD_EXTENSION}\\OpenWithProgids`, SUPERPOE_BUILD_FILE_CLASS, ''],
    [fileClassKey, null, 'SuperPoE build file'],
    [`${fileClassKey}\\DefaultIcon`, null, `"${executablePath}",0`],
    [`${fileClassKey}\\shell`, null, 'open'],
    [`${fileClassKey}\\shell\\open`, null, `Open with ${productName}`],
    [`${fileClassKey}\\shell\\open\\command`, null, openCommand],
  ]
  for (const [key, valueName, data] of entries) await writeWindowsRegistryValue(key, valueName, data)

  const userChoice = await readWindowsRegistryValue(
    `HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\FileExts\\${SUPERPOE_BUILD_EXTENSION}\\UserChoice`,
    'ProgId',
  )
  const isDefault = !userChoice || userChoice.toLowerCase() === SUPERPOE_BUILD_FILE_CLASS.toLowerCase()
  if (!isDefault) await shell.openExternal('ms-settings:defaultapps')
  return { registered: true, isDefault, settingsOpened: !isDefault }
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
const userDataPath = rendererUrl && process.env.SUPERPOE_USER_DATA
  ? path.resolve(process.env.SUPERPOE_USER_DATA)
  : path.join(appDataPath, productName)
app.setPath('userData', userDataPath)
app.setName(productName)
if (process.platform === 'win32') app.setAppUserModelId(appUserModelId)

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

function getAppIconPath(): string {
  const iconName = process.platform === 'win32' ? 'icon.ico' : 'icon.png'
  return rendererUrl
    ? path.join(app.getAppPath(), 'build', iconName)
    : path.join(process.resourcesPath, iconName)
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

let mainWindow: BrowserWindow | null = null
let marketViewManager: MarketViewManager | null = null
let tradeProvider: OfficialTradeProvider | null = null
let gameWindowService: GameWindowService | null = null
let marketMonitoring: MarketMonitoringCoordinator | null = null
let opportunityOverlay: OpportunityOverlayController | null = null
let currencyMarketService: CurrencyMarketService | null = null
let defaultRealm: MarketRealm = 'global'
const pendingNativeBuildPaths: string[] = []
const tradeCredentialStore = new TradeCredentialStore(path.join(userDataPath, 'trade', 'credentials.v1.json'))
const equipmentLibrary = new EquipmentLibraryRepository(path.join(userDataPath, 'library', 'equipment-library.v1.json'))
const favoriteOperations = new Map<string, Promise<void>>()

function collectNativeBuildPaths(args: string[]): string[] {
  return args.filter((value) => path.extname(value).toLowerCase() === SUPERPOE_BUILD_EXTENSION)
}

function sendNativeBuildFile(filePath: string): void {
  if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isLoading()) {
    if (!pendingNativeBuildPaths.includes(filePath)) pendingNativeBuildPaths.push(filePath)
    return
  }
  let result: NativeBuildOpenResult
  try {
    result = readNativeBuildFile(filePath)
  } catch (reason) {
    result = {
      canceled: false,
      filePath,
      error: reason instanceof Error ? reason.message : String(reason),
    }
  }
  mainWindow.webContents.send('pob2:open-build-file', result)
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

function flushPendingNativeBuildFiles(): void {
  for (const filePath of pendingNativeBuildPaths.splice(0)) sendNativeBuildFile(filePath)
}

const hasSingleInstanceLock = app.requestSingleInstanceLock()
if (!hasSingleInstanceLock) {
  app.quit()
} else {
  for (const filePath of collectNativeBuildPaths(process.argv.slice(1))) pendingNativeBuildPaths.push(filePath)
  app.on('second-instance', (_event, argv) => {
    const files = collectNativeBuildPaths(argv)
    if (files.length) files.forEach(sendNativeBuildFile)
    else if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.show()
      mainWindow.focus()
    }
  })
  app.on('open-file', (event, filePath) => {
    event.preventDefault()
    sendNativeBuildFile(filePath)
  })
}

function notifyLibraryChanged(): void {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('market:library-changed')
}

function validateShortString(value: unknown, name: string, max = 256): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(`Invalid ${name}`)
  return value.trim()
}

function validateListingRef(value: unknown, senderRealm: MarketRealm): MarketDomListingRef {
  if (!value || typeof value !== 'object') throw new Error('Invalid market listing reference')
  const input = value as Partial<MarketDomListingRef>
  if (input.realm !== senderRealm) throw new Error('Market realm mismatch')
  const listingId = validateShortString(input.listingId, 'listing ID', 128)
  if (!/^[A-Za-z0-9_-]+$/.test(listingId)) throw new Error('Invalid listing ID')
  const queryId = input.queryId == null ? undefined : validateShortString(input.queryId, 'query ID', 128)
  if (queryId && !/^[A-Za-z0-9_-]+$/.test(queryId)) throw new Error('Invalid query ID')
  const sourceUrl = validateShortString(input.sourceUrl, 'market source URL', 2_048)
  const url = new URL(sourceUrl)
  const allowedHost = senderRealm === 'cn'
    ? url.hostname === 'poe.game.qq.com'
    : url.hostname === 'www.pathofexile.com' || url.hostname === 'pathofexile.com'
  if (url.protocol !== 'https:' || !allowedHost || !url.pathname.startsWith('/trade2')) {
    throw new Error('Invalid market source URL')
  }
  return { realm: senderRealm, listingId, queryId, sourceUrl: url.toString() }
}

function requireMarketSender(event: IpcMainEvent): MarketRealm {
  const realm = marketViewManager?.getRealmForSender(event.sender)
  if (!realm) throw new Error('Unauthorized market enhancement request')
  return realm
}

function requireMainWindowSender(event: IpcMainInvokeEvent): BrowserWindow {
  if (!mainWindow || mainWindow.isDestroyed() || event.sender !== mainWindow.webContents) {
    throw new Error('Unauthorized market request')
  }
  return mainWindow
}

function validateMarketBounds(event: IpcMainInvokeEvent, value: unknown): Rectangle {
  const window = requireMainWindowSender(event)
  if (!value || typeof value !== 'object') throw new Error('Invalid market bounds')
  const input = value as Partial<Rectangle>
  const values = [input.x, input.y, input.width, input.height]
  if (values.some((entry) => typeof entry !== 'number' || !Number.isFinite(entry))) {
    throw new Error('Invalid market bounds')
  }
  const zoom = event.sender.getZoomFactor()
  const bounds = {
    x: Math.round(input.x! * zoom),
    y: Math.round(input.y! * zoom),
    width: Math.round(input.width! * zoom),
    height: Math.round(input.height! * zoom),
  }
  const contentBounds = window.getContentBounds()
  if (bounds.x < 0 || bounds.y < 0 || bounds.width < 1 || bounds.height < 1
    || bounds.x + bounds.width > contentBounds.width + 2
    || bounds.y + bounds.height > contentBounds.height + 2) {
    throw new Error('Market bounds are outside the application window')
  }
  return bounds
}

function getMainWindowSize(): { width: number; height: number; minWidth: number; minHeight: number } {
  const workArea = screen.getPrimaryDisplay().workAreaSize
  const availableWidth = Math.max(1024, workArea.width - 48)
  const availableHeight = Math.max(680, workArea.height - 48)
  const minWidth = Math.min(1180, availableWidth)
  const minHeight = Math.min(760, availableHeight)

  // Work-area dimensions are DPI-aware. Classifying them instead of raw
  // physical pixels gives high-DPI displays the same usable visual density.
  const profile = workArea.width >= 3000
    ? { width: 2200, height: 1300 }
    : workArea.width >= 2200
      ? { width: 1850, height: 1100 }
      : { width: 1600, height: 900 }

  return {
    // Keep the profile inside the work area so it never opens behind the
    // taskbar or gets clipped on a smaller display.
    width: Math.max(minWidth, Math.min(profile.width, availableWidth)),
    height: Math.max(minHeight, Math.min(profile.height, availableHeight)),
    minWidth,
    minHeight,
  }
}

function createWindow(): BrowserWindow {
  const windowSize = getMainWindowSize()
  const window = new BrowserWindow({
    title: productName,
    icon: getAppIconPath(),
    autoHideMenuBar: true,
    width: windowSize.width,
    height: windowSize.height,
    minWidth: windowSize.minWidth,
    minHeight: windowSize.minHeight,
    center: true,
    backgroundColor: '#090b0c',
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
  window.webContents.once('did-finish-load', flushPendingNativeBuildFiles)
  mainWindow = window
  marketViewManager?.dispose()
  marketViewManager = new MarketViewManager(window, (state) => {
    if (!window.isDestroyed()) window.webContents.send('market:state-changed', state)
  }, tradeCredentialStore)
  tradeProvider = new OfficialTradeProvider(marketViewManager, new TradeReferenceDataCache(path.join(userDataPath, 'trade', 'reference')))
  currencyMarketService = new CurrencyMarketService(
    path.join(userDataPath, 'currency-market'),
    (input, init) => net.fetch(input, init),
    (state) => { if (!window.isDestroyed()) window.webContents.send('currency-market:changed', state) },
  )
  opportunityOverlay = new OpportunityOverlayController(window, {
    skip: (id) => marketMonitoring?.skipOpportunity(id),
    pause: (targetId) => { marketMonitoring?.setTarget(targetId, 'paused') },
    complete: (targetId) => { marketMonitoring?.setTarget(targetId, 'completed') },
    attempt: async (id) => marketMonitoring ? marketMonitoring.attemptOpportunity(id) : 'error',
    searchName: (targetId) => marketMonitoring?.snapshot().purchaseTargets.find((target) => target.id === targetId)?.name,
  })
  marketMonitoring = new MarketMonitoringCoordinator(
    marketViewManager,
    equipmentLibrary,
    path.join(userDataPath, 'market', 'opportunities.v1.json'),
    {
      changed: (snapshot) => {
        if (!window.isDestroyed()) window.webContents.send('market:monitoring-changed', snapshot)
        opportunityOverlay?.updateSnapshot(snapshot)
      },
      actionable: (opportunities) => opportunityOverlay?.actionable(opportunities),
    },
  )
  gameWindowService = new GameWindowService()
  gameWindowService.on('changed', (state) => marketMonitoring?.setGameState(state))
  marketMonitoring.setGameState(gameWindowService.getState())
  marketMonitoring.start()
  gameWindowService.start()
  marketViewManager.setRealm(defaultRealm)
  window.on('closed', () => {
    gameWindowService?.stop()
    gameWindowService = null
    marketMonitoring?.dispose()
    marketMonitoring = null
    opportunityOverlay?.dispose()
    opportunityOverlay = null
    marketViewManager?.dispose()
    marketViewManager = null
    tradeProvider = null
    currencyMarketService = null
    if (mainWindow === window) mainWindow = null
  })
  return window
}

let updateChannel: UpdateChannel = 'release'
let updateCheckIntervalMinutes = 60
const pobLuaService = new PobLuaService()

if (hasSingleInstanceLock) void app.whenReady().then(() => {
  Menu.setApplicationMenu(null)
  powerMonitor.on('resume', () => marketMonitoring?.refreshTargets())

  const iconPath = getAppIconPath()
  if (process.platform === 'darwin' && existsSync(iconPath)) {
    app.dock?.setIcon(iconPath)
  }

  if (!rendererUrl) {
    registerAppProtocol()
  }

  ipcMain.handle('pob2:import-wegame', async (_event, url: unknown) => {
    const shareCode = parseWeGameShareCode(url)
    return requestPoe2dbBuild(shareCode)
  })
  ipcMain.handle('pob2:import-poe-ninja', async (_event, url: unknown) => requestPoeNinjaBuild(url))
  ipcMain.handle('pob2:open-build-file', async (event) => {
    const window = requireMainWindowSender(event)
    const result = await dialog.showOpenDialog(window, {
      title: '打开 SuperPoE 构筑',
      filters: [{ name: 'SuperPoE Build', extensions: ['spoe'] }],
      properties: ['openFile'],
    })
    if (result.canceled || !result.filePaths[0]) return { canceled: true }
    return readNativeBuildFile(result.filePaths[0])
  })
  ipcMain.handle('pob2:save-build-file-copy', async (event, value: unknown) => {
    const window = requireMainWindowSender(event)
    const payload = validateNativeBuildFilePayload(value)
    const result = await dialog.showSaveDialog(window, {
      title: '保存 SuperPoE 构筑副本',
      defaultPath: path.join(app.getPath('documents'), payload.fileName),
      filters: [{ name: 'SuperPoE Build', extensions: ['spoe'] }],
      properties: ['createDirectory', 'showOverwriteConfirmation'],
    })
    if (result.canceled || !result.filePath) return { canceled: true }
    const filePath = result.filePath.toLowerCase().endsWith(SUPERPOE_BUILD_EXTENSION)
      ? result.filePath
      : `${result.filePath}${SUPERPOE_BUILD_EXTENSION}`
    writeFileSync(filePath, payload.content, 'utf8')
    return { canceled: false, filePath }
  })
  ipcMain.handle('pob2:register-build-file-association', async (event) => {
    requireMainWindowSender(event)
    if (process.platform !== 'win32') return { registered: false, isDefault: false, settingsOpened: false, reason: 'unsupported-platform' }
    return registerWindowsBuildFileAssociation()
  })
  ipcMain.handle('pob2:set-ui-scale', (event, value: unknown) => {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0.8 || value > 1.5) {
      throw new Error('Invalid UI scale factor')
    }
    event.sender.setZoomFactor(value)
    return event.sender.getZoomFactor()
  })
  ipcMain.handle('pob2:set-app-context', (event, value: unknown) => {
    requireMainWindowSender(event)
    if (!value || typeof value !== 'object') throw new Error('Invalid application context')
    const realm = (value as { defaultRealm?: unknown }).defaultRealm
    if (realm !== 'cn' && realm !== 'global') throw new Error('Invalid default realm')
    defaultRealm = realm
    marketViewManager?.setRealm(realm)
  })
  ipcMain.handle('market:activate', (event, value: unknown) => {
    const bounds = validateMarketBounds(event, value)
    if (!marketViewManager) throw new Error('Market browser is unavailable')
    marketViewManager.activate(bounds)
    return marketViewManager.getState()
  })
  ipcMain.handle('market:deactivate', (event) => {
    requireMainWindowSender(event)
    marketViewManager?.deactivate()
  })
  ipcMain.handle('market:set-bounds', (event, value: unknown) => {
    const bounds = validateMarketBounds(event, value)
    marketViewManager?.setBounds(bounds)
  })
  ipcMain.handle('market:navigate', (event, value: unknown) => {
    requireMainWindowSender(event)
    if (!['back', 'forward', 'reload', 'stop', 'home'].includes(String(value))) {
      throw new Error('Invalid market navigation command')
    }
    marketViewManager?.navigate(value as MarketNavigationCommand)
  })
  ipcMain.handle('market:login', (event) => {
    requireMainWindowSender(event)
    marketViewManager?.login()
  })
  ipcMain.handle('market:open-external', (event) => {
    requireMainWindowSender(event)
    marketViewManager?.openCurrentExternal()
  })
  ipcMain.handle('market:get-state', (event) => {
    requireMainWindowSender(event)
    if (!marketViewManager) throw new Error('Market browser is unavailable')
    return marketViewManager.getState()
  })
  ipcMain.handle('currency-market:get', (event, value: unknown) => {
    requireMainWindowSender(event)
    if (value != null && typeof value !== 'boolean') throw new Error('Invalid currency market refresh flag')
    if (!currencyMarketService) throw new Error('通货行情服务不可用')
    return currencyMarketService.get(defaultRealm, value === true)
  })

  ipcMain.on('market-monitor:ready', (event) => {
    const realm = marketViewManager?.getRealmForSender(event.sender)
    if (!realm) return
    if (rendererUrl) console.info(`[Market monitor] preload ready realm=${realm}`)
    marketMonitoring?.handlePreloadReady(realm)
  })
  ipcMain.on('market-monitor:state', (event, value: unknown) => {
    const realm = marketViewManager?.getRealmForSender(event.sender)
    if (!realm) return
    if (rendererUrl && value && typeof value === 'object') {
      const state = value as { searchId?: unknown; connectionStatus?: unknown; retryAttempt?: unknown; lastErrorCode?: unknown }
      console.info(`[Market monitor] state realm=${realm} search=${String(state.searchId || '')} status=${String(state.connectionStatus || '')} retry=${String(state.retryAttempt || 0)} error=${String(state.lastErrorCode || '')}`)
    }
    marketMonitoring?.handleRuntime(realm, value)
  })
  ipcMain.on('market-monitor:result', (event, value: unknown) => {
    const realm = marketViewManager?.getRealmForSender(event.sender)
    if (!realm) return
    if (rendererUrl && value && typeof value === 'object') {
      const result = value as { searchId?: unknown; listingIds?: unknown; resultTokens?: unknown }
      console.info(`[Market monitor] result realm=${realm} search=${String(result.searchId || '')} listings=${Array.isArray(result.listingIds) ? result.listingIds.length : 0} tokens=${Array.isArray(result.resultTokens) ? result.resultTokens.length : 0}`)
    }
    marketMonitoring?.handleLiveResult(realm, value)
  })
  ipcMain.on('market-monitor:frame', (event, value: unknown) => {
    const realm = marketViewManager?.getRealmForSender(event.sender)
    if (!realm) return
    if (!rendererUrl || !value || typeof value !== 'object') return
    const frame = value as { searchId?: unknown; keys?: unknown; auth?: unknown; count?: unknown; resultCount?: unknown; resultType?: unknown; resultLength?: unknown; resultKeys?: unknown; invalidCharacters?: unknown }
    const keys = Array.isArray(frame.keys) ? frame.keys.filter((key): key is string => typeof key === 'string').slice(0, 12).join(',') : ''
    const resultKeys = Array.isArray(frame.resultKeys) ? frame.resultKeys.filter((key): key is string => typeof key === 'string').slice(0, 12).join(',') : ''
    console.info(`[Market monitor] frame realm=${realm} search=${String(frame.searchId || '')} keys=${keys} auth=${frame.auth === true} count=${String(frame.count ?? '')} results=${String(frame.resultCount ?? '')} resultType=${String(frame.resultType ?? '')} resultLength=${String(frame.resultLength ?? '')} resultKeys=${resultKeys} invalidChars=${String(frame.invalidCharacters ?? '')}`)
  })
  ipcMain.on('market-opportunity:action', (event, value: unknown) => {
    if (!opportunityOverlay?.ownsWebContents(event.sender) || typeof value !== 'string'
      || !['select', 'next', 'skip', 'close', 'pause', 'complete', 'attempt', 'open-app'].includes(value.split(':')[0])) return
    opportunityOverlay.handleAction(value)
  })
  ipcMain.handle('market:get-monitoring', (event) => {
    requireMainWindowSender(event)
    if (!marketMonitoring) throw new Error('Market monitoring is unavailable')
    return marketMonitoring.snapshot()
  })
  ipcMain.handle('market:set-monitor-target', (event, value: unknown) => {
    requireMainWindowSender(event)
    if (!marketMonitoring || !value || typeof value !== 'object') throw new Error('Invalid monitoring target')
    const input = value as { searchId?: unknown; status?: unknown; priority?: unknown }
    const searchId = validateShortString(input.searchId, 'purchase target or saved search ID', 128)
    if (!['saved', 'armed', 'paused', 'completed'].includes(String(input.status))) throw new Error('Invalid monitoring target status')
    const priority = input.priority == null ? undefined : String(input.priority)
    if (priority && !['high', 'normal', 'low'].includes(priority)) throw new Error('Invalid monitoring priority')
    return marketMonitoring.setTarget(searchId, input.status as MonitorTaskStatus, priority as MonitorTaskPriority | undefined)
  })
  ipcMain.handle('market:create-monitor-target', (event, value: unknown) => {
    requireMainWindowSender(event)
    if (!marketMonitoring || !value || typeof value !== 'object') throw new Error('Invalid purchase target')
    const input = value as { searchId?: unknown; priority?: unknown }
    const searchId = validateShortString(input.searchId, 'saved search ID', 128)
    const priority = input.priority == null ? 'normal' : String(input.priority)
    if (!['high', 'normal', 'low'].includes(priority)) throw new Error('Invalid monitoring priority')
    return marketMonitoring.createTarget(searchId, priority as MonitorTaskPriority)
  })
  ipcMain.handle('market:delete-monitor-target', (event, value: unknown) => {
    requireMainWindowSender(event)
    if (!marketMonitoring) throw new Error('Market monitoring is unavailable')
    return marketMonitoring.deleteTarget(validateShortString(value, 'purchase target ID', 128))
  })
  ipcMain.handle('market:refresh-monitor-target', (event, value: unknown) => {
    requireMainWindowSender(event)
    if (!marketMonitoring) throw new Error('Market monitoring is unavailable')
    return marketMonitoring.refreshTargetFromSource(validateShortString(value, 'purchase target ID', 128))
  })
  ipcMain.handle('market:set-monitor-priority', (event, value: unknown) => {
    requireMainWindowSender(event)
    if (!marketMonitoring || !value || typeof value !== 'object') throw new Error('Invalid monitoring priority')
    const input = value as { searchId?: unknown; priority?: unknown }
    const searchId = validateShortString(input.searchId, 'purchase target ID', 128)
    if (!['high', 'normal', 'low'].includes(String(input.priority))) throw new Error('Invalid monitoring priority')
    return marketMonitoring.setPriority(searchId, input.priority as MonitorTaskPriority)
  })
  ipcMain.handle('market:set-monitor-paused', (event, value: unknown) => {
    requireMainWindowSender(event)
    if (!marketMonitoring || typeof value !== 'boolean') throw new Error('Invalid global monitoring state')
    marketMonitoring.setGlobalPaused(value)
    return marketMonitoring.snapshot()
  })
  ipcMain.handle('market:update-monitor-settings', (event, value: unknown) => {
    requireMainWindowSender(event)
    if (!marketMonitoring || !value || typeof value !== 'object') throw new Error('Invalid monitoring settings')
    marketMonitoring.updateSettings(value as Partial<MarketMonitorSettings>)
    return marketMonitoring.snapshot()
  })
  ipcMain.handle('market:preview-monitor-sound', (event) => {
    requireMainWindowSender(event)
    if (!marketMonitoring || !opportunityOverlay) throw new Error('Market monitoring is unavailable')
    const settings = marketMonitoring.snapshot().settings
    opportunityOverlay.previewSound(settings.soundVolume, settings.soundId)
  })
  ipcMain.handle('market:preview-opportunity-overlay', (event) => {
    requireMainWindowSender(event)
    if (!marketMonitoring || !opportunityOverlay) throw new Error('Market monitoring is unavailable')
    opportunityOverlay.previewWindow()
  })
  ipcMain.handle('market:attempt-opportunity', (event, value: unknown) => {
    requireMainWindowSender(event)
    if (!marketMonitoring) throw new Error('Market monitoring is unavailable')
    return marketMonitoring.attemptOpportunity(validateShortString(value, 'opportunity ID', 128))
  })

  ipcMain.on('market-enhancement:status-request', (event, value: unknown) => {
    try {
      const realm = requireMarketSender(event)
      const listingIds = value && typeof value === 'object' && Array.isArray((value as { listingIds?: unknown }).listingIds)
        ? (value as { listingIds: unknown[] }).listingIds
          .filter((id): id is string => typeof id === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(id))
          .slice(0, 250)
        : []
      event.sender.send('market-enhancement:status-result', { states: equipmentLibrary.marketStates(realm, listingIds) })
    } catch {
      // Ignore messages from stale or untrusted web contents.
    }
  })

  ipcMain.on('market-enhancement:favorite-toggle', (event, value: unknown) => {
    let listingId = ''
    try {
      const realm = requireMarketSender(event)
      const input = value && typeof value === 'object' ? value as { requestId?: unknown; ref?: unknown } : {}
      if (input.ref && typeof input.ref === 'object') {
        const candidateId = (input.ref as { listingId?: unknown }).listingId
        if (typeof candidateId === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(candidateId)) listingId = candidateId
      }
      const requestId = validateShortString(input.requestId, 'favorite request ID', 128)
      const ref = validateListingRef(input.ref, realm)
      listingId = ref.listingId
      const operationKey = `${realm}:${ref.listingId}`
      const previous = favoriteOperations.get(operationKey) || Promise.resolve()
      const operation = previous.catch(() => {}).then(async () => {
        const active = equipmentLibrary.marketStates(realm, [ref.listingId])[0]?.active === true
        if (active) {
          equipmentLibrary.removeSource(`market:${realm}:${ref.listingId}`)
          notifyLibraryChanged()
          if (!event.sender.isDestroyed()) event.sender.send('market-enhancement:favorite-result', { requestId, listingId: ref.listingId, active: false })
          return
        }
        if (!marketViewManager) throw new Error('Market browser is unavailable')
        const payload = await marketViewManager.fetchListing(ref)
        const normalized = normalizeMarketListing(payload, ref)
        equipmentLibrary.upsert(normalized.item, normalized.source)
        notifyLibraryChanged()
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('market:sidebar-request', 'items')
        if (!event.sender.isDestroyed()) event.sender.send('market-enhancement:favorite-result', { requestId, listingId: ref.listingId, active: true })
      }).catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error)
        if (!event.sender.isDestroyed()) event.sender.send('market-enhancement:favorite-result', { requestId, listingId: ref.listingId, active: false, error: message.slice(0, 300) })
      }).finally(() => {
        if (favoriteOperations.get(operationKey) === operation) favoriteOperations.delete(operationKey)
      })
      favoriteOperations.set(operationKey, operation)
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      if (!event.sender.isDestroyed() && listingId) {
        event.sender.send('market-enhancement:favorite-result', { listingId, active: false, error: message.slice(0, 300) })
      }
    }
  })

  ipcMain.handle('market:list-library', (event, value: unknown) => {
    requireMainWindowSender(event)
    const input = value && typeof value === 'object' ? value as Partial<EquipmentLibraryFilter> : {}
    const filter: EquipmentLibraryFilter = {}
    if (input.realm === 'cn' || input.realm === 'global') filter.realm = input.realm
    if (typeof input.query === 'string') filter.query = input.query.slice(0, 200)
    if (typeof input.includeArchived === 'boolean') filter.includeArchived = input.includeArchived
    if (['all', 'market-favorite', 'pob-import', 'equipment-favorite', 'price-check', 'manual'].includes(String(input.sourceKind))) {
      filter.sourceKind = input.sourceKind
    }
    return equipmentLibrary.list(filter)
  })
  ipcMain.handle('market:get-sidebar', (event) => {
    requireMainWindowSender(event)
    return equipmentLibrary.sidebarSnapshot()
  })
  ipcMain.handle('market:create-folder', (event, value: unknown) => {
    requireMainWindowSender(event)
    if (!value || typeof value !== 'object') throw new Error('Invalid folder request')
    const input = value as Partial<EquipmentLibraryFolderInput>
    if (input.scope !== 'items' && input.scope !== 'searches') throw new Error('Invalid folder scope')
    const folder = equipmentLibrary.createFolder({
      scope: input.scope,
      name: validateShortString(input.name, 'folder name', 120),
      ...(typeof input.parentId === 'string' ? { parentId: validateShortString(input.parentId, 'parent folder ID', 128) } : {}),
    })
    notifyLibraryChanged()
    return folder
  })
  ipcMain.handle('market:update-folder', (event, value: unknown) => {
    requireMainWindowSender(event)
    if (!value || typeof value !== 'object') throw new Error('Invalid folder update')
    const input = value as Partial<EquipmentLibraryFolderPatch>
    const patch: EquipmentLibraryFolderPatch = { id: validateShortString(input.id, 'folder ID', 128) }
    if ('name' in input) patch.name = validateShortString(input.name, 'folder name', 120)
    if ('parentId' in input) patch.parentId = input.parentId == null ? null : validateShortString(input.parentId, 'parent folder ID', 128)
    if ('beforeId' in input) patch.beforeId = input.beforeId == null ? null : validateShortString(input.beforeId, 'sibling folder ID', 128)
    if (typeof input.expanded === 'boolean') patch.expanded = input.expanded
    const folder = equipmentLibrary.updateFolder(patch)
    notifyLibraryChanged()
    return folder
  })
  ipcMain.handle('market:delete-folder', (event, value: unknown) => {
    requireMainWindowSender(event)
    const deleted = equipmentLibrary.deleteFolder(validateShortString(value, 'folder ID', 128))
    if (deleted) notifyLibraryChanged()
    return deleted
  })
  ipcMain.handle('market:select-folder', (event, value: unknown) => {
    requireMainWindowSender(event)
    if (!value || typeof value !== 'object') throw new Error('Invalid folder selection')
    const input = value as { scope?: unknown; folderId?: unknown }
    if (input.scope !== 'items' && input.scope !== 'searches') throw new Error('Invalid folder scope')
    const folderId = input.folderId == null ? undefined : validateShortString(input.folderId, 'folder ID', 128)
    const snapshot = equipmentLibrary.selectFolder(input.scope as LibraryTreeScope, folderId)
    notifyLibraryChanged()
    return snapshot
  })
  ipcMain.handle('market:save-search', (event, value: unknown) => {
    requireMainWindowSender(event)
    if (!value || typeof value !== 'object') throw new Error('Invalid saved search')
    const input = value as Partial<SavedMarketSearchInput>
    const reference = marketViewManager?.getCurrentSearch()
    if (!reference) throw new Error('The current page is not a valid official trade search')
    const search = equipmentLibrary.saveSearch({
      ...reference,
      name: validateShortString(input.name, 'search name', 160),
      ...(typeof input.note === 'string' && input.note.trim() ? { note: input.note.slice(0, 4_000) } : {}),
      ...(typeof input.folderId === 'string' ? { folderId: validateShortString(input.folderId, 'folder ID', 128) } : {}),
    })
    notifyLibraryChanged()
    return search
  })
  ipcMain.handle('market:replace-search-current', (event, value: unknown) => {
    requireMainWindowSender(event)
    const id = validateShortString(value, 'saved search ID', 128)
    const current = marketViewManager?.getCurrentSearch()
    if (!current) throw new Error('The current page is not a valid official trade search')
    const existing = equipmentLibrary.getSearch(id)
    if (!existing) throw new Error('Saved search not found')
    const search = equipmentLibrary.replaceSearchReference(id, { ...current, name: existing.name, note: existing.note, folderId: existing.folderId })
    marketMonitoring?.refreshTargets()
    notifyLibraryChanged()
    return search
  })
  ipcMain.handle('market:recover-search', async (event, value: unknown) => {
    requireMainWindowSender(event)
    const id = validateShortString(value, 'saved search ID', 128)
    const existing = equipmentLibrary.getSearch(id)
    if (!existing || !existing.querySnapshot || !tradeProvider) throw new Error('This saved search cannot be recovered automatically')
    const recreated = await tradeProvider.recreateSearch(existing.realm, existing.leagueId, existing.querySnapshot.body)
    const current = marketViewManager?.getCurrentSearch()
    const reference = current?.searchCode === recreated.searchId && current.realm === existing.realm
      ? current
      : {
          realm: existing.realm,
          leagueId: existing.leagueId,
          searchCode: recreated.searchId,
          canonicalUrl: recreated.url,
          captureSource: existing.querySnapshot.source,
          querySnapshot: existing.querySnapshot,
        } as const
    const search = equipmentLibrary.replaceSearchReference(id, { ...reference, name: existing.name, note: existing.note, folderId: existing.folderId })
    marketMonitoring?.refreshTargets()
    notifyLibraryChanged()
    return search
  })
  ipcMain.handle('market:update-search', (event, value: unknown) => {
    requireMainWindowSender(event)
    if (!value || typeof value !== 'object') throw new Error('Invalid saved search update')
    const input = value as Partial<SavedMarketSearchPatch>
    const patch: SavedMarketSearchPatch = { id: validateShortString(input.id, 'saved search ID', 128) }
    if ('name' in input) patch.name = validateShortString(input.name, 'search name', 160)
    if ('note' in input) patch.note = typeof input.note === 'string' ? input.note.slice(0, 4_000) : ''
    if ('folderId' in input) patch.folderId = input.folderId == null ? null : validateShortString(input.folderId, 'folder ID', 128)
    if ('beforeId' in input) patch.beforeId = input.beforeId == null ? null : validateShortString(input.beforeId, 'saved search sort target', 128)
    const search = equipmentLibrary.updateSearch(patch)
    notifyLibraryChanged()
    return search
  })
  ipcMain.handle('market:delete-search', (event, value: unknown) => {
    requireMainWindowSender(event)
    const deleted = equipmentLibrary.deleteSearch(validateShortString(value, 'saved search ID', 128))
    if (deleted) {
      marketMonitoring?.refreshTargets()
      notifyLibraryChanged()
    }
    return deleted
  })
  ipcMain.handle('market:open-search', (event, value: unknown) => {
    requireMainWindowSender(event)
    const search = equipmentLibrary.getSearch(validateShortString(value, 'saved search ID', 128))
    if (!search || !marketViewManager) throw new Error('Saved search not found')
    if (search.validity === 'invalid') throw new Error('This saved search is invalid and must be updated')
    marketViewManager.openSource(search.realm, search.canonicalUrl)
  })
  ipcMain.handle('market:visit-hideout', async (event, value: unknown) => {
    requireMainWindowSender(event)
    const entry = equipmentLibrary.get(validateShortString(value, 'library entry ID', 128))
    const source = entry?.sources.find((candidate) => candidate.kind === 'market-favorite')
    if (!source || !marketViewManager) throw new Error('Market listing source not found')
    return marketViewManager.visitHideout({
      realm: source.realm, listingId: source.listingId, queryId: source.queryId, sourceUrl: source.sourceUrl,
    })
  })
  ipcMain.handle('market:update-library', (event, value: unknown) => {
    requireMainWindowSender(event)
    if (!value || typeof value !== 'object') throw new Error('Invalid equipment library metadata')
    const input = value as Partial<EquipmentLibraryMetadataPatch>
    const patch: EquipmentLibraryMetadataPatch = { id: validateShortString(input.id, 'library entry ID', 128) }
    if ('folderId' in input) patch.folderId = input.folderId == null ? null : validateShortString(input.folderId, 'folder ID', 128)
    if ('folder' in input) patch.folder = typeof input.folder === 'string' ? input.folder.slice(0, 120) : ''
    if ('note' in input) patch.note = typeof input.note === 'string' ? input.note.slice(0, 4_000) : ''
    if ('tags' in input) patch.tags = Array.isArray(input.tags)
      ? input.tags.filter((tag): tag is string => typeof tag === 'string').slice(0, 32).map((tag) => tag.slice(0, 64))
      : []
    if (typeof input.archived === 'boolean') patch.archived = input.archived
    const entry = equipmentLibrary.updateMetadata(patch)
    notifyLibraryChanged()
    return entry
  })
  ipcMain.handle('market:delete-library', (event, value: unknown) => {
    requireMainWindowSender(event)
    const deleted = equipmentLibrary.delete(validateShortString(value, 'library entry ID', 128))
    if (deleted) notifyLibraryChanged()
    return deleted
  })
  ipcMain.handle('market:delete-libraries', (event, value: unknown) => {
    requireMainWindowSender(event)
    if (!Array.isArray(value) || value.length > 5_000) throw new Error('Invalid equipment library entry IDs')
    const ids = value.map((id) => validateShortString(id, 'library entry ID', 128))
    const deleted = equipmentLibrary.deleteMany(ids)
    if (deleted) notifyLibraryChanged()
    return deleted
  })
  ipcMain.handle('market:remove-library-source', (event, value: unknown) => {
    requireMainWindowSender(event)
    const result = equipmentLibrary.removeSource(validateShortString(value, 'library source key', 512))
    if (result.entry || result.removedEntryId) notifyLibraryChanged()
    return result
  })
  ipcMain.handle('market:open-library-source', (event, value: unknown) => {
    requireMainWindowSender(event)
    if (!value || typeof value !== 'object') throw new Error('Invalid library source request')
    const input = value as { entryId?: unknown; sourceKey?: unknown }
    const entry = equipmentLibrary.get(validateShortString(input.entryId, 'library entry ID', 128))
    const sourceKey = validateShortString(input.sourceKey, 'library source key', 512)
    const source = entry?.sources.find((candidate) => candidate.sourceKey === sourceKey)
    if (!source) throw new Error('Equipment library source not found')
    if (source.kind === 'market-favorite') {
      if (!marketViewManager) throw new Error('Market browser is unavailable')
      marketViewManager.openSource(source.realm, source.sourceUrl)
      return { kind: source.kind }
    }
    return { kind: source.kind }
  })
  ipcMain.handle('market:save-equipment-item', (event, value: unknown) => {
    requireMainWindowSender(event)
    if (!value || typeof value !== 'object' || JSON.stringify(value).length > 500_000) {
      throw new Error('Invalid equipment library item')
    }
    const input = value as EquipmentLibraryItemInput
    const now = new Date().toISOString()
    let source
    if (input.source?.kind === 'equipment-favorite') {
      const buildId = validateShortString(input.source.buildId, 'build ID', 128)
      const equipmentSetId = validateShortString(input.source.equipmentSetId, 'equipment set ID', 128)
      const itemId = validateShortString(input.source.itemId, 'item ID', 128)
      source = { ...input.source, buildId, equipmentSetId, itemId, sourceKey: equipmentSourceKey(buildId, equipmentSetId, itemId), capturedAt: now, updatedAt: now }
    } else if (input.source?.kind === 'pob-import') {
      const buildId = validateShortString(input.source.buildId, 'build ID', 128)
      const pobItemId = validateShortString(input.source.pobItemId, 'PoB item ID', 128)
      source = { ...input.source, buildId, pobItemId, sourceKey: pobSourceKey(buildId, pobItemId), capturedAt: now, updatedAt: now }
    } else if (input.source?.kind === 'manual') {
      source = { kind: 'manual' as const, sourceKey: `manual:${randomUUID()}`, capturedAt: now, updatedAt: now }
    } else {
      throw new Error('Invalid equipment library source')
    }
    const entry = equipmentLibrary.upsert(input.item, source)
    notifyLibraryChanged()
    return entry
  })
  ipcMain.handle('market:search-equipment', async (event, value: unknown) => {
    requireMainWindowSender(event)
    if (!value || typeof value !== 'object' || JSON.stringify(value).length > 500_000) {
      throw new Error('Invalid equipment search request')
    }
    const input = value as Partial<EquipmentTradeSearchRequest>
    if (input.realm !== 'cn' && input.realm !== 'global') throw new Error('Invalid market realm')
    if (!input.item || typeof input.item !== 'object') throw new Error('Invalid equipment item')
    const item = input.item as LibraryItemSnapshot
    if (typeof item.rarity !== 'string' || typeof item.name !== 'string' || typeof item.baseType !== 'string'
      || !Array.isArray(item.modifiers) || item.modifiers.length > 128) {
      throw new Error('Invalid equipment item')
    }
    if (!tradeProvider || !marketViewManager) throw new Error('Trade provider is unavailable')
    const requestedLeague = typeof input.leagueId === 'string' && input.leagueId.trim()
      ? validateShortString(input.leagueId, 'trade league', 128)
      : undefined
    const leagueId = requestedLeague || (await tradeProvider.leagues(input.realm))[0]?.id
    if (!leagueId) throw new Error('No active trade league is available')
    try {
      const result = await tradeProvider.search(input.realm, leagueId, item)
      marketViewManager.openSource(input.realm, result.url)
      const { resolvedItem: _resolvedItem, ...response } = result
      return response
    } catch (error) {
      console.error(`[Market search] equipment failed realm=${input.realm} league=${leagueId}`, error)
      throw error
    }
  })
  ipcMain.handle('market:search-library', async (event, value: unknown) => {
    requireMainWindowSender(event)
    if (!value || typeof value !== 'object') throw new Error('Invalid equipment library search request')
    const input = value as { entryId?: unknown; realm?: unknown; leagueId?: unknown }
    const realm = input.realm
    if (realm !== 'cn' && realm !== 'global') throw new Error('Invalid market realm')
    const entry = equipmentLibrary.get(validateShortString(input.entryId, 'library entry ID', 128))
    if (!entry) throw new Error('Equipment library entry not found')
    const leagueId = validateShortString(input.leagueId, 'trade league', 128)
    if (!tradeProvider || !marketViewManager) throw new Error('Trade provider is unavailable')
    try {
      const result = await tradeProvider.search(realm, leagueId, entry.item)
      equipmentLibrary.updateItem(entry.id, result.resolvedItem, { touchUpdatedAt: false })
      notifyLibraryChanged()
      marketViewManager.openSource(realm, result.url)
      const { resolvedItem: _resolvedItem, ...response } = result
      return response
    } catch (error) {
      console.error(`[Market search] library failed realm=${realm} league=${leagueId} entry=${entry.id}`, error)
      throw error
    }
  })
  ipcMain.handle('market:list-leagues', async (event, value: unknown) => {
    requireMainWindowSender(event)
    if (value !== 'cn' && value !== 'global') throw new Error('Invalid market realm')
    if (!tradeProvider) throw new Error('Trade provider is unavailable')
    return tradeProvider.leagues(value)
  })

  ipcMain.handle('pob2:lua-init', () => pobLuaService.initialize())
  ipcMain.handle('pob2:lua-calculate', (_event, value: unknown) => {
    if (!value || typeof value !== 'object' || typeof (value as { xml?: unknown }).xml !== 'string') {
      throw new Error('Invalid PoB Lua calculation payload')
    }
    const payload = value as {
      xml: string
      skillGroupId?: string
      calcMode?: 'UNBUFFED' | 'BUFFED' | 'COMBAT' | 'EFFECTIVE'
      activeSkillIndex?: number
      statSetIndex?: number
      actor?: 'auto' | 'player' | 'minion'
      minionSkillIndex?: number
      minionStatSetIndex?: number
    }
    const xml = payload.xml
    if (!xml || xml.length > 10_000_000) throw new Error('Invalid PoB build XML')
    if (payload.calcMode && !['UNBUFFED', 'BUFFED', 'COMBAT', 'EFFECTIVE'].includes(payload.calcMode)) {
      throw new Error('Invalid PoB calculation mode')
    }
    if (payload.actor && !['auto', 'player', 'minion'].includes(payload.actor)) {
      throw new Error('Invalid PoB calculation actor')
    }
    return pobLuaService.calculate(payload)
  })
  ipcMain.handle('pob2:lua-rank-skills', (_event, value: unknown) => {
    if (!value || typeof value !== 'object') throw new Error('Invalid PoB Lua skill ranking payload')
    const payload = value as { xml?: unknown; groupIds?: unknown; configOverrides?: unknown }
    if (typeof payload.xml !== 'string' || !payload.xml || payload.xml.length > 10_000_000) {
      throw new Error('Invalid PoB build XML')
    }
    if (!Array.isArray(payload.groupIds) || payload.groupIds.length > 100
      || payload.groupIds.some((id) => typeof id !== 'string' || !/^\d+$/.test(id))) {
      throw new Error('Invalid skill group IDs')
    }
    return pobLuaService.rankSkills(payload as {
      xml: string
      groupIds: string[]
      configOverrides?: Record<string, boolean | number | string>
    })
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

app.on('before-quit', () => {
  marketViewManager?.dispose()
  pobLuaService.dispose()
})

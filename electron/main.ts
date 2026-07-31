import { app, BrowserWindow, dialog, ipcMain, Menu, net, protocol, shell, type IpcMainEvent, type IpcMainInvokeEvent, type Rectangle } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseWeGameShareCode, requestPoe2dbBuild } from './poe2dbClient.js'
import { setupAutoUpdater } from './updater.js'
import type { UpdateChannel } from './updater.js'
import { PobLuaService } from './pobLuaService.js'
import { MarketViewManager, type MarketNavigationCommand, type MarketRealm } from './marketView.js'
import { TradeCredentialStore } from './tradeCredentialStore.js'
import { EquipmentLibraryRepository, equipmentSourceKey, pobSourceKey } from './equipmentLibraryRepository.js'
import { normalizeMarketListing } from './marketListing.js'
import type {
  EquipmentLibraryFilter, EquipmentLibraryFolderInput, EquipmentLibraryFolderPatch, EquipmentLibraryItemInput,
  EquipmentLibraryMetadataPatch, LibraryTreeScope, MarketDomListingRef, SavedMarketSearchInput, SavedMarketSearchPatch,
} from '../src/types/market.js'
import { OfficialTradeProvider, TradeReferenceDataCache } from './tradeService.js'

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
const userDataPath = rendererUrl && process.env.SUPERPOE_USER_DATA
  ? path.resolve(process.env.SUPERPOE_USER_DATA)
  : path.join(appDataPath, productName)
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

function getAppIconPath(): string {
  return rendererUrl
    ? path.join(app.getAppPath(), 'build', 'icon.png')
    : path.join(process.resourcesPath, 'icon.png')
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
let defaultRealm: MarketRealm = 'global'
const tradeCredentialStore = new TradeCredentialStore(path.join(userDataPath, 'trade', 'credentials.v1.json'))
const equipmentLibrary = new EquipmentLibraryRepository(path.join(userDataPath, 'library', 'equipment-library.v1.json'))
const favoriteOperations = new Map<string, Promise<void>>()

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

function validateOfficialMarketUrl(value: unknown, realm: MarketRealm): string {
  const sourceUrl = validateShortString(value, 'market URL', 2_048)
  const url = new URL(sourceUrl)
  const allowedHost = realm === 'cn'
    ? url.hostname === 'poe.game.qq.com'
    : url.hostname === 'www.pathofexile.com' || url.hostname === 'pathofexile.com'
  if (url.protocol !== 'https:' || !allowedHost || !url.pathname.startsWith('/trade2')) throw new Error('Invalid market URL')
  return url.toString()
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

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    title: productName,
    icon: getAppIconPath(),
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
  mainWindow = window
  marketViewManager?.dispose()
  marketViewManager = new MarketViewManager(window, (state) => {
    if (!window.isDestroyed()) window.webContents.send('market:state-changed', state)
  }, tradeCredentialStore)
  tradeProvider = new OfficialTradeProvider(marketViewManager, new TradeReferenceDataCache(path.join(userDataPath, 'trade', 'reference')))
  marketViewManager.setRealm(defaultRealm)
  window.on('closed', () => {
    marketViewManager?.dispose()
    marketViewManager = null
    tradeProvider = null
    if (mainWindow === window) mainWindow = null
  })
  return window
}

let updateChannel: UpdateChannel = 'release'
let updateCheckIntervalMinutes = 60
const pobLuaService = new PobLuaService()

app.whenReady().then(() => {
  Menu.setApplicationMenu(null)

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
    if (input.realm !== 'cn' && input.realm !== 'global') throw new Error('Invalid market realm')
    const search = equipmentLibrary.saveSearch({
      realm: input.realm,
      name: validateShortString(input.name, 'search name', 160),
      url: validateOfficialMarketUrl(input.url, input.realm),
      ...(typeof input.note === 'string' && input.note.trim() ? { note: input.note.slice(0, 4_000) } : {}),
      ...(typeof input.folderId === 'string' ? { folderId: validateShortString(input.folderId, 'folder ID', 128) } : {}),
    })
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
    const search = equipmentLibrary.updateSearch(patch)
    notifyLibraryChanged()
    return search
  })
  ipcMain.handle('market:delete-search', (event, value: unknown) => {
    requireMainWindowSender(event)
    const deleted = equipmentLibrary.deleteSearch(validateShortString(value, 'saved search ID', 128))
    if (deleted) notifyLibraryChanged()
    return deleted
  })
  ipcMain.handle('market:open-search', (event, value: unknown) => {
    requireMainWindowSender(event)
    const search = equipmentLibrary.getSearch(validateShortString(value, 'saved search ID', 128))
    if (!search || !marketViewManager) throw new Error('Saved search not found')
    marketViewManager.openSource(search.realm, search.url)
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
    const result = await tradeProvider.search(realm, leagueId, entry.item)
    equipmentLibrary.updateItem(entry.id, result.resolvedItem)
    notifyLibraryChanged()
    marketViewManager.openSource(realm, result.url)
    const { resolvedItem: _resolvedItem, ...response } = result
    return response
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

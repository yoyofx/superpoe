import { app, BrowserWindow, dialog, globalShortcut, ipcMain, Menu, net, powerMonitor, protocol, screen, shell, type IpcMainEvent, type IpcMainInvokeEvent, type Rectangle } from 'electron'
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
import { canonicalToLegacySnapshot, PobItemBridge } from './pobItemBridge.js'
import { detectItemRawLanguage, ItemTranslationIndex, type ItemRawLanguage } from './itemTranslationIndex.js'
import { ItemIconIndex } from './itemIconIndex.js'
import { MarketViewManager, type MarketNavigationCommand, type MarketRealm } from './marketView.js'
import { TradeCredentialStore } from './tradeCredentialStore.js'
import { EquipmentLibraryRepository, equipmentSourceKey, fingerprintLibraryItem, pobSourceKey } from './equipmentLibraryRepository.js'
import { normalizeMarketListing, type MarketStatTextResolution } from './marketListing.js'
import type {
  EquipmentCollectionRoot, EquipmentLibraryEntry, EquipmentLibraryFilter, EquipmentLibraryFolderInput, EquipmentLibraryFolderPatch, EquipmentLibraryItemInput,
  EquipmentLibraryMetadataPatch, EquipmentLibraryMoveInput, EquipmentLibrarySource, EquipmentTradeSearchRequest, LibraryTreeScope, MarketDomListingRef, MarketMonitorSettings, MonitorTaskPriority,
  MonitorTaskStatus, SavedMarketSearchInput, SavedMarketSearchPatch, TradePriceCheckCriteria, TradePriceCheckPrepareRequest,
  TradePriceCheckSearchRequest,
  PriceCheckOpenRequest, LibraryModifierGroup, LibraryItemSnapshot, TradeStatResolutionSnapshot,
} from '../src/types/market.js'
import { OfficialTradeProvider, TradeReferenceDataCache, type CatalogSnapshot } from './tradeService.js'
import { GameWindowService } from './gameWindowService.js'
import { MarketMonitoringCoordinator } from './marketMonitoring.js'
import { OpportunityOverlayController } from './opportunityOverlay.js'
import { CurrencyMarketService } from './currencyMarket/currencyMarketService.js'
import { desktopText, isUiLanguage, type UiLanguage } from './uiLocale.js'
import { PriceCheckCoordinator } from './priceCheck/PriceCheckCoordinator.js'
import { PriceCheckWindowManager } from './priceCheck/PriceCheckWindowManager.js'
import { EquipmentTryOnWindowManager } from './equipmentTryOnWindow.js'
import { GameClipboardService, processIsElevated } from './priceCheck/GameClipboardService.js'
import { applyXiletradeParseEvidence, parseXiletradeItemText, type CanonicalStatContext, type CanonicalStatMatch, type XiletradeItemParseResult } from './xiletradeItemParser.js'
import { XiletradeDataCatalog, XiletradeModifierMatcher } from './xiletradeDataCatalog.js'
import { MAX_SUPERPOE_BACKUP_FILE_SIZE, SUPERPOE_BACKUP_EXTENSION, type SuperPoeBackupMainData } from '../src/engine/superPoeBackup.js'
import type { EquipmentTryOnOpenRequest } from '../src/types/tryOn.js'

const currentDir = path.dirname(fileURLToPath(import.meta.url))
const preloadPath = path.join(currentDir, 'preload.js')
const equipmentTryOnPreloadPath = path.join(currentDir, 'equipmentTryOnPreload.cjs')
const priceCheckPreloadPath = path.join(currentDir, 'priceCheckPreload.cjs')
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

function validateBackupFilePayload(value: unknown): NativeBuildFilePayload {
  if (!value || typeof value !== 'object') throw new Error('Invalid SuperPoE backup payload')
  const payload = value as Partial<NativeBuildFilePayload>
  if (typeof payload.content !== 'string' || !payload.content || Buffer.byteLength(payload.content, 'utf8') > MAX_SUPERPOE_BACKUP_FILE_SIZE) {
    throw new Error('Invalid SuperPoE backup content')
  }
  const parsed = JSON.parse(payload.content) as { format?: unknown; schemaVersion?: unknown }
  if (!parsed || parsed.format !== 'superpoe-backup' || parsed.schemaVersion !== 1) {
    throw new Error('Invalid SuperPoE backup format')
  }
  const baseName = path.basename(typeof payload.fileName === 'string' ? payload.fileName : 'SuperPoE backup.spoe-backup')
  const safeName = baseName.replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ').trim() || 'SuperPoE backup.spoe-backup'
  return {
    content: payload.content,
    fileName: safeName.toLowerCase().endsWith(`.${SUPERPOE_BACKUP_EXTENSION}`) ? safeName : `${safeName}.${SUPERPOE_BACKUP_EXTENSION}`,
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
let priceCheckCoordinator: PriceCheckCoordinator | null = null
let priceCheckWindowManager: PriceCheckWindowManager | null = null
let equipmentTryOnWindowManager: EquipmentTryOnWindowManager | null = null
let priceCheckHotkey = ''
let defaultRealm: MarketRealm = 'global'
let uiLanguage: UiLanguage = 'en'
const pendingNativeBuildPaths: string[] = []
const tradeCredentialStore = new TradeCredentialStore(path.join(userDataPath, 'trade', 'credentials.v1.json'))
const equipmentLibrary = new EquipmentLibraryRepository(
  path.join(userDataPath, 'library', 'equipment-library.v2.json'),
  path.join(userDataPath, 'library', 'equipment-library.v1.json'),
)
const favoriteOperations = new Map<string, Promise<void>>()
const tryOnOperations = new Map<string, Promise<void>>()

function registerPriceCheckHotkey(enabled: boolean, requestedHotkey: string): { registered: boolean; error?: string } {
  if (priceCheckHotkey) globalShortcut.unregister(priceCheckHotkey)
  priceCheckHotkey = ''
  if (!enabled) return { registered: false }
  const accelerator = requestedHotkey.trim().replace(/^Ctrl\+/i, 'CommandOrControl+')
  if (!accelerator || accelerator.length > 64) return { registered: false, error: 'Invalid price check hotkey' }
  const registered = globalShortcut.register(accelerator, () => {
    void (async () => {
      try {
        if (!priceCheckCoordinator || !priceCheckWindowManager) throw new Error('Price checker is unavailable')
        const clipboardText = await new GameClipboardService(() => gameWindowService).copyItem()
        // All clipboard entry points use the vendored Xiletrade catalog. The
        // official service is contacted only after the query is constructed.
        const clipboardLanguage = detectItemRawLanguage(clipboardText)
        let canonicalizeStat: StatCanonicalizer | undefined
        if (clipboardLanguage === 'zh-rCN' || clipboardLanguage === 'zh-rTW' || clipboardLanguage === 'ko-KR') {
          await createMarketStatTextResolver('cn')
          const bundle = await createMarketStatCatalog(clipboardLanguage === 'zh-rCN' ? 'cn' : 'global').catch(() => undefined)
          if (bundle) canonicalizeStat = createStatCanonicalizer(clipboardLanguage, bundle)
        }
        await createMarketStatTextResolver(defaultRealm)
        const parsed = parseGameClipboardItem(clipboardText, { canonicalizeStat })
        priceCheckWindowManager.show()
        await priceCheckCoordinator.open({
          // Keep the original clipboard payload as the coordinator source.
          // prepare/search can then rebuild the same evidence-rich projection
          // instead of losing localized text and stat IDs after the first pass.
          source: { kind: 'raw', raw: clipboardText },
          ...(parsed.unresolved.length ? { captureWarnings: parsed.unresolved } : {}),
        })
      } catch (error) {
        priceCheckWindowManager?.show()
        priceCheckCoordinator?.reportError(error)
        console.error('[PriceCheck] game capture failed', error)
      }
    })()
  })
  if (!registered) return { registered: false, error: 'The hotkey is already in use by another application' }
  priceCheckHotkey = accelerator
  return { registered: true }
}

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

function quotePowerShellArgument(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

function validateCollectionRoot(value: unknown): EquipmentCollectionRoot {
  if (value !== 'market' && value !== 'build' && value !== 'custom') throw new Error('Invalid equipment collection root')
  return value
}

function validateOptionalNumber(value: unknown, name: string): number | undefined {
  if (value == null || value === '') return undefined
  if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > 1_000_000_000_000) throw new Error(`Invalid ${name}`)
  return value
}

function validatePriceCheckCriteria(value: unknown): TradePriceCheckCriteria {
  if (!value || typeof value !== 'object') throw new Error('Invalid price check criteria')
  const input = value as Partial<TradePriceCheckCriteria>
  if (!['securable', 'available', 'online', 'any'].includes(String(input.listedStatus))) throw new Error('Invalid listed status')
  if (typeof input.useBaseType !== 'boolean' || !Array.isArray(input.modifiers) || input.modifiers.length > 128) {
    throw new Error('Invalid price check criteria')
  }
  const modifiers = input.modifiers.map((candidate) => {
    if (!candidate || typeof candidate !== 'object') throw new Error('Invalid price check modifier')
    const id = validateShortString(candidate.id, 'price check modifier ID', 128)
    const min = validateOptionalNumber(candidate.min, 'modifier minimum')
    const max = validateOptionalNumber(candidate.max, 'modifier maximum')
    if (min != null && max != null && min > max) throw new Error('Modifier minimum cannot exceed maximum')
    return { id, ...(min == null ? {} : { min }), ...(max == null ? {} : { max }) }
  })
  if (new Set(modifiers.map((modifier) => modifier.id)).size !== modifiers.length) throw new Error('Duplicate price check modifier')
  const itemLevelMin = validateOptionalNumber(input.itemLevelMin, 'item level minimum')
  const itemLevelMax = validateOptionalNumber(input.itemLevelMax, 'item level maximum')
  if (itemLevelMin != null && itemLevelMax != null && itemLevelMin > itemLevelMax) throw new Error('Item level minimum cannot exceed maximum')
  return {
    listedStatus: input.listedStatus!,
    useBaseType: input.useBaseType,
    ...(itemLevelMin == null ? {} : { itemLevelMin }),
    ...(itemLevelMax == null ? {} : { itemLevelMax }),
    modifiers,
  }
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

function validateEquipmentTryOnOpenRequest(value: unknown): EquipmentTryOnOpenRequest {
  if (!value || typeof value !== 'object') throw new Error('Invalid equipment try-on request')
  let serializedSize = 0
  try { serializedSize = JSON.stringify(value).length } catch { throw new Error('Invalid equipment try-on request') }
  if (serializedSize > 12_000_000) throw new Error('Equipment try-on request is too large')
  const input = value as Partial<EquipmentTryOnOpenRequest>
  const entry = input.entry
  if (!entry || typeof entry !== 'object' || !entry.item || typeof entry.item.raw !== 'string' || !entry.item.raw || entry.item.raw.length > 200_000) {
    throw new Error('Invalid equipment try-on item')
  }
  if (!isUiLanguage(input.language)) throw new Error('Invalid equipment try-on language')
  if (input.context != null) {
    if (typeof input.context !== 'object' || typeof input.context.xml !== 'string' || !input.context.xml || input.context.xml.length > 10_000_000) {
      throw new Error('Invalid equipment try-on build XML')
    }
    if (typeof input.context.buildRevision !== 'number' || !Number.isFinite(input.context.buildRevision)) {
      throw new Error('Invalid equipment try-on build revision')
    }
    if (typeof input.context.activeItemSetId !== 'string' || !input.context.activeItemSetId || input.context.activeItemSetId.length > 128) {
      throw new Error('Invalid equipment try-on item set')
    }
    if (input.context.activeWeaponSet !== 1 && input.context.activeWeaponSet !== 2) {
      throw new Error('Invalid equipment try-on weapon set')
    }
  }
  return structuredClone({
    entry,
    context: input.context ?? null,
    language: input.language,
  }) as EquipmentTryOnOpenRequest
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
  tradeProvider = new OfficialTradeProvider(
    marketViewManager,
    new TradeReferenceDataCache(path.join(userDataPath, 'trade', 'reference')),
    async (realm) => (await createMarketStatCatalog(realm)).display,
    projectTradeItemForRealm,
  )
  priceCheckWindowManager = new PriceCheckWindowManager(
    priceCheckPreloadPath,
    rendererUrl,
    getAppIconPath(),
    path.join(userDataPath, 'price-check', 'window-bounds.json'),
    true,
    () => gameWindowService?.focusGame(),
  )
  equipmentTryOnWindowManager?.dispose()
  equipmentTryOnWindowManager = new EquipmentTryOnWindowManager(equipmentTryOnPreloadPath, rendererUrl, getAppIconPath())
  priceCheckCoordinator = new PriceCheckCoordinator({
    context: () => ({ realm: defaultRealm, language: uiLanguage }),
    prepare: async (realm, source) => {
      if (!tradeProvider) throw new Error('Trade provider is unavailable')
      const item = await priceCheckSnapshot({ realm, target: source })
      const prepared = await tradeProvider.prepare(realm, item)
      return { draft: prepared.draft, item: prepared.resolvedItem }
    },
    leagues: async (realm) => {
      if (!tradeProvider) throw new Error('Trade provider is unavailable')
      return tradeProvider.leagues(realm)
    },
    search: async (realm, item, leagueId, criteria) => {
      if (!tradeProvider) throw new Error('Trade provider is unavailable')
      const result = await tradeProvider.search(realm, leagueId, item, criteria)
      const { resolvedItem: _resolvedItem, ...response } = result
      return response
    },
    fetch: async (realm, ids, searchId) => {
      if (!marketViewManager) throw new Error('Trade provider is unavailable')
      return marketViewManager.fetchListings(realm, ids, searchId)
    },
    resolveListingStatText: async (realm, queryStatId) => {
      try {
        const resolver = await createMarketStatTextResolver(realm)
        return resolver(queryStatId)
      } catch {
        // Catalog enrichment is best-effort; listing results remain usable
        // when the reference endpoint is temporarily unavailable.
        return undefined
      }
    },
    resolveListingItemText: resolveMarketItemText,
    visitHideout: async (realm, listingId, searchId, sourceUrl) => {
      if (!marketViewManager) throw new Error('Trade provider is unavailable')
      return marketViewManager.visitHideout({ realm, listingId, queryId: searchId, sourceUrl })
    },
    changed: (state) => priceCheckWindowManager?.publish(state),
  })
  currencyMarketService = new CurrencyMarketService(
    path.join(userDataPath, 'currency-market'),
    (input, init) => net.fetch(input, init),
    (state) => { if (!window.isDestroyed()) window.webContents.send('currency-market:changed', state) },
    () => uiLanguage,
  )
  opportunityOverlay = new OpportunityOverlayController(window, {
    skip: (id) => marketMonitoring?.skipOpportunity(id),
    pause: (targetId) => { marketMonitoring?.setTarget(targetId, 'paused') },
    complete: (targetId) => { marketMonitoring?.setTarget(targetId, 'completed') },
    attempt: async (id) => marketMonitoring ? marketMonitoring.attemptOpportunity(id) : 'error',
    searchName: (targetId) => marketMonitoring?.snapshot().purchaseTargets.find((target) => target.id === targetId)?.name,
  })
  opportunityOverlay.setLanguage(uiLanguage)
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
      normalizeListing: async (payload, ref) => {
        let resolveStatText: (queryStatId: string) => MarketStatTextResolution | undefined = () => undefined
        try {
          resolveStatText = await createMarketStatTextResolver(ref.realm)
        } catch {
          // Raw official listing text remains usable when the reference catalog is unavailable.
        }
        return normalizeMarketListing(
          payload,
          ref,
          ref.realm === 'cn' ? (text) => itemTranslations.toEnglish(text) : undefined,
          ref.realm === 'cn' ? (text) => itemTranslations.statToEnglish(text) : undefined,
          resolveStatText,
        )
      },
    },
  )
  gameWindowService = new GameWindowService()
  gameWindowService.on('changed', (state) => marketMonitoring?.setGameState(state))
  marketMonitoring.setGameState(gameWindowService.getState())
  marketMonitoring.start()
  gameWindowService.start()
  marketViewManager.setRealm(defaultRealm)
  marketViewManager.setLanguage(uiLanguage)
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
    marketStatResolverPromises.clear()
    currencyMarketService = null
    priceCheckCoordinator = null
    priceCheckWindowManager?.dispose()
    priceCheckWindowManager = null
    equipmentTryOnWindowManager?.dispose()
    equipmentTryOnWindowManager = null
    if (mainWindow === window) mainWindow = null
  })
  return window
}

// Keep the main-process startup default aligned with the first-run settings.
// The renderer may synchronize a saved preference later, but the initial
// automatic check must not briefly fall back to the release feed.
let updateChannel: UpdateChannel = 'dev'
let updateCheckIntervalMinutes = 60
const pobLuaService = new PobLuaService()
const itemTranslations = new ItemTranslationIndex()
const itemTranslationIndexes = new Map<ItemRawLanguage, ItemTranslationIndex>([['zh-rCN', itemTranslations]])
const itemIcons = new ItemIconIndex()
let xiletradeDataCatalog: XiletradeDataCatalog | undefined
interface MarketStatCatalogBundle {
  display: CatalogSnapshot
  canonical: CatalogSnapshot
}

const marketStatCatalogPromises = new Map<MarketRealm, Promise<MarketStatCatalogBundle>>()
const marketStatResolverPromises = new Map<MarketRealm, Promise<(queryStatId: string) => MarketStatTextResolution | undefined>>()

function getItemTranslationIndex(language: ItemRawLanguage): ItemTranslationIndex {
  if (language === 'en') return itemTranslations
  const existing = itemTranslationIndexes.get(language)
  if (existing) return existing
  const root = path.join(
    app.getAppPath(),
    app.isPackaged ? 'dist' : 'public',
    'data',
    'Translate',
    language,
  )
  const index = new ItemTranslationIndex(root)
  itemTranslationIndexes.set(language, index)
  return index
}

function getXiletradeDataCatalog(): XiletradeDataCatalog {
  if (!xiletradeDataCatalog) {
    const root = path.join(app.getAppPath(), app.isPackaged ? 'dist' : 'public', 'data', 'xiletrade')
    xiletradeDataCatalog = new XiletradeDataCatalog(root)
  }
  return xiletradeDataCatalog
}

const pobItemBridge = new PobItemBridge(pobLuaService, getXiletradeDataCatalog())

/** Loads the display catalog and the canonical English catalog for a realm. */
async function createMarketStatCatalog(realm: MarketRealm): Promise<MarketStatCatalogBundle> {
  const existing = marketStatCatalogPromises.get(realm)
  if (existing) return existing
  const pending = (async () => {
    const source = getXiletradeDataCatalog()
    const display = source.get(realm === 'cn' ? 'zh-CN' : 'en-US')
    const canonical = source.get('en-US')
    const snapshot = (catalog: typeof display, targetRealm: MarketRealm): CatalogSnapshot => ({
      realm: targetRealm,
      fetchedAt: new Date(0).toISOString(),
      payloadHash: `xiletrade:${catalog.upstreamCommit}:${catalog.locale}`,
      entries: catalog.entries.map((entry) => ({
        ...entry,
        option: entry.option?.options?.length
          ? { options: entry.option.options.map((option) => ({ id: String(option.id), text: option.text })) }
          : undefined,
      })),
    })
    return { display: snapshot(display, realm), canonical: snapshot(canonical, 'global') }
  })()
  marketStatCatalogPromises.set(realm, pending)
  void pending.catch(() => { marketStatCatalogPromises.delete(realm) })
  return pending
}

/**
 * Builds a stat-ID lookup from the official catalogs. CN entries are kept for
 * display while the global catalog supplies PoB's canonical English text.
 * This keeps parameterized stats data-driven and avoids per-affix mappings.
 */
async function createMarketStatTextResolver(realm: MarketRealm): Promise<(queryStatId: string) => MarketStatTextResolution | undefined> {
  if (!tradeProvider) return () => undefined
  const existing = marketStatResolverPromises.get(realm)
  if (existing) return existing
  const pending = (async () => {
    const { display: displayCatalog, canonical: canonicalCatalog } = await createMarketStatCatalog(realm)
    const displayById = new Map(displayCatalog.entries.map((entry) => [entry.id, entry.text]))
    const canonicalById = new Map(canonicalCatalog.entries.map((entry) => [entry.id, entry.text]))
    if (realm === 'cn') {
      for (const [queryStatId, displayText] of displayById) {
        const canonicalText = canonicalById.get(queryStatId)
        if (canonicalText) itemTranslations.registerStatTranslation(displayText, canonicalText)
      }
    }
    return (queryStatId: string) => {
      const displayText = displayById.get(queryStatId)
      const canonicalText = canonicalById.get(queryStatId)
      return displayText || canonicalText ? { displayText, canonicalText } : undefined
    }
  })()
  marketStatResolverPromises.set(realm, pending)
  void pending.catch(() => { marketStatResolverPromises.delete(realm) })
  return pending
}

type StatCanonicalizer = (value: string, group?: LibraryModifierGroup, context?: CanonicalStatContext, nextLine?: string) => CanonicalStatMatch | undefined

function createStatCanonicalizer(
  language: ItemRawLanguage,
  _bundle?: MarketStatCatalogBundle,
): StatCanonicalizer {
  const locale = language === 'zh-rCN' ? 'zh-CN' : language === 'zh-rTW' ? 'zh-TW' : language === 'ko-KR' ? 'ko-KR' : 'en'
  const matcher = new XiletradeModifierMatcher(getXiletradeDataCatalog().bundle(locale))
  return (value, group = 'explicit', context = {}, nextLine = '') => matcher.match(value, group, context, nextLine)
}

function projectTradeItemForRealm(realm: MarketRealm, item: LibraryItemSnapshot, catalog: CatalogSnapshot): LibraryItemSnapshot {
  const locale = realm === 'cn' ? 'zh-CN' : 'en'
  const source = getXiletradeDataCatalog()
  const context = source.resolveItemContext(locale, item)
  const matcher = new XiletradeModifierMatcher(source.bundle(locale))
  const catalogHas = (id: string) => {
    const [baseId] = id.split('|')
    return catalog.entries.some((entry) => entry.id === id || entry.id === baseId)
  }
  return {
    ...structuredClone(item),
    itemClass: context.itemClass,
    tradeCategory: context.tradeCategory,
    modifiers: item.modifiers.map((modifier) => {
      const prior = modifier.tradeResolutions.find((candidate) => candidate.realm === realm)
      let candidateStatIds = [...new Set(modifier.tradeResolutions.flatMap((candidate) => (
        candidate.queryStatId ? [candidate.queryStatId] : candidate.candidateStatIds
      )).filter(catalogHas))]
      let resolvedBy: TradeStatResolutionSnapshot['resolvedBy'] = prior?.resolvedBy || 'exact-text'
      if (candidateStatIds.length !== 1) {
        const localized = realm === 'cn' ? modifier.localized?.['zh-CN']?.displayText : undefined
        const match = matcher.match(localized || modifier.original.displayText, modifier.group, context)
        const matchedIds = match?.queryStatId ? [match.queryStatId] : match?.candidateStatIds || []
        const validMatches = matchedIds.filter(catalogHas)
        if (validMatches.length) candidateStatIds = [...new Set(validMatches)]
        resolvedBy = 'exact-text'
      }
      const queryStatId = candidateStatIds.length === 1 ? candidateStatIds[0] : undefined
      const [baseStatId, optionId] = queryStatId?.split('|') || []
      const resolution: TradeStatResolutionSnapshot = {
        realm,
        queryStatId,
        baseStatId,
        optionId,
        candidateStatIds,
        source: modifier.sourceTags.find((tag) => ['enchant', 'rune', 'implicit', 'explicit', 'fractured', 'crafted', 'desecrated'].includes(tag)) as TradeStatResolutionSnapshot['source'] || 'unknown',
        valueMode: optionId ? 'fixed-option' : modifier.valueMode,
        valueTransform: prior?.valueTransform || 'identity',
        resolvedBy,
        catalogFetchedAt: catalog.fetchedAt,
        catalogPayloadHash: catalog.payloadHash,
        status: queryStatId ? 'resolved' : candidateStatIds.length ? 'ambiguous' : 'unresolved',
      }
      return {
        ...structuredClone(modifier),
        tradeResolutions: [...modifier.tradeResolutions.filter((candidate) => candidate.realm !== realm), resolution],
      }
    }),
  }
}

function resolveMarketItemText(realm: MarketRealm, value: string): { canonicalText?: string } {
  if (realm !== 'cn') return { canonicalText: value }
  return { canonicalText: itemTranslations.toEnglish(value) || itemTranslations.statToEnglish(value) || value }
}

interface GameClipboardParseResult {
  raw: string
  unresolved: string[]
  evidence?: XiletradeItemParseResult['evidence']
  localized?: XiletradeItemParseResult['localized']
}

interface GameClipboardParseOptions {
  /** Price checks may use the resolved subset; library imports must be complete. */
  strict?: boolean
  /** Optional official-catalog canonicalization for localized stat lines. */
  canonicalizeStat?: StatCanonicalizer
}

function usableLocalizedText(value: string | undefined): string | undefined {
  if (!value || /(?:\?{2,}|\uFFFD)/u.test(value)) return undefined
  return value
}

function translatePobRawForPriceCheck(value: string, canonicalizeStat?: StatCanonicalizer): GameClipboardParseResult {
  const normalized = value.replace(/\r\n/g, '\n').trim()
  const language = detectItemRawLanguage(normalized)
  if (language === 'en') return { raw: normalized, unresolved: [] }
  const translations = getItemTranslationIndex(language)
  const lines = normalized.split('\n').map((line) => line.trim()).filter(Boolean)
  const unresolved: string[] = []
  const output: string[] = []
  const metadata = /^(?:Rarity|Item Level|LevelReq|Quality|Sockets|Implicits|Unique ID|Corrupted|Twice Corrupted|Rune|Passive|Variant|备注|备注信息)\b/i
  for (const line of lines) {
    if (metadata.test(line) || /^\{[^}]+\}/u.test(line)) {
      const prefix = line.match(/^(?:\{[^}]+\})+/u)?.[0] || ''
      const body = line.slice(prefix.length)
      const group = /\{(?:rune)\}/i.test(prefix) ? 'rune' : /\{(?:enchant)\}/i.test(prefix) ? 'enchant' : /\{(?:implicit)\}/i.test(prefix) ? 'implicit' : 'explicit'
      const translated = canonicalizeStat?.(body, group)?.canonicalText || translations.statToEnglish(body)
      output.push(prefix + (translated || body))
      continue
    }
    const translatedName = translations.toEnglish(line)
    const translatedStat = canonicalizeStat?.(line, 'explicit')?.canonicalText || translations.statToEnglish(line)
    const translated = translatedStat || translatedName || (/^[\x20-\x7e]+$/.test(line) ? line : undefined)
    if (translated) output.push(translated)
    else unresolved.push(line)
  }
  return { raw: output.join('\n'), unresolved: [...new Set(unresolved)] }
}

function gameClipboardToPobRaw(value: string, options: GameClipboardParseOptions = {}): GameClipboardParseResult {
  const normalized = value.replace(/\r\n/g, '\n').trim()
  const language = detectItemRawLanguage(normalized)
  if (language === 'en') return { raw: normalized, unresolved: [] }
  const translations = getItemTranslationIndex(language)
  const sections = normalized.split(/^--------+$/m).map((section) => section.split('\n').map((line) => line.trim()).filter(Boolean)).filter((section) => section.length)
  if (sections.length < 2) throw new Error('Clipboard does not contain a supported Path of Exile 2 item')
  const firstSection = sections[0]
  const rarityIndex = firstSection.findIndex((line) => /^(?:Rarity|稀有度|희귀도)\s*[：:]/iu.test(line))
  // The game places the item name and base type before the first separator,
  // immediately after the rarity line. Older clipboard layouts may put them
  // in a separate section, so retain that fallback for compatibility.
  const header = rarityIndex >= 0 ? firstSection.slice(0, rarityIndex + 1) : firstSection
  const inlineNames = rarityIndex >= 0 ? firstSection.slice(rarityIndex + 1) : []
  // Depending on the client version, the game may put a warning such as
  // "You cannot use this item" in the header and move the name/base type to
  // the next section. Select the last two name-like lines rather than treating
  // that warning as the item name.
  const nameNoise = /^(?:You cannot use|你无法使用|您无法使用|你無法使用|사용할 수 없는|이 아이템을 사용할 수 없습니다)/iu
  const nameMetadata = /^(?:物品类别|物品類別|稀有度|Rarity|品质|品質|物理伤害|物理傷害|元素伤害|元素傷害|暴击率|暴擊率|每秒攻击次数|每秒攻擊次數|需求|插槽|物品等级|物品等級|Item Level|Sockets|Quality|품질|소켓|요구|아이템 레벨|물리 피해|원소 피해|치명타 확률|초당 공격 횟수)\s*[：:]/iu
  const nameCandidates = (lines: string[]) => lines.filter((line) => line && !nameNoise.test(line) && !nameMetadata.test(line))
  let names = nameCandidates(inlineNames).slice(-2)
  if (names.length < 2) {
    for (const section of sections.slice(1)) {
      const candidates = nameCandidates(section)
      if (candidates.length >= 2) {
        names = candidates.slice(-2)
        break
      }
    }
  }
  const field = (patterns: RegExp[]) => header.find((line) => patterns.some((pattern) => pattern.test(line)))?.split(/:\s*|：\s*/).slice(1).join(':').trim()
  const raritySource = field([/^Rarity\s*:/i, /^稀有度\s*[：:]/u, /^희귀도\s*[：:]/u]) || ''
  const rarity = /unique|傳奇|传奇|유니크|고유/i.test(raritySource) ? 'UNIQUE'
    : /rare|稀有|희귀/i.test(raritySource) ? 'RARE'
      : /magic|魔法|마법/i.test(raritySource) ? 'MAGIC' : 'NORMAL'
  const displayName = names[0] || ''
  const displayBaseType = names[1] || names[0] || ''
  const baseType = translations.toEnglish(displayBaseType) || (/^[\x20-\x7e]+$/.test(displayBaseType) ? displayBaseType : '')
  const name = translations.toEnglish(displayName) || (/^[\x20-\x7e]+$/.test(displayName) ? displayName : '')
  if (!baseType) throw new Error(`Unsupported item base language: ${displayBaseType}`)
  const itemLevelLine = sections.flat().find((line) => /^(?:Item Level|物品等级|物品等級|아이템 레벨)\s*[：:]/iu.test(line))
  const itemLevel = itemLevelLine?.match(/\d+/)?.[0]
  const itemLevelSection = sections.findIndex((section) => section.some((line) => line === itemLevelLine))
  // Jewel metadata is part of the game's clipboard format, but it appears in
  // the section before the item level. Keep it in the canonical PoB raw so
  // unique jewels retain their limit/radius behavior when saved manually.
  const metadataLines: string[] = []
  for (const line of sections.flat()) {
    const cleaned = line.replace(/\s*\((?:augmented|强化|強化)\)\s*$/iu, '').trim()
    const limited = cleaned.match(/^(?:Limited to|仅限|僅限)\s*[：:]\s*(\d+)(?:\s+Historic)?$/iu)
    if (limited) {
      metadataLines.push(`Limited to: ${limited[1]}${/\s+Historic$/iu.test(cleaned) ? ' Historic' : ''}`)
      continue
    }
    const radius = cleaned.match(/^(?:Radius|范围|範圍)\s*[：:]\s*(Variable|变量|變數|Very Small|极小|極小|Small|小型|Medium-Small|中小|中小型|Medium|中型|Large|大型|Very Large|极大|極大|Massive|巨大)$/iu)
    if (radius) {
      const value = radius[1].toLowerCase() === 'variable' || radius[1] === '变量' || radius[1] === '變數'
        ? 'Variable'
        : radius[1]
            .replace(/^极小$/u, 'Very Small')
            .replace(/^極小$/u, 'Very Small')
            .replace(/^小型$/u, 'Small')
            .replace(/^中小$/u, 'Medium-Small')
            .replace(/^中小型$/u, 'Medium-Small')
            .replace(/^中型$/u, 'Medium')
            .replace(/^大型$/u, 'Large')
            .replace(/^极大$/u, 'Very Large')
            .replace(/^極大$/u, 'Very Large')
            .replace(/^巨大$/u, 'Massive')
      metadataLines.push(`Radius: ${value}`)
    }
  }
  const qualityLine = sections.flat().find((line) => /^(?:Quality|品质|品質|품질)\s*[：:]/iu.test(line))
  const quality = qualityLine?.match(/([+-]?\d+(?:\.\d+)?)\s*%/u)?.[1]
  if (quality) metadataLines.push(`Quality: ${quality}`)
  const socketsLine = sections.flat().find((line) => /^(?:Sockets|插槽|소켓)\s*[：:]/iu.test(line))
  const socketText = socketsLine?.split(/[：:]/u).slice(1).join(':').match(/[SJ]/gi)?.join(' ')
  if (socketText) metadataLines.push(`Sockets: ${socketText}`)
  const requirementLine = sections.flat().find((line) => /^(?:需求|Requirements?|요구)\s*[：:]/iu.test(line))
  const levelRequirement = requirementLine?.match(/(?:等级|等級|Level)\s*(\d+)/iu)?.[1]
  if (levelRequirement) metadataLines.push(`LevelReq: ${levelRequirement}`)

  const modifierLines: Array<{ text: string; tags: string[]; implicit: boolean }> = []
  const unresolved: string[] = []
  const footerMarker = /^(?:Corrupted|Twice Corrupted|Sanctified|Sanctified Item|已腐化|已污染|被腐化|已腐化|双重腐化|圣化|圣化物品|Split|分裂|分裂之物|引路石掉落|Waystone Drop|타락|이중 타락|분열|웨이스톤 드롭)$/iu
  let footerMode = false
  let pendingMarkerTags = new Set<string>()
  for (const section of sections.slice(Math.max(2, itemLevelSection + 1))) {
    if (footerMode) continue
    if (section.some((line) => footerMarker.test(line))) {
      footerMode = true
      continue
    }
    const isFlavorSection = section.some((line) => /^(?:[“"]|'.*')/u.test(line))
      || section.every((line) => /[，。！？；、——…]$/u.test(line))
    // The client also copies interaction hints (for example how to remove a
    // cosmetic effect). They are presentation text, not item modifiers.
    const isInteractionHint = section.some((line) => /^(?:使用|放置到|右键点击|按住|Use|Place|Right[- ]click|Hold)\b/iu.test(line))
    if (isFlavorSection || isInteractionHint) continue
    const markerLine = section.find((line) => /^\{.*\}$/u.test(line)) || ''
    const markerTags = new Set<string>()
    if (/(?:基底属性|基底屬性|Base Properties|기본 속성)/iu.test(markerLine)) markerTags.add('implicit')
    if (/(?:强化|強化|강화)\s*\}?$/iu.test(markerLine) || /(?:腐化强化|腐化強化|타락 강화)/iu.test(markerLine)) markerTags.add('enchant')
    if (/(?:破碎的|碎裂的|Fractured|분열된)/iu.test(markerLine)) markerTags.add('fractured')
    if (/(?:打造的|製作的|Crafted|제작된)/iu.test(markerLine)) markerTags.add('crafted')
    if (/(?:亵渎的|褻瀆的|Desecrated|모독된)/iu.test(markerLine)) markerTags.add('desecrated')
    for (const tag of pendingMarkerTags) markerTags.add(tag)
    const markerOnly = markerLine !== '' && section.every((line) => /^\{.*\}$/u.test(line))
    if (markerOnly) {
      pendingMarkerTags = markerTags
      continue
    }
    pendingMarkerTags = new Set<string>()
    const implicit = markerTags.has('implicit')
    for (const sourceLine of section) {
      if (/^\{.*\}$/u.test(sourceLine) || footerMarker.test(sourceLine)) continue
      const rune = /\((?:rune|符文)\)$/i.test(sourceLine)
      const cleaned = sourceLine.replace(/\s*\((?:rune|符文)\)\s*$/i, '').replace(/^\{[^}]+\}/, '').trim()
      const statGroup: LibraryModifierGroup = rune
        ? 'rune'
        : markerTags.has('enchant') ? 'enchant'
          : markerTags.has('implicit') ? 'implicit'
            : 'explicit'
      const translated = options.canonicalizeStat?.(cleaned, statGroup)?.canonicalText
        || translations.statToEnglish(cleaned)
        || (/^[\x20-\x7e]+$/.test(cleaned) ? cleaned : undefined)
      if (translated && !/^(?:Requirements?|Sockets?|Quality|Physical Damage|Elemental Damage|Critical Hit Chance|Attacks per Second|Weapon Range|Armour|Evasion|Energy Shield|Ward|Spirit|Charm Slots|Requires)\s*:/i.test(translated)) {
        const tags = [...markerTags]
        if (rune) tags.push('rune')
        modifierLines.push({
          text: translated,
          tags: [...new Set(tags)],
          // Unique base properties and granted skills are implicit item data in
          // PoB, even when the game clipboard puts them in separate sections.
          implicit: !rune && (implicit || /^Grants Skill:/i.test(translated)),
        })
      } else if (!translated && cleaned && !/^[-—]+$/u.test(cleaned)) {
        unresolved.push(sourceLine)
      }
    }
  }
  const uniqueModifiers = [...new Map(modifierLines.map((modifier) => [`${modifier.tags.join(',')}:${modifier.text}`, modifier])).values()]
  const uniqueUnresolved = [...new Set(unresolved)]
  if (options.strict && uniqueUnresolved.length) {
    throw new Error(`Unsupported ${language} item lines: ${uniqueUnresolved.join(' | ')}`)
  }
  if (!uniqueModifiers.length && uniqueUnresolved.length) {
    const detail = ` Unsupported ${language} item lines: ${uniqueUnresolved.join(' | ')}`
    throw new Error(`No supported modifiers could be resolved from the game clipboard.${detail}`)
  }
  // Unknown localized lines are deliberately excluded from PoB raw. They are
  // retained as diagnostics so a partial query can still use all recognized
  // modifiers without silently submitting an unsafe approximation.
  if (uniqueUnresolved.length) console.warn(`[PriceCheck] Unsupported ${language} item lines: ${uniqueUnresolved.join(' | ')}`)
  // PoB counts rune/enchant/base-implicit lines in the implicit header. This
  // keeps corrupted enchants and rune effects in their native parser section.
  const implicitCount = uniqueModifiers.filter((modifier) => modifier.tags.includes('rune') || modifier.tags.includes('enchant') || modifier.implicit).length
  const raw = [`Rarity: ${rarity}`]
  if ((rarity === 'RARE' || rarity === 'UNIQUE') && name && name !== baseType) raw.push(name)
  raw.push(baseType)
  if (itemLevel) raw.push(`Item Level: ${itemLevel}`)
  raw.push(...[...new Set(metadataLines)])
  raw.push(`Implicits: ${implicitCount}`)
  raw.push(...uniqueModifiers.map((modifier) => {
    const tags = modifier.tags.filter((tag) => tag !== 'implicit')
    const prefix = `${modifier.implicit ? '{implicit}' : ''}${tags.map((tag) => `{${tag}}`).join('')}`
    return `${prefix}${modifier.text}`
  }))
  const footerLines = sections.flat()
  if (footerLines.some((line) => /^(?:Twice Corrupted|双重腐化|이중 타락)$/iu.test(line))) raw.push('Twice Corrupted')
  else if (footerLines.some((line) => /^(?:Corrupted|已腐化|已污染|被腐化|已腐化|타락)$/iu.test(line))) raw.push('Corrupted')
  return { raw: raw.join('\n'), unresolved: uniqueUnresolved }
}

function parseGameClipboardItem(value: string, options: GameClipboardParseOptions = {}): XiletradeItemParseResult {
  const language = detectItemRawLanguage(value)
  const translations = getItemTranslationIndex(language)
  const locale = language === 'zh-rCN' ? 'zh-CN'
    : language === 'zh-rTW' ? 'zh-TW'
      : language === 'ko-KR' ? 'ko-KR' : 'en'
  return parseXiletradeItemText(value, {
    strict: options.strict,
    language: {
      locale,
      toEnglish: (text) => translations.toEnglish(text),
      statToEnglish: (text) => translations.statToEnglish(text),
    },
    canonicalizeStat: options.canonicalizeStat
      ? (text, group, itemClass, nextLine) => options.canonicalizeStat?.(text, group, itemClass, nextLine)
      : createStatCanonicalizer(language),
    parsingRules: getXiletradeDataCatalog().get(locale).rules,
    upstreamCommit: getXiletradeDataCatalog().get(locale).upstreamCommit,
  })
}

function looksLikeGameClipboardItem(value: string): boolean {
  const normalized = value.replace(/\r\n?/g, '\n')
  return /^(?:物品类别|物品類別|Item Class|아이템 종류)\s*[：:]/m.test(normalized)
    && /^(?:稀有度|Rarity|희귀도)\s*[：:]/m.test(normalized)
}

async function priceCheckSnapshot(request: TradePriceCheckPrepareRequest) {
  const target = request.target
  if (!target || typeof target !== 'object') throw new Error('Invalid price check target')
  const sourceText = target.kind === 'raw' ? target.raw : target.kind === 'library' ? equipmentLibrary.get(target.entryId)?.item.raw : ''
  const sourceLanguage = sourceText ? detectItemRawLanguage(sourceText) : 'en'
  let canonicalizeStat: StatCanonicalizer | undefined
  if (sourceText && detectItemRawLanguage(sourceText) !== 'en') {
    await createMarketStatTextResolver('cn')
    await createMarketStatTextResolver(request.realm)
    const bundle = await createMarketStatCatalog(sourceLanguage === 'zh-rCN' ? 'cn' : 'global').catch(() => undefined)
    if (bundle) canonicalizeStat = createStatCanonicalizer(sourceLanguage, bundle)
  }
  const statResolver = await createMarketStatTextResolver(request.realm).catch(() => () => undefined)
  if (target.kind === 'library') {
    const entryId = validateShortString(target.entryId, 'library entry ID', 128)
    let entry = equipmentLibrary.get(entryId)
    if (!entry) throw new Error('Equipment library entry not found')
    if (!Array.isArray(entry.item.modifierSnapshots)) {
      const migrated = await pobItemBridge.normalize(entry.item.raw)
      migrated.view.iconUrl = entry.view.iconUrl
      migrated.view.localized = entry.view.localized
      migrated.view.modifiers.forEach((modifier, index) => {
        if (entry?.view.modifiers[index]?.localized) modifier.localized = entry.view.modifiers[index].localized
      })
      entry = equipmentLibrary.updateItem(entryId, migrated, { touchUpdatedAt: false })
    }
    // Library entries are already canonical snapshots. Re-running translation
    // and Lua after the one-time legacy migration could reorder or drop
    // multi-line evidence, so price checks project directly from persistence.
    return canonicalToLegacySnapshot({ item: entry.item, view: entry.view }, entry.view, request.realm)
  }
  if (target.kind !== 'raw' || typeof target.raw !== 'string' || !target.raw.trim() || target.raw.length > 100_000) {
    throw new Error('Invalid PoB item raw')
  }
  const parsedRaw = looksLikeGameClipboardItem(target.raw)
    ? parseGameClipboardItem(target.raw, { canonicalizeStat })
    : translatePobRawForPriceCheck(target.raw, canonicalizeStat)
  const normalized = await pobItemBridge.normalize(parsedRaw.raw)
  if (parsedRaw.evidence) normalized.item.parseEvidence = parsedRaw.evidence
  applyXiletradeParseEvidence(normalized.view, parsedRaw.evidence)
  const evidenceLocale = parsedRaw.evidence?.locale
  const name = parsedRaw.localized?.name || itemTranslations.toChinese(normalized.view.name)
  const baseType = parsedRaw.localized?.baseType || itemTranslations.toChinese(normalized.view.baseType)
  const modifiers = normalized.view.modifiers.map((modifier) => {
    const evidence = parsedRaw.evidence?.modifiers.find((candidate) => candidate.canonicalText === modifier.text)
    const fallback = modifier.tradeStatIds.map((id) => statResolver(id)).find(Boolean)
    const canonicalText = usableLocalizedText(modifier.text) || usableLocalizedText(fallback?.canonicalText)
    const localized = usableLocalizedText(evidence?.original.displayText)
      || usableLocalizedText(canonicalText ? itemTranslations.statToChinese(canonicalText) : undefined)
      || usableLocalizedText(fallback?.displayText)
    const canonicalModifier = canonicalText ? { ...modifier, text: canonicalText } : modifier
    return { ...canonicalModifier, ...(localized ? { localized: { [evidenceLocale || 'zh-CN']: localized } } : {}) }
  })
  return canonicalToLegacySnapshot(normalized, {
    ...normalized.view,
    modifiers,
    ...((name || baseType) ? { localized: { [evidenceLocale || 'zh-CN']: { name: name || normalized.view.name, baseType: baseType || normalized.view.baseType } } } : {}),
  }, request.realm)
}

async function createMarketListingPreviewEntry(ref: MarketDomListingRef): Promise<EquipmentLibraryEntry> {
  if (!marketViewManager) throw new Error('Market browser is unavailable')
  const payload = await marketViewManager.fetchListing(ref)
  const resolveStatText = await createMarketStatTextResolver(ref.realm)
  const imported = normalizeMarketListing(
    payload,
    ref,
    (text) => itemTranslations.toEnglish(text),
    (text) => itemTranslations.statToEnglish(text),
    resolveStatText,
  )
  const normalized = await pobItemBridge.normalize(imported.item.raw)
  normalized.view.iconUrl = imported.item.iconUrl
  normalized.view.localized = imported.item.localized
  normalized.item.modifierSnapshots = structuredClone(normalized.view.modifiers)
  if (imported.source.display?.locale && imported.source.display.locale !== 'en') {
    imported.source.display.modifiers?.forEach((displayText, index) => {
      if (normalized.view.modifiers[index]) {
        normalized.view.modifiers[index].localized = { [imported.source.display!.locale]: displayText }
      }
    })
  }
  const now = new Date().toISOString()
  return {
    schemaVersion: 3,
    id: `market-preview:${ref.realm}:${ref.listingId}`,
    fingerprint: fingerprintLibraryItem(normalized.item),
    item: structuredClone(normalized.item),
    view: structuredClone(normalized.view),
    sources: [structuredClone(imported.source)],
    collectionRoot: 'market',
    tags: [],
    archived: false,
    createdAt: now,
    updatedAt: now,
  }
}

async function savePriceCheckListing(ref: MarketDomListingRef) {
  if (!marketViewManager) throw new Error('Market browser is unavailable')
  const payload = await marketViewManager.fetchListing(ref)
  const resolveStatText = await createMarketStatTextResolver(ref.realm)
  const imported = normalizeMarketListing(
    payload,
    ref,
    (text) => itemTranslations.toEnglish(text),
    (text) => itemTranslations.statToEnglish(text),
    resolveStatText,
  )
  const normalized = await pobItemBridge.normalize(imported.item.raw)
  normalized.view.iconUrl = imported.item.iconUrl
  normalized.view.localized = imported.item.localized
  const officialByGroup = new Map<LibraryModifierGroup, typeof imported.item.preview.modifiers>()
  for (const modifier of imported.item.preview.modifiers) {
    const list = officialByGroup.get(modifier.group) || []
    list.push(modifier)
    officialByGroup.set(modifier.group, list)
  }
  const consumedByGroup = new Map<LibraryModifierGroup, number>()
  normalized.view.modifiers = normalized.view.modifiers.map((modifier) => {
    const index = consumedByGroup.get(modifier.group) || 0
    consumedByGroup.set(modifier.group, index + 1)
    const official = officialByGroup.get(modifier.group)?.[index]
    const resolution = official?.tradeResolutions.find((candidate) => candidate.realm === ref.realm)
    if (!official || !resolution) return modifier
    const statIds = resolution.queryStatId ? [resolution.queryStatId] : resolution.candidateStatIds
    return {
      ...modifier,
      sourceTags: official.sourceTags,
      tradeStatIds: [...new Set(statIds)],
      ...(official.currentValues[0] != null ? { tradeValue: official.currentValues[0], tradeValueNegated: resolution.valueTransform === 'negate' } : {}),
    }
  })
  normalized.item.modifierSnapshots = structuredClone(normalized.view.modifiers)
  if (imported.source.display?.locale && imported.source.display.locale !== 'en') {
    imported.source.display.modifiers?.forEach((displayText, index) => {
      if (normalized.view.modifiers[index]) {
        normalized.view.modifiers[index].localized = { [imported.source.display!.locale]: displayText }
      }
    })
  }
  const entry = equipmentLibrary.upsert(normalized, imported.source, { collectionRoot: 'market' })
  notifyLibraryChanged()
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('market:sidebar-request', 'items')
  return entry
}

if (hasSingleInstanceLock) void app.whenReady().then(async () => {
  Menu.setApplicationMenu(null)
  ipcMain.on('pob2:get-system-locale', (event) => {
    const applicationLocale = app.getLocale()
    const systemLocale = app.getSystemLocale()
    // Prefer a Chinese/Korean application locale when available. Windows can
    // expose a different legacy system code-page locale (for example zh-MO)
    // even while the user's active UI/region is zh-CN.
    event.returnValue = /^(?:zh|ko)(?:[-_]|$)/i.test(applicationLocale) ? applicationLocale : systemLocale
  })
  try {
    const saved = JSON.parse(readFileSync(path.join(userDataPath, 'price-check', 'settings.json'), 'utf8')) as { enabled?: unknown; hotkey?: unknown }
    registerPriceCheckHotkey(saved.enabled === true, typeof saved.hotkey === 'string' ? saved.hotkey : 'Ctrl+D')
  } catch { /* Price checking is disabled until settings are synchronized. */ }
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
      title: desktopText(uiLanguage, 'Open SuperPoE Build', '打开 SuperPoE 构筑', '開啟 SuperPoE 構築', 'SuperPoE 빌드 열기'),
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
      title: desktopText(uiLanguage, 'Save a Copy of the SuperPoE Build', '保存 SuperPoE 构筑副本', '儲存 SuperPoE 構築副本', 'SuperPoE 빌드 사본 저장'),
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
  ipcMain.handle('pob2:open-backup-file', async (event) => {
    const window = requireMainWindowSender(event)
    const result = await dialog.showOpenDialog(window, {
      title: desktopText(uiLanguage, 'Open SuperPoE Backup', '打开 SuperPoE 备份', '開啟 SuperPoE 備份', 'SuperPoE 백업 열기'),
      filters: [{ name: 'SuperPoE Backup', extensions: [SUPERPOE_BACKUP_EXTENSION] }],
      properties: ['openFile'],
    })
    if (result.canceled || !result.filePaths[0]) return { canceled: true }
    const filePath = path.resolve(result.filePaths[0])
    if (path.extname(filePath).toLowerCase() !== `.${SUPERPOE_BACKUP_EXTENSION}`) throw new Error('Only SuperPoE backup files can be opened')
    const content = readFileSync(filePath, 'utf8')
    if (!content || Buffer.byteLength(content, 'utf8') > MAX_SUPERPOE_BACKUP_FILE_SIZE) throw new Error('Invalid SuperPoE backup file size')
    return { canceled: false, filePath, content }
  })
  ipcMain.handle('pob2:save-backup-file', async (event, value: unknown) => {
    const window = requireMainWindowSender(event)
    const payload = validateBackupFilePayload(value)
    const result = await dialog.showSaveDialog(window, {
      title: desktopText(uiLanguage, 'Save SuperPoE Backup', '保存 SuperPoE 备份', '儲存 SuperPoE 備份', 'SuperPoE 백업 저장'),
      defaultPath: path.join(app.getPath('documents'), payload.fileName),
      filters: [{ name: 'SuperPoE Backup', extensions: [SUPERPOE_BACKUP_EXTENSION] }],
      properties: ['createDirectory', 'showOverwriteConfirmation'],
    })
    if (result.canceled || !result.filePath) return { canceled: true }
    const filePath = result.filePath.toLowerCase().endsWith(`.${SUPERPOE_BACKUP_EXTENSION}`)
      ? result.filePath
      : `${result.filePath}.${SUPERPOE_BACKUP_EXTENSION}`
    writeFileSync(filePath, payload.content, 'utf8')
    return { canceled: false, filePath }
  })
  ipcMain.handle('pob2:collect-backup-data', (event): SuperPoeBackupMainData => {
    requireMainWindowSender(event)
    return {
      equipmentLibrary: equipmentLibrary.exportData(),
      marketMonitoring: marketMonitoring?.exportData() || null,
    }
  })
  ipcMain.handle('pob2:restore-backup-data', (event, value: unknown) => {
    requireMainWindowSender(event)
    if (!value || typeof value !== 'object' || JSON.stringify(value).length > 80_000_000) throw new Error('Invalid backup main data')
    const input = value as Partial<SuperPoeBackupMainData>
    const previousEquipment = equipmentLibrary.exportData()
    const previousMonitoring = marketMonitoring?.exportData() || null
    try {
      if (input.equipmentLibrary != null) equipmentLibrary.restoreData(input.equipmentLibrary)
      if (input.marketMonitoring != null) {
        if (!marketMonitoring) throw new Error('Market monitoring is unavailable')
        marketMonitoring.restoreData(input.marketMonitoring)
      }
      notifyLibraryChanged()
    } catch (error) {
      try { equipmentLibrary.restoreData(previousEquipment) } catch { /* keep the original restore error */ }
      if (previousMonitoring != null && marketMonitoring) {
        try { marketMonitoring.restoreData(previousMonitoring) } catch { /* keep the original restore error */ }
      }
      throw error
    }
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
  ipcMain.handle('equipment-try-on:open', (event, value: unknown) => {
    const parent = requireMainWindowSender(event)
    if (!equipmentTryOnWindowManager) throw new Error('Equipment try-on window is unavailable')
    equipmentTryOnWindowManager.open(parent, validateEquipmentTryOnOpenRequest(value))
  })
  ipcMain.handle('equipment-try-on:close', (event) => {
    if (!equipmentTryOnWindowManager) throw new Error('Equipment try-on window is unavailable')
    equipmentTryOnWindowManager.close(event.sender.id)
  })
  ipcMain.handle('equipment-try-on:get-payload', (event) => {
    if (!equipmentTryOnWindowManager) throw new Error('Equipment try-on window is unavailable')
    return equipmentTryOnWindowManager.getPayload(event.sender.id)
  })
  ipcMain.handle('pob2:restart-as-admin', async (event) => {
    const fromMain = mainWindow?.webContents.id === event.sender.id
    const fromPriceCheck = priceCheckWindowManager?.owns(event.sender.id) === true
    if (!fromMain && !fromPriceCheck) throw new Error('Unauthorized administrator restart request')
    if (process.platform !== 'win32') return { status: 'unsupported' as const }
    if (processIsElevated(process.pid) === true) return { status: 'already-elevated' as const }

    const argumentsList = process.argv.slice(1)
    const argumentExpression = argumentsList.map(quotePowerShellArgument).join(', ')
    // UAC launches the child with a refreshed environment. Explicitly carry
    // the Vite renderer URL across so a development instance does not fall
    // back to the packaged app:// renderer after elevation.
    const rendererEnvironment = (['ELECTRON_RENDERER_URL', 'SUPERPOE_USER_DATA'] as const)
      .filter((name) => Boolean(process.env[name]))
      .map((name) => `$env:${name} = ${quotePowerShellArgument(process.env[name]!)}`)
      .join('; ')
    const command = [
      rendererEnvironment,
      `$arguments = @(${argumentExpression})`,
      `Start-Process -FilePath ${quotePowerShellArgument(process.execPath)} -ArgumentList $arguments -WorkingDirectory ${quotePowerShellArgument(process.cwd())} -Verb RunAs`,
    ].filter(Boolean).join('; ')
    // Release the lock before creating the elevated process. If the old
    // instance keeps it until after Start-Process returns, the new instance
    // can start during that window, fail the single-instance check, and exit
    // before the old process releases the lock.
    app.releaseSingleInstanceLock()
    try {
      await execFileAsync('powershell.exe', ['-NoProfile', '-Command', command], { windowsHide: true })
      setTimeout(() => app.quit(), 250)
      return { status: 'started' as const }
    } catch {
      // UAC cancellation leaves the current process alive. Restore the lock
      // so a cancelled elevation does not leave a second instance possible.
      if (!app.requestSingleInstanceLock()) {
        setTimeout(() => app.quit(), 250)
        return { status: 'started' as const }
      }
      return { status: 'cancelled' as const }
    }
  })
  ipcMain.handle('pob2:set-app-context', (event, value: unknown) => {
    requireMainWindowSender(event)
    if (!value || typeof value !== 'object') throw new Error('Invalid application context')
    const context = value as { defaultRealm?: unknown; language?: unknown; priceCheckEnabled?: unknown; priceCheckHotkey?: unknown }
    const realm = context.defaultRealm
    if (realm !== 'cn' && realm !== 'global') throw new Error('Invalid default realm')
    if (!isUiLanguage(context.language)) throw new Error('Invalid UI language')
    defaultRealm = realm
    uiLanguage = context.language
    marketViewManager?.setRealm(realm)
    marketViewManager?.setLanguage(uiLanguage)
    opportunityOverlay?.setLanguage(uiLanguage)
    priceCheckCoordinator?.updateApplicationContext()
    const hotkey = typeof context.priceCheckHotkey === 'string' ? context.priceCheckHotkey : 'Ctrl+D'
    const registration = registerPriceCheckHotkey(context.priceCheckEnabled === true, hotkey)
    mkdirSync(path.join(userDataPath, 'price-check'), { recursive: true })
    writeFileSync(path.join(userDataPath, 'price-check', 'settings.json'), JSON.stringify({ enabled: context.priceCheckEnabled === true, hotkey, registration }), 'utf8')
    return registration
  })
  ipcMain.handle('price-check:open', async (event, value: unknown) => {
    const fromMain = mainWindow?.webContents.id === event.sender.id
    const fromPriceCheck = priceCheckWindowManager?.owns(event.sender.id) === true
    if (!fromMain && !fromPriceCheck) throw new Error('Unauthorized price check sender')
    if (!value || typeof value !== 'object' || JSON.stringify(value).length > 500_000) throw new Error('Invalid price check request')
    const input = value as PriceCheckOpenRequest
    if (!input.source || (input.source.kind !== 'raw' && input.source.kind !== 'library')) throw new Error('Invalid price check source')
    if (!priceCheckCoordinator || !priceCheckWindowManager) throw new Error('Price checker is unavailable')
    priceCheckWindowManager.show()
    return priceCheckCoordinator.open(input)
  })
  ipcMain.handle('price-check:get-state', (event) => {
    if (!priceCheckWindowManager || (!priceCheckWindowManager.owns(event.sender.id) && !priceCheckWindowManager.ownsDetail(event.sender.id)) || !priceCheckCoordinator) throw new Error('Unauthorized price check sender')
    return priceCheckCoordinator.snapshot()
  })
  ipcMain.handle('price-check:search', async (event, value: unknown) => {
    if (!priceCheckWindowManager?.owns(event.sender.id) || !priceCheckCoordinator || !value || typeof value !== 'object') throw new Error('Invalid price check search')
    const input = value as { leagueId?: unknown; criteria?: unknown }
    return priceCheckCoordinator.search(validateShortString(input.leagueId, 'trade league', 128), validatePriceCheckCriteria(input.criteria))
  })
  ipcMain.handle('price-check:fetch-page', (event, value: unknown) => {
    if (!priceCheckWindowManager?.owns(event.sender.id) || !priceCheckCoordinator || typeof value !== 'number') throw new Error('Invalid price check page')
    return priceCheckCoordinator.fetchPage(value)
  })
  ipcMain.handle('price-check:open-trade-page', (event, value: unknown) => {
    if (!priceCheckWindowManager?.owns(event.sender.id) || typeof value !== 'string') throw new Error('Invalid trade page')
    const url = new URL(value)
    if (!['www.pathofexile.com', 'poe.game.qq.com'].includes(url.hostname)) throw new Error('Invalid trade page')
    void shell.openExternal(url.toString())
  })
  ipcMain.handle('price-check:visit-hideout', (event, value: unknown) => {
    if (!priceCheckWindowManager?.owns(event.sender.id) || !priceCheckCoordinator || typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value)) {
      throw new Error('Invalid price check listing')
    }
    return priceCheckCoordinator.visitHideout(value)
  })
  ipcMain.handle('price-check:favorite', async (event, value: unknown) => {
    const ownsPriceCheck = priceCheckWindowManager?.owns(event.sender.id) || priceCheckWindowManager?.ownsDetail(event.sender.id)
    if (!ownsPriceCheck || !priceCheckCoordinator || typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value)) {
      throw new Error('Invalid price check listing')
    }
    const reference = priceCheckCoordinator.listingReference(value)
    const entry = await savePriceCheckListing(reference)
    return { ok: true as const, entryId: entry.id }
  })
  ipcMain.handle('price-check:open-in-trade-center', (event, value: unknown) => {
    if (!priceCheckWindowManager?.owns(event.sender.id) || typeof value !== 'string') throw new Error('Invalid trade page')
    const url = new URL(value)
    const realm = priceCheckCoordinator?.snapshot().realm || defaultRealm
    const expectedHost = realm === 'cn' ? 'poe.game.qq.com' : 'www.pathofexile.com'
    if (url.hostname !== expectedHost || !url.pathname.startsWith('/trade2/')) throw new Error('Invalid trade page')
    if (!marketViewManager || !mainWindow || mainWindow.isDestroyed()) throw new Error('Trade center is unavailable')
    marketViewManager.openSource(realm, url.toString())
    // The checker normally restores game focus after hiding. During this
    // navigation the destination is SuperPoE itself, so suppress that delayed
    // game-focus callback or it will steal focus back from the trade center.
    priceCheckWindowManager?.hide(false)
    mainWindow.show()
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
    mainWindow.moveTop()
    mainWindow.webContents.send('market:open-trade-center')
  })
  ipcMain.handle('price-check:show-detail', (event, value: unknown) => {
    if (!priceCheckWindowManager?.owns(event.sender.id) || typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value)) {
      throw new Error('Invalid price check listing')
    }
    priceCheckWindowManager.showDetail(value)
  })
  ipcMain.handle('price-check:hide-detail', (event) => {
    if (!priceCheckWindowManager || (!priceCheckWindowManager.owns(event.sender.id) && !priceCheckWindowManager.ownsDetail(event.sender.id))) {
      throw new Error('Unauthorized price check sender')
    }
    priceCheckWindowManager.hideDetail()
  })
  ipcMain.handle('price-check:get-detail-state', (event) => {
    if (!priceCheckWindowManager?.ownsDetail(event.sender.id)) throw new Error('Unauthorized price check sender')
    return priceCheckWindowManager.getDetailState()
  })
  ipcMain.handle('price-check:hide', (event) => {
    if (!priceCheckWindowManager || (!priceCheckWindowManager.owns(event.sender.id) && !priceCheckWindowManager.ownsDetail(event.sender.id))) throw new Error('Unauthorized price check sender')
    priceCheckWindowManager.hide()
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
    if (!currencyMarketService) throw new Error(desktopText(uiLanguage, 'Currency market service is unavailable', '通货行情服务不可用', '通貨行情服務無法使用', '통화 시세 서비스를 사용할 수 없습니다'))
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

  ipcMain.on('market-enhancement:try-on', (event, value: unknown) => {
    let listingId = ''
    try {
      const realm = requireMarketSender(event)
      const input = value && typeof value === 'object' ? value as { requestId?: unknown; ref?: unknown } : {}
      if (input.ref && typeof input.ref === 'object') {
        const candidateId = (input.ref as { listingId?: unknown }).listingId
        if (typeof candidateId === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(candidateId)) listingId = candidateId
      }
      const requestId = validateShortString(input.requestId, 'try-on request ID', 128)
      const ref = validateListingRef(input.ref, realm)
      listingId = ref.listingId
      const operationKey = `${realm}:${ref.listingId}`
      const previous = tryOnOperations.get(operationKey) || Promise.resolve()
      const operation = previous.catch(() => {}).then(async () => {
        if (!mainWindow || mainWindow.isDestroyed()) throw new Error('Main window is unavailable')
        const entry = await createMarketListingPreviewEntry(ref)
        mainWindow.webContents.send('market:try-on-request', { requestId, entry })
        if (!event.sender.isDestroyed()) event.sender.send('market-enhancement:try-on-result', { requestId, listingId: ref.listingId })
      }).catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error)
        if (!event.sender.isDestroyed()) event.sender.send('market-enhancement:try-on-result', { requestId, listingId: ref.listingId, error: message.slice(0, 300) })
      }).finally(() => {
        if (tryOnOperations.get(operationKey) === operation) tryOnOperations.delete(operationKey)
      })
      tryOnOperations.set(operationKey, operation)
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      if (!event.sender.isDestroyed() && listingId) {
        event.sender.send('market-enhancement:try-on-result', { listingId, error: message.slice(0, 300) })
      }
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
        const resolveStatText = await createMarketStatTextResolver(ref.realm)
        const imported = normalizeMarketListing(
          payload,
          ref,
          (text) => itemTranslations.toEnglish(text),
          (text) => itemTranslations.statToEnglish(text),
          resolveStatText,
        )
        const normalized = await pobItemBridge.normalize(imported.item.raw)
        normalized.view.iconUrl = imported.item.iconUrl
        normalized.view.localized = imported.item.localized
        if (imported.source.display?.locale && imported.source.display.locale !== 'en') {
          imported.source.display.modifiers?.forEach((text, index) => {
            if (normalized.view.modifiers[index]) normalized.view.modifiers[index].localized = { [imported.source.display!.locale]: text }
          })
        }
        equipmentLibrary.upsert(normalized, imported.source, { collectionRoot: 'market' })
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
    if (input.collectionRoot === 'market' || input.collectionRoot === 'build' || input.collectionRoot === 'custom') filter.collectionRoot = input.collectionRoot
    if ('folderId' in input) filter.folderId = input.folderId == null ? null : validateShortString(input.folderId, 'folder ID', 128)
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
      ...(input.scope === 'items' ? { collectionRoot: validateCollectionRoot(input.collectionRoot) } : {}),
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
    if ('collectionRoot' in input) patch.collectionRoot = validateCollectionRoot(input.collectionRoot)
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
  ipcMain.handle('market:move-library', (event, value: unknown) => {
    requireMainWindowSender(event)
    if (!value || typeof value !== 'object') throw new Error('Invalid equipment library move')
    const input = value as Partial<EquipmentLibraryMoveInput>
    if (!Array.isArray(input.entryIds) || !input.entryIds.length || input.entryIds.length > 5_000) throw new Error('Invalid equipment library entry IDs')
    const entryIds = input.entryIds.map((id) => validateShortString(id, 'library entry ID', 128))
    const targetFolderId = input.targetFolderId == null ? undefined : validateShortString(input.targetFolderId, 'folder ID', 128)
    const result = equipmentLibrary.moveEquipment({ entryIds, ...(targetFolderId ? { targetFolderId } : {}) })
    notifyLibraryChanged()
    return result
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
  ipcMain.handle('market:save-equipment-item', async (event, value: unknown) => {
    requireMainWindowSender(event)
    if (!value || typeof value !== 'object' || JSON.stringify(value).length > 500_000) {
      throw new Error('Invalid equipment library item')
    }
    const input = value as EquipmentLibraryItemInput
    if (typeof input.raw !== 'string' || !input.raw.trim()) throw new Error('Invalid PoB item raw')
    const now = new Date().toISOString()
    let source: EquipmentLibrarySource
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
    // Manual entries may come directly from the game's localized clipboard.
    // Normalize those through the same data-driven converter used by the
    // price checker, while leaving canonical PoB Raw untouched.
    const inputLanguage = detectItemRawLanguage(input.raw)
    let canonicalizeStat: StatCanonicalizer | undefined
    if (inputLanguage !== 'en') {
      const bundle = await createMarketStatCatalog(inputLanguage === 'zh-rCN' ? 'cn' : 'global').catch(() => undefined)
      if (bundle) canonicalizeStat = createStatCanonicalizer(inputLanguage, bundle)
    }
    const parsedInput: GameClipboardParseResult = looksLikeGameClipboardItem(input.raw)
      ? parseGameClipboardItem(input.raw, { canonicalizeStat })
      : translatePobRawForPriceCheck(input.raw, canonicalizeStat)
    const normalized = await pobItemBridge.normalize(parsedInput.raw)
    if (parsedInput.evidence) normalized.item.parseEvidence = parsedInput.evidence
    applyXiletradeParseEvidence(normalized.view, parsedInput.evidence)
    normalized.item.itemClass = normalized.view.itemClass
    normalized.item.tradeCategory = normalized.view.tradeCategory
    normalized.view.iconUrl = input.iconUrl || itemIcons.resolve(normalized.view.rarity, normalized.view.name, normalized.view.baseType)
    let localized = input.localized
    let localizedModifiers: string[] | undefined
    if (input.source?.kind === 'manual' && !localized) {
      const parsedLocale = parsedInput.evidence?.locale || 'zh-CN'
      const localizedName = usableLocalizedText(parsedInput.localized?.name) || usableLocalizedText(itemTranslations.toChinese(normalized.view.name))
      const localizedBaseType = usableLocalizedText(parsedInput.localized?.baseType) || usableLocalizedText(itemTranslations.toChinese(normalized.view.baseType))
      if (localizedName || localizedBaseType) {
        localized = { [parsedLocale]: { name: localizedName || normalized.view.name, baseType: localizedBaseType || normalized.view.baseType } }
      }
      const translatedModifiers = normalized.view.modifiers.map((modifier) => {
        const evidence = parsedInput.evidence?.modifiers.find((candidate) => candidate.canonicalText === modifier.text)
        return usableLocalizedText(evidence?.original.displayText)
          || (parsedLocale === 'zh-CN' ? usableLocalizedText(itemTranslations.statToChinese(modifier.text)) : undefined)
      })
      localizedModifiers = translatedModifiers.some(Boolean)
        ? normalized.view.modifiers.map((modifier, index) => translatedModifiers[index] || modifier.text)
        : undefined
      normalized.view.modifiers.forEach((modifier, index) => {
        const evidence = parsedInput.evidence?.modifiers.find((candidate) => candidate.canonicalText === modifier.text)
        const translated = usableLocalizedText(evidence?.original.displayText) || localizedModifiers?.[index]
        if (translated && translated !== modifier.text) modifier.localized = { [parsedLocale]: translated }
      })
    }
    const parsedCanonicalTexts = new Set(normalized.view.modifiers.map((modifier) => modifier.text))
    for (const evidence of parsedInput.evidence?.modifiers || []) {
      const projectedLines = evidence.canonicalText?.split('\n').map((line) => line.trim()).filter(Boolean) || []
      if (evidence.canonicalText && (parsedCanonicalTexts.has(evidence.canonicalText) || projectedLines.some((line) => parsedCanonicalTexts.has(line)))) continue
      normalized.view.modifiers.push({
        id: `unsupported-${evidence.displayOrder}`,
        displayOrder: normalized.view.modifiers.length,
        group: evidence.group,
        sourceTags: evidence.sourceTags,
        text: evidence.canonicalText || evidence.original.displayText,
        unsupported: true,
        localized: { [evidence.original.locale]: evidence.original.displayText },
        tradeStatIds: evidence.queryStatId ? [evidence.queryStatId] : evidence.candidateStatIds,
        tradeValue: evidence.currentValues[0],
      })
    }
    normalized.view.localized = localized
    const displayLocale = localized && Object.keys(localized)[0] as keyof NonNullable<typeof localized> | undefined
    const localizedDisplay = displayLocale ? localized?.[displayLocale] : undefined
    source.display = {
      locale: displayLocale || 'en',
      name: localizedDisplay?.name || normalized.view.name,
      baseType: localizedDisplay?.baseType || normalized.view.baseType,
      iconUrl: normalized.view.iconUrl,
      ...(localizedModifiers ? { modifiers: localizedModifiers } : {}),
    }
    const collectionRoot = input.collectionRoot == null ? undefined : validateCollectionRoot(input.collectionRoot)
    const folderId = input.folderId == null ? undefined : validateShortString(input.folderId, 'folder ID', 128)
    const entry = equipmentLibrary.upsert(normalized, source, { collectionRoot, folderId })
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
    if (typeof input.raw !== 'string' || !input.raw.trim()) throw new Error('Invalid PoB item raw')
    if (!tradeProvider || !marketViewManager) throw new Error('Trade provider is unavailable')
    const requestedLeague = typeof input.leagueId === 'string' && input.leagueId.trim()
      ? validateShortString(input.leagueId, 'trade league', 128)
      : undefined
    const leagueId = requestedLeague || (await tradeProvider.leagues(input.realm))[0]?.id
    if (!leagueId) throw new Error('No active trade league is available')
    try {
      const normalized = await pobItemBridge.normalize(input.raw)
      const criteria = input.criteria == null ? undefined : validatePriceCheckCriteria(input.criteria)
      const result = await tradeProvider.search(input.realm, leagueId, canonicalToLegacySnapshot(normalized, normalized.view, input.realm), criteria)
      marketViewManager.openSource(input.realm, result.url)
      const { resolvedItem: _resolvedItem, listingIds: _listingIds, ...response } = result
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
      const legacyItem = canonicalToLegacySnapshot(
        { item: entry.item, view: entry.view },
        { ...entry.view, iconUrl: entry.view.iconUrl, localized: entry.view.localized },
        realm,
      )
      const criteria = (input as { criteria?: unknown }).criteria == null ? undefined : validatePriceCheckCriteria((input as { criteria?: unknown }).criteria)
      const result = await tradeProvider.search(realm, leagueId, legacyItem, criteria)
      marketViewManager.openSource(realm, result.url)
      const { resolvedItem: _resolvedItem, listingIds: _listingIds, ...response } = result
      return response
    } catch (error) {
      console.error(`[Market search] library failed realm=${realm} league=${leagueId} entry=${entry.id}`, error)
      throw error
    }
  })
  ipcMain.handle('market:prepare-price-check', async (event, value: unknown) => {
    requireMainWindowSender(event)
    if (!value || typeof value !== 'object' || JSON.stringify(value).length > 500_000) throw new Error('Invalid price check request')
    const input = value as Partial<TradePriceCheckPrepareRequest>
    if (input.realm !== 'cn' && input.realm !== 'global') throw new Error('Invalid market realm')
    if (!tradeProvider) throw new Error('Trade provider is unavailable')
    const item = await priceCheckSnapshot(input as TradePriceCheckPrepareRequest)
    return (await tradeProvider.prepare(input.realm, item)).draft
  })
  ipcMain.handle('market:run-price-check', async (event, value: unknown) => {
    requireMainWindowSender(event)
    if (!value || typeof value !== 'object' || JSON.stringify(value).length > 500_000) throw new Error('Invalid price check request')
    const input = value as Partial<TradePriceCheckSearchRequest>
    if (input.realm !== 'cn' && input.realm !== 'global') throw new Error('Invalid market realm')
    if (!tradeProvider || !marketViewManager) throw new Error('Trade provider is unavailable')
    const leagueId = validateShortString(input.leagueId, 'trade league', 128)
    const criteria = validatePriceCheckCriteria(input.criteria)
    const item = await priceCheckSnapshot(input as TradePriceCheckSearchRequest)
    const result = await tradeProvider.search(input.realm, leagueId, item, criteria)
    marketViewManager.openSource(input.realm, result.url)
    const { resolvedItem: _resolvedItem, listingIds: _listingIds, ...response } = result
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
  ipcMain.handle('pob2:lua-compare-equipment', (_event, value: unknown) => {
    if (!value || typeof value !== 'object') throw new Error('Invalid equipment comparison payload')
    const payload = value as {
      context?: {
        xml?: unknown
        buildRevision?: unknown
        activeItemSetId?: unknown
        activeWeaponSet?: unknown
        configFingerprint?: unknown
        configOverrides?: unknown
        activeSkillContext?: unknown
      }
      candidate?: { raw?: unknown; buildItemId?: unknown; source?: unknown }
      sourceSlotName?: unknown
      slotOnlyTooltips?: unknown
      contextKey?: unknown
    }
    if (!payload.context || typeof payload.context.xml !== 'string' || !payload.context.xml || payload.context.xml.length > 10_000_000) {
      throw new Error('Invalid equipment comparison build XML')
    }
    if (!payload.candidate || typeof payload.candidate.raw !== 'string' || !payload.candidate.raw || payload.candidate.raw.length > 200_000) {
      throw new Error('Invalid equipment comparison item')
    }
    if (typeof payload.contextKey !== 'string' || !payload.contextKey || payload.contextKey.length > 128) {
      throw new Error('Invalid equipment comparison context')
    }
    if (payload.context.activeWeaponSet !== 1 && payload.context.activeWeaponSet !== 2) {
      throw new Error('Invalid equipment comparison weapon set')
    }
    if (payload.sourceSlotName != null && (typeof payload.sourceSlotName !== 'string' || payload.sourceSlotName.length > 80)) {
      throw new Error('Invalid equipment comparison slot')
    }
    return pobLuaService.compareEquipment(payload as import('../src/equipmentDifference/types.js').EquipmentDifferenceRequest & { contextKey: string })
  })
  ipcMain.handle('pob2:save-game-build', async (_event, value: unknown) => {
    const payload = validateGameBuildPayload(value)
    const result = await dialog.showSaveDialog({
      title: desktopText(uiLanguage, 'Save Game Build Planner File', '保存游戏规划器文件', '儲存遊戲構築規劃器檔案', '게임 빌드 플래너 파일 저장'),
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
  await pobLuaService.initialize()
  try {
    const migration = await equipmentLibrary.migrateLegacy(pobItemBridge)
    if (migration.migrated || migration.unresolved) {
      console.info(`[Equipment library] v1 migration: ${migration.migrated} migrated, ${migration.unresolved} unresolved`)
    }
  } catch (error) {
    console.error('[Equipment library] v1 migration failed; original file was left unchanged', error)
  }
  try {
    const migration = await equipmentLibrary.migrateTradeData(pobItemBridge)
    if (migration.migrated || migration.unresolved) {
      console.info(`[Equipment library] Xiletrade migration: ${migration.migrated} migrated, ${migration.unresolved} unresolved`)
    }
  } catch (error) {
    console.error('[Equipment library] Xiletrade migration failed; existing entries were left unchanged', error)
  }
  try {
    const repaired = await equipmentLibrary.repairCorruptedMarketTitles(pobItemBridge, (text) => itemTranslations.toEnglish(text))
    if (repaired) console.info(`[Equipment library] repaired ${repaired} corrupted localized item title(s)`)
  } catch (error) {
    console.error('[Equipment library] localized item title repair failed; original entries were left unchanged', error)
  }
  try {
    const enriched = equipmentLibrary.enrichManualPresentation(
      (text) => itemTranslations.toChinese(text),
      (text) => itemTranslations.statToChinese(text),
      (rarity, name, baseType) => itemIcons.resolve(rarity, name, baseType),
    )
    if (enriched) console.info(`[Equipment library] enriched ${enriched} custom item presentation(s)`)
  } catch (error) {
    console.error('[Equipment library] custom item presentation enrichment failed; canonical items were left unchanged', error)
  }
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('will-quit', () => globalShortcut.unregisterAll())

app.on('before-quit', () => {
  marketViewManager?.dispose()
  pobLuaService.dispose()
})

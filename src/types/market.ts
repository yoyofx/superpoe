export type MarketRealm = 'cn' | 'global'

export interface MarketBounds {
  x: number
  y: number
  width: number
  height: number
}

export type MarketNavigationCommand = 'back' | 'forward' | 'reload' | 'stop' | 'home'

export type MarketSessionStatus = 'anonymous' | 'valid' | 'unknown'

export interface MarketViewState {
  realm: MarketRealm
  url: string
  title: string
  loading: boolean
  canGoBack: boolean
  canGoForward: boolean
  sessionStatus: MarketSessionStatus
  currentSearch?: MarketSearchReference
  error?: string
}

export type SavedSearchCaptureSource = 'official-page' | 'superpoe-query' | 'code-only'
export type SavedSearchValidity = 'unknown' | 'valid' | 'needs-refresh' | 'invalid'
export type MonitorTaskStatus = 'saved' | 'armed' | 'paused' | 'completed'
export type MonitorTaskPriority = 'high' | 'normal' | 'low'
export const MAX_ACTIVE_PURCHASE_TARGETS = 5

export interface SavedSearchQuerySnapshot {
  source: Exclude<SavedSearchCaptureSource, 'code-only'>
  body: unknown
  hash: string
  capturedAt: string
}

export interface MarketSearchReference {
  realm: MarketRealm
  leagueId: string
  searchCode: string
  canonicalUrl: string
  captureSource: SavedSearchCaptureSource
  querySnapshot?: SavedSearchQuerySnapshot
}

export type LibraryModifierGroup = 'enchant' | 'rune' | 'implicit' | 'explicit'
export type LibraryModifierSource = LibraryModifierGroup | 'fractured' | 'crafted' | 'desecrated' | 'unknown'
export type LibraryModifierTag = LibraryModifierSource | 'corrupted' | 'mutated'
export type LibraryTextLocale = 'zh-CN' | 'zh-TW' | 'en' | 'ko-KR' | 'unknown'

export interface LibraryLocalizedText {
  lines: string[]
  displayText: string
}

export interface TradeStatResolutionSnapshot {
  realm: MarketRealm
  queryStatId?: string
  baseStatId?: string
  optionId?: string
  candidateStatIds: string[]
  source: LibraryModifierSource
  catalogTemplate?: string
  valueMode: 'numeric' | 'presence' | 'fixed-option'
  valueTransform: 'identity' | 'negate'
  resolvedBy: 'official-listing' | 'exact-text' | 'multi-line' | 'cross-realm-id' | 'user-confirmed'
  catalogFetchedAt?: string
  catalogPayloadHash?: string
  status: 'resolved' | 'ambiguous' | 'unresolved' | 'stale'
}

export interface LibraryModifier {
  id: string
  displayOrder: number
  group: LibraryModifierGroup
  sourceTags: LibraryModifierTag[]
  affixKind?: 'prefix' | 'suffix'
  original: {
    locale: LibraryTextLocale
    lines: string[]
    displayText: string
  }
  localized?: Partial<Record<LibraryTextLocale, LibraryLocalizedText>>
  valueMode: 'numeric' | 'presence' | 'fixed-option'
  currentValues: number[]
  tierRanges: Array<{ min: number; max: number }>
  tradeResolutions: TradeStatResolutionSnapshot[]
  tier?: {
    name?: string
    rank?: number
    level?: number
  }
}

export interface LibraryItemSnapshot {
  rarity: string
  name: string
  baseType: string
  itemLevel?: number
  quality?: number
  sockets?: string
  corrupted?: boolean
  identified?: boolean
  iconUrl?: string
  rawText?: string
  localized?: Partial<Record<LibraryTextLocale, { name: string; baseType: string }>>
  tradeCategory?: string
  properties?: CanonicalItemDisplayStat[]
  requirements?: CanonicalItemDisplayStat[]
  modifiers: LibraryModifier[]
}

export interface CanonicalEquipmentItem {
  format: 'pob2-item'
  raw: string
  pobVersion?: string
  gameDataVersion?: string
}

export interface CanonicalItemModifierView {
  id: string
  displayOrder: number
  group: LibraryModifierGroup
  sourceTags: LibraryModifierTag[]
  text: string
  localized?: Partial<Record<LibraryTextLocale, string>>
  tradeStatIds: string[]
  tradeValue?: number
  tradeValueNegated?: boolean
}

export interface CanonicalItemDisplayStat {
  key: string
  values: string[]
}

export interface CanonicalItemView {
  rarity: string
  name: string
  baseType: string
  itemLevel?: number
  quality?: number
  sockets?: string
  corrupted?: boolean
  identified?: boolean
  iconUrl?: string
  localized?: Partial<Record<LibraryTextLocale, { name: string; baseType: string }>>
  tradeCategory?: string
  properties?: CanonicalItemDisplayStat[]
  requirements?: CanonicalItemDisplayStat[]
  modifiers: CanonicalItemModifierView[]
}

export interface MarketPriceSnapshot {
  amount: number
  currency: string
  display: string
}

interface EquipmentLibrarySourceBase {
  sourceKey: string
  capturedAt: string
  updatedAt: string
  display?: {
    locale: LibraryTextLocale
    name: string
    baseType: string
    iconUrl?: string
    modifiers?: string[]
  }
}

export interface MarketFavoriteSource extends EquipmentLibrarySourceBase {
  kind: 'market-favorite'
  realm: MarketRealm
  leagueId?: string
  listingId: string
  queryId?: string
  sourceUrl: string
  state: 'available' | 'unavailable' | 'unknown'
  price: MarketPriceSnapshot | null
  indexedAt?: string
}

export interface PobImportSource extends EquipmentLibrarySourceBase {
  kind: 'pob-import'
  buildId: string
  pobItemId: string
}

export interface EquipmentFavoriteSource extends EquipmentLibrarySourceBase {
  kind: 'equipment-favorite'
  buildId: string
  equipmentSetId: string
  itemId: string
  slotName?: string
}

export interface PriceCheckSource extends EquipmentLibrarySourceBase {
  kind: 'price-check'
  realm: MarketRealm
  correlationId: string
}

export interface ManualSource extends EquipmentLibrarySourceBase {
  kind: 'manual'
}

export type EquipmentLibrarySource = MarketFavoriteSource | PobImportSource | EquipmentFavoriteSource | PriceCheckSource | ManualSource
export type EquipmentLibrarySourceKind = EquipmentLibrarySource['kind']
export type EquipmentCollectionRoot = 'market' | 'build' | 'custom'

export interface EquipmentLibraryEntry {
  schemaVersion: 3
  id: string
  fingerprint: string
  item: CanonicalEquipmentItem
  view: CanonicalItemView
  sources: EquipmentLibrarySource[]
  collectionRoot: EquipmentCollectionRoot
  folderId?: string
  folder?: string
  tags: string[]
  note?: string
  archived: boolean
  createdAt: string
  updatedAt: string
}

export interface EquipmentLibraryFilter {
  realm?: MarketRealm
  sourceKind?: EquipmentLibrarySourceKind | 'all'
  collectionRoot?: EquipmentCollectionRoot
  folderId?: string | null
  query?: string
  includeArchived?: boolean
}

export interface EquipmentLibraryMetadataPatch {
  id: string
  collectionRoot?: EquipmentCollectionRoot
  folderId?: string | null
  folder?: string
  tags?: string[]
  note?: string
  archived?: boolean
}

export type LibraryTreeScope = 'items' | 'searches'

export interface EquipmentLibraryFolder {
  id: string
  scope: LibraryTreeScope
  collectionRoot?: EquipmentCollectionRoot
  name: string
  parentId?: string
  sortOrder: number
  expanded: boolean
  createdAt: string
  updatedAt: string
}

export interface SavedMarketSearch {
  id: string
  realm: MarketRealm
  leagueId: string
  searchCode: string
  canonicalUrl: string
  captureSource: SavedSearchCaptureSource
  querySnapshot?: SavedSearchQuerySnapshot
  validity: SavedSearchValidity
  checkedAt?: string
  name: string
  note?: string
  folderId?: string
  sortOrder: number
  monitorStatus: MonitorTaskStatus
  monitorPriority: MonitorTaskPriority
  monitorStatusChangedAt: string
  createdAt: string
  updatedAt: string
}

export interface EquipmentLibrarySidebarSnapshot {
  folders: EquipmentLibraryFolder[]
  searches: SavedMarketSearch[]
  selectedItemFolderId?: string
  selectedSearchFolderId?: string
}

export interface EquipmentLibraryFolderInput {
  scope: LibraryTreeScope
  collectionRoot?: EquipmentCollectionRoot
  name: string
  parentId?: string
}

export interface EquipmentLibraryFolderPatch {
  id: string
  name?: string
  parentId?: string | null
  beforeId?: string | null
  expanded?: boolean
}

export interface SavedMarketSearchInput {
  name: string
  note?: string
  folderId?: string
}

export interface SavedMarketSearchRecordInput extends SavedMarketSearchInput, MarketSearchReference {}

export interface SavedMarketSearchPatch {
  id: string
  name?: string
  note?: string
  folderId?: string | null
  beforeId?: string | null
  monitorStatus?: MonitorTaskStatus
  monitorPriority?: MonitorTaskPriority
}

export type PurchaseTargetStatus = 'armed' | 'paused' | 'completed'

export interface PurchaseTarget {
  id: string
  sourceSearchId?: string
  sourceSearchUpdatedAt?: string
  sourceSearchChanged?: boolean
  name: string
  note?: string
  status: PurchaseTargetStatus
  priority: MonitorTaskPriority
  search: MarketSearchReference
  createdAt: string
  updatedAt: string
  statusChangedAt: string
}

export type MonitorConnectionStatus = 'disabled' | 'connecting' | 'connected' | 'reconnecting' | 'auth-required' | 'invalid-search' | 'error'

export interface MonitorRuntimeState {
  targetId: string
  /** @deprecated Transport compatibility with the injected Live client. */
  searchId: string
  connectionStatus: MonitorConnectionStatus
  connectedAt?: string
  retryAttempt: number
  nextRetryAt?: string
  lastErrorCode?: string
  lastOpportunityAt?: string
  pendingOpportunityCount: number
}

export type OpportunityStatus = 'detected' | 'fetching' | 'actionable' | 'attempting' | 'attempted' | 'skipped' | 'unavailable' | 'expired' | 'error'

export interface MarketOpportunityItemSummary {
  name: string
  baseType: string
  rarity?: string
  iconUrl?: string
  price?: string
  itemLevel?: number
  quality?: number
  sockets?: string
  corrupted?: boolean
  identified?: boolean
  modifiers?: LibraryModifier[]
}

export interface OpportunityBatch {
  id: string
  targetId: string
  detectedAt: string
  opportunityIds: string[]
}

export interface MarketOpportunity {
  id: string
  targetId: string
  batchId: string
  /** @deprecated Kept when loading older opportunity history. */
  searchId: string
  realm: MarketRealm
  leagueId: string
  searchCode: string
  listingId: string
  status: OpportunityStatus
  detectedAt: string
  fetchedAt?: string
  attemptedAt?: string
  item?: MarketOpportunityItemSummary
}

export type GameRuntimeState =
  | { status: 'unknown'; checkedAt?: string }
  | { status: 'stopped'; checkedAt: string }
  | {
      status: 'background' | 'foreground'
      checkedAt: string
      clientRealm: MarketRealm | 'unknown'
      processName: string
      pid: number
      bounds?: MarketBounds
      elevated?: boolean
    }

export type MarketSoundId = 'chime-rise' | 'double-beep' | 'bell' | 'digital' | 'alert' | 'soft' | 'triple' | 'low-pulse' | 'bright' | 'warble'

export interface MarketMonitorSettings {
  overlayEnabled: boolean
  soundEnabled: boolean
  soundVolume: number
  soundId: MarketSoundId
  doNotDisturb: boolean
  overlayCorner: 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left'
}

export interface MarketMonitoringSnapshot {
  purchaseTargets: PurchaseTarget[]
  targets: MonitorRuntimeState[]
  batches: OpportunityBatch[]
  opportunities: MarketOpportunity[]
  game: GameRuntimeState
  settings: MarketMonitorSettings
  globalPaused: boolean
}

export interface OpportunityOverlayState {
  language: 'en' | 'zh-rCN' | 'zh-rTW' | 'ko-KR'
  searchName: string
  detectedCount: number
  actionableCount: number
  current?: MarketOpportunity
  alternatives: MarketOpportunity[]
  canVisitHideout: boolean
  matchedTargetCount?: number
  statusMessage?: string
}

export type MarketOpportunityAttemptResult = 'attempted' | 'game-offline' | 'unavailable' | 'error'

export interface MarketDomListingRef {
  realm: MarketRealm
  listingId: string
  queryId?: string
  sourceUrl: string
}

export type MarketVisitHideoutResult =
  | { ok: true }
  | { ok: false; reason: 'game-offline' }

export interface EquipmentLibraryItemInput {
  raw: string
  iconUrl?: string
  localized?: Partial<Record<LibraryTextLocale, { name: string; baseType: string }>>
  collectionRoot?: EquipmentCollectionRoot
  folderId?: string
  source: Omit<PobImportSource, 'sourceKey' | 'capturedAt' | 'updatedAt'> | Omit<EquipmentFavoriteSource, 'sourceKey' | 'capturedAt' | 'updatedAt'> | Omit<ManualSource, 'sourceKey' | 'capturedAt' | 'updatedAt'>
}

export interface MarketFavoriteState {
  listingId: string
  active: boolean
}

export interface TradeSearchRequest {
  entryId: string
  realm: MarketRealm
  leagueId: string
  criteria?: TradePriceCheckCriteria
}

export interface EquipmentTradeSearchRequest {
  raw: string
  realm: MarketRealm
  leagueId?: string
  criteria?: TradePriceCheckCriteria
}

export type TradeListedStatus = 'securable' | 'available' | 'online' | 'any'

export type TradePriceCheckTarget =
  | { kind: 'library'; entryId: string }
  | { kind: 'raw'; raw: string }

export interface TradePriceCheckPrepareRequest {
  realm: MarketRealm
  target: TradePriceCheckTarget
}

export interface TradePriceCheckModifier {
  id: string
  group: LibraryModifierGroup
  sourceTags?: LibraryModifierTag[]
  affixKind?: 'prefix' | 'suffix'
  lines: string[]
  localizedLines?: string[]
  searchable: boolean
  valueMode: 'numeric' | 'presence' | 'fixed-option'
  currentValue?: number
}

export interface TradePriceCheckDraft {
  realm: MarketRealm
  rarity: string
  name: string
  baseType: string
  localizedName?: string
  localizedBaseType?: string
  unique: boolean
  itemLevel?: number
  modifiers: TradePriceCheckModifier[]
}

export interface TradePriceCheckModifierCriteria {
  id: string
  min?: number
  max?: number
}

export interface TradePriceCheckCriteria {
  listedStatus: TradeListedStatus
  useBaseType: boolean
  itemLevelMin?: number
  itemLevelMax?: number
  modifiers: TradePriceCheckModifierCriteria[]
}

export interface TradePriceCheckSearchRequest extends TradePriceCheckPrepareRequest {
  leagueId: string
  criteria: TradePriceCheckCriteria
}

export interface TradeLeague {
  id: string
  text: string
}

export interface TradeSearchResult {
  searchId: string
  url: string
  total: number
  resolvedModifierCount: number
  unresolvedModifierCount: number
}

export interface PriceCheckOpenRequest {
  source: TradePriceCheckTarget
  initialLeagueId?: string
  /** Non-blocking diagnostics produced while importing a localized game item. */
  captureWarnings?: string[]
}

export interface PriceCheckListingView {
  id: string
  price?: MarketPriceSnapshot
  seller: {
    accountName?: string
    status: 'online' | 'afk' | 'offline'
  }
  item: CanonicalItemView
  listedAt?: string
  whisper?: string
  hideoutAvailable: boolean
}

export interface PriceCheckListingReference {
  realm: MarketRealm
  listingId: string
  queryId: string
  sourceUrl: string
}

export interface PriceCheckContextState {
  generation: number
  realm: MarketRealm
  language: 'en' | 'zh-rCN' | 'zh-rTW' | 'ko-KR'
  phase: 'idle' | 'parsing' | 'configuring' | 'searching' | 'fetching-page' | 'results' | 'error'
  draft?: TradePriceCheckDraft
  leagues: TradeLeague[]
  initialLeagueId?: string
  search?: TradeSearchResult & { contextId: string; page: number; pageCount: number }
  listings: PriceCheckListingView[]
  error?: string
  /** Localized item lines that were not safe to translate into PoB syntax. */
  captureWarnings?: string[]
}

export interface PriceCheckSettings {
  enabled: boolean
  hotkey: string
  alwaysOnTop: boolean
  registration: { registered: boolean; error?: string }
}

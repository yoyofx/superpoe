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
  error?: string
}

export type LibraryModifierGroup = 'enchant' | 'rune' | 'implicit' | 'explicit'
export type LibraryModifierSource = LibraryModifierGroup | 'fractured' | 'crafted' | 'desecrated' | 'unknown'
export type LibraryModifierTag = LibraryModifierSource | 'corrupted' | 'mutated'

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
    locale: 'zh-CN' | 'zh-TW' | 'en' | 'unknown'
    lines: string[]
    displayText: string
  }
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
  modifiers: LibraryModifier[]
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

export interface EquipmentLibraryEntry {
  schemaVersion: 1
  id: string
  fingerprint: string
  item: LibraryItemSnapshot
  sources: EquipmentLibrarySource[]
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
  query?: string
  includeArchived?: boolean
}

export interface EquipmentLibraryMetadataPatch {
  id: string
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
  name: string
  note?: string
  url: string
  folderId?: string
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
  realm: MarketRealm
  name: string
  note?: string
  url: string
  folderId?: string
}

export interface SavedMarketSearchPatch {
  id: string
  name?: string
  note?: string
  folderId?: string | null
}

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
  item: LibraryItemSnapshot
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

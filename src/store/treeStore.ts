import { create } from 'zustand'







import type { BuildRealm, TreeData, SavedBuild } from '@/types/tree'
import { LANGUAGE_OPTIONS, getLocalizedSearchText, loadTranslations, type Language } from '@/i18n/translationLoader'
import { decodeBuildCode, encodeBuildCode, getBuildActiveWeaponSet, getBuildCharacterLevel, getEncodeClassPayload } from '@/engine/buildCode'
import { calculateBuild, rankSkillsByEffectiveDps } from '@/engine/pobLuaClient'
import { clearPersistedImportedBuild, getInitialImportedBuildCode } from '@/engine/buildPersistence'
import { createActiveBuildSession, type ActiveBuildSession } from '@/engine/pobBuildSession'
import type { PobBuildChange, PobBuildCommand, PobTreeState } from '@/engine/pobBuildObject'
import { parseEquipmentObject } from '@/engine/equipment'
import { DEFAULT_BUILD_REALM, inferBuildRealm } from '@/engine/buildRealm'
import { getRenderTreePoint, getSelectedAscendancyProjection } from '@/engine/treeRenderShared'
import { parseTreeDataResource } from '@/engine/treeDataResource'
import { resolveTreeAscendancy, resolveTreeClass } from '@/engine/treeClassResolution'
import {
  cleanAttributeSelections,
  nextAttributeSelection,
  type AttributeSelection,
  type NodeAttributeSelections,
} from '@/engine/attributeNodes'
import {
  allocateNode,
  buildAvailableAndDepends,
  deallocateNode,
  type AllocationContext,
  type NodeWeaponSets,
} from '@/engine/passiveAllocation'







import type {
  CalcResult,
  CalcApiResponse,
  CalculationConfigSnapshot,
  CalculationConfigValue,
  LocalCalculationProfile,
  SkillCalculationMode,
  SkillDpsRankEntry,
} from '@/types/calc'
import { mapSystemLanguage } from '@/engine/systemLocale'

export const MIN_ZOOM = 0.01
export const DEFAULT_ZOOM = 0.2
export const MAX_ZOOM = 0.5
export const FALLBACK_TREE_VERSIONS = ['0_5', '0_4']
export const DEFAULT_TREE_VERSION = FALLBACK_TREE_VERSIONS[0]
const LANGUAGE_STORAGE_KEY = 'pob2-language'

let treeVersionsPromise: Promise<string[]> | null = null
const searchIndexCache = new WeakMap<TreeData, Map<string, Array<[string, string]>>>()

function getSearchIndex(treeData: TreeData, language: Language, translationRevision: number): Array<[string, string]> {
  const cacheKey = `${language}:${translationRevision}`
  let indexes = searchIndexCache.get(treeData)
  if (!indexes) {
    indexes = new Map()
    searchIndexCache.set(treeData, indexes)
  }
  const cached = indexes.get(cacheKey)
  if (cached) return cached

  const index = Object.entries(treeData.nodes)
    // Decorative nodes have text in the upstream data, but cannot be focused,
    // highlighted, or allocated in the interactive tree.
    .filter(([, node]) => node.type !== 'OnlyImage')
    .map(([id, node]) => [
      id,
      `${id}\n${node.type}\n${getLocalizedSearchText(node, language)}`,
    ]) as Array<[string, string]>
  indexes.set(cacheKey, index)
  return index
}

export async function loadTreeVersions(): Promise<string[]> {
  if (treeVersionsPromise) return treeVersionsPromise
  treeVersionsPromise = fetch('/data/tree-versions.json')
    .then(async (resp) => {
      if (!resp.ok) return FALLBACK_TREE_VERSIONS
      const versions = await resp.json()
      return Array.isArray(versions) && versions.every((v) => typeof v === 'string')
        ? versions
        : FALLBACK_TREE_VERSIONS
    })
    .catch(() => FALLBACK_TREE_VERSIONS)
  return treeVersionsPromise
}















// ---- Snapshot for undo/redo ----

interface Snapshot {
  allocatedNodes: string[]
  availableNodes: string[]
  nodeWeaponSets: NodeWeaponSets
  nodeAttributeSelections: NodeAttributeSelections
  /** Canonical PoB XML at the point this tree snapshot was captured. */
  pobXml?: string | null
}

const MAX_UNDO = 50

function getAllocationContext(state: Pick<TreeStore, 'treeData' | 'selectedClassId' | 'selectedAscendancyId'>): AllocationContext | null {
  if (!state.treeData) return null
  return {
    treeData: state.treeData,
    selectedClassId: state.selectedClassId,
    selectedAscendancyId: state.selectedAscendancyId,
  }
}

function recomputeAllocationState(
  ctx: AllocationContext | null,
  allocatedNodes: Set<string>,
  nodeWeaponSets: NodeWeaponSets,
) {
  if (!ctx) {
    return {
      allocatedNodes,
      availableNodes: new Set<string>(),
      nodeWeaponSets,
    }
  }
  return buildAvailableAndDepends(ctx, allocatedNodes, nodeWeaponSets)
}

function snapshotFromState(
  allocatedNodes: Set<string>,
  availableNodes: Set<string>,
  nodeWeaponSets: NodeWeaponSets,
  nodeAttributeSelections: NodeAttributeSelections,
): Snapshot {
  let pobXml: string | null = null
  try {
    pobXml = activeBuildSession?.object.snapshot().xml || null
  } catch {
    // Tree editing remains available for legacy builds without a live object.
  }
  return {
    allocatedNodes: [...allocatedNodes],
    availableNodes: [...availableNodes],
    nodeWeaponSets: { ...nodeWeaponSets },
    nodeAttributeSelections: { ...nodeAttributeSelections },
    pobXml,
  }
}

function defaultAttributeSelections(
  treeData: TreeData | undefined,
  allocatedNodes: Set<string>,
  existing: NodeAttributeSelections = {},
): NodeAttributeSelections {
  return cleanAttributeSelections(treeData?.nodes, allocatedNodes, existing)
}

function getInitialLanguage(): Language {
  const systemLanguage = mapSystemLanguage()
  if (typeof localStorage === 'undefined') return systemLanguage
  const saved = localStorage.getItem(LANGUAGE_STORAGE_KEY)
  return LANGUAGE_OPTIONS.some((option) => option.value === saved) ? saved as Language : systemLanguage
}

// ============================================================















interface TreeStore {







  // ----        ----







  treeData: TreeData | null







  loading: boolean







  error: string | null







  treeVersion: string
  language: Language
  translationRevision: number







  selectedClassId: string



  selectedAscendancyId: string

  importedBuildCode: string | null
  /** Renderer-visible revision of the active PoB XML object. */
  pobBuildRevision: number
  /** Returns the latest Code generated from the active PoB object. */
  getActivePobCode: () => string | null
  /** Returns the latest XML snapshot from the active PoB object. */
  getActivePobXml: () => string | null
  /** Returns the active Tree Spec projection from the canonical PoB object. */
  getActivePobTreeState: () => PobTreeState | null
  /** Returns all Tree Specs and the active index from the canonical object. */
  getActivePobTreeSpecStates: () => { activeSpecIndex: number; specs: PobTreeState[] } | null
  /** Returns passive jewel records referenced by the active Tree Spec. */
  getActivePobTreeJewelItems: () => import('@/engine/buildCode').NodeJewels
  /** Returns the exact Raw and Item id referenced by a passive jewel socket. */
  getActivePobTreeJewelRaw: (nodeId: string) => { itemId: string; raw: string } | null
  /** Stable id used when saving items from an unsaved in-memory build. */
  getActiveBuildLibraryId: () => string















  // ----        ----







  offsetX: number







  offsetY: number







  zoom: number















  // ----        ----







  hoveredNodeId: string | null







  selectedNodeId: string | null







  mouseX: number







  mouseY: number







  searchQuery: string















  // ----                 ----







  allocatedNodes: Set<string>
  treeEditMode: boolean
  weaponSetMode: 0 | 1 | 2
  activeWeaponSet: 1 | 2
  nodeWeaponSets: Record<string, 1 | 2>
  nodeAttributeSelections: NodeAttributeSelections
  masterySelections: Record<string, string>
  pendingMasteryNode: string | null
  specs: Array<{ id: string; title: string; nodes: string[] }>
  activeSpecId: string







  availableNodes: Set<string>















  // ----              ----







  searchMatchIds: string[]
  searchMatchCount: number















  // ----       /       ----







  undoStack: Snapshot[]







  redoStack: Snapshot[]















  // ----        (Phase 7) ----







  calcResult: CalcResult | null







  calcLoading: boolean







  calcError: string | null

  calculationProfiles: LocalCalculationProfile[]
  activeCalculationProfileId: string
  calculationConfig: CalculationConfigSnapshot | null















  // ---- Saved Builds (Phase 16.7) ----
  buildRealm: BuildRealm
  savedBuilds: SavedBuild[]
  loadSavedBuilds: () => void
  setBuildRealm: (realm: BuildRealm) => void


  // ---- Actions ----







  loadTreeData: () => Promise<void>







  setTreeVersion: (version: string) => Promise<void>



  selectClass: (classId: string) => void



  selectAscendancy: (ascendancyId: string) => void







  setOffset: (x: number, y: number) => void







  setZoom: (zoom: number) => void







  panBy: (dx: number, dy: number) => void







  zoomAt: (cx: number, cy: number, factor: number, viewportW?: number, viewportH?: number) => void







  setHoveredNode: (id: string | null) => void







  setSelectedNode: (id: string | null) => void







  setMousePos: (x: number, y: number) => void







  setSearchQuery: (q: string) => void
  setLanguage: (language: Language) => void







  performSearch: (q: string) => void







  importAllocatedNodes: (
    ids: string[],
    nodeWeaponSets?: NodeWeaponSets,
    options?: {
      treeVersion?: string
      classId?: string
      classInternalId?: string
      ascendClassId?: string
      ascendancyInternalId?: string
      importedBuildCode?: string
      nodeAttributeSelections?: NodeAttributeSelections
    },
  ) => void | Promise<void>







  clearAllocatedNodes: () => void















  toggleNode: (id: string) => void
  allocateNodeWithAttribute: (id: string, selection: AttributeSelection) => void
  cycleAttributeNode: (id: string) => void
  setTreeEditMode: (enabled: boolean) => void
  setWeaponSetMode: (mode: 0 | 1 | 2) => void
  setActiveWeaponSet: (weaponSet: 1 | 2) => void
  setActiveItemSet: (itemSetId: string) => void
  setEquipmentSlotItem: (itemSetId: string, slotName: string, itemId: string) => void
  replaceEquipmentSlotWithRaw: (itemSetId: string, slotName: string, raw: string) => string | null
  replaceEquipmentItemRaw: (itemId: string, raw: string) => void
  bindTreeJewelRaw: (nodeId: string, raw: string) => void
  unbindTreeJewel: (nodeId: string) => void
  updateSkillGem: (
    skillSetId: string,
    skillIndex: number,
    gemIndex: number,
    attributes: Record<string, string | undefined>,
  ) => void
  updateSkillGroup: (
    skillSetId: string,
    skillIndex: number,
    attributes: Record<string, string | undefined>,
  ) => void
  setActiveSkillSet: (skillSetId: string) => void
  setMainSocketGroup: (groupId: string) => void
  selectMastery: (nodeId: string, effectId: string) => void
  cancelMastery: () => void
  addSpec: (title: string) => void
  switchSpec: (specId: string) => void
  deleteSpec: (specId: string) => void







  undo: () => void







  redo: () => void







  getAllocatedIds: () => string[]















  /** Phase 4.3: Encode allocated nodes to URL hash */







  encodeToHash: () => string







  /** Phase 4.3: Load allocated nodes from URL hash */







  loadFromHash: (hash: string) => void | Promise<void>















  /** Phase 7: Run build calculation from allocated nodes */







  runCalculation: (selection?: {
    itemSetId?: string
    weaponSet?: 1 | 2
    skillGroupId?: string
    calcMode?: SkillCalculationMode
    activeSkillIndex?: number
    statSetIndex?: number
    actor?: 'auto' | 'player' | 'minion'
    minionSkillIndex?: number
    minionStatSetIndex?: number
    includeConfig?: boolean
  }) => Promise<void>

  rankSkillsByDps: (groupIds: string[], weaponSet?: 1 | 2) => Promise<SkillDpsRankEntry[]>







  /** Phase 7: Clear calculation result */







  clearCalcResult: () => void
  applyPobBuildCommand: (command: PobBuildCommand) => PobBuildChange | null
  setActiveCalculationProfile: (id: string) => void
  addCalculationProfile: (copyCurrent?: boolean) => void
  renameCalculationProfile: (id: string, name: string) => void
  deleteCalculationProfile: (id: string) => void
  setCalculationConfigValue: (key: string, value?: CalculationConfigValue) => void
  resetCalculationConfig: () => void







  // ---- Saved Builds (Phase 16.7) ----
  saveBuild: (
    name: string,
    id?: string | null,
    source?: SavedBuild['source'],
    sourceUrl?: string | null,
    metadata?: Partial<Pick<SavedBuild, 'description' | 'tags' | 'createdAt' | 'updatedAt' | 'lastOpenedAt' | 'nativeRevision'>>,
  ) => string
  loadBuild: (id: string) => Promise<void>
  deleteBuild: (id: string) => void


}















let calculationRequestId = 0
let activeBuildSession: ActiveBuildSession | null = null
let activeUnsavedBuildLibraryId = `unsaved-${globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`}`

export function getActiveBuildSession(): ActiveBuildSession | null {
  return activeBuildSession
}

function replaceActiveBuildSession(buildId: string | null, code: string | null | undefined): void {
  activeBuildSession?.dispose()
  activeBuildSession = null
  activeUnsavedBuildLibraryId = buildId || `unsaved-${globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`}`
  if (!code?.trim()) return
  try {
    activeBuildSession = createActiveBuildSession(buildId, code)
  } catch {
    // Keep the existing Code compatibility path available for malformed legacy data.
  }
}

function getActiveBuildCode(fallback: string | null | undefined): string | null {
  try {
    return activeBuildSession?.object.toCode() || fallback || null
  } catch {
    return fallback || null
  }
}

/**
 * Migrate the legacy saved UI weapon-set value into the canonical build XML.
 * Older saved builds can contain a different activeWeaponSet than their PoB
 * code. Calculations must only read the PobBuildObject, so reconcile this
 * compatibility metadata immediately after loading the object.
 */
function syncLoadedWeaponSetToBuildObject(requestedWeaponSet: 1 | 2): 1 | 2 {
  const session = activeBuildSession
  if (!session) return requestedWeaponSet

  try {
    const equipment = parseEquipmentObject(session.object)
    const itemSet = equipment?.itemSets.find((entry) => entry.id === equipment.activeItemSetId)
      || equipment?.itemSets[0]
    if (!itemSet) return requestedWeaponSet

    const useSecondWeaponSet = requestedWeaponSet === 2
    session.apply({
      type: 'set-equipment-selection',
      itemSetId: itemSet.id,
      useSecondWeaponSet,
      section: 'items',
    })
  } catch {
    // Keep loading legacy or incomplete builds even when their Items section
    // cannot be reconciled.
  }
  return requestedWeaponSet
}

function buildTreeStateCommand(state: Pick<
  TreeStore,
  'allocatedNodes' | 'nodeWeaponSets' | 'nodeAttributeSelections' | 'treeVersion'
  | 'selectedClassId' | 'selectedAscendancyId' | 'treeData' | 'masterySelections'
>): PobBuildCommand {
  const classPayload = getEncodeClassPayload(state.treeData || undefined, state.selectedClassId, state.selectedAscendancyId)
  const nodeIds = new Set(state.allocatedNodes)
  const nodesForWeaponSet = (weaponSet: 1 | 2) => Object.entries(state.nodeWeaponSets)
    .filter(([nodeId, assigned]) => assigned === weaponSet && nodeIds.has(nodeId))
    .map(([nodeId]) => nodeId)
  const selectedAttributes = Object.entries(state.nodeAttributeSelections)
    .filter(([nodeId, selection]) => nodeIds.has(nodeId) && (selection === 1 || selection === 2 || selection === 3))
  const currentTreeState = activeBuildSession?.object.getTreeState()
  return {
    type: 'replace-tree-state',
    state: {
      treeVersion: state.treeVersion,
      classId: classPayload.classId,
      ascendClassId: classPayload.ascendClassId,
      classInternalId: classPayload.classInternalId,
      ascendancyInternalId: classPayload.ascendancyInternalId,
      className: classPayload.className,
      ascendancyName: classPayload.ascendancyName,
      nodes: [...state.allocatedNodes],
      masterySelections: { ...state.masterySelections },
      jewelSockets: { ...(currentTreeState?.jewelSockets || {}) },
      weaponSet1Nodes: nodesForWeaponSet(1),
      weaponSet2Nodes: nodesForWeaponSet(2),
      attributeOverride: {
        strNodes: selectedAttributes.filter(([, selection]) => selection === 1).map(([nodeId]) => nodeId),
        dexNodes: selectedAttributes.filter(([, selection]) => selection === 2).map(([nodeId]) => nodeId),
        intNodes: selectedAttributes.filter(([, selection]) => selection === 3).map(([nodeId]) => nodeId),
      },
    } satisfies PobTreeState,
    section: 'tree',
  }
}

function syncTreeObjectFromStore(getState: () => TreeStore): void {
  if (!activeBuildSession) return
  try {
    getState().applyPobBuildCommand(buildTreeStateCommand(getState()))
  } catch {
    // Legacy or incomplete XML without a Tree section keeps the compatibility path.
  }
}

function buildStoreSpecs(treeSpecs: PobTreeState[] | undefined): Array<{ id: string; title: string; nodes: string[] }> {
  return treeSpecs?.length
    ? treeSpecs.map((spec, index) => ({ id: `xml-spec-${index + 1}`, title: `Tree ${index + 1}`, nodes: [...spec.nodes] }))
    : [{ id: 'default', title: 'Tree 1', nodes: [] }]
}

const DEFAULT_CALCULATION_PROFILE: LocalCalculationProfile = { id: 'default', name: 'Default', values: {} }

function normalizeCalculationProfiles(
  profiles: LocalCalculationProfile[] | undefined,
  activeId?: string,
): { profiles: LocalCalculationProfile[]; activeId: string } {
  const normalized = Array.isArray(profiles) && profiles.length
    ? profiles.map((profile) => ({ ...profile, values: { ...(profile.values || {}) } }))
    : [{ ...DEFAULT_CALCULATION_PROFILE, values: {} }]
  return {
    profiles: normalized,
    activeId: normalized.some((profile) => profile.id === activeId) ? activeId! : normalized[0].id,
  }
}

export const useTreeStore = create<TreeStore>((set, get) => ({







  // ----              ----







  treeData: null,







  loading: false,







  error: null,







  treeVersion: DEFAULT_TREE_VERSION,
  language: getInitialLanguage(),
  translationRevision: 0,







  selectedClassId: '6',



  selectedAscendancyId: 'Stormweaver',

  importedBuildCode: getInitialImportedBuildCode(),
  pobBuildRevision: 0,







  offsetX: 0,







  offsetY: 0,







  zoom: DEFAULT_ZOOM,







  hoveredNodeId: null,







  selectedNodeId: null,







  mouseX: 0,







  mouseY: 0,







  searchQuery: '',







  searchMatchIds: [],
  searchMatchCount: 0,







  allocatedNodes: new Set(),
  treeEditMode: false,
  weaponSetMode: 0 as 0 | 1 | 2,
  activeWeaponSet: 1 as 1 | 2,
  nodeWeaponSets: {} as Record<string, 1 | 2>,
  nodeAttributeSelections: {} as NodeAttributeSelections,
  masterySelections: {} as Record<string, string>,
  pendingMasteryNode: null,
  specs: [{ id: 'default', title: 'Tree 1', nodes: [] }],
  activeSpecId: 'default',







  availableNodes: new Set(),







  undoStack: [],







  redoStack: [],















  // ----                    ----







  calcResult: null,







  calcLoading: false,







  calcError: null,

  calculationProfiles: [{ ...DEFAULT_CALCULATION_PROFILE, values: {} }],
  activeCalculationProfileId: 'default',
  calculationConfig: null,

  // ---- Saved Builds (Phase 16.7) ----
  buildRealm: DEFAULT_BUILD_REALM,
  savedBuilds: [],


  // ---- Actions ----







  loadTreeData: async () => {







    const { loading, treeVersion } = get()







    if (loading) return







    set({ loading: true, error: null })







    try {
      await loadTranslations(get().language).catch(() => undefined)







      const resp = await fetch(`/data/tree-web-${treeVersion}.json`)







      if (!resp.ok) throw new Error(`HTTP ${resp.status}`)







      const data = parseTreeDataResource(await resp.json(), treeVersion)
      const classes = data.constants.classes || {}
      const selectedClassExists = !!classes[get().selectedClassId]
      const nextClassId = selectedClassExists
        ? get().selectedClassId
        : (Object.keys(classes)[0] || '')
      const classData = classes[nextClassId]
      const selectedAscExists = classData?.ascendancies?.some((asc) => (
        asc.id === get().selectedAscendancyId || asc.name === get().selectedAscendancyId
      ))
      const firstAsc = classData?.ascendancies?.[0]
      const nextAscendancyId = selectedAscExists
        ? get().selectedAscendancyId
        : (firstAsc?.id || firstAsc?.name || '')







      const rebuilt = recomputeAllocationState(
        { treeData: data, selectedClassId: nextClassId, selectedAscendancyId: nextAscendancyId },
        get().allocatedNodes,
        get().nodeWeaponSets,
      )
      const nextAttributeSelections = defaultAttributeSelections(data, rebuilt.allocatedNodes, get().nodeAttributeSelections)
      set({
        treeData: data,
        selectedClassId: nextClassId,
        selectedAscendancyId: nextAscendancyId,
        loading: false,
        allocatedNodes: rebuilt.allocatedNodes,
        availableNodes: rebuilt.availableNodes,
        nodeWeaponSets: rebuilt.nodeWeaponSets,
        nodeAttributeSelections: nextAttributeSelections,
      })















      //                   







      const c = data.constants







      const cx = (c.min_x + c.max_x) / 2







      const cy = (c.min_y + c.max_y) / 2







      set({ offsetX: -cx, offsetY: -cy })







    } catch (err: unknown) {







      const msg = err instanceof Error ? err.message : String(err)







      set({ error: msg, loading: false })







    }







  },















  setTreeVersion: async (version: string) => {







    const prev = get().treeVersion







    if (version === prev) return







    set({







      treeVersion: version,







      treeData: null,







      loading: false,







      error: null,







      allocatedNodes: new Set(),







      availableNodes: new Set(),







      nodeWeaponSets: {},
      nodeAttributeSelections: {},







      undoStack: [],







      redoStack: [],







      calcResult: null,







      calcError: null,







    })







    // Re-trigger load







    await get().loadTreeData()
    syncTreeObjectFromStore(get)







  },















  setOffset: (x, y) => set({ offsetX: x, offsetY: y }),







  setZoom: (zoom) => set({ zoom: Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom)) }),







  panBy: (dx, dy) => {







    const { offsetX, offsetY } = get()







    set({ offsetX: offsetX + dx, offsetY: offsetY + dy })







  },







  zoomAt: (cx, cy, factor, viewportW = window.innerWidth, viewportH = window.innerHeight) => {







    const { zoom, offsetX, offsetY } = get()







    const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom * factor))
    const treeX = (cx - viewportW / 2) / zoom - offsetX
    const treeY = (cy - viewportH / 2) / zoom - offsetY







    //                 (cx, cy)                







    const newX = (cx - viewportW / 2) / newZoom - treeX







    const newY = (cy - viewportH / 2) / newZoom - treeY







    set({ zoom: newZoom, offsetX: newX, offsetY: newY })







  },















  setHoveredNode: (id) => set({ hoveredNodeId: id }),







  setSelectedNode: (id) => set({ selectedNodeId: id }),







  setMousePos: (x, y) => set({ mouseX: x, mouseY: y }),







  setSearchQuery: (q) => {







    set({ searchQuery: q })














  },







  setLanguage: (language) => {
    try {
      localStorage.setItem(LANGUAGE_STORAGE_KEY, language)
    } catch {
      // Ignore storage failures in private mode or restricted environments.
    }
    set({ language })
    void loadTranslations(language).catch(() => undefined).finally(() => {
      set((state) => ({ translationRevision: state.translationRevision + 1 }))
      get().performSearch(get().searchQuery)
    })
  },

  performSearch: (q) => {







    const { treeData, language, translationRevision, selectedClassId, selectedAscendancyId } = get()







    if (!treeData || !q.trim()) {







      set({ searchMatchIds: [], searchMatchCount: 0, selectedNodeId: null })







      return







    }







    const lower = q.toLowerCase()







    const matches: string[] = []
    let matchCount = 0







    for (const [id, haystack] of getSearchIndex(treeData, language, translationRevision)) {







      if (haystack.includes(lower)) {







        matchCount += 1
        // Keep the visual overlay bounded; the toolbar reports the complete count.
        if (matches.length < 100) matches.push(id)







      }














    }







    const firstMatch = matches[0]
    const firstNode = firstMatch ? treeData.nodes[firstMatch] : null
    const projection = getSelectedAscendancyProjection(treeData, selectedClassId, selectedAscendancyId)
    const [focusX, focusY] = firstNode ? getRenderTreePoint(firstNode, projection) : [0, 0]
    set({
      searchMatchIds: matches,
      searchMatchCount: matchCount,
      selectedNodeId: firstMatch || null,
      ...(firstNode ? { offsetX: -focusX, offsetY: -focusY } : {}),
    })







  },















  importAllocatedNodes: async (ids: string[], importedWeaponSets: NodeWeaponSets = {}, options = {}) => {
    const targetTreeVersion = options.treeVersion?.trim()
    if (!targetTreeVersion) throw new Error('The imported build does not specify a passive tree version')
    if (targetTreeVersion !== get().treeVersion) {
      set({ treeVersion: targetTreeVersion })
      await get().loadTreeData()
    }

    const tree = get().treeData
    if (!tree || tree.version.version !== targetTreeVersion) {
      throw new Error(`Passive tree data ${targetTreeVersion} is unavailable`)
    }
    const classEntry = resolveTreeClass(tree || undefined, options)
    if (!classEntry) throw new Error('The imported build class could not be resolved')
    const [selectedClassId, classData] = classEntry
    const selectedAscendancyId = resolveTreeAscendancy(classData, options)
    const requestedAscendancy = options.ascendancyInternalId || options.ascendClassId
    if (requestedAscendancy && !['0', 'nil'].includes(requestedAscendancy.toLowerCase()) && !selectedAscendancyId) {
      throw new Error(`The imported ascendancy "${requestedAscendancy}" could not be resolved`)
    }

    const ctx = { treeData: tree, selectedClassId, selectedAscendancyId }
    const next = new Set<string>()
    for (const id of ids) {
      const node = tree.nodes[id]
      if (node && node.type !== 'ClassStart' && node.type !== 'AscendClassStart') next.add(id)
    }
    const rebuilt = recomputeAllocationState(ctx, next, importedWeaponSets)
    const nextAttributeSelections = defaultAttributeSelections(
      ctx?.treeData,
      rebuilt.allocatedNodes,
      options.nodeAttributeSelections,
    )
    if (options.importedBuildCode !== undefined) {
      replaceActiveBuildSession(null, options.importedBuildCode || null)
    }
    let importedTreeState: PobTreeState | undefined
    try { importedTreeState = activeBuildSession?.object.getTreeState() }
    catch { importedTreeState = undefined }
    let importedSpecStates: { activeSpecIndex: number; specs: PobTreeState[] } | undefined
    try { importedSpecStates = activeBuildSession?.object.getTreeSpecStates() }
    catch { importedSpecStates = undefined }
    set({
      selectedClassId,
      selectedAscendancyId,
      allocatedNodes: rebuilt.allocatedNodes,
      availableNodes: rebuilt.availableNodes,
      treeEditMode: false,
      weaponSetMode: 0,
      activeWeaponSet: getBuildActiveWeaponSet(options.importedBuildCode),
      nodeWeaponSets: rebuilt.nodeWeaponSets,
      nodeAttributeSelections: nextAttributeSelections,
      masterySelections: { ...(importedTreeState?.masterySelections || {}) },
      pendingMasteryNode: null,
      specs: importedSpecStates ? buildStoreSpecs(importedSpecStates.specs) : [{ id: 'default', title: 'Tree 1', nodes: [...rebuilt.allocatedNodes] }],
      activeSpecId: importedSpecStates ? `xml-spec-${importedSpecStates.activeSpecIndex}` : 'default',
      importedBuildCode: options.importedBuildCode || null,
      pobBuildRevision: activeBuildSession?.revision ?? 0,
      hoveredNodeId: null,
      selectedNodeId: null,
      searchQuery: '',
      searchMatchIds: [],
      searchMatchCount: 0,
      zoom: DEFAULT_ZOOM,
      offsetX: -(tree.constants.min_x + tree.constants.max_x) / 2,
      offsetY: -(tree.constants.min_y + tree.constants.max_y) / 2,
      undoStack: [],
      redoStack: [],
      calcResult: null,
      calcLoading: false,
      calcError: null,
      calculationProfiles: [{ ...DEFAULT_CALCULATION_PROFILE, values: {} }],
      activeCalculationProfileId: 'default',
      calculationConfig: null,
    })
    // The imported Code may only carry PoB's internal class identifiers.
    // Reconcile the resolved Store projection back into the canonical object
    // before any immediate export or calculation reads it.
    syncTreeObjectFromStore(get)
  },

  clearAllocatedNodes: () => {
    clearPersistedImportedBuild(localStorage)
    replaceActiveBuildSession(null, null)
    set({
      allocatedNodes: new Set(),
      availableNodes: new Set(),
      nodeWeaponSets: {},
      nodeAttributeSelections: {},
      importedBuildCode: null,
      pobBuildRevision: 0,
      activeWeaponSet: 1,
      calculationProfiles: [{ ...DEFAULT_CALCULATION_PROFILE, values: {} }],
      activeCalculationProfileId: 'default',
      calculationConfig: null,
      undoStack: [],
      redoStack: [],
    })
  },

  // === Phase 3.1: Node toggle & undo/redo ===















  selectMastery: (nodeId, effectId) => {
    set((s) => ({
      masterySelections: { ...s.masterySelections, [nodeId]: effectId },
      pendingMasteryNode: null,
    }))
    syncTreeObjectFromStore(get)
  },

  addSpec: (title) => {
    const id = 'spec_' + Date.now()
    set((s) => ({ specs: [...s.specs, { id, title, nodes: [] }] }))
  },

  switchSpec: (specId) => {
    const state = get()
    const specIndex = state.specs.findIndex((spec) => spec.id === specId)
    if (specIndex < 0) return
    if (state.activeSpecId === specId) return
    // Persist the current Store projection into the current XML Spec before
    // changing the active index; other Specs remain untouched in the AST.
    syncTreeObjectFromStore(get)
    const change = state.applyPobBuildCommand({ type: 'set-active-tree-spec', specIndex: specIndex + 1, section: 'tree' })
    if (!change) return
    const nextTree = get().getActivePobTreeState()
    if (!nextTree) return
    const treeData = get().treeData
    const classEntry = resolveTreeClass(treeData || undefined, nextTree)
    const selectedClassId = classEntry?.[0] || get().selectedClassId
    const selectedAscendancyId = classEntry ? resolveTreeAscendancy(classEntry[1], nextTree) : get().selectedAscendancyId
    const nodeWeaponSets: NodeWeaponSets = {}
    for (const nodeId of nextTree.weaponSet1Nodes || []) nodeWeaponSets[nodeId] = 1
    for (const nodeId of nextTree.weaponSet2Nodes || []) nodeWeaponSets[nodeId] = 2
    const ctx = treeData ? { treeData, selectedClassId, selectedAscendancyId } : null
    const rebuilt = recomputeAllocationState(ctx, new Set(nextTree.nodes), nodeWeaponSets)
    const nodeAttributeSelections = defaultAttributeSelections(treeData || undefined, rebuilt.allocatedNodes, {
      ...Object.fromEntries((nextTree.attributeOverride?.strNodes || []).map((id) => [id, 1])),
      ...Object.fromEntries((nextTree.attributeOverride?.dexNodes || []).map((id) => [id, 2])),
      ...Object.fromEntries((nextTree.attributeOverride?.intNodes || []).map((id) => [id, 3])),
    })
    const specStates = get().getActivePobTreeSpecStates()
    set({
      activeSpecId: specId,
      selectedClassId,
      selectedAscendancyId,
      allocatedNodes: rebuilt.allocatedNodes,
      availableNodes: rebuilt.availableNodes,
      nodeWeaponSets: rebuilt.nodeWeaponSets,
      nodeAttributeSelections,
      masterySelections: { ...(nextTree.masterySelections || {}) },
      specs: specStates ? buildStoreSpecs(specStates.specs) : state.specs,
      calcResult: null,
      calcError: null,
    })
    syncTreeObjectFromStore(get)
  },

  deleteSpec: (specId) => {
    set((s) => ({ specs: s.specs.filter((sp) => sp.id !== specId) }))
  },

  cancelMastery: () => set({ pendingMasteryNode: null }),

  setWeaponSetMode: (mode) => {
    set({ weaponSetMode: mode })
  },

  setActiveWeaponSet: (activeWeaponSet) => {
    const session = getActiveBuildSession()
    if (session) {
      try {
        const equipment = parseEquipmentObject(session.object)
        const itemSetId = equipment?.activeItemSetId || equipment?.itemSets[0]?.id
        if (itemSetId) {
          get().applyPobBuildCommand({
            type: 'set-equipment-selection',
            itemSetId,
            useSecondWeaponSet: activeWeaponSet === 2,
            section: 'items',
          })
        }
      } catch {
        // Keep the UI weapon-set selector usable for legacy/incomplete builds.
      }
    }
    if (get().activeWeaponSet === activeWeaponSet) return
    calculationRequestId += 1
    set({ activeWeaponSet, calcResult: null, calcError: null, calcLoading: false })
  },

  setActiveItemSet: (itemSetId) => {
    const session = getActiveBuildSession()
    const equipment = session ? parseEquipmentObject(session.object) : null
    const selected = equipment?.itemSets.find((itemSet) => itemSet.id === itemSetId)
    get().applyPobBuildCommand({
      type: 'set-equipment-selection',
      itemSetId,
      useSecondWeaponSet: selected?.useSecondWeaponSet ?? get().activeWeaponSet === 2,
      section: 'items',
    })
    if (selected) set({ activeWeaponSet: selected.useSecondWeaponSet ? 2 : 1, calcResult: null, calcError: null })
  },

  setEquipmentSlotItem: (itemSetId, slotName, itemId) => {
    get().applyPobBuildCommand({ type: 'set-equipment-slot', itemSetId, slotName, itemId, section: 'items' })
  },

  replaceEquipmentSlotWithRaw: (itemSetId, slotName, raw) => {
    const change = get().applyPobBuildCommand({ type: 'replace-equipment-slot-raw', itemSetId, slotName, raw, section: 'items' })
    if (!change?.changed) return null
    const session = getActiveBuildSession()
    const equipment = session ? parseEquipmentObject(session.object) : null
    return equipment?.itemSets.find((itemSet) => itemSet.id === itemSetId)?.slots.find((slot) => slot.name === slotName)?.itemId || null
  },

  replaceEquipmentItemRaw: (itemId, raw) => {
    get().applyPobBuildCommand({ type: 'replace-item-raw', itemId, raw, section: 'items' })
  },

  bindTreeJewelRaw: (nodeId, raw) => {
    const state = get()
    const node = state.treeData?.nodes[nodeId]
    if (!node || (!node.isJewelSocket && node.type !== 'JewelSocket' && node.type !== 'Socket')) return
    if (!state.allocatedNodes.has(nodeId)) return
    const snap = snapshotFromState(
      state.allocatedNodes,
      state.availableNodes,
      state.nodeWeaponSets,
      state.nodeAttributeSelections,
    )
    const change = get().applyPobBuildCommand({ type: 'bind-tree-jewel-raw', nodeId, raw, section: 'tree' })
    if (!change?.changed) return
    set((current) => ({
      undoStack: [...current.undoStack.slice(-MAX_UNDO + 1), snap],
      redoStack: [],
    }))
  },

  unbindTreeJewel: (nodeId) => {
    const state = get()
    const node = state.treeData?.nodes[nodeId]
    if (!node || (!node.isJewelSocket && node.type !== 'JewelSocket' && node.type !== 'Socket')) return
    if (!state.allocatedNodes.has(nodeId)) return
    const snap = snapshotFromState(
      state.allocatedNodes,
      state.availableNodes,
      state.nodeWeaponSets,
      state.nodeAttributeSelections,
    )
    const change = get().applyPobBuildCommand({ type: 'set-tree-jewel-socket', nodeId, section: 'tree' })
    if (!change?.changed) return
    set((current) => ({
      undoStack: [...current.undoStack.slice(-MAX_UNDO + 1), snap],
      redoStack: [],
    }))
  },

  updateSkillGem: (skillSetId, skillIndex, gemIndex, attributes) => {
    get().applyPobBuildCommand({ type: 'update-skill-gem', skillSetId, skillIndex, gemIndex, attributes, section: 'skills' })
  },

  updateSkillGroup: (skillSetId, skillIndex, attributes) => {
    get().applyPobBuildCommand({ type: 'update-skill-group', skillSetId, skillIndex, attributes, section: 'skills' })
  },

  setActiveSkillSet: (skillSetId) => {
    get().applyPobBuildCommand({ type: 'set-active-skill-set', skillSetId, section: 'skills' })
  },

  setMainSocketGroup: (groupId) => {
    get().applyPobBuildCommand({ type: 'set-main-socket-group', groupId, section: 'skills' })
  },

  setTreeEditMode: (enabled) => {
    set({ treeEditMode: enabled })
  },

  toggleNode: (id: string) => {
    const state = get()
    const ctx = getAllocationContext(state)
    if (!ctx) return

    const allocated = new Set(state.allocatedNodes)
    const snap = snapshotFromState(allocated, state.availableNodes, state.nodeWeaponSets, state.nodeAttributeSelections)
    const next = allocated.has(id)
      ? deallocateNode(ctx, allocated, state.nodeWeaponSets, id)
      : allocateNode(ctx, allocated, state.nodeWeaponSets, id, state.weaponSetMode)
    const nextAttributeSelections = defaultAttributeSelections(
      ctx.treeData,
      next.allocatedNodes,
      state.nodeAttributeSelections,
    )

    const changed = next.allocatedNodes.size !== state.allocatedNodes.size
      || next.availableNodes.size !== state.availableNodes.size
      || JSON.stringify(next.nodeWeaponSets) !== JSON.stringify(state.nodeWeaponSets)
      || JSON.stringify(nextAttributeSelections) !== JSON.stringify(state.nodeAttributeSelections)
    if (!changed) return

    set((s) => ({
      allocatedNodes: next.allocatedNodes,
      availableNodes: next.availableNodes,
      nodeWeaponSets: next.nodeWeaponSets,
      nodeAttributeSelections: nextAttributeSelections,
      undoStack: [...s.undoStack.slice(-MAX_UNDO + 1), snap],
      redoStack: [],
    }))
    syncTreeObjectFromStore(get)
  },

  allocateNodeWithAttribute: (id: string, selection: AttributeSelection) => {
    const state = get()
    const ctx = getAllocationContext(state)
    if (!ctx || ![1, 2, 3].includes(selection) || state.allocatedNodes.has(id)) return

    const allocated = new Set(state.allocatedNodes)
    const snap = snapshotFromState(allocated, state.availableNodes, state.nodeWeaponSets, state.nodeAttributeSelections)
    const next = allocateNode(ctx, allocated, state.nodeWeaponSets, id, state.weaponSetMode)
    const nextAttributeSelections = defaultAttributeSelections(
      ctx.treeData,
      next.allocatedNodes,
      state.nodeAttributeSelections,
    )
    for (const nodeId of next.allocatedNodes) {
      if (!allocated.has(nodeId) && ctx.treeData.nodes[nodeId]?.isAttribute) {
        nextAttributeSelections[nodeId] = selection
      }
    }

    const changed = next.allocatedNodes.size !== state.allocatedNodes.size
      || next.availableNodes.size !== state.availableNodes.size
      || JSON.stringify(next.nodeWeaponSets) !== JSON.stringify(state.nodeWeaponSets)
      || JSON.stringify(nextAttributeSelections) !== JSON.stringify(state.nodeAttributeSelections)
    if (!changed) return

    set((s) => ({
      allocatedNodes: next.allocatedNodes,
      availableNodes: next.availableNodes,
      nodeWeaponSets: next.nodeWeaponSets,
      nodeAttributeSelections: nextAttributeSelections,
      undoStack: [...s.undoStack.slice(-MAX_UNDO + 1), snap],
      redoStack: [],
    }))
    syncTreeObjectFromStore(get)
  },

  cycleAttributeNode: (id: string) => {
    const state = get()
    const ctx = getAllocationContext(state)
    const node = ctx?.treeData.nodes[id]
    if (!ctx || !node?.isAttribute || !state.allocatedNodes.has(id)) return

    const nextSelection = nextAttributeSelection(state.nodeAttributeSelections[id])
    const snap = snapshotFromState(
      state.allocatedNodes,
      state.availableNodes,
      state.nodeWeaponSets,
      state.nodeAttributeSelections,
    )

    set((s) => ({
      nodeAttributeSelections: {
        ...s.nodeAttributeSelections,
        [id]: nextSelection,
      },
      undoStack: [...s.undoStack.slice(-MAX_UNDO + 1), snap],
      redoStack: [],
    }))
    syncTreeObjectFromStore(get)
  },

  undo: () => {
    const { undoStack, allocatedNodes, availableNodes, nodeWeaponSets, nodeAttributeSelections } = get()
    if (undoStack.length === 0) return
    const snap = undoStack[undoStack.length - 1]
    const curSnap = snapshotFromState(allocatedNodes, availableNodes, nodeWeaponSets, nodeAttributeSelections)
    let restoredRevision = get().pobBuildRevision
    if (snap.pobXml !== undefined && activeBuildSession && snap.pobXml !== null) {
      restoredRevision = activeBuildSession.restoreXml(snap.pobXml).revision
    }
    set({
      allocatedNodes: new Set(snap.allocatedNodes),
      availableNodes: new Set(snap.availableNodes),
      nodeWeaponSets: { ...snap.nodeWeaponSets },
      nodeAttributeSelections: { ...snap.nodeAttributeSelections },
      pobBuildRevision: restoredRevision,
      undoStack: undoStack.slice(0, -1),
      redoStack: [...get().redoStack, curSnap],
    })
    if (typeof snap.pobXml !== 'string') syncTreeObjectFromStore(get)
  },

  redo: () => {
    const { redoStack, allocatedNodes, availableNodes, nodeWeaponSets, nodeAttributeSelections } = get()
    if (redoStack.length === 0) return
    const snap = redoStack[redoStack.length - 1]
    const curSnap = snapshotFromState(allocatedNodes, availableNodes, nodeWeaponSets, nodeAttributeSelections)
    let restoredRevision = get().pobBuildRevision
    if (snap.pobXml !== undefined && activeBuildSession && snap.pobXml !== null) {
      restoredRevision = activeBuildSession.restoreXml(snap.pobXml).revision
    }
    set({
      allocatedNodes: new Set(snap.allocatedNodes),
      availableNodes: new Set(snap.availableNodes),
      nodeWeaponSets: { ...snap.nodeWeaponSets },
      nodeAttributeSelections: { ...snap.nodeAttributeSelections },
      pobBuildRevision: restoredRevision,
      redoStack: redoStack.slice(0, -1),
      undoStack: [...get().undoStack, curSnap],
    })
    if (typeof snap.pobXml !== 'string') syncTreeObjectFromStore(get)
  },

  getAllocatedIds: () => [...get().allocatedNodes],















  // === Phase 4.3: URL hash sharing ===















  encodeToHash: () => {
    const ids = [...get().allocatedNodes].sort()
    if (ids.length === 0) return ''
    const state = get()
    const nodeWeaponSets = state.nodeWeaponSets
    const nodeAttributeSelections = defaultAttributeSelections(
      state.treeData || undefined,
      state.allocatedNodes,
      state.nodeAttributeSelections,
    )
    const classPayload = getEncodeClassPayload(
      state.treeData || undefined,
      state.selectedClassId,
      state.selectedAscendancyId,
    )
    const payload = JSON.stringify({
      nodes: ids,
      nodeWeaponSets,
      nodeAttributeSelections,
      treeVersion: state.treeVersion,
      classId: classPayload.classId,
      ascendClassId: classPayload.ascendClassId,
      classInternalId: classPayload.classInternalId,
      ascendancyInternalId: classPayload.ascendancyInternalId,
    })
    const bytes = new TextEncoder().encode(payload)
    let binary = ''
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  },

  loadFromHash: async (hash: string) => {
    if (!hash) return
    try {
      const base64 = hash.replace(/-/g, '+').replace(/_/g, '/')
      const binary = atob(base64)
      const bytes = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
      const str = new TextDecoder().decode(bytes)
      let ids: string[] = []
      let nodeWeaponSets: NodeWeaponSets = {}
      let nodeAttributeSelections: NodeAttributeSelections = {}
      let treeVersion: string | undefined
      let classId: string | undefined
      let classInternalId: string | undefined
      let ascendClassId: string | undefined
      let ascendancyInternalId: string | undefined
      if (str.trim().startsWith('{')) {
        const payload = JSON.parse(str) as {
          nodes?: string[]
          nodeWeaponSets?: NodeWeaponSets
          nodeAttributeSelections?: NodeAttributeSelections
          treeVersion?: string
          classId?: string
          ascendClassId?: string
          classInternalId?: string
          ascendancyInternalId?: string
        }
        ids = Array.isArray(payload.nodes) ? payload.nodes : []
        nodeWeaponSets = payload.nodeWeaponSets || {}
        nodeAttributeSelections = payload.nodeAttributeSelections || {}
        treeVersion = payload.treeVersion
        classId = payload.classId
        classInternalId = payload.classInternalId
        ascendClassId = payload.ascendClassId
        ascendancyInternalId = payload.ascendancyInternalId
      } else {
        ids = str.split(',').filter(Boolean)
      }
      if (ids.length > 0) {
        const state = get()
        if (treeVersion && treeVersion !== state.treeVersion) {
          set({ treeVersion })
          await get().loadTreeData()
        }
        const loaded = get()
        const classEntry = resolveTreeClass(loaded.treeData || undefined, { classId, classInternalId })
        if (classEntry) {
          const [resolvedClassId, classData] = classEntry
          set({
            selectedClassId: resolvedClassId,
            selectedAscendancyId: resolveTreeAscendancy(classData, { ascendClassId, ascendancyInternalId }),
          })
        }
        const ctx = getAllocationContext(get())
        if (!ctx) return
        const rebuilt = recomputeAllocationState(ctx, new Set(ids), nodeWeaponSets)
        const nextAttributeSelections = defaultAttributeSelections(ctx.treeData, rebuilt.allocatedNodes, nodeAttributeSelections)
        set({
          allocatedNodes: rebuilt.allocatedNodes,
          availableNodes: rebuilt.availableNodes,
          nodeWeaponSets: rebuilt.nodeWeaponSets,
          nodeAttributeSelections: nextAttributeSelections,
          undoStack: [],
          redoStack: [],
        })
        syncTreeObjectFromStore(get)
      }
    } catch {
      // Ignore invalid hash
    }
  },

  // === Phase 7: Build calculation ===















  runCalculation: async (selection) => {







    const {
      allocatedNodes,
      nodeWeaponSets,
      nodeAttributeSelections,
      treeVersion,
      selectedClassId,
      selectedAscendancyId,
      treeData,
      calcLoading,
      activeWeaponSet,
      calculationProfiles,
      activeCalculationProfileId,
    } = get()







    if (calcLoading || allocatedNodes.size === 0) return















    const requestId = ++calculationRequestId
    const buildSession = getActiveBuildSession()
    const buildObjectRevision = get().pobBuildRevision
    const calculationWeaponSet = selection?.weaponSet ?? activeWeaponSet
    const calculationProfile = calculationProfiles.find((profile) => profile.id === activeCalculationProfileId)
    set({ calcLoading: true, calcError: null, calcResult: null })















    try {
      const classPayload = getEncodeClassPayload(treeData || undefined, selectedClassId, selectedAscendancyId)







      const activeCode = get().getActivePobCode()
      const activeXml = get().getActivePobXml()
      const encodeData = activeCode && activeXml
        ? { code: activeCode, xml: activeXml }
        : encodeBuildCode({
          nodes: [...allocatedNodes],
          nodeWeaponSets,
          nodeAttributeSelections: defaultAttributeSelections(treeData || undefined, allocatedNodes, nodeAttributeSelections),
          baseCode: activeCode || undefined,
          treeVersion,
          activeItemSetId: selection?.itemSetId,
          useSecondWeaponSet: calculationWeaponSet === 2,
          mainSocketGroup: selection?.skillGroupId,
          ...classPayload,
        })

      const code = encodeData.code || ''







      if (!code) {







        throw new Error('Encode returned empty code')







      }















      const calcData: CalcApiResponse = await calculateBuild({
        code,
        xml: encodeData.xml,
        skillGroupId: selection?.skillGroupId,
        calcMode: selection?.calcMode,
        activeSkillIndex: selection?.activeSkillIndex,
        statSetIndex: selection?.statSetIndex,
        actor: selection?.actor,
        minionSkillIndex: selection?.minionSkillIndex,
        minionStatSetIndex: selection?.minionStatSetIndex,
        configOverrides: calculationProfile?.values || {},
        includeConfig: selection?.includeConfig,
      })

      if (!calcData.success || calcData.error) {
        throw new Error(calcData.error || 'Calculate failed')
      }







      if (!calcData.data) {







        throw new Error('Calculate returned no data')







      }















      if (
        requestId !== calculationRequestId
        || get().activeWeaponSet !== calculationWeaponSet
        || get().pobBuildRevision !== buildObjectRevision
        || getActiveBuildSession() !== buildSession
      ) return
      set({
        calcResult: calcData.data,
        calculationConfig: calcData.data.CalculationConfig || get().calculationConfig,
        calcLoading: false,
      })







    } catch (err: unknown) {







      const msg = err instanceof Error ? err.message : String(err)







      if (
        requestId !== calculationRequestId
        || get().activeWeaponSet !== calculationWeaponSet
        || get().pobBuildRevision !== buildObjectRevision
        || getActiveBuildSession() !== buildSession
      ) return
      set({ calcError: msg, calcLoading: false })







    }







  },















  clearCalcResult: () => set({ calcResult: null, calcError: null }),

  getActivePobCode: () => getActiveBuildCode(get().importedBuildCode),
  getActivePobXml: () => {
    try {
      return activeBuildSession?.object.snapshot().xml || null
    } catch {
      return null
    }
  },
  getActivePobTreeState: () => {
    try {
      return activeBuildSession?.object.getTreeState() || null
    } catch {
      return null
    }
  },
  getActivePobTreeSpecStates: () => {
    try {
      return activeBuildSession?.object.getTreeSpecStates() || null
    } catch {
      return null
    }
  },
  getActivePobTreeJewelItems: () => {
    try {
      return activeBuildSession?.object.getPassiveJewelItems() || {}
    } catch {
      return {}
    }
  },
  getActivePobTreeJewelRaw: (nodeId) => {
    try {
      return activeBuildSession?.object.getPassiveJewelRaw(nodeId) || null
    } catch {
      return null
    }
  },
  getActiveBuildLibraryId: () => activeBuildSession?.buildId || activeUnsavedBuildLibraryId,

  applyPobBuildCommand: (command) => {
    if (!activeBuildSession) return null
    const change = activeBuildSession.apply(command)
    if (!change.changed) return change
    set((state) => ({
      pobBuildRevision: change.revision,
      calcResult: null,
      calcError: null,
    }))
    return change
  },

  setActiveCalculationProfile: (activeCalculationProfileId) => {
    if (!get().calculationProfiles.some((profile) => profile.id === activeCalculationProfileId)) return
    set({ activeCalculationProfileId, calcResult: null, calcError: null })
  },

  rankSkillsByDps: async (groupIds, requestedWeaponSet) => {
    const {
      allocatedNodes,
      nodeWeaponSets,
      nodeAttributeSelections,
      treeVersion,
      selectedClassId,
      selectedAscendancyId,
      treeData,
      activeWeaponSet,
      calculationProfiles,
      activeCalculationProfileId,
      importedBuildCode,
    } = get()
    if (!groupIds.length) return []
    if (allocatedNodes.size === 0) throw new Error('No allocated passive tree is available for calculation')

    const calculationWeaponSet = requestedWeaponSet ?? activeWeaponSet
    const buildSession = getActiveBuildSession()
    const buildObjectRevision = get().pobBuildRevision
    const calculationProfile = calculationProfiles.find((profile) => profile.id === activeCalculationProfileId)
    const classPayload = getEncodeClassPayload(treeData || undefined, selectedClassId, selectedAscendancyId)
    const activeCode = get().getActivePobCode()
    const activeXml = get().getActivePobXml()
    const encodeData = activeCode && activeXml
      ? { code: activeCode, xml: activeXml }
      : encodeBuildCode({
        nodes: [...allocatedNodes],
        nodeWeaponSets,
        nodeAttributeSelections: defaultAttributeSelections(treeData || undefined, allocatedNodes, nodeAttributeSelections),
        baseCode: activeCode || importedBuildCode || undefined,
        treeVersion,
        useSecondWeaponSet: calculationWeaponSet === 2,
        ...classPayload,
      })
    const ranked = await rankSkillsByEffectiveDps({
      xml: encodeData.xml,
      groupIds,
      configOverrides: calculationProfile?.values || {},
    })
    if (!ranked.success || ranked.error || !ranked.data) {
      throw new Error(ranked.error || 'Skill DPS ranking returned no data')
    }
    if (get().pobBuildRevision !== buildObjectRevision || getActiveBuildSession() !== buildSession) return []
    return ranked.data
  },

  addCalculationProfile: (copyCurrent = false) => {
    const { calculationProfiles, activeCalculationProfileId } = get()
    const current = calculationProfiles.find((profile) => profile.id === activeCalculationProfileId)
    const id = globalThis.crypto?.randomUUID?.() || `config-${Date.now().toString(36)}`
    const profile: LocalCalculationProfile = {
      id,
      name: get().language === 'zh-rCN'
        ? `配置 ${calculationProfiles.length + 1}`
        : `Config ${calculationProfiles.length + 1}`,
      values: copyCurrent ? { ...current?.values } : {},
    }
    set({ calculationProfiles: [...calculationProfiles, profile], activeCalculationProfileId: id, calcResult: null })
  },

  renameCalculationProfile: (id, name) => set((state) => ({
    calculationProfiles: state.calculationProfiles.map((profile) => profile.id === id
      ? { ...profile, name: name.trim() || profile.name }
      : profile),
  })),

  deleteCalculationProfile: (id) => {
    const { calculationProfiles, activeCalculationProfileId } = get()
    if (calculationProfiles.length <= 1) return
    const next = calculationProfiles.filter((profile) => profile.id !== id)
    set({
      calculationProfiles: next,
      activeCalculationProfileId: activeCalculationProfileId === id ? next[0].id : activeCalculationProfileId,
      calcResult: null,
    })
  },

  setCalculationConfigValue: (key, value) => set((state) => ({
    calculationProfiles: state.calculationProfiles.map((profile) => {
      if (profile.id !== state.activeCalculationProfileId) return profile
      const values = { ...profile.values }
      if (value === undefined) delete values[key]
      else values[key] = value
      return { ...profile, values }
    }),
    calcResult: null,
    calcError: null,
  })),

  resetCalculationConfig: () => set((state) => ({
    calculationProfiles: state.calculationProfiles.map((profile) => profile.id === state.activeCalculationProfileId
      ? { ...profile, values: {} }
      : profile),
    calcResult: null,
    calcError: null,
  })),

  // ---- Saved Builds (Phase 16.7) ----
  loadSavedBuilds: () => {
    try {
      const raw = localStorage.getItem('pob2-saved-builds')
      if (raw) {
        const builds = JSON.parse(raw) as SavedBuild[]
        if (Array.isArray(builds)) {
          const normalized = builds.map((build) => {
            const config = normalizeCalculationProfiles(build.calculationProfiles, build.activeCalculationProfileId)
            return {
              ...build,
              realm: inferBuildRealm(build),
              characterLevel: build.characterLevel || getBuildCharacterLevel(build.importedBuildCode) || 1,
              calculationProfiles: config.profiles,
              activeCalculationProfileId: config.activeId,
            }
          })
          set({ savedBuilds: normalized })
          localStorage.setItem('pob2-saved-builds', JSON.stringify(normalized))
        }
      }
    } catch { /* ignore corrupt data */ }
  },

  setBuildRealm: (realm) => set({ buildRealm: realm }),

  saveBuild: (name, id, source, sourceUrl, metadata) => {
    const { allocatedNodes, treeVersion, selectedClassId, selectedAscendancyId,
            weaponSetMode, activeWeaponSet, nodeWeaponSets, nodeAttributeSelections, masterySelections, savedBuilds, treeData, importedBuildCode, buildRealm,
            calculationProfiles, activeCalculationProfileId } = get()
    const currentBuildCode = getActiveBuildCode(importedBuildCode)
    const now = new Date().toISOString()
    const existing = id ? savedBuilds.find((item) => item.id === id) : undefined
    const buildId = existing?.id || id || (globalThis.crypto?.randomUUID?.() || Date.now().toString(36) + Math.random().toString(36).slice(2))
    activeUnsavedBuildLibraryId = buildId
    const build: SavedBuild = {
      id: buildId,
      name,
      description: metadata?.description ?? existing?.description,
      tags: [...(metadata?.tags ?? existing?.tags ?? [])],
      createdAt: metadata?.createdAt || existing?.createdAt || now,
      updatedAt: metadata?.updatedAt || now,
      lastOpenedAt: metadata?.lastOpenedAt || now,
      nativeRevision: metadata?.nativeRevision ?? ((existing?.nativeRevision || 0) + 1),
      treeVersion,
      selectedClassId,
      selectedAscendancyId,
      characterLevel: getBuildCharacterLevel(currentBuildCode) || existing?.characterLevel || 1,
      importedBuildCode: currentBuildCode,
      source: source || existing?.source || (currentBuildCode ? 'pob' : 'local'),
      sourceUrl: sourceUrl || null,
      realm: buildRealm,
      weaponSetMode,
      activeWeaponSet,
      nodeWeaponSets: { ...nodeWeaponSets },
      nodeAttributeSelections: defaultAttributeSelections(treeData || undefined, allocatedNodes, nodeAttributeSelections),
      masterySelections: { ...masterySelections },
      allocatedNodes: [...allocatedNodes],
      calculationProfiles: calculationProfiles.map((profile) => ({ ...profile, values: { ...profile.values } })),
      activeCalculationProfileId,
    }
    const updated = existing
      ? savedBuilds.map((item) => item.id === buildId ? build : item)
      : [build, ...savedBuilds]
    localStorage.setItem('pob2-saved-builds', JSON.stringify(updated))
    set({ savedBuilds: updated })
    return buildId
  },

  loadBuild: async (id) => {
    const { savedBuilds } = get()
    const build = savedBuilds.find((b) => b.id === id)
    if (!build) return
    if (build.treeVersion && build.treeVersion !== get().treeVersion) {
      set({ treeVersion: build.treeVersion })
      await get().loadTreeData()
    }
    const treeData = get().treeData
    let selectedClassId = build.selectedClassId
    let selectedAscendancyId = build.selectedAscendancyId
    if (treeData && build.importedBuildCode) {
      try {
        const decoded = decodeBuildCode(build.importedBuildCode)
        const resolvedClass = resolveTreeClass(treeData, decoded)
        if (resolvedClass) {
          selectedClassId = resolvedClass[0]
          selectedAscendancyId = resolveTreeAscendancy(resolvedClass[1], decoded)
        }
      } catch {
        // Keep the saved identifiers when the original build code is unavailable or invalid.
      }
    }
    const ctx = treeData ? {
      treeData,
      selectedClassId,
      selectedAscendancyId,
      buildRealm: inferBuildRealm(build),
    } : null
    const rebuilt = recomputeAllocationState(ctx, new Set(build.allocatedNodes), build.nodeWeaponSets || {})
    const nodeAttributeSelections = defaultAttributeSelections(
      treeData || undefined,
      rebuilt.allocatedNodes,
      build.nodeAttributeSelections || {},
    )
    const config = normalizeCalculationProfiles(build.calculationProfiles, build.activeCalculationProfileId)
    replaceActiveBuildSession(build.id, build.importedBuildCode || null)
    const loadedWeaponSet = build.activeWeaponSet || getBuildActiveWeaponSet(build.importedBuildCode)
    const activeWeaponSet = syncLoadedWeaponSetToBuildObject(loadedWeaponSet)
    let importedTreeState: PobTreeState | undefined
    try { importedTreeState = activeBuildSession?.object.getTreeState() }
    catch { importedTreeState = undefined }
    let importedSpecStates: { activeSpecIndex: number; specs: PobTreeState[] } | undefined
    try { importedSpecStates = activeBuildSession?.object.getTreeSpecStates() }
    catch { importedSpecStates = undefined }
    set({
      allocatedNodes: rebuilt.allocatedNodes,
      availableNodes: rebuilt.availableNodes,
      selectedClassId,
      selectedAscendancyId,
      buildRealm: inferBuildRealm(build),
      importedBuildCode: build.importedBuildCode || null,
      pobBuildRevision: activeBuildSession?.revision ?? 0,
      weaponSetMode: build.weaponSetMode,
      activeWeaponSet,
      nodeWeaponSets: rebuilt.nodeWeaponSets,
      nodeAttributeSelections,
      masterySelections: { ...(importedTreeState?.masterySelections || build.masterySelections || {}) },
      specs: importedSpecStates ? buildStoreSpecs(importedSpecStates.specs) : [{ id: 'default', title: 'Tree 1', nodes: [...rebuilt.allocatedNodes] }],
      activeSpecId: importedSpecStates ? `xml-spec-${importedSpecStates.activeSpecIndex}` : 'default',
      undoStack: [],
      redoStack: [],
      calcResult: null,
      calcError: null,
      calculationProfiles: config.profiles,
      activeCalculationProfileId: config.activeId,
      calculationConfig: null,
    })
    // Legacy saved Codes can have the same incomplete class attributes as a
    // fresh import; keep the canonical object compatible with PoB2 exports.
    syncTreeObjectFromStore(get)
  },

  deleteBuild: (id) => {
    const updated = get().savedBuilds.filter((b) => b.id !== id)
    set({ savedBuilds: updated })
    try { localStorage.setItem('pob2-saved-builds', JSON.stringify(updated)) } catch {}
  },

  selectClass: (classId) => {


    const tree = get().treeData


    if (!tree) return


    const classData = tree.constants.classes[classId]


    if (!classData) return


    const firstAsc = classData.ascendancies[0]


    set({


      selectedClassId: classId,


      selectedAscendancyId: firstAsc?.id || firstAsc?.name || '',


      allocatedNodes: new Set(),


      availableNodes: new Set(),

      nodeWeaponSets: {},
      nodeAttributeSelections: {},


      undoStack: [],


      redoStack: [],


    })
    syncTreeObjectFromStore(get)

  },





  selectAscendancy: (ascendancyId) => {
    const state = get()
    const ctx = state.treeData ? {
      treeData: state.treeData,
      selectedClassId: state.selectedClassId,
      selectedAscendancyId: ascendancyId,
    } : null
    const rebuilt = recomputeAllocationState(ctx, state.allocatedNodes, state.nodeWeaponSets)
    const nodeAttributeSelections = defaultAttributeSelections(
      state.treeData || undefined,
      rebuilt.allocatedNodes,
      state.nodeAttributeSelections,
    )
    set({
      selectedAscendancyId: ascendancyId,
      availableNodes: rebuilt.availableNodes,
      nodeWeaponSets: rebuilt.nodeWeaponSets,
      nodeAttributeSelections,
    })
    syncTreeObjectFromStore(get)
  },


}))

replaceActiveBuildSession(null, useTreeStore.getState().importedBuildCode)

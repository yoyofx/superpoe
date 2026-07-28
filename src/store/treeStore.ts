import { create } from 'zustand'







import type { BuildRealm, TreeData, SavedBuild } from '@/types/tree'
import { LANGUAGE_OPTIONS, getLocalizedSearchText, loadTranslations, type Language } from '@/i18n/translationLoader'
import { decodeBuildCode, encodeBuildCode, getBuildActiveWeaponSet, getBuildCharacterLevel, getEncodeClassPayload } from '@/engine/buildCode'
import { calculateBuild, rankSkillsByEffectiveDps } from '@/engine/pobLuaClient'
import { clearPersistedImportedBuild, getInitialImportedBuildCode } from '@/engine/buildPersistence'
import { DEFAULT_BUILD_REALM, inferBuildRealm } from '@/engine/buildRealm'
import { getRenderTreePoint, getSelectedAscendancyProjection } from '@/engine/treeRenderShared'
import { parseTreeDataResource } from '@/engine/treeDataResource'
import { resolveTreeAscendancy, resolveTreeClass } from '@/engine/treeClassResolution'
import {
  cleanAttributeSelections,
  nextAttributeSelection,
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

export const MIN_ZOOM = 0.01
export const DEFAULT_ZOOM = 0.2
export const MAX_ZOOM = 0.5
export const FALLBACK_TREE_VERSIONS = ['0_5', '0_4']
export const DEFAULT_TREE_VERSION = FALLBACK_TREE_VERSIONS[0]
const DEFAULT_LANGUAGE: Language = 'en'
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
  return {
    allocatedNodes: [...allocatedNodes],
    availableNodes: [...availableNodes],
    nodeWeaponSets: { ...nodeWeaponSets },
    nodeAttributeSelections: { ...nodeAttributeSelections },
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
  if (typeof localStorage === 'undefined') return DEFAULT_LANGUAGE
  const saved = localStorage.getItem(LANGUAGE_STORAGE_KEY)
  return LANGUAGE_OPTIONS.some((option) => option.value === saved) ? saved as Language : DEFAULT_LANGUAGE
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
  cycleAttributeNode: (id: string) => void
  setTreeEditMode: (enabled: boolean) => void
  setWeaponSetMode: (mode: 0 | 1 | 2) => void
  setActiveWeaponSet: (weaponSet: 1 | 2) => void
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
    includeConfig?: boolean
  }) => Promise<void>

  rankSkillsByDps: (groupIds: string[], weaponSet?: 1 | 2) => Promise<SkillDpsRankEntry[]>







  /** Phase 7: Clear calculation result */







  clearCalcResult: () => void
  setActiveCalculationProfile: (id: string) => void
  addCalculationProfile: (copyCurrent?: boolean) => void
  renameCalculationProfile: (id: string, name: string) => void
  deleteCalculationProfile: (id: string) => void
  setCalculationConfigValue: (key: string, value?: CalculationConfigValue) => void
  resetCalculationConfig: () => void







  // ---- Saved Builds (Phase 16.7) ----
  saveBuild: (name: string, id?: string | null, source?: SavedBuild['source'], sourceUrl?: string | null) => string
  loadBuild: (id: string) => Promise<void>
  deleteBuild: (id: string) => void
  exportBuildJSON: () => string
  importBuildJSON: (json: string) => Promise<void>


}















let calculationRequestId = 0

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







    get().loadTreeData()







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
      masterySelections: {},
      pendingMasteryNode: null,
      specs: [{ id: 'default', title: 'Tree 1', nodes: [...rebuilt.allocatedNodes] }],
      activeSpecId: 'default',
      importedBuildCode: options.importedBuildCode || null,
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
  },

  clearAllocatedNodes: () => {
    clearPersistedImportedBuild(localStorage)
    set({
      allocatedNodes: new Set(),
      availableNodes: new Set(),
      nodeWeaponSets: {},
      nodeAttributeSelections: {},
      importedBuildCode: null,
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
  },

  addSpec: (title) => {
    const id = 'spec_' + Date.now()
    set((s) => ({ specs: [...s.specs, { id, title, nodes: [] }] }))
  },

  switchSpec: (specId) => {
    const spec = get().specs.find((s) => s.id === specId)
    if (spec) {
      const curAlloc = [...get().allocatedNodes]
      const curSpec = get().specs.find((s) => s.id === get().activeSpecId)
      if (curSpec) curSpec.nodes = curAlloc
      set({ activeSpecId: specId, allocatedNodes: new Set(spec.nodes) })
    }
  },

  deleteSpec: (specId) => {
    set((s) => ({ specs: s.specs.filter((sp) => sp.id !== specId) }))
  },

  cancelMastery: () => set({ pendingMasteryNode: null }),

  setWeaponSetMode: (mode) => {
    set({ weaponSetMode: mode })
  },

  setActiveWeaponSet: (activeWeaponSet) => {
    if (get().activeWeaponSet === activeWeaponSet) return
    calculationRequestId += 1
    set({ activeWeaponSet, calcResult: null, calcError: null, calcLoading: false })
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
  },

  undo: () => {
    const { undoStack, allocatedNodes, availableNodes, nodeWeaponSets, nodeAttributeSelections } = get()
    if (undoStack.length === 0) return
    const snap = undoStack[undoStack.length - 1]
    const curSnap = snapshotFromState(allocatedNodes, availableNodes, nodeWeaponSets, nodeAttributeSelections)
    set({
      allocatedNodes: new Set(snap.allocatedNodes),
      availableNodes: new Set(snap.availableNodes),
      nodeWeaponSets: { ...snap.nodeWeaponSets },
      nodeAttributeSelections: { ...snap.nodeAttributeSelections },
      undoStack: undoStack.slice(0, -1),
      redoStack: [...get().redoStack, curSnap],
    })
  },

  redo: () => {
    const { redoStack, allocatedNodes, availableNodes, nodeWeaponSets, nodeAttributeSelections } = get()
    if (redoStack.length === 0) return
    const snap = redoStack[redoStack.length - 1]
    const curSnap = snapshotFromState(allocatedNodes, availableNodes, nodeWeaponSets, nodeAttributeSelections)
    set({
      allocatedNodes: new Set(snap.allocatedNodes),
      availableNodes: new Set(snap.availableNodes),
      nodeWeaponSets: { ...snap.nodeWeaponSets },
      nodeAttributeSelections: { ...snap.nodeAttributeSelections },
      redoStack: redoStack.slice(0, -1),
      undoStack: [...get().undoStack, curSnap],
    })
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
    const calculationWeaponSet = selection?.weaponSet ?? activeWeaponSet
    const calculationProfile = calculationProfiles.find((profile) => profile.id === activeCalculationProfileId)
    set({ calcLoading: true, calcError: null, calcResult: null })















    try {
      const classPayload = getEncodeClassPayload(treeData || undefined, selectedClassId, selectedAscendancyId)







      const encodeData = encodeBuildCode({
        nodes: [...allocatedNodes],
        nodeWeaponSets,
        nodeAttributeSelections: defaultAttributeSelections(treeData || undefined, allocatedNodes, nodeAttributeSelections),
        baseCode: get().importedBuildCode || undefined,
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
        configOverrides: calculationProfile?.values || {},
        includeConfig: selection?.includeConfig,
      })

      if (!calcData.success || calcData.error) {
        throw new Error(calcData.error || 'Calculate failed')
      }







      if (!calcData.data) {







        throw new Error('Calculate returned no data')







      }















      if (requestId !== calculationRequestId || get().activeWeaponSet !== calculationWeaponSet) return
      set({
        calcResult: calcData.data,
        calculationConfig: calcData.data.CalculationConfig || get().calculationConfig,
        calcLoading: false,
      })







    } catch (err: unknown) {







      const msg = err instanceof Error ? err.message : String(err)







      if (requestId !== calculationRequestId || get().activeWeaponSet !== calculationWeaponSet) return
      set({ calcError: msg, calcLoading: false })







    }







  },















  clearCalcResult: () => set({ calcResult: null, calcError: null }),

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
    const calculationProfile = calculationProfiles.find((profile) => profile.id === activeCalculationProfileId)
    const classPayload = getEncodeClassPayload(treeData || undefined, selectedClassId, selectedAscendancyId)
    const encodeData = encodeBuildCode({
      nodes: [...allocatedNodes],
      nodeWeaponSets,
      nodeAttributeSelections: defaultAttributeSelections(treeData || undefined, allocatedNodes, nodeAttributeSelections),
      baseCode: importedBuildCode || undefined,
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

  saveBuild: (name, id, source, sourceUrl) => {
    const { allocatedNodes, treeVersion, selectedClassId, selectedAscendancyId,
            weaponSetMode, activeWeaponSet, nodeWeaponSets, nodeAttributeSelections, masterySelections, savedBuilds, treeData, importedBuildCode, buildRealm,
            calculationProfiles, activeCalculationProfileId } = get()
    const now = new Date().toISOString()
    const existing = id ? savedBuilds.find((item) => item.id === id) : undefined
    const buildId = existing?.id || (globalThis.crypto?.randomUUID?.() || Date.now().toString(36) + Math.random().toString(36).slice(2))
    const build: SavedBuild = {
      id: buildId,
      name,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
      treeVersion,
      selectedClassId,
      selectedAscendancyId,
      characterLevel: getBuildCharacterLevel(importedBuildCode) || existing?.characterLevel || 1,
      importedBuildCode,
      source: source || existing?.source || (importedBuildCode ? 'pob' : 'local'),
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
    set({
      allocatedNodes: rebuilt.allocatedNodes,
      availableNodes: rebuilt.availableNodes,
      selectedClassId,
      selectedAscendancyId,
      buildRealm: inferBuildRealm(build),
      importedBuildCode: build.importedBuildCode || null,
      weaponSetMode: build.weaponSetMode,
      activeWeaponSet: build.activeWeaponSet || getBuildActiveWeaponSet(build.importedBuildCode),
      nodeWeaponSets: rebuilt.nodeWeaponSets,
      nodeAttributeSelections,
      masterySelections: { ...build.masterySelections },
      undoStack: [],
      redoStack: [],
      calcResult: null,
      calcError: null,
      calculationProfiles: config.profiles,
      activeCalculationProfileId: config.activeId,
      calculationConfig: null,
    })
  },

  deleteBuild: (id) => {
    const updated = get().savedBuilds.filter((b) => b.id !== id)
    set({ savedBuilds: updated })
    try { localStorage.setItem('pob2-saved-builds', JSON.stringify(updated)) } catch {}
  },

  exportBuildJSON: () => {
    const { allocatedNodes, treeVersion, selectedClassId, selectedAscendancyId,
            weaponSetMode, activeWeaponSet, nodeWeaponSets, nodeAttributeSelections, masterySelections, treeData, importedBuildCode, buildRealm,
            calculationProfiles, activeCalculationProfileId } = get()
    return JSON.stringify({
      name: 'PoB2 Build',
      exportedAt: new Date().toISOString(),
      treeVersion,
      selectedClassId,
      selectedAscendancyId,
      realm: buildRealm,
      importedBuildCode,
      weaponSetMode,
      activeWeaponSet,
      nodeWeaponSets,
      nodeAttributeSelections: defaultAttributeSelections(treeData || undefined, allocatedNodes, nodeAttributeSelections),
      masterySelections,
      calculationProfiles,
      activeCalculationProfileId,
      allocatedNodes: [...allocatedNodes],
    }, null, 2)
  },

  importBuildJSON: async (json: string) => {
    const build = JSON.parse(json) as Record<string, unknown>
    const nodes = build.allocatedNodes as string[]
    if (!nodes || !Array.isArray(nodes)) {
      throw new Error('Invalid build: missing allocatedNodes')
    }

    const importedBuildCode = (build.importedBuildCode as string | null) || null
    let decoded: ReturnType<typeof decodeBuildCode> | null = null
    if (importedBuildCode) decoded = decodeBuildCode(importedBuildCode)

    const targetTreeVersion = typeof build.treeVersion === 'string' && build.treeVersion
      ? build.treeVersion
      : decoded?.treeVersion
    if (!targetTreeVersion) throw new Error('The imported build does not specify a passive tree version')
    if (targetTreeVersion && targetTreeVersion !== get().treeVersion) {
      set({ treeVersion: targetTreeVersion })
      await get().loadTreeData()
    }

    const { treeData } = get()
    if (!treeData || treeData.version.version !== targetTreeVersion) {
      throw new Error(`Passive tree data ${targetTreeVersion} is unavailable`)
    }
    const classIdentifiers = decoded || { classId: typeof build.selectedClassId === 'string' ? build.selectedClassId : '' }
    const ascendancyIdentifiers = decoded || { ascendClassId: typeof build.selectedAscendancyId === 'string' ? build.selectedAscendancyId : '' }
    const resolvedClass = resolveTreeClass(treeData, classIdentifiers)
    if (!resolvedClass) throw new Error('The imported build class could not be resolved')
    const selectedClassId = resolvedClass[0]
    const selectedAscendancyId = resolveTreeAscendancy(resolvedClass[1], ascendancyIdentifiers)
    const requestedAscendancy = decoded
      ? decoded.ascendancyInternalId || decoded.ascendClassId
      : ascendancyIdentifiers.ascendClassId
    if (requestedAscendancy && !['0', 'nil'].includes(requestedAscendancy.toLowerCase()) && !selectedAscendancyId) {
      throw new Error(`The imported ascendancy "${requestedAscendancy}" could not be resolved`)
    }

    const ctx = { treeData, selectedClassId, selectedAscendancyId }
    const importedNodes = new Set<string>()
    for (const id of nodes) {
      const node = treeData.nodes[id]
      if (node && node.type !== 'ClassStart' && node.type !== 'AscendClassStart') importedNodes.add(id)
    }
    const rebuilt = recomputeAllocationState(
      ctx,
      importedNodes,
      (build.nodeWeaponSets as NodeWeaponSets) || {},
    )
    const nodeAttributeSelections = defaultAttributeSelections(
      treeData || undefined,
      rebuilt.allocatedNodes,
      (build.nodeAttributeSelections as NodeAttributeSelections) || {},
    )
    const config = normalizeCalculationProfiles(
      Array.isArray(build.calculationProfiles) ? build.calculationProfiles as LocalCalculationProfile[] : undefined,
      typeof build.activeCalculationProfileId === 'string' ? build.activeCalculationProfileId : undefined,
    )
    set({
      allocatedNodes: rebuilt.allocatedNodes,
      availableNodes: rebuilt.availableNodes,
      selectedClassId,
      selectedAscendancyId,
      buildRealm: build.realm === 'cn' ? 'cn' : 'global',
      importedBuildCode,
      treeEditMode: false,
      weaponSetMode: (build.weaponSetMode as 0 | 1 | 2) || 0,
      activeWeaponSet: build.activeWeaponSet === 2 ? 2 : build.activeWeaponSet === 1 ? 1 : getBuildActiveWeaponSet(importedBuildCode),
      nodeWeaponSets: rebuilt.nodeWeaponSets,
      nodeAttributeSelections,
      masterySelections: (build.masterySelections as Record<string, string>) || {},
      pendingMasteryNode: null,
      specs: [{ id: 'default', title: 'Tree 1', nodes: [...rebuilt.allocatedNodes] }],
      activeSpecId: 'default',
      hoveredNodeId: null,
      selectedNodeId: null,
      searchQuery: '',
      searchMatchIds: [],
      searchMatchCount: 0,
      zoom: DEFAULT_ZOOM,
      offsetX: -(treeData.constants.min_x + treeData.constants.max_x) / 2,
      offsetY: -(treeData.constants.min_y + treeData.constants.max_y) / 2,
      undoStack: [],
      redoStack: [],
      calcResult: null,
      calcLoading: false,
      calcError: null,
      calculationProfiles: config.profiles,
      activeCalculationProfileId: config.activeId,
      calculationConfig: null,
    })
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
  },


}))



import { create } from 'zustand'







import type { TreeData, SavedBuild } from '@/types/tree'
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







import type { CalcResult, CalcApiResponse } from '@/types/calc'

export const MIN_ZOOM = 0.01
export const DEFAULT_ZOOM = 0.2
export const MAX_ZOOM = 0.5
export const FALLBACK_TREE_VERSIONS = ['0_5', '0_4', '0_3', '0_2', '0_1']
export const DEFAULT_TREE_VERSION = FALLBACK_TREE_VERSIONS[0]

let treeVersionsPromise: Promise<string[]> | null = null

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

function findClassEntry(treeData: TreeData | undefined, classId: string | undefined): [string, TreeData['constants']['classes'][string]] | null {
  if (!treeData || !classId) return null
  const classes = treeData.constants.classes || {}
  if (classes[classId]) return [classId, classes[classId]]
  return Object.entries(classes).find(([, cls]) => (
    String(cls.integerId) === classId
    || cls.name === classId
    || cls.displayName === classId
  )) || null
}

function findAscendancyId(
  classData: TreeData['constants']['classes'][string] | undefined,
  ascendClassId: string | undefined,
): string {
  if (!classData) return ''
  const ascendancy = classData.ascendancies.find((asc) => (
    asc.id === ascendClassId
    || asc.name === ascendClassId
    || asc.internalId === ascendClassId
  )) || classData.ascendancies[0]
  return ascendancy?.id || ascendancy?.name || ''
}

function getEncodeClassPayload(
  treeData: TreeData | undefined,
  selectedClassId: string,
  selectedAscendancyId: string,
) {
  const cls = treeData?.constants.classes[selectedClassId]
  const ascendancy = cls?.ascendancies.find((asc) => (
    asc.id === selectedAscendancyId
    || asc.name === selectedAscendancyId
    || asc.internalId === selectedAscendancyId
  ))
  const ascendancyIndex = cls && ascendancy ? cls.ascendancies.indexOf(ascendancy) : -1
  return {
    classId: selectedClassId,
    ascendClassId: ascendancyIndex >= 0
      ? String(ascendancyIndex + 1)
      : selectedAscendancyId,
    classInternalId: cls?.integerId != null ? String(cls.integerId) : undefined,
    ascendancyInternalId: ascendancy?.internalId,
    className: cls?.name || cls?.displayName,
    ascendancyName: ascendancy?.name || ascendancy?.displayName || ascendancy?.id,
  }
}

// ============================================================















interface TreeStore {







  // ----        ----







  treeData: TreeData | null







  loading: boolean







  error: string | null







  treeVersion: string







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
  nodeWeaponSets: Record<string, 1 | 2>
  nodeAttributeSelections: NodeAttributeSelections
  masterySelections: Record<string, string>
  pendingMasteryNode: string | null
  specs: Array<{ id: string; title: string; nodes: string[] }>
  activeSpecId: string







  availableNodes: Set<string>















  // ----              ----







  searchMatchIds: string[]















  // ----       /       ----







  undoStack: Snapshot[]







  redoStack: Snapshot[]















  // ----        (Phase 7) ----







  calcResult: CalcResult | null







  calcLoading: boolean







  calcError: string | null















  // ---- Saved Builds (Phase 16.7) ----
  savedBuilds: SavedBuild[]
  loadSavedBuilds: () => void


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







  performSearch: (q: string) => void







  importAllocatedNodes: (
    ids: string[],
    nodeWeaponSets?: NodeWeaponSets,
    options?: {
      treeVersion?: string
      classId?: string
      ascendClassId?: string
      importedBuildCode?: string
      nodeAttributeSelections?: NodeAttributeSelections
    },
  ) => void | Promise<void>







  clearAllocatedNodes: () => void















  toggleNode: (id: string) => void
  cycleAttributeNode: (id: string) => void
  setTreeEditMode: (enabled: boolean) => void
  setWeaponSetMode: (mode: 0 | 1 | 2) => void
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







  runCalculation: () => Promise<void>







  /** Phase 7: Clear calculation result */







  clearCalcResult: () => void







  // ---- Saved Builds (Phase 16.7) ----
  saveBuild: (name: string) => void
  loadBuild: (id: string) => void
  deleteBuild: (id: string) => void
  exportBuildJSON: () => string
  importBuildJSON: (json: string) => void


}















export const useTreeStore = create<TreeStore>((set, get) => ({







  // ----              ----







  treeData: null,







  loading: false,







  error: null,







  treeVersion: DEFAULT_TREE_VERSION,







  selectedClassId: '6',



  selectedAscendancyId: 'Stormweaver',

  importedBuildCode: null,







  offsetX: 0,







  offsetY: 0,







  zoom: DEFAULT_ZOOM,







  hoveredNodeId: null,







  selectedNodeId: null,







  mouseX: 0,







  mouseY: 0,







  searchQuery: '',







  searchMatchIds: [],







  allocatedNodes: new Set(),
  treeEditMode: false,
  weaponSetMode: 0 as 0 | 1 | 2,
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

  // ---- Saved Builds (Phase 16.7) ----
  savedBuilds: [],


  // ---- Actions ----







  loadTreeData: async () => {







    const { loading, treeVersion } = get()







    if (loading) return







    set({ loading: true, error: null })







    try {







      const resp = await fetch(`/data/tree-web-${treeVersion}.json`)







      if (!resp.ok) throw new Error(`HTTP ${resp.status}`)







      const data: TreeData = await resp.json()
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







    get().performSearch(q)







  },







  performSearch: (q) => {







    const { treeData } = get()







    if (!treeData || !q.trim()) {







      set({ searchMatchIds: [], selectedNodeId: null })







      return







    }







    const lower = q.toLowerCase()







    const matches: string[] = []







    for (const [id, node] of Object.entries(treeData.nodes)) {







      const haystack = [
        id,
        node.name,
        node.type,
        ...(node.stats || []),
      ].join('\n').toLowerCase()

      if (haystack.includes(lower)) {







        matches.push(id)







      }







      if (matches.length >= 100) break







    }







    const firstMatch = matches[0]
    const firstNode = firstMatch ? treeData.nodes[firstMatch] : null
    set({
      searchMatchIds: matches,
      selectedNodeId: firstMatch || null,
      ...(firstNode ? { offsetX: -firstNode.x, offsetY: -firstNode.y } : {}),
    })







  },















  importAllocatedNodes: async (ids: string[], importedWeaponSets: NodeWeaponSets = {}, options = {}) => {
    const current = get()
    if (options.treeVersion && options.treeVersion !== current.treeVersion) {
      set({ treeVersion: options.treeVersion })
      await get().loadTreeData()
    }

    const state = get()
    const tree = state.treeData
    const classEntry = findClassEntry(tree || undefined, options.classId)
    if (classEntry) {
      const [resolvedClassId, classData] = classEntry
      set({
        selectedClassId: resolvedClassId,
        selectedAscendancyId: findAscendancyId(classData, options.ascendClassId),
      })
    }

    const ctx = getAllocationContext(get())
    const next = new Set<string>()
    for (const id of ids) {
      const node = ctx?.treeData.nodes[id]
      if (node && node.type !== 'ClassStart' && node.type !== 'AscendClassStart') next.add(id)
    }
    const rebuilt = recomputeAllocationState(ctx, next, importedWeaponSets)
    const nextAttributeSelections = defaultAttributeSelections(
      ctx?.treeData,
      rebuilt.allocatedNodes,
      options.nodeAttributeSelections,
    )
    set({
      allocatedNodes: rebuilt.allocatedNodes,
      availableNodes: rebuilt.availableNodes,
      nodeWeaponSets: rebuilt.nodeWeaponSets,
      nodeAttributeSelections: nextAttributeSelections,
      importedBuildCode: options.importedBuildCode || null,
      undoStack: [],
      redoStack: [],
    })
  },

  clearAllocatedNodes: () => set({
    allocatedNodes: new Set(),
    availableNodes: new Set(),
    nodeWeaponSets: {},
    nodeAttributeSelections: {},
    importedBuildCode: null,
    undoStack: [],
    redoStack: [],
  }),

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
      let ascendClassId: string | undefined
      if (str.trim().startsWith('{')) {
        const payload = JSON.parse(str) as {
          nodes?: string[]
          nodeWeaponSets?: NodeWeaponSets
          nodeAttributeSelections?: NodeAttributeSelections
          treeVersion?: string
          classId?: string
          ascendClassId?: string
        }
        ids = Array.isArray(payload.nodes) ? payload.nodes : []
        nodeWeaponSets = payload.nodeWeaponSets || {}
        nodeAttributeSelections = payload.nodeAttributeSelections || {}
        treeVersion = payload.treeVersion
        classId = payload.classId
        ascendClassId = payload.ascendClassId
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
        const classEntry = findClassEntry(loaded.treeData || undefined, classId)
        if (classEntry) {
          const [resolvedClassId, classData] = classEntry
          set({
            selectedClassId: resolvedClassId,
            selectedAscendancyId: findAscendancyId(classData, ascendClassId),
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















  runCalculation: async () => {







    const {
      allocatedNodes,
      nodeWeaponSets,
      nodeAttributeSelections,
      treeVersion,
      selectedClassId,
      selectedAscendancyId,
      treeData,
      calcLoading,
    } = get()







    if (calcLoading || allocatedNodes.size === 0) return















    set({ calcLoading: true, calcError: null, calcResult: null })















    try {
      const classPayload = getEncodeClassPayload(treeData || undefined, selectedClassId, selectedAscendancyId)







      // Step 1: Encode nodes via /api/code/encode







      const encodeResp = await fetch('/api/code/encode', {







        method: 'POST',







        headers: { 'Content-Type': 'application/json' },







        body: JSON.stringify({







          nodes: [...allocatedNodes],
          nodeWeaponSets,
          nodeAttributeSelections: defaultAttributeSelections(treeData || undefined, allocatedNodes, nodeAttributeSelections),
          baseCode: get().importedBuildCode || undefined,







          treeVersion,
          classId: classPayload.classId,
          ascendClassId: classPayload.ascendClassId,
          classInternalId: classPayload.classInternalId,
          ascendancyInternalId: classPayload.ascendancyInternalId,
          className: classPayload.className,
          ascendancyName: classPayload.ascendancyName,







        }),







      })







      const encodeData = await encodeResp.json()







      if (!encodeResp.ok || encodeData.error) {







        throw new Error(encodeData.error || `Encode failed: HTTP ${encodeResp.status}`)







      }







      const code = encodeData.code || ''







      if (!code) {







        throw new Error('Encode returned empty code')







      }















      // Step 2: Calculate via /api/build/calculate







      const calcResp = await fetch('/api/build/calculate', {







        method: 'POST',







        headers: { 'Content-Type': 'application/json' },







        body: JSON.stringify({ code }),







      })







      const calcData: CalcApiResponse = await calcResp.json()







      if (!calcResp.ok || !calcData.success || calcData.error) {







        throw new Error(calcData.error || `Calculate failed: HTTP ${calcResp.status}`)







      }







      if (!calcData.data) {







        throw new Error('Calculate returned no data')







      }















      set({ calcResult: calcData.data, calcLoading: false })







    } catch (err: unknown) {







      const msg = err instanceof Error ? err.message : String(err)







      set({ calcError: msg, calcLoading: false })







    }







  },















  clearCalcResult: () => set({ calcResult: null, calcError: null }),

  // ---- Saved Builds (Phase 16.7) ----
  loadSavedBuilds: () => {
    try {
      const raw = localStorage.getItem('pob2-saved-builds')
      if (raw) {
        const builds = JSON.parse(raw) as SavedBuild[]
        if (Array.isArray(builds)) {
          set({ savedBuilds: builds })
        }
      }
    } catch { /* ignore corrupt data */ }
  },

  saveBuild: (name) => {
    const { allocatedNodes, treeVersion, selectedClassId, selectedAscendancyId,
            weaponSetMode, nodeWeaponSets, nodeAttributeSelections, masterySelections, savedBuilds, treeData, importedBuildCode } = get()
    if (allocatedNodes.size === 0) return
    const now = new Date().toISOString()
    const build: SavedBuild = {
      id: crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2),
      name,
      createdAt: now,
      updatedAt: now,
      treeVersion,
      selectedClassId,
      selectedAscendancyId,
      importedBuildCode,
      weaponSetMode,
      nodeWeaponSets: { ...nodeWeaponSets },
      nodeAttributeSelections: defaultAttributeSelections(treeData || undefined, allocatedNodes, nodeAttributeSelections),
      masterySelections: { ...masterySelections },
      allocatedNodes: [...allocatedNodes],
    }
    const updated = [build, ...savedBuilds]
    set({ savedBuilds: updated })
    try { localStorage.setItem('pob2-saved-builds', JSON.stringify(updated)) } catch {}
  },

  loadBuild: (id) => {
    const { savedBuilds, treeData } = get()
    const build = savedBuilds.find((b) => b.id === id)
    if (!build) return
    const ctx = treeData ? {
      treeData,
      selectedClassId: build.selectedClassId,
      selectedAscendancyId: build.selectedAscendancyId,
    } : null
    const rebuilt = recomputeAllocationState(ctx, new Set(build.allocatedNodes), build.nodeWeaponSets || {})
    const nodeAttributeSelections = defaultAttributeSelections(
      treeData || undefined,
      rebuilt.allocatedNodes,
      build.nodeAttributeSelections || {},
    )
    set({
      allocatedNodes: rebuilt.allocatedNodes,
      availableNodes: rebuilt.availableNodes,
      selectedClassId: build.selectedClassId,
      selectedAscendancyId: build.selectedAscendancyId,
      importedBuildCode: build.importedBuildCode || null,
      weaponSetMode: build.weaponSetMode,
      nodeWeaponSets: rebuilt.nodeWeaponSets,
      nodeAttributeSelections,
      masterySelections: { ...build.masterySelections },
      undoStack: [],
      redoStack: [],
      calcResult: null,
      calcError: null,
    })
  },

  deleteBuild: (id) => {
    const updated = get().savedBuilds.filter((b) => b.id !== id)
    set({ savedBuilds: updated })
    try { localStorage.setItem('pob2-saved-builds', JSON.stringify(updated)) } catch {}
  },

  exportBuildJSON: () => {
    const { allocatedNodes, treeVersion, selectedClassId, selectedAscendancyId,
            weaponSetMode, nodeWeaponSets, nodeAttributeSelections, masterySelections, treeData, importedBuildCode } = get()
    return JSON.stringify({
      name: 'PoB2 Build',
      exportedAt: new Date().toISOString(),
      treeVersion,
      selectedClassId,
      selectedAscendancyId,
      importedBuildCode,
      weaponSetMode,
      nodeWeaponSets,
      nodeAttributeSelections: defaultAttributeSelections(treeData || undefined, allocatedNodes, nodeAttributeSelections),
      masterySelections,
      allocatedNodes: [...allocatedNodes],
    }, null, 2)
  },

  importBuildJSON: (json: string) => {
    try {
      const build = JSON.parse(json) as Record<string, unknown>
      const { treeData } = get()
      const nodes = build.allocatedNodes as string[]
      if (!nodes || !Array.isArray(nodes)) {
        throw new Error('Invalid build: missing allocatedNodes')
      }
      const selectedClassId = (build.selectedClassId as string) || get().selectedClassId
      const selectedAscendancyId = (build.selectedAscendancyId as string) || get().selectedAscendancyId
      const ctx = treeData ? { treeData, selectedClassId, selectedAscendancyId } : null
      const rebuilt = recomputeAllocationState(
        ctx,
        new Set<string>(nodes),
        (build.nodeWeaponSets as NodeWeaponSets) || {},
      )
      const nodeAttributeSelections = defaultAttributeSelections(
        treeData || undefined,
        rebuilt.allocatedNodes,
        (build.nodeAttributeSelections as NodeAttributeSelections) || {},
      )
      set({
        allocatedNodes: rebuilt.allocatedNodes,
        availableNodes: rebuilt.availableNodes,
        selectedClassId,
        selectedAscendancyId,
        importedBuildCode: (build.importedBuildCode as string | null) || null,
        weaponSetMode: (build.weaponSetMode as 0 | 1 | 2) || 0,
        nodeWeaponSets: rebuilt.nodeWeaponSets,
        nodeAttributeSelections,
        masterySelections: (build.masterySelections as Record<string, string>) || {},
        undoStack: [],
        redoStack: [],
        calcResult: null,
        calcError: null,
      })
    } catch (err) {
      console.error('Failed to import build:', err)
    }
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








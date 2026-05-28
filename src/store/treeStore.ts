import { create } from 'zustand'







import type { TreeData, SavedBuild } from '@/types/tree'







import type { CalcResult, CalcApiResponse } from '@/types/calc'

export const MIN_ZOOM = 0.2
export const DEFAULT_ZOOM = 0.2
export const MAX_ZOOM = 5















// ---- Snapshot for undo/redo ----







interface Snapshot {







  allocatedNodes: string[]







  availableNodes: string[]







}















const MAX_UNDO = 50















// ---- Connectivity helpers ----















function findConnected(treeData: TreeData, allocated: Set<string>): Set<string> {







  const visited = new Set<string>()







  const queue: string[] = []







  for (const [id, node] of Object.entries(treeData.nodes)) {







    if (allocated.has(id) && (node.type === 'ClassStart' || node.type === 'AscendClassStart')) {







      queue.push(id); visited.add(id)







    }







  }







  if (queue.length === 0) return new Set(allocated)







  while (queue.length > 0) {







    const cur = queue.shift()!







    const node = treeData.nodes[cur]







    if (!node) continue







    for (const outId of node.out) {







      if (!visited.has(outId) && allocated.has(outId)) {







        visited.add(outId); queue.push(outId)







      }







    }







  }







  return visited







}















function computeAvailable(treeData: TreeData, allocated: Set<string>): Set<string> {







  const avail = new Set<string>()







  for (const id of allocated) {







    const node = treeData.nodes[id]







    if (!node) continue







    for (const outId of node.out) {







      if (!allocated.has(outId)) avail.add(outId)







    }







  }







  return avail







}















function snapshotFromSets(a: Set<string>, b: Set<string>): Snapshot {







  return { allocatedNodes: [...a], availableNodes: [...b] }







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
  weaponSetMode: 0 | 1 | 2
  nodeWeaponSets: Record<string, 1 | 2>
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







  zoomAt: (cx: number, cy: number, factor: number) => void







  setHoveredNode: (id: string | null) => void







  setSelectedNode: (id: string | null) => void







  setMousePos: (x: number, y: number) => void







  setSearchQuery: (q: string) => void







  performSearch: (q: string) => void







  importAllocatedNodes: (ids: string[]) => void







  clearAllocatedNodes: () => void















  toggleNode: (id: string) => void
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







  loadFromHash: (hash: string) => void















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







  treeVersion: '0_4',







  selectedClassId: '6',



  selectedAscendancyId: 'Stormweaver',







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
  weaponSetMode: 0 as 0 | 1 | 2,
  nodeWeaponSets: {} as Record<string, 1 | 2>,
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







      set({ treeData: data, loading: false })















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







      loading: true,







      error: null,







      allocatedNodes: new Set(),







      availableNodes: new Set(),







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







  zoomAt: (cx, cy, factor) => {







    const { zoom, offsetX, offsetY } = get()







    const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom * factor))







    //                 (cx, cy)                







    const newX = cx - (cx - offsetX) * (newZoom / zoom)







    const newY = cy - (cy - offsetY) * (newZoom / zoom)







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







      set({ searchMatchIds: [] })







      return







    }







    const lower = q.toLowerCase()







    const matches: string[] = []







    for (const [id, node] of Object.entries(treeData.nodes)) {







      if (node.name.toLowerCase().includes(lower)) {







        matches.push(id)







      }







      if (matches.length >= 100) break







    }







    set({ searchMatchIds: matches })







  },















  importAllocatedNodes: (ids: string[]) => {







    const { treeData } = get()







    set((state) => {







      const next = new Set(state.allocatedNodes)







      for (const id of ids) next.add(id)







      const avail = treeData ? computeAvailable(treeData, next) : new Set<string>()







      return { allocatedNodes: next, availableNodes: avail }







    })







  },







  clearAllocatedNodes: () => set({







    allocatedNodes: new Set(),







    availableNodes: new Set(),







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

  toggleNode: (id: string) => {







    const { treeData, allocatedNodes, availableNodes } = get()







    if (!treeData) return















    const allocated = new Set(allocatedNodes)















    if (allocated.has(id)) {







      // DEALLOCATE: save snapshot, remove node, prune orphans







      const snap = snapshotFromSets(allocated, availableNodes)







      set((s) => ({







        undoStack: [...s.undoStack.slice(-MAX_UNDO + 1), snap],







        redoStack: [],







      }))







      allocated.delete(id)







      const connected = findConnected(treeData, allocated)







      const avail = computeAvailable(treeData, connected)







      set({ allocatedNodes: connected, availableNodes: avail })







    } else if (availableNodes.has(id)) {







      // ALLOCATE: save snapshot, add node







      const snap = snapshotFromSets(allocated, availableNodes)







      set((s) => ({







        undoStack: [...s.undoStack.slice(-MAX_UNDO + 1), snap],







        redoStack: [],







      }))







      allocated.add(id)







      const avail = computeAvailable(treeData, allocated)







      set({ allocatedNodes: allocated, availableNodes: avail })







    }







  },















  undo: () => {







    const { undoStack, allocatedNodes, availableNodes } = get()







    if (undoStack.length === 0) return







    const snap = undoStack[undoStack.length - 1]







    const curSnap = snapshotFromSets(allocatedNodes, availableNodes)







    set({







      allocatedNodes: new Set(snap.allocatedNodes),







      availableNodes: new Set(snap.availableNodes),







      undoStack: undoStack.slice(0, -1),







      redoStack: [...get().redoStack, curSnap],







    })







  },















  redo: () => {







    const { redoStack, allocatedNodes, availableNodes } = get()







    if (redoStack.length === 0) return







    const snap = redoStack[redoStack.length - 1]







    const curSnap = snapshotFromSets(allocatedNodes, availableNodes)







    set({







      allocatedNodes: new Set(snap.allocatedNodes),







      availableNodes: new Set(snap.availableNodes),







      redoStack: redoStack.slice(0, -1),







      undoStack: [...get().undoStack, curSnap],







    })







  },















  getAllocatedIds: () => [...get().allocatedNodes],















  // === Phase 4.3: URL hash sharing ===















  encodeToHash: () => {







    const ids = [...get().allocatedNodes].sort()







    if (ids.length === 0) return ''







    // Compact: comma-separated, then base64url







    const str = ids.join(',')







    const bytes = new TextEncoder().encode(str)







    // Use btoa with manual base64url







    let binary = ''







    for (let i = 0; i < bytes.length; i++) {







      binary += String.fromCharCode(bytes[i])







    }







    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')







  },















  loadFromHash: (hash: string) => {







    const { treeData } = get()







    if (!treeData || !hash) return







    try {







      // Decode base64url







      const base64 = hash.replace(/-/g, '+').replace(/_/g, '/')







      const binary = atob(base64)







      const bytes = new Uint8Array(binary.length)







      for (let i = 0; i < binary.length; i++) {







        bytes[i] = binary.charCodeAt(i)







      }







      const str = new TextDecoder().decode(bytes)







      const ids = str.split(',').filter(Boolean)







      if (ids.length > 0) {







        const next = new Set(ids)







        const avail = computeAvailable(treeData, next)







        set({ allocatedNodes: next, availableNodes: avail, undoStack: [], redoStack: [] })







      }







    } catch {







      // Ignore invalid hash







    }







  },















  // === Phase 7: Build calculation ===















  runCalculation: async () => {







    const { allocatedNodes, treeVersion, calcLoading } = get()







    if (calcLoading || allocatedNodes.size === 0) return















    set({ calcLoading: true, calcError: null, calcResult: null })















    try {







      // Step 1: Encode nodes via /api/code/encode







      const encodeResp = await fetch('/api/code/encode', {







        method: 'POST',







        headers: { 'Content-Type': 'application/json' },







        body: JSON.stringify({







          nodes: [...allocatedNodes],







          treeVersion,







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
            weaponSetMode, nodeWeaponSets, masterySelections, savedBuilds } = get()
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
      weaponSetMode,
      nodeWeaponSets: { ...nodeWeaponSets },
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
    set({
      allocatedNodes: new Set(build.allocatedNodes),
      selectedClassId: build.selectedClassId,
      selectedAscendancyId: build.selectedAscendancyId,
      weaponSetMode: build.weaponSetMode,
      nodeWeaponSets: { ...build.nodeWeaponSets },
      masterySelections: { ...build.masterySelections },
      undoStack: [],
      redoStack: [],
      calcResult: null,
      calcError: null,
    })
    // Recompute availableNodes
    if (treeData) {
      const allocSet = new Set(build.allocatedNodes)
      const avail = new Set<string>()
      for (const nid of allocSet) {
        const node = treeData.nodes[nid]
        if (!node) continue
        for (const outId of node.out) {
          if (!allocSet.has(outId)) avail.add(outId)
        }
      }
      set({ availableNodes: avail })
    }
  },

  deleteBuild: (id) => {
    const updated = get().savedBuilds.filter((b) => b.id !== id)
    set({ savedBuilds: updated })
    try { localStorage.setItem('pob2-saved-builds', JSON.stringify(updated)) } catch {}
  },

  exportBuildJSON: () => {
    const { allocatedNodes, treeVersion, selectedClassId, selectedAscendancyId,
            weaponSetMode, nodeWeaponSets, masterySelections } = get()
    return JSON.stringify({
      name: 'PoB2 Build',
      exportedAt: new Date().toISOString(),
      treeVersion,
      selectedClassId,
      selectedAscendancyId,
      weaponSetMode,
      nodeWeaponSets,
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
      const allocSet = new Set<string>(nodes)
      set({
        allocatedNodes: allocSet,
        selectedClassId: (build.selectedClassId as string) || get().selectedClassId,
        selectedAscendancyId: (build.selectedAscendancyId as string) || get().selectedAscendancyId,
        weaponSetMode: (build.weaponSetMode as 0 | 1 | 2) || 0,
        nodeWeaponSets: (build.nodeWeaponSets as Record<string, 1 | 2>) || {},
        masterySelections: (build.masterySelections as Record<string, string>) || {},
        undoStack: [],
        redoStack: [],
        calcResult: null,
        calcError: null,
      })
      // Recompute availableNodes
      if (treeData) {
        const avail = new Set<string>()
        for (const nid of allocSet) {
          const node = treeData.nodes[nid]
          if (!node) continue
          for (const outId of node.out) {
            if (!allocSet.has(outId)) avail.add(outId)
          }
        }
        set({ availableNodes: avail })
      }
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


      undoStack: [],


      redoStack: [],


    })


  },





  selectAscendancy: (ascendancyId) => {


    set({ selectedAscendancyId: ascendancyId })


  },


}))








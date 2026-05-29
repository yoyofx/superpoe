import { useCallback, useEffect, useState } from 'react'
import { DEFAULT_ZOOM, FALLBACK_TREE_VERSIONS, loadTreeVersions, MAX_ZOOM, MIN_ZOOM, useTreeStore } from '@/store/treeStore'
import { ExportPanel } from '@/components/ExportPanel'
import { ImportPanel } from '@/components/ImportPanel'
import { SaveLoadPanel } from '@/components/SaveLoadPanel'

type ToolbarMenu = 'export' | 'import' | 'builds' | null

/**
 * Toolbar - top toolbar with search and zoom controls
 */
export function Toolbar() {
  const zoom = useTreeStore((s) => s.zoom)
  const treeVersion = useTreeStore((s) => s.treeVersion)
  const selectedClassId = useTreeStore((s) => s.selectedClassId)
  const selectedAscendancyId = useTreeStore((s) => s.selectedAscendancyId)
  const searchQuery = useTreeStore((s) => s.searchQuery)
  const searchMatchIds = useTreeStore((s) => s.searchMatchIds)
  const allocatedNodes = useTreeStore((s) => s.allocatedNodes)
  const calcLoading = useTreeStore((s) => s.calcLoading)
  const setZoom = useTreeStore((s) => s.setZoom)
  const selectClass = useTreeStore((s) => s.selectClass)
  const selectAscendancy = useTreeStore((s) => s.selectAscendancy)
  const weaponSetMode = useTreeStore((s) => s.weaponSetMode)
  const treeEditMode = useTreeStore((s) => s.treeEditMode)
  const setTreeEditMode = useTreeStore((s) => s.setTreeEditMode)
  const setWeaponSetMode = useTreeStore((s) => s.setWeaponSetMode)
  const setSearchQuery = useTreeStore((s) => s.setSearchQuery)
  const setTreeVersion = useTreeStore((s) => s.setTreeVersion)
  const runCalculation = useTreeStore((s) => s.runCalculation)
  const treeData = useTreeStore((s) => s.treeData)

  const [versions, setVersions] = useState<string[]>(FALLBACK_TREE_VERSIONS)
  const [activeMenu, setActiveMenu] = useState<ToolbarMenu>(null)

  useEffect(() => {
    loadTreeVersions().then(setVersions).catch(() => setVersions(FALLBACK_TREE_VERSIONS))
  }, [])

  const classes = treeData?.constants?.classes
  const classEntries = classes ? Object.entries(classes) : []
  const currentClass = classes?.[selectedClassId]
  const ascendancies = currentClass?.ascendancies || []

  const handleZoomIn = useCallback(() => {
    setZoom(Math.min(MAX_ZOOM, zoom * 1.3))
  }, [zoom, setZoom])

  const handleZoomOut = useCallback(() => {
    setZoom(Math.max(MIN_ZOOM, zoom / 1.3))
  }, [zoom, setZoom])

  const handleZoomReset = useCallback(() => {
    if (!treeData) return
    const c = treeData.constants
    const cx = (c.min_x + c.max_x) / 2
    const cy = (c.min_y + c.max_y) / 2
    useTreeStore.setState({ zoom: DEFAULT_ZOOM, offsetX: -cx, offsetY: -cy })
  }, [treeData])

  const handleZoomFit = useCallback(() => {
    if (!treeData) return
    const c = treeData.constants
    const treeW = c.max_x - c.min_x
    const treeH = c.max_y - c.min_y
    const viewportW = window.innerWidth
    const viewportH = window.innerHeight
    const fitZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Math.min(viewportW / treeW, viewportH / treeH) * 0.94))
    useTreeStore.setState({
      zoom: fitZoom,
      offsetX: -(c.min_x + c.max_x) / 2,
      offsetY: -(c.min_y + c.max_y) / 2,
    })
  }, [treeData])

  const zoomPct = Math.round(zoom * 100)
  const toggleMenu = useCallback((menu: Exclude<ToolbarMenu, null>) => {
    setActiveMenu((current) => current === menu ? null : menu)
  }, [])

  const menuButtonClass = (menu: Exclude<ToolbarMenu, null>) => (
    `px-2.5 py-1.5 rounded-md text-xs font-medium border transition-colors ${
      activeMenu === menu
        ? 'bg-blue-700 text-white border-blue-500'
        : 'bg-gray-800 hover:bg-gray-700 text-gray-300 border-gray-600'
    }`
  )

  return (
    <div className="absolute top-3 left-1/2 -translate-x-1/2 z-40">
      <div className="flex items-center gap-2 bg-gray-900/90 border border-gray-700
                      rounded-lg px-3 py-2 shadow-lg">
      {/* Search */}
      <div className="relative">
        <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500"
             fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <input
          type="text"
          placeholder="Search nodes..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-40 bg-gray-800 text-sm text-white rounded-md pl-8 pr-3 py-1.5
                     border border-gray-600 focus:border-blue-500 focus:outline-none
                     placeholder-gray-500"
        />
        {searchQuery && (
          <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-gray-500">
            {searchMatchIds.length}
          </span>
        )}
      </div>

      {/* Divider */}
      <div className="w-px h-5 bg-gray-700" />

      {/* Version selector */}
      <select
        value={treeVersion}
        onChange={(e) => setTreeVersion(e.target.value)}
        className="bg-gray-800 text-xs text-gray-300 rounded-md px-2 py-1.5
                   border border-gray-600 focus:border-blue-500 focus:outline-none
                   cursor-pointer"
        title="Tree version"
      >
        {versions.map((v) => (
          <option key={v} value={v}>{v.replace('_', '.')}</option>
        ))}
      </select>

      {/* Class selector */}
      <select
        value={selectedClassId}
        onChange={(e) => selectClass(e.target.value)}
        className="bg-gray-800 text-xs text-gray-300 rounded-md px-2 py-1.5
                   border border-gray-600 focus:border-blue-500 focus:outline-none
                   cursor-pointer"
        title="Select class"
      >
        {classEntries.map(([id, cls]) => (
          <option key={id} value={id}>{cls.name}</option>
        ))}
      </select>

      {/* Ascendancy selector */}
      {ascendancies.length > 0 && (
        <select
          value={selectedAscendancyId}
          onChange={(e) => selectAscendancy(e.target.value)}
          className="bg-gray-800 text-xs text-gray-300 rounded-md px-2 py-1.5
                     border border-gray-600 focus:border-blue-500 focus:outline-none
                     cursor-pointer"
          title="Select ascendancy"
        >
          {ascendancies.map((asc: {id?: string, name: string}) => (
            <option key={asc.id || asc.name} value={asc.id || asc.name}>{asc.name}</option>
          ))}
        </select>
      )}

      {/* Tree edit and weapon set mode */}
      <div className={`flex items-center gap-0.5 rounded-md border overflow-hidden ${
        treeEditMode ? 'bg-gray-800 border-amber-500/70' : 'bg-gray-900 border-gray-600'
      }`} title="Passive tree edit mode and weapon set">
        <button onClick={() => setTreeEditMode(!treeEditMode)}
          className={`px-2 py-1 text-[10px] font-semibold transition-colors ${
            treeEditMode ? 'bg-amber-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-gray-200'
          }`}>Edit</button>
        <button onClick={() => setWeaponSetMode(0)}
          disabled={!treeEditMode}
          className={`px-2 py-1 text-[10px] font-medium transition-colors ${
            weaponSetMode===0 && treeEditMode ? 'bg-amber-700 text-white' : 'text-gray-400 hover:text-gray-200 disabled:text-gray-600 disabled:hover:text-gray-600'
          }`}>Both</button>
        <button onClick={() => setWeaponSetMode(1)}
          disabled={!treeEditMode}
          className={`px-2 py-1 text-[10px] font-medium transition-colors ${
            weaponSetMode===1 && treeEditMode ? 'bg-red-700 text-white' : 'text-gray-400 hover:text-gray-200 disabled:text-gray-600 disabled:hover:text-gray-600'
          }`}>Set1</button>
        <button onClick={() => setWeaponSetMode(2)}
          disabled={!treeEditMode}
          className={`px-2 py-1 text-[10px] font-medium transition-colors ${
            weaponSetMode===2 && treeEditMode ? 'bg-green-700 text-white' : 'text-gray-400 hover:text-gray-200 disabled:text-gray-600 disabled:hover:text-gray-600'
          }`}>Set2</button>
      </div>

      {/* Divider */}
      <div className="w-px h-5 bg-gray-700" />

      {/* Menus */}
      <button
        onClick={() => toggleMenu('export')}
        className={menuButtonClass('export')}
        title="Export PoB2 build code"
      >
        Export
      </button>
      <button
        onClick={() => toggleMenu('import')}
        className={menuButtonClass('import')}
        title="Import PoB2 build code"
      >
        Import
      </button>
      <button
        onClick={() => toggleMenu('builds')}
        className={menuButtonClass('builds')}
        title="Save and load builds"
      >
        Builds
      </button>

      {/* Divider */}
      <div className="w-px h-5 bg-gray-700" />

      {/* Calculate button */}
      <button
        onClick={runCalculation}
        disabled={allocatedNodes.size === 0 || calcLoading}
        className={`flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-medium
                    border transition-colors
                    ${allocatedNodes.size === 0
                      ? 'bg-gray-800 text-gray-600 border-gray-700 cursor-not-allowed'
                      : 'bg-amber-700 hover:bg-amber-600 text-amber-100 border-amber-600'
                    }`}
        title={allocatedNodes.size === 0 ? 'Allocate nodes to calculate' : 'Calculate build stats'}
      >
        {calcLoading ? (
          <svg className="animate-spin w-3.5 h-3.5" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
        ) : (
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
        )}
        Calc
      </button>

      {/* Divider */}
      <div className="w-px h-5 bg-gray-700" />

      {/* Zoom controls */}
      <button
        onClick={handleZoomOut}
        className="w-7 h-7 flex items-center justify-center rounded-md
                   bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm font-bold
                   border border-gray-600 transition-colors"
        title="Zoom out"
      >
        -
      </button>

      <button
        onClick={handleZoomReset}
        className="text-xs text-gray-400 min-w-[42px] text-center
                   hover:text-white transition-colors font-mono"
        title="Reset zoom"
      >
        {zoomPct}%
      </button>

      <button
        onClick={handleZoomFit}
        className="px-2 h-7 flex items-center justify-center rounded-md
                   bg-gray-800 hover:bg-gray-700 text-gray-300 text-[10px] font-semibold
                   border border-gray-600 transition-colors"
        title="Fit whole passive tree"
      >
        Fit
      </button>

      <button
        onClick={handleZoomIn}
        className="w-7 h-7 flex items-center justify-center rounded-md
                   bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm font-bold
                   border border-gray-600 transition-colors"
        title="Zoom in"
      >
        +
      </button>
      </div>

      {activeMenu && (
        <div className="absolute top-full left-1/2 -translate-x-1/2 mt-2">
          {activeMenu === 'export' && <ExportPanel embedded />}
          {activeMenu === 'import' && <ImportPanel embedded />}
          {activeMenu === 'builds' && <SaveLoadPanel embedded />}
        </div>
      )}
    </div>
  )
}

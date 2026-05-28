import { useState, useRef, useCallback } from 'react'
import { useTreeStore } from '@/store/treeStore'

/**
 * SaveLoadPanel - Build save/load/export/import/share (Phase 16.7 + 16.9)
 */
export function SaveLoadPanel() {
  const [name, setName] = useState('')
  const [showList, setShowList] = useState(false)
  const [shared, setShared] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const allocatedNodes = useTreeStore((s) => s.allocatedNodes)
  const savedBuilds = useTreeStore((s) => s.savedBuilds)
  const saveBuild = useTreeStore((s) => s.saveBuild)
  const loadBuild = useTreeStore((s) => s.loadBuild)
  const deleteBuild = useTreeStore((s) => s.deleteBuild)
  const exportBuildJSON = useTreeStore((s) => s.exportBuildJSON)
  const importBuildJSON = useTreeStore((s) => s.importBuildJSON)
  const nodeCount = allocatedNodes.size

  const handleSave = useCallback(() => {
    const n = name.trim() || `Build ${new Date().toLocaleString()}`
    saveBuild(n)
    setName('')
    setShowList(true)
  }, [name, saveBuild])

  const handleExport = useCallback(() => {
    if (nodeCount === 0) return
    const json = exportBuildJSON()
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `pob2-build-${Date.now()}.json`
    a.click()
    URL.revokeObjectURL(url)
  }, [nodeCount, exportBuildJSON])

  const handleImport = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const text = reader.result as string
        // Validate it's JSON
        JSON.parse(text)
        importBuildJSON(text)
        setShowList(true)
      } catch {
        alert('Invalid build file')
      }
    }
    reader.readAsText(file)
    // Reset input so same file can be re-imported
    e.target.value = ''
  }, [importBuildJSON])

  return (
    <div className="absolute bottom-3 left-3 z-40">
      {/* Toggle button */}
      <button
        onClick={() => setShowList(!showList)}
        className="flex items-center gap-1.5 bg-gray-900/90 border border-gray-700
                   rounded-lg px-3 py-1.5 text-sm text-gray-300 hover:text-white
                   hover:bg-gray-800 transition-colors shadow-lg"
        title="Save / Load builds"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
        </svg>
        Builds
        {savedBuilds.length > 0 && (
          <span className="bg-blue-600 text-white text-[10px] px-1.5 py-0.5 rounded-full leading-none">
            {savedBuilds.length}
          </span>
        )}
      </button>

      {showList && (
        <div className="mt-2 bg-gray-900/95 border border-gray-700 rounded-lg p-3
                        shadow-xl min-w-[260px] max-w-[320px] max-h-[400px] flex flex-col">
          {/* Header */}
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-medium text-gray-200">Saved Builds</h3>
            <button
              onClick={() => setShowList(false)}
              className="text-gray-500 hover:text-gray-300 text-lg leading-none">&times;</button>
          </div>

          {/* Save new */}
          <div className="flex gap-1.5 mb-2">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSave()}
              placeholder="Build name..."
              className="flex-1 bg-gray-800 text-sm text-gray-200 rounded px-2 py-1
                         border border-gray-600 focus:border-blue-500 focus:outline-none
                         placeholder-gray-500"
            />
            <button
              onClick={handleSave}
              disabled={nodeCount === 0}
              className="px-3 py-1 text-xs bg-blue-600 hover:bg-blue-500
                         disabled:bg-gray-700 disabled:text-gray-500
                         text-white rounded transition-colors"
            >
              Save
            </button>
          </div>

          {/* Build list */}
          {savedBuilds.length > 0 ? (
            <div className="flex-1 overflow-y-auto space-y-1 mb-2">
              {savedBuilds.map((build) => (
                <div
                  key={build.id}
                  className="flex items-center justify-between gap-1 bg-gray-800/60
                             rounded px-2 py-1.5 group hover:bg-gray-800 transition-colors"
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-sm text-gray-200 truncate">{build.name}</div>
                    <div className="text-[10px] text-gray-500">
                      {build.allocatedNodes.length} nodes &middot; {build.treeVersion.replace('_', '.')}
                    </div>
                  </div>
                  <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => loadBuild(build.id)}
                      className="px-2 py-0.5 text-[10px] bg-green-700 hover:bg-green-600
                                 text-white rounded transition-colors"
                      title="Load"
                    >
                      Load
                    </button>
                    <button
                      onClick={() => deleteBuild(build.id)}
                      className="px-2 py-0.5 text-[10px] bg-red-800 hover:bg-red-700
                                 text-white rounded transition-colors"
                      title="Delete"
                    >
                      Del
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-gray-500 mb-2 italic">
              No saved builds yet. Save one above or import a .json file.
            </p>
          )}

          {/* Export / Import */}
          <div className="flex gap-2 pt-2 border-t border-gray-700/50">
            <button
              onClick={handleExport}
              disabled={nodeCount === 0}
              className="flex-1 px-2 py-1 text-[11px] bg-gray-700 hover:bg-gray-600
                         disabled:text-gray-600 text-gray-300 rounded transition-colors"
              title="Download current build as .json"
            >
              Export .json
            </button>
            <button
              onClick={() => fileRef.current?.click()}
              className="flex-1 px-2 py-1 text-[11px] bg-gray-700 hover:bg-gray-600
                         text-gray-300 rounded transition-colors"
              title="Import a previously exported .json build"
            >
              Import .json
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".json"
              onChange={handleImport}
              className="hidden"
            />
          </div>
        </div>
      )}
    </div>
  )
}

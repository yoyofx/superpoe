import { useEffect } from 'react'
import { useTreeStore } from '@/store/treeStore'
import { TreeCanvas } from '@/components/TreeCanvas'
import { Toolbar } from '@/components/Toolbar'
import { NodeTooltip } from '@/components/NodeTooltip'
import { Sidebar } from '@/components/Sidebar'
import { ImportPanel } from '@/components/ImportPanel'
import { ExportPanel } from '@/components/ExportPanel'
import { StatTable } from '@/components/StatTable'
import { SaveLoadPanel } from '@/components/SaveLoadPanel'

export default function App() {
  const { treeData, loading, error, loadTreeData, loadSavedBuilds } = useTreeStore()
  const allocatedNodes = useTreeStore((s) => s.allocatedNodes)
  const encodeToHash = useTreeStore((s) => s.encodeToHash)
  const loadFromHash = useTreeStore((s) => s.loadFromHash)
  const treeLoaded = !!treeData

  useEffect(() => {
    loadTreeData()
    loadSavedBuilds()
  }, [loadTreeData, loadSavedBuilds])

  // Load from URL hash on tree ready
  useEffect(() => {
    if (treeLoaded && window.location.hash) {
      const hash = window.location.hash.slice(1)
      if (hash) {
        loadFromHash(hash)
      }
    }
  }, [treeLoaded])

  // Update URL hash when allocations change (debounced)
  useEffect(() => {
    if (!treeLoaded) return
    const timer = setTimeout(() => {
      const hash = encodeToHash()
      const current = window.location.hash.slice(1)
      if (hash !== current) {
        if (hash) {
          window.history.replaceState(null, '', '#' + hash)
        } else if (current) {
          window.history.replaceState(null, '', window.location.pathname)
        }
      }
    }, 500)
    return () => clearTimeout(timer)
  }, [allocatedNodes, treeLoaded, encodeToHash])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <p className="text-lg text-gray-400">Loading passive tree...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-screen">
        <p className="text-lg text-red-400">Error: {error}</p>
      </div>
    )
  }

  if (!treeData) return null

  return (
    <div className="w-screen h-screen relative">
      <TreeCanvas />
      <Toolbar />
      <Sidebar />
      <NodeTooltip />
      <ImportPanel />
      <ExportPanel />
      <StatTable />
      <SaveLoadPanel />
    </div>
  )
}

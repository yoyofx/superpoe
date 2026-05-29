import { useEffect } from 'react'
import { useTreeStore } from '@/store/treeStore'
import { TreePixiCanvas } from '@/components/TreePixiCanvas'
import { Toolbar } from '@/components/Toolbar'
import { NodeTooltip } from '@/components/NodeTooltip'
import { StatTable } from '@/components/StatTable'

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
      <TreePixiCanvas />
      <Toolbar />
      <NodeTooltip />
      <StatTable />
    </div>
  )
}

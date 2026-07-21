import { useEffect, useRef, useState } from 'react'
import { useTreeStore } from '@/store/treeStore'
import { TreePixiCanvas } from '@/components/TreePixiCanvas'
import { Toolbar } from '@/components/Toolbar'
import type { WorkspaceView } from '@/components/Toolbar'
import { NodeTooltip } from '@/components/NodeTooltip'
import { StatTable } from '@/components/StatTable'
import { Sidebar } from '@/components/Sidebar'
import { useTranslation } from '@/i18n/useTranslation'
import { EquipmentPanel } from '@/components/EquipmentPanel'
import { writePersistedImportedBuild } from '@/engine/buildPersistence'

export default function App() {
  const { t, lang } = useTranslation()
  const hashLoadedRef = useRef(false)
  const [activeView, setActiveView] = useState<WorkspaceView>('passive')
  const { treeData, loading, error, loadTreeData, loadSavedBuilds } = useTreeStore()
  const allocatedNodes = useTreeStore((s) => s.allocatedNodes)
  const nodeWeaponSets = useTreeStore((s) => s.nodeWeaponSets)
  const nodeAttributeSelections = useTreeStore((s) => s.nodeAttributeSelections)
  const treeVersion = useTreeStore((s) => s.treeVersion)
  const importedBuildCode = useTreeStore((s) => s.importedBuildCode)
  const selectedClassId = useTreeStore((s) => s.selectedClassId)
  const selectedAscendancyId = useTreeStore((s) => s.selectedAscendancyId)
  const encodeToHash = useTreeStore((s) => s.encodeToHash)
  const loadFromHash = useTreeStore((s) => s.loadFromHash)
  const treeLoaded = !!treeData

  useEffect(() => {
    loadTreeData()
    loadSavedBuilds()
  }, [loadTreeData, loadSavedBuilds])

  useEffect(() => {
    const openEquipment = () => setActiveView('equipment')
    window.addEventListener('open-equipment-panel', openEquipment)
    return () => window.removeEventListener('open-equipment-panel', openEquipment)
  }, [])

  // Load from URL hash on tree ready
  useEffect(() => {
    if (treeLoaded && window.location.hash) {
      const hash = window.location.hash.slice(1)
      if (hash) {
        void Promise.resolve(loadFromHash(hash)).finally(() => {
          hashLoadedRef.current = true
        })
      } else {
        hashLoadedRef.current = true
      }
    } else if (treeLoaded) {
      hashLoadedRef.current = true
    }
  }, [treeLoaded, loadFromHash])

  // Update URL hash when allocations change (debounced)
  useEffect(() => {
    if (!treeLoaded || !hashLoadedRef.current) return
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
      if (importedBuildCode) writePersistedImportedBuild(localStorage, hash, importedBuildCode)
    }, 500)
    return () => clearTimeout(timer)
  }, [
    allocatedNodes,
    nodeWeaponSets,
    nodeAttributeSelections,
    treeVersion,
    selectedClassId,
    selectedAscendancyId,
    treeLoaded,
    encodeToHash,
    importedBuildCode,
  ])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <p className="text-lg text-gray-400">{t('loading')}</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-screen">
        <p className="text-lg text-red-400">{t('error.prefix')}: {error}</p>
      </div>
    )
  }

  if (!treeData) return null

  return (
    <div className="superpoe-app">
      <Toolbar activeView={activeView} onViewChange={setActiveView} />
      <main className="workspace-view">
        {activeView === 'passive' && (
          <section className="passive-workspace">
            <TreePixiCanvas />
            <NodeTooltip />
            <Sidebar />
          </section>
        )}
        {activeView === 'equipment' && <EquipmentPanel />}
        {activeView === 'skills' && (
          <section className="workspace-empty">
            <div className="empty-glyph">✦</div>
            <h2>{lang === 'zh-rCN' ? '技能工作区' : 'Skills workspace'}</h2>
            <p>{lang === 'zh-rCN' ? '技能数据仍保持独立，本版先完成统一工作台结构。' : 'Skill data remains separate; this first pass establishes the workspace structure.'}</p>
          </section>
        )}
        {activeView === 'calculation' && <StatTable page />}
      </main>
    </div>
  )
}

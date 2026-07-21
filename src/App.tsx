import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, CheckCircle2, XCircle } from 'lucide-react'
import { useTreeStore } from '@/store/treeStore'
import { TreePixiCanvas } from '@/components/TreePixiCanvas'
import { Toolbar } from '@/components/Toolbar'
import type { WorkspaceView } from '@/components/Toolbar'
import { NodeTooltip } from '@/components/NodeTooltip'
import { StatTable } from '@/components/StatTable'
import { useTranslation } from '@/i18n/useTranslation'
import { EquipmentPanel } from '@/components/EquipmentPanel'
import { writePersistedImportedBuild } from '@/engine/buildPersistence'
import { BuildCenter } from '@/components/BuildCenter'
import { NewBuildDialog, type NewBuildInput } from '@/components/NewBuildDialog'
import { UnifiedImportDialog, type ImportConfirmation } from '@/components/UnifiedImportDialog'
import { importPobBuildCode } from '@/engine/importPobBuildCode'
import type { SavedBuild } from '@/types/tree'
import { SkillsPanel } from '@/components/SkillsPanel'

export default function App() {
  const { t, lang } = useTranslation()
  const hashLoadedRef = useRef(false)
  const cleanSignatureRef = useRef('')
  const [screen, setScreen] = useState<'center' | 'editor'>('center')
  const [activeView, setActiveView] = useState<WorkspaceView>('equipment')
  const [buildName, setBuildName] = useState(lang === 'zh-rCN' ? '未命名构筑' : 'Untitled build')
  const [activeBuildId, setActiveBuildId] = useState<string | null>(null)
  const [buildSource, setBuildSource] = useState<SavedBuild['source']>('local')
  const [saveStatus, setSaveStatus] = useState<'saved' | 'dirty' | 'saving' | 'error'>('saved')
  const [saveNotice, setSaveNotice] = useState<{ type: 'success' | 'error'; message: string } | null>(null)
  const [newBuildOpen, setNewBuildOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [leaveConfirmOpen, setLeaveConfirmOpen] = useState(false)
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
  const saveBuild = useTreeStore((s) => s.saveBuild)
  const loadBuild = useTreeStore((s) => s.loadBuild)
  const clearAllocatedNodes = useTreeStore((s) => s.clearAllocatedNodes)
  const selectClass = useTreeStore((s) => s.selectClass)
  const selectAscendancy = useTreeStore((s) => s.selectAscendancy)
  const setTreeVersion = useTreeStore((s) => s.setTreeVersion)
  const importBuildJSON = useTreeStore((s) => s.importBuildJSON)
  const buildRealm = useTreeStore((s) => s.buildRealm)
  const setBuildRealm = useTreeStore((s) => s.setBuildRealm)

  const buildSignature = useMemo(() => JSON.stringify({
    nodes: [...allocatedNodes].sort(),
    nodeWeaponSets,
    nodeAttributeSelections,
    treeVersion,
    selectedClassId,
    selectedAscendancyId,
    buildRealm,
  }), [allocatedNodes, nodeWeaponSets, nodeAttributeSelections, treeVersion, selectedClassId, selectedAscendancyId, buildRealm])

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

  useEffect(() => {
    if (screen !== 'editor' || !cleanSignatureRef.current) return
    setSaveStatus(buildSignature === cleanSignatureRef.current ? 'saved' : 'dirty')
  }, [buildSignature, screen])

  useEffect(() => {
    if (!saveNotice) return
    const timer = window.setTimeout(() => setSaveNotice(null), 2500)
    return () => window.clearTimeout(timer)
  }, [saveNotice])

  const markClean = useCallback(() => {
    const state = useTreeStore.getState()
    cleanSignatureRef.current = JSON.stringify({
      nodes: [...state.allocatedNodes].sort(),
      nodeWeaponSets: state.nodeWeaponSets,
      nodeAttributeSelections: state.nodeAttributeSelections,
      treeVersion: state.treeVersion,
      selectedClassId: state.selectedClassId,
      selectedAscendancyId: state.selectedAscendancyId,
      buildRealm: state.buildRealm,
    })
    setSaveStatus('saved')
  }, [])

  const enterEditor = useCallback((name: string, id: string | null = null, source: SavedBuild['source'] = 'local') => {
    setBuildName(name)
    setActiveBuildId(id)
    setBuildSource(source)
    setActiveView('equipment')
    setScreen('editor')
    window.setTimeout(markClean, 0)
  }, [markClean])

  const handleOpenBuild = useCallback(async (build: SavedBuild) => {
    await Promise.resolve(loadBuild(build.id))
    enterEditor(build.name, build.id, build.source || (build.importedBuildCode ? 'pob' : 'local'))
  }, [enterEditor, loadBuild])

  const handleCreateBuild = useCallback(async (input: NewBuildInput) => {
    if (input.treeVersion !== useTreeStore.getState().treeVersion) await setTreeVersion(input.treeVersion)
    selectClass(input.classId)
    if (input.ascendancyId) selectAscendancy(input.ascendancyId)
    else useTreeStore.setState({ selectedAscendancyId: '' })
    clearAllocatedNodes()
    setBuildRealm(input.realm)
    setNewBuildOpen(false)
    enterEditor(input.name, null, 'local')
  }, [clearAllocatedNodes, enterEditor, selectAscendancy, selectClass, setBuildRealm, setTreeVersion])

  const handleImportConfirmation = useCallback(async (confirmation: ImportConfirmation) => {
    if (confirmation.kind === 'json') {
      importBuildJSON(confirmation.value)
    } else {
      const code = confirmation.kind === 'wegame' ? confirmation.code : confirmation.value
      if (!code) throw new Error('Missing converted PoB code')
      await importPobBuildCode(code)
    }
    setBuildRealm(confirmation.realm)
    if (confirmation.mode === 'new' || screen === 'center') {
      setBuildName(confirmation.suggestedName)
      setActiveBuildId(null)
    }
    setBuildSource(confirmation.kind)
    setActiveView('equipment')
    setScreen('editor')
    window.setTimeout(markClean, 0)
  }, [importBuildJSON, markClean, screen, setBuildRealm])

  const handleSave = useCallback(() => {
    setSaveStatus('saving')
    try {
      const savedId = saveBuild(buildName.trim() || (lang === 'zh-rCN' ? '未命名构筑' : 'Untitled build'), activeBuildId, buildSource)
      setActiveBuildId(savedId)
      markClean()
      setSaveNotice({ type: 'success', message: lang === 'zh-rCN' ? '构筑已保存' : 'Build saved' })
    } catch {
      setSaveStatus('error')
      setSaveNotice({ type: 'error', message: lang === 'zh-rCN' ? '保存失败，请检查本地存储空间' : 'Save failed. Check local storage availability.' })
    }
  }, [activeBuildId, buildName, buildSource, lang, markClean, saveBuild])

  const handleBuildNameChange = useCallback((name: string) => {
    setBuildName(name)
    setSaveStatus('dirty')
  }, [])

  const requestHome = useCallback(() => {
    if (saveStatus === 'dirty') setLeaveConfirmOpen(true)
    else setScreen('center')
  }, [saveStatus])

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
      {screen === 'center' ? <BuildCenter onCreate={() => setNewBuildOpen(true)} onImport={() => setImportOpen(true)} onOpen={(build) => void handleOpenBuild(build)} /> : <>
      <Toolbar activeView={activeView} onViewChange={setActiveView} buildName={buildName} onBuildNameChange={handleBuildNameChange} saveStatus={saveStatus} onHome={requestHome} onImport={() => setImportOpen(true)} onSave={handleSave} />
      <main className="workspace-view">
        {activeView === 'passive' && (
          <section className="passive-workspace">
            <TreePixiCanvas />
            <NodeTooltip />
          </section>
        )}
        {activeView === 'equipment' && <EquipmentPanel />}
        {activeView === 'skills' && <SkillsPanel />}
        {activeView === 'calculation' && <StatTable page />}
      </main>
      </>}
      <NewBuildDialog open={newBuildOpen} onClose={() => setNewBuildOpen(false)} onCreate={(input) => void handleCreateBuild(input)} />
      <UnifiedImportDialog open={importOpen} hasCurrentBuild={screen === 'editor'} onClose={() => setImportOpen(false)} onConfirm={handleImportConfirmation} />
      {leaveConfirmOpen && <div className="modal-backdrop"><section className="confirm-dialog" role="alertdialog" aria-modal="true"><AlertTriangle /><h2>{lang === 'zh-rCN' ? '离开当前构筑？' : 'Leave current build?'}</h2><p>{lang === 'zh-rCN' ? '当前构筑有未保存修改。离开后仍会保留自动草稿，但不会出现在命名构筑列表中。' : 'This build has unsaved changes. The draft remains locally, but it will not appear as a named build.'}</p><footer><button className="secondary-command" onClick={() => setLeaveConfirmOpen(false)}>{lang === 'zh-rCN' ? '继续编辑' : 'Keep editing'}</button><button className="primary-command" onClick={() => { setLeaveConfirmOpen(false); setScreen('center') }}>{lang === 'zh-rCN' ? '离开' : 'Leave'}</button></footer></section></div>}
      {saveNotice && <div className={`save-notice ${saveNotice.type}`} role="status" aria-live="polite">
        {saveNotice.type === 'success' ? <CheckCircle2 /> : <XCircle />}
        <span>{saveNotice.message}</span>
      </div>}
    </div>
  )
}

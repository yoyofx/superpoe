import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, CheckCircle2, LoaderCircle, XCircle } from 'lucide-react'
import { useTreeStore } from '@/store/treeStore'
import { Toolbar } from '@/components/Toolbar'
import type { WorkspaceView } from '@/components/Toolbar'
import { useTranslation } from '@/i18n/useTranslation'
import { writePersistedImportedBuild } from '@/engine/buildPersistence'
import { BuildCenter } from '@/components/BuildCenter'
import { BuildUpdateDialog } from '@/components/BuildUpdateDialog'
import { UtilityCenter } from '@/components/UtilityCenter'
import { AboutPage } from '@/components/AboutPage'
import { EquipmentLibraryPage } from '@/components/EquipmentLibraryPage'
import { NewBuildDialog, type NewBuildInput } from '@/components/NewBuildDialog'
import { UnifiedImportDialog, type ImportConfirmation } from '@/components/UnifiedImportDialog'
import { importPobBuildCode } from '@/engine/importPobBuildCode'
import { requestPoe2dbImport } from '@/engine/poe2dbImport'
import { requestPoeNinjaImport } from '@/engine/poeNinjaImport'
import type { SavedBuild } from '@/types/tree'
import { NativeBuildOpenDialog } from '@/components/NativeBuildOpenDialog'
import {
  createSuperPoeBuildFile,
  parseSuperPoeBuildFile,
  sanitizeSuperPoeBuildFileName,
  type ParsedSuperPoeBuildFile,
} from '@/engine/superPoeBuildFile'
import { encodeBuildCode, getEncodeClassPayload } from '@/engine/buildCode'
import { compareBuildCodes, type BuildUpdateDiff } from '@/engine/buildDiff'
import { SUPERPOE_PACKAGE_VERSION } from '@/engine/appVersion'
import { GlobalSettingsDialog } from '@/components/GlobalSettingsDialog'
import { loadAppSettings, saveAppSettings, type AppSettings } from '@/engine/appSettings'
import { UpdateDialog } from '@/components/UpdateDialog'
import type { MarketWorkspaceView } from '@/components/market/MarketShell'
import type { MarketMonitoringSnapshot } from '@/types/market'
import type { Language } from '@/i18n/translationLoader'
import { uiText } from '@/i18n/uiLocale'

const TreePixiCanvas = lazy(() => import('@/components/TreePixiCanvas').then((module) => ({ default: module.TreePixiCanvas })))
const NodeTooltip = lazy(() => import('@/components/NodeTooltip').then((module) => ({ default: module.NodeTooltip })))
const EquipmentPanel = lazy(() => import('@/components/EquipmentPanel').then((module) => ({ default: module.EquipmentPanel })))
const SkillsWorkspace = lazy(() => import('@/components/SkillsWorkspace').then((module) => ({ default: module.SkillsWorkspace })))
const MarketShell = lazy(() => import('@/components/market/MarketShell').then((module) => ({ default: module.MarketShell })))

function WorkspaceLoading({ language, error }: { language: Language; error?: string | null }) {
  return <section className={`workspace-loading${error ? ' error' : ''}`} role="status">
    {error ? <AlertTriangle /> : <LoaderCircle />}
    <strong>{error ? uiText(language, 'Passive tree data failed to load', '天赋树数据加载失败', '天賦樹資料載入失敗', '패시브 트리 데이터를 불러오지 못했습니다') : uiText(language, 'Preparing build editor', '正在准备构筑编辑器', '正在準備構築編輯器', '빌드 편집기 준비 중')}</strong>
    {error && <small>{error}</small>}
  </section>
}

export default function App() {
  const { lang } = useTranslation()
  const l = (en: string, zhCN: string, zhTW: string, koKR: string) => uiText(lang, en, zhCN, zhTW, koKR)
  const hashLoadedRef = useRef(false)
  const cleanSignatureRef = useRef('')
  const [screen, setScreen] = useState<'center' | 'utilities' | 'about' | 'library' | 'editor' | 'trade'>('center')
  const [activeView, setActiveView] = useState<WorkspaceView>('equipment')
  const [marketWorkspace, setMarketWorkspace] = useState<MarketWorkspaceView>('market')
  const [tradeReturnScreen, setTradeReturnScreen] = useState<'center' | 'editor' | 'library'>('center')
  const [monitoring, setMonitoring] = useState<MarketMonitoringSnapshot | null>(null)
  const [buildName, setBuildName] = useState(l('Untitled build', '未命名构筑', '未命名構築', '이름 없는 빌드'))
  const [activeBuildId, setActiveBuildId] = useState<string | null>(null)
  const [buildSource, setBuildSource] = useState<SavedBuild['source']>('local')
  const [buildSourceUrl, setBuildSourceUrl] = useState<string | null>(null)
  const [saveStatus, setSaveStatus] = useState<'saved' | 'dirty' | 'saving' | 'error'>('saved')
  const [saveNotice, setSaveNotice] = useState<{ type: 'success' | 'error'; message: string } | null>(null)
  const [newBuildOpen, setNewBuildOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [nativeBuildCandidate, setNativeBuildCandidate] = useState<{ parsed: ParsedSuperPoeBuildFile; filePath?: string } | null>(null)
  const [nativeBuildBusy, setNativeBuildBusy] = useState(false)
  const [nativeBuildError, setNativeBuildError] = useState<string | null>(null)
  const [buildUpdateTarget, setBuildUpdateTarget] = useState<SavedBuild | null>(null)
  const [buildUpdateCode, setBuildUpdateCode] = useState<string | null>(null)
  const [buildUpdateDiff, setBuildUpdateDiff] = useState<BuildUpdateDiff | null>(null)
  const [buildUpdateChecking, setBuildUpdateChecking] = useState(false)
  const [buildUpdateBusy, setBuildUpdateBusy] = useState(false)
  const [buildUpdateError, setBuildUpdateError] = useState<string | null>(null)
  const buildUpdateRequestRef = useRef(0)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [leaveConfirmOpen, setLeaveConfirmOpen] = useState(false)
  const [appSettings, setAppSettings] = useState(loadAppSettings)
  const { treeData, error, loadTreeData, loadSavedBuilds } = useTreeStore()
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
  const savedBuilds = useTreeStore((s) => s.savedBuilds)
  const loadBuild = useTreeStore((s) => s.loadBuild)
  const clearAllocatedNodes = useTreeStore((s) => s.clearAllocatedNodes)
  const selectClass = useTreeStore((s) => s.selectClass)
  const selectAscendancy = useTreeStore((s) => s.selectAscendancy)
  const setTreeVersion = useTreeStore((s) => s.setTreeVersion)
  const buildRealm = useTreeStore((s) => s.buildRealm)
  const setBuildRealm = useTreeStore((s) => s.setBuildRealm)
  const calculationProfiles = useTreeStore((s) => s.calculationProfiles)
  const activeCalculationProfileId = useTreeStore((s) => s.activeCalculationProfileId)

  const buildSignature = useMemo(() => JSON.stringify({
    nodes: [...allocatedNodes].sort(),
    nodeWeaponSets,
    nodeAttributeSelections,
    treeVersion,
    selectedClassId,
    selectedAscendancyId,
    buildRealm,
    calculationProfiles,
    activeCalculationProfileId,
  }), [allocatedNodes, nodeWeaponSets, nodeAttributeSelections, treeVersion, selectedClassId, selectedAscendancyId, buildRealm, calculationProfiles, activeCalculationProfileId])

  useEffect(() => {
    loadSavedBuilds()
    let active = true
    const initializeHeavyData = () => {
      if (!active) return
      void loadTreeData()
      void import('@/engine/pobLuaClient').then(({ initPobLuaEngine }) => initPobLuaEngine()).catch(() => {
        // Calculation surfaces report runtime errors when the user needs them.
      })
    }
    const idleId = window.requestIdleCallback
      ? window.requestIdleCallback(initializeHeavyData, { timeout: 600 })
      : window.setTimeout(initializeHeavyData, 32)
    return () => {
      active = false
      if (window.cancelIdleCallback && typeof idleId === 'number') window.cancelIdleCallback(idleId)
      else window.clearTimeout(idleId)
    }
  }, [loadTreeData, loadSavedBuilds])

  useEffect(() => {
    const factor = appSettings.uiScalePercent / 100
    if (window.pob2Desktop?.setUiScale) {
      document.documentElement.style.removeProperty('zoom')
      void window.pob2Desktop.setUiScale(factor)
        .then(() => window.dispatchEvent(new Event('resize')))
        .catch(() => {
          document.documentElement.style.setProperty('zoom', String(factor))
          window.dispatchEvent(new Event('resize'))
        })
      return
    }
    document.documentElement.style.setProperty('zoom', String(factor))
    window.dispatchEvent(new Event('resize'))
  }, [appSettings.uiScalePercent])

  useEffect(() => {
    const root = document.querySelector<HTMLElement>('.superpoe-app')
    if (!root) return
    let activeButton: HTMLButtonElement | null = null

    const clearButtonPointer = (button: HTMLButtonElement | null) => {
      button?.style.removeProperty('--button-pointer-x')
      button?.style.removeProperty('--button-pointer-y')
      button?.style.removeProperty('--button-glass-opacity')
    }

    const handlePointerMove = (event: PointerEvent) => {
      if (!(event.target instanceof Element)) return
      const button = event.target.closest('button')
      if (!(button instanceof HTMLButtonElement) || !root.contains(button)) return
      if (activeButton !== button) {
        clearButtonPointer(activeButton)
        activeButton = button
      }
      const rect = button.getBoundingClientRect()
      button.style.setProperty('--button-pointer-x', `${event.clientX - rect.left}px`)
      button.style.setProperty('--button-pointer-y', `${event.clientY - rect.top}px`)
      button.style.setProperty('--button-glass-opacity', '1')
    }

    const handlePointerOut = (event: PointerEvent) => {
      if (!(event.target instanceof Element)) return
      const button = event.target.closest('button')
      if (!(button instanceof HTMLButtonElement)) return
      if (event.relatedTarget instanceof Node && button.contains(event.relatedTarget)) return
      clearButtonPointer(button)
      if (activeButton === button) activeButton = null
    }

    root.addEventListener('pointermove', handlePointerMove, { passive: true })
    root.addEventListener('pointerout', handlePointerOut, { passive: true })
    return () => {
      root.removeEventListener('pointermove', handlePointerMove)
      root.removeEventListener('pointerout', handlePointerOut)
      clearButtonPointer(activeButton)
    }
  }, [])

  useEffect(() => {
    void window.pob2Desktop?.setAppContext({ defaultRealm: appSettings.defaultRealm, language: lang, priceCheckEnabled: appSettings.priceCheckEnabled, priceCheckHotkey: appSettings.priceCheckHotkey })
  }, [appSettings.defaultRealm, appSettings.priceCheckEnabled, appSettings.priceCheckHotkey, lang])

  useEffect(() => {
    const bridge = window.pob2Market
    if (!bridge) return
    let active = true
    void bridge.getMonitoring().then((snapshot) => { if (active) setMonitoring(snapshot) }).catch(() => {})
    const offChanged = bridge.onMonitoringChanged((snapshot) => { if (active) setMonitoring(snapshot) })
    return () => { active = false; offChanged() }
  }, [])

  useEffect(() => {
    const bridge = window.pob2Market
    if (!bridge) return
    return bridge.onOpenMonitoring(() => {
      if (screen !== 'trade') setTradeReturnScreen(screen === 'editor' ? 'editor' : screen === 'library' ? 'library' : 'center')
      setMarketWorkspace('monitoring')
      setScreen('trade')
    })
  }, [screen])

  useEffect(() => {
    if (screen !== 'trade' || marketWorkspace !== 'market') {
      void window.pob2Market?.deactivate().catch(() => {})
    }
  }, [marketWorkspace, screen])

  useEffect(() => {
    const openEquipment = () => setActiveView('equipment')
    window.addEventListener('open-equipment-panel', openEquipment)
    return () => window.removeEventListener('open-equipment-panel', openEquipment)
  }, [])

  useEffect(() => {
    const openMarket = () => {
      setTradeReturnScreen('editor')
      setMarketWorkspace('market')
      setScreen('trade')
    }
    window.addEventListener('open-market-panel', openMarket)
    return () => window.removeEventListener('open-market-panel', openMarket)
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
      calculationProfiles: state.calculationProfiles,
      activeCalculationProfileId: state.activeCalculationProfileId,
    })
    setSaveStatus('saved')
  }, [])

  const enterEditor = useCallback((name: string, id: string | null = null, source: SavedBuild['source'] = 'local', sourceUrl: string | null = null) => {
    setBuildName(name)
    setActiveBuildId(id)
    setBuildSource(source)
    setBuildSourceUrl(sourceUrl)
    setActiveView('equipment')
    setScreen('editor')
    window.setTimeout(markClean, 0)
  }, [markClean])

  const handleOpenBuild = useCallback(async (build: SavedBuild) => {
    await Promise.resolve(loadBuild(build.id))
    enterEditor(build.name, build.id, build.source || (build.importedBuildCode ? 'pob' : 'local'), build.sourceUrl || null)
  }, [enterEditor, loadBuild])

  const handleCheckBuildUpdate = useCallback(async (build: SavedBuild) => {
    if (!build.sourceUrl || (build.source !== 'wegame' && build.source !== 'poe-ninja')) return
    const requestId = ++buildUpdateRequestRef.current
    setBuildUpdateTarget(build)
    setBuildUpdateCode(null)
    setBuildUpdateDiff(null)
    setBuildUpdateError(null)
    setBuildUpdateChecking(true)
    try {
      const result = build.source === 'poe-ninja'
        ? await requestPoeNinjaImport(build.sourceUrl)
        : await requestPoe2dbImport(build.sourceUrl)
      if (requestId !== buildUpdateRequestRef.current) return
      const diff = compareBuildCodes(build.importedBuildCode || '', result.code)
      if (!diff.hasChanges) {
        setBuildUpdateTarget(null)
        setSaveNotice({ type: 'success', message: l('Build is already up to date', '构筑已是最新版本', '構築已是最新版本', '빌드가 최신 버전입니다') })
        return
      }
      setBuildUpdateCode(result.code)
      setBuildUpdateDiff(diff)
    } catch (reason) {
      if (requestId !== buildUpdateRequestRef.current) return
      setBuildUpdateTarget(null)
      setBuildUpdateDiff(null)
      setSaveNotice({ type: 'error', message: reason instanceof Error ? reason.message : String(reason) })
    } finally {
      if (requestId === buildUpdateRequestRef.current) setBuildUpdateChecking(false)
    }
  }, [lang])

  const cancelBuildUpdate = useCallback(() => {
    if (buildUpdateBusy) return
    buildUpdateRequestRef.current += 1
    setBuildUpdateTarget(null)
    setBuildUpdateCode(null)
    setBuildUpdateDiff(null)
    setBuildUpdateError(null)
    setBuildUpdateChecking(false)
  }, [buildUpdateBusy])

  const handleConfirmBuildUpdate = useCallback(async () => {
    const target = buildUpdateTarget
    if (!target || !buildUpdateCode) return
    setBuildUpdateBusy(true)
    setBuildUpdateError(null)
    try {
      await importPobBuildCode(buildUpdateCode)
      setBuildRealm(target.realm)
      const now = new Date().toISOString()
      const savedId = saveBuild(target.name, target.id, target.source, target.sourceUrl, {
        description: target.description,
        tags: target.tags,
        createdAt: target.createdAt,
        updatedAt: now,
        lastOpenedAt: now,
      })
      setBuildName(target.name)
      setActiveBuildId(savedId)
      setBuildSource(target.source || 'local')
      setBuildSourceUrl(target.sourceUrl || null)
      setBuildUpdateTarget(null)
      setBuildUpdateCode(null)
      setBuildUpdateDiff(null)
      setActiveView('equipment')
      setScreen('editor')
      window.setTimeout(markClean, 0)
      setSaveNotice({ type: 'success', message: l('Build updated', '构筑已更新', '構築已更新', '빌드 업데이트됨') })
    } catch (reason) {
      setBuildUpdateError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBuildUpdateBusy(false)
    }
  }, [buildUpdateCode, buildUpdateTarget, lang, markClean, saveBuild, setBuildRealm])

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
    const code = confirmation.kind === 'pob' ? confirmation.value : confirmation.code
    if (!code) throw new Error('Missing converted PoB code')
    await importPobBuildCode(code)
    setBuildRealm(confirmation.realm)
    if (confirmation.mode === 'new' || screen === 'center') {
      setBuildName(confirmation.suggestedName)
      setActiveBuildId(null)
    }
    setBuildSource(confirmation.kind)
    setBuildSourceUrl(confirmation.sourceUrl || null)
    setActiveView('equipment')
    setScreen('editor')
    window.setTimeout(markClean, 0)
  }, [markClean, screen, setBuildRealm])

  const handleSave = useCallback(() => {
    setSaveStatus('saving')
    try {
      const savedId = saveBuild(buildName.trim() || l('Untitled build', '未命名构筑', '未命名構築', '이름 없는 빌드'), activeBuildId, buildSource, buildSourceUrl)
      setActiveBuildId(savedId)
      markClean()
      setSaveNotice({ type: 'success', message: l('Build saved', '构筑已保存', '構築已儲存', '빌드 저장됨') })
    } catch {
      setSaveStatus('error')
      setSaveNotice({ type: 'error', message: l('Save failed. Check local storage availability.', '保存失败，请检查本地存储空间', '儲存失敗，請檢查本機儲存空間', '저장 실패. 로컬 저장 공간을 확인하세요.') })
    }
  }, [activeBuildId, buildName, buildSource, buildSourceUrl, lang, markClean, saveBuild])

  const createCurrentNativeBuildFile = useCallback(async (id: string, timestamp: string, revision: number) => {
    const state = useTreeStore.getState()
    const existing = state.savedBuilds.find((build) => build.id === id)
    const classPayload = getEncodeClassPayload(state.treeData || undefined, state.selectedClassId, state.selectedAscendancyId)
    const encoded = encodeBuildCode({
      nodes: [...state.allocatedNodes],
      nodeWeaponSets: state.nodeWeaponSets,
      nodeAttributeSelections: state.nodeAttributeSelections,
      treeVersion: state.treeVersion,
      baseCode: state.importedBuildCode || undefined,
      useSecondWeaponSet: state.activeWeaponSet === 2,
      ...classPayload,
    })
    return createSuperPoeBuildFile({
      id,
      name: buildName.trim() || l('Untitled build', '未命名构筑', '未命名構築', '이름 없는 빌드'),
      description: existing?.description,
      tags: existing?.tags,
      realm: state.buildRealm,
      source: buildSource,
      sourceUrl: buildSourceUrl,
      createdAt: existing?.createdAt || timestamp,
      updatedAt: timestamp,
      lastOpenedAt: timestamp,
      code: encoded.code,
      xml: encoded.xml,
      revision,
      appVersion: SUPERPOE_PACKAGE_VERSION,
      channel: import.meta.env.DEV ? 'dev' : 'release',
      platform: /Mac/i.test(navigator.platform) ? 'darwin' : 'win32',
    })
  }, [buildName, buildSource, buildSourceUrl, lang])

  const handleSaveCopy = useCallback(async () => {
    const bridge = window.pob2Desktop
    if (!bridge?.saveBuildFileCopy) {
      setSaveNotice({ type: 'error', message: l('Saving build files is available only in the desktop app.', '保存构筑文件仅在桌面版可用', '儲存構築檔案僅限桌面版使用', '빌드 파일 저장은 데스크톱 앱에서만 사용할 수 있습니다.') })
      return
    }
    const previousStatus = saveStatus
    setSaveStatus('saving')
    try {
      const state = useTreeStore.getState()
      const id = activeBuildId || globalThis.crypto.randomUUID()
      const existing = state.savedBuilds.find((build) => build.id === id)
      const timestamp = new Date().toISOString()
      const revision = (existing?.nativeRevision || 0) + 1
      const content = await createCurrentNativeBuildFile(id, timestamp, revision)
      const result = await bridge.saveBuildFileCopy({ content, fileName: sanitizeSuperPoeBuildFileName(buildName) })
      if (result.canceled) {
        setSaveStatus(previousStatus)
        return
      }
      const savedId = saveBuild(buildName.trim() || l('Untitled build', '未命名构筑', '未命名構築', '이름 없는 빌드'), id, buildSource, buildSourceUrl, {
        description: existing?.description,
        tags: existing?.tags,
        createdAt: existing?.createdAt || timestamp,
        updatedAt: timestamp,
        lastOpenedAt: timestamp,
        nativeRevision: revision,
      })
      setActiveBuildId(savedId)
      markClean()
      setSaveNotice({ type: 'success', message: l(`Build copy saved to ${result.filePath}`, `构筑副本已保存到 ${result.filePath}`, `構築副本已儲存至 ${result.filePath}`, `빌드 복사본이 ${result.filePath}에 저장됨`) })
    } catch (reason) {
      setSaveStatus('error')
      setSaveNotice({ type: 'error', message: reason instanceof Error ? reason.message : String(reason) })
    }
  }, [activeBuildId, buildName, buildSource, buildSourceUrl, createCurrentNativeBuildFile, lang, markClean, saveBuild, saveStatus])

  const presentNativeBuildFile = useCallback(async (result: { canceled: boolean; filePath?: string; content?: string; error?: string }) => {
    if (result.canceled) return
    try {
      if (result.error) throw new Error(result.error)
      if (!result.content) throw new Error('The selected build file is empty')
      const parsed = await parseSuperPoeBuildFile(result.content)
      setNativeBuildError(null)
      setNativeBuildCandidate({ parsed, filePath: result.filePath })
    } catch (reason) {
      setSaveNotice({ type: 'error', message: reason instanceof Error ? reason.message : String(reason) })
    }
  }, [])

  const handleOpenNativeBuildFile = useCallback(async () => {
    const bridge = window.pob2Desktop
    if (!bridge?.openBuildFile) {
      setSaveNotice({ type: 'error', message: l('Opening builds is available only in the desktop app.', '打开构筑仅在桌面版可用', '開啟構築僅限桌面版使用', '빌드 열기는 데스크톱 앱에서만 사용할 수 있습니다.') })
      return
    }
    try {
      await presentNativeBuildFile(await bridge.openBuildFile())
    } catch (reason) {
      setSaveNotice({ type: 'error', message: reason instanceof Error ? reason.message : String(reason) })
    }
  }, [lang, presentNativeBuildFile])

  useEffect(() => window.pob2Desktop?.onOpenBuildFile?.((result) => { void presentNativeBuildFile(result) }), [presentNativeBuildFile])

  const acceptNativeBuildFile = useCallback(async (mode: 'copy' | 'replace') => {
    if (!nativeBuildCandidate) return
    setNativeBuildBusy(true)
    setNativeBuildError(null)
    try {
      const record = nativeBuildCandidate.parsed.envelope.data
      const conflict = savedBuilds.some((build) => build.id === record.id)
      await importPobBuildCode(record.pob.code, { allowEmptyTree: true })
      setBuildRealm(record.metadata.realm)
      const copy = mode === 'copy' && conflict
      const name = copy ? l(`${record.metadata.name} Copy`, `${record.metadata.name} 副本`, `${record.metadata.name} 副本`, `${record.metadata.name} 복사본`) : record.metadata.name
      const targetId = copy ? null : record.id
      const savedId = saveBuild(name, targetId, record.metadata.source, record.metadata.sourceUrl || null, {
        description: record.metadata.description,
        tags: record.metadata.tags,
        createdAt: record.metadata.createdAt,
        updatedAt: record.metadata.updatedAt,
        lastOpenedAt: new Date().toISOString(),
        nativeRevision: nativeBuildCandidate.parsed.envelope.revision,
      })
      setNativeBuildCandidate(null)
      enterEditor(name, savedId, record.metadata.source, record.metadata.sourceUrl || null)
      setSaveNotice({ type: 'success', message: l('Build file added to the library', '构筑文件已加入构筑库', '構築檔案已加入構築庫', '빌드 파일이 라이브러리에 추가됨') })
    } catch (reason) {
      setNativeBuildError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setNativeBuildBusy(false)
    }
  }, [enterEditor, lang, nativeBuildCandidate, saveBuild, savedBuilds, setBuildRealm])

  const openExistingNativeBuild = useCallback(async () => {
    if (!nativeBuildCandidate) return
    const existing = savedBuilds.find((build) => build.id === nativeBuildCandidate.parsed.envelope.data.id)
    if (!existing) return
    setNativeBuildBusy(true)
    try {
      await handleOpenBuild(existing)
      setNativeBuildCandidate(null)
    } catch (reason) {
      setNativeBuildError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setNativeBuildBusy(false)
    }
  }, [handleOpenBuild, nativeBuildCandidate, savedBuilds])

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return
      const key = event.key.toLowerCase()
      if (key === 'o') {
        event.preventDefault()
        void handleOpenNativeBuildFile()
      } else if (key === 's' && event.shiftKey && screen === 'editor') {
        event.preventDefault()
        void handleSaveCopy()
      } else if (key === 's' && screen === 'editor') {
        event.preventDefault()
        handleSave()
      }
    }
    window.addEventListener('keydown', handleShortcut)
    return () => window.removeEventListener('keydown', handleShortcut)
  }, [handleOpenNativeBuildFile, handleSave, handleSaveCopy, screen])

  const handleBuildNameChange = useCallback((name: string) => {
    setBuildName(name)
    setSaveStatus('dirty')
  }, [])

  const handleSettingsChange = useCallback((settings: AppSettings) => {
    setAppSettings(settings)
    saveAppSettings(settings)
  }, [])

  const requestHome = useCallback(() => {
    if (saveStatus === 'dirty' && appSettings.confirmUnsavedExit) setLeaveConfirmOpen(true)
    else setScreen('center')
  }, [appSettings.confirmUnsavedExit, saveStatus])

  const nativeBuildConflict = nativeBuildCandidate
    ? savedBuilds.find((build) => build.id === nativeBuildCandidate.parsed.envelope.data.id)
    : undefined
  const tradeSuspended = settingsOpen || importOpen || newBuildOpen || leaveConfirmOpen || Boolean(nativeBuildCandidate)

  return (
    <div className={`superpoe-app${screen === 'library' ? ' library-screen' : ''}`}>
      {screen === 'center'
        ? <BuildCenter onCreate={() => setNewBuildOpen(true)} onOpenFile={() => void handleOpenNativeBuildFile()} onImport={() => setImportOpen(true)} onOpen={(build) => void handleOpenBuild(build)} onCheckForUpdate={(build) => void handleCheckBuildUpdate(build)} onTradeCenter={() => { setTradeReturnScreen('center'); setScreen('trade') }} onLibrary={() => setScreen('library')} onUtilities={() => setScreen('utilities')} onAbout={() => setScreen('about')} monitoring={monitoring} onSettings={() => setSettingsOpen(true)} />
        : screen === 'utilities'
          ? <UtilityCenter onCenter={() => setScreen('center')} onLibrary={() => setScreen('library')} onTradeCenter={() => { setTradeReturnScreen('center'); setScreen('trade') }} onAbout={() => setScreen('about')} onCreate={() => setNewBuildOpen(true)} onImport={() => setImportOpen(true)} />
          : screen === 'about'
            ? <AboutPage onCenter={() => setScreen('center')} onLibrary={() => setScreen('library')} onTradeCenter={() => { setTradeReturnScreen('center'); setScreen('trade') }} onUtilities={() => setScreen('utilities')} />
          : screen === 'library'
            ? <EquipmentLibraryPage realm={appSettings.defaultRealm} onCenter={() => setScreen('center')} onSettings={() => setSettingsOpen(true)} />
        : screen === 'trade'
          ? <Suspense fallback={<WorkspaceLoading language={lang} />}><MarketShell realm={appSettings.defaultRealm} suspended={tradeSuspended} view={marketWorkspace} onViewChange={setMarketWorkspace} monitoring={monitoring} backTarget={tradeReturnScreen} buildName={buildName} onBack={() => setScreen(tradeReturnScreen)} onSettings={() => setSettingsOpen(true)} /></Suspense>
          : <>
      <Toolbar activeView={activeView} onViewChange={setActiveView} onTradeCenter={() => { setTradeReturnScreen('editor'); setScreen('trade') }} monitoring={monitoring} buildName={buildName} buildSourceUrl={buildSourceUrl} onBuildNameChange={handleBuildNameChange} saveStatus={saveStatus} onHome={requestHome} onImport={() => setImportOpen(true)} onSave={handleSave} onSaveCopy={() => void handleSaveCopy()} onSettings={() => setSettingsOpen(true)} />
      <main className="workspace-view">
        {!treeData ? <WorkspaceLoading language={lang} error={error} /> : <Suspense fallback={<WorkspaceLoading language={lang} />}>
        {activeView === 'passive' && (
          <section className="passive-workspace">
            <TreePixiCanvas />
            <NodeTooltip />
          </section>
        )}
        {activeView === 'equipment' && <EquipmentPanel buildId={activeBuildId} realm={appSettings.defaultRealm} />}
        {activeView === 'skills' && <SkillsWorkspace />}
        </Suspense>}
      </main>
      </>}
      <NewBuildDialog open={newBuildOpen} defaultRealm={appSettings.defaultRealm} onClose={() => setNewBuildOpen(false)} onCreate={(input) => void handleCreateBuild(input)} />
      <UnifiedImportDialog open={importOpen} hasCurrentBuild={screen === 'editor'} defaultRealm={appSettings.defaultRealm} onClose={() => setImportOpen(false)} onConfirm={handleImportConfirmation} />
      <GlobalSettingsDialog open={settingsOpen} settings={appSettings} onChange={handleSettingsChange} onClose={() => setSettingsOpen(false)} />
      <UpdateDialog settings={appSettings} />
      {buildUpdateTarget && <BuildUpdateDialog
        build={buildUpdateTarget}
        checking={buildUpdateChecking}
        busy={buildUpdateBusy}
        error={buildUpdateError}
        diff={buildUpdateDiff}
        onCancel={cancelBuildUpdate}
        onConfirm={() => void handleConfirmBuildUpdate()}
      />}
      {nativeBuildCandidate && <NativeBuildOpenDialog
        parsed={nativeBuildCandidate.parsed}
        filePath={nativeBuildCandidate.filePath}
        existingBuild={nativeBuildConflict}
        hasUnsavedChanges={screen === 'editor' && saveStatus === 'dirty'}
        busy={nativeBuildBusy}
        error={nativeBuildError}
        onCancel={() => { setNativeBuildCandidate(null); setNativeBuildError(null) }}
        onOpenExisting={() => void openExistingNativeBuild()}
        onOpenCopy={() => void acceptNativeBuildFile('copy')}
        onReplace={() => void acceptNativeBuildFile('replace')}
      />}
      {leaveConfirmOpen && <div className="modal-backdrop"><section className="confirm-dialog" role="alertdialog" aria-modal="true"><AlertTriangle /><h2>{l('Leave current build?', '离开当前构筑？', '離開目前構築？', '현재 빌드에서 나갈까요?')}</h2><p>{l('This build has unsaved changes. The draft remains locally, but it will not appear as a named build.', '当前构筑有未保存修改。离开后仍会保留自动草稿，但不会出现在命名构筑列表中。', '目前構築有未儲存的修改。離開後仍會保留自動草稿，但不會出現在命名構築清單中。', '이 빌드에 저장하지 않은 변경 사항이 있습니다. 초안은 로컬에 유지되지만 이름이 지정된 빌드 목록에는 표시되지 않습니다.')}</p><footer><button className="secondary-command" onClick={() => setLeaveConfirmOpen(false)}>{l('Keep editing', '继续编辑', '繼續編輯', '계속 편집')}</button><button className="primary-command" onClick={() => { setLeaveConfirmOpen(false); setScreen('center') }}>{l('Leave', '离开', '離開', '나가기')}</button></footer></section></div>}
      {saveNotice && <div className={`save-notice ${saveNotice.type}`} role="status" aria-live="polite">
        {saveNotice.type === 'success' ? <CheckCircle2 /> : <XCircle />}
        <span>{saveNotice.message}</span>
      </div>}
    </div>
  )
}

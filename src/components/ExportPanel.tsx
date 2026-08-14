import { useCallback, useState } from 'react'
import { Check, ChevronDown, Clipboard, Download, FolderInput, Gamepad2, LoaderCircle } from 'lucide-react'

import { useTreeStore } from '@/store/treeStore'
import { useTranslation } from '@/i18n/useTranslation'
import { translateGameText, type Language } from '@/i18n/translationLoader'
import { encodeBuildCode, getEncodeClassPayload } from '@/engine/buildCode'
import { generateGameBuildPlanner, type GameBuildPlannerExport } from '@/engine/gameBuildPlanner'
import { uiText } from '@/i18n/uiLocale'

interface ExportPanelProps {
  embedded?: boolean
  buildName?: string
  sourceUrl?: string | null
}

type ExportMode = 'pob' | 'game'

const PLANNER_SLOT_TRANSLATION_KEYS: Record<string, string> = {
  'Charm 1': 'equipment.slot.charm1',
  'Charm 2': 'equipment.slot.charm2',
  'Charm 3': 'equipment.slot.charm3',
  'Flask 1': 'equipment.slot.flask1',
  'Flask 2': 'equipment.slot.flask2',
}

function localizePlannerSkillName(name: string, language: Language): string {
  const translated = translateGameText(name, language)
  if (translated !== name) return translated
  if (name === 'Spectre: Coconut Crab') {
    if (language === 'zh-rCN' || language === 'zh-rTW') return '幽魂：椰子蟹'
  }
  return name
}

function localizePlannerSlotName(name: string, language: Language, t: (key: string) => string): string {
  const translationKey = PLANNER_SLOT_TRANSLATION_KEYS[name]
  if (translationKey) return t(translationKey)
  if (language === 'zh-rCN') {
    if (name === 'IncursionLegRight') return '右腿（特殊槽位）'
    if (name === 'IncursionLegLeft') return '左腿（特殊槽位）'
  }
  if (language === 'zh-rTW') {
    if (name === 'IncursionLegRight') return '右腿（特殊欄位）'
    if (name === 'IncursionLegLeft') return '左腿（特殊欄位）'
  }
  return name
}

function browserDownload(content: string, fileName: string, type = 'text/plain'): void {
  const blob = new Blob([content], { type })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.click()
  URL.revokeObjectURL(url)
}

export function ExportPanel({ embedded = false, buildName = 'SuperPoE2 Build', sourceUrl }: ExportPanelProps) {
  const { t, lang } = useTranslation()
  const l = (en: string, zhCN: string, zhTW: string, koKR: string) => uiText(lang, en, zhCN, zhTW, koKR)
  const [mode, setMode] = useState<ExportMode>('pob')
  const [code, setCode] = useState('')
  const [planner, setPlanner] = useState<GameBuildPlannerExport | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [showCompatibilityDetails, setShowCompatibilityDetails] = useState(false)

  const allocatedNodes = useTreeStore((s) => s.allocatedNodes)
  const nodeWeaponSets = useTreeStore((s) => s.nodeWeaponSets)
  const nodeAttributeSelections = useTreeStore((s) => s.nodeAttributeSelections)
  const treeVersion = useTreeStore((s) => s.treeVersion)
  const selectedClassId = useTreeStore((s) => s.selectedClassId)
  const selectedAscendancyId = useTreeStore((s) => s.selectedAscendancyId)
  const treeData = useTreeStore((s) => s.treeData)
  const pobBuildRevision = useTreeStore((s) => s.pobBuildRevision)
  const getActivePobCode = useTreeStore((s) => s.getActivePobCode)
  const nodeCount = allocatedNodes.size

  const currentBuildCode = getActivePobCode()

  const handlePobExport = useCallback(async () => {
    if (nodeCount === 0) return
    setLoading(true)
    setError(null)
    setCode('')
    try {
      if (currentBuildCode) {
        setCode(currentBuildCode)
      } else {
        const classPayload = getEncodeClassPayload(treeData, selectedClassId, selectedAscendancyId)
        const result = encodeBuildCode({
          nodes: [...allocatedNodes],
          nodeWeaponSets,
          nodeAttributeSelections,
          treeVersion,
          ...classPayload,
        })
        setCode(result.code || '')
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [allocatedNodes, currentBuildCode, nodeAttributeSelections, nodeCount, nodeWeaponSets, selectedAscendancyId, selectedClassId, treeData, treeVersion, pobBuildRevision])

  const handlePlannerGenerate = useCallback(async () => {
    if (!treeData) return
    setLoading(true)
    setError(null)
    setNotice(null)
    try {
      setPlanner(await generateGameBuildPlanner({
        name: buildName,
        sourceUrl,
        treeVersion,
        treeData,
        selectedClassId,
        selectedAscendancyId,
        allocatedNodes,
        nodeWeaponSets,
        nodeAttributeSelections,
        importedBuildCode: currentBuildCode,
        language: lang,
      }))
      setShowCompatibilityDetails(false)
    } catch (err: unknown) {
      setPlanner(null)
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [allocatedNodes, buildName, currentBuildCode, lang, nodeAttributeSelections, nodeWeaponSets, selectedAscendancyId, selectedClassId, sourceUrl, treeData, treeVersion, pobBuildRevision])

  const handleCopy = useCallback(async () => {
    if (!code) return
    await navigator.clipboard.writeText(code)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 2000)
  }, [code])

  const plannerHasErrors = !!planner && (planner.missingPassiveIds.length > 0 || planner.missingSkills.length > 0)
  const skippedSkillNames = planner
    ? [...new Set(planner.skippedSkills.map((item) => localizePlannerSkillName(item.name, lang)))]
    : []
  const omittedSlotNames = planner
    ? [...new Set(planner.omittedInventorySlots.map((name) => localizePlannerSlotName(name, lang, t)))]
    : []
  const compatibilityCount = skippedSkillNames.length + omittedSlotNames.length

  const savePlanner = useCallback(async () => {
    if (!planner || plannerHasErrors) return
    setError(null)
    try {
      if (window.pob2Desktop) {
        const result = await window.pob2Desktop.saveGameBuild({ content: planner.json, fileName: planner.fileName })
        if (!result.canceled && result.filePath) setNotice(uiText(lang, `Saved to ${result.filePath}`, `已保存到 ${result.filePath}`, `已儲存至 ${result.filePath}`, `${result.filePath}에 저장됨`))
      } else {
        browserDownload(planner.json, planner.fileName, 'application/json')
        setNotice(uiText(lang, 'Planner file downloaded', '规划器文件已下载', '規劃器檔案已下載', '플래너 파일 다운로드됨'))
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [lang, planner, plannerHasErrors])

  const installPlanner = useCallback(async () => {
    if (!planner || plannerHasErrors || !window.pob2Desktop) return
    setError(null)
    try {
      const result = await window.pob2Desktop.installGameBuild({ content: planner.json, fileName: planner.fileName })
      setNotice(uiText(lang, `Installed to game directory: ${result.filePath}`, `已安装到游戏目录：${result.filePath}`, `已安裝至遊戲目錄：${result.filePath}`, `게임 디렉터리에 설치됨: ${result.filePath}`))
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [lang, planner, plannerHasErrors])

  const panelClass = embedded
    ? 'w-full min-w-0 max-h-[calc(100vh-72px)] overflow-y-auto bg-[#0d0d1a]/95 backdrop-blur rounded border border-gray-700 p-3 shadow-xl'
    : 'absolute bottom-4 left-4 z-20 w-[min(420px,calc(100vw-32px))] max-h-[calc(100vh-32px)] overflow-y-auto bg-[#0d0d1a]/90 backdrop-blur rounded border border-gray-700 p-3 shadow-xl'

  return <div className={panelClass}>
    <div className="mb-3 flex items-center justify-between">
      <h3 className="text-xs font-semibold uppercase text-gray-300">{l(t('export.title'), '导出构筑', '匯出構築', '빌드 내보내기')}</h3>
      <span className="text-xs text-gray-500">{l(`${nodeCount} nodes`, `${nodeCount} 个节点`, `${nodeCount} 個節點`, `노드 ${nodeCount}개`)}</span>
    </div>

    <div className="export-mode-switch" role="tablist" aria-label={l('Export format', '导出格式', '匯出格式', '내보내기 형식')}>
      <button
        type="button"
        role="tab"
        aria-selected={mode === 'pob'}
        className={`export-mode-button${mode === 'pob' ? ' active' : ''}`}
        onClick={() => { setMode('pob'); setError(null) }}
      >
        PoB Code
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={mode === 'game'}
        className={`export-mode-button export-mode-button-game${mode === 'game' ? ' active' : ''}`}
        onClick={() => { setMode('game'); setError(null) }}
      >
        <Gamepad2 className="h-4 w-4" />
        {l('Game Planner', '游戏规划器', '遊戲規劃器', '게임 플래너')}
      </button>
    </div>

    {mode === 'pob' && (code ? <div className="space-y-2">
      <textarea readOnly value={code} rows={2} className="w-full resize-none break-all rounded border border-gray-600 bg-[#1a1a2e] px-2 py-1.5 font-mono text-xs text-gray-300" />
      <div className="flex gap-2">
        <button onClick={() => void handleCopy()} className="primary-command flex-1">{copied ? <Check /> : <Clipboard />}{copied ? t('export.copied') : t('export.copy')}</button>
        <button onClick={() => browserDownload(code, 'pob2-build-code.txt')} className="secondary-command"><Download />{t('export.download')}</button>
      </div>
    </div> : <div className="space-y-2">
      <p className="text-xs text-gray-500">{t('export.hint')}</p>
      <button onClick={() => void handlePobExport()} disabled={loading || nodeCount === 0} className="primary-command w-full">
        {loading && <LoaderCircle className="animate-spin" />}{loading ? t('export.encoding') : t('export.generate')}
      </button>
    </div>)}

    {mode === 'game' && <div className="space-y-3">
      <p className="text-xs leading-5 text-gray-400">{l('Generate a .build file for the in-game Build Planner.', '生成游戏可读取的 .build 文件。可另存文件，或直接安装到游戏的 BuildPlanner 目录。', '產生遊戲可讀取的 .build 檔案。可另存檔案，或直接安裝至遊戲的 BuildPlanner 目錄。', '게임 내 빌드 플래너에서 읽을 수 있는 .build 파일을 생성합니다.')}</p>
      {!planner ? <button onClick={() => void handlePlannerGenerate()} disabled={loading || !treeData} className="primary-command w-full">
        {loading && <LoaderCircle className="animate-spin" />}{loading ? l('Generating...', '正在生成...', '正在產生...', '생성 중...') : l('Generate planner file', '生成规划器文件', '產生規劃器檔案', '플래너 파일 생성')}
      </button> : <>
        <div className="grid grid-cols-5 gap-px border border-[#403c32] bg-[#403c32] text-center text-[11px]">
          {[
            [l('Passives', '天赋', '天賦', '패시브'), planner.stats.passives],
            [l('Weapon', '武器组', '武器組', '무기 세트'), planner.stats.weaponSetPassives],
            [l('Skills', '技能', '技能', '스킬'), planner.stats.skills],
            [l('Supports', '辅助', '輔助', '보조'), planner.stats.supports],
            [l('Items', '装备提示', '裝備提示', '아이템'), planner.stats.inventorySlots],
          ].map(([label, value]) => <div key={label} className="bg-[#141612] px-1 py-2"><strong className="block text-sm text-[#d8c78e]">{value}</strong><span className="text-gray-500">{label}</span></div>)}
        </div>
        {plannerHasErrors && <div className="border border-red-900/80 bg-red-950/30 p-2 text-xs leading-5 text-red-300">
          {!!planner.missingPassiveIds.length && <p>{l('Unmapped passives: ', `无法映射 ${planner.missingPassiveIds.length} 个天赋节点：`, `無法對應 ${planner.missingPassiveIds.length} 個天賦節點：`, `매핑되지 않은 패시브 ${planner.missingPassiveIds.length}개: `)}{planner.missingPassiveIds.slice(0, 8).join(', ')}</p>}
          {!!planner.missingSkills.length && <p>{l('Unmapped skills: ', `无法映射 ${planner.missingSkills.length} 个技能：`, `無法對應 ${planner.missingSkills.length} 個技能：`, `매핑되지 않은 스킬 ${planner.missingSkills.length}개: `)}{planner.missingSkills.slice(0, 5).join(', ')}</p>}
        </div>}
        {compatibilityCount > 0 && <div className="min-w-0 border border-amber-900/60 bg-amber-950/20 text-[11px] leading-5 text-amber-400/90">
          <button
            type="button"
            className="flex w-full min-w-0 items-center justify-between gap-3 border-0 bg-transparent px-2 py-1.5 text-left"
            onClick={() => setShowCompatibilityDetails((value) => !value)}
            aria-expanded={showCompatibilityDetails}
          >
            <span className="min-w-0">{l(`${compatibilityCount} unsupported entries were skipped`, `${compatibilityCount} 项内容不受游戏规划器支持，已自动忽略`, `${compatibilityCount} 項內容不受遊戲規劃器支援，已自動忽略`, `지원되지 않는 항목 ${compatibilityCount}개를 건너뛰었습니다`)}</span>
            <ChevronDown className={`h-3.5 w-3.5 transition-transform ${showCompatibilityDetails ? 'rotate-180' : ''}`} />
          </button>
          {showCompatibilityDetails && <div className="max-h-36 min-w-0 overflow-y-auto border-t border-amber-900/40 px-2 py-1.5 text-amber-300/80 [overflow-wrap:anywhere]">
            {!!skippedSkillNames.length && <p>{l('Skills: ', '技能：', '技能：', '스킬: ')}{skippedSkillNames.join(', ')}</p>}
            {!!omittedSlotNames.length && <p>{l('Game equipment hints not exported: ', '未导出的游戏内装备提示：', '未匯出的遊戲內裝備提示：', '내보내지 않은 게임 장비 힌트: ')}{omittedSlotNames.join(', ')}</p>}
          </div>}
        </div>}
        <div className="flex gap-2">
          <button disabled={plannerHasErrors} onClick={() => void savePlanner()} className="secondary-command flex-1"><Download />{l('Save as', '另存为', '另存新檔', '다른 이름으로 저장')}</button>
          <button disabled={plannerHasErrors || !window.pob2Desktop} onClick={() => void installPlanner()} className="primary-command flex-1"><FolderInput />{l('Install', '安装到游戏', '安裝至遊戲', '게임에 설치')}</button>
        </div>
        <button onClick={() => { setPlanner(null); setNotice(null); setShowCompatibilityDetails(false) }} className="w-full text-xs text-gray-500 hover:text-gray-300">{l('Generate again', '重新生成', '重新產生', '다시 생성')}</button>
      </>}
    </div>}

    {notice && <p className="mt-2 break-words text-xs leading-5 text-green-400">{notice}</p>}
    {error && <p className="mt-2 break-words text-xs leading-5 text-red-400">{error}</p>}
  </div>
}

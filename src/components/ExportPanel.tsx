import { useCallback, useState } from 'react'
import { Check, ChevronDown, Clipboard, Download, FolderInput, Gamepad2, LoaderCircle } from 'lucide-react'

import { useTreeStore } from '@/store/treeStore'
import { useTranslation } from '@/i18n/useTranslation'
import { translateGameText, type Language } from '@/i18n/translationLoader'
import { encodeBuildCode, getEncodeClassPayload } from '@/engine/buildCode'
import { generateGameBuildPlanner, type GameBuildPlannerExport } from '@/engine/gameBuildPlanner'

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
  const zh = lang === 'zh-rCN'
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
  const importedBuildCode = useTreeStore((s) => s.importedBuildCode)
  const nodeCount = allocatedNodes.size

  const handlePobExport = useCallback(async () => {
    if (nodeCount === 0) return
    setLoading(true)
    setError(null)
    setCode('')
    try {
      const classPayload = getEncodeClassPayload(treeData, selectedClassId, selectedAscendancyId)
      const result = encodeBuildCode({
        nodes: [...allocatedNodes],
        nodeWeaponSets,
        nodeAttributeSelections,
        treeVersion,
        baseCode: importedBuildCode || undefined,
        ...classPayload,
      })
      setCode(result.code || '')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [allocatedNodes, importedBuildCode, nodeAttributeSelections, nodeCount, nodeWeaponSets, selectedAscendancyId, selectedClassId, treeData, treeVersion])

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
        importedBuildCode,
        language: lang,
      }))
      setShowCompatibilityDetails(false)
    } catch (err: unknown) {
      setPlanner(null)
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [allocatedNodes, buildName, importedBuildCode, lang, nodeAttributeSelections, nodeWeaponSets, selectedAscendancyId, selectedClassId, sourceUrl, treeData, treeVersion])

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
        if (!result.canceled && result.filePath) setNotice(zh ? `已保存到 ${result.filePath}` : `Saved to ${result.filePath}`)
      } else {
        browserDownload(planner.json, planner.fileName, 'application/json')
        setNotice(zh ? '规划器文件已下载' : 'Planner file downloaded')
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [planner, plannerHasErrors, zh])

  const installPlanner = useCallback(async () => {
    if (!planner || plannerHasErrors || !window.pob2Desktop) return
    setError(null)
    try {
      const result = await window.pob2Desktop.installGameBuild({ content: planner.json, fileName: planner.fileName })
      setNotice(zh ? `已安装到游戏目录：${result.filePath}` : `Installed to game directory: ${result.filePath}`)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [planner, plannerHasErrors, zh])

  const panelClass = embedded
    ? 'w-full min-w-0 max-h-[calc(100vh-72px)] overflow-y-auto bg-[#0d0d1a]/95 backdrop-blur rounded border border-gray-700 p-3 shadow-xl'
    : 'absolute bottom-4 left-4 z-20 w-[min(420px,calc(100vw-32px))] max-h-[calc(100vh-32px)] overflow-y-auto bg-[#0d0d1a]/90 backdrop-blur rounded border border-gray-700 p-3 shadow-xl'

  return <div className={panelClass}>
    <div className="mb-3 flex items-center justify-between">
      <h3 className="text-xs font-semibold uppercase text-gray-300">{zh ? '导出构筑' : t('export.title')}</h3>
      <span className="text-xs text-gray-500">{nodeCount} {zh ? '个节点' : 'nodes'}</span>
    </div>

    <div className="mb-3 grid grid-cols-2 border border-[#464238] bg-[#11130f] p-0.5">
      <button className={`h-8 text-xs ${mode === 'pob' ? 'bg-[#312a19] text-[#e2c878]' : 'text-gray-400 hover:text-gray-200'}`} onClick={() => { setMode('pob'); setError(null) }}>PoB Code</button>
      <button className={`flex h-8 items-center justify-center gap-1.5 text-xs ${mode === 'game' ? 'bg-[#312a19] text-[#e2c878]' : 'text-gray-400 hover:text-gray-200'}`} onClick={() => { setMode('game'); setError(null) }}><Gamepad2 className="h-4 w-4" />{zh ? '游戏规划器' : 'Game Planner'}</button>
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
      <p className="text-xs leading-5 text-gray-400">{zh ? '生成游戏可读取的 .build 文件。可另存文件，或直接安装到游戏的 BuildPlanner 目录。' : 'Generate a .build file for the in-game Build Planner.'}</p>
      {!planner ? <button onClick={() => void handlePlannerGenerate()} disabled={loading || !treeData} className="primary-command w-full">
        {loading && <LoaderCircle className="animate-spin" />}{loading ? (zh ? '正在生成...' : 'Generating...') : (zh ? '生成规划器文件' : 'Generate planner file')}
      </button> : <>
        <div className="grid grid-cols-5 gap-px border border-[#403c32] bg-[#403c32] text-center text-[11px]">
          {[
            [zh ? '天赋' : 'Passives', planner.stats.passives],
            [zh ? '武器组' : 'Weapon', planner.stats.weaponSetPassives],
            [zh ? '技能' : 'Skills', planner.stats.skills],
            [zh ? '辅助' : 'Supports', planner.stats.supports],
            [zh ? '装备提示' : 'Items', planner.stats.inventorySlots],
          ].map(([label, value]) => <div key={label} className="bg-[#141612] px-1 py-2"><strong className="block text-sm text-[#d8c78e]">{value}</strong><span className="text-gray-500">{label}</span></div>)}
        </div>
        {plannerHasErrors && <div className="border border-red-900/80 bg-red-950/30 p-2 text-xs leading-5 text-red-300">
          {!!planner.missingPassiveIds.length && <p>{zh ? `无法映射 ${planner.missingPassiveIds.length} 个天赋节点：` : `Unmapped passives: `}{planner.missingPassiveIds.slice(0, 8).join(', ')}</p>}
          {!!planner.missingSkills.length && <p>{zh ? `无法映射 ${planner.missingSkills.length} 个技能：` : `Unmapped skills: `}{planner.missingSkills.slice(0, 5).join(', ')}</p>}
        </div>}
        {compatibilityCount > 0 && <div className="min-w-0 border border-amber-900/60 bg-amber-950/20 text-[11px] leading-5 text-amber-400/90">
          <button
            type="button"
            className="flex w-full min-w-0 items-center justify-between gap-3 border-0 bg-transparent px-2 py-1.5 text-left"
            onClick={() => setShowCompatibilityDetails((value) => !value)}
            aria-expanded={showCompatibilityDetails}
          >
            <span className="min-w-0">{zh ? `${compatibilityCount} 项内容不受游戏规划器支持，已自动忽略` : `${compatibilityCount} unsupported entries were skipped`}</span>
            <ChevronDown className={`h-3.5 w-3.5 transition-transform ${showCompatibilityDetails ? 'rotate-180' : ''}`} />
          </button>
          {showCompatibilityDetails && <div className="max-h-36 min-w-0 overflow-y-auto border-t border-amber-900/40 px-2 py-1.5 text-amber-300/80 [overflow-wrap:anywhere]">
            {!!skippedSkillNames.length && <p>{zh ? '技能：' : 'Skills: '}{skippedSkillNames.join(', ')}</p>}
            {!!omittedSlotNames.length && <p>{zh ? '未导出的游戏内装备提示：' : 'Game equipment hints not exported: '}{omittedSlotNames.join(', ')}</p>}
          </div>}
        </div>}
        <div className="flex gap-2">
          <button disabled={plannerHasErrors} onClick={() => void savePlanner()} className="secondary-command flex-1"><Download />{zh ? '另存为' : 'Save as'}</button>
          <button disabled={plannerHasErrors || !window.pob2Desktop} onClick={() => void installPlanner()} className="primary-command flex-1"><FolderInput />{zh ? '安装到游戏' : 'Install'}</button>
        </div>
        <button onClick={() => { setPlanner(null); setNotice(null); setShowCompatibilityDetails(false) }} className="w-full text-xs text-gray-500 hover:text-gray-300">{zh ? '重新生成' : 'Generate again'}</button>
      </>}
    </div>}

    {notice && <p className="mt-2 break-words text-xs leading-5 text-green-400">{notice}</p>}
    {error && <p className="mt-2 break-words text-xs leading-5 text-red-400">{error}</p>}
  </div>
}

import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Check, FileCode2, Globe2, Link2, LoaderCircle, X } from 'lucide-react'
import { decodeBuildCode } from '@/engine/buildCode'
import { parseEquipmentXml } from '@/engine/equipment'
import { isPoe2dbDesktopImportAvailable, requestPoe2dbImport } from '@/engine/poe2dbImport'
import { resolveTreeAscendancy, resolveTreeClass, type AscendancyIdentifiers, type ClassIdentifiers } from '@/engine/treeClassResolution'
import { translateGameText, type Language } from '@/i18n/translationLoader'
import { useTranslation } from '@/i18n/useTranslation'
import { uiText } from '@/i18n/uiLocale'
import { useTreeStore } from '@/store/treeStore'
import type { BuildRealm, TreeData } from '@/types/tree'
import { parseTreeDataResource } from '@/engine/treeDataResource'
import { isPoeNinjaImportAvailable, requestPoeNinjaImport } from '@/engine/poeNinjaImport'

export type ImportKind = 'pob' | 'wegame' | 'poe-ninja'
export type ImportMode = 'new' | 'replace'

export interface ImportConfirmation {
  kind: ImportKind
  mode: ImportMode
  value: string
  code?: string
  suggestedName: string
  realm: BuildRealm
  sourceUrl?: string
}

interface ImportPreview {
  className: string
  ascendancyName: string
  treeVersion: string
  nodeCount: number
  weaponNodeCount: number
  equipmentCount: number
  skillCount: number
  source: string
  suggestedName?: string
}

interface UnifiedImportDialogProps {
  open: boolean
  hasCurrentBuild: boolean
  defaultRealm: BuildRealm
  onClose: () => void
  onConfirm: (confirmation: ImportConfirmation) => Promise<void>
}

const previewTreeCache = new Map<string, Promise<TreeData>>()

async function loadPreviewTreeData(version: string, currentTreeData: TreeData | null, language: Language): Promise<TreeData> {
  if (!version || !/^0_\d+$/.test(version)) throw new Error(uiText(language, 'The imported build has an invalid passive tree version', '导入构筑的天赋树版本无效', '匯入構築的天賦樹版本無效', '가져온 빌드의 패시브 트리 버전이 올바르지 않습니다'))
  if (currentTreeData?.version.version === version) return currentTreeData
  let pending = previewTreeCache.get(version)
  if (!pending) {
    pending = fetch(`/data/tree-web-${version}.json`).then(async (response) => {
      if (!response.ok) throw new Error(uiText(language, `Passive tree data ${version} is unavailable`, `天赋树数据 ${version} 不可用`, `天賦樹資料 ${version} 無法使用`, `패시브 트리 데이터 ${version}을 사용할 수 없습니다`))
      return parseTreeDataResource(await response.json(), version)
    })
    previewTreeCache.set(version, pending)
  }
  try {
    return await pending
  } catch (reason) {
    previewTreeCache.delete(version)
    throw reason
  }
}

function countEquipment(xml: string): number {
  const equipment = parseEquipmentXml(xml)
  const active = equipment?.itemSets.find((set) => set.id === equipment.activeItemSetId) || equipment?.itemSets[0]
  return active?.slots.filter((slot) => slot.itemId && !slot.name.endsWith(' Swap')).length || 0
}

function countSkills(xml: string): number {
  return (xml.match(/<Skill\b[^>]*enabled="true"/g) || xml.match(/<Skill\b/g) || []).length
}

export function UnifiedImportDialog({ open, hasCurrentBuild, defaultRealm, onClose, onConfirm }: UnifiedImportDialogProps) {
  const { lang } = useTranslation()
  const treeData = useTreeStore((state) => state.treeData)
  const [kind, setKind] = useState<ImportKind>('pob')
  const [value, setValue] = useState('')
  const [convertedCode, setConvertedCode] = useState<string | undefined>()
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [realm, setRealm] = useState<BuildRealm>('global')
  const l = (en: string, zhCN: string, zhTW: string, koKR: string) => uiText(lang, en, zhCN, zhTW, koKR)
  const wegameAvailable = isPoe2dbDesktopImportAvailable()
  const poeNinjaAvailable = isPoeNinjaImportAvailable()

  useEffect(() => {
    if (!open) return
    setKind('pob')
    setValue('')
    setConvertedCode(undefined)
    setPreview(null)
    setError(null)
    setLoading(false)
    setRealm(defaultRealm)
  }, [defaultRealm, open])

  const tabs = useMemo(() => [
    { id: 'pob' as const, label: 'PoB Code', icon: FileCode2 },
    { id: 'wegame' as const, label: 'WeGame', icon: Link2 },
    { id: 'poe-ninja' as const, label: 'poe.ninja', icon: Globe2 },
  ], [])

  if (!open) return null

  const resolveNames = (previewTreeData: TreeData, classIds: ClassIdentifiers, ascendancyIds: AscendancyIdentifiers) => {
    const classEntry = resolveTreeClass(previewTreeData, classIds)
    const cls = classEntry?.[1]
    const resolvedAscendancyId = resolveTreeAscendancy(cls, ascendancyIds)
    const asc = cls?.ascendancies.find((item) => (item.id || item.name) === resolvedAscendancyId)
    return {
      className: cls ? translateGameText(cls.displayName || cls.name, lang) : classIds.classInternalId || classIds.classId || '-',
      ascendancyName: asc ? translateGameText(asc.displayName || asc.name, lang) : ascendancyIds.ascendancyInternalId || ascendancyIds.ascendClassId || l('None', '未选择', '未選擇', '선택 안 함'),
    }
  }

  const previewCode = async (code: string, source: string, suggestedName?: string) => {
    const data = decodeBuildCode(code)
    if (!data.nodes.length) throw new Error(l('The build has no passive nodes', '构筑中没有天赋节点', '構築中沒有天賦節點', '빌드에 패시브 노드가 없습니다'))
    const previewTreeData = await loadPreviewTreeData(data.treeVersion, treeData, lang)
    const names = resolveNames(previewTreeData, data, data)
    setPreview({
      ...names,
      treeVersion: (data.treeVersion || '-').replace('_', '.'),
      nodeCount: data.nodes.length,
      weaponNodeCount: Object.keys(data.nodeWeaponSets).length,
      equipmentCount: countEquipment(data.xml),
      skillCount: countSkills(data.xml),
      source,
      suggestedName,
    })
  }

  const handleParse = async () => {
    const trimmed = value.trim()
    if (!trimmed) return
    setLoading(true)
    setError(null)
    setPreview(null)
    setConvertedCode(undefined)
    try {
      if (kind === 'wegame') {
        if (!wegameAvailable) throw new Error(l('WeGame import is available only in Electron', 'WeGame 导入仅在 Electron 桌面版可用', 'WeGame 匯入僅限 Electron 桌面版使用', 'WeGame 가져오기는 Electron 데스크톱 앱에서만 사용할 수 있습니다'))
        const converted = await requestPoe2dbImport(trimmed)
        setConvertedCode(converted.code)
        await previewCode(converted.code, 'WeGame')
      } else if (kind === 'poe-ninja') {
        if (!poeNinjaAvailable) throw new Error(l('poe.ninja import is available only in Electron', 'poe.ninja 导入仅在 Electron 桌面版可用', 'poe.ninja 匯入僅限 Electron 桌面版使用', 'poe.ninja 가져오기는 Electron 데스크톱 앱에서만 사용할 수 있습니다'))
        const converted = await requestPoeNinjaImport(trimmed)
        setConvertedCode(converted.code)
        await previewCode(converted.code, 'poe.ninja', converted.suggestedName)
      } else {
        await previewCode(trimmed, 'PoB Code')
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setLoading(false)
    }
  }

  const submit = async (mode: ImportMode) => {
    if (!preview) return
    setLoading(true)
    setError(null)
    try {
      await onConfirm({
        kind,
        mode,
        value: value.trim(),
        code: convertedCode,
        realm,
        sourceUrl: kind === 'pob' ? undefined : value.trim(),
        suggestedName: preview.suggestedName || `${preview.className}${preview.ascendancyName !== '-' ? ` · ${preview.ascendancyName}` : ''}`,
      })
      onClose()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="workflow-dialog import-dialog" role="dialog" aria-modal="true" aria-labelledby="import-dialog-title">
        <header className="dialog-header"><div><span>{l('Unified import', '统一导入', '統一匯入', '통합 가져오기')}</span><h2 id="import-dialog-title">{l('Import build', '导入构筑', '匯入構築', '빌드 가져오기')}</h2></div><button className="icon-command" onClick={onClose} aria-label={l('Close', '关闭', '關閉', '닫기')}><X /></button></header>
        <nav className="import-tabs">{tabs.map((tab) => { const Icon = tab.icon; return <button key={tab.id} className={kind === tab.id ? 'active' : ''} onClick={() => { setKind(tab.id); setRealm(tab.id === 'wegame' ? 'cn' : tab.id === 'poe-ninja' ? 'global' : defaultRealm); setValue(''); setPreview(null); setError(null) }}><Icon />{tab.label}</button> })}</nav>

        <div className="dialog-body import-body">
          <div className="import-input-panel">
            <fieldset className="realm-field import-realm-field"><legend>{l('Game realm', '游戏区域', '遊戲區域', '게임 리전')}</legend><div className="realm-selector">
              <button type="button" className={realm === 'cn' ? 'active cn' : ''} onClick={() => setRealm('cn')}>{l('Tencent CN', '腾讯服（国服）', '騰訊服（中國服）', 'Tencent 중국')}</button>
              <button type="button" className={realm === 'global' ? 'active global' : ''} onClick={() => setRealm('global')}>{l('Global', '国际服', '國際服', '글로벌')}</button>
            </div></fieldset>
            <label><span>{kind === 'pob' ? l('PoB2 build code', 'PoB2 构筑代码', 'PoB2 構築代碼', 'PoB2 빌드 코드') : kind === 'wegame' ? l('WeGame share link', 'WeGame 分享链接', 'WeGame 分享連結', 'WeGame 공유 링크') : l('poe.ninja character link', 'poe.ninja 角色链接', 'poe.ninja 角色連結', 'poe.ninja 캐릭터 링크')}</span>
              {kind === 'pob'
                ? <textarea value={value} onChange={(event) => { setValue(event.target.value); setPreview(null); setError(null) }} rows={7} placeholder={l('Paste PoB2 export code', '粘贴 PoB2 导出代码', '貼上 PoB2 匯出代碼', 'PoB2 내보내기 코드를 붙여넣으세요')} />
                : <input value={value} onChange={(event) => { setValue(event.target.value); setPreview(null); setError(null) }} placeholder={kind === 'wegame' ? 'https://www.wegame.com.cn/helper/poe2/#/share/...' : 'https://poe.ninja/poe2/profile/.../character/...'} />}
            </label>
            {kind === 'wegame' && <p className="import-notice">{wegameAvailable ? l('The link is converted to a complete PoB build through PoE2DB.', '链接将通过 PoE2DB 转换为完整 PoB 构筑。', '連結將透過 PoE2DB 轉換為完整 PoB 構築。', '링크는 PoE2DB를 통해 완전한 PoB 빌드로 변환됩니다.') : l('PoE2DB conversion requires the Electron app.', '当前不是 Electron 环境，无法请求 PoE2DB。', '目前不是 Electron 環境，無法請求 PoE2DB。', 'PoE2DB 변환에는 Electron 앱이 필요합니다.')}</p>}
            {kind === 'poe-ninja' && <p className="import-notice">{poeNinjaAvailable ? l('Reads the official Import Code for Path of Building from the character page.', '从角色页面读取官方 Import Code for Path of Building。', '從角色頁面讀取官方 Import Code for Path of Building。', '캐릭터 페이지에서 공식 Path of Building 가져오기 코드를 읽습니다.') : l('poe.ninja import requires the Electron app.', '当前不是 Electron 环境，无法请求 poe.ninja。', '目前不是 Electron 環境，無法請求 poe.ninja。', 'poe.ninja 가져오기에는 Electron 앱이 필요합니다.')}</p>}
            <button className="secondary-command parse-command" onClick={() => void handleParse()} disabled={loading || !value.trim()}>{loading ? <LoaderCircle className="animate-spin" /> : <FileCode2 />}{l('Parse preview', '解析预览', '解析預覽', '미리 보기 분석')}</button>
            {error && <div className="inline-error"><AlertTriangle /><span><strong>{l('Unable to parse build', '无法解析构筑', '無法解析構築', '빌드를 분석할 수 없음')}</strong><small>{error}</small></span></div>}
          </div>

          <div className="import-preview-panel">
            <h3>{l('Import preview', '导入预览', '匯入預覽', '가져오기 미리 보기')}</h3>
            {preview ? <>
              <div className="preview-success"><Check /><span>{l('Parsed successfully', '解析成功', '解析成功', '분석 성공')}</span></div>
              <dl className="preview-grid">
                <div><dt>{l('Class', '职业', '職業', '클래스')}</dt><dd>{preview.className}</dd></div>
                <div><dt>{l('Ascendancy', '升华', '昇華', '전직')}</dt><dd>{preview.ascendancyName}</dd></div>
                <div><dt>{l('Tree version', '天赋版本', '天賦版本', '트리 버전')}</dt><dd>{preview.treeVersion}</dd></div>
                <div><dt>{l('Allocated nodes', '分配节点', '已配置節點', '할당된 노드')}</dt><dd>{preview.nodeCount}</dd></div>
                <div><dt>{l('Weapon nodes', '武器组节点', '武器組節點', '무기 세트 노드')}</dt><dd>{preview.weaponNodeCount}</dd></div>
                <div><dt>{l('Equipment', '装备数量', '裝備數量', '장비')}</dt><dd>{preview.equipmentCount}</dd></div>
                <div><dt>{l('Skill groups', '技能组数量', '技能組數量', '스킬 그룹')}</dt><dd>{preview.skillCount}</dd></div>
                <div><dt>{l('Source', '来源', '來源', '출처')}</dt><dd>{preview.source}</dd></div>
              </dl>
            </> : <div className="preview-empty"><FileCode2 /><span>{l('Parse the input to review build contents', '解析后在这里确认构筑内容', '解析後在此確認構築內容', '입력을 분석하면 여기에서 빌드 내용을 확인할 수 있습니다')}</span></div>}
          </div>
        </div>

        <footer className="dialog-footer import-footer"><button className="secondary-command" onClick={onClose}>{l('Cancel', '取消', '取消', '취소')}</button><span /><button className="secondary-command" disabled={!preview || !hasCurrentBuild || loading} onClick={() => void submit('replace')}>{l('Replace current build', '替换当前构筑', '取代目前構築', '현재 빌드 교체')}</button><button className="primary-command" disabled={!preview || loading} onClick={() => void submit('new')}>{l('Import as new build', '作为新构筑导入', '作為新構築匯入', '새 빌드로 가져오기')}</button></footer>
      </section>
    </div>
  )
}

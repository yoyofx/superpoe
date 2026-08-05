import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Check, FileCode2, Globe2, Link2, LoaderCircle, X } from 'lucide-react'
import { decodeBuildCode } from '@/engine/buildCode'
import { parseEquipmentXml } from '@/engine/equipment'
import { isPoe2dbDesktopImportAvailable, requestPoe2dbImport } from '@/engine/poe2dbImport'
import { resolveTreeAscendancy, resolveTreeClass, type AscendancyIdentifiers, type ClassIdentifiers } from '@/engine/treeClassResolution'
import { translateGameText } from '@/i18n/translationLoader'
import { useTranslation } from '@/i18n/useTranslation'
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

async function loadPreviewTreeData(version: string, currentTreeData: TreeData | null): Promise<TreeData> {
  if (!version || !/^0_\d+$/.test(version)) throw new Error('The imported build has an invalid passive tree version')
  if (currentTreeData?.version.version === version) return currentTreeData
  let pending = previewTreeCache.get(version)
  if (!pending) {
    pending = fetch(`/data/tree-web-${version}.json`).then(async (response) => {
      if (!response.ok) throw new Error(`Passive tree data ${version} is unavailable`)
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
  const zh = lang === 'zh-rCN'
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
      ascendancyName: asc ? translateGameText(asc.displayName || asc.name, lang) : ascendancyIds.ascendancyInternalId || ascendancyIds.ascendClassId || (zh ? '未选择' : 'None'),
    }
  }

  const previewCode = async (code: string, source: string, suggestedName?: string) => {
    const data = decodeBuildCode(code)
    if (!data.nodes.length) throw new Error(zh ? '构筑中没有天赋节点' : 'The build has no passive nodes')
    const previewTreeData = await loadPreviewTreeData(data.treeVersion, treeData)
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
        if (!wegameAvailable) throw new Error(zh ? 'WeGame 导入仅在 Electron 桌面版可用' : 'WeGame import is available only in Electron')
        const converted = await requestPoe2dbImport(trimmed)
        setConvertedCode(converted.code)
        await previewCode(converted.code, 'WeGame')
      } else if (kind === 'poe-ninja') {
        if (!poeNinjaAvailable) throw new Error(zh ? 'poe.ninja 导入仅在 Electron 桌面版可用' : 'poe.ninja import is available only in Electron')
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
        <header className="dialog-header"><div><span>{zh ? '统一导入' : 'Unified import'}</span><h2 id="import-dialog-title">{zh ? '导入构筑' : 'Import build'}</h2></div><button className="icon-command" onClick={onClose} aria-label={zh ? '关闭' : 'Close'}><X /></button></header>
        <nav className="import-tabs">{tabs.map((tab) => { const Icon = tab.icon; return <button key={tab.id} className={kind === tab.id ? 'active' : ''} onClick={() => { setKind(tab.id); setRealm(tab.id === 'wegame' ? 'cn' : tab.id === 'poe-ninja' ? 'global' : defaultRealm); setValue(''); setPreview(null); setError(null) }}><Icon />{tab.label}</button> })}</nav>

        <div className="dialog-body import-body">
          <div className="import-input-panel">
            <fieldset className="realm-field import-realm-field"><legend>{zh ? '游戏区域' : 'Game realm'}</legend><div className="realm-selector">
              <button type="button" className={realm === 'cn' ? 'active cn' : ''} onClick={() => setRealm('cn')}>{zh ? '腾讯服（国服）' : 'Tencent CN'}</button>
              <button type="button" className={realm === 'global' ? 'active global' : ''} onClick={() => setRealm('global')}>{zh ? '国际服' : 'Global'}</button>
            </div></fieldset>
            <label><span>{kind === 'pob' ? (zh ? 'PoB2 构筑代码' : 'PoB2 build code') : kind === 'wegame' ? (zh ? 'WeGame 分享链接' : 'WeGame share link') : (zh ? 'poe.ninja 角色链接' : 'poe.ninja character link')}</span>
              {kind === 'pob'
                ? <textarea value={value} onChange={(event) => { setValue(event.target.value); setPreview(null); setError(null) }} rows={7} placeholder={zh ? '粘贴 PoB2 导出代码' : 'Paste PoB2 export code'} />
                : <input value={value} onChange={(event) => { setValue(event.target.value); setPreview(null); setError(null) }} placeholder={kind === 'wegame' ? 'https://www.wegame.com.cn/helper/poe2/#/share/...' : 'https://poe.ninja/poe2/profile/.../character/...'} />}
            </label>
            {kind === 'wegame' && <p className="import-notice">{wegameAvailable ? (zh ? '链接将通过 PoE2DB 转换为完整 PoB 构筑。' : 'The link is converted to a complete PoB build through PoE2DB.') : (zh ? '当前不是 Electron 环境，无法请求 PoE2DB。' : 'PoE2DB conversion requires the Electron app.')}</p>}
            {kind === 'poe-ninja' && <p className="import-notice">{poeNinjaAvailable ? (zh ? '从角色页面读取官方 Import Code for Path of Building。' : 'Reads the official Import Code for Path of Building from the character page.') : (zh ? '当前不是 Electron 环境，无法请求 poe.ninja。' : 'poe.ninja import requires the Electron app.')}</p>}
            <button className="secondary-command parse-command" onClick={() => void handleParse()} disabled={loading || !value.trim()}>{loading ? <LoaderCircle className="animate-spin" /> : <FileCode2 />}{zh ? '解析预览' : 'Parse preview'}</button>
            {error && <div className="inline-error"><AlertTriangle /><span><strong>{zh ? '无法解析构筑' : 'Unable to parse build'}</strong><small>{error}</small></span></div>}
          </div>

          <div className="import-preview-panel">
            <h3>{zh ? '导入预览' : 'Import preview'}</h3>
            {preview ? <>
              <div className="preview-success"><Check /><span>{zh ? '解析成功' : 'Parsed successfully'}</span></div>
              <dl className="preview-grid">
                <div><dt>{zh ? '职业' : 'Class'}</dt><dd>{preview.className}</dd></div>
                <div><dt>{zh ? '升华' : 'Ascendancy'}</dt><dd>{preview.ascendancyName}</dd></div>
                <div><dt>{zh ? '天赋版本' : 'Tree version'}</dt><dd>{preview.treeVersion}</dd></div>
                <div><dt>{zh ? '分配节点' : 'Allocated nodes'}</dt><dd>{preview.nodeCount}</dd></div>
                <div><dt>{zh ? '武器组节点' : 'Weapon nodes'}</dt><dd>{preview.weaponNodeCount}</dd></div>
                <div><dt>{zh ? '装备数量' : 'Equipment'}</dt><dd>{preview.equipmentCount}</dd></div>
                <div><dt>{zh ? '技能组数量' : 'Skill groups'}</dt><dd>{preview.skillCount}</dd></div>
                <div><dt>{zh ? '来源' : 'Source'}</dt><dd>{preview.source}</dd></div>
              </dl>
            </> : <div className="preview-empty"><FileCode2 /><span>{zh ? '解析后在这里确认构筑内容' : 'Parse the input to review build contents'}</span></div>}
          </div>
        </div>

        <footer className="dialog-footer import-footer"><button className="secondary-command" onClick={onClose}>{zh ? '取消' : 'Cancel'}</button><span /><button className="secondary-command" disabled={!preview || !hasCurrentBuild || loading} onClick={() => void submit('replace')}>{zh ? '替换当前构筑' : 'Replace current build'}</button><button className="primary-command" disabled={!preview || loading} onClick={() => void submit('new')}>{zh ? '作为新构筑导入' : 'Import as new build'}</button></footer>
      </section>
    </div>
  )
}

import { AlertTriangle, FileCheck2, Files, FolderOpen, RefreshCw, X } from 'lucide-react'
import type { ParsedSuperPoeBuildFile } from '@/engine/superPoeBuildFile'
import { useTranslation } from '@/i18n/useTranslation'
import type { SavedBuild } from '@/types/tree'

interface NativeBuildOpenDialogProps {
  parsed: ParsedSuperPoeBuildFile
  filePath?: string
  existingBuild?: SavedBuild
  hasUnsavedChanges: boolean
  busy: boolean
  error?: string | null
  onCancel: () => void
  onOpenExisting: () => void
  onOpenCopy: () => void
  onReplace: () => void
}

function fileName(filePath?: string): string {
  return filePath?.split(/[\\/]/).pop() || 'SuperPoE Build.spoe'
}

export function NativeBuildOpenDialog({
  parsed,
  filePath,
  existingBuild,
  hasUnsavedChanges,
  busy,
  error,
  onCancel,
  onOpenExisting,
  onOpenCopy,
  onReplace,
}: NativeBuildOpenDialogProps) {
  const { lang } = useTranslation()
  const zh = lang === 'zh-rCN'
  const record = parsed.envelope.data
  const source = record.metadata.source === 'wegame' ? 'WeGame' : record.metadata.source === 'poe-ninja' ? 'poe.ninja' : record.metadata.source === 'pob' ? 'PoB Code' : (zh ? '本地创建' : 'Local')

  return <div className="modal-backdrop" role="presentation">
    <section className="workflow-dialog native-build-dialog" role="dialog" aria-modal="true" aria-labelledby="native-build-open-title">
      <header className="dialog-header">
        <div><span>{zh ? 'SuperPoE 原生文件' : 'SuperPoE native file'}</span><h2 id="native-build-open-title">{zh ? '打开构筑' : 'Open build'}</h2></div>
        <button className="icon-command" onClick={onCancel} disabled={busy} aria-label={zh ? '关闭' : 'Close'}><X /></button>
      </header>
      <div className="native-build-preview">
        <div className="native-build-file-heading"><FileCheck2 /><span><strong>{record.metadata.name}</strong><small>{fileName(filePath)}</small></span></div>
        <dl className="preview-grid">
          <div><dt>{zh ? '天赋版本' : 'Tree version'}</dt><dd>{parsed.treeVersion.replace('_', '.') || '-'}</dd></div>
          <div><dt>{zh ? '天赋节点' : 'Passive nodes'}</dt><dd>{parsed.nodeCount}</dd></div>
          <div><dt>{zh ? '游戏区域' : 'Realm'}</dt><dd>{record.metadata.realm === 'cn' ? (zh ? '腾讯服' : 'Tencent CN') : (zh ? '国际服' : 'Global')}</dd></div>
          <div><dt>{zh ? '最初来源' : 'Original source'}</dt><dd>{source}</dd></div>
          <div><dt>{zh ? '文件版本' : 'File schema'}</dt><dd>v{parsed.envelope.schemaVersion}</dd></div>
          <div><dt>{zh ? '构筑修订' : 'Build revision'}</dt><dd>{parsed.envelope.revision}</dd></div>
        </dl>
        {record.metadata.sourceUrl && <p className="native-build-source-url">{record.metadata.sourceUrl}</p>}
        {hasUnsavedChanges && <div className="inline-warning"><AlertTriangle /><span>{zh ? '当前构筑有未保存修改。继续打开将离开当前构筑。' : 'The current build has unsaved changes. Opening this file will leave it.'}</span></div>}
        {existingBuild && <div className="inline-warning"><AlertTriangle /><span>{zh ? `构筑库中已存在同一 ID 的“${existingBuild.name}”，请选择处理方式。` : `A build with the same ID already exists: “${existingBuild.name}”.`}</span></div>}
        {error && <div className="inline-error"><AlertTriangle /><span><strong>{zh ? '无法打开构筑' : 'Unable to open build'}</strong><small>{error}</small></span></div>}
      </div>
      <footer className="dialog-footer native-build-footer">
        <button className="secondary-command" onClick={onCancel} disabled={busy}>{zh ? '取消' : 'Cancel'}</button>
        <span />
        {existingBuild && <button className="secondary-command" onClick={onOpenExisting} disabled={busy}><FolderOpen />{zh ? '打开库内版本' : 'Open library version'}</button>}
        {existingBuild && <button className="secondary-command" onClick={onReplace} disabled={busy}><RefreshCw />{zh ? '替换库内版本' : 'Replace library version'}</button>}
        <button className="primary-command" onClick={onOpenCopy} disabled={busy}><Files />{existingBuild ? (zh ? '作为副本打开' : 'Open as copy') : (zh ? '加入构筑库并打开' : 'Add to library and open')}</button>
      </footer>
    </section>
  </div>
}

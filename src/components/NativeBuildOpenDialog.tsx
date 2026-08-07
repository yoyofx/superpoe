import { AlertTriangle, FileCheck2, Files, FolderOpen, RefreshCw, X } from 'lucide-react'
import type { ParsedSuperPoeBuildFile } from '@/engine/superPoeBuildFile'
import { useTranslation } from '@/i18n/useTranslation'
import type { SavedBuild } from '@/types/tree'
import { uiText } from '@/i18n/uiLocale'

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
  const l = (en: string, zhCN: string, zhTW: string, koKR: string) => uiText(lang, en, zhCN, zhTW, koKR)
  const record = parsed.envelope.data
  const source = record.metadata.source === 'wegame' ? 'WeGame' : record.metadata.source === 'poe-ninja' ? 'poe.ninja' : record.metadata.source === 'pob' ? 'PoB Code' : l('Local', '本地创建', '本機建立', '로컬 생성')

  return <div className="modal-backdrop" role="presentation">
    <section className="workflow-dialog native-build-dialog" role="dialog" aria-modal="true" aria-labelledby="native-build-open-title">
      <header className="dialog-header">
        <div><span>{l('SuperPoE native file', 'SuperPoE 原生文件', 'SuperPoE 原生檔案', 'SuperPoE 기본 파일')}</span><h2 id="native-build-open-title">{l('Open build', '打开构筑', '開啟構築', '빌드 열기')}</h2></div>
        <button className="icon-command" onClick={onCancel} disabled={busy} aria-label={l('Close', '关闭', '關閉', '닫기')}><X /></button>
      </header>
      <div className="native-build-preview">
        <div className="native-build-file-heading"><FileCheck2 /><span><strong>{record.metadata.name}</strong><small>{fileName(filePath)}</small></span></div>
        <dl className="preview-grid">
          <div><dt>{l('Tree version', '天赋版本', '天賦版本', '패시브 트리 버전')}</dt><dd>{parsed.treeVersion.replace('_', '.') || '-'}</dd></div>
          <div><dt>{l('Passive nodes', '天赋节点', '天賦節點', '패시브 노드')}</dt><dd>{parsed.nodeCount}</dd></div>
          <div><dt>{l('Realm', '游戏区域', '遊戲區域', '리전')}</dt><dd>{record.metadata.realm === 'cn' ? l('Tencent CN', '腾讯服', '騰訊服', 'Tencent 중국') : l('Global', '国际服', '國際服', '글로벌')}</dd></div>
          <div><dt>{l('Original source', '最初来源', '原始來源', '원본 출처')}</dt><dd>{source}</dd></div>
          <div><dt>{l('File schema', '文件版本', '檔案結構版本', '파일 스키마')}</dt><dd>v{parsed.envelope.schemaVersion}</dd></div>
          <div><dt>{l('Build revision', '构筑修订', '構築修訂版', '빌드 리비전')}</dt><dd>{parsed.envelope.revision}</dd></div>
        </dl>
        {record.metadata.sourceUrl && <p className="native-build-source-url">{record.metadata.sourceUrl}</p>}
        {hasUnsavedChanges && <div className="inline-warning"><AlertTriangle /><span>{l('The current build has unsaved changes. Opening this file will leave it.', '当前构筑有未保存修改。继续打开将离开当前构筑。', '目前構築有未儲存的修改。繼續開啟將離開目前構築。', '현재 빌드에 저장하지 않은 변경 사항이 있습니다. 이 파일을 열면 현재 빌드에서 나갑니다.')}</span></div>}
        {existingBuild && <div className="inline-warning"><AlertTriangle /><span>{l(`A build with the same ID already exists: “${existingBuild.name}”.`, `构筑库中已存在同一 ID 的“${existingBuild.name}”，请选择处理方式。`, `構築庫中已有相同 ID 的「${existingBuild.name}」，請選擇處理方式。`, `빌드 라이브러리에 같은 ID의 “${existingBuild.name}” 빌드가 있습니다. 처리 방법을 선택하세요.`)}</span></div>}
        {error && <div className="inline-error"><AlertTriangle /><span><strong>{l('Unable to open build', '无法打开构筑', '無法開啟構築', '빌드를 열 수 없음')}</strong><small>{error}</small></span></div>}
      </div>
      <footer className="dialog-footer native-build-footer">
        <button className="secondary-command" onClick={onCancel} disabled={busy}>{l('Cancel', '取消', '取消', '취소')}</button>
        <span />
        {existingBuild && <button className="secondary-command" onClick={onOpenExisting} disabled={busy}><FolderOpen />{l('Open library version', '打开库内版本', '開啟庫內版本', '라이브러리 버전 열기')}</button>}
        {existingBuild && <button className="secondary-command" onClick={onReplace} disabled={busy}><RefreshCw />{l('Replace library version', '替换库内版本', '取代庫內版本', '라이브러리 버전 교체')}</button>}
        <button className="primary-command" onClick={onOpenCopy} disabled={busy}><Files />{existingBuild ? l('Open as copy', '作为副本打开', '以副本開啟', '복사본으로 열기') : l('Add to library and open', '加入构筑库并打开', '加入構築庫並開啟', '라이브러리에 추가하고 열기')}</button>
      </footer>
    </section>
  </div>
}

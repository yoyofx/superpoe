import { AlertTriangle, CheckCircle2, RefreshCw, X } from 'lucide-react'
import type { BuildUpdateDiff } from '@/engine/buildDiff'
import type { Language } from '@/i18n/translationLoader'
import { uiText } from '@/i18n/uiLocale'
import { useTranslation } from '@/i18n/useTranslation'
import type { SavedBuild } from '@/types/tree'

interface BuildUpdateDialogProps {
  build: SavedBuild
  checking: boolean
  busy: boolean
  error?: string | null
  diff?: BuildUpdateDiff | null
  onCancel: () => void
  onConfirm: () => void
}

function formatBucket(bucket: BuildUpdateDiff['build'], language: Language): string {
  const l = (en: string, zhCN: string, zhTW: string, koKR: string) => uiText(language, en, zhCN, zhTW, koKR)
  const parts: string[] = []
  if (bucket.added) parts.push(`${l('Added', '新增', '新增', '추가')} ${bucket.added}`)
  if (bucket.removed) parts.push(`${l('Removed', '移除', '移除', '제거')} ${bucket.removed}`)
  if (bucket.changed) parts.push(`${l('Changed', '修改', '變更', '변경')} ${bucket.changed}`)
  return parts.join(' · ')
}

export function BuildUpdateDialog({ build, checking, busy, error, diff, onCancel, onConfirm }: BuildUpdateDialogProps) {
  const { lang } = useTranslation()
  const l = (en: string, zhCN: string, zhTW: string, koKR: string) => uiText(lang, en, zhCN, zhTW, koKR)
  const source = build.source === 'poe-ninja' ? 'poe.ninja' : 'WeGame'
  const categories = [
    { key: 'build' as const, label: l('Build info', '构筑信息', '構築資訊', '빌드 정보') },
    { key: 'tree' as const, label: l('Passive tree', '天赋树', '天賦樹', '패시브 트리') },
    { key: 'equipment' as const, label: l('Equipment', '装备', '裝備', '장비') },
    { key: 'skills' as const, label: l('Skills', '技能', '技能', '스킬') },
    { key: 'other' as const, label: l('Other settings', '其它设置', '其他設定', '기타 설정') },
  ].filter((category) => Boolean(diff?.[category.key].added || diff?.[category.key].removed || diff?.[category.key].changed))

  return <div className="modal-backdrop" role="presentation">
    <section className="workflow-dialog native-build-dialog build-update-dialog" role="dialog" aria-modal="true" aria-labelledby="build-update-title">
      <header className="dialog-header">
        <div><span>{source}</span><h2 id="build-update-title">{l('Update build', '更新构筑', '更新構築', '빌드 업데이트')}</h2></div>
        <button className="icon-command" onClick={onCancel} disabled={busy} aria-label={l('Close', '关闭', '關閉', '닫기')}><X /></button>
      </header>
      <div className="native-build-preview">
        <div className="native-build-file-heading"><RefreshCw /><span><strong>{build.name}</strong><small>{build.sourceUrl}</small></span></div>
        {checking ? <div className="inline-warning"><RefreshCw className="spinning" /><span>{l('Checking the remote build...', '正在检查远程构筑...', '正在檢查遠端構築...', '원격 빌드를 확인하는 중...')}</span></div>
          : error ? <div className="inline-error"><AlertTriangle /><span><strong>{l('Update check failed', '检查失败', '檢查失敗', '업데이트 확인 실패')}</strong><small>{error}</small></span></div>
            : <div className="build-update-overview">
              <header><CheckCircle2 /><span><strong>{l('Remote build updated', '发现远程构筑更新', '發現遠端構築更新', '원격 빌드 업데이트 발견')}</strong><small>{l(`${diff?.total || 0} changes found`, `共 ${diff?.total || 0} 项变化`, `共 ${diff?.total || 0} 項變更`, `변경 사항 ${diff?.total || 0}개`)}</small></span></header>
              <div className="build-update-summary-list">
                {categories.map((category) => {
                  const bucket = diff?.[category.key]
                  if (!bucket) return null
                  const total = bucket.added + bucket.removed + bucket.changed
                  return <div className="build-update-summary-row" key={category.key}>
                    <span><strong>{category.label}</strong><small>{formatBucket(bucket, lang)}</small></span>
                    <b>{total}</b>
                  </div>
                })}
              </div>
              <p>{l('Confirming will replace the currently saved build with the remote version.', '确认后将用远程版本替换当前保存的构筑。', '確認後將以遠端版本取代目前儲存的構築。', '확인하면 현재 저장된 빌드를 원격 버전으로 교체합니다.')}</p>
            </div>}
      </div>
      <footer className="dialog-footer native-build-footer">
        <button className="secondary-command" onClick={onCancel} disabled={busy}>{l('Cancel', '取消', '取消', '취소')}</button>
        <span />
        <button className="primary-command" onClick={onConfirm} disabled={checking || busy || Boolean(error) || !diff?.hasChanges}><RefreshCw />{l('Update now', '确认更新', '確認更新', '지금 업데이트')}</button>
      </footer>
    </section>
  </div>
}

import { AlertTriangle, CheckCircle2, RefreshCw, X } from 'lucide-react'
import type { BuildUpdateDiff } from '@/engine/buildDiff'
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

function formatBucket(bucket: BuildUpdateDiff['build'], zh: boolean): string {
  const parts: string[] = []
  if (bucket.added) parts.push((zh ? '\u65b0\u589e' : 'Added') + ' ' + bucket.added)
  if (bucket.removed) parts.push((zh ? '\u79fb\u9664' : 'Removed') + ' ' + bucket.removed)
  if (bucket.changed) parts.push((zh ? '\u4fee\u6539' : 'Changed') + ' ' + bucket.changed)
  return parts.join(' \u00b7 ')
}

export function BuildUpdateDialog({ build, checking, busy, error, diff, onCancel, onConfirm }: BuildUpdateDialogProps) {
  const { lang } = useTranslation()
  const zh = lang === 'zh-rCN'
  const source = build.source === 'poe-ninja' ? 'poe.ninja' : 'WeGame'
  const categories = [
    { key: 'build' as const, label: zh ? '\u6784\u7b51\u4fe1\u606f' : 'Build info' },
    { key: 'tree' as const, label: zh ? '\u5929\u8d4b\u6811' : 'Passive tree' },
    { key: 'equipment' as const, label: zh ? '\u88c5\u5907' : 'Equipment' },
    { key: 'skills' as const, label: zh ? '\u6280\u80fd' : 'Skills' },
    { key: 'other' as const, label: zh ? '\u5176\u5b83\u8bbe\u7f6e' : 'Other settings' },
  ].filter((category) => Boolean(diff?.[category.key].added || diff?.[category.key].removed || diff?.[category.key].changed))

  return <div className="modal-backdrop" role="presentation">
    <section className="workflow-dialog native-build-dialog build-update-dialog" role="dialog" aria-modal="true" aria-labelledby="build-update-title">
      <header className="dialog-header">
        <div><span>{source}</span><h2 id="build-update-title">{zh ? '\u66f4\u65b0\u6784\u7b51' : 'Update build'}</h2></div>
        <button className="icon-command" onClick={onCancel} disabled={busy} aria-label={zh ? '\u5173\u95ed' : 'Close'}><X /></button>
      </header>
      <div className="native-build-preview">
        <div className="native-build-file-heading"><RefreshCw /><span><strong>{build.name}</strong><small>{build.sourceUrl}</small></span></div>
        {checking ? <div className="inline-warning"><RefreshCw className="spinning" /><span>{zh ? '\u6b63\u5728\u68c0\u67e5\u8fdc\u7aef\u6784\u7b51...' : 'Checking the remote build...'}</span></div>
          : error ? <div className="inline-error"><AlertTriangle /><span><strong>{zh ? '\u68c0\u67e5\u5931\u8d25' : 'Update check failed'}</strong><small>{error}</small></span></div>
            : <div className="build-update-overview">
              <header><CheckCircle2 /><span><strong>{zh ? '\u53d1\u73b0\u8fdc\u7aef\u6784\u7b51\u66f4\u65b0' : 'Remote build updated'}</strong><small>{zh ? '\u5171 ' + (diff?.total || 0) + ' \u9879\u53d8\u5316' : (diff?.total || 0) + ' changes found'}</small></span></header>
              <div className="build-update-summary-list">
                {categories.map((category) => {
                  const bucket = diff?.[category.key]
                  if (!bucket) return null
                  const total = bucket.added + bucket.removed + bucket.changed
                  return <div className="build-update-summary-row" key={category.key}>
                    <span><strong>{category.label}</strong><small>{formatBucket(bucket, zh)}</small></span>
                    <b>{total}</b>
                  </div>
                })}
              </div>
              <p>{zh ? '\u786e\u8ba4\u540e\u5c06\u7528\u8fdc\u7aef\u7248\u672c\u66ff\u6362\u5f53\u524d\u4fdd\u5b58\u7684\u6784\u7b51\u3002' : 'Confirming will replace the currently saved build with the remote version.'}</p>
            </div>}
      </div>
      <footer className="dialog-footer native-build-footer">
        <button className="secondary-command" onClick={onCancel} disabled={busy}>{zh ? '\u53d6\u6d88' : 'Cancel'}</button>
        <span />
        <button className="primary-command" onClick={onConfirm} disabled={checking || busy || Boolean(error) || !diff?.hasChanges}><RefreshCw />{zh ? '\u786e\u8ba4\u66f4\u65b0' : 'Update now'}</button>
      </footer>
    </section>
  </div>
}

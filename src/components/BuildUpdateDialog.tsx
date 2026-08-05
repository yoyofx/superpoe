import { AlertTriangle, CheckCircle2, RefreshCw, X } from 'lucide-react'
import { useTranslation } from '@/i18n/useTranslation'
import type { SavedBuild } from '@/types/tree'

interface BuildUpdateDialogProps {
  build: SavedBuild
  checking: boolean
  busy: boolean
  error?: string | null
  onCancel: () => void
  onConfirm: () => void
}

export function BuildUpdateDialog({ build, checking, busy, error, onCancel, onConfirm }: BuildUpdateDialogProps) {
  const { lang } = useTranslation()
  const zh = lang === 'zh-rCN'
  const source = build.source === 'poe-ninja' ? 'poe.ninja' : 'WeGame'

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
            : <div className="inline-warning"><CheckCircle2 /><span>{zh ? '\u8fdc\u7aef\u6784\u7b51\u5df2\u53d1\u751f\u53d8\u5316\uff0c\u662f\u5426\u66ff\u6362\u672c\u5730\u7248\u672c\uff1f' : 'The remote build has changed. Replace the local version?'}</span></div>}
      </div>
      <footer className="dialog-footer native-build-footer">
        <button className="secondary-command" onClick={onCancel} disabled={busy}>{zh ? '\u53d6\u6d88' : 'Cancel'}</button>
        <span />
        <button className="primary-command" onClick={onConfirm} disabled={checking || busy || Boolean(error)}><RefreshCw />{zh ? '\u786e\u8ba4\u66f4\u65b0' : 'Update now'}</button>
      </footer>
    </section>
  </div>
}

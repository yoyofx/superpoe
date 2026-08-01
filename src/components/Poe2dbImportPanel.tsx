import { useState } from 'react'
import { importPobBuildCode } from '@/engine/importPobBuildCode'
import { requestPoe2dbImport } from '@/engine/poe2dbImport'
import { useTranslation } from '@/i18n/useTranslation'

interface Poe2dbImportPanelProps {
  embedded?: boolean
}

/** Standalone WeGame share-link importer backed by PoE2DB. */
export function Poe2dbImportPanel({ embedded = false }: Poe2dbImportPanelProps) {
  const { t } = useTranslation()
  const [shareUrl, setShareUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{ nodeCount: number; sourceUrl: string } | null>(null)

  const handleImport = async () => {
    if (!shareUrl.trim()) return
    setLoading(true)
    setError(null)
    setResult(null)

    try {
      const converted = await requestPoe2dbImport(shareUrl)
      const imported = await importPobBuildCode(converted.code)
      setResult({ nodeCount: imported.nodeCount, sourceUrl: converted.sourceUrl })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  const panelClass = embedded
    ? 'w-[420px] bg-[#0d0d1a]/95 backdrop-blur rounded-lg border border-gray-700 p-4 shadow-xl'
    : 'absolute bottom-4 right-4 z-20 w-96 bg-[#0d0d1a]/90 backdrop-blur rounded-lg border border-gray-700 p-4 shadow-xl'

  return (
    <div className={panelClass}>
      <h3 className="mb-2 text-sm font-semibold text-gray-300">{t('poe2dbImport.title')}</h3>
      <input
        value={shareUrl}
        onChange={(event) => {
          setShareUrl(event.target.value)
          setError(null)
          setResult(null)
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') void handleImport()
        }}
        placeholder={t('poe2dbImport.placeholder')}
        className="w-full rounded border border-gray-600 bg-[#1a1a2e] px-3 py-2 text-sm text-gray-200 placeholder-gray-500 focus:border-blue-500 focus:outline-none"
      />
      <p className="mt-2 text-[11px] leading-relaxed text-gray-500">{t('poe2dbImport.notice')}</p>
      <div className="mt-3 flex items-center justify-between gap-3">
        <button
          onClick={() => void handleImport()}
          disabled={loading || !shareUrl.trim()}
          className="rounded bg-blue-600 px-4 py-1.5 text-sm text-white transition-colors hover:bg-blue-500 disabled:bg-gray-700 disabled:text-gray-500"
        >
          {loading ? t('poe2dbImport.loading') : t('poe2dbImport.button')}
        </button>
        {result && <span className="text-xs text-green-400">{t('poe2dbImport.loaded', { count: result.nodeCount })}</span>}
      </div>
      {result && (
        <a className="mt-3 block truncate text-xs text-blue-400 hover:text-blue-300" href={result.sourceUrl} target="_blank" rel="noreferrer">
          {t('poe2dbImport.source')}
        </a>
      )}
      {error && <p className="mt-3 break-words text-xs text-red-400">{error}</p>}
    </div>
  )
}

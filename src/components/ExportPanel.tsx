import { useState, useCallback } from 'react'
import { useTreeStore } from '@/store/treeStore'

/**
 * ExportPanel — Export allocated nodes as PoB2 code string
 */
export function ExportPanel() {
  const [code, setCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const allocatedNodes = useTreeStore((s) => s.allocatedNodes)
  const nodeCount = allocatedNodes.size

  const handleExport = useCallback(async () => {
    if (nodeCount === 0) return
    setLoading(true)
    setError(null)
    setCode('')
    try {
      const resp = await fetch('/api/code/encode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nodes: [...allocatedNodes],
          treeVersion: '0_4',
        }),
      })
      const data = await resp.json()
      if (!resp.ok || data.error) {
        setError(data.error || `HTTP ${resp.status}`)
      } else {
        setCode(data.code || '')
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [allocatedNodes, nodeCount])

  const handleCopy = useCallback(async () => {
    if (!code) return
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Fallback: select text
      const ta = document.createElement('textarea')
      ta.value = code
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      document.body.removeChild(ta)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }, [code])

  const handleDownload = useCallback(() => {
    if (!code) return
    const blob = new Blob([code], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'pob2-build-code.txt'
    a.click()
    URL.revokeObjectURL(url)
  }, [code])

  return (
    <div className="absolute bottom-4 left-4 z-20 bg-[#0d0d1a]/90 backdrop-blur rounded-lg border border-gray-700 p-3 w-80 shadow-xl">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-xs font-semibold text-gray-300 uppercase">Export</h3>
        <span className="text-xs text-gray-500">{nodeCount} nodes</span>
      </div>

      {code ? (
        <div className="space-y-2">
          <textarea
            readOnly
            value={code}
            rows={2}
            className="w-full bg-[#1a1a2e] border border-gray-600 rounded px-2 py-1.5 text-xs text-gray-300 font-mono resize-none break-all"
          />
          <div className="flex gap-2">
            <button
              onClick={handleCopy}
              className={`flex-1 px-3 py-1.5 text-xs rounded transition-colors ${
                copied
                  ? 'bg-green-700 text-white'
                  : 'bg-blue-600 hover:bg-blue-500 text-white'
              }`}
            >
              {copied ? 'Copied!' : 'Copy'}
            </button>
            <button
              onClick={handleDownload}
              className="px-3 py-1.5 text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 rounded transition-colors"
            >
              Download
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-xs text-gray-500">
            Generate PoB2 import code from allocated nodes
          </p>
          <button
            onClick={handleExport}
            disabled={loading || nodeCount === 0}
            className="w-full px-3 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:text-gray-500 text-white text-sm rounded transition-colors"
          >
            {loading ? 'Encoding...' : 'Generate Export Code'}
          </button>
        </div>
      )}

      {error && (
        <p className="mt-2 text-xs text-red-400 break-words">{error}</p>
      )}
    </div>
  )
}

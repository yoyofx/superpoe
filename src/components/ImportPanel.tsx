import { useState } from 'react'

import { useTreeStore } from '@/store/treeStore'

interface ImportPanelProps {
  embedded?: boolean
}



/**

 * ImportPanel — PoB2 构建编码串导入

 *

 * 输入 PoB2 的 export code → POST /api/build/decode → 高亮已分配节点

 */

export function ImportPanel({ embedded = false }: ImportPanelProps) {

  const [code, setCode] = useState('')

  const [loading, setLoading] = useState(false)

  const [error, setError] = useState<string | null>(null)

  const [result, setResult] = useState<{

    nodeCount: number

    treeVersion: string

  } | null>(null)



  const importAllocatedNodes = useTreeStore((s) => s.importAllocatedNodes)

  const clearAllocatedNodes = useTreeStore((s) => s.clearAllocatedNodes)



  const handleImport = async () => {

    const trimmed = code.trim()

    if (!trimmed) return



    setLoading(true)

    setError(null)

    setResult(null)



    try {

      const resp = await fetch('/api/build/decode', {

        method: 'POST',

        headers: { 'Content-Type': 'application/json' },

        body: JSON.stringify({ code: trimmed }),

      })



      const text = await resp.text()
      let data: {
        error?: string
        nodes?: string[]
        nodeWeaponSets?: Record<string, 1 | 2>
        treeVersion?: string
        classId?: string
        ascendClassId?: string
      } = {}
      if (text) {
        try {
          data = JSON.parse(text)
        } catch {
          data = { error: `Import API returned a non-JSON response: HTTP ${resp.status}` }
        }
      }



      if (!resp.ok || data.error) {

        setError(data.error || `Import API returned an empty response: HTTP ${resp.status}`)

        setLoading(false)

        return

      }



      const nodeIds: string[] = data.nodes || []

      if (nodeIds.length > 0) {

        await importAllocatedNodes(nodeIds, data.nodeWeaponSets || {}, {
          treeVersion: data.treeVersion,
          classId: data.classId,
          ascendClassId: data.ascendClassId,
        })

      }



      setResult({

        nodeCount: nodeIds.length,

        treeVersion: data.treeVersion || 'unknown',

      })

    } catch (err: unknown) {

      setError(err instanceof Error ? err.message : String(err))

    } finally {

      setLoading(false)

    }

  }



  const handleClear = () => {

    setCode('')

    setError(null)

    setResult(null)

    clearAllocatedNodes()

  }



  const handleKeyDown = (e: React.KeyboardEvent) => {

    if (e.key === 'Enter' && !e.shiftKey) {

      e.preventDefault()

      handleImport()

    }

  }



  const panelClass = embedded
    ? 'w-[420px] bg-[#0d0d1a]/95 backdrop-blur rounded-lg border border-gray-700 p-4 shadow-xl'
    : 'absolute bottom-4 right-4 z-20 bg-[#0d0d1a]/90 backdrop-blur rounded-lg border border-gray-700 p-4 w-96 shadow-xl'

  return (

    <div className={panelClass}>

      <div className="flex items-center justify-between mb-2">

        <h3 className="text-sm font-semibold text-gray-300">Import PoB2 Build Code</h3>

        <button

          onClick={handleClear}

          className="text-xs text-gray-500 hover:text-gray-300 transition-colors"

        >

          Clear

        </button>

      </div>



      <textarea

        value={code}

        onChange={(e) => {

          setCode(e.target.value)

          setError(null)

          setResult(null)

        }}

        onKeyDown={handleKeyDown}

        placeholder="Paste PoB2 export code..."

        rows={3}

        className="w-full bg-[#1a1a2e] border border-gray-600 rounded px-3 py-2 text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:border-blue-500 resize-none font-mono"

      />



      <div className="flex items-center justify-between mt-2">

        <button

          onClick={handleImport}

          disabled={loading || !code.trim()}

          className="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:text-gray-500 text-white text-sm rounded transition-colors"

        >

          {loading ? 'Decoding...' : 'Import'}

        </button>



        {result && (

          <span className="text-xs text-green-400">

            {result.nodeCount} nodes loaded

          </span>

        )}

      </div>



      {error && (

        <p className="mt-2 text-xs text-red-400 break-words">{error}</p>

      )}

    </div>

  )

}


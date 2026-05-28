import { useTreeStore } from '@/store/treeStore'



const HOVER_OFFSET = 12



/**

 * NodeTooltip — 节点 hover 浮层

 *

 * 显示在鼠标右下角 +12px 偏移处

 * 内容：节点名称、类型标签、stats 文本

 */

export function NodeTooltip() {

  const treeData = useTreeStore((s) => s.treeData)

  const hoveredNodeId = useTreeStore((s) => s.hoveredNodeId)

  const mouseX = useTreeStore((s) => s.mouseX)

  const mouseY = useTreeStore((s) => s.mouseY)



  if (!hoveredNodeId || !treeData) return null



  const node = treeData.nodes[hoveredNodeId]

  if (!node) return null



  const typeLabel: Record<string, string> = {

    Keystone: '核心天赋',

    Notable: '显著天赋',

    Normal: '普通天赋',

    ClassStart: '职业起点',

    AscendClassStart: '升华起点',

    Mastery: '专精',

    JewelSocket: '珠宝插槽',

  }



  const typeColor: Record<string, string> = {

    Keystone: 'text-red-400',

    Notable: 'text-amber-400',

    Normal: 'text-gray-400',

    ClassStart: 'text-green-400',

    AscendClassStart: 'text-green-400',

    Mastery: 'text-blue-400',

    JewelSocket: 'text-purple-400',

  }



  // 限制 tooltip 不超出屏幕

  const maxX = window.innerWidth - 280

  const maxY = window.innerHeight - 200

  const left = Math.min(mouseX + HOVER_OFFSET, maxX)

  const top = Math.min(mouseY + HOVER_OFFSET, maxY)



  return (

    <div

      className="fixed z-50 pointer-events-none bg-gray-900/95 border border-gray-700

                 rounded-lg px-4 py-3 shadow-xl max-w-[260px]"

      style={{ left, top }}

    >

      {/* 节点名称 */}

      <div className="text-sm font-semibold text-white mb-1 leading-tight">

        {node.name}

      </div>



      {/* 类型标签 */}

      <span className={`inline-block text-xs px-1.5 py-0.5 rounded ${typeColor[node.type] ?? 'text-gray-400'} bg-gray-800 mb-2`}>

        {typeLabel[node.type] ?? node.type}

      </span>



      {/* Stats */}

      {node.stats && node.stats.length > 0 && (

        <div className="text-xs text-gray-300 space-y-0.5">

          {node.stats.map((stat, i) => (

            <div key={i} className="leading-relaxed">{stat}</div>

          ))}

        </div>

      )}



      {/* Flavour text */}

      {node.flavourText && (Array.isArray(node.flavourText) ? node.flavourText : [node.flavourText]).length > 0 && (

        <div className="mt-2 pt-2 border-t border-gray-700 text-xs text-gray-500 italic leading-relaxed">

          {(Array.isArray(node.flavourText) ? node.flavourText : [node.flavourText]).map((t, i) => (

            <div key={i}>{t}</div>

          ))}

        </div>

      )}

    </div>

  )

}


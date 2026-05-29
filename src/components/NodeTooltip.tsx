import { useMemo } from 'react'
import { useTreeStore } from '@/store/treeStore'

const HOVER_OFFSET = 14
const WIDTH = 340
const MIN_HEIGHT = 120

function headerPrefix(nodeType: string, ascendancyName?: string): string {
  if (ascendancyName || nodeType === 'AscendClassStart') return 'ascendancypassiveheader'
  if (nodeType === 'Keystone') return 'keystonepassiveheader'
  if (nodeType === 'Notable') return 'notablepassiveheader'
  if (nodeType === 'JewelSocket' || nodeType === 'Socket') return 'jewelpassiveheader'
  return 'normalpassiveheader'
}

function clampTooltip(x: number, y: number) {
  const maxX = Math.max(8, window.innerWidth - WIDTH - 8)
  const maxY = Math.max(8, window.innerHeight - MIN_HEIGHT - 8)
  return {
    left: Math.min(Math.max(8, x + HOVER_OFFSET), maxX),
    top: Math.min(Math.max(8, y + HOVER_OFFSET), maxY),
  }
}

export function NodeTooltip() {
  const treeData = useTreeStore((s) => s.treeData)
  const hoveredNodeId = useTreeStore((s) => s.hoveredNodeId)
  const mouseX = useTreeStore((s) => s.mouseX)
  const mouseY = useTreeStore((s) => s.mouseY)

  const pos = useMemo(() => clampTooltip(mouseX, mouseY), [mouseX, mouseY])

  if (!hoveredNodeId || !treeData) return null
  const node = treeData.nodes[hoveredNodeId]
  if (!node) return null

  const prefix = headerPrefix(node.type, node.ascendancyName)
  const flavourLines = Array.isArray(node.flavourText)
    ? node.flavourText
    : node.flavourText ? [node.flavourText] : []

  return (
    <div
      className="fixed z-50 pointer-events-none text-[#d7d2c5] shadow-2xl"
      style={{ left: pos.left, top: pos.top, width: WIDTH }}
    >
      <div className="relative flex h-[42px] items-center overflow-hidden">
        <img className="h-[42px] w-[42px] shrink-0" src={`/assets/ui/${prefix}left.png`} alt="" />
        <div
          className="flex h-[42px] min-w-0 flex-1 items-center justify-center bg-repeat-x px-2 text-center font-serif text-[15px] font-semibold leading-tight text-[#f4e6b8]"
          style={{ backgroundImage: `url(/assets/ui/${prefix}middle.png)` }}
        >
          {node.name}
        </div>
        <img className="h-[42px] w-[42px] shrink-0" src={`/assets/ui/${prefix}right.png`} alt="" />
      </div>

      <div className="border-x border-b border-[#6a5540] bg-[#070707]/95 px-4 py-3 font-serif text-[13px] leading-snug">
        {node.stats?.length ? (
          <div className="space-y-1 text-[#c8c4ba]">
            {node.stats.map((stat, i) => <div key={i}>{stat}</div>)}
          </div>
        ) : null}

        {flavourLines.length > 0 ? (
          <div className="mt-3 border-t border-[#3e3429] pt-2 text-[#9b8f7d] italic">
            {flavourLines.map((line, i) => <div key={i}>{line}</div>)}
          </div>
        ) : null}
      </div>
    </div>
  )
}

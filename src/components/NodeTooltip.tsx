import { useEffect, useMemo, useState } from 'react'
import { getAttributeNodeDisplay } from '@/engine/attributeNodes'
import { getLocalizedNodeDisplay, translateGameText } from '@/i18n/translationLoader'
import { decodeBuildCode } from '@/engine/buildCode'
import { useTreeStore } from '@/store/treeStore'

const HOVER_OFFSET = 14
const WIDTH = 340
const MIN_HEIGHT = 120
const HEADER_SOURCE_W = 71
const HEADER_SOURCE_H = 88
const HEADER_H = 44
const HEADER_TILE_W = HEADER_SOURCE_W * (HEADER_H / HEADER_SOURCE_H)

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
  const nodeAttributeSelections = useTreeStore((s) => s.nodeAttributeSelections)
  const importedBuildCode = useTreeStore((s) => s.importedBuildCode)
  const language = useTreeStore((s) => s.language)
  const [headerArtFailed, setHeaderArtFailed] = useState(false)
  useTreeStore((s) => s.translationRevision)

  const pos = useMemo(() => clampTooltip(mouseX, mouseY), [mouseX, mouseY])
  const passiveJewels = useMemo(() => {
    if (!importedBuildCode) return {}
    try {
      return decodeBuildCode(importedBuildCode).nodeJewels
    } catch {
      return {}
    }
  }, [importedBuildCode])
  const nodeId = hoveredNodeId || ''
  const node = nodeId && treeData ? treeData.nodes[nodeId] : undefined
  const prefix = headerPrefix(node?.type || 'Normal', node?.ascendancyName)
  useEffect(() => setHeaderArtFailed(false), [prefix])

  if (!node) return null
  const displayNode = getAttributeNodeDisplay(node, nodeAttributeSelections[nodeId])
  const localizedNode = getLocalizedNodeDisplay(
    { ...node, name: displayNode.name, stats: displayNode.stats },
    language,
  )

  const flavourLines = localizedNode.flavourText || []
  const grantedSkills = localizedNode.grantedSkills || []
  const socketedJewel = passiveJewels[nodeId]
  const translateJewelText = (value: string) => translateGameText(value.replace(/\{[^}]+\}/g, ''), language)
  const jewelLines = socketedJewel?.lines.filter((line) => !/^(Unique ID|Item Level|LevelReq|Quality|Implicits):/i.test(line)) || []

  return (
    <div
      className="fixed z-50 pointer-events-none text-[#d7d2c5] shadow-2xl"
      style={{ left: pos.left, top: pos.top, width: WIDTH }}
    >
      <div className={`relative flex items-center overflow-hidden ${headerArtFailed ? 'node-tooltip-header-fallback' : ''}`} style={{ height: HEADER_H }}>
        {!headerArtFailed && <img
          className="shrink-0"
          src={`/assets/ui/${prefix}left.png`}
          alt=""
          style={{ width: HEADER_TILE_W, height: HEADER_H }}
          onError={() => setHeaderArtFailed(true)}
        />}
        <div
          className="flex min-w-0 flex-1 items-center justify-center bg-repeat-x px-2 text-center font-serif text-[15px] font-semibold leading-tight text-[#f4e6b8]"
          style={{
            height: HEADER_H,
            backgroundImage: headerArtFailed ? undefined : `url(/assets/ui/${prefix}middle.png)`,
            backgroundSize: `${HEADER_TILE_W}px ${HEADER_H}px`,
          }}
        >
          {localizedNode.name}
        </div>
        {!headerArtFailed && <img
          className="shrink-0"
          src={`/assets/ui/${prefix}right.png`}
          alt=""
          style={{ width: HEADER_TILE_W, height: HEADER_H }}
          onError={() => setHeaderArtFailed(true)}
        />}
      </div>

      <div className="border-x border-b border-[#6a5540] bg-[#070707]/95 px-4 py-3 font-serif text-[13px] leading-snug">
        {localizedNode.stats?.length ? (
          <div className="space-y-1 text-[#c8c4ba]">
            {localizedNode.stats.map((stat, i) => <div key={i}>{stat}</div>)}
          </div>
        ) : null}

        {grantedSkills.length > 0 ? (
          <div className="mt-3 space-y-2 border-t border-[#3e3429] pt-2">
            {grantedSkills.map((skill, i) => (
              <div key={`${skill.name}-${i}`} className="space-y-1">
                <div className="text-[13px] font-semibold text-[#f4e6b8]">{skill.name}</div>
                {(skill.gemType || skill.tags || skill.weaponRequirements) && (
                  <div className="text-[11px] leading-snug text-[#8fb0d8]">
                    {[skill.gemType, skill.tags, skill.weaponRequirements].filter(Boolean).join(' / ')}
                  </div>
                )}
                <div className="text-[12px] leading-snug text-[#b9b2a4]">{skill.description}</div>
              </div>
            ))}
          </div>
        ) : null}

        {flavourLines.length > 0 ? (
          <div className="mt-3 border-t border-[#3e3429] pt-2 text-[#9b8f7d] italic">
            {flavourLines.map((line, i) => <div key={i}>{line}</div>)}
          </div>
        ) : null}

        {socketedJewel ? (
          <div className="mt-3 border-t border-[#3e3429] pt-2">
            <div className="text-[13px] font-semibold text-[#f4e6b8]">{translateJewelText(socketedJewel.name)}</div>
            {socketedJewel.baseType && <div className="text-[11px] text-[#8fb0d8]">{translateJewelText(socketedJewel.baseType)}</div>}
            <div className="mt-1 space-y-1 text-[#c8c4ba]">
              {jewelLines.slice(0, 8).map((line, index) => <div key={`${line}-${index}`}>{translateJewelText(line)}</div>)}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}

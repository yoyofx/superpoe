import { getLocalizedNodeDisplay } from '@/i18n/translationLoader'
import { useTreeStore } from '@/store/treeStore'
import { useTranslation } from '@/i18n/useTranslation'

/**
 * Sidebar - right-side detail panel for selected node
 */
export function Sidebar() {
  const { t } = useTranslation()
  const treeData = useTreeStore((s) => s.treeData)
  const selectedNodeId = useTreeStore((s) => s.selectedNodeId)
  const setSelectedNode = useTreeStore((s) => s.setSelectedNode)
  const setHoveredNode = useTreeStore((s) => s.setHoveredNode)
  const language = useTreeStore((s) => s.language)
  useTreeStore((s) => s.translationRevision)

  if (!selectedNodeId || !treeData) return null

  const node = treeData.nodes[selectedNodeId]
  if (!node) return null
  const displayNode = getLocalizedNodeDisplay(node, language)
  const grantedSkills = displayNode.grantedSkills || []

  const typeLabel: Record<string, string> = {
    Keystone: t('node.type.keystone'),
    Notable: t('node.type.notable'),
    Normal: t('node.type.normal'),
    ClassStart: t('node.type.classStart'),
    AscendClassStart: t('node.type.ascendancy'),
    Mastery: t('node.type.mastery'),
    JewelSocket: t('node.type.jewel'),
    Socket: t('node.type.jewel'),
    OnlyImage: t('node.type.normal'),
  }

  const typeBorder: Record<string, string> = {
    Keystone: 'border-red-600 bg-red-950/30',
    Notable: 'border-amber-600 bg-amber-950/30',
    Normal: 'border-gray-600 bg-gray-950/30',
    ClassStart: 'border-green-600 bg-green-950/30',
    AscendClassStart: 'border-green-600 bg-green-950/30',
    Mastery: 'border-blue-600 bg-blue-950/30',
    JewelSocket: 'border-purple-600 bg-purple-950/30',
  }

  return (
    <div
      className={`absolute top-3 right-3 z-40 w-72 max-h-[calc(100vh-24px)]
                   overflow-y-auto rounded-lg border shadow-xl
                   ${typeBorder[node.type] ?? 'border-gray-600 bg-gray-900/95'}
                   backdrop-blur-sm`}
    >
      {/* Header */}
      <div className="px-4 pt-3 pb-2 flex items-start justify-between">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-white leading-tight truncate">
            {displayNode.name}
          </h3>
          <span className="text-xs text-gray-400 mt-0.5 block">
            {typeLabel[node.type] ?? node.type}
          </span>
        </div>
        <button
          onClick={() => setSelectedNode(null)}
          className="ml-2 w-5 h-5 flex items-center justify-center rounded
                     hover:bg-gray-700 text-gray-500 hover:text-gray-300
                     transition-colors shrink-0"
        >
          X
        </button>
      </div>

      {/* Stats */}
      {displayNode.stats.length > 0 && (
        <div className="px-4 py-2 border-t border-gray-700/50">
          <div className="text-[11px] font-semibold text-gray-500 uppercase mb-1.5">
            {t('sidebar.stats')}
          </div>
          <ul className="space-y-1">
            {displayNode.stats.map((stat, i) => (
              <li
                key={i}
                className="text-xs text-gray-300 leading-relaxed"
                onMouseEnter={() => setHoveredNode(node.id)}
                onMouseLeave={() => setHoveredNode(null)}
              >
                {stat}
              </li>
            ))}
          </ul>
        </div>
      )}

      {grantedSkills.length > 0 && (
        <div className="px-4 py-2 border-t border-gray-700/50">
          <div className="text-[11px] font-semibold text-gray-500 uppercase mb-1.5">
            {t('sidebar.grantedSkills')}
          </div>
          <div className="space-y-2">
            {grantedSkills.map((skill, i) => (
              <div key={`${skill.name}-${i}`} className="rounded border border-gray-700/60 bg-gray-950/35 p-2">
                <div className="text-xs font-semibold text-amber-200">{skill.name}</div>
                {(skill.gemType || skill.tags || skill.weaponRequirements) && (
                  <div className="mt-0.5 text-[10px] leading-snug text-blue-300/80">
                    {[skill.gemType, skill.tags, skill.weaponRequirements].filter(Boolean).join(' / ')}
                  </div>
                )}
                <div className="mt-1 text-xs leading-relaxed text-gray-300">
                  {skill.description}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Connections */}
      <div className="px-4 py-2 border-t border-gray-700/50">
        <div className="text-[11px] font-semibold text-gray-500 uppercase mb-1.5">
          {t('sidebar.connections')}
        </div>
        <div className="text-xs text-gray-400 space-y-0.5">
          <div>Out: {node.out.length}</div>
          <div>In: {node.in.length}</div>
        </div>
      </div>

      {/* Position */}
      <div className="px-4 py-2 border-t border-gray-700/50">
        <div className="text-[11px] font-semibold text-gray-500 uppercase mb-1.5">
          {t('sidebar.position')}
        </div>
        <div className="text-xs text-gray-500 font-mono">
          x: {node.x.toFixed(1)}, y: {node.y.toFixed(1)}
        </div>
        <div className="text-xs text-gray-600 font-mono mt-0.5">
          group: {node.group} / orbit: {node.orbit}.{node.orbitIndex}
        </div>
      </div>

      {/* Flavour Text */}
      {displayNode.flavourText && displayNode.flavourText.length > 0 && (
        <div className="px-4 py-2 border-t border-gray-700/50">
          <div className="text-[11px] font-semibold text-gray-500 uppercase mb-1.5">
            {t('sidebar.flavourText')}
          </div>
          <div className="text-xs text-gray-500 italic leading-relaxed">
            {displayNode.flavourText.map((line, i) => (
              <div key={i}>{line}</div>
            ))}
          </div>
        </div>
      )}

      {/* Debug */}
      <details className="px-4 py-2 border-t border-gray-700/50">
        <summary className="text-[11px] font-semibold text-gray-600 uppercase cursor-pointer hover:text-gray-400">
          Debug
        </summary>
        <pre className="mt-1 text-[10px] text-gray-600 overflow-x-auto max-h-40">
          {JSON.stringify(node, null, 2)}
        </pre>
      </details>
    </div>
  )
}

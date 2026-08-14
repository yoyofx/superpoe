import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import {
  Application,
  Container,
  Graphics,
  Mesh,
  MeshGeometry,
  Sprite,
  Texture,
} from 'pixi.js'
import { screenToTree } from '@/engine/coordinate'
import { getAttributeNodeDisplay } from '@/engine/attributeNodes'
import { getSinisterJewelSocketIds, isSinisterJewelSocket } from '@/engine/sinisterJewelSockets'
import { getConnectorState } from '@/engine/connectorSprites'
import {
  getEffectiveAllocationPath,
  getImplicitRootIds,
  getNodeAllocMode,
  getPreviewPath,
  isConnectorActiveForModes,
  isEffectivelyAllocated,
  WEAPON_SET_COLORS,
  type AllocMode,
} from '@/engine/passiveAllocation'
import type { AttributeSelection } from '@/engine/attributeNodes'
import { getSpriteLoader } from '@/engine/spriteLoader'
import type { NodeJewels } from '@/engine/buildCode'
import { loadItemIconIndex, resolveItemIconName, type ItemIconIndex } from '@/engine/itemIcons'
import type { SpriteInfo } from '@/engine/spriteLoader'
import {
  preloadPixiConnectors,
  preloadPixiOrbits,
  requestConnectorTexture,
  requestOrbitSegmentTexture,
  requestPixiTexture,
  requestSpriteTexture,
} from '@/engine/pixiTreeAssets'
import {
  getRenderTreePoint,
  getSelectedAscendancyProjection,
  isExternalAscendancyConnector,
  matchesAscendancy,
  NODE_COLOR,
  NODE_RADIUS,
  projectPoint,
  shouldProjectConnector,
} from '@/engine/treeRenderShared'
import { useTreeStore } from '@/store/treeStore'
import type { TreeConnectorQuad, TreeNode } from '@/types/tree'
import { useTranslation } from '@/i18n/useTranslation'
import { uiText } from '@/i18n/uiLocale'

const FALLBACK_VERSION = '0_4'
const ORBIT_SPRITE_NODE_TYPES = new Set(['Notable', 'Keystone', 'ClassStart', 'AscendClassStart'])
const CONNECTOR_ALPHA = {
  active: 0.82,
  preview: 0.72,
  normal: 0.56,
}
const ASCENDANCY_CONNECTOR_ALPHA = {
  active: 0.72,
  preview: 0.64,
  normal: 0.46,
}
const PIXEL_RATIO_CAP = 3
const HOVER_RADIUS_MULTIPLIER = 1.18
const HIT_GRID_CELL_SIZE = 280
const PREVIEW_CACHE_LIMIT = 256

interface NodeHit {
  id: string
  x: number
  y: number
  radius: number
}

interface AttributeAllocationMenu {
  nodeId: string
  left: number
  top: number
}

function hitGridKey(x: number, y: number): string {
  return `${Math.floor(x / HIT_GRID_CELL_SIZE)}:${Math.floor(y / HIT_GRID_CELL_SIZE)}`
}

function getRendererResolution(): number {
  if (typeof window === 'undefined') return 1
  return Math.max(1, Math.min(PIXEL_RATIO_CAP, window.devicePixelRatio || 1))
}

function resizeRendererToHost(app: Application, host: HTMLElement): void {
  const rect = host.getBoundingClientRect()
  const width = Math.max(1, Math.round(rect.width))
  const height = Math.max(1, Math.round(rect.height))
  app.renderer.resize(width, height, getRendererResolution())
}

function hexToNumber(hex: string): number {
  return Number.parseInt(hex.replace('#', ''), 16)
}

function jewelColor(jewel: NodeJewels[string]): number {
  const type = `${jewel.name} ${jewel.baseType}`.toLowerCase()
  if (type.includes('crimson')) return 0xE13A3A
  if (type.includes('viridian') || type.includes('emerald')) return 0x36C46A
  if (type.includes('cobalt') || type.includes('sapphire')) return 0x3E8BEB
  if (type.includes('prismatic')) return 0xF0D06A
  if (type.includes('timeless')) return 0xA86BE0
  if (type.includes('abyss')) return 0x6B5CD6
  return 0xB45DE8
}

function jewelSpriteName(jewel: NodeJewels[string]): string {
  return jewel.rarity === 'UNIQUE' && jewel.name !== 'Grand Spectrum'
    ? jewel.name
    : jewel.baseType
}

function jewelSocketFrameName(allocated: boolean, available: boolean): string {
  if (allocated) return 'JewelFrameAllocated'
  if (available) return 'JewelFrameCanAllocate'
  return 'JewelFrameUnallocated'
}

function assetHalfSize(
  size: { width?: number; height?: number } | undefined,
  fallbackWidth: number,
  fallbackHeight = fallbackWidth,
  zoom: number,
): [number, number] {
  return [
    (size?.width ?? fallbackWidth) * zoom,
    (size?.height ?? fallbackHeight) * zoom,
  ]
}

function buildScreenLineQuad(
  from: [number, number],
  to: [number, number],
  halfWidth: number,
): [number, number][] {
  const dx = to[0] - from[0]
  const dy = to[1] - from[1]
  const dist = Math.hypot(dx, dy) || 1
  const nx = -dy / dist * halfWidth
  const ny = dx / dist * halfWidth
  return [
    [from[0] - nx, from[1] - ny],
    [from[0] + nx, from[1] + ny],
    [to[0] + nx, to[1] + ny],
    [to[0] - nx, to[1] - ny],
  ]
}

function drawFallbackConnector(graphics: Graphics, points: [number, number][], active: boolean, intermediate: boolean): void {
  const alpha = active ? 0.75 : intermediate ? 0.55 : 0.28
  graphics.moveTo((points[0][0] + points[1][0]) / 2, (points[0][1] + points[1][1]) / 2)
  graphics.lineTo((points[2][0] + points[3][0]) / 2, (points[2][1] + points[3][1]) / 2)
  graphics.stroke({ color: 0x747e94, alpha, width: Math.max(0.5, Math.hypot(points[1][0] - points[0][0], points[1][1] - points[0][1]) * 0.5) })
}

function makeConnectorMesh(texture: Texture, points: [number, number][], texCoords?: number[], tint?: number): Mesh {
  const uvs = texCoords?.length === 8
    ? [
      texCoords[0], texCoords[1],
      texCoords[2], texCoords[3],
      texCoords[4], texCoords[5],
      texCoords[6], texCoords[7],
    ]
    : [0, 1, 0, 0, 1, 0, 1, 1]

  const geometry = new MeshGeometry({
    positions: new Float32Array([
      points[0][0], points[0][1],
      points[1][0], points[1][1],
      points[2][0], points[2][1],
      points[3][0], points[3][1],
    ]),
    uvs: new Float32Array(uvs),
    indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
  })
  const mesh = new Mesh({ geometry, texture })
  if (tint != null) mesh.tint = tint
  return mesh
}

function configureSprite(sprite: Sprite, x: number, y: number, width: number, height: number, alpha = 1): void {
  sprite.anchor.set(0.5)
  sprite.position.set(x, y)
  sprite.width = width
  sprite.height = height
  sprite.alpha = alpha
}

function getOrbitTextureState(isAllocated: boolean, isAvailable: boolean, isPreview: boolean): 'normal' | 'intermediate' | 'intermediateactive' {
  if (isAllocated) return 'intermediateactive'
  if (isPreview || isAvailable) return 'intermediate'
  return 'normal'
}

function isPlannedConnector(connectionArt: string | boolean): boolean {
  return typeof connectionArt === 'string' && connectionArt.includes('Planned')
}

function isAscendancyConnectorArt(connectionArt: string | boolean): boolean {
  return connectionArt === true || (typeof connectionArt === 'string' && connectionArt.includes('Ascendancy'))
}

function connectorAlpha(connectionArt: string | boolean, active: boolean, preview: boolean): number {
  const table = isAscendancyConnectorArt(connectionArt) ? ASCENDANCY_CONNECTOR_ALPHA : CONNECTOR_ALPHA
  if (active) return table.active
  if (preview) return table.preview
  return table.normal
}

function clearStage(stage: Container): void {
  for (const child of stage.removeChildren()) {
    child.destroy({ children: true })
  }
}

function updateWorldTransform(app: Application, worldLayer: Container, offsetX: number, offsetY: number, zoom: number): void {
  worldLayer.position.set(app.screen.width / 2 + offsetX * zoom, app.screen.height / 2 + offsetY * zoom)
  worldLayer.scale.set(zoom)
}

export function TreePixiCanvas() {
  const { lang } = useTranslation()
  const hostRef = useRef<HTMLDivElement>(null)
  const appRef = useRef<Application | null>(null)
  const worldLayerRef = useRef<Container | null>(null)
  const previewConnectorLayerRef = useRef<Container | null>(null)
  const previewNodeLayerRef = useRef<Container | null>(null)
  const interactionLayerRef = useRef<Container | null>(null)
  const hoverLayerRef = useRef<Container | null>(null)
  const nodeRenderCacheRef = useRef<Map<string, NodeHit> | null>(null)
  const nodeHitGridRef = useRef<Map<string, NodeHit[]> | null>(null)
  const connectorsByNodeRef = useRef<Map<string, TreeConnectorQuad[]> | null>(null)
  const previewPathCacheRef = useRef(new Map<string, Set<string>>())
  const previewCacheScopeRef = useRef('')
  const pendingHoverPointerRef = useRef<{ x: number; y: number; width: number; height: number } | null>(null)
  const hoverFrameRef = useRef<number | null>(null)
  const hoveredNodeIdRef = useRef<string | null>(null)
  const renderTokenRef = useRef(0)
  const pendingTextureRenderRef = useRef<number | null>(null)
  const isDragging = useRef(false)
  const lastPos = useRef({ x: 0, y: 0 })
  const cameraRef = useRef({ offsetX: 0, offsetY: 0, zoom: 0.2 })
  const [pixiReady, setPixiReady] = useState(false)
  const [textureRenderTick, setTextureRenderTick] = useState(0)
  const [resizeTick, setResizeTick] = useState(0)
  const [nodeRenderRevision, setNodeRenderRevision] = useState(0)
  const [itemIconIndex, setItemIconIndex] = useState<ItemIconIndex | null>(null)
  const [attributeAllocationMenu, setAttributeAllocationMenu] = useState<AttributeAllocationMenu | null>(null)

  const treeData = useTreeStore((s) => s.treeData)
  const treeVersion = useTreeStore((s) => s.treeVersion)
  const offsetX = useTreeStore((s) => s.offsetX)
  const offsetY = useTreeStore((s) => s.offsetY)
  const zoom = useTreeStore((s) => s.zoom)
  const hoveredNodeId = useTreeStore((s) => s.hoveredNodeId)
  const selectedNodeId = useTreeStore((s) => s.selectedNodeId)
  const searchMatchIds = useTreeStore((s) => s.searchMatchIds)
  const treeEditMode = useTreeStore((s) => s.treeEditMode)
  const weaponSetMode = useTreeStore((s) => s.weaponSetMode)
  const nodeWeaponSets = useTreeStore((s) => s.nodeWeaponSets)
  const nodeAttributeSelections = useTreeStore((s) => s.nodeAttributeSelections)
  const getActivePobTreeJewelItems = useTreeStore((s) => s.getActivePobTreeJewelItems)
  const getActivePobXml = useTreeStore((s) => s.getActivePobXml)
  const pobBuildRevision = useTreeStore((s) => s.pobBuildRevision)
  const selectedClassId = useTreeStore((s) => s.selectedClassId)
  const selectedAscendancyId = useTreeStore((s) => s.selectedAscendancyId)
  const allocatedNodes = useTreeStore((s) => s.allocatedNodes)
  const availableNodes = useTreeStore((s) => s.availableNodes)
  const previewNodeId = treeEditMode ? hoveredNodeId : null
  const passiveJewels = useMemo(() => {
    return getActivePobTreeJewelItems() as NodeJewels
  }, [getActivePobTreeJewelItems, pobBuildRevision])
  const dynamicSinisterSocketIds = useMemo(() => {
    return getSinisterJewelSocketIds(treeData || undefined, getActivePobXml())
  }, [getActivePobXml, pobBuildRevision, treeData])
  const previewCacheScope = [
    treeVersion,
    selectedClassId,
    selectedAscendancyId,
    [...allocatedNodes].sort().join(','),
    Object.entries(nodeWeaponSets).sort(([a], [b]) => a.localeCompare(b)).map(([id, mode]) => `${id}:${mode}`).join(','),
  ].join('|')
  const setHoveredNode = useTreeStore((s) => s.setHoveredNode)
  const setSelectedNode = useTreeStore((s) => s.setSelectedNode)
  const setMousePos = useTreeStore((s) => s.setMousePos)
  const panBy = useTreeStore((s) => s.panBy)
  const zoomAt = useTreeStore((s) => s.zoomAt)
  const toggleNode = useTreeStore((s) => s.toggleNode)
  const allocateNodeWithAttribute = useTreeStore((s) => s.allocateNodeWithAttribute)
  const cycleAttributeNode = useTreeStore((s) => s.cycleAttributeNode)

  useEffect(() => {
    cameraRef.current = { offsetX, offsetY, zoom }
  }, [offsetX, offsetY, zoom])

  useEffect(() => {
    hoveredNodeIdRef.current = hoveredNodeId
  }, [hoveredNodeId])

  useEffect(() => {
    let destroyed = false
    let initialized = false
    const host = hostRef.current
    if (!host) return

    const app = new Application()

    app.init({
      background: '#0b0d18',
      antialias: true,
      autoDensity: true,
      resolution: getRendererResolution(),
      resizeTo: host,
      preference: 'webgl',
    }).then(() => {
      initialized = true
      if (destroyed) {
        app.destroy(true)
        return
      }
      appRef.current = app
      app.canvas.style.width = '100%'
      app.canvas.style.height = '100%'
      app.canvas.style.display = 'block'
      app.canvas.dataset.renderer = 'pixi'
      host.replaceChildren(app.canvas)
      resizeRendererToHost(app, host)
      setPixiReady(true)
      renderTokenRef.current += 1
    }).catch((err) => {
      console.error('Failed to initialize Pixi renderer', err)
    })

    return () => {
      destroyed = true
      if (appRef.current === app) {
        appRef.current = null
      }
      if (initialized) {
        app.destroy(true)
      }
      appRef.current = null
      if (pendingTextureRenderRef.current != null) {
        window.cancelAnimationFrame(pendingTextureRenderRef.current)
        pendingTextureRenderRef.current = null
      }
      if (hoverFrameRef.current != null) {
        window.cancelAnimationFrame(hoverFrameRef.current)
        hoverFrameRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    const app = appRef.current
    const host = hostRef.current
    if (!pixiReady || !app || !host) return

    const syncRendererSize = () => {
      resizeRendererToHost(app, host)
      const worldLayer = worldLayerRef.current
      const cam = cameraRef.current
      if (worldLayer) updateWorldTransform(app, worldLayer, cam.offsetX, cam.offsetY, cam.zoom)
      setResizeTick((tick) => tick + 1)
    }

    const resizeObserver = new ResizeObserver(syncRendererSize)
    resizeObserver.observe(host)
    window.addEventListener('resize', syncRendererSize)

    let mediaQuery: MediaQueryList | null = null
    let removeMediaQueryListener: (() => void) | null = null
    const watchDevicePixelRatio = () => {
      removeMediaQueryListener?.()
      const dpr = window.devicePixelRatio || 1
      mediaQuery = window.matchMedia(`(resolution: ${dpr}dppx)`)
      const onChange = () => {
        syncRendererSize()
        watchDevicePixelRatio()
      }
      mediaQuery.addEventListener('change', onChange)
      removeMediaQueryListener = () => mediaQuery?.removeEventListener('change', onChange)
    }
    watchDevicePixelRatio()
    syncRendererSize()

    return () => {
      resizeObserver.disconnect()
      window.removeEventListener('resize', syncRendererSize)
      removeMediaQueryListener?.()
    }
  }, [pixiReady])

  const requestRender = useCallback(() => {
    if (pendingTextureRenderRef.current != null) return
    pendingTextureRenderRef.current = window.requestAnimationFrame(() => {
      pendingTextureRenderRef.current = null
      setTextureRenderTick((tick) => tick + 1)
    })
  }, [])

  useEffect(() => {
    if (!treeData) return
    const spriteLoader = getSpriteLoader(treeVersion)
    void Promise.allSettled([
      spriteLoader.init(),
      preloadPixiConnectors(treeVersion),
      preloadPixiConnectors(FALLBACK_VERSION),
      preloadPixiOrbits(treeVersion),
      preloadPixiOrbits(FALLBACK_VERSION),
    ])
  }, [treeData, treeVersion])

  useEffect(() => {
    void loadItemIconIndex().then(setItemIconIndex)
  }, [])

  useEffect(() => {
    const app = appRef.current
    if (!pixiReady || !app?.stage || !treeData) return

    const token = ++renderTokenRef.current
    const render = () => {
      const spriteLoader = getSpriteLoader(treeVersion)
      if (token !== renderTokenRef.current || !app.stage) return

      clearStage(app.stage)
      const W = app.screen.width
      const H = app.screen.height
      const selectedAscendancyProjection = getSelectedAscendancyProjection(treeData, selectedClassId, selectedAscendancyId)
      const allocationContext = { treeData, selectedClassId, selectedAscendancyId }
      const implicitRoots = getImplicitRootIds(allocationContext)

      const screenLayer = new Container()
      const worldLayer = new Container()
      const backgroundLayer = new Container()
      const orbitLayer = new Container()
      const connectorLayer = new Container()
      const previewConnectorLayer = new Container()
      const nodeLayer = new Container()
      const overlayLayer = new Container()
      const jewelLayer = new Container()
      const previewNodeLayer = new Container()
      const interactionLayer = new Container()
      const hoverLayer = new Container()
      worldLayerRef.current = worldLayer
      previewConnectorLayerRef.current = previewConnectorLayer
      previewNodeLayerRef.current = previewNodeLayer
      interactionLayerRef.current = interactionLayer
      hoverLayerRef.current = hoverLayer
      updateWorldTransform(app, worldLayer, offsetX, offsetY, zoom)
      app.stage.addChild(screenLayer, worldLayer)
      worldLayer.addChild(
        backgroundLayer,
        orbitLayer,
        connectorLayer,
        previewConnectorLayer,
        nodeLayer,
        overlayLayer,
        jewelLayer,
        previewNodeLayer,
        interactionLayer,
        hoverLayer,
      )

      const starfield = new Graphics()
      const starSeed = 83791
      for (let i = 0; i < 120; i += 1) {
        let s = (starSeed + i * 2663) | 0
        s = ((s * 1103515245 + 12345) >>> 0)
        const sx = (s % 10000) / 10000 * W
        s = ((s * 1103515245 + 12345) >>> 0)
        const sy = (s % 10000) / 10000 * H
        s = ((s * 1103515245 + 12345) >>> 0)
        const alpha = 0.08 + (s % 40) / 400
        s = ((s * 1103515245 + 12345) >>> 0)
        const size = 0.4 + (s % 15) / 15
        starfield.rect(sx, sy, size, size).fill({ color: 0xffffff, alpha })
      }
      screenLayer.addChild(starfield)

      const clsData = selectedClassId ? treeData.constants.classes?.[selectedClassId] : undefined
      if (spriteLoader.isAvailable()) {
        const selectedAsc = clsData?.ascendancies?.find((asc) => matchesAscendancy(asc, selectedAscendancyId))
        const centerBg = selectedAsc?.background || clsData?.background
        if (clsData?.background && centerBg?.image) {
          const info = spriteLoader.getByName(centerBg.image)
          if (info) {
            const tex = requestSpriteTexture(info, requestRender)
            if (tex) {
              const sprite = new Sprite(tex)
              const backgroundSize = selectedAscendancyProjection?.backgroundSize ?? centerBg.width
              configureSprite(sprite, clsData.background.x, clsData.background.y, backgroundSize, backgroundSize, 0.92)
              backgroundLayer.addChild(sprite)
            }
          }
        }

        if (clsData?.background) {
          const activeInfo = spriteLoader.getByName('BGTreeActive')
          const activeTexture = activeInfo ? requestSpriteTexture(activeInfo, requestRender) : null
          if (activeTexture) {
            const startNode = clsData.startNodeId ? treeData.nodes[clsData.startNodeId] : undefined
            const sprite = new Sprite(activeTexture)
            const frameSize = selectedAscendancyProjection?.frameSize ?? 2000
            configureSprite(sprite, clsData.background.x, clsData.background.y, frameSize, frameSize, 0.8)
            if (startNode) {
              sprite.rotation = Math.PI / 2 + Math.atan2(startNode.y - clsData.background.y, startNode.x - clsData.background.x)
            }
            backgroundLayer.addChild(sprite)
          }

          const treeInfo = spriteLoader.getByName('BGTree')
          const treeTexture = treeInfo ? requestSpriteTexture(treeInfo, requestRender) : null
          if (treeTexture) {
            const sprite = new Sprite(treeTexture)
            const frameSize = selectedAscendancyProjection?.frameSize ?? 2000
            configureSprite(sprite, clsData.background.x, clsData.background.y, frameSize, frameSize, 0.9)
            backgroundLayer.addChild(sprite)
          }
        }

        for (const cls of Object.values(treeData.constants.classes || {})) {
          for (const asc of cls.ascendancies || []) {
            const bg = asc.background
            if (!bg?.image) continue
            const info = spriteLoader.getByName(bg.image)
            if (!info) continue
            const tex = requestSpriteTexture(info, requestRender)
            if (!tex) continue
            const sprite = new Sprite(tex)
            const isSelected = cls === clsData && matchesAscendancy(asc, selectedAscendancyId)
            configureSprite(sprite, bg.x, bg.y, bg.width, bg.height, isSelected ? 0.66 : 0.26)
            backgroundLayer.addChild(sprite)
          }
        }
      }

      const nodeScreenCache = new Map<string, [number, number]>()
      const nodeList: [string, TreeNode][] = []
      for (const [id, node] of Object.entries(treeData.nodes)) {
        if (node.type === 'OnlyImage') continue
        const [renderX, renderY] = getRenderTreePoint(node, selectedAscendancyProjection)
        nodeScreenCache.set(id, [renderX, renderY])
        nodeList.push([id, node])
      }

      for (const [id, node] of nodeList) {
        if (!ORBIT_SPRITE_NODE_TYPES.has(node.type)) continue
        const [sx, sy] = nodeScreenCache.get(id)!
        const isAllocated = isEffectivelyAllocated(id, allocatedNodes, implicitRoots)
        const isAvailable = !isAllocated && availableNodes.has(id)
        const r = NODE_RADIUS[node.type] ?? 9
        const segWidth = r * 5
        const segHeight = r * 1.5
        const sourceWidth = segWidth
        const tex = requestOrbitSegmentTexture(treeVersion, node.orbit, getOrbitTextureState(isAllocated, isAvailable, false), sourceWidth, requestRender)
        if (!tex) continue
        const sprite = new Sprite(tex)
        configureSprite(sprite, sx, sy, segWidth, segHeight)
        if (!isAllocated && !isAvailable) sprite.alpha = 0.82
        orbitLayer.addChild(sprite)
      }

      if (treeData.connectors?.length) {
        const useTextureConnectors = true
        const fallbackLines = new Graphics()
        for (const connector of treeData.connectors) {
          const node1 = treeData.nodes[connector.nodeId1]
          const node2 = treeData.nodes[connector.nodeId2]
          if (isExternalAscendancyConnector(node1, node2)) continue
          const activeConnector = isConnectorActiveForModes(connector.nodeId1, connector.nodeId2, allocatedNodes, implicitRoots, nodeWeaponSets)
          if (isPlannedConnector(connector.connectionArt) && !activeConnector) continue
          const state = activeConnector ? 'Active' : getConnectorState(false, false)
          const vert = connector.vert[state] || connector.vert.Normal
          if (!vert) continue
          const projectConnector = shouldProjectConnector(connector, selectedAscendancyProjection)
          const selectedAscendancyName = selectedAscendancyProjection?.ascendancyName
          const mixedProjectedConnector = projectConnector
            && node1
            && node2
            && !(node1.ascendancyName === selectedAscendancyName && node2.ascendancyName === selectedAscendancyName)
          let points: [number, number][]
          if (mixedProjectedConnector) {
            const from = getRenderTreePoint(node1, selectedAscendancyProjection)
            const to = getRenderTreePoint(node2, selectedAscendancyProjection)
            points = buildScreenLineQuad(from, to, 2)
          } else {
            const p1 = projectConnector ? projectPoint(vert[0], vert[1], selectedAscendancyProjection!) : [vert[0], vert[1]]
            const p2 = projectConnector ? projectPoint(vert[2], vert[3], selectedAscendancyProjection!) : [vert[2], vert[3]]
            const p3 = projectConnector ? projectPoint(vert[4], vert[5], selectedAscendancyProjection!) : [vert[4], vert[5]]
            const p4 = projectConnector ? projectPoint(vert[6], vert[7], selectedAscendancyProjection!) : [vert[6], vert[7]]
            points = [
              [p1[0], p1[1]],
              [p2[0], p2[1]],
              [p3[0], p3[1]],
              [p4[0], p4[1]],
            ]
          }

          if (useTextureConnectors && !mixedProjectedConnector) {
            const texture = requestConnectorTexture(treeVersion, connector.connectionArt, connector.type, state, requestRender)
            if (!texture || token !== renderTokenRef.current) continue
            const connectorMode1 = getNodeAllocMode(connector.nodeId1, nodeWeaponSets)
            const connectorMode2 = getNodeAllocMode(connector.nodeId2, nodeWeaponSets)
            const connectorMode = connectorMode1 || connectorMode2
            const overlayMode = activeConnector ? connectorMode : 0
            const tint = overlayMode === 1 || overlayMode === 2 ? hexToNumber(WEAPON_SET_COLORS[overlayMode]) : undefined
            const mesh = makeConnectorMesh(texture, points, connector.texCoords, tint)
            mesh.alpha = connectorAlpha(connector.connectionArt, activeConnector, false)
            connectorLayer.addChild(mesh)
          } else if (!useTextureConnectors) {
            drawFallbackConnector(fallbackLines, points, state === 'Active', false)
          }
        }
        connectorLayer.addChild(fallbackLines)
      }

      for (const [id, node] of nodeList) {
        const [sx, sy] = nodeScreenCache.get(id)!
        // PoB grants Sinister sockets from Voices item modifiers at runtime;
        // they are intentionally absent from Spec.nodes. Treat only the
        // dynamically granted sockets as allocated for their own frame and
        // jewel overlay, without adding them to ordinary passive allocation.
        const isDynamicSinisterSocket = isSinisterJewelSocket(node) && dynamicSinisterSocketIds.has(id)
        const isAllocated = isEffectivelyAllocated(id, allocatedNodes, implicitRoots) || isDynamicSinisterSocket
        const isAvailable = !isAllocated && availableNodes.has(id)
        const r = NODE_RADIUS[node.type] ?? 6
        const sr = r
        const useNodeDetails = true

        if (spriteLoader.isAvailable()) {
          if (useNodeDetails && ['Notable', 'Keystone'].includes(node.type)) {
            const ringUrl = `/assets/ui/${node.type === 'Keystone' ? 'small_ring.png' : 'ring.png'}`
            const tex = requestPixiTexture(ringUrl, requestRender)
            if (tex) {
              const ring = new Sprite(tex)
              const size = r * 3.5
              configureSprite(ring, sx, sy, size, size)
              nodeLayer.addChild(ring)
            }
          }

          if (useNodeDetails && node.activeEffectImage) {
            const effInfo = spriteLoader.getByIconPath(node.activeEffectImage)
            if (effInfo) {
              const tex = requestSpriteTexture(effInfo, requestRender)
              if (tex) {
                const [effW, effH] = assetHalfSize(node.targetSize?.effect, r * 1.4, r * 1.4, zoom)
                const eff = new Sprite(tex)
                configureSprite(eff, sx, sy, effW * 2 / zoom, effH * 2 / zoom, isAllocated ? 1 : 0.15)
                nodeLayer.addChild(eff)
              }
            }
          }

          let drewSprite = false
          const displayNode = getAttributeNodeDisplay(node, nodeAttributeSelections[id])
          if (displayNode.icon) {
            const iconInfo = spriteLoader.getByIconPath(displayNode.icon)
            if (iconInfo) {
              const tex = requestSpriteTexture(iconInfo, requestRender)
              if (tex) {
                const [iconW, iconH] = assetHalfSize(node.targetSize, r, r, zoom)
                const icon = new Sprite(tex)
                configureSprite(icon, sx, sy, iconW * 2 / zoom, iconH * 2 / zoom, !isAllocated ? 0.68 : 1)
                nodeLayer.addChild(icon)
                drewSprite = true
              }
            }
          }

          if ((node.type === 'JewelSocket' || node.isJewelSocket) && !node.nodeOverlay) {
            const jewelFrame = jewelSocketFrameName(isAllocated, isAvailable)
            const tex = requestPixiTexture(`/assets/dds/${treeVersion}/backgrounds/${jewelFrame}.webp`, requestRender)
            if (tex) {
              const [frameW, frameH] = assetHalfSize(node.targetSize?.overlay, r * 1.2, r * 1.2, zoom)
              const frame = new Sprite(tex)
              configureSprite(frame, sx, sy, frameW * 2 / zoom, frameH * 2 / zoom)
              nodeLayer.addChild(frame)
              drewSprite = true
            }
          }

          const overlay = node.nodeOverlay || treeData.nodeOverlay?.[node.type]
          const stateKey = isAllocated ? 'alloc' : (isAvailable ? 'path' : 'unalloc')
          const frameName = overlay?.[stateKey]
          if (useNodeDetails && frameName) {
            const frameInfo = spriteLoader.getByName(frameName)
            if (frameInfo) {
              const tex = requestSpriteTexture(frameInfo, requestRender)
              if (tex) {
                const [frameW, frameH] = assetHalfSize(node.targetSize?.overlay, r * 1.2, r * 1.2, zoom)
                const frame = new Sprite(tex)
                configureSprite(frame, sx, sy, frameW * 2 / zoom, frameH * 2 / zoom, !isAllocated && ['ClassStart', 'AscendClassStart'].includes(node.type) ? 0.68 : 1)
                nodeLayer.addChild(frame)
                drewSprite = true
              }
            }
          }

          if (!drewSprite) {
          const fallback = new Graphics()
          fallback.circle(sx, sy, sr).fill({ color: hexToNumber(isAllocated ? '#4A9EFF' : NODE_COLOR[node.type] ?? '#888') })
            fallback.circle(sx, sy, sr).stroke({ color: 0xffffff, alpha: 0.12, width: 0.8 })
            nodeLayer.addChild(fallback)
          }
        }

        const overlayGraphics = new Graphics()
        if (isAllocated) {
          overlayGraphics.circle(sx, sy, sr + 1).stroke({ color: 0xA0D4FF, width: 2 })
        }
        if (isAvailable) {
          overlayGraphics.circle(sx, sy, sr + 1).stroke({ color: 0x4ADE80, width: 2.5 })
        }
        if ((node.isJewelSocket || node.type === 'JewelSocket' || node.type === 'Socket') && isAllocated && !passiveJewels[id]) {
          overlayGraphics.circle(sx, sy, sr + 3).stroke({ color: 0xF59E0B, width: 2.2, alpha: 0.95 })
        }
        overlayLayer.addChild(overlayGraphics)
      }

      for (const [id, jewel] of Object.entries(passiveJewels)) {
        const node = treeData.nodes[id]
        const point = nodeScreenCache.get(id)
        const dynamicSocketAllocated = Boolean(node && isSinisterJewelSocket(node) && dynamicSinisterSocketIds.has(id))
        if (!node || !point || (!isEffectivelyAllocated(id, allocatedNodes, implicitRoots) && !dynamicSocketAllocated)) continue
        const radius = (NODE_RADIUS[node.type] ?? 9) * 0.92
        const itemIconUrl = resolveItemIconName(jewel.rarity === 'UNIQUE' ? jewel.name : jewel.baseType, itemIconIndex)
          || resolveItemIconName(jewel.baseType, itemIconIndex)
        const itemTexture = itemIconUrl ? requestPixiTexture(itemIconUrl, requestRender) : null
        if (itemTexture) {
          const [width, height] = assetHalfSize(node.targetSize?.overlay, radius, radius, zoom)
          const sprite = new Sprite(itemTexture)
          configureSprite(sprite, point[0], point[1], width * 2 / zoom, height * 2 / zoom)
          jewelLayer.addChild(sprite)
          continue
        }
        const spriteInfo = spriteLoader.getByName(jewelSpriteName(jewel))
        const spriteTexture = spriteInfo ? requestSpriteTexture(spriteInfo, requestRender) : null
        if (spriteTexture) {
          const [width, height] = assetHalfSize(node.targetSize?.overlay, radius, radius, zoom)
          const sprite = new Sprite(spriteTexture)
          configureSprite(sprite, point[0], point[1], width * 2 / zoom, height * 2 / zoom)
          jewelLayer.addChild(sprite)
          continue
        }
        const gem = new Graphics()
        gem
          .circle(point[0], point[1], radius)
          .fill({ color: jewelColor(jewel), alpha: 0.96 })
        gem
          .circle(point[0], point[1], radius + 2)
          .stroke({ color: 0xFFF3C4, width: 1.5, alpha: 0.95 })
        gem
          .circle(point[0] - radius * 0.25, point[1] - radius * 0.3, Math.max(1.5, radius * 0.22))
          .fill({ color: 0xFFFFFF, alpha: 0.8 })
        jewelLayer.addChild(gem)
      }
      const nodeRenderCache = new Map<string, NodeHit>()
      const nodeHitGrid = new Map<string, NodeHit[]>()
      for (const [id, node] of nodeList) {
        const [x, y] = nodeScreenCache.get(id)!
        const hit = { id, x, y, radius: NODE_RADIUS[node.type] ?? 6 }
        nodeRenderCache.set(id, hit)
        const key = hitGridKey(x, y)
        const bucket = nodeHitGrid.get(key)
        if (bucket) bucket.push(hit)
        else nodeHitGrid.set(key, [hit])
      }
      nodeRenderCacheRef.current = nodeRenderCache
      nodeHitGridRef.current = nodeHitGrid
      const connectorsByNode = new Map<string, TreeConnectorQuad[]>()
      for (const connector of treeData.connectors ?? []) {
        for (const id of [connector.nodeId1, connector.nodeId2]) {
          const list = connectorsByNode.get(id)
          if (list) list.push(connector)
          else connectorsByNode.set(id, [connector])
        }
      }
      connectorsByNodeRef.current = connectorsByNode
      setNodeRenderRevision((revision) => revision + 1)
    }

    const spriteLoader = getSpriteLoader(treeVersion)
    void spriteLoader.init().then(() => {
      if (token === renderTokenRef.current) render()
    })
  }, [pixiReady, textureRenderTick, resizeTick, treeData, treeVersion, nodeWeaponSets, nodeAttributeSelections, passiveJewels, itemIconIndex, selectedClassId, selectedAscendancyId, allocatedNodes, availableNodes, requestRender])

  useEffect(() => {
    const connectorLayer = previewConnectorLayerRef.current
    const nodeLayer = previewNodeLayerRef.current
    if (!pixiReady || !connectorLayer || !nodeLayer) return

    connectorLayer.removeChildren().forEach((child) => child.destroy({ children: true }))
    nodeLayer.removeChildren().forEach((child) => child.destroy({ children: true }))
    if (!treeData || !treeEditMode || !previewNodeId) return

    if (previewCacheScopeRef.current !== previewCacheScope) {
      previewPathCacheRef.current.clear()
      previewCacheScopeRef.current = previewCacheScope
    }

    const cacheKey = `${weaponSetMode}:${previewNodeId}`
    let previewPath = previewPathCacheRef.current.get(cacheKey)
    if (!previewPath) {
      const context = { treeData, selectedClassId, selectedAscendancyId }
      previewPath = getPreviewPath(context, allocatedNodes, nodeWeaponSets, previewNodeId, weaponSetMode as AllocMode)
      previewPathCacheRef.current.set(cacheKey, previewPath)
      if (previewPathCacheRef.current.size > PREVIEW_CACHE_LIMIT) {
        const oldestKey = previewPathCacheRef.current.keys().next().value
        if (oldestKey) previewPathCacheRef.current.delete(oldestKey)
      }
    }
    if (previewPath.size === 0) return

    const nodeCache = nodeRenderCacheRef.current
    const connectorsByNode = connectorsByNodeRef.current
    if (!nodeCache || !connectorsByNode) return

    const roots = getImplicitRootIds({ treeData, selectedClassId, selectedAscendancyId })
    const previewColor = weaponSetMode === 1 || weaponSetMode === 2
      ? hexToNumber(WEAPON_SET_COLORS[weaponSetMode])
      : 0x7DD3FC
    const previewLines = new Graphics()
    const drawnConnectors = new Set<TreeConnectorQuad>()

    for (const id of previewPath) {
      for (const connector of connectorsByNode.get(id) ?? []) {
        if (drawnConnectors.has(connector)) continue
        drawnConnectors.add(connector)
        const node1 = treeData.nodes[connector.nodeId1]
        const node2 = treeData.nodes[connector.nodeId2]
        if (isExternalAscendancyConnector(node1, node2)) continue
        const node1InPath = previewPath.has(connector.nodeId1)
        const node2InPath = previewPath.has(connector.nodeId2)
        const node1Active = isEffectivelyAllocated(connector.nodeId1, allocatedNodes, roots)
        const node2Active = isEffectivelyAllocated(connector.nodeId2, allocatedNodes, roots)
        if (!((node1InPath && (node2InPath || node2Active)) || (node2InPath && (node1InPath || node1Active)))) continue
        const from = nodeCache.get(connector.nodeId1)
        const to = nodeCache.get(connector.nodeId2)
        if (!from || !to) continue
        previewLines.moveTo(from.x, from.y).lineTo(to.x, to.y)
      }
    }
    previewLines.stroke({ color: previewColor, width: 5, alpha: 0.9 })
    connectorLayer.addChild(previewLines)

    const previewNodes = new Graphics()
    for (const id of previewPath) {
      const hit = nodeCache.get(id)
      if (!hit) continue
      previewNodes
        .circle(hit.x, hit.y, hit.radius + 5)
        .fill({ color: previewColor, alpha: 0.18 })
        .stroke({ color: previewColor, width: 2.5, alpha: 0.98 })
    }
    nodeLayer.addChild(previewNodes)
  }, [
    pixiReady,
    treeData,
    treeEditMode,
    previewNodeId,
    previewCacheScope,
    weaponSetMode,
    selectedClassId,
    selectedAscendancyId,
    allocatedNodes,
    nodeWeaponSets,
    nodeRenderRevision,
  ])

  useEffect(() => {
    const interactionLayer = interactionLayerRef.current
    if (!pixiReady || !interactionLayer) return

    interactionLayer.removeChildren().forEach((child) => child.destroy({ children: true }))
    const cache = nodeRenderCacheRef.current
    if (!cache) return

    const highlights = new Graphics()
    const searchRadius = 10 / zoom
    const searchStrokeWidth = 2.5 / zoom
    for (const id of searchMatchIds) {
      if (id === selectedNodeId) continue
      const hit = cache.get(id)
      if (!hit) continue
      highlights
        .circle(hit.x, hit.y, hit.radius + searchRadius)
        .fill({ color: 0x2F9BFF, alpha: 0.18 })
        .stroke({ color: 0x60A5FA, width: searchStrokeWidth, alpha: 0.98 })
    }

    if (selectedNodeId) {
      const hit = cache.get(selectedNodeId)
      if (hit) {
        highlights
          .circle(hit.x, hit.y, hit.radius + 13 / zoom)
          .fill({ color: 0xFFD700, alpha: 0.18 })
          .stroke({ color: 0xFFD700, width: 3 / zoom, alpha: 1 })
      }
    }
    interactionLayer.addChild(highlights)
  }, [pixiReady, searchMatchIds, selectedNodeId, nodeRenderRevision, zoom])

  useEffect(() => {
    const hoverLayer = hoverLayerRef.current
    if (!pixiReady || !hoverLayer) return
    hoverLayer.removeChildren().forEach((child) => child.destroy({ children: true }))
    if (!hoveredNodeId) return
    const hit = nodeRenderCacheRef.current?.get(hoveredNodeId)
    if (!hit) return
    const hover = new Graphics()
    hover
      .circle(hit.x, hit.y, hit.radius * HOVER_RADIUS_MULTIPLIER)
      .stroke({ color: 0xffffff, width: 1.6, alpha: 0.95 })
    hoverLayer.addChild(hover)
  }, [pixiReady, hoveredNodeId])

  useEffect(() => {
    const app = appRef.current
    const worldLayer = worldLayerRef.current
    if (!pixiReady || !app || !worldLayer) return
    updateWorldTransform(app, worldLayer, offsetX, offsetY, zoom)
  }, [pixiReady, offsetX, offsetY, zoom])

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault()
    const rect = hostRef.current?.getBoundingClientRect()
    if (!rect) return
    zoomAt(e.clientX - rect.left, e.clientY - rect.top, e.deltaY < 0 ? 1.15 : 0.87, rect.width, rect.height)
  }, [zoomAt])

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return
    isDragging.current = true
    lastPos.current = { x: e.clientX, y: e.clientY }
  }, [])

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    const rect = hostRef.current?.getBoundingClientRect()
    if (!rect) return
    setMousePos(e.clientX, e.clientY)
    if (isDragging.current) {
      const dx = e.clientX - lastPos.current.x
      const dy = e.clientY - lastPos.current.y
      panBy(dx / zoom, dy / zoom)
      lastPos.current = { x: e.clientX, y: e.clientY }
      return
    }
    if (!treeData) return

    if (treeEditMode) {
      pendingHoverPointerRef.current = {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
        width: rect.width,
        height: rect.height,
      }
      if (hoverFrameRef.current != null) return

      hoverFrameRef.current = window.requestAnimationFrame(() => {
        hoverFrameRef.current = null
        const pointer = pendingHoverPointerRef.current
        const hitGrid = nodeHitGridRef.current
        if (!pointer || !hitGrid) return

        const [tx, ty] = screenToTree(pointer.x, pointer.y, { offsetX, offsetY, zoom }, pointer.width, pointer.height)
        const maxDistance = 30 / zoom
        const minCellX = Math.floor((tx - maxDistance) / HIT_GRID_CELL_SIZE)
        const maxCellX = Math.floor((tx + maxDistance) / HIT_GRID_CELL_SIZE)
        const minCellY = Math.floor((ty - maxDistance) / HIT_GRID_CELL_SIZE)
        const maxCellY = Math.floor((ty + maxDistance) / HIT_GRID_CELL_SIZE)
        let closest: string | null = null
        let closestDist = maxDistance

        for (let cellX = minCellX; cellX <= maxCellX; cellX += 1) {
          for (let cellY = minCellY; cellY <= maxCellY; cellY += 1) {
            for (const hit of hitGrid.get(`${cellX}:${cellY}`) ?? []) {
              const distance = Math.hypot(hit.x - tx, hit.y - ty)
              if (distance < closestDist) {
                closestDist = distance
                closest = hit.id
              }
            }
          }
        }
        if (closest !== hoveredNodeIdRef.current) setHoveredNode(closest)
      })
      return
    }

    const [tx, ty] = screenToTree(e.clientX - rect.left, e.clientY - rect.top, { offsetX, offsetY, zoom }, rect.width, rect.height)
    const selectedAscendancyProjection = getSelectedAscendancyProjection(treeData, selectedClassId, selectedAscendancyId)
    let closest: string | null = null
    let closestDist = 30 / zoom
    for (const [id, node] of Object.entries(treeData.nodes)) {
      const [renderX, renderY] = getRenderTreePoint(node, selectedAscendancyProjection)
      const dist = Math.hypot(renderX - tx, renderY - ty)
      if (dist < closestDist) {
        closestDist = dist
        closest = id
      }
    }
    if (closest !== hoveredNodeId) setHoveredNode(closest)
  }, [panBy, offsetX, offsetY, zoom, treeData, treeEditMode, selectedClassId, selectedAscendancyId, hoveredNodeId, setHoveredNode, setMousePos])

  const handleMouseUp = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return
    if (isDragging.current) {
      const moved = Math.abs(e.clientX - lastPos.current.x) > 3 || Math.abs(e.clientY - lastPos.current.y) > 3
      isDragging.current = false
      if (moved) return
    }
    if (hoveredNodeId && (treeEditMode || treeData?.nodes[hoveredNodeId]?.isJewelSocket || treeData?.nodes[hoveredNodeId]?.type === 'JewelSocket' || treeData?.nodes[hoveredNodeId]?.type === 'Socket')) {
      const targetNode = treeData?.nodes[hoveredNodeId]
      const state = useTreeStore.getState()
      const isJewelSocket = Boolean(targetNode && (targetNode.isJewelSocket || targetNode.type === 'JewelSocket' || targetNode.type === 'Socket'))
      if (isJewelSocket) {
        // Jewel assignment is intentionally separate from passive allocation.
        // Clicking a socket only selects it for the binding panel.
      } else if (targetNode && !state.allocatedNodes.has(hoveredNodeId) && treeData) {
        const path = getEffectiveAllocationPath(
          { treeData, selectedClassId, selectedAscendancyId },
          state.allocatedNodes,
          state.nodeWeaponSets,
          hoveredNodeId,
          state.weaponSetMode,
        )
        const hasAttributeNode = path?.nodes.some((id) => !state.allocatedNodes.has(id) && treeData.nodes[id]?.isAttribute)
        if (hasAttributeNode) {
          setAttributeAllocationMenu({ nodeId: hoveredNodeId, left: e.clientX, top: e.clientY })
        } else {
          toggleNode(hoveredNodeId)
        }
      } else {
        toggleNode(hoveredNodeId)
      }
    }
    setSelectedNode(hoveredNodeId)
  }, [hoveredNodeId, selectedAscendancyId, selectedClassId, setSelectedNode, toggleNode, treeData, treeEditMode])

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    isDragging.current = false
    if (!treeEditMode || !hoveredNodeId) return
    cycleAttributeNode(hoveredNodeId)
  }, [cycleAttributeNode, hoveredNodeId, treeEditMode])

  const handleMouseLeave = useCallback(() => {
    isDragging.current = false
    pendingHoverPointerRef.current = null
    if (hoverFrameRef.current != null) {
      window.cancelAnimationFrame(hoverFrameRef.current)
      hoverFrameRef.current = null
    }
    setHoveredNode(null)
  }, [setHoveredNode])

  const chooseAttributeForAllocation = useCallback((selection: AttributeSelection) => {
    if (!attributeAllocationMenu) return
    allocateNodeWithAttribute(attributeAllocationMenu.nodeId, selection)
    setAttributeAllocationMenu(null)
  }, [allocateNodeWithAttribute, attributeAllocationMenu])

  const handleSearchMarkerClick = useCallback((event: MouseEvent, id: string) => {
    if (treeEditMode && treeData) {
      const state = useTreeStore.getState()
      const targetNode = treeData.nodes[id]
      const isJewelSocket = Boolean(targetNode && (targetNode.isJewelSocket || targetNode.type === 'JewelSocket' || targetNode.type === 'Socket'))
      if (isJewelSocket) {
        // Selection is enough; jewel binding is handled by the detail panel.
      } else if (targetNode && !state.allocatedNodes.has(id)) {
        const path = getEffectiveAllocationPath(
          { treeData, selectedClassId, selectedAscendancyId },
          state.allocatedNodes,
          state.nodeWeaponSets,
          id,
          state.weaponSetMode,
        )
        if (path?.nodes.some((nodeId) => !state.allocatedNodes.has(nodeId) && treeData.nodes[nodeId]?.isAttribute)) {
          setAttributeAllocationMenu({ nodeId: id, left: event.clientX, top: event.clientY })
        } else {
          toggleNode(id)
        }
      } else {
        toggleNode(id)
      }
    }
    setSelectedNode(id)
  }, [selectedAscendancyId, selectedClassId, setSelectedNode, toggleNode, treeData, treeEditMode])

  const searchProjection = treeData
    ? getSelectedAscendancyProjection(treeData, selectedClassId, selectedAscendancyId)
    : null
  const hostBounds = hostRef.current?.getBoundingClientRect()
  const searchViewportWidth = hostBounds?.width ?? (typeof window !== 'undefined' ? window.innerWidth : 0)
  const searchViewportHeight = hostBounds?.height ?? (typeof window !== 'undefined' ? window.innerHeight : 0)
  const searchMarkers = treeData && typeof window !== 'undefined'
    ? searchMatchIds.flatMap((id) => {
      const node = treeData.nodes[id]
      if (!node || node.type === 'OnlyImage') return []
      const [x, y] = getRenderTreePoint(node, searchProjection)
      return [{
        id,
        left: (x + offsetX) * zoom + searchViewportWidth / 2,
        top: (y + offsetY) * zoom + searchViewportHeight / 2,
        selected: id === selectedNodeId,
      }]
    })
    : []

  return (
    <>
      <div
        ref={hostRef}
        className="absolute inset-0 cursor-grab active:cursor-grabbing"
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onContextMenu={handleContextMenu}
        onMouseLeave={handleMouseLeave}
      />
      <div className="pointer-events-none absolute inset-0 z-10">
        {searchMarkers.map((marker) => {
          const size = marker.selected ? 34 : 24
          return (
            <div
              key={marker.id}
              className={marker.selected
                ? 'pointer-events-auto absolute cursor-pointer rounded-full border-[3px] border-amber-300 bg-amber-300/20 shadow-[0_0_16px_rgba(251,191,36,0.95)]'
                : 'pointer-events-auto absolute cursor-pointer rounded-full border-2 border-sky-400 bg-sky-400/15 shadow-[0_0_10px_rgba(96,165,250,0.8)]'}
              style={{
                width: size,
                height: size,
                left: marker.left - size / 2,
                top: marker.top - size / 2,
              }}
              onClick={(event) => handleSearchMarkerClick(event, marker.id)}
            />
          )
        })}
      </div>
      {attributeAllocationMenu && (
        <div
          className="pointer-events-auto fixed z-50 min-w-40 rounded-md border border-[#806b4a] bg-[#100f0c]/[.98] p-1.5 text-sm text-[#eee4ca] shadow-2xl"
          style={{ left: Math.min(attributeAllocationMenu.left + 10, window.innerWidth - 180), top: Math.min(attributeAllocationMenu.top + 10, window.innerHeight - 150) }}
          role="menu"
          onMouseDown={(event) => event.stopPropagation()}
        >
          <div className="px-2 pb-1 text-[11px] uppercase tracking-wide text-[#a99a7d]">{uiText(lang, 'Choose attribute', '选择属性', '選擇屬性', '속성 선택')}</div>
          {([
            [1, `${uiText(lang, 'Strength', '力量', '力量', '힘')} +5`],
            [2, `${uiText(lang, 'Dexterity', '敏捷', '敏捷', '민첩')} +5`],
            [3, `${uiText(lang, 'Intelligence', '智慧', '智慧', '지능')} +5`],
          ] as Array<[AttributeSelection, string]>).map(([selection, label]) => (
            <button
              key={selection}
              type="button"
              className="block w-full rounded px-2 py-1.5 text-left hover:bg-[#806b4a]/35"
              onClick={() => chooseAttributeForAllocation(selection)}
            >
              {label}
            </button>
          ))}
          <button type="button" className="mt-1 block w-full rounded border-t border-[#3e3429] px-2 py-1.5 text-left text-[#a99a7d] hover:bg-[#806b4a]/20" onClick={() => setAttributeAllocationMenu(null)}>{uiText(lang, 'Cancel', '取消', '取消', '취소')}</button>
        </div>
      )}
    </>
  )
}

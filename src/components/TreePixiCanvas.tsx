import { useCallback, useEffect, useRef, useState } from 'react'
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
import { getConnectorState } from '@/engine/connectorSprites'
import {
  getImplicitRootIds,
  getNodeAllocMode,
  getPreviewPath,
  isConnectorActiveForModes,
  isEffectivelyAllocated,
  WEAPON_SET_COLORS,
  type AllocMode,
} from '@/engine/passiveAllocation'
import { getSpriteLoader } from '@/engine/spriteLoader'
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
  isClassToAscendancyConnector,
  matchesAscendancy,
  NODE_COLOR,
  NODE_RADIUS,
  projectPoint,
  shouldProjectConnector,
} from '@/engine/treeRenderShared'
import { useTreeStore } from '@/store/treeStore'
import type { TreeNode } from '@/types/tree'

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
  const hostRef = useRef<HTMLDivElement>(null)
  const appRef = useRef<Application | null>(null)
  const worldLayerRef = useRef<Container | null>(null)
  const hoverLayerRef = useRef<Container | null>(null)
  const nodeRenderCacheRef = useRef<Map<string, { x: number; y: number; radius: number }> | null>(null)
  const renderTokenRef = useRef(0)
  const pendingTextureRenderRef = useRef<number | null>(null)
  const isDragging = useRef(false)
  const lastPos = useRef({ x: 0, y: 0 })
  const cameraRef = useRef({ offsetX: 0, offsetY: 0, zoom: 0.2 })
  const [pixiReady, setPixiReady] = useState(false)
  const [textureRenderTick, setTextureRenderTick] = useState(0)
  const [resizeTick, setResizeTick] = useState(0)

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
  const selectedClassId = useTreeStore((s) => s.selectedClassId)
  const selectedAscendancyId = useTreeStore((s) => s.selectedAscendancyId)
  const allocatedNodes = useTreeStore((s) => s.allocatedNodes)
  const availableNodes = useTreeStore((s) => s.availableNodes)
  const previewNodeId = treeEditMode ? hoveredNodeId : null
  const setHoveredNode = useTreeStore((s) => s.setHoveredNode)
  const setSelectedNode = useTreeStore((s) => s.setSelectedNode)
  const setMousePos = useTreeStore((s) => s.setMousePos)
  const panBy = useTreeStore((s) => s.panBy)
  const zoomAt = useTreeStore((s) => s.zoomAt)
  const toggleNode = useTreeStore((s) => s.toggleNode)

  useEffect(() => {
    cameraRef.current = { offsetX, offsetY, zoom }
  }, [offsetX, offsetY, zoom])

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
      const previewPath = treeEditMode
        ? getPreviewPath(allocationContext, allocatedNodes, nodeWeaponSets, previewNodeId, weaponSetMode as AllocMode)
        : new Set<string>()

      const screenLayer = new Container()
      const worldLayer = new Container()
      const backgroundLayer = new Container()
      const orbitLayer = new Container()
      const connectorLayer = new Container()
      const nodeLayer = new Container()
      const overlayLayer = new Container()
      const hoverLayer = new Container()
      worldLayerRef.current = worldLayer
      hoverLayerRef.current = hoverLayer
      updateWorldTransform(app, worldLayer, offsetX, offsetY, zoom)
      app.stage.addChild(screenLayer, worldLayer)
      worldLayer.addChild(backgroundLayer, orbitLayer, connectorLayer, nodeLayer, overlayLayer, hoverLayer)

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
        const bgInfo = spriteLoader.getByName('BGTree')
        if (bgInfo) {
          const tex = requestSpriteTexture(bgInfo, requestRender)
          if (tex) {
            const sprite = new Sprite(tex)
            configureSprite(sprite, 0, 0, 2000, 2000, 0.48)
            backgroundLayer.addChild(sprite)
          }
        }

        const selectedAsc = clsData?.ascendancies?.find((asc) => matchesAscendancy(asc, selectedAscendancyId))
        const centerBg = selectedAsc?.background || clsData?.background
        if (clsData?.background && centerBg?.image) {
          const info = spriteLoader.getByName(centerBg.image)
          if (info) {
            const tex = requestSpriteTexture(info, requestRender)
            if (tex) {
              const centerScale = selectedAscendancyProjection?.scale ?? 1
              const sprite = new Sprite(tex)
              configureSprite(sprite, clsData.background.x, clsData.background.y, centerBg.width * centerScale, centerBg.height * centerScale, 0.92)
              backgroundLayer.addChild(sprite)
            }
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
        const isPreview = !isAllocated && previewPath.has(id)
        const isAvailable = !isAllocated && (availableNodes.has(id) || isPreview)
        const r = NODE_RADIUS[node.type] ?? 9
        const segWidth = r * 5
        const segHeight = r * 1.5
        const sourceWidth = segWidth
        const tex = requestOrbitSegmentTexture(treeVersion, node.orbit, getOrbitTextureState(isAllocated, isAvailable, isPreview), sourceWidth, requestRender)
        if (!tex) continue
        const sprite = new Sprite(tex)
        configureSprite(sprite, sx, sy, segWidth, segHeight)
        if (!isAllocated && !isPreview && !isAvailable) sprite.alpha = 0.82
        orbitLayer.addChild(sprite)
      }

      if (treeData.connectors?.length) {
        const useTextureConnectors = true
        const fallbackLines = new Graphics()
        for (const connector of treeData.connectors) {
          const node1 = treeData.nodes[connector.nodeId1]
          const node2 = treeData.nodes[connector.nodeId2]
          if (isClassToAscendancyConnector(node1, node2)) continue
          const activeConnector = isConnectorActiveForModes(connector.nodeId1, connector.nodeId2, allocatedNodes, implicitRoots, nodeWeaponSets)
          const previewConnector = !activeConnector && previewPath.has(connector.nodeId1) && previewPath.has(connector.nodeId2)
          if (isPlannedConnector(connector.connectionArt) && !activeConnector && !previewConnector) continue
          const state = activeConnector ? 'Active' : getConnectorState(previewConnector, false)
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
            const previewMode = previewConnector && treeEditMode && weaponSetMode > 0 ? weaponSetMode as 1 | 2 : 0
            const overlayMode = activeConnector ? connectorMode : previewMode
            const tint = overlayMode === 1 || overlayMode === 2 ? hexToNumber(WEAPON_SET_COLORS[overlayMode]) : undefined
            const mesh = makeConnectorMesh(texture, points, connector.texCoords, tint)
            mesh.alpha = connectorAlpha(connector.connectionArt, activeConnector, previewConnector)
            connectorLayer.addChild(mesh)
          } else if (!useTextureConnectors) {
            drawFallbackConnector(fallbackLines, points, state === 'Active', state === 'Intermediate')
          }
        }
        connectorLayer.addChild(fallbackLines)
      }

      const searchSet = new Set(searchMatchIds)
      for (const [id, node] of nodeList) {
        const [sx, sy] = nodeScreenCache.get(id)!
        const isSelected = id === selectedNodeId
        const isSearchMatch = searchSet.has(id)
        const isAllocated = isEffectivelyAllocated(id, allocatedNodes, implicitRoots)
        const isPreview = !isAllocated && previewPath.has(id)
        const isAvailable = !isAllocated && (availableNodes.has(id) || isPreview)
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
          if (node.icon) {
            const iconInfo = spriteLoader.getByIconPath(node.icon)
            if (iconInfo) {
              const tex = requestSpriteTexture(iconInfo, requestRender)
              if (tex) {
                const [iconW, iconH] = assetHalfSize(node.targetSize, r, r, zoom)
                const icon = new Sprite(tex)
                configureSprite(icon, sx, sy, iconW * 2 / zoom, iconH * 2 / zoom, !isAllocated && !isSelected ? 0.68 : 1)
                nodeLayer.addChild(icon)
                drewSprite = true
              }
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
                configureSprite(frame, sx, sy, frameW * 2 / zoom, frameH * 2 / zoom, !isAllocated && !isSelected && ['ClassStart', 'AscendClassStart'].includes(node.type) ? 0.68 : 1)
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
        if (isAllocated && !isSelected) {
          overlayGraphics.circle(sx, sy, sr + 1).stroke({ color: 0xA0D4FF, width: 2 })
        }
        if (isAvailable) {
          overlayGraphics.circle(sx, sy, sr + 1).stroke({ color: 0x4ADE80, width: 2.5 })
        }
        if (isSelected) {
          overlayGraphics.circle(sx, sy, sr + 1.5).stroke({ color: 0xFFD700, width: 2.5 })
        } else if (isSearchMatch) {
          overlayGraphics.circle(sx, sy, sr + 1).stroke({ color: 0x60A5FA, width: 2 })
        }
        overlayLayer.addChild(overlayGraphics)
      }
      nodeRenderCacheRef.current = new Map(nodeList.map(([id, node]) => {
        const [x, y] = nodeScreenCache.get(id)!
        return [id, { x, y, radius: NODE_RADIUS[node.type] ?? 6 }]
      }))
    }

    const spriteLoader = getSpriteLoader(treeVersion)
    void spriteLoader.init().then(() => {
      if (token === renderTokenRef.current) render()
    })
  }, [pixiReady, textureRenderTick, resizeTick, treeData, treeVersion, previewNodeId, selectedNodeId, searchMatchIds, treeEditMode, weaponSetMode, nodeWeaponSets, selectedClassId, selectedAscendancyId, allocatedNodes, availableNodes, requestRender])

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
  }, [panBy, offsetX, offsetY, zoom, treeData, selectedClassId, selectedAscendancyId, hoveredNodeId, setHoveredNode, setMousePos])

  const handleMouseUp = useCallback((e: React.MouseEvent) => {
    if (isDragging.current) {
      const moved = Math.abs(e.clientX - lastPos.current.x) > 3 || Math.abs(e.clientY - lastPos.current.y) > 3
      isDragging.current = false
      if (moved) return
    }
    if (hoveredNodeId && treeEditMode) toggleNode(hoveredNodeId)
    setSelectedNode(hoveredNodeId)
  }, [hoveredNodeId, setSelectedNode, toggleNode, treeEditMode])

  const handleMouseLeave = useCallback(() => {
    isDragging.current = false
    setHoveredNode(null)
  }, [setHoveredNode])

  return (
    <div
      ref={hostRef}
      className="fixed inset-0 cursor-grab active:cursor-grabbing"
      onWheel={handleWheel}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseLeave}
    />
  )
}

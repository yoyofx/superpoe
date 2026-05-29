import { useRef, useEffect, useCallback, useState } from 'react'



import { useTreeStore } from '@/store/treeStore'



import { treeToScreen, screenToTree } from '@/engine/coordinate'



import { drawOrbitSprite, getOrbitState, preloadOrbitSprites, drawRingFrame } from '@/engine/orbitSprites'



import type { AscendancyClass, TreeConnectorQuad, TreeData, TreeNode } from '@/types/tree'
import { getSpriteLoader } from '@/engine/spriteLoader'
import type { SpriteInfo } from '@/engine/spriteLoader'
import { preloadConnectors, drawConnectorQuadTexture, getConnectorState, modulateConnectorTexture, resolveConnectorTexture } from '@/engine/connectorSprites'
import { applyCanvasImageQuality, drawImageMipped, drawImageMippedSource, prepareMipmaps } from '@/engine/imageMipmaps'
import {
  getImplicitRootIds,
  getNodeAllocMode,
  getPreviewPath,
  isConnectorActiveForModes,
  isEffectivelyAllocated,
  WEAPON_SET_COLORS,
  type AllocMode,
} from '@/engine/passiveAllocation'







// ---- Render Config ----

const NODE_RADIUS: Record<string, number> = {



  Normal: 5,



  Notable: 9,



  Keystone: 13,



  ClassStart: 16,



  AscendClassStart: 12,



  Mastery: 8,



  JewelSocket: 9,



  Socket: 5,



}







const NODE_COLOR: Record<string, string> = {



  Normal: '#888',



  Notable: '#C8A05A',



  Keystone: '#D45A5A',



  ClassStart: '#6AA84F',



  AscendClassStart: '#6AA84F',



  Mastery: '#6A8FC8',



  JewelSocket: '#C87ADA',



  Socket: '#888',



}







const HOVER_GLOW = 'rgba(255,255,200,0.4)'

const CONNECTOR_TEXTURE_MIN_ZOOM = 0.1

const NODE_DETAIL_MIN_ZOOM = 0.1

const CONNECTOR_CULL_MARGIN = 160

const ASCENDANCY_CENTER_MARGIN = 120

interface AscendancyProjection {
  ascendancyName: string
  sourceX: number
  sourceY: number
  targetX: number
  targetY: number
  scale: number
}

function matchesAscendancy(asc: AscendancyClass, id: string): boolean {
  return asc.id === id || asc.name === id
}

function getSelectedAscendancyProjection(
  treeData: TreeData,
  selectedClassId: string,
  selectedAscendancyId: string,
): AscendancyProjection | null {
  const cls = treeData.constants.classes?.[selectedClassId]
  const ascendancy = cls?.ascendancies?.find((asc) => matchesAscendancy(asc, selectedAscendancyId))
  if (!cls?.background || !ascendancy?.background) return null

  const startNode = cls.startNodeId ? treeData.nodes[cls.startNodeId] : undefined
  if (!startNode) return null

  const targetX = cls.background.x
  const targetY = cls.background.y
  const sourceX = ascendancy.background.x
  const sourceY = ascendancy.background.y
  const maxRadius = Object.values(treeData.nodes).reduce((max, node) => {
    if (node.ascendancyName !== ascendancy.name) return max
    return Math.max(max, Math.hypot(node.x - sourceX, node.y - sourceY))
  }, Math.max(ascendancy.background.width, ascendancy.background.height) / 2)
  const boundaryRadius = Math.max(
    1,
    Math.hypot(startNode.x - targetX, startNode.y - targetY) - ASCENDANCY_CENTER_MARGIN,
  )
  const scale = maxRadius > 0 ? Math.min(1, boundaryRadius / maxRadius) : 1

  return {
    ascendancyName: ascendancy.name,
    sourceX,
    sourceY,
    targetX,
    targetY,
    scale,
  }
}

function projectPoint(x: number, y: number, projection: AscendancyProjection): [number, number] {
  return [
    projection.targetX + (x - projection.sourceX) * projection.scale,
    projection.targetY + (y - projection.sourceY) * projection.scale,
  ]
}

function getRenderTreePoint(node: TreeNode, projection: AscendancyProjection | null): [number, number] {
  if (projection && node.ascendancyName === projection.ascendancyName) {
    return projectPoint(node.x, node.y, projection)
  }
  return [node.x, node.y]
}

function shouldProjectConnector(connector: TreeConnectorQuad, projection: AscendancyProjection | null): boolean {
  return !!projection && connector.ascendancyName === projection.ascendancyName
}

function isClassToAscendancyConnector(node1?: TreeNode, node2?: TreeNode): boolean {
  if (!node1 || !node2) return false
  return (node1.type === 'ClassStart' && node2.type === 'AscendClassStart')
    || (node2.type === 'ClassStart' && node1.type === 'AscendClassStart')
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

function drawCenteredAsset(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement | HTMLCanvasElement | OffscreenCanvas,
  cx: number,
  cy: number,
  halfWidth: number,
  halfHeight: number,
): void {
  drawImageMipped(ctx, img, cx - halfWidth, cy - halfHeight, halfWidth * 2, halfHeight * 2)
}

function drawCenteredSprite(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement | HTMLCanvasElement | OffscreenCanvas,
  info: SpriteInfo,
  cx: number,
  cy: number,
  halfWidth: number,
  halfHeight: number,
): void {
  if (typeof info.x === 'number' && typeof info.y === 'number') {
    drawImageMippedSource(
      ctx,
      img,
      info.x,
      info.y,
      info.w,
      info.h,
      cx - halfWidth,
      cy - halfHeight,
      halfWidth * 2,
      halfHeight * 2,
    )
    return
  }
  drawCenteredAsset(ctx, img, cx, cy, halfWidth, halfHeight)
}

function pointsIntersectViewport(
  points: [number, number][],
  width: number,
  height: number,
  margin: number,
): boolean {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const [x, y] of points) {
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
  }
  return maxX >= -margin && minX <= width + margin && maxY >= -margin && minY <= height + margin
}



// Jewel socket: diamond shape
function drawDiamond(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number) {
  ctx.beginPath()
  ctx.moveTo(cx, cy - size)
  ctx.lineTo(cx + size * 0.7, cy)
  ctx.lineTo(cx, cy + size)
  ctx.lineTo(cx - size * 0.7, cy)
  ctx.closePath()
}

/** 



  * TreeCanvas - main render component

 *



  * Per-frame render pipeline:

  * 1. Clear Canvas

  * 2. Apply zoom/offset transform matrix

  * 3. Viewport culling: only render visible nodes (MVP: full render)

  * 4. Connection lines: straight for connections, arc for orbit links

  * 5. Nodes: vary size/color by type

 */



export function TreeCanvas() {



  const canvasRef = useRef<HTMLCanvasElement>(null)



  const rafRef = useRef<number>(0)
  const renderRef = useRef<() => void>(() => {})
  const [ddsReady, setDdsReady] = useState(false)
  const imageCache = useRef<Map<string, HTMLImageElement>>(new Map())
  const [connectorsReady, setConnectorsReady] = useState(false)







  // Store subscriptions



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



  const setHoveredNode = useTreeStore((s) => s.setHoveredNode)



  const setSelectedNode = useTreeStore((s) => s.setSelectedNode)



  const setMousePos = useTreeStore((s) => s.setMousePos)



  const panBy = useTreeStore((s) => s.panBy)



  const zoomAt = useTreeStore((s) => s.zoomAt)



  const toggleNode = useTreeStore((s) => s.toggleNode)

  const spriteLoader = getSpriteLoader(treeVersion)

  useEffect(() => {
    setDdsReady(false)
    setConnectorsReady(false)
    imageCache.current.clear()
    preloadOrbitSprites(treeVersion).catch(console.warn)
    spriteLoader.init().then(() => setDdsReady(true)).catch(console.warn)
    Promise.all([
      preloadConnectors(treeVersion, 'Character'),
      preloadConnectors(treeVersion, 'CharacterAscendancy'),
    ]).then(() => setConnectorsReady(true)).catch(console.warn)
  }, [spriteLoader, treeVersion])







  const scheduleRender = useCallback(() => {
    if (rafRef.current) return
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0
      renderRef.current()
    })
  }, [])

  const cacheLoadedImage = useCallback((file: string, loaded: HTMLImageElement | null) => {
    if (!loaded) return
    imageCache.current.set(file, loaded)
    prepareMipmaps(loaded)
    scheduleRender()
  }, [scheduleRender])

  // ---- Render Loop ----

  const render = useCallback(() => {



    const canvas = canvasRef.current



    if (!canvas || !treeData) return







    const ctx = canvas.getContext('2d')



    if (!ctx) return







    const rect = canvas.getBoundingClientRect()

    const W = rect.width

    const H = rect.height

    const dpr = window.devicePixelRatio || 1

    const cam = { offsetX, offsetY, zoom }
    const selectedAscendancyProjection = getSelectedAscendancyProjection(
      treeData,
      selectedClassId,
      selectedAscendancyId,
    )
    const allocationContext = { treeData, selectedClassId, selectedAscendancyId }
    const implicitRoots = getImplicitRootIds(allocationContext)
    const previewPath = treeEditMode
      ? getPreviewPath(
        allocationContext,
        allocatedNodes,
        nodeWeaponSets,
        hoveredNodeId,
        weaponSetMode as AllocMode,
      )
      : new Set<string>()



    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    applyCanvasImageQuality(ctx)



    // Clear + background

    ctx.clearRect(0, 0, W, H)

    ctx.fillStyle = '#080811'

    ctx.fillRect(0, 0, W, H)



    // ---- 8.1.4 Starfield background ----

    // Seeded pseudo-random dots using a simple hash of pixel coordinates

    // Only render once per camera position (seed based on rounded offset/zoom)

    const starSeed = Math.floor(offsetX * 0.1) * 7919 + Math.floor(offsetY * 0.1) * 6271 + Math.floor(zoom * 1000)

    const starCount = 120

    ctx.fillStyle = '#ffffff'

    for (let i = 0; i < starCount; i++) {

      // Simple LCG

      let s = (starSeed + i * 2663) | 0

      s = ((s * 1103515245 + 12345) >>> 0)

      const sx = (s % 10000) / 10000 * W

      s = ((s * 1103515245 + 12345) >>> 0)

      const sy = (s % 10000) / 10000 * H

      s = ((s * 1103515245 + 12345) >>> 0)

      const alpha = 0.08 + (s % 40) / 400  // 0.08â0.18

      s = ((s * 1103515245 + 12345) >>> 0)

      const size = 0.4 + (s % 15) / 15  // 0.4â1.4

      ctx.globalAlpha = alpha

      ctx.fillRect(sx, sy, size, size)

    }

    ctx.globalAlpha = 1



    // ---- Main Tree Background (BGTree) ----
    if (ddsReady && spriteLoader.isAvailable()) {
      const bgInfo = spriteLoader.getByName('BGTree')
      if (bgInfo) {
        const bgImg = imageCache.current.get(bgInfo.file)
        if (bgImg) {
          const [cx, cy] = treeToScreen(0, 0, cam, W, H)
          const bgw = 2000 * zoom
          const bgh = 2000 * zoom
          ctx.globalAlpha = 0.35
          drawCenteredSprite(ctx, bgImg, bgInfo, cx, cy, bgw / 2, bgh / 2)
          ctx.globalAlpha = 1
        } else {
          spriteLoader.getImage(bgInfo).then((loaded) => cacheLoadedImage(bgInfo.file, loaded))
        }
      }
    }

    // ---- BGTreeActive: rotating ring overlay ----

    const clsData2 = selectedClassId ? treeData.constants.classes?.[selectedClassId] : undefined
    if (ddsReady && spriteLoader.isAvailable() && clsData2?.background?.active) {
      const activeInfo = spriteLoader.getByName('BGTreeActive')
      if (activeInfo) {
        const activeImg = imageCache.current.get(activeInfo.file)
        if (activeImg) {
          const [cx, cy] = treeToScreen(0, 0, cam, W, H)
          let angleRad = 0
          if (clsData2.startNodeId && treeData.nodes[clsData2.startNodeId]) {
            const sn = treeData.nodes[clsData2.startNodeId]
            angleRad = Math.atan2(sn.y - 0, sn.x - 0) + Math.PI / 2
          }
          const aw = clsData2.background.active.width * zoom
          const ah = clsData2.background.active.height * zoom
          ctx.save()
          ctx.translate(cx, cy)
          ctx.rotate(angleRad)
          ctx.globalAlpha = 0.5
          drawCenteredSprite(ctx, activeImg, activeInfo, 0, 0, aw / 2, ah / 2)
          ctx.globalAlpha = 1
          ctx.restore()
        } else {
          spriteLoader.getImage(activeInfo).then((loaded) => cacheLoadedImage(activeInfo.file, loaded))
        }
      }
    }

    // ---- Class/selected ascendancy background (center art) ----
    if (ddsReady && spriteLoader.isAvailable() && clsData2?.background?.image) {
      const selectedAsc = clsData2.ascendancies?.find((asc) => matchesAscendancy(asc, selectedAscendancyId))
      const centerBg = selectedAsc?.background || clsData2.background
      const info = spriteLoader.getByName(centerBg.image)
      if (info) {
        const img = imageCache.current.get(info.file)
        if (img) {
          const [cx, cy] = treeToScreen(clsData2.background.x, clsData2.background.y, cam, W, H)
          const centerScale = selectedAscendancyProjection?.scale ?? 1
          const cw = centerBg.width * centerScale * zoom
          const ch = centerBg.height * centerScale * zoom
          ctx.globalAlpha = 0.8
          drawCenteredSprite(ctx, img, info, cx, cy, cw / 2, ch / 2)
          ctx.globalAlpha = 1
        } else {
          spriteLoader.getImage(info).then((loaded) => cacheLoadedImage(info.file, loaded))
        }
      }
    }

    // ---- Ascendancy Background Textures ----
    if (ddsReady && spriteLoader.isAvailable() && treeData.constants.classes) {
      for (const clsData of Object.values(treeData.constants.classes)) {
        for (const asc of clsData.ascendancies || []) {
          const bg = asc.background
          if (!bg) continue
          const info = spriteLoader.getByName(bg.image)
          if (!info) continue
          const img = imageCache.current.get(info.file)
          if (!img) {
            spriteLoader.getImage(info).then((loaded) => cacheLoadedImage(info.file, loaded))
            continue
          }
          const [bgx, bgy] = treeToScreen(bg.x, bg.y, cam, W, H)
          const bgw = bg.width * zoom
          const bgh = bg.height * zoom
          const isSelected = clsData === clsData2 && matchesAscendancy(asc, selectedAscendancyId)
          ctx.globalAlpha = isSelected ? 0.55 : 0.18
          drawCenteredSprite(ctx, img, info, bgx, bgy, bgw / 2, bgh / 2)
          ctx.globalAlpha = 1
        }
      }
    }

    const nodes = treeData.nodes



    const nodeList: [string, TreeNode][] = []



    const nodeScreenCache = new Map<string, [number, number]>()







    for (const [id, node] of Object.entries(nodes)) {



      // Skip decorative OnlyImage nodes



      if (node.type === 'OnlyImage') continue







      const [renderX, renderY] = getRenderTreePoint(node, selectedAscendancyProjection)
      const [sx, sy] = treeToScreen(renderX, renderY, cam, W, H)



        // Viewport culling with -200 margin for edge visibility

      const margin = 200



      if (sx < -margin || sx > W + margin || sy < -margin || sy > H + margin) {



        continue



      }



      nodeScreenCache.set(id, [sx, sy])



      nodeList.push([id, node])



    }



    // ---- 8.2.3/8.2.4: Orbit ring sprites ----

    // Draw orbit texture segments behind Notable/Keystone nodes

    const orbitSpriteNodes = ['Notable', 'Keystone', 'ClassStart', 'AscendClassStart']

    const allocPerOrbit = new Map<number, number>()

    for (const [, node] of nodeList) {

      if (isEffectivelyAllocated(node.id, allocatedNodes, implicitRoots)) {

        allocPerOrbit.set(node.orbit, (allocPerOrbit.get(node.orbit) ?? 0) + 1)

      }

    }

    for (const [id, node] of nodeList) {

      if (!orbitSpriteNodes.includes(node.type)) continue

      const [sx, sy] = nodeScreenCache.get(id)!

      const state = getOrbitState(node.orbit, allocPerOrbit)

      const r = NODE_RADIUS[node.type] ?? 9

      drawOrbitSprite(ctx, treeVersion, node.orbit, state, sx, sy, 0, r, zoom)

    }



    // ---- Connector texture quads ----
    if (connectorsReady && treeData.connectors?.length) {
      const useTextureConnectors = zoom >= CONNECTOR_TEXTURE_MIN_ZOOM
      if (!useTextureConnectors) {
        ctx.save()
        ctx.globalAlpha = 0.45
        ctx.strokeStyle = 'rgba(116, 126, 148, 0.55)'
        ctx.lineWidth = Math.max(0.5, zoom * 2.5)
        ctx.setLineDash([])
      }
      for (const connector of treeData.connectors) {
        const activeConnector = isConnectorActiveForModes(
          connector.nodeId1,
          connector.nodeId2,
          allocatedNodes,
          implicitRoots,
          nodeWeaponSets,
        )
        const previewConnector = !activeConnector && previewPath.has(connector.nodeId1) && previewPath.has(connector.nodeId2)
        const state = activeConnector ? 'Active' : getConnectorState(previewConnector, false)
        const vert = connector.vert[state] || connector.vert.Normal
        if (!vert) continue
        const projectConnector = shouldProjectConnector(connector, selectedAscendancyProjection)
        const node1 = treeData.nodes[connector.nodeId1]
        const node2 = treeData.nodes[connector.nodeId2]
        const selectedAscendancyName = selectedAscendancyProjection?.ascendancyName
        if (isClassToAscendancyConnector(node1, node2)) continue
        const mixedProjectedConnector = projectConnector
          && node1
          && node2
          && !(node1.ascendancyName === selectedAscendancyName && node2.ascendancyName === selectedAscendancyName)
        let points: [number, number][]
        if (mixedProjectedConnector) {
          const from = getRenderTreePoint(node1, selectedAscendancyProjection)
          const to = getRenderTreePoint(node2, selectedAscendancyProjection)
          points = buildScreenLineQuad(
            treeToScreen(from[0], from[1], cam, W, H),
            treeToScreen(to[0], to[1], cam, W, H),
            Math.max(0.5, zoom * 2),
          )
        } else {
          const p1 = projectConnector ? projectPoint(vert[0], vert[1], selectedAscendancyProjection!) : [vert[0], vert[1]]
          const p2 = projectConnector ? projectPoint(vert[2], vert[3], selectedAscendancyProjection!) : [vert[2], vert[3]]
          const p3 = projectConnector ? projectPoint(vert[4], vert[5], selectedAscendancyProjection!) : [vert[4], vert[5]]
          const p4 = projectConnector ? projectPoint(vert[6], vert[7], selectedAscendancyProjection!) : [vert[6], vert[7]]
          points = [
            treeToScreen(p1[0], p1[1], cam, W, H),
            treeToScreen(p2[0], p2[1], cam, W, H),
            treeToScreen(p3[0], p3[1], cam, W, H),
            treeToScreen(p4[0], p4[1], cam, W, H),
          ]
        }
        if (!pointsIntersectViewport(points, W, H, CONNECTOR_CULL_MARGIN)) continue

        if (useTextureConnectors && !mixedProjectedConnector) {
          const img = resolveConnectorTexture(treeVersion, connector.connectionArt, connector.type, state)
          if (!img) continue
          const connectorMode1 = getNodeAllocMode(connector.nodeId1, nodeWeaponSets)
          const connectorMode2 = getNodeAllocMode(connector.nodeId2, nodeWeaponSets)
          const connectorMode = connectorMode1 || connectorMode2
          const previewMode = previewConnector && treeEditMode && weaponSetMode > 0
            ? weaponSetMode as 1 | 2
            : 0
          const overlayMode = connectorMode || previewMode
          const drawImg = overlayMode === 1 || overlayMode === 2
            ? modulateConnectorTexture(img, WEAPON_SET_COLORS[overlayMode])
            : img
          drawConnectorQuadTexture(ctx, drawImg, points, connector.texCoords)
        } else {
          if (useTextureConnectors) continue
          const active = state === 'Active'
          const intermediate = state === 'Intermediate'
          ctx.globalAlpha = active ? 0.75 : intermediate ? 0.55 : 0.28
          ctx.beginPath()
          ctx.moveTo((points[0][0] + points[1][0]) / 2, (points[0][1] + points[1][1]) / 2)
          ctx.lineTo((points[2][0] + points[3][0]) / 2, (points[2][1] + points[3][1]) / 2)
          ctx.stroke()
        }
      }
      if (!useTextureConnectors) {
        ctx.restore()
      }
    }

    // ---- Color helpers ----

    const lighten = (hex: string, amt: number): string => {

      const num = parseInt(hex.slice(1), 16)

      const r = Math.min(255, (num >> 16) + Math.floor(amt * 255))

      const g = Math.min(255, ((num >> 8) & 0xff) + Math.floor(amt * 255))

      const b = Math.min(255, (num & 0xff) + Math.floor(amt * 255))

      return `rgb(${r},${g},${b})`

    }

    const darken = (hex: string, amt: number): string => {

      const num = parseInt(hex.slice(1), 16)

      const r = Math.max(0, (num >> 16) - Math.floor(amt * 255))

      const g = Math.max(0, ((num >> 8) & 0xff) - Math.floor(amt * 255))

      const b = Math.max(0, (num & 0xff) - Math.floor(amt * 255))

      return `rgb(${r},${g},${b})`

    }



      // ---- 2. Nodes (8.1.2: radial highlight + metallic border) ----

    const searchSet = new Set(searchMatchIds)







    for (const [id, node] of nodeList) {



      const [sx, sy] = nodeScreenCache.get(id)!



      const isHovered = id === hoveredNodeId



      const isSelected = id === selectedNodeId



      const isSearchMatch = searchSet.has(id)



      const isAllocated = isEffectivelyAllocated(id, allocatedNodes, implicitRoots)



      const isPreview = !isAllocated && previewPath.has(id)



      const isAvailable = !isAllocated && (availableNodes.has(id) || isPreview)



      const r = NODE_RADIUS[node.type] ?? 6

      const sr = r * zoom



      const allocMode = getNodeAllocMode(id, nodeWeaponSets)

      const color = isAllocated ? '#4A9EFF' : (NODE_COLOR[node.type] ?? '#888')

      const baseColor = color
      const useNodeDetails = zoom >= NODE_DETAIL_MIN_ZOOM







            // 8.2.5: Ring frame behind Notable/Keystone nodes

      if (useNodeDetails && ['Notable', 'Keystone'].includes(node.type)) {

        drawRingFrame(ctx, sx, sy, r, zoom, node.type === 'Keystone')

      }



      // --- Layer 1: activeEffectImage (glow texture under node) ---
      if (useNodeDetails && ddsReady && spriteLoader.isAvailable() && node.activeEffectImage) {
        const effInfo = spriteLoader.getByIconPath(node.activeEffectImage)
        if (effInfo) {
          const effImg = imageCache.current.get(effInfo.file)
          if (effImg) {
            const [effW, effH] = assetHalfSize(node.targetSize?.effect, r * 1.4, r * 1.4, zoom)
            const alpha = isAllocated ? 1.0 : 0.15
            ctx.globalAlpha = alpha
            drawCenteredSprite(ctx, effImg, effInfo, sx, sy, effW, effH)
            ctx.globalAlpha = 1
          } else {
            spriteLoader.getImage(effInfo).then((loaded) => cacheLoadedImage(effInfo.file, loaded))
          }
        }
      }

      // Check if DDS sprite is available for this node
      let ddsIcon: HTMLImageElement | null = null
      let ddsFrame: HTMLImageElement | null = null
      let ddsIconInfo: SpriteInfo | null = null
      let ddsFrameInfo: SpriteInfo | null = null
      if (ddsReady && spriteLoader.isAvailable()) {
        if (node.icon) {
          const info = spriteLoader.getByIconPath(node.icon)
          if (info) {
            ddsIconInfo = info
            ddsIcon = imageCache.current.get(info.file) || null
            if (!ddsIcon) spriteLoader.getImage(info).then((l) => cacheLoadedImage(info.file, l))
          }
        }
        // Per-node overlay takes priority, fall back to type-default overlay from tree.json
        const overlay = node.nodeOverlay || treeData.nodeOverlay?.[node.type]
        if (overlay) {
          const stateKey = isAllocated ? 'alloc' : (isAvailable ? 'path' : 'unalloc')
          const fn = overlay[stateKey]
          if (fn) {
            const fi = spriteLoader.getByName(fn)
            if (fi) {
              ddsFrameInfo = fi
              ddsFrame = imageCache.current.get(fi.file) || null
              if (!ddsFrame) spriteLoader.getImage(fi).then((l) => cacheLoadedImage(fi.file, l))
            }
          }
        }
      }
      const hasDds = !!(ddsIcon || ddsFrame)

      if (hasDds) {
        // DDS-first: draw icon with LessLuminance for unalloc
        if (ddsIcon && ddsIconInfo) {
          const [iconW, iconH] = assetHalfSize(node.targetSize, r, r, zoom)
          if (!isAllocated && !isHovered && !isSelected) {
            ctx.filter = 'brightness(0.5)'
          }
          drawCenteredSprite(ctx, ddsIcon, ddsIconInfo, sx, sy, iconW, iconH)
          ctx.filter = 'none'
        }
        ctx.globalAlpha = 1
        if (useNodeDetails && ddsFrame && ddsFrameInfo) {
          const [frameW, frameH] = assetHalfSize(node.targetSize?.overlay, r * 1.2, r * 1.2, zoom)
          if (!isAllocated && !isHovered && !isSelected && ['ClassStart', 'AscendClassStart'].includes(node.type)) {
            ctx.filter = 'brightness(0.5)'
          }
          drawCenteredSprite(ctx, ddsFrame, ddsFrameInfo, sx, sy, frameW, frameH)
          ctx.filter = 'none'
        }
      } else {
        // Fallback: pure-code circles
        if (isAllocated) {
          ctx.shadowColor = '#4A9EFF'
          ctx.shadowBlur = 12 * zoom
        } else if (isHovered || isSelected) {
          ctx.shadowColor = HOVER_GLOW
          ctx.shadowBlur = 20 * zoom
        }

        // Fill: darker edge
        ctx.beginPath()
        ctx.arc(sx, sy, sr, 0, Math.PI * 2)
        ctx.fillStyle = darken(baseColor, 0.3)
        ctx.fill()

        // Fill: lighter core highlight
        const coreR = sr * 0.5
        if (coreR > 0.5) {
          ctx.beginPath()
          ctx.arc(sx, sy, coreR, 0, Math.PI * 2)
          ctx.fillStyle = lighten(baseColor, 0.25)
          ctx.fill()
        }

        // Metallic border ring
        ctx.beginPath()
        ctx.arc(sx, sy, sr, 0, Math.PI * 2)
        ctx.strokeStyle = 'rgba(255,255,255,0.12)'
        ctx.lineWidth = Math.max(0.8, 0.8 * zoom)
        ctx.setLineDash([])
        ctx.stroke()

        ctx.shadowColor = 'transparent'
        ctx.shadowBlur = 0
      }




      // ---- Status overlay rings ----

      if (isAllocated && !isSelected && !isHovered) {

        ctx.beginPath()

        ctx.arc(sx, sy, sr + 1 * zoom, 0, Math.PI * 2)

        ctx.strokeStyle = '#A0D4FF'

        ctx.lineWidth = 2 * zoom

        ctx.stroke()

      }

      if (isAvailable) {

        ctx.beginPath()

        ctx.arc(sx, sy, sr + 1 * zoom, 0, Math.PI * 2)

        ctx.strokeStyle = '#4ADE80'

        ctx.lineWidth = 2.5 * zoom

        ctx.setLineDash([4 * zoom, 2 * zoom])

        ctx.stroke()

        ctx.setLineDash([])

      }

      if (isSelected) {

        ctx.beginPath()

        ctx.arc(sx, sy, sr + 1.5 * zoom, 0, Math.PI * 2)

        ctx.strokeStyle = '#FFD700'

        ctx.lineWidth = 2.5 * zoom

        ctx.stroke()

      } else if (isSearchMatch) {

        ctx.beginPath()

        ctx.arc(sx, sy, sr + 1 * zoom, 0, Math.PI * 2)

        ctx.strokeStyle = '#60A5FA'

        ctx.lineWidth = 2 * zoom

        ctx.setLineDash([4 * zoom, 2 * zoom])

        ctx.stroke()

        ctx.setLineDash([])

      } else if (isHovered) {

        ctx.beginPath()

        ctx.arc(sx, sy, sr + 1 * zoom, 0, Math.PI * 2)

        ctx.strokeStyle = '#FFF'

        ctx.lineWidth = 1.5 * zoom

        ctx.stroke()

      }

      // Keystone/Notable inner ring accent

      if (['Keystone', 'Notable', 'ClassStart', 'AscendClassStart'].includes(node.type)) {

        ctx.beginPath()

        ctx.arc(sx, sy, sr * 0.45, 0, Math.PI * 2)

        ctx.strokeStyle = 'rgba(0,0,0,0.3)'

        ctx.lineWidth = 1.2 * zoom

        ctx.stroke()

      }

    }

  }, [treeData, offsetX, offsetY, zoom, hoveredNodeId, selectedNodeId, allocatedNodes, availableNodes, nodeWeaponSets, treeEditMode, weaponSetMode, searchMatchIds, selectedClassId, selectedAscendancyId, ddsReady, connectorsReady, cacheLoadedImage])

  useEffect(() => {
    renderRef.current = render
  }, [render])







    // ---- Start/Stop Render Loop ----

  useEffect(() => {



    if (!treeData) return



    scheduleRender()



    return () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = 0
      }
    }



  }, [treeData, render, scheduleRender])







  // ---- Canvas resize ----



  useEffect(() => {



    const canvas = canvasRef.current



    if (!canvas) return







    const resize = () => {



      const dpr = window.devicePixelRatio || 1



      canvas.width = window.innerWidth * dpr



      canvas.height = window.innerHeight * dpr



      canvas.style.width = `${window.innerWidth}px`



      canvas.style.height = `${window.innerHeight}px`



      const ctx = canvas.getContext('2d')



      if (ctx) {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
        applyCanvasImageQuality(ctx)
      }
      scheduleRender()



    }



    resize()



    window.addEventListener('resize', resize)



    return () => window.removeEventListener('resize', resize)



  }, [scheduleRender])







    // ---- Mouse Zoom/Pan ----

  const handleWheel = useCallback(



    (e: React.WheelEvent) => {



      e.preventDefault()



      const rect = canvasRef.current?.getBoundingClientRect()



      if (!rect) return



      const cx = e.clientX - rect.left



      const cy = e.clientY - rect.top



      const factor = e.deltaY < 0 ? 1.15 : 0.87



      zoomAt(cx, cy, factor, rect.width, rect.height)



    },



    [zoomAt],



  )







  const isDragging = useRef(false)



  const lastPos = useRef({ x: 0, y: 0 })







  const handleMouseDown = useCallback((e: React.MouseEvent) => {



    isDragging.current = true



    lastPos.current = { x: e.clientX, y: e.clientY }



  }, [])







  const handleMouseMove = useCallback(



    (e: React.MouseEvent) => {



      // Track mouse position for tooltip



      const rect = canvasRef.current?.getBoundingClientRect()



      if (rect) {



        setMousePos(e.clientX, e.clientY)



      }







      // Pan



      if (isDragging.current) {



        const dx = e.clientX - lastPos.current.x



        const dy = e.clientY - lastPos.current.y



        panBy(dx / zoom, dy / zoom)



        lastPos.current = { x: e.clientX, y: e.clientY }



        return



      }







      // Hover detection: find closest node in tree space



      if (!treeData || !rect) return



      const sx = e.clientX - rect.left



      const sy = e.clientY - rect.top



      const cam = { offsetX, offsetY, zoom }



      const [tx, ty] = screenToTree(sx, sy, cam, rect.width, rect.height)
      const selectedAscendancyProjection = getSelectedAscendancyProjection(
        treeData,
        selectedClassId,
        selectedAscendancyId,
      )







      let closest: string | null = null



      let closestDist = 30 / zoom



      for (const [id, node] of Object.entries(treeData.nodes)) {



        const [renderX, renderY] = getRenderTreePoint(node, selectedAscendancyProjection)

        const dx = renderX - tx



        const dy = renderY - ty



        const dist = Math.sqrt(dx * dx + dy * dy)



        if (dist < closestDist) {



          closestDist = dist



          closest = id



        }



      }



      setHoveredNode(closest)



    },



    [panBy, offsetX, offsetY, zoom, treeData, selectedClassId, selectedAscendancyId, setHoveredNode, setMousePos],



  )







  const handleMouseUp = useCallback(



    (e: React.MouseEvent) => {



      if (isDragging.current) {



        const moved =



          Math.abs(e.clientX - lastPos.current.x) > 3 ||



          Math.abs(e.clientY - lastPos.current.y) > 3



        isDragging.current = false



        if (moved) return



      }



                // Edit mode gates allocation changes; browsing clicks only select nodes.

      if (hoveredNodeId) {



        if (treeEditMode) toggleNode(hoveredNodeId)



      }



      // Always show sidebar for any clicked node



      setSelectedNode(hoveredNodeId)



    },



    [hoveredNodeId, setSelectedNode, toggleNode, treeEditMode],



  )







  const handleMouseLeave = useCallback(() => {



    isDragging.current = false



    setHoveredNode(null)



  }, [setHoveredNode])







  // ---- Keyboard shortcuts (undo/redo) ----



  const undo = useTreeStore((s) => s.undo)



  const redo = useTreeStore((s) => s.redo)



  useEffect(() => {



    const onKey = (e: KeyboardEvent) => {



      if (e.ctrlKey && e.key === 'z' && !e.shiftKey) {



        e.preventDefault(); undo()



      } else if (e.ctrlKey && e.key === 'Z') {



        e.preventDefault(); redo()



      }



    }



    window.addEventListener('keydown', onKey)



    return () => window.removeEventListener('keydown', onKey)



  }, [undo, redo])







  return (



    <canvas



      ref={canvasRef}



      className="cursor-grab active:cursor-grabbing"



      onWheel={handleWheel}



      onMouseDown={handleMouseDown}



      onMouseMove={handleMouseMove}



      onMouseUp={handleMouseUp}



      onMouseLeave={handleMouseLeave}



    />



  )



}




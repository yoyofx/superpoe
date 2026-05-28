import { useRef, useEffect, useCallback, useState } from 'react'



import { useTreeStore } from '@/store/treeStore'



import { treeToScreen, screenToTree } from '@/engine/coordinate'



import { drawOrbitSprite, getOrbitState, preloadOrbitSprites, drawRingFrame } from '@/engine/orbitSprites'



import type { TreeNode } from '@/types/tree'
import { spriteLoader } from '@/engine/spriteLoader'
import { preloadConnectors, drawLineConnectorTexture, drawArcConnectorTexture, getConnectorState, resolveConnectorTexture } from '@/engine/connectorSprites'







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







const CONNECTION_COLOR = '#444'

const CONNECTION_WIDTH = 1.5

const HOVER_GLOW = 'rgba(255,255,200,0.4)'



// Jewel socket: diamond shape
function drawDiamond(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number) {
  ctx.beginPath()
  ctx.moveTo(cx, cy - size)
  ctx.lineTo(cx + size * 0.7, cy)
  ctx.lineTo(cx, cy + size)
  ctx.lineTo(cx - size * 0.7, cy)
  ctx.closePath()
}

function drawArcConnector(

  ctx: CanvasRenderingContext2D,

  sx1: number,

  sy1: number,

  sx2: number,

  sy2: number,

  radius: number,

  side: number,

) {

  const dx = sx2 - sx1

  const dy = sy2 - sy1

  const dist = Math.hypot(dx, dy)

  if (!dist || dist >= radius * 2) {

    ctx.moveTo(sx1, sy1)

    ctx.lineTo(sx2, sy2)

    return

  }



  const midX = (sx1 + sx2) / 2

  const midY = (sy1 + sy2) / 2

  const h = Math.sqrt(Math.max(radius * radius - (dist * dist) / 4, 0))

  const nx = -dy / dist

  const ny = dx / dist

  const cx = midX + nx * h * side

  const cy = midY + ny * h * side

  const a1 = Math.atan2(sy1 - cy, sx1 - cx)

  const a2 = Math.atan2(sy2 - cy, sx2 - cx)



  drawCircleArc(ctx, cx, cy, radius, a1, a2)

}



function drawCircleArc(

  ctx: CanvasRenderingContext2D,

  cx: number,

  cy: number,

  radius: number,

  a1: number,

  a2: number,

) {

  let delta = a2 - a1

  while (delta <= -Math.PI) delta += Math.PI * 2

  while (delta > Math.PI) delta -= Math.PI * 2



  ctx.arc(cx, cy, radius, a1, a1 + delta, delta < 0)

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
  const [ddsReady, setDdsReady] = useState(false)
  const imageCache = useRef<Map<string, HTMLImageElement>>(new Map())



  // 8.2.2: Preload orbit sprites on mount
  useEffect(() => {
    preloadOrbitSprites().catch(console.warn)
  }, [])

  // Initialize DDS sprite loader
  useEffect(() => {
    spriteLoader.init().then(() => setDdsReady(true)).catch(console.warn)
  }, [])

  // 15.11: Preload connector textures
  const [connectorsReady, setConnectorsReady] = useState(false)
  useEffect(() => {
    Promise.all([
      preloadConnectors('Character'),
      preloadConnectors('CharacterAscendancy'),
    ]).then(() => setConnectorsReady(true)).catch(console.warn)
  }, [])







  // Store subscriptions



  const treeData = useTreeStore((s) => s.treeData)



  const offsetX = useTreeStore((s) => s.offsetX)



  const offsetY = useTreeStore((s) => s.offsetY)



  const zoom = useTreeStore((s) => s.zoom)



  const hoveredNodeId = useTreeStore((s) => s.hoveredNodeId)



  const selectedNodeId = useTreeStore((s) => s.selectedNodeId)



  const searchMatchIds = useTreeStore((s) => s.searchMatchIds)
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



    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)



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
          ctx.drawImage(bgImg, cx - bgw / 2, cy - bgh / 2, bgw, bgh)
          ctx.globalAlpha = 1
        } else {
          spriteLoader.getImage(bgInfo).then((loaded) => {
            if (loaded) imageCache.current.set(bgInfo.file, loaded)
          })
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
          ctx.drawImage(activeImg, -aw / 2, -ah / 2, aw, ah)
          ctx.globalAlpha = 1
          ctx.restore()
        } else {
          spriteLoader.getImage(activeInfo).then((loaded) => {
            if (loaded) imageCache.current.set(activeInfo.file, loaded)
          })
        }
      }
    }

    // ---- Class Background (center art) ----
    if (ddsReady && spriteLoader.isAvailable() && clsData2?.background?.image) {
      const clsBg = clsData2.background
      const info = spriteLoader.getByName(clsBg.image)
      if (info) {
        const img = imageCache.current.get(info.file)
        if (img) {
          const [cx, cy] = treeToScreen(clsBg.x, clsBg.y, cam, W, H)
          const cw = clsBg.width * zoom
          const ch = clsBg.height * zoom
          ctx.globalAlpha = 0.8
          ctx.drawImage(img, cx - cw / 2, cy - ch / 2, cw, ch)
          ctx.globalAlpha = 1
        } else {
          spriteLoader.getImage(info).then((loaded) => {
            if (loaded) imageCache.current.set(info.file, loaded)
          })
        }
      }
    }

    // ---- Ascendancy Background Textures (only for selected class) ----
    if (ddsReady && spriteLoader.isAvailable() && selectedClassId && treeData.constants.classes) {
      const clsData = treeData.constants.classes[selectedClassId]
      if (clsData?.ascendancies) {
        for (const asc of clsData.ascendancies) {
          const bg = asc.background
          if (!bg) continue
          const info = spriteLoader.getByName(bg.image)
          if (!info) continue
          const img = imageCache.current.get(info.file)
          if (!img) {
            spriteLoader.getImage(info).then((loaded) => {
              if (loaded) imageCache.current.set(info.file, loaded)
            })
            continue
          }
          const [bgx, bgy] = treeToScreen(bg.x, bg.y, cam, W, H)
          const bgw = bg.width * zoom
          const bgh = bg.height * zoom
          const isSelected = asc.id === selectedAscendancyId || asc.name === selectedAscendancyId
          ctx.globalAlpha = isSelected ? 0.8 : 0.18
          ctx.drawImage(img, bgx - bgw / 2, bgy - bgh / 2, bgw, bgh)
          ctx.globalAlpha = 1
        }
      }
    }

    // ---- 8.1.5 Orbit ring guidelines ----

    const orbitRadii = treeData.constants.orbitRadii as number[]

    if (orbitRadii) {

      ctx.strokeStyle = 'rgba(60, 60, 80, 0.25)'

      ctx.lineWidth = 0.5

      ctx.setLineDash([6, 12])

      for (const rad of orbitRadii) {

        if (rad <= 0) continue

        const screenRad = rad * zoom

        // Draw centered at middle of canvas (orbit centers follow groups roughly)

        const cx = W / 2

        const cy = H / 2

        ctx.beginPath()

        ctx.arc(cx, cy, screenRad, 0, Math.PI * 2)

        ctx.stroke()

      }

      ctx.setLineDash([])

    }







    // ---- PSGroupBackground: texture behind each group's nodes ----
    if (ddsReady && spriteLoader.isAvailable() && treeData.groups) {
      const bgNames = ['PSGroupBackground1', 'PSGroupBackground2', 'PSGroupBackground3']
      for (const bgName of bgNames) {
        const bgInfo = spriteLoader.getByName(bgName)
        if (!bgInfo) continue
        const bgImg = imageCache.current.get(bgInfo.file)
        if (!bgImg) {
          spriteLoader.getImage(bgInfo).then((l) => { if (l) imageCache.current.set(bgInfo.file, l) })
          continue
        }
        // Draw on each group center
        for (const gid of Object.keys(treeData.groups)) {
          const g = treeData.groups[gid]
          if (!g) continue
          const [gx, gy] = treeToScreen(g.x, g.y, cam, W, H)
          const gs = bgInfo.w * zoom * 1.5
          ctx.globalAlpha = 0.22
          ctx.drawImage(bgImg, gx - gs / 2, gy - gs / 2, gs, gs)
          ctx.globalAlpha = 1
        }
      }
    }

    // ---- Orbit ring guidelines ----

    const nodes = treeData.nodes



    const nodeList: [string, TreeNode][] = []



    const nodeScreenCache = new Map<string, [number, number]>()







    for (const [id, node] of Object.entries(nodes)) {



      // Skip decorative OnlyImage nodes



      if (node.type === 'OnlyImage') continue







      const [sx, sy] = treeToScreen(node.x, node.y, cam, W, H)



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

      if (allocatedNodes.has(node.id)) {

        allocPerOrbit.set(node.orbit, (allocPerOrbit.get(node.orbit) ?? 0) + 1)

      }

    }

    for (const [id, node] of nodeList) {

      if (!orbitSpriteNodes.includes(node.type)) continue

      const [sx, sy] = nodeScreenCache.get(id)!

      const state = getOrbitState(node.orbit, allocPerOrbit)

      const r = NODE_RADIUS[node.type] ?? 9

      drawOrbitSprite(ctx, node.orbit, state, sx, sy, 0, r, zoom)

    }



      // ---- 1. Connection Lines (8.1.1: 3-layer glow) ----

    const drawnEdges = new Set<string>()

    for (const [id, node] of nodeList) {

      const [sx1, sy1] = nodeScreenCache.get(id)!

      const connections = node.connections?.length

        ? node.connections

        : node.out.map((outId) => ({ id: outId, orbit: 0 }))



      for (const connection of connections) {

        const outId = connection.id

        const targetNode = nodes[outId]

        if (!targetNode || targetNode.type === 'OnlyImage') continue

        if (node.ascendancyName !== targetNode.ascendancyName) continue

        if (node.classesStart || targetNode.classesStart) continue



        // Dedupe

        const edgeKey = id < outId ? `${id}-${outId}` : `${outId}-${id}`

        if (drawnEdges.has(edgeKey)) continue

        drawnEdges.add(edgeKey)



        const toPos = nodeScreenCache.get(outId)

        if (!toPos) continue

        const [sx2, sy2] = toPos

        const orbit = connection.orbit || 0



        // Stroke path helper

        const strokePath = () => {

          ctx.beginPath()

          ctx.moveTo(sx1, sy1)

          if (orbit !== 0 && treeData.constants.orbitRadii[Math.abs(orbit)]) {

            drawArcConnector(ctx, sx1, sy1, sx2, sy2, treeData.constants.orbitRadii[Math.abs(orbit)] * zoom, orbit > 0 ? 1 : -1)

          } else if (node.group === targetNode.group && node.orbit === targetNode.orbit) {

            const group = treeData.groups[node.group]

            if (group) {

              const [cx, cy] = treeToScreen(group.x, group.y, cam, W, H)

              const radius = Math.hypot(sx1 - cx, sy1 - cy)

              const a1 = Math.atan2(sy1 - cy, sx1 - cx)

              const a2 = Math.atan2(sy2 - cy, sx2 - cx)

              drawCircleArc(ctx, cx, cy, radius, a1, a2)

            }

          } else {

            ctx.lineTo(sx2, sy2)

          }

        }



        ctx.setLineDash([])



        // Layer 1: wide outer glow (dim)

        ctx.globalAlpha = 0.06

        ctx.strokeStyle = CONNECTION_COLOR

        ctx.lineWidth = CONNECTION_WIDTH * 5

        strokePath()

        ctx.stroke()



        // Layer 2: mid glow (semi)

        ctx.globalAlpha = 0.15

        ctx.lineWidth = CONNECTION_WIDTH * 2.5

        strokePath()

        ctx.stroke()



        // Layer 3: bright core

        ctx.globalAlpha = 1

        ctx.strokeStyle = '#556'

        ctx.lineWidth = CONNECTION_WIDTH

        strokePath()

        ctx.stroke()

      }

    }

    ctx.globalAlpha = 1

    // ---- 15.11: Connector texture overlay ----
    if (connectorsReady) {
      const connEdges = new Set<string>()
      for (const [id, node] of nodeList) {
        const [sx1, sy1] = nodeScreenCache.get(id)!
        const connections = node.connections?.length
          ? node.connections
          : node.out.map((outId) => ({ id: outId, orbit: 0 }))

        for (const connection of connections) {
          const outId = connection.id
          const targetNode = nodes[outId]
          if (!targetNode || targetNode.type === 'OnlyImage') continue
          if (node.ascendancyName !== targetNode.ascendancyName) continue
          if (node.classesStart || targetNode.classesStart) continue

          const edgeKey = id < outId ? `${id}-${outId}` : `${outId}-${id}`
          if (connEdges.has(edgeKey)) continue
          connEdges.add(edgeKey)

          const toPos = nodeScreenCache.get(outId)
          if (!toPos) continue
          const [sx2, sy2] = toPos
          const orbit = connection.orbit || 0
          const isAsc = !!node.ascendancyName

          const state = getConnectorState(
            allocatedNodes.has(id),
            allocatedNodes.has(outId),
          )

          if (orbit === 0 || (node.group === targetNode.group && node.orbit === targetNode.orbit)) {
            const img = resolveConnectorTexture(isAsc, 0, state)
            if (img) {
              ctx.globalAlpha = 0.5
              drawLineConnectorTexture(ctx, img, sx1, sy1, sx2, sy2, CONNECTION_WIDTH * 8)
              ctx.globalAlpha = 1
            }
          } else {
            const img = resolveConnectorTexture(isAsc, Math.abs(orbit), state)
            if (img) {
              const group = treeData.groups[node.group]
              if (group) {
                const [cx, cy] = treeToScreen(group.x, group.y, cam, W, H)
                const rad = treeData.constants.orbitRadii[Math.abs(orbit)] ?? 0
                ctx.globalAlpha = 0.5
                drawArcConnectorTexture(ctx, img, cx, cy, rad * zoom)
                ctx.globalAlpha = 1
              }
            }
          }
        }
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



      const isAllocated = allocatedNodes.has(id)



      const isAvailable = !isAllocated && availableNodes.has(id)



      const r = NODE_RADIUS[node.type] ?? 6

      const sr = r * zoom



      const color = isAllocated ? '#4A9EFF' : (NODE_COLOR[node.type] ?? '#888')

      const baseColor = color







            // 8.2.5: Ring frame behind Notable/Keystone nodes

      if (['Notable', 'Keystone'].includes(node.type)) {

        drawRingFrame(ctx, sx, sy, r, zoom, node.type === 'Keystone')

      }



      // --- Layer 1: activeEffectImage (glow texture under node) ---
      if (ddsReady && spriteLoader.isAvailable() && node.activeEffectImage) {
        const effInfo = spriteLoader.getByIconPath(node.activeEffectImage)
        if (effInfo) {
          const effImg = imageCache.current.get(effInfo.file)
          if (effImg) {
            const effSize = sr * 2.8
            const alpha = isAllocated ? 1.0 : 0.15
            ctx.globalAlpha = alpha
            ctx.drawImage(effImg, sx - effSize / 2, sy - effSize / 2, effSize, effSize)
            ctx.globalAlpha = 1
          } else {
            spriteLoader.getImage(effInfo).then((loaded) => {
              if (loaded) imageCache.current.set(effInfo.file, loaded)
            })
          }
        }
      }

      // Check if DDS sprite is available for this node
      let ddsIcon: HTMLImageElement | null = null
      let ddsFrame: HTMLImageElement | null = null
      if (ddsReady && spriteLoader.isAvailable()) {
        if (node.icon) {
          const info = spriteLoader.getByIconPath(node.icon)
          if (info) {
            ddsIcon = imageCache.current.get(info.file) || null
            if (!ddsIcon) spriteLoader.getImage(info).then((l) => { if (l) imageCache.current.set(info.file, l) })
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
              ddsFrame = imageCache.current.get(fi.file) || null
              if (!ddsFrame) spriteLoader.getImage(fi).then((l) => { if (l) imageCache.current.set(fi.file, l) })
            }
          }
        }
      }
      const hasDds = !!(ddsIcon || ddsFrame)

      if (hasDds) {
        // DDS-first: draw icon with LessLuminance for unalloc
        if (!isAllocated && !isHovered && !isSelected) {
          ctx.globalAlpha = 0.35
        }
        if (ddsIcon) {
          const iconSize = Math.max(sr * 1.6, 12)
          ctx.drawImage(ddsIcon, sx - iconSize / 2, sy - iconSize / 2, iconSize, iconSize)
        }
        ctx.globalAlpha = 1
        if (ddsFrame) {
          const frameSize = sr * 2.4
          ctx.drawImage(ddsFrame, sx - frameSize / 2, sy - frameSize / 2, frameSize, frameSize)
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

    rafRef.current = requestAnimationFrame(render)



  }, [treeData, offsetX, offsetY, zoom, hoveredNodeId, selectedNodeId, allocatedNodes, availableNodes, searchMatchIds, selectedClassId, ddsReady])







    // ---- Start/Stop Render Loop ----

  useEffect(() => {



    if (!treeData) return



    rafRef.current = requestAnimationFrame(render)



    return () => cancelAnimationFrame(rafRef.current)



  }, [treeData, render])







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



      if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0)



    }



    resize()



    window.addEventListener('resize', resize)



    return () => window.removeEventListener('resize', resize)



  }, [])







    // ---- Mouse Zoom/Pan ----

  const handleWheel = useCallback(



    (e: React.WheelEvent) => {



      e.preventDefault()



      const rect = canvasRef.current?.getBoundingClientRect()



      if (!rect) return



      const cx = e.clientX - rect.left



      const cy = e.clientY - rect.top



      const factor = e.deltaY < 0 ? 1.15 : 0.87



      zoomAt(cx, cy, factor)



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







      let closest: string | null = null



      let closestDist = 30 / zoom



      for (const [id, node] of Object.entries(treeData.nodes)) {



        const dx = node.x - tx



        const dy = node.y - ty



        const dist = Math.sqrt(dx * dx + dy * dy)



        if (dist < closestDist) {



          closestDist = dist



          closest = id



        }



      }



      setHoveredNode(closest)



    },



    [panBy, offsetX, offsetY, zoom, treeData, setHoveredNode, setMousePos],



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



                // Click on available or allocated node to toggle

      if (hoveredNodeId && (availableNodes.has(hoveredNodeId) || allocatedNodes.has(hoveredNodeId))) {



        toggleNode(hoveredNodeId)



      }



      // Always show sidebar for any clicked node



      setSelectedNode(hoveredNodeId)



    },



    [hoveredNodeId, setSelectedNode, availableNodes, allocatedNodes, toggleNode],



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




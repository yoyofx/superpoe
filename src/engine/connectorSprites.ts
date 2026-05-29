/**
 * connectorSprites.ts
 * Loads and renders connector line textures for the passive tree.
 *
 * Connector textures are pre-rendered PNG files:
 *   - LineConnector (orbit 0): 1435x29 thin strip, tiled horizontally
 *   - Arc connectors (orbit 1-9): square arc textures (91 to 1333 px)
 *
 * Naming: {prefix}_orbit_{state}{orbit}.png
 *   Prefixes: Character, CharacterAscendancy, CharacterPlanned
 *   States: normal, intermediate, intermediateactive
 *   Orbits: 0-9
 *
 * Original PoB2 uses DrawImageQuad to map these onto connector quads.
 * For Canvas 2D we use drawImage with appropriate transforms.
 */

import { drawImageMipped, getMippedImage, prepareMipmaps } from './imageMipmaps'

const FALLBACK_VERSION = '0_4'

type ConnectorState = 'normal' | 'intermediate' | 'intermediateactive'
export type ConnectorRenderState = 'Normal' | 'Intermediate' | 'Active'
type ConnectorPrefix = 'Character' | 'CharacterAscendancy' | 'CharacterPlanned'

export interface ConnectorTextureKey {
  prefix: ConnectorPrefix
  orbit: number
  state: ConnectorState
}

const imageCache = new Map<string, HTMLImageElement>()
const resolvedUrlCache = new Map<string, string>()

function loadImage(src: string): Promise<HTMLImageElement> {
  const cached = imageCache.get(src)
  if (cached) return Promise.resolve(cached)
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      imageCache.set(src, img)
      prepareMipmaps(img)
      resolve(img)
    }
    img.onerror = reject
    img.src = src
  })
}

function getFilename(key: ConnectorTextureKey): string {
  return `${key.prefix}_orbit_${key.state}${key.orbit}.png`
}

function keyToUrl(version: string, key: ConnectorTextureKey): string {
  return `/assets/connectors/${version}/${getFilename(key)}`
}

async function loadImageWithFallback(primary: string, fallback: string): Promise<HTMLImageElement> {
  try {
    const img = await loadImage(primary)
    resolvedUrlCache.set(primary, primary)
    return img
  } catch {
    const img = await loadImage(fallback)
    resolvedUrlCache.set(primary, fallback)
    return img
  }
}

/**
 * Preload all connector textures for a given prefix.
 */
export async function preloadConnectors(
  version: string = FALLBACK_VERSION,
  prefix: ConnectorPrefix = 'Character'
): Promise<Map<string, HTMLImageElement>> {
  const states: ConnectorState[] = ['normal', 'intermediate', 'intermediateactive']
  const map = new Map<string, HTMLImageElement>()

  const promises: Promise<void>[] = []
  for (let orbit = 0; orbit <= 9; orbit++) {
    for (const state of states) {
      const key: ConnectorTextureKey = { prefix, orbit, state }
      const filename = getFilename(key)
      const primary = keyToUrl(version, key)
      const fallback = keyToUrl(FALLBACK_VERSION, key)
      promises.push(
        loadImageWithFallback(primary, fallback).then((img) => {
          map.set(filename, img)
        }).catch(() => {
          // ignore missing
        })
      )
    }
  }

  await Promise.all(promises)
  return map
}

/**
 * Draw a connector strip texture along a straight line from (x1,y1) to (x2,y2).
 */
export function drawLineConnectorTexture(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  x1: number, y1: number,
  x2: number, y2: number,
  lineWidth: number,
): void {
  const dx = x2 - x1
  const dy = y2 - y1
  const dist = Math.hypot(dx, dy)
  if (dist < 1) return

  const angle = Math.atan2(dy, dx)

  ctx.save()
  ctx.translate(x1, y1)
  ctx.rotate(angle)

  const texW = img.width
  const texH = img.height

  if (dist <= texW) {
    // Single draw, stretch to fit
    ctx.drawImage(img, 0, -lineWidth / 2, dist, lineWidth)
  } else {
    // Tile the texture horizontally
    const pattern = ctx.createPattern(img, 'repeat-x')
    if (pattern) {
      ctx.fillStyle = pattern
      ctx.fillRect(0, -lineWidth / 2, dist, lineWidth)
    } else {
      ctx.drawImage(img, 0, -lineWidth / 2, dist, lineWidth)
    }
  }

  ctx.restore()
}

export function drawConnectorQuadTexture(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  points: [number, number][],
  texCoords?: number[],
): void {
  if (points.length !== 4) return
  const targetWidth = Math.max(
    Math.hypot(points[1][0] - points[0][0], points[1][1] - points[0][1]),
    Math.hypot(points[2][0] - points[3][0], points[2][1] - points[3][1]),
  )
  const targetHeight = Math.max(
    Math.hypot(points[3][0] - points[0][0], points[3][1] - points[0][1]),
    Math.hypot(points[2][0] - points[1][0], points[2][1] - points[1][1]),
  )
  const mip = getMippedImage(img, targetWidth, targetHeight)
  const mipImage = mip.image
  const srcWidth = img.width * mip.scale
  const srcHeight = img.height * mip.scale

  if (texCoords?.length === 8) {
    const uv: [number, number][] = [
      [texCoords[0] * srcWidth, texCoords[1] * srcHeight],
      [texCoords[2] * srcWidth, texCoords[3] * srcHeight],
      [texCoords[4] * srcWidth, texCoords[5] * srcHeight],
      [texCoords[6] * srcWidth, texCoords[7] * srcHeight],
    ]
    drawTexturedTriangle(ctx, mipImage, [points[0], points[1], points[2]], [uv[0], uv[1], uv[2]])
    drawTexturedTriangle(ctx, mipImage, [points[0], points[2], points[3]], [uv[0], uv[2], uv[3]])
    return
  }

  const [[x1, y1], [x2, y2], , [x4, y4]] = points
  ctx.save()
  ctx.beginPath()
  ctx.moveTo(points[0][0], points[0][1])
  ctx.lineTo(points[1][0], points[1][1])
  ctx.lineTo(points[2][0], points[2][1])
  ctx.lineTo(points[3][0], points[3][1])
  ctx.closePath()
  ctx.clip()
  ctx.transform((x2 - x1) / srcWidth, (y2 - y1) / srcWidth, (x4 - x1) / srcHeight, (y4 - y1) / srcHeight, x1, y1)
  ctx.drawImage(mipImage, 0, 0)
  ctx.restore()
}

function drawTexturedTriangle(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement | HTMLCanvasElement | OffscreenCanvas,
  dst: [[number, number], [number, number], [number, number]],
  src: [[number, number], [number, number], [number, number]],
): void {
  const [[x0, y0], [x1, y1], [x2, y2]] = dst
  const [[u0, v0], [u1, v1], [u2, v2]] = src
  const denom = u0 * (v1 - v2) + u1 * (v2 - v0) + u2 * (v0 - v1)
  if (Math.abs(denom) < 0.0001) return

  const a = (x0 * (v1 - v2) + x1 * (v2 - v0) + x2 * (v0 - v1)) / denom
  const c = (x0 * (u2 - u1) + x1 * (u0 - u2) + x2 * (u1 - u0)) / denom
  const e = (
    x0 * (u1 * v2 - u2 * v1) +
    x1 * (u2 * v0 - u0 * v2) +
    x2 * (u0 * v1 - u1 * v0)
  ) / denom
  const b = (y0 * (v1 - v2) + y1 * (v2 - v0) + y2 * (v0 - v1)) / denom
  const d = (y0 * (u2 - u1) + y1 * (u0 - u2) + y2 * (u1 - u0)) / denom
  const f = (
    y0 * (u1 * v2 - u2 * v1) +
    y1 * (u2 * v0 - u0 * v2) +
    y2 * (u0 * v1 - u1 * v0)
  ) / denom

  ctx.save()
  ctx.beginPath()
  const [ex0, ey0] = expandTrianglePoint(dst[0], dst)
  const [ex1, ey1] = expandTrianglePoint(dst[1], dst)
  const [ex2, ey2] = expandTrianglePoint(dst[2], dst)
  ctx.moveTo(ex0, ey0)
  ctx.lineTo(ex1, ey1)
  ctx.lineTo(ex2, ey2)
  ctx.closePath()
  ctx.clip()
  ctx.transform(a, b, c, d, e, f)
  ctx.drawImage(img, 0, 0)
  ctx.restore()
}

function expandTrianglePoint(
  point: [number, number],
  triangle: [[number, number], [number, number], [number, number]],
): [number, number] {
  const cx = (triangle[0][0] + triangle[1][0] + triangle[2][0]) / 3
  const cy = (triangle[0][1] + triangle[1][1] + triangle[2][1]) / 3
  const dx = point[0] - cx
  const dy = point[1] - cy
  const len = Math.hypot(dx, dy)
  if (!len) return point
  const overlap = 0.35
  return [point[0] + (dx / len) * overlap, point[1] + (dy / len) * overlap]
}

/**
 * Draw an arc connector texture centered on the orbit group.
 */
export function drawArcConnectorTexture(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  groupCenterX: number, groupCenterY: number,
  orbitRadius: number,
): void {
  const size = orbitRadius * 2
  const halfSize = size / 2

  drawImageMipped(
    ctx,
    img,
    groupCenterX - halfSize,
    groupCenterY - halfSize,
    size,
    size,
  )
}

export function getConnectorImage(version: string, key: ConnectorTextureKey): HTMLImageElement | undefined {
  const primary = keyToUrl(version, key)
  const src = resolvedUrlCache.get(primary) || primary
  return imageCache.get(src)
}

export function getConnectorState(
  node1Allocated: boolean,
  node2Allocated: boolean,
): ConnectorRenderState {
  if (node1Allocated && node2Allocated) return 'Active'
  if (node1Allocated || node2Allocated) return 'Intermediate'
  return 'Normal'
}

export function resolveConnectorTexture(
  version: string,
  connectionArt: string | boolean,
  type: string | number,
  state: ConnectorRenderState,
): HTMLImageElement | undefined {
  const prefix: ConnectorPrefix = typeof connectionArt === 'string'
    ? normalizePrefix(connectionArt)
    : connectionArt ? 'CharacterAscendancy' : 'Character'
  const orbit = typeof type === 'number' ? type : parseConnectorOrbit(type)
  return getConnectorImage(version, { prefix, orbit, state: mapState(state) })
}

function normalizePrefix(value: string): ConnectorPrefix {
  if (value === 'CharacterAscendancy' || value === 'CharacterPlanned') return value
  return 'Character'
}

function parseConnectorOrbit(type: string): number {
  if (type === 'LineConnector') return 0
  const match = /^Orbit(\d+)$/.exec(type)
  const orbit = match ? Number(match[1]) : 0
  if (orbit === 1) return 9
  if (orbit === 2) return 8
  if (orbit === 3) return 6
  if (orbit === 4) return 5
  if (orbit === 5) return 4
  if (orbit === 6) return 3
  if (orbit === 7) return 7
  if (orbit === 8) return 2
  if (orbit === 9) return 1
  return orbit
}

function mapState(state: ConnectorRenderState): ConnectorState {
  if (state === 'Active') return 'intermediateactive'
  if (state === 'Intermediate') return 'intermediate'
  return 'normal'
}

/**
 * Orbit ring sprite loader and cache.
 *
 * Orbit PNGs are thin horizontal strips used as ring textures behind nodes.
 * Assets are loaded by tree version and fall back to 0_4 when a newer version
 * has not generated a complete resource set yet.
 */

import { drawImageMipped, drawImageMippedSource, prepareMipmaps } from './imageMipmaps'

const ORBIT_COUNT = 10
const FALLBACK_VERSION = '0_4'

type OrbitState = 'normal' | 'intermediate' | 'intermediateactive'

const imageCache = new Map<string, HTMLImageElement>()
const resolvedUrlCache = new Map<string, string>()

function getOrbitUrl(version: string, state: OrbitState, orbitIndex: number): string {
  return `/assets/orbit/${version}/Character_orbit_${state}${orbitIndex}.png`
}

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
    img.onerror = () => reject(new Error(`Failed to load: ${src}`))
    img.src = src
  })
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

const RING_KEYS = [
  '/assets/ui/ring.png',
  '/assets/ui/small_ring.png',
]

async function preloadRingSprites(): Promise<HTMLImageElement[]> {
  return Promise.all(RING_KEYS.map(loadImage))
}

export function drawRingFrame(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  nodeRadius: number,
  zoom: number,
  useSmall: boolean = false,
): void {
  const key = useSmall ? RING_KEYS[1] : RING_KEYS[0]
  const img = imageCache.get(key)
  if (!img) return

  const size = nodeRadius * 3.5 * zoom
  drawImageMipped(ctx, img, sx - size / 2, sy - size / 2, size, size)
}

export async function preloadOrbitSprites(
  version: string = FALLBACK_VERSION,
  states: OrbitState[] = ['normal', 'intermediate', 'intermediateactive'],
): Promise<void> {
  const promises: Promise<HTMLImageElement>[] = []

  for (let i = 0; i < ORBIT_COUNT; i++) {
    for (const state of states) {
      const primary = getOrbitUrl(version, state, i)
      const fallback = getOrbitUrl(FALLBACK_VERSION, state, i)
      promises.push(loadImageWithFallback(primary, fallback))
    }
  }

  await Promise.all(promises)
  await preloadRingSprites().catch(() => {})
}

export function getOrbitSprite(
  version: string = FALLBACK_VERSION,
  orbitIndex: number,
  state: OrbitState = 'normal',
): HTMLImageElement | undefined {
  const primary = getOrbitUrl(version, state, orbitIndex)
  const src = resolvedUrlCache.get(primary) || primary
  return imageCache.get(src)
}

export function getOrbitState(
  orbitIndex: number,
  allocatedPerOrbit: Map<number, number>,
): OrbitState {
  const count = allocatedPerOrbit.get(orbitIndex) ?? 0
  if (count > 2) return 'intermediateactive'
  if (count > 0) return 'intermediate'
  return 'normal'
}

export function drawOrbitSprite(
  ctx: CanvasRenderingContext2D,
  version: string,
  orbitIndex: number,
  state: OrbitState,
  sx: number,
  sy: number,
  angle: number,
  nodeRadius: number,
  zoom: number,
): void {
  const img = getOrbitSprite(version, orbitIndex, state)
  if (!img) return

  const segWidth = nodeRadius * 5 * zoom
  const segHeight = nodeRadius * 1.5 * zoom
  const srcX = img.width / 2 - segWidth / zoom / 2

  ctx.save()
  ctx.translate(sx, sy)
  ctx.rotate(angle)
  drawImageMippedSource(
    ctx,
    img,
    srcX,
    0,
    segWidth / zoom,
    img.height,
    -segWidth / 2,
    -segHeight / 2,
    segWidth,
    segHeight,
  )
  ctx.restore()
}

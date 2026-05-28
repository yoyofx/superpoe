/**
 * orbitSprites.ts - Orbit ring sprite loader & cache (Phase 8.2.2)
 *
 * Orbit PNGs are thin horizontal strips (1435×29) representing ring textures.
 * Three states per orbit (0-9): normal, intermediate, intermediateactive.
 */

const ORBIT_COUNT = 10
const SPRITE_BASE = '/assets/orbit/0_4/Character_orbit'

type OrbitState = 'normal' | 'intermediate' | 'intermediateactive'

const imageCache = new Map<string, HTMLImageElement>()

/** Load a single image, caching results */
function loadImage(src: string): Promise<HTMLImageElement> {
  const cached = imageCache.get(src)
  if (cached) return Promise.resolve(cached)

  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      imageCache.set(src, img)
      resolve(img)
    }
    img.onerror = () => reject(new Error(`Failed to load: ${src}`))
    img.src = src
  })
}

// ---- 8.2.5: Node frame sprites (ring.png) ----
const RING_KEYS = [
  '/assets/ui/ring.png',
  '/assets/ui/small_ring.png',
]

/** Preload node frame ring sprites */
async function preloadRingSprites(): Promise<HTMLImageElement[]> {
  return Promise.all(RING_KEYS.map(loadImage))
}

/** Draw a ring frame behind a node */
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
  ctx.drawImage(img, sx - size / 2, sy - size / 2, size, size)
}

/** Preload all orbit sprites for the given states */
export async function preloadOrbitSprites(
  states: OrbitState[] = ['normal', 'intermediate', 'intermediateactive'],
): Promise<void> {
  const promises: Promise<HTMLImageElement>[] = []
  for (let i = 0; i < ORBIT_COUNT; i++) {
    for (const state of states) {
      const src = `${SPRITE_BASE}_${state}${i}.png`
      promises.push(loadImage(src))
    }
  }
  await Promise.all(promises)
  // Also preload ring frames
  await preloadRingSprites().catch(() => {})
}

/** Get a cached orbit sprite image */
export function getOrbitSprite(
  orbitIndex: number,
  state: OrbitState = 'normal',
): HTMLImageElement | undefined {
  const src = `${SPRITE_BASE}_${state}${orbitIndex}.png`
  return imageCache.get(src)
}

/** Determine orbit state based on allocation count for this orbit */
export function getOrbitState(
  orbitIndex: number,
  allocatedPerOrbit: Map<number, number>,
): OrbitState {
  const count = allocatedPerOrbit.get(orbitIndex) ?? 0
  if (count > 2) return 'intermediateactive'
  if (count > 0) return 'intermediate'
  return 'normal'
}

/** Draw orbit sprite segment at a node position. Rotates segment to match node's angular position. */
export function drawOrbitSprite(
  ctx: CanvasRenderingContext2D,
  orbitIndex: number,
  state: OrbitState,
  sx: number,
  sy: number,
  angle: number,
  nodeRadius: number,
  zoom: number,
): void {
  const img = getOrbitSprite(orbitIndex, state)
  if (!img) return

  const segWidth = nodeRadius * 5 * zoom   // width of the strip segment to draw
  const segHeight = nodeRadius * 1.5 * zoom // height of the strip segment
  const srcX = img.width / 2 - segWidth / zoom / 2  // center of strip

  ctx.save()
  ctx.translate(sx, sy)
  ctx.rotate(angle)

  ctx.drawImage(
    img,
    srcX, 0,                           // source: center portion of the strip
    segWidth / zoom, img.height,       // source dimensions
    -segWidth / 2, -segHeight / 2,     // destination: centered on node
    segWidth, segHeight,
  )
  ctx.restore()
}

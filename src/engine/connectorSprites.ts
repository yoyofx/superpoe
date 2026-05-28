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

const BASE = '/assets/connectors/0_4'

type ConnectorState = 'normal' | 'intermediate' | 'intermediateactive'
type ConnectorPrefix = 'Character' | 'CharacterAscendancy' | 'CharacterPlanned'

export interface ConnectorTextureKey {
  prefix: ConnectorPrefix
  orbit: number
  state: ConnectorState
}

const imageCache = new Map<string, HTMLImageElement>()

function loadImage(src: string): Promise<HTMLImageElement> {
  const cached = imageCache.get(src)
  if (cached) return Promise.resolve(cached)
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      imageCache.set(src, img)
      resolve(img)
    }
    img.onerror = reject
    img.src = src
  })
}

function getFilename(key: ConnectorTextureKey): string {
  return `${key.prefix}_orbit_${key.state}${key.orbit}.png`
}

/**
 * Preload all connector textures for a given prefix.
 */
export async function preloadConnectors(
  prefix: ConnectorPrefix = 'Character'
): Promise<Map<string, HTMLImageElement>> {
  const states: ConnectorState[] = ['normal', 'intermediate', 'intermediateactive']
  const map = new Map<string, HTMLImageElement>()

  const promises: Promise<void>[] = []
  for (let orbit = 0; orbit <= 9; orbit++) {
    for (const state of states) {
      const key: ConnectorTextureKey = { prefix, orbit, state }
      const filename = getFilename(key)
      const url = `${BASE}/${filename}`
      promises.push(
        loadImage(url).then((img) => {
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

  ctx.drawImage(
    img,
    groupCenterX - halfSize,
    groupCenterY - halfSize,
    size,
    size,
  )
}

export function getConnectorImage(key: ConnectorTextureKey): HTMLImageElement | undefined {
  const filename = getFilename(key)
  return imageCache.get(filename)
}

export function getConnectorState(
  node1Allocated: boolean,
  node2Allocated: boolean,
): ConnectorState {
  if (node1Allocated && node2Allocated) return 'intermediateactive'
  if (node1Allocated || node2Allocated) return 'intermediate'
  return 'normal'
}

export function resolveConnectorTexture(
  ascendancy: boolean,
  orbit: number,
  state: ConnectorState,
): HTMLImageElement | undefined {
  const prefix: ConnectorPrefix = ascendancy ? 'CharacterAscendancy' : 'Character'
  return getConnectorImage({ prefix, orbit, state })
}

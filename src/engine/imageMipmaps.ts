type MipSource = HTMLImageElement | HTMLCanvasElement | OffscreenCanvas

interface MipLevel {
  image: MipSource
  scale: number
  width: number
  height: number
}

export interface MippedImage {
  image: MipSource
  scale: number
}

const mipCache = new WeakMap<MipSource, MipLevel[]>()

function imageSize(image: MipSource): { width: number; height: number } {
  if (image instanceof HTMLImageElement) {
    return {
      width: image.naturalWidth || image.width,
      height: image.naturalHeight || image.height,
    }
  }
  return {
    width: Number(image.width) || 0,
    height: Number(image.height) || 0,
  }
}

function createCanvas(width: number, height: number): HTMLCanvasElement | OffscreenCanvas {
  if (typeof OffscreenCanvas !== 'undefined') {
    return new OffscreenCanvas(width, height)
  }
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  return canvas
}

function getContext(canvas: HTMLCanvasElement | OffscreenCanvas): CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null {
  const ctx = canvas.getContext('2d')
  if (ctx) {
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
  }
  return ctx
}

function buildMipLevels(image: MipSource): MipLevel[] {
  const { width, height } = imageSize(image)
  if (!width || !height) return []

  const levels: MipLevel[] = [{
    image: image as MipSource,
    scale: 1,
    width,
    height,
  }]

  let previous = image
  let previousWidth = width
  let previousHeight = height
  let scale = 1

  while (previousWidth > 32 && previousHeight > 32 && levels.length < 8) {
    const nextWidth = Math.max(1, Math.floor(previousWidth / 2))
    const nextHeight = Math.max(1, Math.floor(previousHeight / 2))
    const canvas = createCanvas(nextWidth, nextHeight)
    const ctx = getContext(canvas)
    if (!ctx) break

    ctx.clearRect(0, 0, nextWidth, nextHeight)
    ctx.drawImage(previous, 0, 0, previousWidth, previousHeight, 0, 0, nextWidth, nextHeight)

    scale /= 2
    levels.push({
      image: canvas,
      scale,
      width: nextWidth,
      height: nextHeight,
    })

    previous = canvas
    previousWidth = nextWidth
    previousHeight = nextHeight
  }

  return levels
}

function getMipLevels(image: MipSource): MipLevel[] {
  const cached = mipCache.get(image)
  if (cached) return cached
  const levels = buildMipLevels(image)
  mipCache.set(image, levels)
  return levels
}

export function applyCanvasImageQuality(ctx: CanvasRenderingContext2D): void {
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
}

export function getMippedImage(
  image: MipSource,
  targetWidth: number,
  targetHeight: number,
): MippedImage {
  const { width, height } = imageSize(image)
  return getMippedImageForSource(image, width, height, targetWidth, targetHeight)
}

export function getMippedImageForSource(
  image: MipSource,
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number,
): MippedImage {
  const levels = getMipLevels(image)
  if (!levels.length) return { image, scale: 1 }

  const original = levels[0]
  const scaleX = Math.abs(targetWidth) / sourceWidth
  const scaleY = Math.abs(targetHeight) / sourceHeight
  const targetScale = Math.max(scaleX || 1, scaleY || 1)

  let selected = original
  for (const level of levels) {
    if (level.scale >= targetScale || level.width <= 32 || level.height <= 32) {
      selected = level
    } else {
      break
    }
  }

  return { image: selected.image, scale: selected.scale }
}

export function drawImageMipped(
  ctx: CanvasRenderingContext2D,
  image: MipSource,
  dx: number,
  dy: number,
  dw: number,
  dh: number,
): void {
  const mip = getMippedImage(image, dw, dh)
  ctx.drawImage(mip.image, dx, dy, dw, dh)
}

export function drawImageMippedSource(
  ctx: CanvasRenderingContext2D,
  image: MipSource,
  sx: number,
  sy: number,
  sw: number,
  sh: number,
  dx: number,
  dy: number,
  dw: number,
  dh: number,
): void {
  const mip = getMippedImageForSource(image, sw, sh, dw, dh)
  const scale = mip.scale
  ctx.drawImage(
    mip.image,
    sx * scale,
    sy * scale,
    sw * scale,
    sh * scale,
    dx,
    dy,
    dw,
    dh,
  )
}

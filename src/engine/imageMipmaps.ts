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

const MIN_MIP_SIZE = 32

const MAX_MIP_LEVELS = 8

const MIP_SHARPNESS_BIAS = 1.25

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

function getContext(canvas: HTMLCanvasElement | OffscreenCanvas): CanvasRenderingContext2D | null {
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | null
  if (ctx) {
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
  }
  return ctx
}

function createBaseLevel(image: MipSource): MipLevel[] {
  const { width, height } = imageSize(image)
  if (!width || !height) return []

  return [{
    image: image as MipSource,
    scale: 1,
    width,
    height,
  }]
}

function appendMipLevel(levels: MipLevel[]): boolean {
  const previous = levels[levels.length - 1]
  if (!previous) return false
  if (previous.width <= MIN_MIP_SIZE || previous.height <= MIN_MIP_SIZE || levels.length >= MAX_MIP_LEVELS) {
    return false
  }

  const nextWidth = Math.max(1, Math.floor(previous.width / 2))
  const nextHeight = Math.max(1, Math.floor(previous.height / 2))
  const canvas = createCanvas(nextWidth, nextHeight)
  const ctx = getContext(canvas)
  if (!ctx) return false

  ctx.clearRect(0, 0, nextWidth, nextHeight)
  ctx.drawImage(previous.image, 0, 0, previous.width, previous.height, 0, 0, nextWidth, nextHeight)

  levels.push({
    image: canvas,
    scale: previous.scale / 2,
    width: nextWidth,
    height: nextHeight,
  })
  return true
}

function getMipLevels(image: MipSource): MipLevel[] {
  const cached = mipCache.get(image)
  if (cached) return cached
  const levels = createBaseLevel(image)
  mipCache.set(image, levels)
  return levels
}

function ensureMipScale(levels: MipLevel[], targetScale: number): void {
  while (levels.length) {
    const last = levels[levels.length - 1]
    if (last.scale <= targetScale || last.width <= MIN_MIP_SIZE || last.height <= MIN_MIP_SIZE) break
    if (!appendMipLevel(levels)) break
  }
}

export function prepareMipmaps(image: MipSource): void {
  const levels = getMipLevels(image)
  while (appendMipLevel(levels)) {
    // Build the capped chain during idle/preload paths, not in hot render loops.
  }
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
  const selectionScale = Math.min(1, targetScale * MIP_SHARPNESS_BIAS)
  ensureMipScale(levels, selectionScale)

  let selected = original
  for (const level of levels) {
    if (level.scale >= selectionScale || level.width <= MIN_MIP_SIZE || level.height <= MIN_MIP_SIZE) {
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

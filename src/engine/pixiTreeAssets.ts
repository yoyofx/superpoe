import { Assets, Rectangle, Texture } from 'pixi.js'
import type { SpriteInfo } from '@/engine/spriteLoader'

const FALLBACK_VERSION = '0_4'

type ConnectorState = 'normal' | 'intermediate' | 'intermediateactive'
type ConnectorRenderState = 'Normal' | 'Intermediate' | 'Active'
type ConnectorPrefix = 'Character' | 'CharacterAscendancy' | 'CharacterPlanned'
type TextureQuality = 'detail' | 'smooth'

const textureCache = new Map<string, Promise<Texture>>()
const loadedTextures = new Map<string, Texture>()
const spriteTextureCache = new Map<string, Texture>()
const orbitSegmentTextureCache = new Map<string, Texture>()
const resolvedConnectorUrl = new Map<string, string>()

function configureTextureQuality(texture: Texture, quality: TextureQuality): Texture {
  const source = texture.source
  source.autoGenerateMipmaps = true
  source.scaleMode = 'linear'
  source.minFilter = 'linear'
  source.magFilter = 'linear'
  source.mipmapFilter = quality === 'smooth' ? 'linear' : 'nearest'
  source.maxAnisotropy = 4
  source.update()
  return texture
}

function connectorStateName(state: ConnectorRenderState): ConnectorState {
  if (state === 'Active') return 'intermediateactive'
  if (state === 'Intermediate') return 'intermediate'
  return 'normal'
}

function normalizeConnectorPrefix(connectionArt: string | boolean): ConnectorPrefix {
  if (typeof connectionArt === 'string') {
    if (connectionArt.includes('Ascendancy')) return 'CharacterAscendancy'
    if (connectionArt.includes('Planned')) return 'CharacterPlanned'
  } else if (connectionArt) {
    return 'CharacterAscendancy'
  }
  return 'Character'
}

function connectorUrl(version: string, connectionArt: string | boolean, type: string, state: ConnectorRenderState): string {
  const prefix = normalizeConnectorPrefix(connectionArt)
  const suffix = String(parseConnectorOrbit(type))
  return `/assets/connectors/${version}/${prefix}_orbit_${connectorStateName(state)}${suffix}.png`
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

function orbitUrl(version: string, state: ConnectorState, orbitIndex: number): string {
  return `/assets/orbit/${version}/Character_orbit_${state}${orbitIndex}.png`
}

async function loadTextureWithFallback(
  primary: string,
  fallback?: string,
  quality: TextureQuality = 'detail',
): Promise<Texture> {
  const loaded = loadedTextures.get(primary)
  if (loaded) return loaded
  const cached = textureCache.get(primary)
  if (cached) return cached

  const promise = Assets.load<Texture>(primary)
    .catch(async () => {
      if (!fallback || fallback === primary) throw new Error(`Failed to load texture: ${primary}`)
      return Assets.load<Texture>(fallback)
    })
    .then((texture) => {
      configureTextureQuality(texture, quality)
      loadedTextures.set(primary, texture)
      return texture
    })
  textureCache.set(primary, promise)
  return promise
}

function requestTexture(
  primary: string,
  onReady?: () => void,
  fallback?: string,
  quality: TextureQuality = 'detail',
): Texture | null {
  const loaded = loadedTextures.get(primary)
  if (loaded) return loaded
  void loadTextureWithFallback(primary, fallback, quality)
    .then(() => onReady?.())
    .catch(() => undefined)
  return null
}

export async function getPixiTexture(url: string): Promise<Texture> {
  return loadTextureWithFallback(url, undefined, 'detail')
}

export async function getSpriteTexture(info: SpriteInfo): Promise<Texture> {
  const base = await getPixiTexture(`/${info.file}`)
  if (info.x == null || info.y == null) return base
  const cacheKey = `${info.file}:${info.x}:${info.y}:${info.w}:${info.h}`
  const cached = spriteTextureCache.get(cacheKey)
  if (cached) return cached
  const texture = new Texture({
    source: base.source,
    frame: new Rectangle(info.x, info.y, info.w, info.h),
  })
  spriteTextureCache.set(cacheKey, texture)
  return texture
}

export function requestPixiTexture(url: string, onReady?: () => void): Texture | null {
  return requestTexture(url, onReady, undefined, 'detail')
}

export function requestSpriteTexture(info: SpriteInfo, onReady?: () => void): Texture | null {
  const baseUrl = `/${info.file}`
  const base = requestTexture(baseUrl, onReady, undefined, 'detail')
  if (!base) return null
  if (info.x == null || info.y == null) return base

  const cacheKey = `${info.file}:${info.x}:${info.y}:${info.w}:${info.h}`
  const cached = spriteTextureCache.get(cacheKey)
  if (cached) return cached
  const texture = new Texture({
    source: base.source,
    frame: new Rectangle(info.x, info.y, info.w, info.h),
  })
  spriteTextureCache.set(cacheKey, texture)
  return texture
}

export function requestOrbitSegmentTexture(
  version: string,
  orbitIndex: number,
  state: ConnectorState,
  sourceWidth: number,
  onReady?: () => void,
): Texture | null {
  const primary = orbitUrl(version, state, orbitIndex)
  const fallback = orbitUrl(FALLBACK_VERSION, state, orbitIndex)
  const base = requestTexture(primary, onReady, fallback, 'smooth')
  if (!base) return null

  const clampedSourceWidth = Math.max(1, Math.min(sourceWidth, base.width))
  const srcX = Math.max(0, base.width / 2 - clampedSourceWidth / 2)
  const cacheKey = `${primary}:${state}:${orbitIndex}:${clampedSourceWidth}`
  const cached = orbitSegmentTextureCache.get(cacheKey)
  if (cached) return cached
  const texture = new Texture({
    source: base.source,
    frame: new Rectangle(srcX, 0, clampedSourceWidth, base.height),
  })
  orbitSegmentTextureCache.set(cacheKey, texture)
  return texture
}

export async function getConnectorTexture(
  version: string,
  connectionArt: string | boolean,
  type: string,
  state: ConnectorRenderState,
): Promise<Texture> {
  const primary = connectorUrl(version, connectionArt, type, state)
  const fallback = connectorUrl(FALLBACK_VERSION, connectionArt, type, state)
  const resolved = resolvedConnectorUrl.get(primary) || primary
  const texture = await loadTextureWithFallback(resolved, fallback, 'smooth')
  resolvedConnectorUrl.set(primary, resolved)
  return texture
}

export function requestConnectorTexture(
  version: string,
  connectionArt: string | boolean,
  type: string,
  state: ConnectorRenderState,
  onReady?: () => void,
): Texture | null {
  const primary = connectorUrl(version, connectionArt, type, state)
  const fallback = connectorUrl(FALLBACK_VERSION, connectionArt, type, state)
  return requestTexture(primary, onReady, fallback, 'smooth')
}

export async function preloadPixiConnectors(version: string): Promise<void> {
  const states: ConnectorRenderState[] = ['Normal', 'Intermediate', 'Active']
  const prefixes: ConnectorPrefix[] = ['Character', 'CharacterAscendancy', 'CharacterPlanned']
  const promises: Promise<Texture>[] = []
  for (const prefix of prefixes) {
    for (const state of states) {
      for (let orbit = 0; orbit <= 9; orbit += 1) {
        promises.push(getConnectorTexture(version, prefix, orbit === 0 ? 'LineConnector' : `Orbit${orbit}`, state))
      }
    }
  }
  await Promise.allSettled(promises)
}

export async function preloadPixiOrbits(version: string): Promise<void> {
  const states: ConnectorState[] = ['normal', 'intermediate', 'intermediateactive']
  const promises: Promise<Texture>[] = []
  for (const state of states) {
    for (let orbit = 0; orbit <= 9; orbit += 1) {
      promises.push(loadTextureWithFallback(orbitUrl(version, state, orbit), orbitUrl(FALLBACK_VERSION, state, orbit), 'smooth'))
    }
  }
  await Promise.allSettled(promises)
}

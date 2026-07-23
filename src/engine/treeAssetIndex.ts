import type { SpriteIndex } from '@/engine/spriteLoader'

const indexPromises = new Map<string, Promise<SpriteIndex>>()

export function loadTreeAssetIndex(version: string): Promise<SpriteIndex> {
  const normalizedVersion = version || '0_4'
  const cached = indexPromises.get(normalizedVersion)
  if (cached) return cached

  const promise = fetch(`/assets/dds/${normalizedVersion}/sprite-index.json`)
    .then((response) => {
      if (!response.ok) throw new Error(`Unable to load tree asset index for ${normalizedVersion}`)
      return response.json().then((value: unknown) => {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
        return Object.fromEntries(Object.entries(value).filter(([, info]) => {
          if (!info || typeof info !== 'object') return false
          const sprite = info as Partial<SpriteIndex[string]>
          return typeof sprite.file === 'string' && typeof sprite.w === 'number' && typeof sprite.h === 'number'
        })) as SpriteIndex
      })
    })
    .catch(() => ({}))
  indexPromises.set(normalizedVersion, promise)
  return promise
}

export function getTreeAssetUrl(index: SpriteIndex, assetName: string | undefined): string | null {
  if (!assetName) return null
  const file = index[assetName]?.file
  return file ? `/${file.replace(/^\/+/, '')}` : null
}

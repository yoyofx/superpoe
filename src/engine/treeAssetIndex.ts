import type { SpriteIndex } from '@/engine/spriteLoader'

const indexPromises = new Map<string, Promise<SpriteIndex>>()

export function loadTreeAssetIndex(version: string): Promise<SpriteIndex> {
  const normalizedVersion = version || '0_4'
  const cached = indexPromises.get(normalizedVersion)
  if (cached) return cached

  const promise = fetch(`/assets/dds/${normalizedVersion}/sprite-index.json`)
    .then((response) => {
      if (!response.ok) throw new Error(`Unable to load tree asset index for ${normalizedVersion}`)
      return response.json() as Promise<SpriteIndex>
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

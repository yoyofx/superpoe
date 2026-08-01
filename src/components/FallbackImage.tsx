import { useEffect, useState, type ImgHTMLAttributes, type ReactNode } from 'react'

interface FallbackImageProps extends ImgHTMLAttributes<HTMLImageElement> {
  fallback?: ReactNode
}

/** Keeps an indexed-but-missing optional image from becoming a broken image. */
export function FallbackImage({ src, fallback = null, onError, ...props }: FallbackImageProps) {
  const [failed, setFailed] = useState(false)

  useEffect(() => setFailed(false), [src])

  if (!src || failed) return <>{fallback}</>
  return <img
    {...props}
    src={src}
    onError={(event) => {
      setFailed(true)
      onError?.(event)
    }}
  />
}

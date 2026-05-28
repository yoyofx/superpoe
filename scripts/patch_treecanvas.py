import sys
sys.stdout.reconfigure(encoding='utf-8')

FPATH = r'E:\game\POB2\PoeCharm2-20251217\pob2\web\src\components\TreeCanvas.tsx'

with open(FPATH, 'rb') as f:
    raw = f.read()

# Decode as latin1 (lossless)
text = raw.decode('latin-1')

patches = 0

# 1: useState
old1 = "import { useRef, useEffect, useCallback } from 'react'"
new1 = "import { useRef, useEffect, useCallback, useState } from 'react'"
if old1 in text:
    text = text.replace(old1, new1)
    patches += 1
    print("OK: useState")
else:
    print("FAIL: useState not found")

# 2: spriteLoader import
old2 = "import type { TreeNode } from '@/types/tree'"
new2 = "import type { TreeNode } from '@/types/tree'\nimport { spriteLoader } from '@/engine/spriteLoader'"
if old2 in text:
    text = text.replace(old2, new2)
    patches += 1
    print("OK: spriteLoader import")
else:
    print("FAIL: spriteLoader import not found")

# 3: ddsReady state + cache
old3 = "const rafRef = useRef<number>(0)"
new3 = "const rafRef = useRef<number>(0)\n  const [ddsReady, setDdsReady] = useState(false)\n  const imageCache = useRef<Map<string, HTMLImageElement>>(new Map())"
if old3 in text:
    text = text.replace(old3, new3)
    patches += 1
    print("OK: ddsReady + imageCache")
else:
    print("FAIL: rafRef not found")

# 4: init useEffect
old4 = "preloadOrbitSprites().catch(console.warn)"
new4 = """preloadOrbitSprites().catch(console.warn)

  // Initialize DDS sprite loader
  useEffect(() => {
    spriteLoader.init().then(() => setDdsReady(true)).catch(console.warn)
  }, [])"""
if old4 in text:
    text = text.replace(old4, new4)
    patches += 1
    print("OK: init useEffect")
else:
    print("FAIL: preloadOrbitSprites not found")

# 5: DDS sprite overlay
old5 = "ctx.shadowColor = 'transparent'"
dds_overlay = """      // --- DDS Sprite Overlay ---
      if (ddsReady && spriteLoader.isAvailable() && node.icon) {
        const info = spriteLoader.getByIconPath(node.icon)
        if (info) {
          const img = imageCache.current.get(info.file)
          if (img) {
            const iconSize = Math.max(sr * 1.6, 12)
            ctx.drawImage(img, sx - iconSize / 2, sy - iconSize / 2, iconSize, iconSize)
          } else {
            spriteLoader.getImage(info).then((loaded: HTMLImageElement | null) => {
              if (loaded) imageCache.current.set(info.file, loaded)
            })
          }
        }
      }
      ctx.shadowColor = 'transparent'"""
if old5 in text:
    text = text.replace(old5, dds_overlay, 1)
    patches += 1
    print("OK: DDS overlay")
else:
    print("FAIL: shadowColor not found")

# Write back
out = text.encode('utf-8')
with open(FPATH, 'wb') as f:
    f.write(out)

print(f"Patches applied: {patches}/5, size: {len(out)} bytes")

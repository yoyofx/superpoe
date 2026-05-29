/**
 * Sprite Loader for DDS-generated WebP assets.
 * Loads sprite-index.json and provides asset lookup by name.
 */
export interface SpriteInfo {
  file: string;
  x?: number;
  y?: number;
  w: number;
  h: number;
}

export interface SpriteIndex {
  [assetName: string]: SpriteInfo;
}

class SpriteLoader {
  private index: SpriteIndex | null = null;
  private images: Map<string, HTMLImageElement> = new Map();
  private loaded = false;
  private loadPromise: Promise<void> | null = null;
  private readonly version: string;
  private readonly fallbackVersion: string;

  constructor(version: string = '0_4', fallbackVersion: string = '0_4') {
    this.version = version;
    this.fallbackVersion = fallbackVersion;
  }

  async init(): Promise<void> {
    if (this.loaded) return;
    if (this.loadPromise) return this.loadPromise;

    this.loadPromise = this._load();
    return this.loadPromise;
  }

  private async _load(): Promise<void> {
    const primary = await this.loadIndex(this.version);
    if (primary && Object.keys(primary).length > 0) {
      this.index = primary;
      console.log(`SpriteLoader(${this.version}): loaded index with ${Object.keys(primary).length} entries`);
    } else if (this.version !== this.fallbackVersion) {
      const fallback = await this.loadIndex(this.fallbackVersion);
      if (fallback && Object.keys(fallback).length > 0) {
        this.index = fallback;
        console.warn(`SpriteLoader(${this.version}): falling back to ${this.fallbackVersion}`);
      }
    }
    if (!this.index) {
      console.warn(`SpriteLoader(${this.version}): sprite index not found, using fallback rendering`);
    }
    this.loaded = true;
  }

  private async loadIndex(version: string): Promise<SpriteIndex | null> {
    try {
      const resp = await fetch(`/assets/dds/${version}/sprite-index.json`);
      if (!resp.ok) return null;
      return await resp.json();
    } catch {
      return null;
    }
  }

  getAsset(name: string): SpriteInfo | null {
    if (!this.index) return null;
    return this.index[name] || null;
  }

  async getImage(info: SpriteInfo): Promise<HTMLImageElement | null> {
    const url = `/${info.file}`;
    if (this.images.has(url)) {
      return this.images.get(url)!;
    }

    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        this.images.set(url, img);
        resolve(img);
      };
      img.onerror = () => {
        console.warn(`Failed to load sprite: ${url}`);
        resolve(null);
      };
      img.src = url;
    });
  }

  /** Get asset info by icon path from tree.json (e.g. "Art/2DArt/SkillIcons/passives/plusattribute.dds") */
  getByIconPath(iconPath: string): SpriteInfo | null {
    if (!this.index) return null;
    for (const candidate of this.getIconCandidates(iconPath)) {
      if (this.index[candidate]) return this.index[candidate];
    }
    return null;
  }

  private getIconCandidates(iconPath: string): string[] {
    const candidates = new Set<string>();
    candidates.add(iconPath);
    const extMatch = iconPath.match(/\.(dds|png|webp)$/i);
    if (extMatch) {
      const withoutExt = iconPath.slice(0, -extMatch[0].length);
      candidates.add(withoutExt);
      candidates.add(`${withoutExt}.dds`);
      candidates.add(`${withoutExt}.png`);
      candidates.add(`${withoutExt}.webp`);
    }
    return [...candidates];
  }

  /** Direct name lookup (for frame names, effect names, etc.) */
  getByName(name: string): SpriteInfo | null {
    if (!this.index) return null;
    return this.index[name] || null;
  }

  /** Check if sprite loader is available (sprite index loaded successfully) */
  isAvailable(): boolean {
    return this.index !== null && Object.keys(this.index).length > 0;
  }

  getLoadedCount(): number {
    return this.images.size;
  }
}

const loaderCache = new Map<string, SpriteLoader>();

export function getSpriteLoader(version: string): SpriteLoader {
  const key = version || '0_4';
  let loader = loaderCache.get(key);
  if (!loader) {
    loader = new SpriteLoader(key);
    loaderCache.set(key, loader);
  }
  return loader;
}

// Backward-compatible default loader for older call sites.
export const spriteLoader = getSpriteLoader('0_4');

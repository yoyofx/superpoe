/**
 * Sprite Loader for DDS-generated WebP assets.
 * Loads sprite-index.json and provides asset lookup by name.
 */
export interface SpriteInfo {
  file: string;
  w: number;
  h: number;
}

export interface SpriteIndex {
  [assetName: string]: SpriteInfo;
}

class SpriteLoader {
  private index: SpriteIndex | null = null;
  private images: Map<string, HTMLImageElement> = new Map();
  private baseUrl: string;
  private loaded = false;
  private loadPromise: Promise<void> | null = null;

  constructor(version: string = '0_4') {
    this.baseUrl = `/assets/dds/${version}`;
  }

  async init(): Promise<void> {
    if (this.loaded) return;
    if (this.loadPromise) return this.loadPromise;

    this.loadPromise = this._load();
    return this.loadPromise;
  }

  private async _load(): Promise<void> {
    try {
      const resp = await fetch(`${this.baseUrl}/sprite-index.json`);
      if (!resp.ok) {
        console.warn('Sprite index not found, using fallback rendering');
        return;
      }
      this.index = await resp.json();
      console.log(`SpriteLoader: loaded index with ${Object.keys(this.index || {}).length} entries`);
    } catch (e) {
      console.warn('Failed to load sprite index:', e);
    }
    this.loaded = true;
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
    // Try exact match first
    if (this.index[iconPath]) return this.index[iconPath];
    // Try without .dds extension
    if (iconPath.endsWith('.dds')) {
      const withoutExt = iconPath.slice(0, -4);
      if (this.index[withoutExt]) return this.index[withoutExt];
    }
    return null;
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

// Singleton
export const spriteLoader = new SpriteLoader('0_4');

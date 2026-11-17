/** A path relative to public/story-guide, or null for unsafe/nonlocal references. */
export function normalizeStoryAsset(value: string): string | null {
  let path: string
  try { path = decodeURIComponent(value) } catch { return null }
  // Reject encoded separators too; URL resolution must never escape this content root.
  if (!path || path !== path.trim() || /[\\:%?#\u0000-\u001f\u007f]/.test(path) || path.startsWith('//')) return null
  path = path.replace(/^\//, '').replace(/^story-guide\//, '')
  if (!path || path.split('/').some(part => !part || part === '.' || part === '..')) return null
  return path
}

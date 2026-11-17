// Maintenance only. Existing verified rows survive network failures.
// node scripts/story-guide-snapshot.mjs [--refresh] [--apply]
import { readFile, writeFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
const run = promisify(execFile)
const root = new URL('../', import.meta.url)
const read = path => readFile(new URL(path, root), 'utf8')
const snapshotPath = 'src/data/storyGuide/area-snapshot.json'
const previous = JSON.parse(await read(snapshotPath))
const bindings = JSON.parse(await read('scripts/story-guide-bindings.json'))
const lua = await read('public/pob-lua/Data/WorldAreas.lua')
const names = new Map([...lua.matchAll(/worldAreas\["([^"]+)"\] = \{[\s\S]*?\bbaseName = "([^"]+)"/g)].map(m => [m[1], m[2]]))
const areas = new Map(previous.areas.map(area => [area.areaId, area]))
const sources = new Set(previous.sources)
const decode = value => value.replace(/&amp;/g, '&').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').trim()
const flags = new Set(process.argv.slice(2))
const pending = [...new Set(Object.values(bindings).flat())].filter(id => flags.has('--refresh') || !areas.has(id))
async function fetchArea(id) {
  const baseName = names.get(id)
  if (!baseName) throw new Error(`No PoB area: ${id}`)
  const slug = baseName.replaceAll("'", '').replaceAll(' ', '_')
  const localized = {}
  for (const [locale, field] of [['cn', 'chinese'], ['tw', 'international']]) {
    const source = `https://poe2db.tw/${locale}/${slug}`
    let html
    try { html = (await run('curl.exe', ['-fLsS', '--retry', '1', '--max-time', '15', source], { maxBuffer: 12 * 1024 * 1024 })).stdout }
    catch (error) { html = error.stdout || '' }
    const heading = [...html.matchAll(/data-tabname="([^"<]+)\s*<small>([^<]+)<\/small>"/g)].find(m => m[2] === id)
    if (!heading) throw new Error(`No exact heading ${id}: ${source}`)
    localized[field] = decode(heading[1])
    sources.add(source)
  }
  areas.set(id, { areaId: id, names: localized, source: `https://poe2db.tw/cn/${slug}` })
  console.log(`Verified ${id}: ${localized.chinese} / ${localized.international}`)
}
let cursor = 0
await Promise.all(Array.from({ length: 5 }, async () => {
  while (cursor < pending.length) {
    const id = pending[cursor++]
    try { await fetchArea(id) } catch (error) { console.warn(error.message) }
  }
}))
const result = { fetchedAt: new Date().toISOString(), sources: [...sources].sort(), areas: [...areas.values()].sort((a, b) => a.areaId.localeCompare(b.areaId)) }
await writeFile(new URL(snapshotPath, root), JSON.stringify(result, null, 2) + '\n')
const missing = [...new Set(Object.values(bindings).flat())].filter(id => !areas.has(id))
console.log(`Snapshot: ${result.areas.length} areas. Missing: ${missing.join(', ') || 'none'}`)
if (flags.has('--apply')) {
  if (missing.length) throw new Error('Incomplete verification; chapter files were not changed. Retry before --apply.')
  const updates = []
  for (const [chapterId, ids] of Object.entries(bindings)) {
    const path = `src/data/storyGuide/chapters/${chapterId}.json`
    const chapter = JSON.parse(await read(path))
    const nodes = chapter.nodes.map(node => {
      // Stable original ID, never current array position or translated display name.
      const index = Number(node.id.match(/^node_(\d+)$/)?.[1]) - 1
      const areaId = ids[index]
      if (!areaId) return node
      if (node.areaId && node.areaId !== areaId) throw new Error(`Refusing to overwrite ${chapterId}/${node.id}: ${node.areaId}`)
      return { ...node, areaId, names: node.names ?? areas.get(areaId).names }
    })
    updates.push([path, { ...chapter, nodes }])
  }
  for (const [path, chapter] of updates) await writeFile(new URL(path, root), JSON.stringify(chapter, null, 2) + '\n')
  console.log('Added verified area IDs and missing bilingual names; preserved manual content.')
}

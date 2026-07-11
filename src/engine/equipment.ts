import { XMLParser } from 'fast-xml-parser'
import type { EquipmentData, EquipmentItem, EquipmentSet } from '@/types/equipment'

function asArray<T>(value: T | T[] | undefined): T[] {
  if (value == null) return []
  return Array.isArray(value) ? value : [value]
}

function parseItem(id: string, rawValue: unknown): EquipmentItem {
  const raw = String(rawValue ?? '').trim()
  const lines = raw.split(/\r?\n/).reduce<string[]>((result, line) => {
    if (!line.trim()) return result
    if (/^\s/.test(line) && result.length > 0) {
      result[result.length - 1] += ` ${line.trim()}`
    } else {
      result.push(line.trim())
    }
    return result
  }, [])
  const rarity = lines[0]?.replace(/^Rarity:\s*/i, '') || 'NORMAL'
  const name = lines[1] || 'Unknown item'
  const baseType = lines[2] || ''
  const valueOf = (label: string) => lines.find((line) => line.startsWith(label))?.slice(label.length).trim()
  const detailStart = lines.findIndex((line) => /^Implicits:\s*\d+/i.test(line))

  return {
    id,
    rarity,
    name,
    baseType,
    itemLevel: valueOf('Item Level:'),
    levelReq: valueOf('LevelReq:'),
    quality: valueOf('Quality:'),
    sockets: valueOf('Sockets:'),
    lines: detailStart >= 0 ? lines.slice(detailStart + 1) : lines.slice(3),
    raw,
  }
}

export function parseEquipmentXml(xml: string): EquipmentData | null {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '',
    textNodeName: '#text',
    parseAttributeValue: false,
    trimValues: false,
  })
  const itemsNode = parser.parse(xml)?.PathOfBuilding2?.Items
  if (!itemsNode) return null

  const itemsById: Record<string, EquipmentItem> = {}
  for (const node of asArray<Record<string, unknown>>(itemsNode.Item)) {
    const id = String(node.id ?? '')
    if (id) itemsById[id] = parseItem(id, node['#text'])
  }

  const itemSets: EquipmentSet[] = asArray<Record<string, unknown>>(itemsNode.ItemSet).map((node, index) => ({
    id: String(node.id ?? index + 1),
    title: String(node.title ?? `Set ${index + 1}`),
    useSecondWeaponSet: String(node.useSecondWeaponSet) === 'true',
    slots: asArray(node.Slot as Record<string, unknown> | Record<string, unknown>[] | undefined).map((slot) => ({
      name: String(slot.name ?? ''),
      itemId: String(slot.itemId ?? ''),
      active: slot.active == null || String(slot.active) === 'true',
    })).filter((slot) => slot.name),
  }))

  return {
    itemsById,
    itemSets,
    activeItemSetId: String(itemsNode.activeItemSet ?? itemSets[0]?.id ?? ''),
  }
}

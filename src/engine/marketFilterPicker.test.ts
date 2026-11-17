import { describe, expect, it } from 'vitest'
import { buildOfficialItemCategoryPairs, enrichOfficialItemCandidates, officialItemCandidateRarity, buildOfficialMarketFilterCandidates, filterOfficialMarketCandidates, officialMarketCandidatePage, type OfficialMarketCandidate } from './marketOfficialSuggestions'

const candidates: OfficialMarketCandidate[] = [
  { key: 'explicit.life', field: 'stats', value: 'explicit.life', source: '+# to maximum Life', text: '+# 最大生命', group: 'explicit' },
  { key: 'implicit.life', field: 'stats', value: 'implicit.life', source: '+# to maximum Life', text: '+# 最大生命', group: 'implicit' },
  { key: 'explicit.resist', field: 'stats', value: 'explicit.resist', source: '+#% to Fire Resistance', text: '+#% 火焰抗性', group: 'explicit' },
]

describe('flat official market candidates', () => {
  const itemRows = [
    ['belt', 'Utility Belt', ''], ['unique-belt', 'Utility Belt', 'Golden Girdle'],
    ['sword', 'Longsword', ''], ['gem', 'Fireball', ''],
  ].map(([key, type, name]): OfficialMarketCandidate => ({ key, value: key, field: 'items', source: name || type,
    text: name || type, group: '', item: { type, name } }))
  const itemCatalog = { result: [
    { id: 'accessory', label: 'Accessories', entries: [{ type: 'Utility Belt' }, { type: 'Utility Belt', name: 'Golden Girdle', flags: { unique: true } }] },
    { id: 'weapon', label: 'Weapons', entries: [{ type: 'Longsword' }] },
    { id: 'gem', label: 'Gems', entries: [{ type: 'Fireball' }] },
  ] }
  const itemPairs = buildOfficialItemCategoryPairs({ 'Utility Belt': { type: 'Belt' }, Longsword: { type: 'One Hand Sword' } },
    [(name) => name === 'Utility Belt' ? '工具腰带' : name])
  const items = enrichOfficialItemCandidates(itemRows, itemCatalog, itemPairs)
  const scoped = (category: string, rarity = '', query = '') => filterOfficialMarketCandidates(items, query, '', { category, rarity }).map(v => v.key)
  it('combines exact subtype, rarity, and text while keeping official identities', () => {
    expect(scoped('accessory.belt', 'unique')).toEqual(['unique-belt'])
    expect(scoped('accessory.belt', 'unique', 'Longsword')).toEqual([])
    expect(scoped('accessory.belt', 'nonunique')).toEqual(['belt'])
    expect(scoped('accessory', 'rare')).toEqual(['belt'])
    expect(scoped('', 'magic')).toEqual(['belt', 'sword'])
    expect(scoped('', 'uniquefoil')).toEqual(['unique-belt'])
    expect(items[0].key).toBe(itemRows[0].key)
  })
  it('supports broad weapon families and exact translated base names', () => {
    expect(scoped('weapon')).toEqual(['sword'])
    expect(scoped('weapon.onemelee')).toEqual(['sword'])
    expect(scoped('weapon.ranged')).toEqual([])
    const localized = enrichOfficialItemCandidates([{ ...itemRows[0], item: { type: '工具腰带' } }], itemCatalog, itemPairs)
    expect(localized[0].item?.category).toBe('accessory.belt')
  })
  it('colors unique items and selected rarity without inventing base rarity', () => {
    expect(officialItemCandidateRarity(items[0])).toBe('base')
    for (const rarity of ['normal', 'magic', 'rare']) expect(officialItemCandidateRarity(items[0], { category: '', rarity })).toBe(rarity)
    expect(officialItemCandidateRarity(items[1], { category: '', rarity: 'rare' })).toBe('unique')
    expect(officialItemCandidateRarity(items[3], { category: '', rarity: 'rare' })).toBe('base')
  })
  it('separates quarterstaves from caster staves and flask subtypes', () => {
    const bases = { 'Ashen Staff': { type: 'Staff' }, 'Razor Quarterstaff': { type: 'Staff', subType: 'Warstaff' },
      'Lesser Life Flask': { type: 'Flask', subType: 'Life' }, 'Medium Mana Flask': { type: 'Flask', subType: 'Mana' } }
    const rows = Object.keys(bases).map((type): OfficialMarketCandidate => ({ key: type, value: type, field: 'items',
      source: type, text: type, group: '', item: { type } }))
    const catalog = enrichOfficialItemCandidates(rows, {}, buildOfficialItemCategoryPairs(bases))
    const search = (category: string, rarity = '') => filterOfficialMarketCandidates(catalog, '', '', { category, rarity }).map(v => v.key)
    expect(search('weapon.twomelee')).toEqual(['Razor Quarterstaff'])
    expect(search('weapon.caster')).toEqual(['Ashen Staff'])
    expect(search('flask.life', 'magic')).toEqual(['Lesser Life Flask'])
    expect(search('flask.mana')).toEqual(['Medium Mana Flask'])
    expect(search('flask', 'rare')).toEqual([])
  })
  it('preserves same-label stats as separate selectable identities', () => {
    expect(filterOfficialMarketCandidates(candidates, '生命').map((entry) => entry.key)).toEqual(['explicit.life', 'implicit.life'])
  })
  it('matches English, Chinese, unordered words, and ordered partial characters', () => {
    expect(filterOfficialMarketCandidates(candidates, 'FIRE resistance').map((entry) => entry.key)).toEqual(['explicit.resist'])
    expect(filterOfficialMarketCandidates(candidates, '生命 最大')).toHaveLength(2)
    expect(filterOfficialMarketCandidates(candidates, '火抗').map((entry) => entry.key)).toEqual(['explicit.resist'])
    expect(filterOfficialMarketCandidates(candidates, 'unknown')).toEqual([])
  })
  it('supports empty searches and stat group filtering', () => {
    expect(filterOfficialMarketCandidates(candidates, '')).toEqual(candidates)
    expect(filterOfficialMarketCandidates(candidates, 'life', 'implicit').map((entry) => entry.key)).toEqual(['implicit.life'])
  })
  it('loads 100 at a time without the former 40-result cutoff', () => {
    const many = Array.from({ length: 237 }, (_, index) => ({ ...candidates[0], key: String(index) }))
    expect(officialMarketCandidatePage(many)).toHaveLength(100)
    expect(officialMarketCandidatePage(many, 2)).toHaveLength(200)
    expect(officialMarketCandidatePage(many, 3)).toHaveLength(237)
  })
  it('keeps null defaults and each official field isolated', () => {
    const data = { result: [{ filters: [
      { id: 'rarity', option: { options: [{ id: null, text: 'Any' }, { id: 'rare', text: 'Rare' }] } },
      { id: 'status', option: { options: [{ id: 'securable', text: '立即购买' }] } },
      { id: 'price', option: { options: [{ id: null, text: 'Exalted Orb Equivalent' }, { id: 'divine', text: 'Divine Orb' }] } },
    ] }] }
    const catalog = buildOfficialMarketFilterCandidates(data, (source) => source === 'Rare' ? '稀有' : source)
    expect(catalog.get('rarity')?.[0].value).toBeNull()
    expect(catalog.get('rarity')?.[1]).toMatchObject({ value: 'rare', text: '稀有' })
    expect(catalog.get('status')?.map((entry) => entry.value)).toEqual(['securable'])
    expect(catalog.get('price')?.map((entry) => entry.value)).toEqual([null, 'divine'])
    expect(catalog.get('rarity')?.[0].key).not.toBe(catalog.get('price')?.[0].key)
  })
  it('does not introduce CN-only status options into the global catalog', () => {
    const catalog = buildOfficialMarketFilterCandidates({ result: [{ filters: [{ id: 'status', option: { options: [
      { id: 'securable', text: 'Instant Buyout' }, { id: 'online', text: 'Online' }, { id: 'any', text: 'Any' },
    ] } }] }] }, (source) => source)
    expect(catalog.get('status')?.map((entry) => entry.value)).toEqual(['securable', 'online', 'any'])
  })
})

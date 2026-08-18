import { describe, expect, it } from 'vitest'
import { catalogEntriesForDimension, parseAffixCatalog } from '@/engine/affixCatalog'

describe('affix catalog parser', () => {
  it('parses standard item modifiers and classifies dimensions', () => {
    const entries = parseAffixCatalog('item', `return {\n["Life1"] = { type = "Prefix", affix = "Healthy", "+(20-24) to maximum Life", level = 1, group = "MaximumLife", modTags = { "life", "defences" }, },\n}`)
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ id: 'Life1', text: '+(20-24) to maximum Life', group: 'MaximumLife' })
    expect(catalogEntriesForDimension(entries, 'defense')).toHaveLength(1)
  })

  it('parses rune entries without treating their slot as a dimension', () => {
    const entries = parseAffixCatalog('rune', `return {\n\t["Core"] = {\n\t\t["helmet"] = {\n\t\t\t\ttype = "Rune",\n\t\t\t\t"+5% to Fire Resistance",\n\t\t\t},\n\t},\n}`)
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ source: 'rune', text: '+5% to Fire Resistance', group: 'helmet' })
    expect(catalogEntriesForDimension(entries, 'defense')).toHaveLength(1)
  })

  it('keeps untagged special modifiers visible in the defense dimension', () => {
    const entries = parseAffixCatalog('exclusive', `return {\n["Special1"] = { affix = "", "Passives in Radius can be Allocated", level = 1, },\n}`)
    expect(entries[0]?.dimensions).toEqual(['defense'])
    expect(catalogEntriesForDimension(entries, 'defense')).toHaveLength(1)
  })
})

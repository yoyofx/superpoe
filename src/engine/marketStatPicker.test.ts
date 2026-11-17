import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { buildMarketStatAffixIndex, enrichMarketStatCandidates, type MarketStatPickerData } from './marketStatPicker'
import { filterOfficialMarketCandidates, type OfficialMarketCandidate } from './marketOfficialSuggestions'
import { MarketStatPickerCatalog } from '../../electron/marketStatPickerCatalog'
import { XiletradeDataCatalog } from '../../electron/xiletradeDataCatalog'

describe('market stat translations and affix classification', () => {
  const affixes = buildMarketStatAffixIndex([
    '["Life"] = { type = "Prefix", tradeHashes = { [3299347043] = { "+(10-20) to maximum Life" } } },\n'
    + '["Hybrid"] = { type = "Prefix", tradeHashes = { [888] = { "hybrid" }, [777] = { "another" } } },',
    '["Resist"] = { type = "Suffix", tradeHashes = { [3372524247] = { "resistance" }, [888] = { "hybrid" } } },\n'
    + '["Special"] = { type = "Corrupted", tradeHashes = { [999] = { "unclassified" } } },',
  ])
  const data: MarketStatPickerData = { affixes, entries: [
    ['explicit.stat_3299347043', '+# to maximum Life', '# 生命上限'],
    ['implicit.stat_3299347043', '+# to maximum Life', '# 生命上限'],
    ['explicit.stat_3372524247', '+#% to Fire Resistance', '#% 火焰抗性'],
  ] }
  const row = (id: string, source = 'official text'): OfficialMarketCandidate => ({ key: id, value: id,
    field: 'stats', source, text: source, group: id.split('.')[0] })

  it('merges tiers and recognizes multiple hashes and both affix types without guessing special types', () => {
    expect(new Map(affixes).get('3299347043')).toEqual(['prefix'])
    expect(new Map(affixes).get('3372524247')).toEqual(['suffix'])
    expect(new Map(affixes).get('888')).toEqual(['prefix', 'suffix'])
    expect(new Map(affixes).get('777')).toEqual(['prefix'])
    expect(new Map(affixes).has('999')).toBe(false)
  })
  it('localizes by official ID even when the page text differs and keeps identical labels distinct', () => {
    const rows = enrichMarketStatCandidates([row('explicit.stat_3299347043'), row('implicit.stat_3299347043')], data, (s) => s)
    expect(rows.map((v) => v.text)).toEqual(['# 生命上限', '# 生命上限'])
    expect(rows.map((v) => v.key)).toEqual(['explicit.stat_3299347043', 'implicit.stat_3299347043'])
    expect(rows[0].affixes).toEqual(['prefix'])
    expect(rows[1].affixes).toEqual([])
    expect(filterOfficialMarketCandidates(rows, 'maximum life')).toHaveLength(2)
    expect(filterOfficialMarketCandidates(rows, '生命')).toHaveLength(2)
  })
  it('preserves unknown options and avoids classifying pseudo totals, implicit or rune stats by shared hash', () => {
    const rows = enrichMarketStatCandidates(['explicit.stat_888', 'explicit.stat_999', 'rune.stat_3299347043',
      'pseudo.stat_3299347043', 'fractured.stat_3299347043'].map((id) => row(id)), data, (s) => s)
    expect(rows.map((v) => v.affixes)).toEqual([['prefix', 'suffix'], [], [], [], ['prefix']])
    expect(rows[1].text).toBe('official text')
  })
  it('reads the bundled production trade hashes and Chinese catalogs', () => {
    const catalog = new MarketStatPickerCatalog(new XiletradeDataCatalog('public/data/xiletrade'), 'public/pob-lua/Data')
    const chinese = catalog.get('zh-rCN')
    expect(chinese.entries.find(([id]) => id === 'explicit.stat_3299347043')?.[2]).toMatch(/生命/)
    expect(new Map(chinese.affixes).get('3299347043')).toContain('prefix')
    expect(new Map(chinese.affixes).get('4080418644')).toContain('suffix')
    const english = catalog.get('en')
    expect(english.entries.find(([id]) => id === 'explicit.stat_3299347043')?.[2]).toMatch(/maximum Life/)
    // All real modifier hashes are read from generation metadata, not translated wording.
    expect(buildMarketStatAffixIndex([readFileSync('public/pob-lua/Data/ModItem.lua', 'utf8')]).length).toBeGreaterThan(100)
  })
})

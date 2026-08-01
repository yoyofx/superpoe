import { describe, expect, it } from 'vitest'
import { normalizePoecurrencySummary, normalizePoe2ScoutSnapshot, selectCurrentSoftcoreLeague } from './currencyMarketAdapters'

describe('currency market adapters', () => {
  it('normalizes poecurrency prices and converts divine quotes to exalted', () => {
    const snapshot = normalizePoecurrencySummary([{
      category_label: '通货仓库',
      items: [
        { item_name: '神圣石', engname: 'Divine Orb', currency_unit: 'e', buy_avg: 400, sell_avg: 400, latest_datetime: '2026-08-01 15:00:00' },
        { item_name: '裂界石', engname: 'Test Orb', currency_unit: 'd', buy_avg: 2, sell_avg: 2, buy_avg_ratio: 5, item_icon: 'https://example.test/item.png' },
        { item_name: '异常石', engname: 'Bad Orb', currency_unit: 'e', buy_avg: 3, sell_avg: 3, error: true, error_info: '异常行情' },
      ],
    }], '2026-08-01T08:00:00.000Z')

    expect(snapshot.realm).toBe('cn')
    expect(snapshot.divineInExalted).toBe(400)
    const converted = snapshot.items.find((item) => item.englishName === 'Test Orb')
    expect(converted?.priceExalted).toBe(800)
    expect(converted?.priceDivine).toBe(2)
    expect(converted?.originalQuote).toEqual({ value: 2, unit: 'd', label: '2 D' })
    expect(snapshot.items.find((item) => item.englishName === 'Bad Orb')?.quality).toBe('anomalous')
  })

  it('selects the current standard league when hardcore is also current', () => {
    const league = selectCurrentSoftcoreLeague([
      { Value: 'HC Runes of Aldur', ShortName: 'runeshc', IsCurrent: true },
      { Value: 'Runes of Aldur', ShortName: 'runes', IsCurrent: true },
    ])
    expect(league.ShortName).toBe('runes')
  })

  it('uses the highest value-traded scout observation and reference base currency', () => {
    const leagues = [
      { Value: 'Runes of Aldur', ShortName: 'runes', IsCurrent: true, DivinePrice: 370 },
      { Value: 'HC Runes of Aldur', ShortName: 'runeshc', IsCurrent: true, DivinePrice: 280 },
    ]
    const references = [
      { ApiId: 'exalted', Text: 'Exalted Orb', IconUrl: 'https://example.test/e.png', RelativePrice: 1 },
      { ApiId: 'divine', Text: 'Divine Orb', IconUrl: 'https://example.test/d.png', RelativePrice: 370 },
    ]
    const currency = { ApiId: 'vaal', Text: 'Vaal Orb', CategoryApiId: 'currency', IconUrl: 'https://example.test/v.png' }
    const other = { ApiId: 'gcp', Text: "Gemcutter's Prism", CategoryApiId: 'currency' }
    const pairs = [
      { CurrencyOne: currency, CurrencyTwo: other, CurrencyOneData: { RelativePrice: 3, ValueTraded: 10, VolumeTraded: 2 }, CurrencyTwoData: { RelativePrice: 2, ValueTraded: 1 } },
      { CurrencyOne: currency, CurrencyTwo: other, CurrencyOneData: { RelativePrice: 2.5, ValueTraded: 20, VolumeTraded: 8, StockValue: 50, HighestStock: 80 }, CurrencyTwoData: { RelativePrice: 2, ValueTraded: 1 } },
    ]
    const snapshot = normalizePoe2ScoutSnapshot(leagues, references, pairs, '2026-08-01T08:00:00.000Z')

    expect(snapshot.realm).toBe('global')
    expect(snapshot.sourceLeague).toBe('Runes of Aldur')
    expect(snapshot.divineInExalted).toBe(370)
    expect(snapshot.items.find((item) => item.id === 'poe2scout:exalted')?.priceExalted).toBe(1)
    const vaal = snapshot.items.find((item) => item.id === 'poe2scout:vaal')
    expect(vaal?.priceExalted).toBe(2.5)
    expect(vaal?.sourceDetails).toMatchObject({ kind: 'poe2scout', valueTraded: 20, volumeTraded: 8, stockValue: 50, highestStock: 80 })
  })
})

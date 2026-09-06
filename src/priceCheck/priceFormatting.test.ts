import { describe, expect, it } from 'vitest'
import { localizedPrice, priceCurrencyLabel } from './priceFormatting'

const price = (currency: string) => ({ amount: 2, currency, display: `2 ${currency}` })
const fallback = () => 'No price'

describe('price formatting', () => {
  it('localizes common trade currency abbreviations', () => {
    expect(priceCurrencyLabel('alch', 'zh-rCN')).toBe('点金石')
    expect(priceCurrencyLabel('alch', 'zh-rTW')).toBe('點金石')
    expect(priceCurrencyLabel('alch', 'ko-KR')).toBe('연금술의 오브')
    expect(priceCurrencyLabel('alch', 'en')).toBe('Orb of Alchemy')
  })

  it('formats localized amounts and preserves unknown currencies', () => {
    expect(localizedPrice(price('alch'), 'zh-rCN', fallback)).toBe('2 点金石')
    expect(localizedPrice(price('custom-currency'), 'zh-rCN', fallback)).toBe('2 custom-currency')
    expect(localizedPrice(undefined, 'zh-rCN', fallback)).toBe('No price')
  })
})

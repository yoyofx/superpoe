import type { PriceCheckContextState, PriceCheckListingView } from '@/types/market'
import { formatUiNumber, uiText } from '@/i18n/uiLocale'

export const PRICE_CURRENCY_OPTIONS: ReadonlyArray<{
  id: string
  aliases: readonly string[]
  en: string
  zhCN: string
  zhTW: string
  ko: string
}> = [
  { id: 'divine', aliases: ['divine', 'divine orb'], en: 'Divine Orb', zhCN: '神圣石', zhTW: '神聖石', ko: '신성한 오브' },
  { id: 'exalted', aliases: ['exalted', 'exalted orb'], en: 'Exalted Orb', zhCN: '崇高石', zhTW: '崇高石', ko: '엑잘티드 오브' },
  { id: 'chaos', aliases: ['chaos', 'chaos orb'], en: 'Chaos Orb', zhCN: '混沌石', zhTW: '混沌石', ko: '카오스 오브' },
  { id: 'aug', aliases: ['aug', 'augmentation', 'orb of augmentation'], en: 'Orb of Augmentation', zhCN: '增幅石', zhTW: '增幅石', ko: '증폭의 오브' },
  { id: 'transmute', aliases: ['transmute', 'transmutation', 'orb of transmutation'], en: 'Orb of Transmutation', zhCN: '蜕变石', zhTW: '蛻變石', ko: '변성의 오브' },
  { id: 'regal', aliases: ['regal', 'regal orb'], en: 'Regal Orb', zhCN: '富豪石', zhTW: '富豪石', ko: '제왕의 오브' },
  { id: 'vaal', aliases: ['vaal', 'vaal orb'], en: 'Vaal Orb', zhCN: '瓦尔宝珠', zhTW: '瓦爾寶珠', ko: '바알 오브' },
  { id: 'annul', aliases: ['annul', 'annulment', 'orb of annulment'], en: 'Orb of Annulment', zhCN: '无效石', zhTW: '無效石', ko: '소멸의 오브' },
  { id: 'alch', aliases: ['alch', 'alchemy', 'orb of alchemy'], en: 'Orb of Alchemy', zhCN: '点金石', zhTW: '點金石', ko: '연금술의 오브' },
  { id: 'mirror', aliases: ['mirror', 'mirror of kalandra'], en: 'Mirror of Kalandra', zhCN: '卡兰德的魔镜', zhTW: '卡蘭德的魔鏡', ko: '칼란드라의 거울' },
]

export function priceCurrencyLabel(currency: string, language: PriceCheckContextState['language']): string {
  const normalized = currency.trim().toLocaleLowerCase().replace(/[_-]+/g, ' ')
  const option = PRICE_CURRENCY_OPTIONS.find((candidate) => candidate.aliases.includes(normalized))
  return option ? uiText(language, option.en, option.zhCN, option.zhTW, option.ko) : currency
}

export function localizedPrice(
  price: PriceCheckListingView['price'],
  language: PriceCheckContextState['language'],
  l: (en: string, zhCN: string, zhTW: string, koKR: string) => string,
): string {
  if (!price) return l('No price', '未标价', '未標價', '가격 없음')
  return `${formatUiNumber(price.amount, language, { maximumFractionDigits: 2 })} ${priceCurrencyLabel(price.currency, language)}`
}

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { buildMarketStatAffixIndex, type MarketStatPickerData } from '../src/engine/marketStatPicker.js'
import type { XiletradeDataCatalog } from './xiletradeDataCatalog.js'
import type { UiLanguage } from './uiLocale.js'
import { loadMarketStatScopes } from './marketStatScopeCatalog.js'
import type { MarketStatScopeData } from '../src/engine/marketStatScope.js'

export class MarketStatPickerCatalog {
  private affixes?: MarketStatPickerData['affixes']
  private cache = new Map<UiLanguage, MarketStatPickerData>()
  private scopes?: Promise<MarketStatScopeData>

  constructor(private readonly catalog: XiletradeDataCatalog, private readonly dataRoot: string,
    private readonly localizers: Array<(name: string) => string> = []) {}

  async getWithScopes(language: UiLanguage): Promise<MarketStatPickerData> {
    const data = this.get(language)
    this.scopes ??= loadMarketStatScopes(this.dataRoot, this.get('en').entries.map(([id, source]) => [id, source]), this.localizers)
      .catch((error) => { this.scopes = undefined; throw error })
    try { return { ...data, scopes: await this.scopes } }
    catch { return { ...data, scopeError: true } }
  }

  get(language: UiLanguage): MarketStatPickerData {
    const existing = this.cache.get(language)
    if (existing) return existing
    this.affixes ??= buildMarketStatAffixIndex(['ModItem', 'ModJewel', 'ModFlask', 'ModCharm', 'ModVeiled'].map((file) =>
      readFileSync(path.join(this.dataRoot, `${file}.lua`), 'utf8')))
    const canonical = new Map(this.catalog.get('en-US').entries.map((entry) => [entry.id, entry.text]))
    const locale = language === 'zh-rCN' ? 'zh-CN' : language === 'zh-rTW' ? 'zh-TW' : language === 'ko-KR' ? 'ko-KR' : 'en-US'
    const localized = new Map(this.catalog.get(locale).entries.map((entry) => [entry.id, entry.text]))
    const ids = new Set([...canonical.keys(), ...localized.keys()])
    const data: MarketStatPickerData = { entries: [...ids].map((id) => [id, canonical.get(id) || localized.get(id)!,
      localized.get(id) || canonical.get(id)!]), affixes: this.affixes }
    this.cache.set(language, data)
    return data
  }
}

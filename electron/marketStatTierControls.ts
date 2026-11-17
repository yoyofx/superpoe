import type { MarketStatTier } from '../src/engine/marketStatTiers.js'

export interface MarketStatTierView {
  key: string
  ordinary: boolean
  hasBase: boolean
  localize: (text: string) => string
  describe: (tier: MarketStatTier) => string
  tiers: (id: string) => MarketStatTier[]
  apply: (rowToken: string, statId: string, tier: MarketStatTier, previous: string[]) => Promise<boolean>
}
interface TierRow {
  host: HTMLDivElement; trigger: HTMLButtonElement; list: HTMLDivElement
  token: string; open: boolean; busy: boolean; signature: string; error: boolean
}

/** Adds tier selection before the official range inputs, which keep owning state. */
export class MarketStatTierControls {
  private rows = new Map<HTMLElement, TierRow>()
  private view?: MarketStatTierView
  private observer: MutationObserver
  constructor(private readonly panel: HTMLElement, private readonly text: (en: string, cn: string, tw: string, ko: string) => string) {
    this.observer = new MutationObserver(() => this.refresh())
    this.observer.observe(panel, { childList: true, subtree: true })
    panel.addEventListener('input', this.onInput)
  }
  private onInput = () => queueMicrotask(() => this.refresh())
  update(view: MarketStatTierView): void {
    if (view.key !== this.view?.key) for (const entry of this.rows.values()) { entry.open = false; entry.error = false; entry.busy = false }
    this.view = view; this.refresh()
  }
  private button(label: string, action: () => void): HTMLButtonElement {
    const button = document.createElement('button')
    button.type = 'button'; button.className = 'sp-market-control'; button.textContent = label
    button.addEventListener('click', (event) => { event.preventDefault(); event.stopPropagation(); action() })
    return button
  }
  private remove(row: HTMLElement, entry: TierRow): void {
    entry.host.remove(); delete row.dataset.superpoeTierRowToken; this.rows.delete(row)
  }
  private refresh(): void {
    const view = this.view
    for (const [row, entry] of this.rows) if (!this.panel.contains(row) || !view?.ordinary
      || !(row.dataset.superpoeStatId || row.dataset.statId || '').startsWith('explicit.')
      || row.querySelectorAll('input.minmax').length !== 2) this.remove(row, entry)
    if (!view?.ordinary) return
    for (const row of this.panel.querySelectorAll<HTMLElement>('.filter-property, .filter[data-superpoe-stat-id]')) {
      const id = row.dataset.superpoeStatId || row.dataset.statId || ''
      const inputs = Array.from(row.querySelectorAll<HTMLInputElement>('input.minmax'))
      if (!id.startsWith('explicit.') || inputs.length !== 2) continue
      let entry = this.rows.get(row)
      if (!entry) {
        const host = document.createElement('div'); host.className = 'sp-market-stat-tier'; host.dataset.superpoeMarketOwned = 'true'
        const token = crypto.randomUUID(); row.dataset.superpoeTierRowToken = token
        const trigger = this.button('', () => {
          entry!.open = !entry!.open; entry!.signature = ''; this.refresh()
          if (entry!.open) entry!.list.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true })
        })
        trigger.classList.add('sp-market-stat-tier-trigger'); trigger.setAttribute('aria-expanded', 'false')
        const list = document.createElement('div'); list.className = 'sp-market-stat-tier-options'; list.id = `sp-tier-${token}`
        trigger.setAttribute('aria-controls', list.id)
        host.append(trigger, list); inputs[0].before(host)
        entry = { host, trigger, list, token, open: false, busy: false, signature: '', error: false }
        host.addEventListener('keydown', (event) => {
          if (event.key === 'Escape' && entry!.open && !entry!.busy) {
            event.preventDefault(); event.stopPropagation(); entry!.open = false; entry!.signature = ''; this.refresh(); trigger.focus()
          }
        })
        this.rows.set(row, entry)
      }
      const tiers = view.tiers(id), values = inputs.map((input) => input.value)
      const signature = JSON.stringify([view.key, id, tiers, values, entry.open, entry.busy, entry.error, inputs.map((input) => input.disabled || input.readOnly)])
      if (signature === entry.signature) continue
      entry.signature = signature
      const current = values.every((value) => value.trim() !== '') ? tiers.filter((tier) => tier.searchMin === Number(values[0]) && tier.searchMax === Number(values[1])) : []
      const rank = current.length && current.every((tier) => tier.tier === current[0].tier) ? current[0].tier : undefined
      entry.trigger.textContent = rank ? `T${rank}` : this.text('Choose tier', '选择 T 级', '選擇 T 級', '등급 선택')
      entry.trigger.disabled = entry.busy || !tiers.length || inputs.some((input) => input.disabled || input.readOnly)
      entry.trigger.title = !tiers.length ? (view.hasBase
        ? this.text('No tier range available for this stat.', '此词缀暂无可自动填写的 T 级范围。', '此詞綴暫無可自動填寫的 T 級範圍。', '이 속성의 등급 범위가 없습니다.')
        : this.text('Choose a specific base to see its tiers.', '选择具体基底后可查看对应 T 级。', '選擇具體基底後可查看對應 T 級。', '기본 유형을 선택하면 등급을 볼 수 있습니다.'))
        : this.text('Fill the minimum and maximum values', '填入最小值和最大值', '填入最小值和最大值', '최소 및 최대 값 입력')
      entry.trigger.setAttribute('aria-expanded', String(entry.open))
      entry.list.hidden = !entry.open
      if (!entry.open) { entry.list.replaceChildren(); continue }
      const nodes: HTMLElement[] = []
      const hint = document.createElement('small'); hint.className = 'sp-market-stat-tier-hint'
      hint.textContent = entry.error ? this.text('Could not apply this range. Retry.', '范围未能写入，请重试。', '範圍未能寫入，請重試。', '범위를 적용하지 못했습니다. 다시 시도하세요.')
        : this.text('Choose a tier to fill both bounds', '选择档位，填入最小值和最大值', '選擇檔位，填入最小值和最大值', '등급을 선택해 범위 입력')
      hint.setAttribute('role', 'status'); nodes.push(hint)
      const series = new Set(tiers.map((tier) => tier.series))
      let previousSeries = ''
      for (const tier of tiers) {
        if (series.size > 1 && previousSeries !== tier.series) {
          const heading = document.createElement('div'); heading.className = 'sp-market-stat-tier-series'
          heading.textContent = `${tier.text.includes('\n') ? this.text('Hybrid', '复合词缀', '複合詞綴', '복합 속성')
            : this.text('Single stat', '单属性词缀', '單屬性詞綴', '단일 속성')} · ${view.describe(tier)}`
          nodes.push(heading)
        }
        previousSeries = tier.series
        const target = entry
        const option = this.button('', () => void this.apply(row, target, id, tier))
        option.classList.add('sp-market-stat-tier-option'); option.dataset.tier = String(tier.tier)
        option.dataset.modId = tier.id; option.disabled = entry.busy
        option.setAttribute('aria-pressed', String(current.some((candidate) => candidate.id === tier.id)))
        const rank = document.createElement('strong'); rank.textContent = `T${tier.tier}`
        const range = document.createElement('span')
        const rawRolls = tier.rolls?.length === 2
          ? `${this.formatRange(tier.rolls[0])} ${this.text('to', '至', '至', '에서')} ${this.formatRange(tier.rolls[1])}`
          : this.formatRange(tier.rolls?.[0] || { min: tier.min, max: tier.max })
        range.textContent = rawRolls
        const caption = document.createElement('small')
        const adjusted = tier.searchMin !== tier.min || tier.searchMax !== tier.max
        const query = tier.average ? ` · ${this.text(adjusted ? 'Trade search range' : 'Trade query', adjusted ? '集市搜索范围' : '集市查询值', adjusted ? '集市搜尋範圍' : '集市查詢值', adjusted ? '거래 검색 범위' : '거래 검색값')} ${this.formatRange({ min: tier.searchMin, max: tier.searchMax })}` : ''
        caption.textContent = `${this.text('Item level', '需求物等', '需求物等', '아이템 레벨')} ${tier.level} · ${tier.affix === 'prefix'
          ? this.text('Prefix', '前缀', '前綴', '접두어') : this.text('Suffix', '后缀', '後綴', '접미어')}${tier.text.includes('\n') ? this.text(' · Hybrid', ' · 复合词缀', ' · 複合詞綴', ' · 복합 속성') : ''}`
        if (query) caption.textContent += query
        option.title = view.describe(tier); option.append(rank, range, caption); nodes.push(option)
      }
      entry.list.replaceChildren(...nodes)
    }
  }
  private formatRange(range: { min: number; max: number }): string {
    return `${range.min}—${range.max}`
  }
  private async apply(row: HTMLElement, entry: TierRow, id: string, tier: MarketStatTier): Promise<void> {
    const view = this.view
    if (!view || entry.busy) return
    const previous = Array.from(row.querySelectorAll<HTMLInputElement>('input.minmax')).map((input) => input.value)
    entry.busy = true; entry.error = false; this.refresh()
    let applied = false
    try { applied = await view.apply(entry.token, id, tier, previous) } catch { /* Keep manual inputs available. */ }
    if (!this.rows.has(row) || this.view?.key !== view.key) return
    entry.busy = false; entry.error = !applied; entry.open = !applied; this.refresh()
    if (applied) entry.trigger.focus({ preventScroll: true })
  }
  dispose(): void {
    this.observer.disconnect(); this.panel.removeEventListener('input', this.onInput)
    for (const [row, entry] of this.rows) this.remove(row, entry)
    this.view = undefined
  }
}

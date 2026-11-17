import { enrichOfficialItemCandidates, filterOfficialMarketCandidates, officialItemCandidateRarity, officialMarketCandidatePage, type OfficialMarketCandidate } from '../src/engine/marketOfficialSuggestions.js'
import { runOfficialFilterCommand, type OfficialFilterCommand, type OfficialFilterSnapshot } from './marketFilterAdapter.js'
import { MARKET_FILTER_PICKER_STYLE } from './marketFilterPickerStyle.js'
import { MarketFilterDialog } from './marketFilterDialog.js'
import { MarketItemSearch, type MarketItemSearchViewState } from './marketItemSearch.js'
import { localizeMarketCategory } from '../src/engine/marketCategoryTranslation.js'
import { enrichMarketStatCandidates, type MarketStatPickerData } from '../src/engine/marketStatPicker.js'
import { resolveMarketStatScope, scopeMarketStatCandidates, type MarketStatContext, type ResolvedMarketStatScope } from '../src/engine/marketStatScope.js'
import { resolveMarketStatTiers, type MarketStatTier } from '../src/engine/marketStatTiers.js'

interface PickerOptions {
  execute: (source: string) => Promise<unknown>
  localize: (source: string) => string
  text: (en: string, cn: string, tw: string, ko: string) => string
  labels: () => Promise<Array<[string, string]>>
  itemData: () => Promise<{ catalog: unknown; categories: Array<[string, string]> }>
  statData: () => Promise<MarketStatPickerData>
  beforeOpen: () => void
  modalState: (open: boolean) => void
}

interface OriginalAccessibility { originalInert: boolean; originalAriaHidden: string | null }
interface Binding extends OriginalAccessibility {
  element: HTMLElement; host: HTMLDivElement; state: OfficialFilterSnapshot; signature: string
}

export class MarketFilterPicker {
  private bindings = new Map<string, Binding>()
  private timer?: ReturnType<typeof setTimeout>
  private scanning = false
  private rescan = false
  private labels?: Array<[string, string]>
  private dialog?: HTMLDialogElement
  private opener?: HTMLElement
  private active?: OfficialFilterSnapshot
  private candidates: OfficialMarketCandidate[] = []
  private query = ''
  private group = ''
  private batches = 1
  private busy = false
  private request = 0
  private body?: HTMLDivElement
  private status?: HTMLSpanElement
  private search?: HTMLInputElement
  private notice = ''
  private unified: MarketFilterDialog
  private itemSearch?: MarketItemSearch
  private pendingControls = new Map<HTMLElement, OriginalAccessibility>()
  private preservedItemSearch?: MarketItemSearchViewState
  private statCatalog?: Promise<MarketStatPickerData>
  private statContext?: MarketStatContext
  private statScope: ResolvedMarketStatScope = resolveMarketStatScope(undefined)
  private allStats = false
  private scopeFailed = false
  private outsideStats: string[] = []
  private scopeVersion = 0

  constructor(private readonly options: PickerOptions) {
    this.unified = new MarketFilterDialog({ text: options.text, beforeOpen: options.beforeOpen,
      switchTab: () => this.closeCandidate(false),
      closePicker: () => { this.scopeVersion++; this.closeCandidate(false); this.itemSearch?.dispose(); this.itemSearch = undefined; this.preservedItemSearch = undefined }, changed: () => {
        this.releaseOutsideBindings()
        options.modalState(this.isOpen)
        this.schedule()
      } })
  }

  isManaged(element: Element | null): boolean {
    return Boolean(element?.closest('[data-superpoe-picker-managed="true"], .sp-market-filter-managed, [data-superpoe-market-owned="true"]'))
  }

  get isOpen(): boolean { return Boolean(this.dialog?.open || this.unified.isOpen) }

  openFilters(): void {
    this.unified.scan()
    this.unified.open()
  }

  schedule(): void {
    if (this.timer) return
    this.timer = setTimeout(() => { this.timer = undefined; void this.scan() }, 180)
  }

  guardMutations(records: MutationRecord[]): void {
    if (!this.unified.isOpen) return
    // Run in the observer microtask, before a newly rendered official control can paint.
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (!(node instanceof HTMLElement)) continue
        const controls = [...(node.matches('.multiselect') ? [node] : []), ...node.querySelectorAll<HTMLElement>('.multiselect')]
        for (const element of controls) {
          if (element.closest('[data-filter-tab="stats"]') && (element.classList.contains('filter-select-title')
            || !element.classList.contains('filter-select-mutate'))) continue
          if (!this.unified.contains(element) || element.dataset.superpoePickerManaged === 'true' || this.pendingControls.has(element)) continue
          this.pendingControls.set(element, { originalInert: element.inert, originalAriaHidden: element.getAttribute('aria-hidden') })
          element.dataset.superpoePickerPending = 'true'; element.inert = true; element.setAttribute('aria-hidden', 'true')
        }
      }
    }
  }

  reset(): void {
    this.close(false)
    this.unified.dispose()
    this.labels = undefined
    this.statCatalog = undefined; this.statContext = undefined; this.statScope = resolveMarketStatScope(undefined)
    this.allStats = false; this.scopeFailed = false; this.outsideStats = []
    for (const binding of this.bindings.values()) binding.signature = ''
    this.schedule()
  }

  private async command(command: OfficialFilterCommand): Promise<any> {
    return this.options.execute(`(${runOfficialFilterCommand.toString()})(${JSON.stringify({ ...command, labels: this.labels || [] })})`)
  }

  private element<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] {
    const element = document.createElement(tag)
    element.className = className
    if (text) element.textContent = text
    return element
  }

  private button(text: string, action: () => void, className = ''): HTMLButtonElement {
    const button = this.element('button', className, text)
    button.classList.add('sp-market-control')
    button.type = 'button'
    button.addEventListener('click', (event) => { event.preventDefault(); event.stopPropagation(); action() })
    return button
  }

  private releaseOutsideBindings(): void {
    for (const [token, binding] of this.bindings) {
      if (this.unified.contains(binding.element)) continue
      this.releaseBinding(binding)
      this.bindings.delete(token)
      if (this.active?.token === token) this.closeCandidate(false)
    }
    for (const [element, original] of this.pendingControls) {
      if (this.unified.contains(element)) continue
      this.restoreAccessibility(element, original)
      delete element.dataset.superpoePickerPending
      this.pendingControls.delete(element)
    }
  }

  private restoreAccessibility(element: HTMLElement, original: OriginalAccessibility): void {
    element.inert = original.originalInert
    if (original.originalAriaHidden === null) element.removeAttribute('aria-hidden')
    else element.setAttribute('aria-hidden', original.originalAriaHidden)
  }

  private releaseBinding(binding: Binding): void {
    if (binding.state.field === 'items' && this.itemSearch?.host === binding.host) {
      this.preservedItemSearch = this.itemSearch.getViewState()
    }
    binding.element.classList.remove('sp-market-filter-managed')
    delete binding.element.dataset.superpoePickerManaged
    this.restoreAccessibility(binding.element, binding)
    binding.host.remove()
  }

  private isolateBinding(binding: Binding): void {
    // Vue replaces className on selection; our own attribute survives that render.
    if (binding.element.dataset.superpoePickerManaged !== 'true') binding.element.dataset.superpoePickerManaged = 'true'
    if (!binding.element.inert) binding.element.inert = true
    if (binding.element.getAttribute('aria-hidden') !== 'true') binding.element.setAttribute('aria-hidden', 'true')
    if (!binding.element.classList.contains('sp-market-filter-managed')) binding.element.classList.add('sp-market-filter-managed')
  }

  private async scan(): Promise<void> {
    if (this.busy) { this.rescan = true; return }
    if (this.scanning) { this.rescan = true; return }
    if (!['poe.game.qq.com', 'www.pathofexile.com', 'pathofexile.com'].includes(location.hostname)
      || !location.pathname.startsWith('/trade2')) return
    this.scanning = true
    try {
      if (!document.getElementById('superpoe-market-filter-picker-style')) {
        const style = this.element('style')
        style.id = 'superpoe-market-filter-picker-style'
        style.textContent = MARKET_FILTER_PICKER_STYLE
        document.head.appendChild(style)
      }
      this.unified.scan()
      this.releaseOutsideBindings()
      if (!this.unified.isOpen) return
      this.labels ??= await this.options.labels()
      const scannedControls = new Set(document.querySelectorAll('.multiselect'))
      const snapshots = await this.command({ action: 'scan' }) as OfficialFilterSnapshot[]
      if (this.busy) { this.rescan = true; return }
      if (!Array.isArray(snapshots)) throw new Error('Official filter scan failed')
      const elements = new Map(Array.from(document.querySelectorAll<HTMLElement>('.multiselect[data-superpoe-picker-token]'))
        .map((element) => [element.dataset.superpoePickerToken!, element]))
      for (const state of snapshots) {
        const element = elements.get(state.token)
        if (element) this.unified.arrangeField(state.field, element)
      }
      this.unified.arrangeNumericFields(this.labels)
      for (const [token, binding] of this.bindings) {
        if (!this.unified.contains(binding.element) || elements.get(token) !== binding.element || !snapshots.some((state) => state.token === token)) {
          this.releaseBinding(binding)
          this.bindings.delete(token)
          if (this.active?.token === token) this.closeCandidate(false)
        }
      }
      for (const state of snapshots) {
        const element = elements.get(state.token)
        if (!element || !this.unified.contains(element)) continue
        if (state.field === 'status') {
          const instant = state.candidates.find((candidate) => candidate.value === 'securable')
          if (!instant) continue
          if (!state.selected.includes(instant.key)) {
            const selected = await this.command({ action: 'select', token: state.token, key: instant.key }) as OfficialFilterSnapshot | false
            if (!selected) throw new Error('instant purchase selection failed')
            Object.assign(state, selected)
            if (!this.unified.contains(element)) continue
          }
          continue
        }
        let binding = this.bindings.get(state.token)
        if (!binding) {
          const host = this.element('div', 'sp-market-filter-host')
          host.dataset.superpoeMarketOwned = 'true'
          element.after(host)
          binding = { element, host, state, signature: '', ...(this.pendingControls.get(element)
            || { originalInert: element.inert, originalAriaHidden: element.getAttribute('aria-hidden') }) }
          this.bindings.set(state.token, binding)
        }
        this.isolateBinding(binding)
        this.pendingControls.delete(element)
        delete element.dataset.superpoePickerPending
        binding.state = state
        const signature = JSON.stringify([state, this.options.localize(state.label)])
        if (signature !== binding.signature) {
          binding.signature = signature
          this.renderBinding(binding)
        }
      }
      const counts = await this.command({ action: 'counts' })
      if (counts && typeof counts.conditions === 'number' && typeof counts.stats === 'number') this.unified.updateCounts(counts)
      await this.updateStatScope(snapshots, counts?.statIds || [])
      // Unchanged native fields (such as stat group operators) retain their existing behavior.
      for (const [element, original] of this.pendingControls) {
        if (!scannedControls.has(element) && this.unified.contains(element)) { this.rescan = true; continue }
        this.restoreAccessibility(element, original)
        delete element.dataset.superpoePickerPending
        this.pendingControls.delete(element)
      }
      this.unified.ready()
    } catch {
      // Page updates must leave the official controls usable.
      for (const binding of this.bindings.values()) {
        this.releaseBinding(binding)
      }
      this.bindings.clear()
      this.close(false)
    } finally {
      this.scanning = false
      if (this.rescan) { this.rescan = false; this.schedule() }
    }
  }

  private getStatData(): Promise<MarketStatPickerData> {
    this.statCatalog ??= this.options.statData().catch((error) => { this.statCatalog = undefined; throw error })
    return this.statCatalog
  }

  private statScopeLabel(): string {
    const l = this.options.text, context = this.statContext
    if (context?.item) {
      const item = context.selectionLabel || [context.item.name, context.item.type].filter(Boolean).join(' ')
      return `${l('Current item', '当前物品', '目前物品', '현재 아이템')} · ${this.options.localize(item)}`
    }
    if (context?.category) return `${l('Current category', '当前类别', '目前類別', '현재 유형')} · ${localizeMarketCategory(context.category,
      this.options.localize(context.categoryLabel || context.category), l)}`
    return l('All item stats', '全部物品词缀', '全部物品詞綴', '모든 아이템 속성')
  }

  private async updateStatScope(snapshots: OfficialFilterSnapshot[], selected: string[]): Promise<void> {
    const version = this.scopeVersion
    const context = snapshots.find((state) => state.field === 'stats')?.statContext
    const before = this.statScope.key
    this.statContext = context
    const data = await this.getStatData().then((value) => { this.scopeFailed = Boolean(value.scopeError); return value }).catch(() => { this.scopeFailed = true; return undefined })
    if (!this.unified.isOpen || version !== this.scopeVersion) return
    // Read the latest official context again on the next scheduled scan if it
    // changed during loading. Never alter any already selected query values.
    this.statScope = resolveMarketStatScope(context, data?.scopes)
    if (before !== this.statScope.key) this.allStats = false
    const allowed = this.statScope.ids ? new Set(this.statScope.ids) : undefined
    this.outsideStats = allowed ? selected.filter((id) => !allowed.has(id)) : []
    this.renderStatScope()
    const scope = this.statScope
    const tierLabels = new Map(data?.entries.map(([id, source, text]) => [id, text || source]))
    this.unified.updateStatTiers({ key: scope.key, ordinary: scope.kind !== 'unique' && !context?.item?.unique && !context?.item?.name
      && !['unique', 'uniquefoil', 'normal'].includes(context?.rarity || ''), hasBase: Boolean(context?.item?.type),
      localize: this.options.localize, tiers: (id) => resolveMarketStatTiers(context, scope, data?.scopes, id),
      describe: (tier) => [...new Set(tier.statIds.map((id) => tierLabels.get(id)).filter(Boolean))].join(' / ') || this.options.localize(tier.text),
      apply: (rowToken, statId, tier, previous) => this.applyStatTier(scope.key, rowToken, statId, tier, previous) })
    if (this.active?.field === 'stats' && this.dialog?.open && before !== this.statScope.key) {
      this.active.statContext = context
      this.batches = 1; this.renderStatCandidateScope(); this.renderCandidates()
    }
  }

  private renderStatScope(): void {
    const l = this.options.text
    this.unified.updateStatScope({ label: this.statScopeLabel(), all: this.allStats, canScope: Boolean(this.statScope.ids),
      outside: this.outsideStats, busy: this.busy,
      hint: this.scopeFailed ? l('Related stats could not be loaded. All stats remain available.', '相关词缀加载失败，仍可查看全部词缀。', '相關詞綴載入失敗，仍可查看全部詞綴。', '관련 속성을 불러오지 못했습니다. 모든 속성을 사용할 수 있습니다.')
        : this.statScope.kind === 'unknown' ? l('This item is not matched yet. Showing all stats.', '暂未匹配此物品，当前显示全部词缀。', '暫未配對此物品，目前顯示全部詞綴。', '이 아이템은 아직 일치하지 않습니다. 모든 속성을 표시합니다.')
        : this.statScope.ids && !this.statScope.complete ? l('Some properties are not matched yet. View all stats for additional options.', '部分属性尚未匹配，可查看全部词缀补充。', '部分屬性尚未配對，可查看全部詞綴補充。', '일부 속성이 아직 일치하지 않습니다. 모든 속성에서 확인하세요.') : '',
      toggle: () => this.toggleStatScope(), cleanup: () => void this.cleanupStats(),
      retry: this.scopeFailed ? () => { this.statCatalog = undefined; this.schedule() } : undefined })
  }

  private async applyStatTier(key: string, rowToken: string, statId: string, tier: MarketStatTier, previous: string[]): Promise<boolean> {
    if (this.busy || !this.unified.isOpen) return false
    const version = this.scopeVersion
    this.busy = true
    try {
      const snapshots = await this.command({ action: 'scan' }) as OfficialFilterSnapshot[]
      const context = snapshots.find((state) => state.field === 'stats')?.statContext
      const data = await this.getStatData(), scope = resolveMarketStatScope(context, data.scopes)
      if (!this.unified.isOpen || version !== this.scopeVersion || scope.key !== key
        || !resolveMarketStatTiers(context, scope, data.scopes, statId).some((entry) => JSON.stringify(entry) === JSON.stringify(tier))) return false
      return await this.command({ action: 'stat-range', rowToken, statId, range: { min: tier.searchMin, max: tier.searchMax }, previous }) === true
    } catch { return false }
    finally { this.busy = false; this.schedule() }
  }

  private toggleStatScope(): void {
    if (this.busy) return
    this.allStats = !this.allStats
    this.batches = 1; this.renderStatScope(); this.renderStatCandidateScope(); this.renderCandidates()
  }

  private async cleanupStats(): Promise<void> {
    if (this.busy || !this.outsideStats.length) return
    const key = this.statScope.key, version = this.scopeVersion
    this.busy = true; this.renderStatScope()
    try {
      const snapshots = await this.command({ action: 'scan' }) as OfficialFilterSnapshot[]
      const data = await this.getStatData()
      const latest = resolveMarketStatScope(snapshots.find((state) => state.field === 'stats')?.statContext, data.scopes)
      // A rapid item change or navigation invalidates the displayed cleanup
      // proposal. Refresh its warning before allowing a new explicit cleanup.
      if (latest.key !== key || version !== this.scopeVersion || !this.unified.isOpen || !latest.ids) return
      const counts = await this.command({ action: 'counts' })
      const allowed = new Set(latest.ids), selected = new Set<string>(counts?.statIds || [])
      const remove = this.outsideStats.filter((id) => selected.has(id) && !allowed.has(id))
      const removed = await this.command({ action: 'prune', statIds: remove })
      if (!removed) throw new Error('stat cleanup failed')
      this.outsideStats = []
    } catch { this.scopeFailed = true }
    finally { this.busy = false; this.renderStatScope(); this.schedule() }
  }

  private renderStatCandidateScope(): void {
    if (this.active?.field !== 'stats' || !this.dialog) return
    const header = this.dialog.querySelector<HTMLElement>('.sp-market-picker-header')!
    let bar = header.querySelector<HTMLElement>('.sp-market-stat-candidate-context')
    if (!bar) { bar = this.element('div', 'sp-market-stat-candidate-context'); header.querySelector('.sp-market-picker-search')?.before(bar) }
    const text = this.element('span', '', this.statScopeLabel())
    bar.replaceChildren(text)
    if (this.statScope.ids) {
      const toggle = this.button(this.allStats ? this.options.text('Show related stats', '仅看相关词缀', '僅看相關詞綴', '관련 속성만 보기')
        : this.options.text('View all stats', '查看全部词缀', '查看全部詞綴', '모든 속성 보기'), () => this.toggleStatScope(), 'sp-market-stat-scope-toggle')
      toggle.setAttribute('aria-pressed', String(this.allStats)); toggle.disabled = this.busy; bar.append(toggle)
    }
  }

  private renderBinding(binding: Binding): void {
    const { state, host } = binding
    if (state.field === 'items') {
      if (this.itemSearch?.host !== host) {
        this.itemSearch?.dispose()
        this.itemSearch = new MarketItemSearch(host, { text: this.options.text, localize: this.options.localize,
          data: this.options.itemData, read: (token) => this.command({ action: 'read', token }),
          select: async (token, key) => {
            if (this.busy) return false
            this.busy = true
            try { return await this.command({ action: 'select', token, key }) }
            finally { this.busy = false; this.schedule() }
          } })
      }
      this.itemSearch.update(state)
      if (this.preservedItemSearch) {
        this.itemSearch.restoreViewState(this.preservedItemSearch)
        this.preservedItemSearch = undefined
      }
      return
    }
    host.replaceChildren()
    const l = this.options.text
    if (state.kind === 'picker') {
      const label = state.field === 'category' ? localizeMarketCategory(state.selectionValue ?? null, this.options.localize(state.selectionLabel || state.label), l)
        : state.multiple ? l('Add stats', '添加词缀', '新增詞綴', '속성 추가')
        : this.options.localize(state.selectionLabel || state.label)
      const trigger = this.button('', () => void this.open(state.token, trigger), 'sp-market-filter-trigger')
      trigger.setAttribute('aria-haspopup', 'dialog')
      trigger.setAttribute('aria-label', this.options.localize(state.label))
      trigger.disabled = Boolean(state.disabled)
      trigger.append(this.element('span', '', label), this.element('span', '', '▦'))
      host.appendChild(trigger)
    } else {
      const group = this.element('div', 'sp-market-filter-options')
      group.setAttribute('role', 'radiogroup')
      group.setAttribute('aria-label', this.options.localize(state.label))
      const candidates = state.candidates.filter((candidate) => state.field !== 'rarity'
        || (candidate.value !== 'uniquefoil' && candidate.value !== 'nonunique'))
      candidates.forEach((candidate, index) => {
        const selected = state.selected.includes(candidate.key) || (!state.selected.length && candidate.value === null)
        const button = this.button(state.field === 'status' ? l('Instant Buyout', '立即购买', '立即購買', '즉시 구매')
          : this.options.localize(candidate.source), () => void this.selectInline(binding, candidate), '')
        button.setAttribute('role', 'radio')
        button.setAttribute('aria-checked', String(selected))
        button.tabIndex = selected || (!state.selected.length && index === 0) ? 0 : -1
        button.disabled = Boolean(candidate.disabled)
        button.addEventListener('keydown', (event) => {
          if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return
          event.preventDefault()
          const buttons = Array.from(group.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'))
          const current = buttons.indexOf(button)
          const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
            : (current + (event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1) + buttons.length) % buttons.length
          buttons[next]?.focus()
          buttons[next]?.click()
        })
        group.appendChild(button)
      })
      host.appendChild(group)
    }
  }

  private async selectInline(binding: Binding, candidate: OfficialMarketCandidate): Promise<void> {
    if (this.busy || binding.state.selected.includes(candidate.key)) return
    this.busy = true
    const buttons = Array.from(binding.host.querySelectorAll('button'))
    buttons.forEach((button) => { button.disabled = true })
    try {
      const result = await this.command({ action: 'select', token: binding.state.token, key: candidate.key })
      if (!result || typeof result !== 'object') throw new Error('selection failed')
      binding.state = result
      binding.signature = ''
      this.renderBinding(binding)
      binding.host.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus()
    } catch {
      buttons.forEach((button) => { button.disabled = false })
      if (!binding.host.querySelector('.sp-market-filter-error')) binding.host.appendChild(this.element('span', 'sp-market-filter-error',
        this.options.text('Selection failed. Retry or close to use the original form.', '选择未成功，请重试或关闭后使用原表单。', '選擇未成功，請重試或關閉後使用原表單。', '선택하지 못했습니다. 다시 시도하거나 닫은 후 기존 양식을 사용하세요.')))
    } finally { this.busy = false; this.schedule() }
  }

  private async open(token: string, opener: HTMLElement): Promise<void> {
    const binding = this.bindings.get(token)
    if (this.busy || !binding || !this.unified.contains(binding.element)) return
    this.closeCandidate(false)
    this.options.beforeOpen()
    const request = ++this.request
    const l = this.options.text
    this.opener = opener
    this.query = ''; this.group = ''; this.batches = 1; this.notice = ''
    this.candidates = []
    this.active = this.bindings.get(token)?.state
    const dialog = this.element('dialog', 'sp-market-picker')
    dialog.dataset.superpoeMarketOwned = 'true'
    dialog.setAttribute('aria-modal', 'true')
    dialog.setAttribute('aria-labelledby', 'sp-market-picker-title')
    const header = this.element('div', 'sp-market-picker-header')
    const titleRow = this.element('div', 'sp-market-picker-title')
    const title = this.element('h2', '', this.active?.multiple ? l('Choose stats', '选择词缀', '選擇詞綴', '속성 선택')
      : this.options.localize(this.active?.label || l('Choose an option', '选择条件', '選擇條件', '조건 선택')))
    title.id = 'sp-market-picker-title'
    const close = this.button('×', () => this.closeCandidate())
    close.setAttribute('aria-label', l('Close', '关闭', '關閉', '닫기'))
    titleRow.append(title, close)
    const search = this.element('input', 'sp-market-picker-search')
    search.type = 'search'
    search.placeholder = l('Filter by keyword…', '输入关键词筛选…', '輸入關鍵字篩選…', '키워드로 검색…')
    search.setAttribute('aria-label', search.placeholder)
    search.addEventListener('input', (event) => {
      if (event instanceof InputEvent && event.isComposing) return
      this.query = search.value; this.batches = 1; this.renderCandidates()
    })
    search.addEventListener('compositionend', () => { this.query = search.value; this.batches = 1; this.renderCandidates() })
    header.append(titleRow, search)
    this.body = this.element('div', 'sp-market-picker-body', l('Loading options…', '正在加载选项…', '正在載入選項…', '항목 불러오는 중…'))
    const footer = this.element('div', 'sp-market-picker-footer')
    this.status = this.element('span', 'sp-market-picker-status')
    this.status.setAttribute('aria-live', 'polite')
    footer.append(this.status,
      this.button(l('Done', '完成', '完成', '완료'), () => this.closeCandidate(), 'sp-market-picker-done'))
    dialog.append(header, this.body, footer)
    dialog.addEventListener('cancel', (event) => { event.preventDefault(); event.stopPropagation(); if (!this.busy) this.closeCandidate() })
    dialog.addEventListener('keydown', (event) => {
      if (event.isComposing) return
      if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); if (!this.busy) this.closeCandidate(); return }
      if (event.key === 'Tab') {
        const focusable = Array.from(dialog.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled)'))
        const first = focusable[0], last = focusable.at(-1)
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
      }
      const cards = Array.from(dialog.querySelectorAll<HTMLButtonElement>('.sp-market-picker-option:not(:disabled)'))
      if (event.key === 'Enter' && event.target === search) { event.preventDefault(); cards[0]?.click(); return }
      if (event.key === 'ArrowDown' && event.target === search) { event.preventDefault(); cards[0]?.focus(); return }
      if (event.key === 'Enter' && event.target === search) { event.preventDefault(); cards[0]?.click(); return }
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key) && cards.includes(event.target as HTMLButtonElement)) {
        event.preventDefault()
        if (this.active?.multiple) {
          const current = (event.target as HTMLElement).getBoundingClientRect()
          const vertical = event.key === 'ArrowUp' || event.key === 'ArrowDown'
          const direction = event.key === 'ArrowUp' || event.key === 'ArrowLeft' ? -1 : 1
          const x = current.left + current.width / 2, y = current.top + current.height / 2
          const next = cards.filter((card) => card !== event.target).map((card) => {
            const rect = card.getBoundingClientRect()
            const dx = rect.left + rect.width / 2 - x, dy = rect.top + rect.height / 2 - y
            return { card, along: (vertical ? dy : dx) * direction, across: Math.abs(vertical ? dx : dy) }
          }).filter(({ along }) => along > 2).sort((a, b) => a.along + a.across * 3 - b.along - b.across * 3)[0]
          next?.card.focus()
          return
        }
        const index = cards.indexOf(event.target as HTMLButtonElement)
        const columns = Math.max(1, Math.round((this.body!.clientWidth - 44) / (cards[0]?.offsetWidth || 250)))
        const delta = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : event.key === 'ArrowUp' ? -columns : columns
        cards[Math.min(cards.length - 1, Math.max(0, index + delta))]?.focus()
      }
    })
    document.body.appendChild(dialog)
    this.dialog = dialog; this.search = search
    this.options.modalState(true)
    dialog.showModal()
    search.focus()
    await this.load(token, request, header)
  }

  private async load(token: string, request: number, header: HTMLElement): Promise<void> {
    try {
      const state = await this.command({ action: 'read', token }) as OfficialFilterSnapshot | false
      if (request !== this.request || !this.dialog?.open) return
      if (!state || !state.candidates.length) throw new Error('empty catalog')
      let candidates = state.candidates
      if (state.field === 'items') {
        const data = await this.options.itemData()
        if (request !== this.request || !this.dialog?.open) return
        candidates = enrichOfficialItemCandidates(candidates, data.catalog, data.categories)
        const scope = state.itemScope
        const context = [scope?.category ? this.options.localize(scope.categoryLabel || scope.category) : '',
          scope?.rarity ? this.options.localize(scope.rarityLabel || scope.rarity) : ''].filter(Boolean)
        header.querySelector('.sp-market-picker-scope')?.remove()
        header.appendChild(this.element('div', 'sp-market-picker-scope', context.length
          ? `${this.options.text('Search within', '搜索范围', '搜尋範圍', '검색 범위')} · ${context.join(' · ')}`
          : this.options.text('All item types and rarities', '全部类型与稀有度', '全部類型與稀有度', '모든 유형 및 희귀도')))
      }
      if (state.field === 'stats') {
        const data = await this.getStatData()
        if (request !== this.request || !this.dialog?.open) return
        candidates = enrichMarketStatCandidates(candidates, data, this.options.localize)
        this.statContext = state.statContext
        const scope = resolveMarketStatScope(state.statContext, data.scopes)
        if (scope.key !== this.statScope.key) this.allStats = false
        this.statScope = scope
      }
      this.active = state
      this.renderStatCandidateScope()
      this.candidates = candidates.map((candidate) => ({ ...candidate, text: candidate.field === 'category'
        ? localizeMarketCategory(candidate.value, this.options.localize(candidate.source), this.options.text)
        : candidate.field === 'stats' ? candidate.text : this.options.localize(candidate.source) }))
      const groups = [...new Set(this.candidates.map((candidate) => candidate.group).filter(Boolean))]
      if (state.multiple && groups.length > 1) {
        const tabs = this.element('div', 'sp-market-picker-groups')
        const add = (group: string, label: string) => {
          const button = this.button(label, () => {
            this.group = group; this.batches = 1
            tabs.querySelectorAll('button').forEach((entry) => entry.setAttribute('aria-pressed', String(entry === button)))
            this.renderCandidates()
          })
          button.setAttribute('aria-pressed', String(!group))
          tabs.appendChild(button)
        }
        add('', this.options.text('All', '全部', '全部', '전체'))
        groups.forEach((group) => add(group, this.statGroupLabel(group)))
        header.querySelector('.sp-market-picker-groups')?.remove()
        header.appendChild(tabs)
      }
      this.renderCandidates()
    } catch {
      if (request !== this.request || !this.body) return
      this.body.replaceChildren(this.element('div', 'sp-market-picker-notice', this.options.text(
        'Options could not be loaded. Retry or close to use the original form.', '选项加载失败，请重试或关闭后使用原表单。',
        '選項載入失敗，請重試或關閉後使用原表單。', '항목을 불러오지 못했습니다. 다시 시도하거나 닫은 후 기존 양식을 사용하세요.')),
      this.button(this.options.text('Retry', '重试', '重試', '다시 시도'), () => void this.load(token, request, header)))
    }
  }

  private statGroupLabel(group: string): string {
    const labels: Record<string, [string, string, string, string]> = {
      explicit: ['Explicit', '显式词缀', '隨機詞綴', '명시 속성'], implicit: ['Implicit', '隐式词缀', '固定詞綴', '고정 속성'],
      pseudo: ['Pseudo', '伪属性／综合', '偽屬性', '유사 속성'], fractured: ['Fractured', '分裂词缀', '破裂詞綴', '분열 속성'],
      crafted: ['Crafted', '工艺词缀', '工藝詞綴', '제작 속성'], enchant: ['Enchantment', '附魔', '附魔', '인챈트'],
      rune: ['Rune', '符文', '符文', '룬'], augment: ['Augment', '符文／增幅', '符文／增幅', '증강'],
      desecrated: ['Desecrated', '渎灵词缀', '褻瀆詞綴', '훼손 속성'],
      sanctum: ['Sanctum relic', '圣所遗物', '禁域聖物', '성역 유물'], skill: ['Granted skill', '授予技能', '賦予技能', '부여된 스킬'],
    }
    const label = labels[group.toLowerCase()]
    return label ? this.options.text(...label) : this.options.localize(group)
  }

  private renderCandidates(): void {
    if (!this.body || !this.active) return
    this.dialog?.querySelectorAll<HTMLButtonElement>('.sp-market-stat-candidate-context button').forEach((button) => { button.disabled = this.busy })
    const l = this.options.text
    const scroll = this.body.scrollTop
    const scoped = this.active.field === 'stats' ? scopeMarketStatCandidates(this.candidates, this.statScope, this.allStats) : this.candidates
    const matches = filterOfficialMarketCandidates(scoped, this.query, this.group, this.active.itemScope)
    const unique = this.active.field === 'stats' && this.statScope.kind === 'unique' && !this.allStats
    const sections = this.active.multiple ? (unique ? [
      { id: 'unique', label: l('Item properties', '自身属性', '自身屬性', '고유 속성'), rows: matches.filter((row) => String(row.value).startsWith('explicit.')) },
      { id: 'implicit', label: l('Base implicits', '基底固定属性', '基底固定屬性', '기본 고정 속성'), rows: matches.filter((row) => /^(implicit|skill)\./.test(String(row.value))) },
    ] : [
      { id: 'prefix', label: l('Prefixes', '前缀', '前綴', '접두어'), rows: matches.filter((row) => row.affixes?.includes('prefix')) },
      { id: 'suffix', label: l('Suffixes', '后缀', '後綴', '접미어'), rows: matches.filter((row) => row.affixes?.includes('suffix')) },
      { id: 'other', label: l('Other / unclassified stats', '其他／未分类词缀', '其他／未分類詞綴', '기타 / 미분류 속성'), rows: matches.filter((row) => !row.affixes?.length) },
    ]).map((section) => ({ ...section, shown: officialMarketCandidatePage(section.rows, this.batches) })) : []
    const shown = sections.length ? [...new Map(sections.flatMap((section) => section.shown).map((row) => [row.key, row])).values()]
      : officialMarketCandidatePage(matches, this.batches)
    const fragment = document.createDocumentFragment()
    fragment.appendChild(this.element('div', 'sp-market-picker-count', `${matches.length} ${l('matches', '项匹配', '項符合', '개 일치')} · ${shown.length} ${l('shown', '项已显示', '項已顯示', '개 표시')}`))
    if (this.notice) fragment.appendChild(this.element('div', 'sp-market-picker-notice', this.notice))
    if (!matches.length) fragment.appendChild(this.element('div', 'sp-market-picker-count', l('No matching options. Try a different keyword.', '没有匹配项，请更换关键词。', '沒有符合項目，請更換關鍵字。', '일치하는 항목이 없습니다. 다른 키워드를 입력하세요.')))
    const makeCard = (candidate: OfficialMarketCandidate) => {
      const selected = this.active!.selected.includes(candidate.key)
      const card = this.button('', () => void this.selectCandidate(candidate), 'sp-market-picker-option')
      card.dataset.candidateKey = candidate.key
      card.disabled = Boolean(candidate.disabled) || this.busy || (this.active!.multiple && selected)
      card.setAttribute('aria-pressed', String(selected))
      card.appendChild(this.element('strong', '', candidate.text))
      let itemDetail = ''
      if (candidate.item) {
        const rarity = officialItemCandidateRarity(candidate, this.active?.itemScope)
        card.dataset.rarity = rarity
        const labels: Record<string, string> = {
          base: l('Base type', '底材', '基底', '기본 유형'), normal: l('Normal', '普通', '普通', '일반'),
          magic: l('Magic', '魔法', '魔法', '마법'), rare: l('Rare', '稀有', '稀有', '희귀'),
          unique: l('Unique', '暗金／传奇', '傳奇', '고유'),
        }
        itemDetail = [labels[rarity], this.options.localize(candidate.item.type),
          this.options.localize(candidate.item.categoryLabel || candidate.item.category || '')].filter(Boolean).join(' · ')
      }
      const detail = [itemDetail || (candidate.group ? this.statGroupLabel(candidate.group) : ''),
        candidate.affixes?.length === 2 ? l('Prefix or suffix, depending on item', '前／后缀，取决于物品', '前／後綴，取決於物品', '아이템에 따라 접두어 또는 접미어') : '',
        candidate.text !== candidate.source ? candidate.source : '',
        selected ? l('Selected', '已添加／选中', '已新增／選取', '선택됨') : ''].filter(Boolean).join(' · ')
      if (detail) card.appendChild(this.element('small', '', detail))
      return card
    }
    if (sections.length) {
      const columns = this.element('div', 'sp-market-stat-columns')
      for (const section of sections) {
        if (section.id === 'other' && !section.rows.length) continue
        const pane = this.element('section', 'sp-market-stat-section')
        pane.dataset.affix = section.id
        const heading = this.element('h3', '', section.label)
        heading.append(this.element('span', 'sp-market-stat-section-count', String(section.rows.length)))
        pane.append(heading)
        const grid = this.element('div', 'sp-market-picker-grid')
        section.shown.forEach((candidate) => grid.append(makeCard(candidate)))
        pane.append(grid)
        if (!section.rows.length) pane.append(this.element('div', 'sp-market-picker-count', l('No matching stats', '暂无匹配词缀', '暫無符合詞綴', '일치하는 속성 없음')))
        columns.append(pane)
      }
      fragment.append(columns)
    } else {
      const grid = this.element('div', 'sp-market-picker-grid')
      shown.forEach((candidate) => grid.append(makeCard(candidate)))
      fragment.append(grid)
    }
    if (shown.length < matches.length) fragment.appendChild(this.button(l('Load more', '加载更多', '載入更多', '더 보기'),
      () => { this.batches++; this.renderCandidates() }, 'sp-market-picker-more'))
    this.body.replaceChildren(fragment)
    this.body.scrollTop = scroll
    if (this.status) this.status.textContent = this.busy ? l('Applying selection…', '正在应用选择…', '正在套用選擇…', '선택 적용 중…')
      : this.active.multiple ? `${l('Added', '已添加', '已新增', '추가됨')} ${this.active.selected.length}` : l('Select an option to apply', '点选后立即应用', '點選後立即套用', '선택하면 바로 적용됩니다')
  }

  private async selectCandidate(candidate: OfficialMarketCandidate): Promise<void> {
    if (!this.active || this.busy) return
    const token = this.active.token
    const request = this.request
    this.busy = true; this.notice = ''; this.renderCandidates()
    try {
      const result = await this.command({ action: 'select', token, key: candidate.key })
      if (request !== this.request) return
      if (!result || typeof result !== 'object') throw new Error('selection failed')
      this.active = result
      if (!this.active!.multiple) this.closeCandidate()
    } catch {
      if (request === this.request) this.notice = this.options.text(
        'Selection was not confirmed. Retry or close to use the original form.', '未能确认选择结果，请重试或关闭后使用原表单。',
        '未能確認選擇結果，請重試或關閉後使用原表單。', '선택을 확인하지 못했습니다. 다시 시도하거나 닫은 후 기존 양식을 사용하세요.')
    } finally {
      this.busy = false
      if (request === this.request && this.dialog?.open) {
        this.renderCandidates()
        this.search?.focus()
      }
      this.schedule()
    }
  }

  close(restoreFocus = true): void {
    this.closeCandidate(restoreFocus && !this.unified.isOpen)
    this.unified.close(restoreFocus)
  }

  private closeCandidate(restoreFocus = true): void {
    this.request++
    if (this.dialog) {
      this.dialog.close(); this.dialog.remove(); this.dialog = undefined
      this.options.modalState(this.unified.isOpen)
    }
    this.active = undefined; this.body = undefined; this.status = undefined; this.search = undefined
    if (restoreFocus && this.opener?.isConnected) this.opener.focus()
    this.opener = undefined
  }
}

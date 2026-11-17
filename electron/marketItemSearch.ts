import { enrichOfficialItemCandidates, filterOfficialMarketCandidates, officialItemCandidateRarity, officialMarketCandidatePage, type OfficialMarketCandidate } from '../src/engine/marketOfficialSuggestions.js'
import type { OfficialFilterSnapshot } from './marketFilterAdapter.js'
import { localizeMarketCategory } from '../src/engine/marketCategoryTranslation.js'

interface ItemSearchOptions {
  text: (en: string, cn: string, tw: string, ko: string) => string
  localize: (source: string) => string
  data: () => Promise<{ catalog: unknown; categories: Array<[string, string]> }>
  read: (token: string) => Promise<OfficialFilterSnapshot | false>
  select: (token: string, key: string) => Promise<OfficialFilterSnapshot | false>
}

export interface MarketItemSearchViewState {
  query: string
  batches: number
  scrollTop: number
}

/** Item results stay alongside the official category and rarity controls. */
export class MarketItemSearch {
  private state?: OfficialFilterSnapshot
  private candidates: OfficialMarketCandidate[] = []
  private signature = ''
  private request = 0
  private batches = 1
  private busy = false
  private notice = ''
  private ready = false
  private search = document.createElement('input')
  private selection = document.createElement('div')
  private scope = document.createElement('div')
  private count = document.createElement('div')
  private results = document.createElement('div')
  private pendingScrollTop?: number
  private resultsSignature = ''

  constructor(readonly host: HTMLElement, private readonly options: ItemSearchOptions) {
    const l = options.text
    this.search.className = 'sp-market-item-query'
    this.search.type = 'search'
    this.search.placeholder = l('Search item names or base types…', '搜索物品名称或底材…', '搜尋物品名稱或基底…', '아이템 이름 또는 기본 유형 검색…')
    this.search.setAttribute('aria-label', this.search.placeholder)
    const search = () => { this.batches = 1; this.pendingScrollTop = undefined; this.results.scrollTop = 0; this.render() }
    this.search.addEventListener('input', (event) => { if (!(event instanceof InputEvent) || !event.isComposing) search() })
    this.search.addEventListener('compositionend', search)
    this.selection.className = 'sp-market-item-selected'
    this.selection.setAttribute('aria-live', 'polite')
    this.scope.className = 'sp-market-picker-scope'
    this.count.className = 'sp-market-picker-count sp-market-item-count'
    this.count.setAttribute('aria-live', 'polite')
    this.results.className = 'sp-market-item-results'
    this.results.setAttribute('aria-label', l('Matching items', '匹配物品', '符合的物品', '일치하는 아이템'))
    const searchField = document.createElement('div')
    searchField.className = 'sp-market-item-query-field'
    const searchIcon = document.createElement('span')
    searchIcon.className = 'sp-market-item-query-icon'
    searchIcon.setAttribute('aria-hidden', 'true')
    searchField.append(searchIcon, this.search)
    host.classList.add('sp-market-item-search')
    host.append(searchField, this.selection, this.scope, this.count, this.results)
    host.addEventListener('keydown', (event) => {
      if (event.isComposing) return
      const cards = Array.from(this.results.querySelectorAll<HTMLButtonElement>('.sp-market-item-option:not(:disabled)'))
      if (event.target === this.search && ['Enter', 'ArrowDown'].includes(event.key)) {
        event.preventDefault(); event.stopPropagation()
        if (event.key === 'Enter') cards[0]?.click()
        else cards[0]?.focus()
      } else if (cards.includes(event.target as HTMLButtonElement) && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
        event.preventDefault(); event.stopPropagation()
        const grid = this.results.querySelector<HTMLElement>('.sp-market-picker-grid')!
        const columns = Math.max(1, getComputedStyle(grid).gridTemplateColumns.split(' ').length)
        const delta = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : event.key === 'ArrowUp' ? -columns : columns
        cards[Math.max(0, Math.min(cards.length - 1, cards.indexOf(event.target as HTMLButtonElement) + delta))]?.focus()
      }
    })
  }

  update(state: OfficialFilterSnapshot): void {
    const signature = this.signatureFor(state)
    if (signature === this.signature) return
    const reload = !this.state || this.state.token !== state.token || this.state.disabled !== state.disabled
    const previousScope = this.state ? JSON.stringify([this.state.itemScope?.category, this.state.itemScope?.rarity]) : ''
    const nextScope = JSON.stringify([state.itemScope?.category, state.itemScope?.rarity])
    this.signature = signature
    this.state = state
    this.search.disabled = Boolean(state.disabled)
    // Selecting an item changes the official value but does not change the
    // result set. Keep the loaded page count so the scroll container does not
    // shrink and jump back to the top. Scope changes still start at page one.
    if (previousScope !== nextScope) { this.batches = 1; this.pendingScrollTop = undefined; this.results.scrollTop = 0 }
    this.notice = ''
    this.render()
    if (reload) void this.load(state.token)
  }

  private signatureFor(state: OfficialFilterSnapshot): string {
    return JSON.stringify([state.token, state.selected, state.selectionLabel, state.itemScope, state.disabled])
  }

  getViewState(): MarketItemSearchViewState {
    return { query: this.search.value, batches: this.batches, scrollTop: this.results.scrollTop }
  }

  restoreViewState(view: MarketItemSearchViewState): void {
    this.search.value = view.query
    this.batches = Math.max(1, view.batches)
    this.pendingScrollTop = Math.max(0, view.scrollTop)
    this.render()
  }

  dispose(): void { this.request++; this.host.replaceChildren() }

  private element(tag: string, className: string, text = ''): HTMLElement {
    const element = document.createElement(tag)
    element.className = className; element.textContent = text
    if (tag === 'button') element.classList.add('sp-market-control')
    return element
  }

  private async load(token: string): Promise<void> {
    const request = ++this.request
    this.results.setAttribute('aria-busy', 'true')
    this.render()
    try {
      const [state, data] = await Promise.all([this.options.read(token), this.options.data()])
      if (request !== this.request || !this.host.isConnected) return
      if (!state) throw new Error('Item field unavailable')
      this.state = state
      this.signature = this.signatureFor(state)
      this.candidates = enrichOfficialItemCandidates(state.candidates, data.catalog, data.categories)
        .map((candidate) => ({ ...candidate, text: this.options.localize(candidate.source) }))
      this.ready = true
    } catch {
      if (request !== this.request || !this.host.isConnected) return
      this.notice = this.options.text('Items could not be loaded. Retry.', '物品加载失败，请重试。', '物品載入失敗，請重試。', '아이템을 불러오지 못했습니다. 다시 시도하세요.')
    }
    this.results.setAttribute('aria-busy', 'false')
    this.render()
  }

  private render(): void {
    if (!this.state) return
    const l = this.options.text
    this.selection.textContent = this.state.selectionLabel
      ? `${l('Selected', '已选物品', '已選物品', '선택됨')} · ${this.options.localize(this.state.selectionLabel)}` : ''
    const scope = this.state.itemScope
    const labels = [scope?.category ? localizeMarketCategory(scope.category, this.options.localize(scope.categoryLabel || scope.category), l) : '',
      scope?.rarity ? this.options.localize(scope.rarityLabel || scope.rarity) : ''].filter(Boolean)
    this.scope.textContent = labels.length ? `${l('Search within', '搜索范围', '搜尋範圍', '검색 범위')} · ${labels.join(' · ')}`
      : l('All item types and rarities', '全部类型与稀有度', '全部類型與稀有度', '모든 유형 및 희귀도')
    // A selection only changes card state. Keep the result nodes, focus and
    // scroll container intact through official Vue updates and delayed scans.
    const resultsSignature = JSON.stringify([this.ready, this.notice, this.search.value, this.batches, scope, this.candidates])
    if (resultsSignature === this.resultsSignature) {
      for (const card of this.results.querySelectorAll<HTMLButtonElement>('.sp-market-item-option')) {
        card.disabled = this.busy || Boolean(this.state.disabled || card.dataset.candidateDisabled === 'true')
        card.setAttribute('aria-pressed', String(this.state.selected.includes(card.dataset.candidateKey!)))
      }
      return
    }
    this.resultsSignature = resultsSignature
    const scroll = this.pendingScrollTop ?? this.results.scrollTop
    const focusedKey = this.results.contains(document.activeElement)
      ? (document.activeElement as HTMLElement).dataset.candidateKey : undefined
    const fragment = document.createDocumentFragment()
    this.count.textContent = ''
    if (this.notice) fragment.append(this.element('div', 'sp-market-picker-notice', this.notice))
    if (!this.ready) {
      if (this.notice) {
        const retry = this.element('button', '', l('Retry', '重试', '重試', '다시 시도')) as HTMLButtonElement
        retry.type = 'button'
        retry.addEventListener('click', () => { this.notice = ''; void this.load(this.state!.token) })
        fragment.append(retry)
      } else this.count.textContent = l('Loading items…', '正在加载物品…', '正在載入物品…', '아이템 불러오는 중…')
    } else {
      const matches = filterOfficialMarketCandidates(this.candidates, this.search.value, '', scope)
      const shown = officialMarketCandidatePage(matches, this.batches)
      this.count.textContent = `${matches.length} ${l('matches', '项匹配', '項符合', '개 일치')} · ${shown.length} ${l('shown', '项已显示', '項已顯示', '개 표시')}`
      if (!matches.length) fragment.append(this.element('div', 'sp-market-picker-count', l(
        'No matching items. Change the keyword or filters.', '没有匹配物品，请修改关键词或筛选条件。', '沒有符合的物品，請修改關鍵字或篩選條件。', '일치하는 아이템이 없습니다. 키워드나 필터를 변경하세요.')))
      const grid = this.element('div', 'sp-market-picker-grid')
      const rarityLabels: Record<string, string> = {
        base: l('Base type', '底材', '基底', '기본 유형'), normal: l('Normal', '普通', '普通', '일반'),
        magic: l('Magic', '魔法', '魔法', '마법'), rare: l('Rare', '稀有', '稀有', '희귀'), unique: l('Unique', '暗金／传奇', '傳奇', '고유'),
      }
      for (const candidate of shown) {
        const card = this.element('button', 'sp-market-item-option') as HTMLButtonElement
        card.type = 'button'; card.disabled = this.busy || Boolean(this.state.disabled || candidate.disabled)
        card.dataset.candidateKey = candidate.key
        card.dataset.candidateDisabled = String(Boolean(candidate.disabled))
        card.setAttribute('aria-pressed', String(this.state.selected.includes(candidate.key)))
        card.dataset.rarity = officialItemCandidateRarity(candidate, scope)
        card.append(this.element('strong', '', candidate.text))
        const detail = [rarityLabels[card.dataset.rarity], candidate.item?.type ? this.options.localize(candidate.item.type) : '',
          this.options.localize(candidate.item?.categoryLabel || candidate.item?.category || ''),
          candidate.text !== candidate.source ? candidate.source : ''].filter(Boolean).join(' · ')
        card.append(this.element('small', '', detail))
        card.addEventListener('click', () => void this.select(candidate))
        grid.append(card)
      }
      fragment.append(grid)
      if (shown.length < matches.length) {
        const more = this.element('button', 'sp-market-item-more', l('Load more', '加载更多', '載入更多', '더 보기')) as HTMLButtonElement
        more.type = 'button'; more.addEventListener('click', () => { this.batches++; this.render() }); fragment.append(more)
      }
    }
    this.results.replaceChildren(fragment)
    if (this.ready) {
      this.results.scrollTop = scroll
      this.pendingScrollTop = undefined
      if (focusedKey) Array.from(this.results.querySelectorAll<HTMLButtonElement>('.sp-market-item-option'))
        .find((card) => card.dataset.candidateKey === focusedKey)?.focus({ preventScroll: true })
    }
  }

  private async select(candidate: OfficialMarketCandidate): Promise<void> {
    if (this.busy || !this.state) return
    const request = this.request
    const focusedCard = this.results.contains(document.activeElement) ? document.activeElement as HTMLButtonElement : undefined
    this.busy = true; this.notice = ''; this.render()
    try {
      const result = await this.options.select(this.state.token, candidate.key)
      if (request !== this.request || !this.host.isConnected) return
      if (!result) throw new Error('Selection failed')
      this.state = result
      this.signature = this.signatureFor(result)
    } catch {
      if (request === this.request) this.notice = this.options.text('Selection failed. Please retry.', '选择失败，请重试。', '選擇失敗，請重試。', '선택하지 못했습니다. 다시 시도하세요.')
    } finally {
      this.busy = false
      if (request === this.request && this.host.isConnected) {
        this.render()
        if (focusedCard?.isConnected) focusedCard.focus({ preventScroll: true })
      }
    }
  }
}

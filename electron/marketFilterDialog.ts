import { MarketStatReadOnly } from './marketStatReadOnly.js'
import { MarketStatTierControls, type MarketStatTierView } from './marketStatTierControls.js'

interface DialogOptions {
  text: (en: string, cn: string, tw: string, ko: string) => string
  beforeOpen: () => void
  changed: () => void
  closePicker: () => void
  switchTab: () => void
}

type FilterTab = 'items' | 'conditions' | 'stats'

export interface MarketStatScopeView {
  label: string
  hint: string
  all: boolean
  canScope: boolean
  outside: string[]
  busy: boolean
  toggle: () => void
  cleanup: () => void
  retry?: () => void
}

/** Reuses the official Vue-owned nodes, including their handlers and model refs. */
export class MarketFilterDialog {
  private toolbar?: HTMLDivElement
  private dialog?: HTMLDialogElement
  private sources: HTMLElement[] = []
  private moved: Array<{ node: HTMLElement; placeholder: Comment }> = []
  private basics?: HTMLElement
  private panels = new Map<FilterTab, HTMLElement>()
  private tabs = new Map<FilterTab, HTMLButtonElement>()
  private scroll = new Map<FilterTab, number>()
  private activeTab: FilterTab = 'items'
  private shortcutTabs = new Map<FilterTab, HTMLButtonElement>()
  private native = true
  private opener?: HTMLElement
  private conditionNavigation?: HTMLElement
  private conditionLinks = new Map<HTMLElement, HTMLButtonElement>()
  private conditionGroups: HTMLElement[] = []
  private activeConditionGroup?: HTMLElement
  private conditionLayoutObserver?: ResizeObserver
  private conditionHeaders = new Map<HTMLElement, Array<[string, string | null]>>()
  private statReadOnly?: MarketStatReadOnly
  private statScope?: HTMLDivElement
  private statScopeSignature = ''
  private statTiers?: MarketStatTierControls

  constructor(private readonly options: DialogOptions) {}
  get isOpen(): boolean { return Boolean(this.dialog?.open) }
  contains(element: Element): boolean { return Boolean(this.dialog?.open && this.dialog.contains(element)) }

  updateStatTiers(view: MarketStatTierView): void {
    const panel = this.panels.get('stats')
    if (!panel || !this.isOpen) return
    this.statTiers ??= new MarketStatTierControls(panel, this.options.text)
    this.statTiers.update(view)
  }

  arrangeField(field: string, element: HTMLElement): void {
    if (!this.isOpen || !this.basics) return
    if (field === 'category' || field === 'rarity') {
      const target = this.basics.querySelector<HTMLElement>(field === 'rarity' ? '.sp-market-unified-item-details' : '.sp-market-unified-item-filters')!
      if (!target.contains(element)) this.move(element.closest<HTMLElement>('.filter-property') || element, target)
      return
    }
    if (field !== 'price') return
    let target = this.basics.querySelector<HTMLElement>('.sp-market-unified-price')
    if (!target) {
      target = document.createElement('div'); target.className = 'sp-market-unified-price'
      this.basics.querySelector('.sp-market-unified-item-filters')!.append(target)
    }
    if (target.contains(element)) return
    const node = element.closest<HTMLElement>('.filter-property') || element.closest<HTMLElement>('.filter-body') || element
    this.move(node, target)
  }

  arrangeNumericFields(labels: Array<[string, string]>): void {
    const target = this.basics?.querySelector<HTMLElement>('.sp-market-unified-item-details')
    if (!this.isOpen || !target) return
    for (const field of ['ilvl', 'quality']) {
      const names = labels.filter(([id]) => id === field).map(([, label]) => label.trim().toLocaleLowerCase())
      const row = Array.from(this.dialog!.querySelectorAll<HTMLElement>('.filter-property')).find((node) =>
        node.dataset.superpoeNumericField === field || (node.querySelector('input.minmax')
          && names.includes(node.querySelector('.filter-title')?.textContent?.trim().toLocaleLowerCase() || '')))
      if (row && !target.contains(row)) this.move(row, target)
    }
  }

  private move(node: HTMLElement, target: HTMLElement): void {
    const placeholder = document.createComment('superpoe-official-filter-position')
    node.before(placeholder)
    this.moved.push({ node, placeholder })
    node.dataset.superpoeOfficialSource = 'true'
    node.classList.remove('sp-market-unified-collapsed')
    target.append(node)
  }

  private button(label: string, action: () => void, className = ''): HTMLButtonElement {
    const button = document.createElement('button')
    button.type = 'button'; button.className = className; button.textContent = label
    button.classList.add('sp-market-control')
    button.addEventListener('click', (event) => { event.preventDefault(); event.stopPropagation(); action() })
    return button
  }

  updateCounts(counts: { conditions: number; stats: number }): void {
    for (const id of ['conditions', 'stats'] as const) {
      const badge = this.tabs.get(id)?.querySelector<HTMLElement>('.sp-market-tab-count')
      const count = String(counts[id])
      if (badge && badge.textContent !== count) badge.textContent = count
    }
  }

  openTab(id: FilterTab): void {
    if (!this.isOpen) this.open()
    if (this.isOpen && id !== this.activeTab) this.selectTab(id)
  }

  updateStatScope(view: MarketStatScopeView): void {
    const panel = this.panels.get('stats')
    if (!panel) return
    const signature = JSON.stringify([view.label, view.hint, view.all, view.canScope, view.outside, view.busy, Boolean(view.retry)])
    if (signature !== this.statScopeSignature || !this.statScope?.isConnected) {
      this.statScopeSignature = signature
      this.statScope ??= document.createElement('div')
      this.statScope.className = 'sp-market-stat-context'
      this.statScope.dataset.superpoeMarketOwned = 'true'
      const title = document.createElement('strong'); title.textContent = view.label
      const line = document.createElement('div'); line.className = 'sp-market-stat-context-line'; line.append(title)
      if (view.canScope) {
        const toggle = this.button(view.all ? this.options.text('Show related stats', '仅看相关词缀', '僅看相關詞綴', '관련 속성만 보기')
          : this.options.text('View all stats', '查看全部词缀', '查看全部詞綴', '모든 속성 보기'), view.toggle, 'sp-market-stat-scope-toggle')
        toggle.setAttribute('aria-pressed', String(view.all)); toggle.disabled = view.busy; line.append(toggle)
      }
      if (view.retry) line.append(this.button(this.options.text('Retry', '重试', '重試', '다시 시도'), view.retry))
      this.statScope.replaceChildren(line)
      if (view.hint) {
        const hint = document.createElement('div'); hint.className = 'sp-market-stat-context-hint'; hint.textContent = view.hint
        hint.setAttribute('role', 'status'); this.statScope.append(hint)
      }
      if (view.outside.length) {
        const warning = document.createElement('div'); warning.className = 'sp-market-stat-context-warning'
        const message = document.createElement('span')
        message.textContent = this.options.text(`${view.outside.length} selected stats may not apply to this item.`,
          `${view.outside.length} 项已选条件可能不适用于当前物品。`, `${view.outside.length} 項已選條件可能不適用於目前物品。`, `${view.outside.length}개 선택한 속성이 현재 아이템에 적용되지 않을 수 있습니다.`)
        const clear = this.button(this.options.text('Clear these conditions', '清理这些条件', '清理這些條件', '해당 조건 제거'), view.cleanup, 'sp-market-stat-cleanup')
        clear.disabled = view.busy; warning.append(message, clear); this.statScope.append(warning)
      }
      panel.prepend(this.statScope)
    }
    const outside = new Set(view.outside)
    for (const row of panel.querySelectorAll<HTMLElement>('.filter-property, .filter[data-superpoe-stat-id]')) {
      const id = row.dataset.superpoeStatId || row.dataset.statId || ''
      const flagged = outside.has(id)
      row.classList.toggle('sp-market-stat-outside', flagged)
      let note = row.querySelector<HTMLElement>('.sp-market-stat-outside-note')
      if (flagged && !note) {
        note = document.createElement('small'); note.className = 'sp-market-stat-outside-note'
        note.textContent = this.options.text('May not apply', '可能不适用', '可能不適用', '적용되지 않을 수 있음')
        const label = row.querySelector('.filter-title'); if (label) label.append(note)
      } else if (!flagged) note?.remove()
    }
  }

  ready(): void {
    this.updateConditionNavigation()
    if (!this.dialog?.hasAttribute('data-superpoe-filter-loading')) return
    this.dialog.removeAttribute('data-superpoe-filter-loading')
    this.dialog.setAttribute('aria-busy', 'false')
    const body = this.dialog.querySelector<HTMLElement>(':scope > .sp-market-picker-body')
    if (body) body.inert = false
    this.dialog.querySelector('.sp-market-unified-loading')?.remove()
  }

  private selectTab(id: FilterTab): void {
    if (id === this.activeTab) return
    this.options.switchTab()
    const body = this.dialog!.querySelector<HTMLElement>(':scope > .sp-market-picker-body')!
    this.scroll.set(this.activeTab, body.scrollTop)
    this.activeTab = id
    for (const [key, panel] of this.panels) panel.hidden = key !== id
    for (const [key, tab] of this.tabs) {
      tab.setAttribute('aria-selected', String(key === id))
      tab.tabIndex = key === id ? 0 : -1
    }
    this.updateToolbarShortcuts(id)
    if (this.conditionNavigation) this.conditionNavigation.hidden = id !== 'conditions' || !this.conditionLinks.size
    this.layoutConditionGroups()
    body.scrollTop = this.scroll.get(id) || 0
    this.updateConditionLocation()
  }

  private updateConditionNavigation(): void {
    const panel = this.panels.get('conditions')
    const nav = this.conditionNavigation
    if (!panel || !nav) return
    const groups = Array.from(panel.querySelectorAll<HTMLElement>('.filter-group')).filter((group) =>
      group.querySelector('.filter-property') && group.querySelector(':scope > .filter-group-header .filter-title')?.textContent?.trim())
    this.conditionGroups = groups
    this.conditionLayoutObserver ??= new ResizeObserver(() => {
      this.layoutConditionGroups()
      this.updateConditionLocation()
    })
    for (const [group, button] of this.conditionLinks) {
      if (groups.includes(group)) continue
      this.conditionLayoutObserver.unobserve(group)
      group.style.removeProperty('--sp-market-condition-span')
      button.remove(); this.conditionLinks.delete(group)
    }
    for (const [index, group] of groups.entries()) {
      const header = group.querySelector<HTMLElement>(':scope > .filter-group-header')!
      if (!this.conditionHeaders.has(header)) {
        this.conditionHeaders.set(header, ['aria-expanded', 'tabindex', 'role'].map((name) => [name, header.getAttribute(name)]))
        if (header.hasAttribute('aria-expanded')) header.setAttribute('aria-expanded', 'true')
        if (header.hasAttribute('tabindex')) header.tabIndex = -1
        if (header.getAttribute('role') === 'button') header.removeAttribute('role')
      }
      let button = this.conditionLinks.get(group)
      if (!button) {
        button = this.button('', () => {
          const body = this.dialog?.querySelector<HTMLElement>(':scope > .sp-market-picker-body')
          if (!body || !group.isConnected) return
          const padding = parseFloat(getComputedStyle(body).paddingTop) || 0
          this.activeConditionGroup = group
          body.scrollTop += group.getBoundingClientRect().top - body.getBoundingClientRect().top - padding
          this.updateConditionLocation()
        }, 'sp-market-condition-link')
        this.conditionLinks.set(group, button)
        this.conditionLayoutObserver.observe(group)
      }
      const label = header.querySelector('.filter-title')!.textContent!.trim()
      if (button.textContent !== label) button.textContent = label
      if (nav.children[index] !== button) nav.insertBefore(button, nav.children[index] || null)
    }
    nav.hidden = this.activeTab !== 'conditions' || !groups.length
    this.layoutConditionGroups()
    this.updateConditionLocation()
  }

  private updateToolbarShortcuts(id: FilterTab): void {
    for (const [key, button] of this.shortcutTabs) {
      button.setAttribute('aria-current', key === id ? 'page' : 'false')
    }
  }

  private layoutConditionGroups(): void {
    if (this.activeTab !== 'conditions') return
    const narrow = matchMedia('(max-width: 960px)').matches
    // Reserve each card's natural height in a fine grid. Vue's original nodes
    // and keyboard order stay intact while the next card fills the shorter column.
    const sizes = this.conditionGroups.map((group) => ({ group, height: group.getBoundingClientRect().height }))
    for (const { group, height } of sizes) {
      if (narrow) {
        if (group.style.getPropertyValue('--sp-market-condition-span')) group.style.removeProperty('--sp-market-condition-span')
      } else if (height > 0) {
        const span = String(Math.ceil(height + 12))
        if (group.style.getPropertyValue('--sp-market-condition-span') !== span) group.style.setProperty('--sp-market-condition-span', span)
      }
    }
  }

  private updateConditionLocation(): void {
    if (this.activeTab !== 'conditions') return
    const body = this.dialog?.querySelector<HTMLElement>(':scope > .sp-market-picker-body')
    if (!body) return
    const top = body.getBoundingClientRect().top + (parseFloat(getComputedStyle(body).paddingTop) || 0) + 2
    const positions = this.conditionGroups.map((group) => ({ group, rect: group.getBoundingClientRect() }))
    let visible = positions.filter(({ rect }) => rect.top <= top && rect.bottom > top)
    if ((body.scrollTop > 0 || this.activeConditionGroup) && body.scrollTop + body.clientHeight >= body.scrollHeight - 2) {
      const lastTop = Math.max(...positions.map(({ rect }) => rect.top))
      visible = positions.filter(({ group, rect }) => Math.abs(rect.top - lastTop) < 2
        || (group === this.activeConditionGroup && rect.top >= top - 2 && rect.top < body.getBoundingClientRect().bottom))
    }
    // Uneven columns may have several visible groups. Keep a chosen destination
    // highlighted and otherwise follow the latest group reaching the top.
    const current = visible.find(({ group }) => group === this.activeConditionGroup)?.group
      ?? visible.reduce<typeof positions[number] | undefined>((latest, entry) => !latest || entry.rect.top > latest.rect.top ? entry : latest, undefined)?.group
      ?? positions.find(({ rect }) => rect.top > top)?.group
    this.activeConditionGroup = current
    for (const [group, button] of this.conditionLinks) {
      if (group === current) {
        if (button.getAttribute('aria-current') !== 'location') button.setAttribute('aria-current', 'location')
      } else if (button.hasAttribute('aria-current')) button.removeAttribute('aria-current')
    }
  }

  scan(): void {
    if (this.isOpen) {
      if (this.moved.some(({ node, placeholder }) => !node.isConnected || !placeholder.isConnected)) this.close(false)
      else this.updateConditionNavigation()
      return
    }
    const pane = document.querySelector<HTMLElement>('.search-advanced-pane.blue')
    const left = document.querySelector<HTMLElement>('.search-left')
    const right = document.querySelector<HTMLElement>('.search-right')
    const stats = document.querySelector<HTMLElement>('.search-advanced-pane.brown')
    if (!pane || !left || !right) { this.dispose(); return }
    const sources = [left, right, pane, ...(stats ? [stats] : [])]
    if (this.toolbar?.isConnected && sources.length === this.sources.length && sources.every((node, index) => node === this.sources[index])) {
      this.setHidden(!this.native)
      return
    }
    this.dispose()
    this.sources = sources
    const toolbar = document.createElement('div')
    toolbar.className = 'sp-market-unified-toolbar'; toolbar.dataset.superpoeMarketOwned = 'true'
    const l = this.options.text
    const open = this.button(l('Market filters', '集市筛选', '集市篩選', '거래소 필터'), () => this.open(), 'sp-market-unified-open')
    open.setAttribute('aria-haspopup', 'dialog')
    open.setAttribute('aria-expanded', 'false')
    const shortcuts = document.createElement('nav'); shortcuts.className = 'sp-market-unified-shortcuts'
    shortcuts.setAttribute('aria-label', l('Filter sections', '筛选分组', '篩選分組', '필터 그룹'))
    const entries: Array<[FilterTab, string]> = [
      ['items', l('Item search', '物品搜索', '物品搜尋', '아이템 검색')],
      ['conditions', l('Conditions', '条件筛选', '條件篩選', '조건 필터')],
      ['stats', l('Stats', '属性筛选', '屬性篩選', '속성 필터')],
    ]
    this.shortcutTabs.clear()
    for (const [id, label] of entries) {
      const shortcut = this.button(label, () => this.openTab(id), `sp-market-unified-shortcut sp-market-unified-shortcut-${id}`)
      shortcut.setAttribute('aria-controls', `sp-market-panel-${id}`)
      shortcut.setAttribute('aria-current', id === 'items' ? 'page' : 'false')
      shortcuts.append(shortcut)
      this.shortcutTabs.set(id, shortcut)
    }
    const copy = document.createElement('div'); copy.className = 'sp-market-unified-toolbar-copy'
    const copyTitle = document.createElement('strong'); copyTitle.textContent = l('Filter shortcuts', '集市筛选快捷入口', '集市篩選快捷入口', '거래소 필터 바로 가기')
    const copyDetail = document.createElement('span'); copyDetail.textContent = l('Market filters · item search · conditions · stats', '集市筛选 · 物品搜索 · 条件筛选 · 属性筛选', '集市篩選 · 物品搜尋 · 條件篩選 · 屬性篩選', '거래소 필터 · 아이템 검색 · 조건 필터 · 속성 필터')
    copy.append(copyTitle, copyDetail)
    const entryGroup = document.createElement('div'); entryGroup.className = 'sp-market-unified-entry-group'
    entryGroup.append(open, shortcuts)
    toolbar.append(copy, entryGroup)
    left.parentElement!.insertBefore(toolbar, left)
    this.toolbar = toolbar
    this.setHidden(false)
  }

  private setHidden(hidden: boolean): void {
    this.sources.forEach((node) => node.classList.toggle('sp-market-unified-collapsed', hidden))
    this.sources[2]?.parentElement?.classList.toggle('sp-market-unified-layout', hidden)
  }

  open(): void {
    if (this.isOpen || !this.sources.length) return
    this.options.beforeOpen()
    this.opener = document.activeElement instanceof HTMLElement ? document.activeElement : undefined
    // Native buttons and their sprite icons are scoped to #trade .search-bar.
    // A modal still enters the top layer when kept inside the official form.
    const host = this.sources[0].closest('.search-bar') || this.sources[0].closest('#trade') || document.body
    const l = this.options.text
    const dialog = document.createElement('dialog')
    dialog.className = 'sp-market-picker sp-market-unified'
    dialog.dataset.superpoeMarketOwned = 'true'
    dialog.dataset.superpoeFilterLoading = 'true'
    dialog.setAttribute('aria-busy', 'true')
    dialog.setAttribute('aria-labelledby', 'sp-market-unified-title')
    const header = document.createElement('div'); header.className = 'sp-market-picker-header'
    const titleRow = document.createElement('div'); titleRow.className = 'sp-market-picker-title'
    const title = document.createElement('h2'); title.id = 'sp-market-unified-title'
    title.textContent = l('Market filters', '集市筛选', '集市篩選', '거래소 필터')
    const close = this.button('×', () => this.close())
    close.setAttribute('aria-label', l('Close', '关闭', '關閉', '닫기'))
    titleRow.append(title, close)
    header.append(titleRow)
    const tabs = document.createElement('nav'); tabs.className = 'sp-market-unified-tabs'
    tabs.setAttribute('role', 'tablist')
    tabs.setAttribute('aria-label', l('Filter sections', '筛选分组', '篩選分組', '필터 그룹'))
    const subnav = document.createElement('div'); subnav.className = 'sp-market-unified-subnav'
    subnav.append(tabs)
    header.append(subnav)
    const body = document.createElement('div'); body.className = 'sp-market-picker-body'; body.inert = true
    body.addEventListener('scroll', () => this.updateConditionLocation(), { passive: true })
    const conditionNavigation = document.createElement('nav'); conditionNavigation.className = 'sp-market-condition-nav'
    conditionNavigation.setAttribute('aria-label', l('Jump to filter group', '定位筛选分组', '定位篩選分組', '필터 그룹으로 이동'))
    conditionNavigation.hidden = true; this.conditionNavigation = conditionNavigation
    const loading = document.createElement('div'); loading.className = 'sp-market-unified-loading'
    loading.setAttribute('role', 'status')
    loading.textContent = l('Loading filters…', '正在加载筛选条件…', '正在載入篩選條件…', '필터 불러오는 중…')
    this.activeTab = 'items'
    const entries: Array<[FilterTab, string]> = [
      ['items', l('Item search', '物品搜索', '物品搜尋', '아이템 검색')],
      ['conditions', l('Conditions', '条件筛选', '條件篩選', '조건 필터')],
      ['stats', l('Stats', '属性筛选', '屬性篩選', '속성 필터')],
    ]
    for (const [id, label] of entries) {
      const panel = document.createElement('section'); panel.className = 'sp-market-unified-panel'
      panel.classList.add(id === 'stats' ? 'search-advanced-items' : 'sp-market-form-enhanced')
      panel.dataset.filterTab = id; panel.id = `sp-market-panel-${id}`
      panel.setAttribute('role', 'tabpanel'); panel.setAttribute('aria-labelledby', `sp-market-tab-${id}`)
      panel.hidden = id !== this.activeTab
      const tab = this.button('', () => this.selectTab(id))
      tab.id = `sp-market-tab-${id}`; tab.setAttribute('role', 'tab'); tab.setAttribute('aria-controls', panel.id)
      tab.setAttribute('aria-selected', String(id === this.activeTab)); tab.tabIndex = id === this.activeTab ? 0 : -1
      tab.addEventListener('pointermove', (event) => {
        const rect = tab.getBoundingClientRect()
        tab.style.setProperty('--button-pointer-x', `${event.clientX - rect.left}px`)
        tab.style.setProperty('--button-pointer-y', `${event.clientY - rect.top}px`)
      }, { passive: true })
      tab.addEventListener('pointerleave', () => {
        tab.style.removeProperty('--button-pointer-x')
        tab.style.removeProperty('--button-pointer-y')
      })
      const name = document.createElement('span'); name.textContent = label; tab.append(name)
      if (id !== 'items') {
        const count = document.createElement('span'); count.className = 'sp-market-tab-count'; count.textContent = '0'
        tab.append(count)
      }
      tab.addEventListener('keydown', (event) => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
        event.preventDefault(); event.stopPropagation()
        const index = entries.findIndex(([key]) => key === id)
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? entries.length - 1
          : (index + (event.key === 'ArrowLeft' ? -1 : 1) + entries.length) % entries.length
        const key = entries[next][0]; this.selectTab(key); this.tabs.get(key)?.focus()
      })
      this.panels.set(id, panel); this.tabs.set(id, tab); tabs.append(tab); body.append(panel)
    }
    const preventConditionCollapse = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent && !['Enter', ' '].includes(event.key)) return
      if (!(event.target instanceof Element)) return
      const header = event.target.closest('.filter-group-header')
      if (!header || !this.panels.get('conditions')?.contains(header)) return
      const control = event.target.closest('input, select, textarea, button, a, label')
      if (control && control !== header && !control.matches('.toggle-btn, .filter-title')
        && (!(control instanceof HTMLLabelElement) || control.control)) return
      event.preventDefault(); event.stopImmediatePropagation()
    }
    this.panels.get('conditions')!.addEventListener('click', preventConditionCollapse, true)
    this.panels.get('conditions')!.addEventListener('keydown', preventConditionCollapse, true)
    const basics = document.createElement('section'); basics.className = 'sp-market-unified-basics'
    this.panels.get('items')!.append(basics)
    this.basics = basics
    const itemSearch = document.createElement('div'); itemSearch.className = 'sp-market-unified-item-search'
    const itemFilters = document.createElement('div'); itemFilters.className = 'sp-market-unified-item-filters'
    const itemDetails = document.createElement('div'); itemDetails.className = 'sp-market-unified-item-details'
    itemFilters.append(itemDetails)
    itemSearch.append(itemFilters)
    basics.append(itemSearch)
    for (const [index, node] of this.sources.entries()) {
      if (index === 3) {
        const nativeStyle = getComputedStyle(node)
        const panel = this.panels.get('stats')!
        panel.style.font = nativeStyle.font
        panel.style.color = nativeStyle.color
      }
      this.move(node, index === 0 ? itemSearch : index === 1 ? basics : this.panels.get(index === 2 ? 'conditions' : 'stats')!)
    }
    if (this.sources.length < 4) {
      const unavailable = document.createElement('p')
      unavailable.textContent = l('Stats are unavailable on this page. Refresh and retry.', '当前页面未加载属性筛选，请刷新后重试。', '目前頁面未載入屬性篩選，請重新整理後重試。', '속성 필터를 불러오지 못했습니다. 새로고침 후 다시 시도하세요.')
      this.panels.get('stats')!.append(unavailable)
    }
    const footer = document.createElement('div'); footer.className = 'sp-market-picker-footer'
    const status = document.createElement('span'); status.className = 'sp-market-picker-status'
    status.textContent = l('Conditions apply immediately', '条件即时保存', '條件即時儲存', '조건이 즉시 저장됩니다')
    footer.append(status, this.button(l('Done', '完成', '完成', '완료'), () => this.close(), 'sp-market-unified-done'),
      this.button(l('Search', '搜索', '搜尋', '검색'), () => {
        const search = document.querySelector<HTMLButtonElement>('button.search-btn')
        this.close(false)
        search?.click()
      }, 'sp-market-picker-done sp-market-unified-search'))
    dialog.append(header, conditionNavigation, loading, body, footer)
    dialog.addEventListener('cancel', (event) => { event.preventDefault(); event.stopPropagation(); this.close() })
    dialog.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !event.isComposing) { event.preventDefault(); event.stopImmediatePropagation(); this.close() }
    })
    dialog.addEventListener('input', () => this.options.changed())
    dialog.addEventListener('change', () => this.options.changed())
    host.append(dialog); this.dialog = dialog
    dialog.showModal()
    this.toolbar?.querySelector<HTMLButtonElement>('.sp-market-unified-open')?.setAttribute('aria-expanded', 'true')
    this.updateToolbarShortcuts(this.activeTab)
    this.statReadOnly = new MarketStatReadOnly(this.panels.get('stats')!)
    close.focus(); this.options.changed()
  }

  close(restoreFocus = true): void {
    if (!this.dialog) return
    this.options.closePicker()
    this.statTiers?.dispose(); this.statTiers = undefined
    this.statReadOnly?.dispose(); this.statReadOnly = undefined
    this.statScope?.remove(); this.statScope = undefined; this.statScopeSignature = ''
    for (const row of this.panels.get('stats')?.querySelectorAll<HTMLElement>('.sp-market-stat-outside') || []) row.classList.remove('sp-market-stat-outside')
    this.panels.get('stats')?.querySelectorAll('.sp-market-stat-outside-note').forEach((node) => node.remove())
    this.conditionLayoutObserver?.disconnect(); this.conditionLayoutObserver = undefined
    for (const group of this.conditionGroups) group.style.removeProperty('--sp-market-condition-span')
    for (const [header, attributes] of this.conditionHeaders) {
      for (const [name, value] of attributes) {
        if (value === null) header.removeAttribute(name)
        else header.setAttribute(name, value)
      }
    }
    this.conditionHeaders.clear(); this.conditionLinks.clear(); this.conditionGroups = []; this.activeConditionGroup = undefined; this.conditionNavigation = undefined
    for (const { node, placeholder } of [...this.moved].reverse()) {
      if (placeholder.isConnected) placeholder.replaceWith(node)
      else node.remove()
      delete node.dataset.superpoeOfficialSource
    }
    this.moved = []
    this.basics = undefined
    this.panels.clear(); this.tabs.clear(); this.scroll.clear()
    this.dialog.close(); this.dialog.remove(); this.dialog = undefined
    this.toolbar?.querySelector<HTMLButtonElement>('.sp-market-unified-open')?.setAttribute('aria-expanded', 'false')
    this.setHidden(!this.native)
    this.options.changed()
    if (restoreFocus && this.opener?.isConnected) this.opener.focus()
    this.opener = undefined
  }

  dispose(): void {
    this.close(false); this.setHidden(false)
    this.toolbar?.remove(); this.toolbar = undefined; this.sources = []; this.native = true
  }
}

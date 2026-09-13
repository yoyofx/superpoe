import { ipcRenderer } from 'electron'
import { parseLiveResult } from './marketLive.js'
import { MAX_ACTIVE_PURCHASE_TARGETS, type MarketListingAffixGroupKind, type MarketPageAffixGroup, type MarketPageDefenseStats, type MarketPageListingRarity, type MarketPageListingSummary, type MarketPageWeaponStats } from '../src/types/market.js'
import { desktopText, isUiLanguage, type UiLanguage } from './uiLocale.js'
import {
  MarketPageTranslator,
  normalizeMarketText,
  type MarketPageTranslationPayload,
  type MarketTranslationPair,
} from '../src/engine/marketPageTranslation.js'
import {
  buildOfficialMarketSuggestionCatalogAsync,
  type OfficialMarketSuggestionCatalog,
} from '../src/engine/marketOfficialSuggestions.js'

let language: UiLanguage = 'en'
const l = (en: string, zhCN: string, zhTW: string, koKR: string) => desktopText(language, en, zhCN, zhTW, koKR)

const DISABLED_MARKET_TRANSLATION: MarketPageTranslationPayload = {
  schemaVersion: 1,
  language: 'en',
  enabled: false,
  source: 'disabled',
  uiPairs: [],
  gamePairs: [],
}
let marketTranslationPayload = DISABLED_MARKET_TRANSLATION
let marketPageTranslator = new MarketPageTranslator(DISABLED_MARKET_TRANSLATION)
let marketTranslationConfigured = false
const originalTextByNode = new WeakMap<Text, string>()
const renderedTextByNode = new WeakMap<Text, string>()
const trackedTextNodes = new Set<Text>()
const originalAttributesByElement = new WeakMap<Element, Map<string, { source: string | null; rendered: string | null }>>()
const trackedAttributeElements = new Set<Element>()
const originalOptionLabels = new WeakMap<HTMLOptionElement, string>()
const renderedOptionLabels = new WeakMap<HTMLOptionElement, string>()
const originalOptionLabelAttributes = new WeakMap<HTMLOptionElement, string | null>()
const trackedOptionElements = new Set<HTMLOptionElement>()
const TRANSLATABLE_ATTRIBUTES = [
  'placeholder', 'title', 'aria-label', 'data-tooltip', 'label', 'data-placeholder', 'data-label', 'data-text',
] as const
const TRANSLATABLE_ATTRIBUTE_SELECTOR = TRANSLATABLE_ATTRIBUTES.map((attribute) => `[${attribute}]`).join(',')
const EXCLUDED_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'TEXTAREA', 'INPUT'])
const GAME_CONTEXT_SELECTOR = [
  '[data-id]', '[data-listing-id]', '[data-result-id]',
  '.resultset', '.search-results',
  '[class*="item"]', '[class*="result"]', '[class*="listing"]',
  '[class*="mod"]', '[class*="stat"]', '[class*="property"]',
  '[class*="detail"]', '[class*="requirement"]', '[class*="filter"]',
  '[class*="search"]', '[class*="category"]', '[class*="currency"]',
  '[class*="sort"]', '[class*="option"]', '[class*="choice"]',
].join(',')
const FILTER_CONTEXT_SELECTOR = [
  'select', 'option', '[role="listbox"]', '[role="option"]',
  '[role="combobox"]', '[aria-haspopup="listbox"]', '[aria-expanded="true"]',
  '[class*="dropdown"]', '[class*="select-menu"]', '[class*="multiselect"]',
  '[class*="autocomplete"]', '[class*="select2"]', '[class*="popover"]',
  '[class*="popup"]', '[class*="menu"]', '[class*="options"]', '[class*="choices"]',
  '[data-testid*="filter"]', '[data-testid*="option"]',
].join(',')
const SUGGESTION_CONTAINER_SELECTOR = [
  '[role="listbox"]', '[aria-autocomplete="list"]',
  '.multiselect__content-wrapper', '.select2-results', '.select2-container',
  '[class*="autocomplete"]', '[class*="suggest"]', '[class*="dropdown"]',
  '[class*="select-menu"]', '[class*="options"]', '[class*="choices"]',
].join(',')
const SUGGESTION_OPTION_SELECTOR = [
  'option', '[role="option"]', '.multiselect__option', '.select2-results__option',
  'li[class*="option"]', 'li[class*="choice"]', 'button[class*="option"]',
].join(',')
const BILINGUAL_SOURCE_CLASS = 'superpoe-market-source-label'
const USER_CONTENT_SELECTOR = [
  '[data-seller]', '[data-character]', '[data-username]',
  '[class*="seller"]', '[class*="profile"]', '[class*="character"]',
  '[class*="username"]', '[class*="comment"]', '[class*="message"]',
  '[class*="note"]', '[class*="whisper"]',
].join(',')
let translationTimer: ReturnType<typeof setTimeout> | undefined
let applyingMarketTranslation = false
let originalDocumentTitle: string | undefined
let renderedDocumentTitle: string | undefined
const translationObservers = new WeakMap<Node, MutationObserver>()
const observedMarketRoots = new Set<ParentNode>()
let suggestionDecorationTimer: ReturnType<typeof setTimeout> | undefined
const LOCALIZED_SUGGESTION_CLASS = 'superpoe-market-localized-suggestions'
const LOCALIZED_SUGGESTION_ROW_CLASS = 'superpoe-market-localized-suggestion'
const LOCALIZED_FILTER_INPUT_ACTIVE_CLASS = 'superpoe-market-localized-input-active'
const OFFICIAL_SELECTION_COMMITTING_CLASS = 'superpoe-market-official-selection-committing'
let localizedSuggestionPanel: HTMLDivElement | undefined
let localizedSuggestionList: HTMLUListElement | undefined
let localizedSuggestionInput: HTMLInputElement | undefined
let localizedSuggestionCandidates: Array<readonly [source: string, target: string]> = []
let localizedSuggestionHighlightIndex = 0
let localizedSuggestionSelectionTimer: ReturnType<typeof setTimeout> | undefined
let localizedSuggestionRequestId = 0
let officialSelectionInput: HTMLInputElement | undefined
let localizedSuggestionPendingInput: HTMLInputElement | undefined
type OfficialSuggestionDataKind = 'items' | 'filters' | 'stats'
const officialSuggestionDataPromises = new Map<OfficialSuggestionDataKind, Promise<unknown>>()
const officialSuggestionCatalogPromises = new Map<OfficialSuggestionDataKind, Promise<OfficialMarketSuggestionCatalog | undefined>>()
const originalFilterInputValues = new WeakMap<HTMLInputElement, string>()
const renderedFilterInputValues = new WeakMap<HTMLInputElement, string>()
const trackedFilterInputs = new Set<HTMLInputElement>()

function isSupportedMarketHost(): boolean {
  return window.location.hostname === 'www.pathofexile.com'
    || window.location.hostname === 'pathofexile.com'
    || window.location.hostname === 'poe.game.qq.com'
}

function isMarketTranslationEnabled(): boolean {
  return isSupportedMarketHost() && marketTranslationPayload.enabled
}

function isOwnedElement(element: Element | null): boolean {
  return Boolean(element?.closest('[data-superpoe-market-owned="true"]'))
}

function isGameContext(element: Element | null): boolean {
  if (!element || isOwnedElement(element) || isUserContent(element)) return false
  return element.tagName === 'OPTION'
    || Boolean(element.closest(GAME_CONTEXT_SELECTOR))
    || Boolean(element.closest(FILTER_CONTEXT_SELECTOR))
}

function isUserContent(element: Element | null): boolean {
  if (!element || isOwnedElement(element)) return false
  return Boolean(element.closest(USER_CONTENT_SELECTOR))
}

function originalAttributeValue(element: Element, attribute: string): string {
  const record = originalAttributesByElement.get(element)?.get(attribute)
  return record?.source ?? element.getAttribute(attribute) ?? ''
}

function localizedFilterInputDescriptor(input: HTMLInputElement, context: Element): string {
  const inputAttributes = ['name', 'id', 'class', 'placeholder', 'aria-label']
    .map((attribute) => attribute === 'placeholder' || attribute === 'aria-label'
      ? originalAttributeValue(input, attribute)
      : input.getAttribute(attribute) || '')
  const contextAttributes = ['class', 'id', 'data-testid', 'aria-label', 'placeholder']
    .map((attribute) => attribute === 'aria-label' || attribute === 'placeholder'
      ? originalAttributeValue(context, attribute)
      : context.getAttribute(attribute) || '')
  return [...inputAttributes, ...contextAttributes].filter(Boolean).join(' ').toLocaleLowerCase()
}

const OFFICIAL_TRADE_DATA_PATHS = {
  items: '/api/trade2/data/items',
  filters: '/api/trade2/data/filters',
  stats: '/api/trade2/data/stats',
} as const

function parseOfficialCacheValue(value: string | null): unknown {
  if (!value) return undefined
  let parsed: unknown = value
  for (let attempt = 0; attempt < 4 && typeof parsed === 'string'; attempt += 1) {
    try { parsed = JSON.parse(parsed) } catch { return undefined }
  }
  const record = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    ? parsed as Record<string, unknown>
    : undefined
  const expires = record?.expires
  if (typeof expires === 'number' && expires > 0) {
    const now = expires > 1_000_000_000_000 ? Date.now() : Math.floor(Date.now() / 60_000)
    if (expires <= now) return undefined
  }
  const cachedValue = record?.value
  if (typeof cachedValue === 'string') {
    try { return JSON.parse(cachedValue) } catch { return undefined }
  }
  const result = cachedValue ?? parsed
  return result == null ? undefined : result
}

function readOfficialCache(key: string): unknown {
  try {
    return parseOfficialCacheValue(window.localStorage?.getItem(key) || null)
  } catch {
    return undefined
  }
}

async function fetchOfficialTradeData(path: string): Promise<unknown> {
  const response = await fetch(path, { credentials: 'same-origin' })
  if (!response.ok) throw new Error(`Official trade data request failed: ${response.status}`)
  return response.json()
}

async function readOrFetchOfficialData(key: string, path: string): Promise<unknown> {
  const cached = readOfficialCache(key)
  if (cached !== undefined) return cached
  try { return await fetchOfficialTradeData(path) } catch { return undefined }
}

function localizeOfficialSuggestion(source: string): string {
  return marketPageTranslator.translate(source, true)
}

function officialDataCacheKey(kind: OfficialSuggestionDataKind): string {
  return `lscache-trade2${kind}`
}

function getOfficialSuggestionData(kind: OfficialSuggestionDataKind): Promise<unknown> {
  const existing = officialSuggestionDataPromises.get(kind)
  if (existing) return existing
  const promise = readOrFetchOfficialData(officialDataCacheKey(kind), OFFICIAL_TRADE_DATA_PATHS[kind])
  officialSuggestionDataPromises.set(kind, promise)
  return promise
}

async function loadOfficialSuggestionCatalog(
  kind: OfficialSuggestionDataKind,
): Promise<OfficialMarketSuggestionCatalog | undefined> {
  if (!isMarketTranslationEnabled()) return undefined
  const data = await getOfficialSuggestionData(kind)
  return buildOfficialMarketSuggestionCatalogAsync(
    kind === 'items' ? data : undefined,
    kind === 'filters' ? data : undefined,
    kind === 'stats' ? data : undefined,
    localizeOfficialSuggestion,
    200,
    (localized) => marketPageTranslator.findSource(localized, true),
  )
}

function getOfficialSuggestionCatalog(
  kind: OfficialSuggestionDataKind,
): Promise<OfficialMarketSuggestionCatalog | undefined> {
  const existing = officialSuggestionCatalogPromises.get(kind)
  if (existing) return existing
  const promise = loadOfficialSuggestionCatalog(kind).catch(() => undefined)
  officialSuggestionCatalogPromises.set(kind, promise)
  return promise
}

function resetOfficialSuggestionCatalog(): void {
  officialSuggestionDataPromises.clear()
  officialSuggestionCatalogPromises.clear()
}

function directSourceText(element: Element): string {
  return normalizeMarketText(Array.from(element.childNodes)
    .filter((node): node is Text => node.nodeType === Node.TEXT_NODE)
    .map((node) => originalText(node))
    .join(' '))
}

function officialFilterLabel(input: HTMLInputElement): string {
  const title = input.closest('.filter-body')?.querySelector(':scope > .filter-title')
  return title ? directSourceText(title) : ''
}

function officialOptionSource(option: Element): string {
  const markedSource = option.getAttribute('data-superpoe-market-source')
  if (markedSource) return normalizeMarketText(markedSource)
  const walker = document.createTreeWalker(option, NodeFilter.SHOW_TEXT)
  const parts: string[] = []
  let node: Node | null = walker.nextNode()
  while (node) {
    const textNode = node as Text
    // Stat options render their category (for example "综合") in a
    // separate .mutate-type element. It is presentation-only and is not part
    // of the value exposed by vue-multiselect.
    if (!textNode.parentElement?.closest('.mutate-type')
      && !isOwnedElement(textNode.parentElement) && !isUserContent(textNode.parentElement)) {
      parts.push(originalText(textNode))
    }
    node = walker.nextNode()
  }
  return normalizeMarketText(parts.join(' '))
}

interface OfficialVueMultiselect {
  filteredOptions?: unknown[]
  select?: (option: unknown, event?: KeyboardEvent) => void
}

function officialVueMultiselect(container: Element | null): OfficialVueMultiselect | undefined {
  if (!container) return undefined
  return (container as Element & { __vue__?: OfficialVueMultiselect }).__vue__
}

function officialOptionData(container: Element | null, option: Element, expected: string[]): unknown {
  const component = officialVueMultiselect(container)
  if (!component?.select || !Array.isArray(component.filteredOptions)) return undefined
  const optionText = normalizeMarketText(officialOptionSource(option)).toLocaleLowerCase()
  return component.filteredOptions.find((candidate) => {
    if (!candidate || typeof candidate !== 'object') return false
    const record = candidate as Record<string, unknown>
    if (record.$isLabel || record.$isDisabled) return false
    const text = typeof record.text === 'string'
      ? normalizeMarketText(record.text).toLocaleLowerCase()
      : ''
    return Boolean(text) && (expected.includes(text) || text === optionText)
  })
}

function officialPairsFromContainer(container: Element): MarketTranslationPair[] {
  const pairs: MarketTranslationPair[] = []
  for (const option of Array.from(container.querySelectorAll(SUGGESTION_OPTION_SELECTOR))) {
    if (option.classList.contains('multiselect__option--disabled')) continue
    const source = officialOptionSource(option)
    if (!source || /No elements found|Consider changing the search query/i.test(source)) continue
    const target = localizeOfficialSuggestion(source)
    if (pairs.some(([candidate]) => candidate === source)) continue
    pairs.push([source, target])
  }
  return pairs
}

function officialSuggestionDataKindForInput(input: HTMLInputElement): OfficialSuggestionDataKind | undefined {
  const multiselect = input.closest('.multiselect')
  if (!multiselect || multiselect.classList.contains('filter-group-select')) return undefined
  if (multiselect.classList.contains('search-select')) return 'items'
  if (multiselect.classList.contains('filter-select-mutate')) return 'stats'
  return 'filters'
}

function officialSuggestionPairsForInput(
  input: HTMLInputElement,
  catalog?: OfficialMarketSuggestionCatalog,
): MarketTranslationPair[] {
  const multiselect = input.closest('.multiselect')
  if (!multiselect) return []
  if (multiselect.classList.contains('filter-group-select')) return officialPairsFromContainer(multiselect)
  if (!catalog) return []
  if (multiselect.classList.contains('search-select')) {
    return catalog.itemPairs.length ? catalog.itemPairs : marketPageTranslator.getSuggestionPairs('items')
  }
  if (multiselect.classList.contains('filter-select-mutate')) {
    return catalog.statPairs.length ? catalog.statPairs : marketPageTranslator.getSuggestionPairs('filters')
  }

  const label = officialFilterLabel(input)
  const descriptor = localizedFilterInputDescriptor(input, multiselect)
  for (const [id, officialLabel] of catalog.filterLabelsById) {
    if (normalizeMarketText(officialLabel).toLocaleLowerCase() !== label.toLocaleLowerCase()) continue
    return catalog.filterPairsById.get(id) || []
  }
  // The CN status filter has no label in /data/filters. Its option list is
  // still keyed by `status`, so use the field descriptor when the title is
  // absent or differs from the data endpoint's localized wording.
  const statusPairs = catalog.filterPairsById.get('status')
  if (statusPairs && (!label || /status|listed|状态|上架|可交易/u.test(`${label} ${descriptor}`))) return statusPairs
  return []
}

function isFilterSuggestion(element: Element | null): boolean {
  if (!element || isOwnedElement(element) || isUserContent(element)) return false
  if (element.tagName === 'OPTION' || element.getAttribute('role') === 'option') return true
  if (!element.matches(SUGGESTION_OPTION_SELECTOR)) return false
  return Boolean(element.closest(SUGGESTION_CONTAINER_SELECTOR))
}

function isLocalizedFilterInput(element: Element | null): element is HTMLInputElement {
  if (!(element instanceof HTMLInputElement) || element.disabled || element.readOnly) return false
  if (element.type !== 'text' && element.type !== 'search') return false
  if (isOwnedElement(element) || isUserContent(element)) return false
  const context = element.closest(FILTER_CONTEXT_SELECTOR)
  if (!context) return false
  const descriptor = localizedFilterInputDescriptor(element, context)
  if (/seller|account|character|username|whisper|message|comment|currency|price|league|profile|owner/u.test(descriptor)) return false
  return /search|item|stat|mod|filter|autocomplete|multiselect|select2|choice|option/u.test(descriptor)
}

function setNativeInputValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  if (setter) setter.call(input, value)
  else input.value = value
}

function removeLocalizedSuggestionPanel(): void {
  localizedSuggestionRequestId += 1
  if (localizedSuggestionSelectionTimer) clearTimeout(localizedSuggestionSelectionTimer)
  localizedSuggestionSelectionTimer = undefined
  officialSelectionInput = undefined
  document.documentElement?.classList.remove(OFFICIAL_SELECTION_COMMITTING_CLASS)
  localizedSuggestionPendingInput = undefined
  localizedSuggestionInput?.classList.remove(LOCALIZED_FILTER_INPUT_ACTIVE_CLASS)
  localizedSuggestionPanel?.remove()
  localizedSuggestionPanel = undefined
  localizedSuggestionList = undefined
  localizedSuggestionInput = undefined
  localizedSuggestionCandidates = []
  localizedSuggestionHighlightIndex = 0
}

function restoreFilterInputValues(): void {
  for (const input of trackedFilterInputs) {
    if (!input.isConnected) {
      trackedFilterInputs.delete(input)
      continue
    }
    const source = originalFilterInputValues.get(input)
    const rendered = renderedFilterInputValues.get(input)
    if (source == null || rendered == null || input.value !== rendered || input.value === source) continue
    setNativeInputValue(input, source)
  }
  trackedFilterInputs.clear()
}

function translateFilterInputValues(): void {
  if (!isMarketTranslationEnabled()) return
  for (const element of queryMarketElements('input')) {
    if (!isLocalizedFilterInput(element)) continue
    const input = element
    if (officialSelectionInput === input) continue
    const current = input.value
    const rendered = renderedFilterInputValues.get(input)
    const source = !originalFilterInputValues.has(input) || rendered !== current
      ? current
      : originalFilterInputValues.get(input) || current
    originalFilterInputValues.set(input, source)
    trackedFilterInputs.add(input)
    const translated = /[A-Za-z]/u.test(source) ? marketPageTranslator.translate(source, true) : source
    renderedFilterInputValues.set(input, translated)
    if (translated === current) continue
    const focused = document.activeElement === input
    setNativeInputValue(input, translated)
    if (focused) {
      const caret = translated.length
      try { input.setSelectionRange(caret, caret) } catch { /* Some browser-controlled inputs reject selection updates. */ }
    }
  }
}

function positionLocalizedSuggestionPanel(): void {
  if (!localizedSuggestionPanel || !localizedSuggestionInput?.isConnected) return
  const inputRect = localizedSuggestionInput.getBoundingClientRect()
  const anchorRect = localizedSuggestionInput.closest('.multiselect')?.getBoundingClientRect() || inputRect
  const viewportPadding = 8
  const availableWidth = Math.max(0, window.innerWidth - viewportPadding * 2)
  const width = Math.min(Math.max(0, Math.round(anchorRect.width)), availableWidth)
  const left = Math.min(
    Math.max(viewportPadding, Math.round(anchorRect.left)),
    Math.max(viewportPadding, window.innerWidth - width - viewportPadding),
  )
  localizedSuggestionPanel.style.left = `${Math.round(left + window.scrollX)}px`
  localizedSuggestionPanel.style.top = `${Math.round(inputRect.bottom + window.scrollY + 3)}px`
  localizedSuggestionPanel.style.width = `${width}px`
  localizedSuggestionPanel.style.minWidth = '0px'
  localizedSuggestionPanel.style.maxWidth = `${availableWidth}px`
}

function selectLocalizedSuggestion(index: number): void {
  const input = localizedSuggestionInput
  const pair = localizedSuggestionCandidates[index]
  if (!input || !pair) return
  const officialContainer = input.closest('.multiselect')
  const expected = [pair[0], pair[1]]
    .map((value) => normalizeMarketText(value).toLocaleLowerCase())
    .filter(Boolean)
  const findOfficialOption = (): Element | undefined => {
    if (!input.isConnected || (officialContainer && !officialContainer.isConnected)) return undefined
    const scopedOptions = officialContainer
      ? Array.from(officialContainer.querySelectorAll(SUGGESTION_OPTION_SELECTOR))
      : []
    const allOptions = queryMarketElements(SUGGESTION_OPTION_SELECTOR)
    const options = [...new Set([...scopedOptions, ...allOptions])]
      .filter((candidate) => !isOwnedElement(candidate) && isFilterSuggestion(candidate))
    const matchingOptions = options.filter((candidate) => {
      const normalized = normalizeMarketText(officialOptionSource(candidate)).toLocaleLowerCase()
      return expected.includes(normalized)
    })
    return matchingOptions.find(isVisibleOfficialControl) || matchingOptions[0]
  }
  const commitOfficialOption = (option: Element): void => {
    officialSelectionInput = input
    document.documentElement?.classList.add(OFFICIAL_SELECTION_COMMITTING_CLASS)
    try {
      if (option instanceof HTMLOptionElement && option.parentElement instanceof HTMLSelectElement) {
        const select = option.parentElement
        select.value = option.value
        select.dispatchEvent(new Event('change', { bubbles: true }))
      } else if (officialContainer?.classList.contains('filter-select-mutate')) {
        // The stat selector handles its custom rendered options through the
        // Vue component. Dispatching a DOM click only changes the highlight;
        // select() emits the value that creates the filter row.
        const optionData = officialOptionData(officialContainer, option, expected)
        const component = officialVueMultiselect(officialContainer)
        if (optionData && component?.select) component.select(optionData)
        else {
          const click = new MouseEvent('click', {
            bubbles: true,
            cancelable: true,
            composed: true,
            view: window,
          })
          option.dispatchEvent(click)
        }
      } else {
        // vue-multiselect commits through the option's click handler. A
        // mousedown is used by the component to prevent focus changes and
        // does not select the option by itself.
        const click = new MouseEvent('click', {
          bubbles: true,
          cancelable: true,
          composed: true,
          view: window,
        })
        option.dispatchEvent(click)
      }
    } finally {
      officialSelectionInput = undefined
      document.documentElement?.classList.remove(OFFICIAL_SELECTION_COMMITTING_CLASS)
    }
    scheduleMarketTranslation(true)
  }

  // Use an already-rendered official option directly. This keeps the native
  // control from opening a second, intermediate suggestion state.
  const existingOption = findOfficialOption()
  if (existingOption) {
    removeLocalizedSuggestionPanel()
    commitOfficialOption(existingOption)
    return
  }

  removeLocalizedSuggestionPanel()
  officialSelectionInput = input
  document.documentElement?.classList.add(OFFICIAL_SELECTION_COMMITTING_CLASS)
  const officialValue = window.location.hostname === 'poe.game.qq.com' ? pair[1] : pair[0]
  setNativeInputValue(input, officialValue)
  input.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, inputType: 'insertText', data: officialValue }))

  // Some fuzzy candidates are not in the official list for the partial query.
  // In that case, let the official control render the canonical option and
  // select it as soon as it becomes available.
  let attempts = 0
  const selectOfficialOption = () => {
    attempts += 1
    if (officialSelectionInput !== input) return
    const option = findOfficialOption()
    if (option) {
      commitOfficialOption(option)
      return
    }
    if (attempts < 30) localizedSuggestionSelectionTimer = setTimeout(selectOfficialOption, 50)
    else {
      officialSelectionInput = undefined
      document.documentElement?.classList.remove(OFFICIAL_SELECTION_COMMITTING_CLASS)
    }
  }
  localizedSuggestionSelectionTimer = setTimeout(selectOfficialOption, 50)
}

function setLocalizedSuggestionHighlight(index: number): void {
  if (!localizedSuggestionCandidates.length) return
  const count = localizedSuggestionCandidates.length
  localizedSuggestionHighlightIndex = (index + count) % count
  const rows = localizedSuggestionList
    ? Array.from(localizedSuggestionList.querySelectorAll(`.${LOCALIZED_SUGGESTION_ROW_CLASS}`))
    : []
  rows.forEach((row, rowIndex) => {
    const highlighted = rowIndex === localizedSuggestionHighlightIndex
    row.classList.toggle('multiselect__option--highlight', highlighted)
    row.setAttribute('aria-selected', highlighted ? 'true' : 'false')
    if (highlighted) (row as HTMLElement).scrollIntoView({ block: 'nearest' })
  })
}

function queryMarketElements(selector: string): Element[] {
  const result: Element[] = []
  for (const root of observedMarketRoots) result.push(...Array.from(root.querySelectorAll(selector)))
  return result
}

async function showLocalizedSuggestionPanel(input: HTMLInputElement, value: string): Promise<void> {
  if (localizedSuggestionInput && localizedSuggestionInput !== input) removeLocalizedSuggestionPanel()
  localizedSuggestionPendingInput = input
  const requestId = ++localizedSuggestionRequestId
  if (localizedSuggestionSelectionTimer) clearTimeout(localizedSuggestionSelectionTimer)
  localizedSuggestionSelectionTimer = undefined
  officialSelectionInput = undefined
  const dataKind = officialSuggestionDataKindForInput(input)
  const catalog = dataKind ? await getOfficialSuggestionCatalog(dataKind) : undefined
  if (requestId !== localizedSuggestionRequestId || input.value !== value) {
    if (localizedSuggestionPendingInput === input) localizedSuggestionPendingInput = undefined
    return
  }
  const pairs = catalog ? officialSuggestionPairsForInput(input, catalog) : []
  const candidates = marketPageTranslator.findMatchesInPairs(value, pairs, 40)
  if (!candidates.length) {
    removeLocalizedSuggestionPanel()
    return
  }
  if (!localizedSuggestionPanel) {
    localizedSuggestionPanel = document.createElement('div')
    localizedSuggestionPanel.className = `${LOCALIZED_SUGGESTION_CLASS} multiselect__content-wrapper`
    localizedSuggestionPanel.dataset.superpoeMarketOwned = 'true'
    localizedSuggestionPanel.setAttribute('role', 'listbox')
    localizedSuggestionList = document.createElement('ul')
    localizedSuggestionList.className = 'multiselect__content'
    localizedSuggestionPanel.appendChild(localizedSuggestionList)
    document.body.appendChild(localizedSuggestionPanel)
  }
  if (localizedSuggestionInput && localizedSuggestionInput !== input) {
    localizedSuggestionInput.classList.remove(LOCALIZED_FILTER_INPUT_ACTIVE_CLASS)
  }
  localizedSuggestionInput = input
  input.classList.add(LOCALIZED_FILTER_INPUT_ACTIVE_CLASS)
  localizedSuggestionCandidates = candidates
  localizedSuggestionHighlightIndex = 0
  localizedSuggestionList?.replaceChildren()
  for (let index = 0; index < candidates.length; index += 1) {
    const [source, target] = candidates[index]
    const row = document.createElement('li')
    row.className = 'multiselect__element'
    const option = document.createElement('span')
    option.className = `multiselect__option ${LOCALIZED_SUGGESTION_ROW_CLASS}${index === 0 ? ' multiselect__option--highlight' : ''}`
    option.setAttribute('role', 'option')
    option.setAttribute('aria-selected', index === 0 ? 'true' : 'false')
    const targetLabel = document.createElement('span')
    targetLabel.className = 'superpoe-market-localized-target'
    targetLabel.textContent = target
    const sourceLabel = document.createElement('span')
    sourceLabel.className = 'superpoe-market-localized-source'
    sourceLabel.textContent = ` (${source})`
    option.append(targetLabel, sourceLabel)
    row.appendChild(option)
    option.addEventListener('mousedown', (event) => {
      event.preventDefault()
      event.stopPropagation()
    })
    option.addEventListener('click', (event) => {
      event.preventDefault()
      event.stopPropagation()
      selectLocalizedSuggestion(index)
    })
    localizedSuggestionList?.appendChild(row)
  }
  positionLocalizedSuggestionPanel()
  if (localizedSuggestionPendingInput === input) localizedSuggestionPendingInput = undefined
}

function handleLocalizedFilterInput(event: Event): void {
  if (!isMarketTranslationEnabled()) return
  const input = (event.composedPath?.()[0] || event.target) as Element | null
  if (!isLocalizedFilterInput(input)) return
  if (event instanceof InputEvent && event.isComposing) return
  const value = input.value
  // A localized candidate selection writes the official value back into the
  // same input and dispatches an input event. Do not replace its pending
  // official-option selection with a new localized suggestion request.
  if (officialSelectionInput === input) {
    scheduleMarketTranslation()
    return
  }
  if (!/[\u0080-\uFFFF]/u.test(value)) {
    if (officialSelectionInput !== input) removeLocalizedSuggestionPanel()
    scheduleMarketTranslation()
    return
  }
  void showLocalizedSuggestionPanel(input, value)
  scheduleMarketTranslation()
}

function decorateBilingualSuggestion(element: Element): void {
  if (!isFilterSuggestion(element)) return
  const source = element.getAttribute('data-superpoe-market-source')
  if (!source) return
  const translated = marketPageTranslator.translate(source, true)
  if (!translated || translated === source) return
  if (element.querySelector(`:scope > .${BILINGUAL_SOURCE_CLASS}`)) return
  const label = document.createElement('span')
  label.className = BILINGUAL_SOURCE_CLASS
  label.dataset.superpoeMarketOwned = 'true'
  label.textContent = ` (${source})`
  element.appendChild(label)
}

function decorateBilingualSuggestions(root: ParentNode = document): void {
  if (root instanceof Element && isFilterSuggestion(root)) decorateBilingualSuggestion(root)
  const elements = root === document
    ? queryMarketElements('[data-superpoe-market-source]')
    : Array.from(root.querySelectorAll('[data-superpoe-market-source]'))
  for (const element of elements) decorateBilingualSuggestion(element)
}

function scheduleSuggestionDecoration(): void {
  if (suggestionDecorationTimer) clearTimeout(suggestionDecorationTimer)
  suggestionDecorationTimer = setTimeout(() => {
    suggestionDecorationTimer = undefined
    decorateBilingualSuggestions()
  }, 90)
}

function isExcludedTextNode(node: Text): boolean {
  const parent = node.parentElement
  if (!parent || isOwnedElement(parent) || isUserContent(parent)) return true
  return Boolean(parent.closest([...EXCLUDED_TAGS].map((tag) => tag.toLowerCase()).join(',')))
}

function originalText(node: Text): string {
  const current = node.nodeValue || ''
  if (!originalTextByNode.has(node)) {
    originalTextByNode.set(node, current)
    trackedTextNodes.add(node)
    return current
  }
  const rendered = renderedTextByNode.get(node)
  if (rendered !== undefined && current !== rendered) {
    originalTextByNode.set(node, current)
  }
  return originalTextByNode.get(node) || ''
}

function restoreMarketTranslations(): void {
  restoreFilterInputValues()
  for (const node of trackedTextNodes) {
    if (!node.isConnected) {
      trackedTextNodes.delete(node)
      continue
    }
    const source = originalTextByNode.get(node)
    const rendered = renderedTextByNode.get(node)
    if (source != null && rendered != null && node.nodeValue === rendered && node.nodeValue !== source) {
      applyingMarketTranslation = true
      node.nodeValue = source
      applyingMarketTranslation = false
    }
  }
  for (const element of trackedAttributeElements) {
    if (!element.isConnected) {
      trackedAttributeElements.delete(element)
      continue
    }
    const attributes = originalAttributesByElement.get(element)
    if (!attributes) continue
    for (const [attribute, record] of attributes) {
      if (element.getAttribute(attribute) !== record.rendered) continue
      if (record.source == null) element.removeAttribute(attribute)
      else element.setAttribute(attribute, record.source)
    }
  }
  for (const option of trackedOptionElements) {
    if (!option.isConnected) {
      trackedOptionElements.delete(option)
      continue
    }
    const source = originalOptionLabelAttributes.get(option)
    applyingMarketTranslation = true
    if (source == null) option.removeAttribute('label')
    else option.setAttribute('label', source)
    applyingMarketTranslation = false
    renderedOptionLabels.delete(option)
  }
  if (originalDocumentTitle !== undefined && renderedDocumentTitle !== undefined && document.title === renderedDocumentTitle) {
    document.title = originalDocumentTitle
  }
  renderedDocumentTitle = undefined
  removeLocalizedSuggestionPanel()
  for (const element of queryMarketElements('[data-superpoe-market-source]')) {
    element.removeAttribute('data-superpoe-market-source')
    element.querySelector(`:scope > .${BILINGUAL_SOURCE_CLASS}`)?.remove()
  }
}

function translateTextNode(node: Text): void {
  if (isExcludedTextNode(node)) return
  const source = originalText(node)
  if (!source.trim()) return
  const translated = marketPageTranslator.translate(source, isGameContext(node.parentElement))
  const suggestion = node.parentElement?.closest(SUGGESTION_OPTION_SELECTOR)
  if (suggestion && isFilterSuggestion(suggestion) && translated !== source) {
    suggestion.setAttribute('data-superpoe-market-source', source)
  } else if (suggestion && isFilterSuggestion(suggestion)
    && suggestion.getAttribute('data-superpoe-market-source') === source) {
    suggestion.removeAttribute('data-superpoe-market-source')
    suggestion.querySelector(`:scope > .${BILINGUAL_SOURCE_CLASS}`)?.remove()
  }
  const current = node.nodeValue || ''
  renderedTextByNode.set(node, translated)
  if (translated === current) return
  applyingMarketTranslation = true
  node.nodeValue = translated
  applyingMarketTranslation = false
}

function translateElementAttributes(element: Element): void {
  if (isOwnedElement(element) || isUserContent(element)) return
  const records = originalAttributesByElement.get(element) || new Map<string, { source: string | null; rendered: string | null }>()
  originalAttributesByElement.set(element, records)
  trackedAttributeElements.add(element)
  for (const attribute of TRANSLATABLE_ATTRIBUTES) {
    if (element instanceof HTMLOptionElement && attribute === 'label') continue
    const current = element.getAttribute(attribute)
    if (current == null && !records.has(attribute)) continue
    const previous = records.get(attribute)
    const source = !previous || element.getAttribute(attribute) !== previous.rendered ? current : previous.source
    const translated = source == null ? null : marketPageTranslator.translate(source, isGameContext(element))
    records.set(attribute, { source, rendered: translated })
    if (translated === current || translated == null) continue
    applyingMarketTranslation = true
    element.setAttribute(attribute, translated)
    applyingMarketTranslation = false
  }
}

function translateSelectOptions(select: HTMLSelectElement): void {
  for (const option of Array.from(select.options)) {
    const current = option.textContent || ''
    const rendered = renderedOptionLabels.get(option)
    if (rendered !== undefined && current !== rendered) originalOptionLabels.set(option, current)
    if (!originalOptionLabels.has(option)) originalOptionLabels.set(option, current)
    const source = originalOptionLabels.get(option) || current
    const translated = marketPageTranslator.translate(source, isGameContext(option))
    renderedOptionLabels.set(option, translated)
    if (translated === source) continue
    if (!originalOptionLabelAttributes.has(option)) {
      originalOptionLabelAttributes.set(option, option.getAttribute('label'))
      trackedOptionElements.add(option)
    }
    if (option.getAttribute('label') === translated) continue
    applyingMarketTranslation = true
    // Chromium may paint the selected label from the option attribute rather
    // than its text node. Keep only the display label translated without
    // changing the option text, value, or identity.
    option.setAttribute('label', translated)
    applyingMarketTranslation = false
  }
}

function walkMarketDocument(root: Node, onText: (node: Text) => void, onElement: (element: Element) => void): void {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT)
  let current: Node | null = walker.nextNode()
  while (current) {
    if (current.nodeType === Node.TEXT_NODE) onText(current as Text)
    else if (current.nodeType === Node.ELEMENT_NODE) {
      const element = current as Element
      onElement(element)
      if (element instanceof HTMLSelectElement) translateSelectOptions(element)
      if (element.shadowRoot) walkMarketDocument(element.shadowRoot, onText, onElement)
    }
    current = walker.nextNode()
  }
}

function observeMarketRoot(root: ParentNode): void {
  if (translationObservers.has(root)) return
  const observer = new MutationObserver(() => {
    scheduleScan()
    if (!applyingMarketTranslation) scheduleMarketTranslation()
  })
  observer.observe(root, {
    attributes: true,
    attributeFilter: [...TRANSLATABLE_ATTRIBUTES],
    characterData: true,
    childList: true,
    subtree: true,
  })
  translationObservers.set(root, observer)
  observedMarketRoots.add(root)
}

function translateMarketDocument(): void {
  if (!document.documentElement) return
  if (!isMarketTranslationEnabled()) return
  const root = document.body || document.documentElement
  walkMarketDocument(root, translateTextNode, (element) => {
    if (element.matches(TRANSLATABLE_ATTRIBUTE_SELECTOR)) translateElementAttributes(element)
    if (element.shadowRoot) observeMarketRoot(element.shadowRoot)
  })
  translateFilterInputValues()
  scheduleSuggestionDecoration()
  if (originalDocumentTitle === undefined || document.title !== renderedDocumentTitle) originalDocumentTitle = document.title
  const translatedTitle = marketPageTranslator.translate(originalDocumentTitle || '')
  renderedDocumentTitle = translatedTitle
  if (translatedTitle !== document.title) document.title = translatedTitle
}

function scheduleMarketTranslation(force = false): void {
  const activeInput = localizedSuggestionPendingInput || localizedSuggestionInput
  if (!force && activeInput && /[\u0080-\uFFFF]/u.test(activeInput.value)) return
  if (translationTimer) clearTimeout(translationTimer)
  translationTimer = setTimeout(() => {
    translationTimer = undefined
    if (isMarketTranslationEnabled()) translateMarketDocument()
    // Publish after the translation pass so the shortcut never receives an
    // English snapshot and then immediately replaces it with Chinese.
    scan(document)
  }, 80)
}

function setMarketTranslation(value: unknown): void {
  restoreMarketTranslations()
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const payload = value as Partial<MarketPageTranslationPayload>
    if (payload.schemaVersion === 1 && isUiLanguage(payload.language) && typeof payload.enabled === 'boolean') {
      marketTranslationPayload = payload as MarketPageTranslationPayload
      marketPageTranslator = new MarketPageTranslator(marketTranslationPayload)
      marketTranslationConfigured = true
      resetOfficialSuggestionCatalog()
      scheduleMarketTranslation()
      return
    }
  }
  marketTranslationPayload = DISABLED_MARKET_TRANSLATION
  marketPageTranslator = new MarketPageTranslator(DISABLED_MARKET_TRANSLATION)
  marketTranslationConfigured = true
  resetOfficialSuggestionCatalog()
  scheduleMarketTranslation()
}

interface MonitorConfig {
  searchId: string
  realm: 'cn' | 'global'
  liveUrl: string
}

interface LiveConnection {
  config: MonitorConfig
  socket?: WebSocket
  retryAttempt: number
  retryTimer?: ReturnType<typeof setTimeout>
  stopped: boolean
}

const liveConnections = new Map<string, LiveConnection>()
const retryDelays = [1_000, 2_000, 5_000, 10_000, 30_000, 60_000]
const MAX_LIVE_SEARCH_CODE_LENGTH = 8_192

function sendMonitorState(connection: LiveConnection, connectionStatus: string, extra: Record<string, unknown> = {}): void {
  ipcRenderer.send('market-monitor:state', {
    searchId: connection.config.searchId,
    connectionStatus,
    retryAttempt: connection.retryAttempt,
    ...extra,
  })
}

function validLiveUrl(config: MonitorConfig): boolean {
  try {
    const url = new URL(config.liveUrl)
    const host = config.realm === 'cn' ? 'poe.game.qq.com' : 'www.pathofexile.com'
    return url.protocol === 'wss:' && url.hostname === host
      && new RegExp(`^/api/trade2/live/poe2/[^/]+/[A-Za-z0-9_-]{1,${MAX_LIVE_SEARCH_CODE_LENGTH}}$`).test(url.pathname)
  } catch {
    return false
  }
}

function stopLive(connection: LiveConnection): void {
  connection.stopped = true
  if (connection.retryTimer) clearTimeout(connection.retryTimer)
  connection.socket?.close(1000, 'monitor stopped')
  connection.socket = undefined
  sendMonitorState(connection, 'disabled')
}

function scheduleReconnect(connection: LiveConnection): void {
  if (connection.stopped || connection.retryTimer) return
  const delay = retryDelays[Math.min(connection.retryAttempt, retryDelays.length - 1)]
  connection.retryAttempt += 1
  const nextRetryAt = new Date(Date.now() + delay).toISOString()
  sendMonitorState(connection, 'reconnecting', { nextRetryAt })
  connection.retryTimer = setTimeout(() => {
    connection.retryTimer = undefined
    connectLive(connection)
  }, delay)
}

function connectLive(connection: LiveConnection): void {
  if (connection.stopped || connection.socket) return
  if (!validLiveUrl(connection.config)) {
    sendMonitorState(connection, 'invalid-search', { lastErrorCode: 'invalid-live-url' })
    return
  }
  sendMonitorState(connection, connection.retryAttempt ? 'reconnecting' : 'connecting')
  let socket: WebSocket
  try {
    socket = new WebSocket(connection.config.liveUrl)
  } catch {
    scheduleReconnect(connection)
    return
  }
  connection.socket = socket
  socket.addEventListener('open', () => {
    connection.retryAttempt = 0
    sendMonitorState(connection, 'connecting')
  })
  socket.addEventListener('message', (event) => {
    if (typeof event.data !== 'string' || event.data.length > 1_000_000) return
    try {
      const payload = JSON.parse(event.data) as unknown
      if (payload && typeof payload === 'object') {
        const message = payload as { auth?: unknown; count?: unknown; result?: unknown; new?: unknown }
        ipcRenderer.send('market-monitor:frame', {
          searchId: connection.config.searchId,
          keys: Object.keys(message).slice(0, 12),
          auth: message.auth === true,
          count: Number.isFinite(Number(message.count)) ? Number(message.count) : undefined,
          resultCount: Array.isArray(message.result) ? message.result.length : Array.isArray(message.new) ? message.new.length : undefined,
          resultType: Array.isArray(message.result) ? 'array' : typeof message.result,
          resultLength: typeof message.result === 'string' ? message.result.length : undefined,
          resultKeys: message.result && typeof message.result === 'object' && !Array.isArray(message.result) ? Object.keys(message.result).slice(0, 12) : undefined,
          invalidCharacters: typeof message.result === 'string' ? message.result.replace(/[A-Za-z0-9_-]/g, '').slice(0, 40) : undefined,
        })
        if (message.auth === true) sendMonitorState(connection, 'connected', { connectedAt: new Date().toISOString() })
      }
      const result = parseLiveResult(payload)
      if (result.listingIds.length || result.resultTokens.length) {
        ipcRenderer.send('market-monitor:result', { searchId: connection.config.searchId, ...result })
      }
    } catch { /* Ignore malformed official frames. */ }
  })
  socket.addEventListener('error', () => sendMonitorState(connection, 'error', { lastErrorCode: 'websocket-error' }))
  socket.addEventListener('close', (event) => {
    if (connection.socket === socket) connection.socket = undefined
    if (connection.stopped) return
    if (event.code === 1008 || event.code === 4004) {
      sendMonitorState(connection, 'invalid-search', { lastErrorCode: `close-${event.code}` })
      return
    }
    if (event.code === 1013) {
      sendMonitorState(connection, 'error', { lastErrorCode: 'rate-limited' })
      return
    }
    if (event.code === 4001 || event.code === 4401) {
      sendMonitorState(connection, 'auth-required', { lastErrorCode: `close-${event.code}` })
      return
    }
    scheduleReconnect(connection)
  })
}

ipcRenderer.on('market-monitor:sync', (_event, value: unknown) => {
  const configs = Array.isArray(value) ? value.filter((entry): entry is MonitorConfig => {
    if (!entry || typeof entry !== 'object') return false
    const config = entry as Partial<MonitorConfig>
    return typeof config.searchId === 'string' && (config.realm === 'cn' || config.realm === 'global') && typeof config.liveUrl === 'string'
  }).slice(0, MAX_ACTIVE_PURCHASE_TARGETS) : []
  const wanted = new Set(configs.map((config) => config.searchId))
  for (const [searchId, connection] of liveConnections) {
    if (!wanted.has(searchId)) {
      stopLive(connection)
      liveConnections.delete(searchId)
    }
  }
  for (const config of configs) {
    const existing = liveConnections.get(config.searchId)
    if (existing && existing.config.liveUrl === config.liveUrl) continue
    if (existing) stopLive(existing)
    const connection: LiveConnection = { config, retryAttempt: 0, stopped: false }
    liveConnections.set(config.searchId, connection)
    connectLive(connection)
  }
})

ipcRenderer.send('market-monitor:ready')

type FavoriteVisualState = 'idle' | 'pending' | 'active' | 'error'

interface ListingRef {
  realm: 'cn' | 'global'
  listingId: string
  queryId?: string
  sourceUrl: string
}

const BUTTON_CLASS = 'superpoe-market-favorite'
const TRY_ON_BUTTON_CLASS = 'superpoe-market-try-on'
const COPY_POB_BUTTON_CLASS = 'superpoe-market-copy-pob'
const ACTIONS_CLASS = 'superpoe-market-actions'
const CARD_MARKER = 'data-superpoe-market-listing'
const RESULT_CARD_SELECTORS = [
  '.resultset .row[data-id]',
  '.search-results .row[data-id]',
  '.row[data-listing-id]',
  '.row[data-result-id]',
  '[data-listing-id][class*="result"]',
  '[data-result-id][class*="result"]',
].join(',')
const buttonsByListing = new Map<string, Set<HTMLButtonElement>>()
const stateByListing = new Map<string, FavoriteVisualState>()
const tryOnButtonsByListing = new Map<string, Set<HTMLButtonElement>>()
const tryOnStateByListing = new Map<string, FavoriteVisualState>()
type CopyPobState = 'idle' | 'pending' | 'copied' | 'error'
const copyPobButtonsByListing = new Map<string, Set<HTMLButtonElement>>()
const copyPobStateByListing = new Map<string, CopyPobState>()
const copyPobResetTimers = new Map<string, ReturnType<typeof setTimeout>>()
let scanTimer: ReturnType<typeof setTimeout> | undefined
let statusTimer: ReturnType<typeof setTimeout> | undefined
let pageListingsSignature = ''

function migrateTencentTradeState(): void {
  if (window.location.hostname !== 'poe.game.qq.com') return
  try {
    const key = 'lscache-trade2state'
    const current = localStorage.getItem(key)
    const parsed = current ? JSON.parse(current) as unknown : {}
    const state = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {}
    if (state.status === 'securable') return
    localStorage.setItem(key, JSON.stringify({ ...state, realm: 'poe2', status: 'securable' }))
  } catch {
    // The official page remains usable if storage is unavailable or malformed.
  }
}

migrateTencentTradeState()

function safeId(value: string | null | undefined): string | undefined {
  const normalized = value?.trim()
  return normalized && /^[A-Za-z0-9_-]{4,160}$/.test(normalized) ? normalized : undefined
}

function safeSearchCode(value: string | null | undefined): string | undefined {
  const normalized = value?.trim()
  return normalized && /^[A-Za-z0-9_-]{1,8192}$/.test(normalized) ? normalized : undefined
}

function queryIdFromUrl(value: string): string | undefined {
  try {
    const url = new URL(value, window.location.href)
    const query = safeSearchCode(url.searchParams.get('query'))
    if (query) return query
    const parts = url.pathname.split('/').filter(Boolean)
    const searchIndex = parts.indexOf('search')
    if (searchIndex >= 0) return safeSearchCode(parts[searchIndex + 3])
    return undefined
  } catch {
    return undefined
  }
}

function extractRef(card: Element): ListingRef | null {
  const element = card as HTMLElement
  const listingId = safeId(
    element.dataset.listingId
    || element.dataset.resultId
    || element.dataset.id
    || element.getAttribute('data-listing-id')
    || element.getAttribute('data-result-id')
    || element.getAttribute('data-id'),
  )
  if (!listingId) return null
  const queryId = safeSearchCode(element.dataset.queryId || element.dataset.query)
    || queryIdFromUrl(element.querySelector<HTMLAnchorElement>('a[href*="query="]')?.href || '')
    || queryIdFromUrl(window.location.href)
  const realm = window.location.hostname === 'poe.game.qq.com' ? 'cn' : 'global'
  return { realm, listingId, queryId, sourceUrl: window.location.href.slice(0, 8_192) }
}

function sourceTextFromElement(element: Element | null): string {
  if (!element) return ''
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
  const parts: string[] = []
  let node: Node | null = walker.nextNode()
  while (node) {
    const textNode = node as Text
    if (!isOwnedElement(textNode.parentElement) && !isUserContent(textNode.parentElement)) parts.push(originalText(textNode))
    node = walker.nextNode()
  }
  return normalizeMarketText(parts.join(' '))
}

function displayTextFromElement(element: Element | null): string {
  if (!element) return ''
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
  const parts: string[] = []
  let node: Node | null = walker.nextNode()
  while (node) {
    const textNode = node as Text
    if (!isOwnedElement(textNode.parentElement) && !isUserContent(textNode.parentElement)) {
      parts.push(textNode.nodeValue || '')
    }
    node = walker.nextNode()
  }
  return normalizeMarketText(parts.join(' '))
}

function sourceAttributeFromElement(element: Element | null, attribute: string): string {
  if (!element) return ''
  return normalizeMarketText(originalAttributeValue(element, attribute))
}

function firstCardDisplayText(card: Element, selectors: string[]): string {
  for (const selector of selectors) {
    const value = displayTextFromElement(card.querySelector(selector))
    if (value) return value
  }
  return ''
}

function cardName(card: Element): string {
  const name = firstCardDisplayText(card, [
    '.item-popup__header--item .item-popup__header-line:first-of-type',
    '.item-name .name',
    '.item-name [class~="name"]',
    '.item-name',
    '[data-item-name]',
    '[data-name]',
    '[class~="name"]',
    '.name',
    'h1', 'h2', 'h3',
  ])
  if (name && !/^Item\s+[A-Za-z0-9_-]{4,160}$/u.test(name) && !/^(?:Verified|Asking Price|Price)$/iu.test(name)) return name
  const generic = Array.from(card.querySelectorAll('[class*="name"], [data-item-name], [data-name], h1, h2, h3'))
    .filter((element) => !/account|seller|character|profile|username|player/u.test(element.getAttribute('class') || ''))
    .map((element) => displayTextFromElement(element))
    .find((value) => value && !/^(?:Verified|Asking Price|Price)$/iu.test(value))
  return generic || ''
}

function cardRarity(card: Element): MarketPageListingRarity {
  const classes = Array.from(card.querySelectorAll('.item-popup, [class*="item-popup"]'))
    .flatMap((element) => Array.from(element.classList))
  if (classes.includes('item-popup--unique')) return 'unique'
  if (classes.includes('item-popup--rare')) return 'rare'
  if (classes.includes('item-popup--magic')) return 'magic'
  if (classes.includes('item-popup--normal')) return 'normal'
  return 'other'
}

function cardIconUrl(card: Element): string | undefined {
  const image = card.querySelector<HTMLImageElement>([
    'img[src*="/gen/image/"]',
    '.item-popup__header--item img',
    '.item-popup__icon img',
    '.item-popup img.item-icon',
    '.item-popup img[src*="/image/"]',
  ].join(', '))
  const source = image?.currentSrc || image?.getAttribute('src') || ''
  return /^https?:\/\//iu.test(source) ? source.slice(0, 4_096) : undefined
}

function cardPropertyTexts(card: Element): string[] {
  const selectors = [
    '.item-popup__property',
    '.item-popup__properties > *',
    '.item-popup .properties .property',
    '.item-popup .properties > div',
    '.item-popup [class~="property"]',
  ]
  const lines: string[] = []
  const seen = new Set<string>()
  for (const selector of selectors) {
    for (const element of Array.from(card.querySelectorAll(selector))) {
      const value = displayTextFromElement(element)
      if (!value || seen.has(value)) continue
      seen.add(value)
      lines.push(value)
    }
  }
  return lines
}

function averageDamageFromProperty(value: string, label: RegExp): number | undefined {
  if (!label.test(value)) return undefined
  const ranges = Array.from(value.matchAll(/(-?\d+(?:[.,]\d+)?)\s*(?:-|–|—|到|至)\s*(-?\d+(?:[.,]\d+)?)/gu))
    .map((match) => [Number(match[1].replace(',', '.')), Number(match[2].replace(',', '.'))])
    .filter(([min, max]) => Number.isFinite(min) && Number.isFinite(max))
  if (!ranges.length) return undefined
  return ranges.reduce((total, [min, max]) => total + (min + max) / 2, 0)
}

function roundedDps(value: number): number {
  return Math.round(value * 100) / 100
}

function cardWeaponStats(card: Element): MarketPageWeaponStats | undefined {
  const properties = cardPropertyTexts(card)
  const attackProperty = properties.find((value) => /(?:attacks?\s*per\s*second|攻击(?:速度|每秒)|每秒攻击)/iu.test(value))
  const attackSpeed = attackProperty
    ? Array.from(attackProperty.matchAll(/(\d+(?:[.,]\d+)?)/gu))
      .map((match) => Number(match[1].replace(',', '.')))
      .find((value) => Number.isFinite(value) && value > 0)
    : undefined
  if (!attackSpeed) return undefined

  const totalAverageFor = (label: RegExp): number | undefined => {
    let total = 0
    let found = false
    for (const value of properties) {
      const average = averageDamageFromProperty(value, label)
      if (average === undefined) continue
      total += average
      found = true
    }
    return found ? total : undefined
  }
  const physicalAverage = totalAverageFor(/(?:physical\s+damage|物理伤害)/iu)
  const elementalAverage = totalAverageFor(/(?:elemental\s+damage|元素伤害)/iu)
  const chaosAverage = totalAverageFor(/(?:chaos\s+damage|混沌伤害)/iu)
  const physicalDps = physicalAverage === undefined ? undefined : roundedDps(physicalAverage * attackSpeed)
  const elementalDps = elementalAverage === undefined ? undefined : roundedDps(elementalAverage * attackSpeed)
  const chaosDps = chaosAverage === undefined ? undefined : roundedDps(chaosAverage * attackSpeed)
  const roundedTotalDps = roundedDps(((physicalAverage || 0) + (elementalAverage || 0) + (chaosAverage || 0)) * attackSpeed)
  if (!roundedTotalDps) return undefined
  return {
    totalDps: roundedTotalDps,
    ...(physicalDps !== undefined ? { physicalDps } : {}),
    ...(elementalDps !== undefined ? { elementalDps } : {}),
    ...(chaosDps !== undefined ? { chaosDps } : {}),
  }
}

function firstNumberAfterLabel(value: string, label: RegExp): number | undefined {
  const match = value.match(label)
  if (!match || match.index === undefined) return undefined
  const number = value.slice(match.index + match[0].length).match(/\d+(?:[.,]\d+)?/u)?.[0]
  if (!number) return undefined
  const parsed = Number(number.replace(',', '.'))
  return Number.isFinite(parsed) ? parsed : undefined
}

function cardDefenseStats(card: Element): MarketPageDefenseStats | undefined {
  const properties = cardPropertyTexts(card)
  const findValue = (label: RegExp): number | undefined => {
    for (const property of properties) {
      const value = firstNumberAfterLabel(property, label)
      if (value !== undefined) return value
    }
    return undefined
  }
  const armour = findValue(/(?:armou?r(?:\s+rating)?|护甲(?:值)?)/iu)
  const evasion = findValue(/(?:evasion(?:\s+rating)?|闪避(?:值)?)/iu)
  const energyShield = findValue(/(?:energy\s+shield|能量护盾)/iu)
  const runicWard = findValue(/(?:runic\s+ward|灵能护盾|符文护盾)/iu)
  const block = findValue(/(?:block(?:\s+chance)?|格挡(?:率|几率)?)/iu)
  const spirit = findValue(/(?:spirit|精神)/iu)
  if ([armour, evasion, energyShield, runicWard, block, spirit].every((value) => value === undefined)) return undefined
  return {
    ...(armour !== undefined ? { armour } : {}),
    ...(evasion !== undefined ? { evasion } : {}),
    ...(energyShield !== undefined ? { energyShield } : {}),
    ...(runicWard !== undefined ? { runicWard } : {}),
    ...(block !== undefined ? { block } : {}),
    ...(spirit !== undefined ? { spirit } : {}),
  }
}

interface CardPrice {
  text: string
  amount?: string
  currency?: string
  iconUrl?: string
}

function cardPrice(card: Element): CardPrice {
  const priceElement = card.querySelector('.right .price [data-field="price"], .price [data-field="price"]')
  if (priceElement) {
    const currencyElement = priceElement.querySelector('.currency-image')
    const currency = displayTextFromElement(currencyElement)
    const localizedCurrency = currency ? marketPageTranslator.translate(currency, true) : ''
    const amount = Array.from(priceElement.children)
      .map((child) => displayTextFromElement(child))
      .find((value) => /^\d[\d,.]*$/u.test(value))
    const icon = currencyElement?.querySelector('img')?.getAttribute('src') || undefined
    const text = [amount, localizedCurrency || currency].filter(Boolean).join(' × ')
    if (text) return {
      text,
      ...(amount ? { amount } : {}),
      ...((localizedCurrency || currency) ? { currency: localizedCurrency || currency } : {}),
      ...(icon ? { iconUrl: icon.slice(0, 4_096) } : {}),
    }
  }
  const priceContainer = card.querySelector('.right .price, .price')
  if (priceContainer) {
    const value = displayTextFromElement(priceContainer)
      .replace(/^(?:Asking Price|要价)\s*[:：]?\s*/iu, '')
      .replace(/\s+(?:Fee|费用)\s*[:：]?.*$/iu, '')
      .trim()
    if (value && /\d/u.test(value)) return { text: value }
  }
  const text = displayTextFromElement(card)
  const buyout = text.match(/~\s*b\s*\/\s*o\s+.+?(?=\s+Asking\s+Price\b|$)/iu)?.[0]?.trim()
  if (buyout) return { text: buyout }
  for (const selector of [
    '.price .value', '.price .amount', '[class*="price"] .value', '[class*="price"] .amount',
  ]) {
    const value = displayTextFromElement(card.querySelector(selector))
    if (value && !/asking|price|fee/iu.test(value) && /\d/u.test(value)) return { text: value }
  }
  return { text: '' }
}

function cardAffixGroupKind(candidate: Element): MarketListingAffixGroupKind {
  const classes = candidate.classList
  if (classes.contains('item-mod--implicit')) return 'implicit'
  const tier = candidate.querySelector('.pr, .su')
  if (tier?.classList.contains('pr')) return 'prefix'
  if (tier?.classList.contains('su')) return 'suffix'
  return 'other'
}

function cardAffixGroups(card: Element): { affixes: string[]; groups: MarketPageAffixGroup[] } {
  const candidates = Array.from(card.querySelectorAll('.item-mod, [class*="item-mod"]'))
  const valuesByKind = new Map<MarketListingAffixGroupKind, string[]>()
  const seen = new Set<string>()
  const affixes: string[] = []
  for (const candidate of candidates) {
    if (candidate.classList.contains('item-mod--pseudo')) continue
    const value = displayTextFromElement(
      candidate.querySelector('[data-field^="stat."], .s.lc') || candidate,
    )
    if (!value || seen.has(value)) continue
    seen.add(value)
    affixes.push(value)
    const kind = cardAffixGroupKind(candidate)
    const values = valuesByKind.get(kind) || []
    values.push(value)
    valuesByKind.set(kind, values)
  }
  const order: MarketListingAffixGroupKind[] = ['implicit', 'prefix', 'suffix', 'other']
  const groups = order
    .map((kind) => ({ kind, values: valuesByKind.get(kind) || [] }))
    .filter((group) => group.values.length)
  return { affixes: affixes.slice(0, 32), groups }
}

function cardDetailLines(card: Element, baseType: string, affixes: string[]): string[] {
  const lines: string[] = []
  const seen = new Set<string>()
  const add = (value: string): void => {
    if (!value || seen.has(value)) return
    seen.add(value)
    lines.push(value)
  }
  add(baseType)
  const selectors = [
    '.itemLevel', '.item-level', '[class*="itemLevel"]', '[class*="item-level"]',
    '.requirements', '[class*="requirement"]',
    '.item-property', '.item-popup__property',
    '.properties .property', '.properties > div', '[class~="property"]',
  ]
  for (const selector of selectors) {
    for (const element of Array.from(card.querySelectorAll(selector))) add(displayTextFromElement(element))
  }
  affixes.forEach(add)
  return lines.slice(0, 64)
}

function cardSummaryStats(card: Element, baseType: string, affixes: string[], weaponStats: MarketPageWeaponStats | undefined): string[] {
  const excluded = new Set([baseType, ...affixes].filter(Boolean))
  const metadataPattern = /(?:item\s*level|requires?|quality|sockets?|corrupted|unidentified|identified|物品等级|要求|品质|插槽|损坏|未鉴定|已鉴定)/iu
  const lines: string[] = []
  const seen = new Set<string>()
  const add = (value: string): void => {
    if (!value || excluded.has(value) || metadataPattern.test(value) || seen.has(value)) return
    if (weaponStats && /(?:physical\s+damage|elemental\s+damage|chaos\s+damage|attacks?\s*per\s*second|物理伤害|元素伤害|混沌伤害|攻击(?:速度|每秒)|每秒攻击)/iu.test(value)) return
    seen.add(value)
    lines.push(value)
  }
  const selectors = [
    '.item-popup__property',
    '.item-popup__properties > *',
    '.item-popup .properties .property',
    '.item-popup .properties > div',
    '.item-popup [class~="property"]',
  ]
  for (const selector of selectors) {
    for (const element of Array.from(card.querySelectorAll(selector))) add(displayTextFromElement(element))
  }
  return lines.slice(0, 8)
}

function currentPageListingSummary(card: Element, ref: ListingRef): MarketPageListingSummary {
  const name = cardName(card)
  const baseType = firstCardDisplayText(card, [
    '.item-popup__header--item .item-popup__header-line:nth-of-type(2)',
    '.item-name .typeLine',
    '.item-name .type-line',
    '.typeLine',
    '.type-line',
    '[class*="typeLine"]',
  ])
  const price = cardPrice(card)
  const seller = firstCardDisplayText(card, [
    '.account-name',
    '.account',
    '.seller',
    '[class*="account"]',
    '[class*="seller"]',
    'a[href*="/account/view-profile/"]',
  ])
  const { affixes, groups: affixGroups } = cardAffixGroups(card)
  const iconUrl = cardIconUrl(card)
  const weaponStats = cardWeaponStats(card)
  const defenseStats = cardDefenseStats(card)
  const summaryStats = cardSummaryStats(card, baseType, affixes, weaponStats)
  const detailLines = cardDetailLines(card, baseType, affixes)
  return {
    realm: ref.realm,
    listingId: ref.listingId,
    ...(ref.queryId ? { queryId: ref.queryId } : {}),
    name: name || `Item ${ref.listingId}`,
    ...(baseType && baseType !== name ? { baseType } : {}),
    rarity: cardRarity(card),
    ...(iconUrl ? { iconUrl } : {}),
    ...(weaponStats ? { weaponStats } : {}),
    ...(defenseStats ? { defenseStats } : {}),
    ...(price.text ? { price: price.text } : {}),
    ...(price.amount ? { priceAmount: price.amount } : {}),
    ...(price.currency ? { priceCurrency: price.currency } : {}),
    ...(price.iconUrl ? { priceIconUrl: price.iconUrl } : {}),
    ...(seller ? { seller } : {}),
    ...(affixes.length ? { affixes } : {}),
    ...(affixGroups.length ? { affixGroups } : {}),
    ...(summaryStats.length ? { summaryStats } : {}),
    ...(detailLines.length ? { detailLines } : {}),
  }
}

function currentPageCards(): Element[] {
  const seen = new Set<Element>()
  const cards: Element[] = []
  for (const card of Array.from(document.querySelectorAll(RESULT_CARD_SELECTORS))) {
    if (seen.has(card)) continue
    seen.add(card)
    cards.push(card)
  }
  return cards
}

function publishCurrentPageListings(): void {
  if (!marketTranslationConfigured || (isMarketTranslationEnabled() && translationTimer)) return
  const listings = currentPageCards()
    .map((card) => {
      const ref = extractRef(card)
      return ref ? currentPageListingSummary(card, ref) : undefined
    })
    .filter((listing): listing is MarketPageListingSummary => Boolean(listing))
    .slice(0, 20)
  const signature = JSON.stringify(listings)
  if (signature === pageListingsSignature) return
  pageListingsSignature = signature
  ipcRenderer.send('market-page:listings', { listings })
}

function findPageCard(listingId: string): Element | undefined {
  return currentPageCards().find((card) => extractRef(card)?.listingId === listingId)
}

function focusPageListing(listingId: string): void {
  const card = findPageCard(listingId)
  if (!card) return
  card.scrollIntoView({ behavior: 'smooth', block: 'center' })
  card.classList.remove('superpoe-market-page-focus')
  requestAnimationFrame(() => {
    card.classList.add('superpoe-market-page-focus')
    window.setTimeout(() => card.classList.remove('superpoe-market-page-focus'), 1_800)
  })
}

function findOfficialHideoutControl(root: ParentNode, visibleOnly: boolean): HTMLElement | undefined {
  const hideoutWords = [
    'travel to hideout', 'visit hideout', 'go to hideout',
    '前往藏身处', '前往藏身處', '进入藏身处', '進入藏身處', '은신처로 이동',
  ]
  return Array.from(root.querySelectorAll('button, [role="button"], a'))
    .filter((element) => !isOwnedElement(element) && (!visibleOnly || isVisibleOfficialControl(element)))
    .map((element) => ({ element, label: officialControlLabel(element) }))
    .filter(({ label }) => hideoutWords.some((word) => label.includes(word)))
    .sort((left, right) => {
      const leftScore = left.element.tagName === 'BUTTON' ? 2 : 0
      const rightScore = right.element.tagName === 'BUTTON' ? 2 : 0
      return rightScore - leftScore
    })
    .map(({ element }) => element as HTMLElement)[0]
}

function clickOfficialHideout(listingId: string): void {
  const card = findPageCard(listingId)
  if (!card) return
  focusPageListing(listingId)
  const click = (): boolean => {
    const target = findOfficialHideoutControl(card, true) || findOfficialHideoutControl(card, false)
    if (!(target instanceof HTMLElement)) return false
    target.click()
    return true
  }
  if (click()) return
  card.scrollIntoView({ behavior: 'smooth', block: 'center' })
  const hoverTarget = card.querySelector('.item-popup, .item, .item-container') || card
  if (typeof PointerEvent !== 'undefined') {
    hoverTarget.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, composed: true, pointerType: 'mouse' }))
    hoverTarget.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, composed: true, pointerType: 'mouse' }))
  }
  hoverTarget.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, composed: true }))
  hoverTarget.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, composed: true }))
  hoverTarget.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true, composed: true }))
  let attempts = 0
  const retry = (): void => {
    if (click() || attempts >= 8) return
    attempts += 1
    window.setTimeout(retry, 120)
  }
  window.setTimeout(retry, 80)
}

function officialControlLabel(element: Element): string {
  const text = sourceTextFromElement(element)
  const attributes = ['aria-label', 'title', 'data-label', 'value']
    .map((attribute) => sourceAttributeFromElement(element, attribute))
    .filter(Boolean)
  return normalizeMarketText([text, ...attributes].join(' ')).toLocaleLowerCase()
}

function isVisibleOfficialControl(element: Element): boolean {
  if (element instanceof HTMLButtonElement && element.disabled) return false
  if (element instanceof HTMLInputElement && element.disabled) return false
  const html = element as HTMLElement
  if (html.hidden || html.getAttribute('aria-hidden') === 'true') return false
  const style = window.getComputedStyle(html)
  return style.display !== 'none' && style.visibility !== 'hidden' && html.getClientRects().length > 0
}

function clickOfficialPageCommand(command: 'search' | 'clear'): void {
  const commandWords = command === 'search'
    ? new Set(['search', '搜索', '搜尋', '검색'])
    : new Set(['clear', 'reset', 'clear all', '清空', '清除', '重置'])
  const candidates = Array.from(document.querySelectorAll('button, [role="button"], input[type="submit"], input[type="button"]'))
    .filter((element) => !isOwnedElement(element) && isVisibleOfficialControl(element))
    .map((element) => {
      const label = officialControlLabel(element)
      const tokens = label.split(/\s+/u).filter(Boolean)
      const exactLabel = tokens.length === 1
        ? commandWords.has(tokens[0])
        : commandWords.has(label)
      const inSearchContext = Boolean(element.closest('form, .search, [class*="search"], [class*="filter"], [class*="query"]'))
      const matched = exactLabel
      if (!matched) return undefined
      const score = (inSearchContext ? 10 : 0)
        + (element instanceof HTMLButtonElement && element.type === (command === 'search' ? 'submit' : 'button') ? 3 : 0)
        + (element.tagName === 'BUTTON' ? 2 : 0)
      return { element, score }
    })
    .filter((candidate): candidate is { element: Element; score: number } => Boolean(candidate))
    .sort((left, right) => right.score - left.score)
  const target = candidates[0]?.element
  if (target instanceof HTMLElement) {
    target.click()
    return
  }
  const form = Array.from(document.forms).find((candidate) => {
    const controls = Array.from(candidate.querySelectorAll('button, [role="button"], input[type="submit"], input[type="button"]'))
    return controls.some((control) => !isOwnedElement(control) && isVisibleOfficialControl(control) && commandWords.has(officialControlLabel(control)))
  })
  if (command === 'search' && form) form.requestSubmit()
}

function focusOfficialFilterArea(): void {
  const filterWords = [
    'type filters', 'equipment filters', 'stat filters', 'item category',
    '类型筛选', '装备筛选', '属性筛选', '物品类别',
    '類型篩選', '裝備篩選', '屬性篩選', '物品類別',
  ]
  const isFilterText = (value: string): boolean => {
    const normalized = value.toLocaleLowerCase()
    return filterWords.some((word) => normalized.includes(word))
  }
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  let node: Node | null = walker.nextNode()
  while (node) {
    const textNode = node as Text
    const parent = textNode.parentElement
    if (parent && !isOwnedElement(parent) && !isUserContent(parent) && isVisibleOfficialControl(parent) && isFilterText(originalText(textNode))) {
      parent.scrollIntoView({ behavior: 'smooth', block: 'start' })
      return
    }
    node = walker.nextNode()
  }

  const showFilters = Array.from(document.querySelectorAll('button, [role="button"]'))
    .filter((element) => !isOwnedElement(element) && isVisibleOfficialControl(element))
    .find((element) => /(?:show\s+filters|显示筛选|顯示篩選|展开筛选|展開篩選)/iu.test(officialControlLabel(element)))
  if (showFilters instanceof HTMLElement) showFilters.click()

  const fallback = Array.from(document.querySelectorAll('form, [class*="search"], [class*="filter"]'))
    .filter((element) => !isOwnedElement(element) && isVisibleOfficialControl(element))
    .sort((left, right) => left.getBoundingClientRect().top - right.getBoundingClientRect().top)[0]
  fallback?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

function applyButtonState(button: HTMLButtonElement, state: FavoriteVisualState): void {
  button.dataset.state = state
  button.disabled = state === 'pending'
  button.textContent = state === 'active' ? '★' : state === 'pending' ? '…' : '☆'
  button.title = state === 'active'
    ? l('Remove the market favorite source from the SuperPoE2 equipment library', '从 SuperPoE2 装备仓库移除市场收藏来源', '從 SuperPoE2 裝備倉庫移除市集收藏來源', 'SuperPoE2 장비 보관함에서 거래소 즐겨찾기 출처 제거')
    : state === 'error'
      ? l('Save failed; click to retry', '收藏失败，点击重试', '收藏失敗，點擊重試', '저장 실패, 클릭하여 다시 시도')
      : l('Save to the SuperPoE2 equipment library', '收藏到 SuperPoE2 装备仓库', '收藏至 SuperPoE2 裝備倉庫', 'SuperPoE2 장비 보관함에 저장')
  button.dataset.tooltip = button.title
  button.setAttribute('aria-label', button.title)
}

function setListingState(listingId: string, state: FavoriteVisualState): void {
  stateByListing.set(listingId, state)
  for (const button of buttonsByListing.get(listingId) || []) applyButtonState(button, state)
}

function applyTryOnButtonState(button: HTMLButtonElement, state: FavoriteVisualState): void {
  button.dataset.state = state
  button.disabled = state === 'pending'
  button.textContent = state === 'pending' ? '…' : '👕'
  button.title = state === 'error'
    ? l('Try-on failed; click to retry', '试穿失败，点击重试', '試穿失敗，點擊重試', '시험 착용 실패, 클릭하여 다시 시도')
    : l('Try on this item in SuperPoE2', '在 SuperPoE2 中试穿这件装备', '在 SuperPoE2 中試穿這件裝備', 'SuperPoE2에서 이 장비 시험 착용')
  button.dataset.tooltip = button.title
  button.setAttribute('aria-label', button.title)
}

function setTryOnState(listingId: string, state: FavoriteVisualState): void {
  tryOnStateByListing.set(listingId, state)
  for (const button of tryOnButtonsByListing.get(listingId) || []) applyTryOnButtonState(button, state)
}

function applyCopyPobButtonState(button: HTMLButtonElement, state: CopyPobState): void {
  button.dataset.state = state
  button.disabled = state === 'pending'
  button.textContent = state === 'pending' ? '…' : state === 'copied' ? '✓' : '⧉'
  button.title = state === 'copied'
    ? l('PoB item text copied', 'PoB 词条已复制', 'PoB 詞綴已複製', 'PoB 아이템 속성을 복사했습니다')
    : state === 'error'
      ? l('Copy failed; click to retry', '复制失败，点击重试', '複製失敗，點擊重試', '복사 실패, 클릭하여 다시 시도')
      : l('Copy PoB item text', '复制 PoB 词条', '複製 PoB 詞綴', 'PoB 아이템 속성 복사')
  button.dataset.tooltip = button.title
  button.setAttribute('aria-label', button.title)
}

function setCopyPobState(listingId: string, state: CopyPobState): void {
  const existingTimer = copyPobResetTimers.get(listingId)
  if (existingTimer) clearTimeout(existingTimer)
  copyPobResetTimers.delete(listingId)
  copyPobStateByListing.set(listingId, state)
  for (const button of copyPobButtonsByListing.get(listingId) || []) applyCopyPobButtonState(button, state)
  if (state === 'copied') {
    const timer = setTimeout(() => {
      copyPobResetTimers.delete(listingId)
      setCopyPobState(listingId, 'idle')
    }, 2_000)
    copyPobResetTimers.set(listingId, timer)
  }
}

function scheduleStatusRequest(): void {
  if (statusTimer) clearTimeout(statusTimer)
  statusTimer = setTimeout(() => {
    const listingIds = [...buttonsByListing.keys()].slice(0, 250)
    if (listingIds.length) ipcRenderer.send('market-enhancement:status-request', { listingIds })
  }, 120)
}

function decorateCard(card: Element): void {
  if (card.hasAttribute(CARD_MARKER)) return
  const ref = extractRef(card)
  if (!ref) return
  card.setAttribute(CARD_MARKER, ref.listingId)
  const button = document.createElement('button')
  button.type = 'button'
  button.className = BUTTON_CLASS
  button.dataset.listingId = ref.listingId
  applyButtonState(button, stateByListing.get(ref.listingId) || 'idle')
  button.addEventListener('click', (event) => {
    event.preventDefault()
    event.stopImmediatePropagation()
    setListingState(ref.listingId, 'pending')
    ipcRenderer.send('market-enhancement:favorite-toggle', {
      requestId: crypto.randomUUID(),
      ref: { ...ref, sourceUrl: window.location.href.slice(0, 2_048) },
    })
  }, true)
  const tryOnButton = document.createElement('button')
  tryOnButton.type = 'button'
  tryOnButton.className = TRY_ON_BUTTON_CLASS
  tryOnButton.dataset.listingId = ref.listingId
  applyTryOnButtonState(tryOnButton, tryOnStateByListing.get(ref.listingId) || 'idle')
  tryOnButton.addEventListener('click', (event) => {
    event.preventDefault()
    event.stopImmediatePropagation()
    const requestId = crypto.randomUUID()
    setTryOnState(ref.listingId, 'pending')
    ipcRenderer.send('market-enhancement:try-on', {
      requestId,
      ref: { ...ref, sourceUrl: window.location.href.slice(0, 2_048) },
    })
  }, true)
  const copyPobButton = document.createElement('button')
  copyPobButton.type = 'button'
  copyPobButton.className = COPY_POB_BUTTON_CLASS
  copyPobButton.dataset.listingId = ref.listingId
  applyCopyPobButtonState(copyPobButton, copyPobStateByListing.get(ref.listingId) || 'idle')
  copyPobButton.addEventListener('click', (event) => {
    event.preventDefault()
    event.stopImmediatePropagation()
    setCopyPobState(ref.listingId, 'pending')
    ipcRenderer.send('market-enhancement:copy-pob', {
      requestId: crypto.randomUUID(),
      ref: { ...ref, sourceUrl: window.location.href.slice(0, 2_048) },
    })
  }, true)
  const target = card.querySelector('.left, .item, .item-container, [class*="item"]') || card
  const actions = document.createElement('span')
  actions.className = ACTIONS_CLASS
  actions.dataset.superpoeMarketOwned = 'true'
  actions.append(button, tryOnButton, copyPobButton)
  target.insertBefore(actions, target.firstChild)
  const buttons = buttonsByListing.get(ref.listingId) || new Set<HTMLButtonElement>()
  buttons.add(button)
  buttonsByListing.set(ref.listingId, buttons)
  const tryOnButtons = tryOnButtonsByListing.get(ref.listingId) || new Set<HTMLButtonElement>()
  tryOnButtons.add(tryOnButton)
  tryOnButtonsByListing.set(ref.listingId, tryOnButtons)
  const copyPobButtons = copyPobButtonsByListing.get(ref.listingId) || new Set<HTMLButtonElement>()
  copyPobButtons.add(copyPobButton)
  copyPobButtonsByListing.set(ref.listingId, copyPobButtons)
}

function scan(root: ParentNode = document): void {
  const listingIds = new Set([
    ...buttonsByListing.keys(),
    ...tryOnButtonsByListing.keys(),
    ...copyPobButtonsByListing.keys(),
  ])
  for (const listingId of listingIds) {
    const buttons = buttonsByListing.get(listingId)
    const tryOnButtons = tryOnButtonsByListing.get(listingId)
    const copyPobButtons = copyPobButtonsByListing.get(listingId)
    for (const button of buttons || []) {
      if (!button.isConnected) buttons?.delete(button)
    }
    for (const button of tryOnButtons || []) {
      if (!button.isConnected) tryOnButtons?.delete(button)
    }
    for (const button of copyPobButtons || []) {
      if (!button.isConnected) copyPobButtons?.delete(button)
    }
    if (!buttons?.size) {
      buttonsByListing.delete(listingId)
      stateByListing.delete(listingId)
    }
    if (!tryOnButtons?.size) {
      tryOnButtonsByListing.delete(listingId)
      tryOnStateByListing.delete(listingId)
    }
    if (!copyPobButtons?.size) {
      copyPobButtonsByListing.delete(listingId)
      copyPobStateByListing.delete(listingId)
      const timer = copyPobResetTimers.get(listingId)
      if (timer) clearTimeout(timer)
      copyPobResetTimers.delete(listingId)
    }
  }
  if (root instanceof Element && root.matches(RESULT_CARD_SELECTORS)) decorateCard(root)
  for (const card of root.querySelectorAll(RESULT_CARD_SELECTORS)) decorateCard(card)
  publishCurrentPageListings()
  scheduleStatusRequest()
}

function scheduleScan(): void {
  if (scanTimer) clearTimeout(scanTimer)
  scanTimer = setTimeout(() => scan(document), 80)
}

function installStyle(): void {
  if (document.getElementById('superpoe-market-style')) return
  const style = document.createElement('style')
  style.id = 'superpoe-market-style'
  style.textContent = `
    @keyframes superpoe-market-gold-flow {
      0% { background-position: 0 0, 0% 50%; }
      50% { background-position: 0 0, 100% 50%; }
      100% { background-position: 0 0, 200% 50%; }
    }
    @keyframes superpoe-market-gold-glow {
      0%, 100% { box-shadow: 0 0 0 1px rgba(255, 224, 151, .12), 0 0 12px rgba(201, 163, 89, .22), 0 10px 28px rgba(0,0,0,.82), inset 0 1px rgba(255, 237, 184, .13); }
      50% { box-shadow: 0 0 0 1px rgba(255, 224, 151, .24), 0 0 24px rgba(201, 163, 89, .42), 0 12px 32px rgba(0,0,0,.86), inset 0 1px rgba(255, 237, 184, .22); }
    }
    @keyframes superpoe-market-page-focus {
      0%, 100% { box-shadow: inset 0 0 0 1px rgba(224, 190, 111, .2); }
      35% { box-shadow: inset 0 0 0 2px rgba(255, 219, 135, .92), 0 0 26px rgba(207, 163, 70, .46); }
    }
    :root {
      scrollbar-color: #62563f #111310 !important;
      scrollbar-width: thin !important;
    }
    *::-webkit-scrollbar { width: 9px !important; height: 9px !important; }
    *::-webkit-scrollbar-track { background: #111310 !important; }
    *::-webkit-scrollbar-corner { background: #111310 !important; }
    *::-webkit-scrollbar-thumb {
      border: 2px solid #111310 !important;
      border-radius: 2px !important;
      background: #62563f !important;
      background-clip: padding-box !important;
    }
    *::-webkit-scrollbar-thumb:hover { background-color: #8f7b58 !important; }
    .${BILINGUAL_SOURCE_CLASS} {
      display: inline !important;
      margin-left: 6px !important;
      color: #8f887b !important;
      font-size: .92em !important;
      font-style: normal !important;
      opacity: .9 !important;
      pointer-events: none !important;
    }
    .${LOCALIZED_SUGGESTION_CLASS} {
      position: absolute !important;
      z-index: 2147483646 !important;
      max-height: min(420px, 60vh) !important;
      box-sizing: border-box !important;
      overflow-y: auto !important;
      overflow-x: hidden !important;
      padding: 0 !important;
      border: 1px solid transparent !important;
      border-radius: 4px !important;
      background: linear-gradient(180deg, rgba(17, 18, 16, .99), rgba(4, 5, 5, .99)) padding-box, linear-gradient(110deg, rgba(104, 79, 38, .9), rgba(255, 224, 151, .98), rgba(147, 108, 48, .92), rgba(255, 241, 187, .96), rgba(104, 79, 38, .9)) border-box !important;
      background-size: 100% 100%, 240% 100% !important;
      animation: superpoe-market-gold-flow 5.5s linear infinite, superpoe-market-gold-glow 3.6s ease-in-out infinite !important;
    }
    input.${LOCALIZED_FILTER_INPUT_ACTIVE_CLASS} {
      border-color: transparent !important;
      background-color: #15120c !important;
      color: #f0d39b !important;
      background-image: linear-gradient(#15120c, #15120c), linear-gradient(110deg, rgba(104, 79, 38, .9), rgba(255, 224, 151, .98), rgba(147, 108, 48, .92), rgba(255, 241, 187, .96), rgba(104, 79, 38, .9)) !important;
      background-origin: padding-box, border-box !important;
      background-clip: padding-box, border-box !important;
      background-size: 100% 100%, 240% 100% !important;
      animation: superpoe-market-gold-flow 5.5s linear infinite, superpoe-market-gold-glow 3.6s ease-in-out infinite !important;
      transition: background-color .18s ease !important;
    }
    .${LOCALIZED_SUGGESTION_CLASS} .multiselect__content {
      display: block !important;
      min-width: 100% !important;
      margin: 0 !important;
      padding: 0 !important;
      list-style: none !important;
    }
    .${LOCALIZED_SUGGESTION_CLASS} .multiselect__element {
      display: block !important;
      margin: 0 !important;
      padding: 0 !important;
      list-style: none !important;
    }
    .${LOCALIZED_SUGGESTION_CLASS} .${LOCALIZED_SUGGESTION_ROW_CLASS} {
      display: block !important;
      width: 100% !important;
      box-sizing: border-box !important;
      white-space: normal !important;
      overflow-wrap: anywhere !important;
      padding: 8px 12px !important;
      border: 0 !important;
      border-bottom: 1px solid rgba(173, 137, 70, .2) !important;
      background: linear-gradient(180deg, rgba(28, 29, 27, .98), rgba(7, 8, 8, .98)) !important;
      color: #d7c08d !important;
      font: 14px/1.35 Arial, sans-serif !important;
      text-align: left !important;
      cursor: pointer !important;
      transition: background .18s ease, color .18s ease, box-shadow .18s ease !important;
    }
    .${LOCALIZED_SUGGESTION_CLASS} .multiselect__element:last-child .${LOCALIZED_SUGGESTION_ROW_CLASS} { border-bottom: 0 !important; }
    .${LOCALIZED_SUGGESTION_CLASS} .${LOCALIZED_SUGGESTION_ROW_CLASS}:hover,
    .${LOCALIZED_SUGGESTION_CLASS} .${LOCALIZED_SUGGESTION_ROW_CLASS}:focus-visible,
    .${LOCALIZED_SUGGESTION_CLASS} .multiselect__option--highlight {
      outline: 0 !important;
      background: linear-gradient(90deg, rgba(86, 64, 31, .7), rgba(18, 17, 13, .98) 58%, rgba(5, 6, 6, .98)) !important;
      color: #ffe0a1 !important;
      box-shadow: inset 3px 0 #d0a85d, inset 0 1px rgba(255, 227, 163, .1), 0 0 12px rgba(201, 163, 89, .14) !important;
    }
    html.${OFFICIAL_SELECTION_COMMITTING_CLASS} .multiselect__content-wrapper:not(.${LOCALIZED_SUGGESTION_CLASS}),
    html.${OFFICIAL_SELECTION_COMMITTING_CLASS} [role="listbox"]:not(.${LOCALIZED_SUGGESTION_CLASS}),
    html.${OFFICIAL_SELECTION_COMMITTING_CLASS} .select2-results {
      visibility: hidden !important;
      pointer-events: none !important;
    }
    .superpoe-market-localized-source {
      margin-left: 6px !important;
      color: #aaa39a !important;
      font-size: .9em !important;
    }
    .superpoe-market-page-focus {
      animation: superpoe-market-page-focus 1.8s ease-in-out !important;
    }
    .${ACTIONS_CLASS} {
      display: inline-flex !important;
      flex-direction: column !important;
      align-items: center !important;
      vertical-align: top !important;
      position: relative !important;
      z-index: 20 !important;
    }
    .${BUTTON_CLASS}, .${TRY_ON_BUTTON_CLASS}, .${COPY_POB_BUTTON_CLASS} {
      box-sizing: border-box !important;
      width: 32px !important;
      height: 32px !important;
      min-width: 32px !important;
      margin: 4px 7px 4px 2px !important;
      padding: 0 !important;
      border: 1px solid #666 !important;
      border-radius: 4px !important;
      background: linear-gradient(135deg, #222, #111) !important;
      color: #888 !important;
      font: 20px/30px Arial, sans-serif !important;
      text-align: center !important;
      cursor: pointer !important;
      vertical-align: top !important;
      position: relative !important;
      z-index: 20 !important;
      transition: transform .2s ease, color .2s ease, border-color .2s ease, box-shadow .2s ease !important;
    }
    .${BUTTON_CLASS}:hover, .${TRY_ON_BUTTON_CLASS}:hover, .${COPY_POB_BUTTON_CLASS}:hover { border-color: #f0d0a0 !important; color: #d4b483 !important; transform: scale(1.05); box-shadow: 0 0 10px rgba(212,180,131,.4) !important; z-index: 2147483647 !important; }
    .${BUTTON_CLASS}[data-state="active"] { color: #d4b483 !important; border-color: #d4b483 !important; background: linear-gradient(135deg, #332a1b, #1a1a1a) !important; text-shadow: 0 0 8px rgba(255,215,0,.6) !important; }
    .${BUTTON_CLASS}[data-state="pending"], .${TRY_ON_BUTTON_CLASS}[data-state="pending"], .${COPY_POB_BUTTON_CLASS}[data-state="pending"] { cursor: wait !important; color: #aaa !important; }
    .${BUTTON_CLASS}[data-state="error"], .${TRY_ON_BUTTON_CLASS}[data-state="error"], .${COPY_POB_BUTTON_CLASS}[data-state="error"] { color: #d88678 !important; border-color: #9b5047 !important; }
    .${COPY_POB_BUTTON_CLASS}[data-state="copied"] { color: #86c49a !important; border-color: #6a9d76 !important; }
    .${BUTTON_CLASS}::after, .${TRY_ON_BUTTON_CLASS}::after, .${COPY_POB_BUTTON_CLASS}::after { content: attr(data-tooltip); position: absolute; right: 0; bottom: 125%; width: max-content; max-width: 260px; padding: 7px 10px; border: 1px solid #a38d6d; border-left: 3px solid #d4b483; border-radius: 4px; background: #0f0f0f; color: #d4b483; font: 600 12px/1.35 Arial, sans-serif; white-space: normal; opacity: 0; visibility: hidden; pointer-events: none; transform: translateY(8px); transition: opacity .18s ease, transform .18s ease; box-shadow: 0 5px 20px rgba(0,0,0,.8); }
    .${BUTTON_CLASS}:hover::after, .${TRY_ON_BUTTON_CLASS}:hover::after, .${COPY_POB_BUTTON_CLASS}:hover::after { opacity: 1; visibility: visible; transform: translateY(0); }
  `
  document.head.appendChild(style)
}

ipcRenderer.on('market-enhancement:status-result', (_event, payload: unknown) => {
  if (!payload || typeof payload !== 'object' || !Array.isArray((payload as { states?: unknown }).states)) return
  for (const state of (payload as { states: Array<{ listingId?: unknown; active?: unknown }> }).states) {
    const listingId = typeof state.listingId === 'string' ? state.listingId : undefined
    const currentState = listingId ? stateByListing.get(listingId) : undefined
    if (listingId && typeof state.active === 'boolean' && currentState !== 'pending' && currentState !== 'error') {
      setListingState(listingId, state.active ? 'active' : 'idle')
    }
  }
})

ipcRenderer.on('market-enhancement:favorite-result', (_event, payload: unknown) => {
  if (!payload || typeof payload !== 'object') return
  const result = payload as { listingId?: unknown; active?: unknown; error?: unknown }
  if (typeof result.listingId !== 'string') return
  setListingState(result.listingId, result.error ? 'error' : result.active ? 'active' : 'idle')
  if (typeof result.error === 'string') {
    const message = result.error.slice(0, 240)
    for (const button of buttonsByListing.get(result.listingId) || []) {
      button.title = `${l('Save failed', '收藏失败', '收藏失敗', '저장 실패')}：${message}`
      button.setAttribute('aria-label', button.title)
    }
  }
})

ipcRenderer.on('market-enhancement:try-on-result', (_event, payload: unknown) => {
  if (!payload || typeof payload !== 'object') return
  const result = payload as { listingId?: unknown; error?: unknown }
  if (typeof result.listingId !== 'string') return
  setTryOnState(result.listingId, result.error ? 'error' : 'idle')
  if (typeof result.error === 'string') {
    const message = result.error.slice(0, 240)
    for (const button of tryOnButtonsByListing.get(result.listingId) || []) {
      button.title = `${l('Try-on failed', '试穿失败', '試穿失敗', '시험 착용 실패')}：${message}`
      button.dataset.tooltip = button.title
      button.setAttribute('aria-label', button.title)
    }
  }
})

ipcRenderer.on('market-enhancement:copy-pob-result', (_event, payload: unknown) => {
  if (!payload || typeof payload !== 'object') return
  const result = payload as { listingId?: unknown; error?: unknown }
  if (typeof result.listingId !== 'string') return
  setCopyPobState(result.listingId, result.error ? 'error' : 'copied')
  if (typeof result.error === 'string') {
    const message = result.error.slice(0, 240)
    for (const button of copyPobButtonsByListing.get(result.listingId) || []) {
      button.title = `${l('Copy failed', '复制失败', '複製失敗', '복사 실패')}：${message}`
      button.dataset.tooltip = button.title
      button.setAttribute('aria-label', button.title)
    }
  }
})

ipcRenderer.on('market-page:command', (_event, value: unknown) => {
  if (value === 'focus-filters') {
    focusOfficialFilterArea()
    return
  }
  if (value !== 'search' && value !== 'clear') return
  clickOfficialPageCommand(value)
})

ipcRenderer.on('market-page:focus-listing', (_event, value: unknown) => {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value)) return
  focusPageListing(value)
})

ipcRenderer.on('market-page:visit-hideout', (_event, value: unknown) => {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value)) return
  clickOfficialHideout(value)
})

ipcRenderer.on('market-enhancement:set-language', (_event, value: unknown) => {
  const nextLanguage = value && typeof value === 'object' && !Array.isArray(value)
    ? (value as { language?: unknown }).language
    : value
  if (!isUiLanguage(nextLanguage)) return
  language = nextLanguage
  setMarketTranslation(value)
  for (const [listingId, buttons] of buttonsByListing) {
    const state = stateByListing.get(listingId) || 'idle'
    for (const button of buttons) applyButtonState(button, state)
  }
  for (const [listingId, buttons] of tryOnButtonsByListing) {
    const state = tryOnStateByListing.get(listingId) || 'idle'
    for (const button of buttons) applyTryOnButtonState(button, state)
  }
  for (const [listingId, buttons] of copyPobButtonsByListing) {
    const state = copyPobStateByListing.get(listingId) || 'idle'
    for (const button of buttons) applyCopyPobButtonState(button, state)
  }
})

window.addEventListener('DOMContentLoaded', () => {
  installStyle()
  scan(document)
  observeMarketRoot(document.documentElement)
  scheduleMarketTranslation()
  document.addEventListener('input', handleLocalizedFilterInput, true)
  document.addEventListener('compositionend', handleLocalizedFilterInput, true)
  document.addEventListener('focusout', (event) => {
    const related = event.relatedTarget as Node | null
    if (related && localizedSuggestionPanel?.contains(related)) return
    if (event.target === localizedSuggestionInput) {
      setTimeout(() => {
        if (!localizedSuggestionPanel?.matches(':hover')) removeLocalizedSuggestionPanel()
      }, 120)
    }
  }, true)
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && localizedSuggestionPanel) removeLocalizedSuggestionPanel()
    if (event.isComposing || !localizedSuggestionPanel || event.target !== localizedSuggestionInput) return
    if (!localizedSuggestionCandidates.length) return
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      event.stopPropagation()
      const direction = event.key === 'ArrowDown' ? 1 : -1
      setLocalizedSuggestionHighlight(localizedSuggestionHighlightIndex + direction)
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      event.stopPropagation()
      selectLocalizedSuggestion(localizedSuggestionHighlightIndex)
    }
  }, true)
  document.addEventListener('mousedown', (event) => {
    const target = event.target as Node | null
    if (target && (target === localizedSuggestionInput || localizedSuggestionPanel?.contains(target))) return
    removeLocalizedSuggestionPanel()
  }, true)
  window.addEventListener('resize', positionLocalizedSuggestionPanel)
  window.addEventListener('scroll', positionLocalizedSuggestionPanel, true)
  window.addEventListener('beforeunload', () => {
    pageListingsSignature = ''
    ipcRenderer.send('market-page:listings', { listings: [] })
  })
  window.addEventListener('popstate', scheduleScan)
  window.addEventListener('hashchange', scheduleScan)
})

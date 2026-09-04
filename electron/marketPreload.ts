import { ipcRenderer } from 'electron'
import { parseLiveResult } from './marketLive.js'
import { MAX_ACTIVE_PURCHASE_TARGETS } from '../src/types/market.js'
import { desktopText, isUiLanguage, type UiLanguage } from './uiLocale.js'
import {
  MarketPageTranslator,
  normalizeMarketText,
  type MarketPageTranslationPayload,
  type MarketTranslationSuggestionScope,
} from '../src/engine/marketPageTranslation.js'

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
  '[role="option"]', '.multiselect__option', '.select2-results__option',
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
let localizedSuggestionPanel: HTMLDivElement | undefined
let localizedSuggestionList: HTMLUListElement | undefined
let localizedSuggestionInput: HTMLInputElement | undefined
let localizedSuggestionCandidates: Array<readonly [source: string, target: string]> = []
let localizedSuggestionSelectionTimer: ReturnType<typeof setTimeout> | undefined
const originalFilterInputValues = new WeakMap<HTMLInputElement, string>()
const renderedFilterInputValues = new WeakMap<HTMLInputElement, string>()
const trackedFilterInputs = new Set<HTMLInputElement>()

function isGlobalMarketHost(): boolean {
  return window.location.hostname === 'www.pathofexile.com' || window.location.hostname === 'pathofexile.com'
}

function isMarketTranslationEnabled(): boolean {
  return isGlobalMarketHost() && marketTranslationPayload.enabled
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

function localizedSuggestionScope(input: HTMLInputElement): MarketTranslationSuggestionScope {
  const context = input.closest(FILTER_CONTEXT_SELECTOR)
  if (!context) return 'all'
  const descriptor = localizedFilterInputDescriptor(input, context)
  // Item/base selectors are checked first because they are usually nested in
  // a generic `.filter` or `.multiselect` container as well.
  if (/(?:search\s*items?|item\s*(?:name|type|category)?|base\s*type|物品|基底)/u.test(descriptor)) return 'items'
  if (/(?:stat|mod|property|attribute|词缀|属性|筛选)/u.test(descriptor)) return 'filters'
  return 'all'
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
  if (localizedSuggestionSelectionTimer) clearTimeout(localizedSuggestionSelectionTimer)
  localizedSuggestionSelectionTimer = undefined
  localizedSuggestionPanel?.remove()
  localizedSuggestionPanel = undefined
  localizedSuggestionList = undefined
  localizedSuggestionInput = undefined
  localizedSuggestionCandidates = []
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
  const rect = localizedSuggestionInput.getBoundingClientRect()
  localizedSuggestionPanel.style.left = `${Math.round(rect.left + window.scrollX)}px`
  localizedSuggestionPanel.style.top = `${Math.round(rect.bottom + window.scrollY + 3)}px`
  localizedSuggestionPanel.style.minWidth = `${Math.max(260, Math.round(rect.width))}px`
}

function selectLocalizedSuggestion(index: number): void {
  const input = localizedSuggestionInput
  const pair = localizedSuggestionCandidates[index]
  if (!input || !pair) return
  removeLocalizedSuggestionPanel()
  setNativeInputValue(input, pair[0])
  input.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, inputType: 'insertText', data: pair[0] }))

  // Official trade controls render their option list asynchronously. Once the
  // canonical English query has populated it, click the matching option so a
  // localized selection has exactly the same effect as an English one.
  let attempts = 0
  const selectOfficialOption = () => {
    attempts += 1
    const expected = normalizeMarketText(pair[0]).toLocaleLowerCase()
    const options = queryMarketElements(SUGGESTION_OPTION_SELECTOR)
    const option = options.find((candidate) => {
      if (isOwnedElement(candidate) || !isFilterSuggestion(candidate)) return false
      const source = candidate.getAttribute('data-superpoe-market-source')
        || candidate.textContent
        || ''
      const normalized = normalizeMarketText(source).toLocaleLowerCase()
      return normalized === expected || normalized.includes(expected)
    })
    if (option) {
      ;(option as HTMLElement).click()
      return
    }
    if (attempts < 30) localizedSuggestionSelectionTimer = setTimeout(selectOfficialOption, 50)
  }
  localizedSuggestionSelectionTimer = setTimeout(selectOfficialOption, 50)
}

function queryMarketElements(selector: string): Element[] {
  const result: Element[] = []
  for (const root of observedMarketRoots) result.push(...Array.from(root.querySelectorAll(selector)))
  return result
}

function showLocalizedSuggestionPanel(input: HTMLInputElement, value: string): void {
  if (localizedSuggestionSelectionTimer) clearTimeout(localizedSuggestionSelectionTimer)
  localizedSuggestionSelectionTimer = undefined
  const candidates = marketPageTranslator.findMatches(value, true, 40, localizedSuggestionScope(input))
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
  localizedSuggestionInput = input
  localizedSuggestionCandidates = candidates
  localizedSuggestionList?.replaceChildren()
  for (let index = 0; index < candidates.length; index += 1) {
    const [source, target] = candidates[index]
    const row = document.createElement('li')
    row.className = 'multiselect__element'
    const option = document.createElement('span')
    option.className = `multiselect__option ${LOCALIZED_SUGGESTION_ROW_CLASS}${index === 0 ? ' multiselect__option--highlight' : ''}`
    option.setAttribute('role', 'option')
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
}

function handleLocalizedFilterInput(event: Event): void {
  if (!isMarketTranslationEnabled()) return
  const input = (event.composedPath?.()[0] || event.target) as Element | null
  if (!isLocalizedFilterInput(input)) return
  if (event instanceof InputEvent && event.isComposing) return
  const value = input.value
  if (!/[\u0080-\uFFFF]/u.test(value)) {
    removeLocalizedSuggestionPanel()
    scheduleMarketTranslation()
    return
  }
  showLocalizedSuggestionPanel(input, value)
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

function scheduleMarketTranslation(): void {
  if (translationTimer) clearTimeout(translationTimer)
  translationTimer = setTimeout(() => {
    translationTimer = undefined
    translateMarketDocument()
  }, 80)
}

function setMarketTranslation(value: unknown): void {
  restoreMarketTranslations()
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const payload = value as Partial<MarketPageTranslationPayload>
    if (payload.schemaVersion === 1 && isUiLanguage(payload.language) && typeof payload.enabled === 'boolean') {
      marketTranslationPayload = payload as MarketPageTranslationPayload
      marketPageTranslator = new MarketPageTranslator(marketTranslationPayload)
      scheduleMarketTranslation()
      return
    }
  }
  marketTranslationPayload = DISABLED_MARKET_TRANSLATION
  marketPageTranslator = new MarketPageTranslator(DISABLED_MARKET_TRANSLATION)
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
      && /^\/api\/trade2\/live\/poe2\/[^/]+\/[A-Za-z0-9_-]{1,128}$/.test(url.pathname)
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

function queryIdFromUrl(value: string): string | undefined {
  try {
    const url = new URL(value, window.location.href)
    const query = safeId(url.searchParams.get('query'))
    if (query) return query
    const parts = url.pathname.split('/').filter(Boolean)
    const searchIndex = parts.indexOf('search')
    if (searchIndex >= 0) return safeId(parts[searchIndex + 3])
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
  const queryId = safeId(element.dataset.queryId || element.dataset.query)
    || queryIdFromUrl(element.querySelector<HTMLAnchorElement>('a[href*="query="]')?.href || '')
    || queryIdFromUrl(window.location.href)
  const realm = window.location.hostname === 'poe.game.qq.com' ? 'cn' : 'global'
  return { realm, listingId, queryId, sourceUrl: window.location.href.slice(0, 2_048) }
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
  const selectors = [
    '.resultset .row[data-id]',
    '.search-results .row[data-id]',
    '.row[data-listing-id]',
    '.row[data-result-id]',
    '[data-listing-id][class*="result"]',
    '[data-result-id][class*="result"]',
  ]
  if (root instanceof Element && selectors.some((selector) => root.matches(selector))) decorateCard(root)
  for (const card of root.querySelectorAll(selectors.join(','))) decorateCard(card)
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
      overflow-y: auto !important;
      padding: 0 !important;
      border: 1px solid #4d5661 !important;
      border-radius: 0 !important;
      background: #1d2126 !important;
      box-shadow: 0 8px 22px rgba(0,0,0,.7) !important;
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
      padding: 8px 12px !important;
      border: 0 !important;
      border-bottom: 1px solid rgba(118,130,143,.22) !important;
      background: #20252b !important;
      color: #d0b078 !important;
      font: 14px/1.35 Arial, sans-serif !important;
      text-align: left !important;
      cursor: pointer !important;
    }
    .${LOCALIZED_SUGGESTION_CLASS} .multiselect__element:last-child .${LOCALIZED_SUGGESTION_ROW_CLASS} { border-bottom: 0 !important; }
    .${LOCALIZED_SUGGESTION_CLASS} .${LOCALIZED_SUGGESTION_ROW_CLASS}:hover,
    .${LOCALIZED_SUGGESTION_CLASS} .${LOCALIZED_SUGGESTION_ROW_CLASS}:focus-visible,
    .${LOCALIZED_SUGGESTION_CLASS} .multiselect__option--highlight {
      outline: 0 !important;
      background: #4b5865 !important;
      color: #f0d19a !important;
    }
    .superpoe-market-localized-source {
      margin-left: 6px !important;
      color: #aaa39a !important;
      font-size: .9em !important;
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
  }, true)
  document.addEventListener('mousedown', (event) => {
    const target = event.target as Node | null
    if (target && (target === localizedSuggestionInput || localizedSuggestionPanel?.contains(target))) return
    removeLocalizedSuggestionPanel()
  }, true)
  window.addEventListener('resize', positionLocalizedSuggestionPanel)
  window.addEventListener('scroll', positionLocalizedSuggestionPanel, true)
  window.addEventListener('popstate', scheduleScan)
  window.addEventListener('hashchange', scheduleScan)
})

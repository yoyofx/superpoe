import type { OfficialMarketCandidate, OfficialItemScope } from '../src/engine/marketOfficialSuggestions.js'
import type { MarketStatContext } from '../src/engine/marketStatScope.js'

export interface OfficialFilterSnapshot {
  token: string
  field: string
  label: string
  kind: 'picker' | 'inline'
  candidates: OfficialMarketCandidate[]
  selected: string[]
  multiple: boolean
  disabled: boolean
  selectionLabel: string
  selectionValue?: string | number | null
  itemScope?: OfficialItemScope
  statContext?: MarketStatContext
}

export interface OfficialFilterCommand {
  action: 'scan' | 'read' | 'select' | 'native' | 'counts' | 'prune' | 'stat-range'
  token?: string
  key?: string
  labels?: Array<[string, string]>
  statIds?: string[]
  rowToken?: string
  statId?: string
  range?: { min: number; max: number }
  previous?: string[]
}

/** Runs in the page's main world. No Electron APIs, closures, or page-wide bridge. */
export async function runOfficialFilterCommand(command: OfficialFilterCommand): Promise<OfficialFilterSnapshot[] | OfficialFilterSnapshot | boolean | { conditions: number; stats: number; statIds: string[] }> {
  const owned = '[data-superpoe-market-owned="true"]'
  const inline = new Set(['rarity', 'status', 'identified', 'fractured_item', 'corrupted', 'sanctified', 'twice_corrupted',
    'mutated', 'veiled', 'desecrated', 'crafted', 'foreseeing', 'mirrored'])
  const picker = new Set(['items', 'stats', 'category', 'price'])
  const normalize = (value: unknown) => typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : ''
  const record = (value: unknown): Record<string, any> => value && typeof value === 'object' ? value as Record<string, any> : {}
  const identity = (option: unknown) => {
    const entry = record(option)
    if (!Object.keys(entry).length) return JSON.stringify(['primitive', option])
    return JSON.stringify([entry.id ?? null, entry.type ?? null, entry.name ?? null, entry.text ?? null, entry.part ?? null])
  }
  // Production Vue 3 removes DOM component references; the official root still
  // exposes its public instance. Resolve multiselects through its rendered tree.
  const components = new Map<Element, Record<string, any>>()
  const statRows = new Map<HTMLElement, () => Record<string, any> | undefined>()
  const visited = new Set<object>()
  const visit = (node: any) => {
    if (!node || typeof node !== 'object' || visited.has(node)) return
    visited.add(node)
    const component = node.component
    if (component) {
      const element = component.vnode?.el
      const vm = component.proxy
      const rowState = [vm?.state, vm?.$props?.state, vm?.filter, vm?.$props?.filter, vm?.value, vm?.$props?.value]
        .find((value) => typeof value?.id === 'string' && /^(?:explicit|implicit|pseudo|fractured|crafted|desecrated|rune|enchant)\./.test(value.id))
      if (element instanceof HTMLElement && typeof rowState?.id === 'string' && /^(?:explicit|implicit|pseudo|fractured|crafted|desecrated|rune|enchant)\./.test(rowState.id)) {
        // Official stat rows use `.filter.full-span`, while property filters
        // have the additional `.filter-property` class.
        const row = element.closest<HTMLElement>('.filter, .filter-property')
        if (row) {
          row.dataset.superpoeStatId = rowState.id
          statRows.set(row, () => {
            // Official Vue rows expose a descriptor in `filter` and the bounds
            // in `state`. Read the owning query entry again after input events:
            // the official handler can create/replace its value object.
            const entry = vm?.$parent?.state?.filters?.[vm.index]
            return entry?.id === rowState.id ? entry : rowState
          })
        }
      }
      if (command.action === 'scan' && element instanceof HTMLElement) {
        const field = vm?.$props?.filter?.id ?? vm?.filter?.id
        if (field === 'ilvl' || field === 'quality') {
          const row = element.closest<HTMLElement>('.filter-property') || element.querySelector<HTMLElement>('.filter-property')
          if (row) row.dataset.superpoeNumericField = field
        }
      }
      if (element instanceof Element && element.classList.contains('multiselect') && typeof vm?.select === 'function') {
        components.set(element, vm)
      }
      visit(component.subTree)
    }
    if (Array.isArray(node.children)) node.children.forEach(visit)
  }
  visit((window as any).app?.$?.subTree)
  const getComponent = (element: Element): Record<string, any> => components.get(element) || record((element as any).__vue__)
  const optionRows = (vm: Record<string, any>): Array<{ option: any; group: string }> => {
    const props = record(vm.$props)
    const options = vm.options ?? props.options ?? vm.filteredOptions
    if (!Array.isArray(options)) return []
    const groupValues = vm.groupValues ?? props.groupValues
    const groupLabel = vm.groupLabel ?? props.groupLabel
    return options.flatMap((option: any) => groupValues && Array.isArray(option?.[groupValues])
      ? option[groupValues].map((entry: any) => ({ option: entry, group: normalize(option[groupLabel]) }))
      : [{ option, group: normalize(option?.type) }])
  }
  const statGroup = (vm: Record<string, any>): { filters: any[]; disabled?: boolean } | undefined => {
    // The add-stat multiselect resets its own value. Read the owning stat group.
    let parent = vm.$parent
    for (let depth = 0; parent && depth < 5; depth++, parent = parent.$parent) {
      const roots = [parent.state, parent.$props?.state, parent.value, parent.$props?.value, parent.filters, parent.$data?.filters]
      for (const root of roots) {
        const rows = Array.isArray(root) ? root : root?.filters
        if (Array.isArray(rows) && rows.every((entry: any) => typeof entry?.id === 'string')) {
          return Array.isArray(root) ? { filters: root } : root
        }
      }
    }
    return undefined
  }
  const selectedKeys = (vm: Record<string, any>, field: string): string[] => {
    if (field === 'stats') {
      const ids = new Set(statGroup(vm)?.filters.map((entry: any) => entry.id) || [])
      return optionRows(vm).filter(({ option }) => ids.has(option?.id)).map(({ option }) => identity(option))
    }
    const value = vm.value ?? vm.$props?.value
    return (Array.isArray(value) ? value : value == null ? [] : [value]).map(identity)
  }
  const fieldFor = (element: Element, vm: Record<string, any>): string => {
    if (element.classList.contains('filter-group-select')) return ''
    // Within native stat rows only the add-stat picker is enhanced. Fixed-value
    // options and group operators belong to the official form, even if their
    // labels or IDs resemble item/condition fields.
    if (element.closest('[data-filter-tab="stats"]') && (element.classList.contains('filter-select-title')
      || !element.classList.contains('filter-select-mutate'))) return ''
    if (element.classList.contains('search-select')) return 'items'
    if (element.classList.contains('filter-select-mutate')) return 'stats'
    const officialField = vm.$parent?.$props?.filter?.id
    if (picker.has(officialField) || inline.has(officialField)) return officialField
    // League and trade status share the status-select CSS class.
    if (element.classList.contains('status-select')) {
      return optionRows(vm).some(({ option }) => option?.id === 'securable') ? 'status' : ''
    }
    const input = element.querySelector('input')
    const expression = normalize(vm.$vnode?.data?.model?.expression)
    const descriptor = [element.id, element.className, input?.id, input?.name, expression, vm.id, vm.$attrs?.id].join(' ')
    for (const field of [...picker, ...inline]) {
      if (new RegExp(`(?:^|[\\s._-])${field}(?:$|[\\s._-])`).test(descriptor)) return field
    }
    const filter = element.closest('.filter-body, .filter')
    const title = normalize(filter?.querySelector('.filter-title')?.textContent || input?.getAttribute('aria-label'))
    for (const [field, label] of command.labels || []) {
      if (title && title.toLocaleLowerCase() === normalize(label).toLocaleLowerCase()) return field
    }
    // Status has no label in the official data catalog.
    const ids = optionRows(vm).map(({ option }) => option?.id)
    if (ids.includes('securable')) return 'status'
    if (ids.includes('normal') && ids.includes('rare')) return 'rarity'
    if (ids.includes('accessory.belt') || ids.includes('weapon')) return 'category'
    if (ids.includes('exalted_divine') || (ids.includes('divine') && ids.includes('chaos'))) return 'price'
    return ''
  }
  if (command.action === 'stat-range') {
    const row = Array.from(document.querySelectorAll<HTMLElement>('.sp-market-unified[open] [data-filter-tab="stats"] [data-superpoe-tier-row-token]'))
      .find((row) => row.dataset.superpoeTierRowToken === command.rowToken)
    const range = command.range
    if (!row || !range || !Number.isFinite(range.min) || !Number.isFinite(range.max) || range.min > range.max
      || (row.dataset.superpoeStatId || row.dataset.statId) !== command.statId) return false
    const inputs = Array.from(row.querySelectorAll<HTMLInputElement>('input.minmax'))
    if (inputs.length !== 2 || inputs.some((input) => input.disabled || input.readOnly)
      || inputs.some((input, index) => input.value !== command.previous?.[index])) return false
    const readState = statRows.get(row)
    let state = readState?.()
    // Vue 2/fixture fallback: identify the owning group and the exact row,
    // including repeated IDs in different groups. Never search globally by ID.
    if (!state) {
      const owner = row.closest('.filter-group')
      for (const element of owner?.querySelectorAll('.multiselect') || []) {
        const vm = getComponent(element)
        if (fieldFor(element, vm) !== 'stats') continue
        const group = statGroup(vm)
        const rows = Array.from(owner!.querySelectorAll<HTMLElement>('.filter-property')).filter((entry) =>
          entry.closest('.filter-group') === owner && Boolean(entry.dataset.superpoeStatId || entry.dataset.statId))
        const candidate = group?.filters[rows.indexOf(row)]
        if (candidate?.id === command.statId) state = candidate
      }
    }
    if (!state || state.id !== command.statId) return false
    const write = (values: string[]) => {
      const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      inputs.forEach((input, index) => setValue.call(input, values[index]))
      for (const input of inputs) {
        input.dispatchEvent(new Event('input', { bubbles: true }))
        input.dispatchEvent(new Event('change', { bubbles: true }))
      }
    }
    write([String(range.min), String(range.max)])
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
    state = readState?.() || state
    if (!row.isConnected || !row.closest('.sp-market-unified[open]') || state.id !== command.statId) return false
    if (state.value && Number(state.value.min) === range.min && Number(state.value.max) === range.max
      && inputs.every((input, index) => Number(input.value) === (index === 0 ? range.min : range.max))) return true
    write(command.previous!)
    return false
  }
  if (command.action === 'counts' || command.action === 'prune') {
    const groups = new Map<any[], { filters: any[]; disabled?: boolean }>()
    for (const element of document.querySelectorAll('[data-filter-tab="stats"] .multiselect')) {
      const vm = getComponent(element)
      if (fieldFor(element, vm) !== 'stats') continue
      const group = statGroup(vm)
      if (group) groups.set(group.filters, group)
    }
    if (command.action === 'prune') {
      const remove = new Set(command.statIds || [])
      for (const group of groups.values()) {
        for (let index = group.filters.length - 1; index >= 0; index--) {
          if (remove.has(group.filters[index].id)) group.filters.splice(index, 1)
        }
      }
      for (const vm of components.values()) vm.$forceUpdate?.()
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
      return [...groups.values()].every((group) => !group.filters.some((entry) => remove.has(entry.id)))
    }
    const stats = [...groups.values()].reduce((sum, group) => sum + (group.disabled ? 0
      : group.filters.filter((entry) => !entry.disabled).length), 0)
    const conditions = Array.from(document.querySelectorAll('[data-filter-tab="conditions"] .filter-property')).filter((row) => {
      // A min/max range and its currency selector are one condition, even with both bounds filled.
      const controls = Array.from(row.querySelectorAll('.multiselect'))
      for (const element of controls) {
        let parent = getComponent(element).$parent
        for (let depth = 0; parent && depth < 5; depth++, parent = parent.$parent) {
          if (parent.state?.disabled === true || parent.$props?.state?.disabled === true) return false
        }
      }
      if (row.closest('.filter-group.disabled, .filter-group[aria-disabled="true"]')) return false
      if (Array.from(row.querySelectorAll<HTMLInputElement>('input:not(.multiselect input),select,textarea'))
        .some((input) => !input.disabled && (input.type === 'checkbox' ? input.checked : input.value.trim() !== ''))) return true
      return controls.some((element) => {
        const vm = getComponent(element)
        if (vm.disabled || vm.$props?.disabled) return false
        const value = vm.value ?? vm.$props?.value
        return (Array.isArray(value) ? value : value == null ? [] : [value]).some((entry) => {
          const id = typeof entry === 'object' ? entry?.id : entry
          return id !== null && id !== undefined && id !== '' && id !== 'any'
        })
      })
    }).length
    return { conditions, stats, statIds: [...groups.values()].flatMap((group) => group.filters.map((entry) => entry.id)) }
  }
  const snapshot = (element: Element, full: boolean): OfficialFilterSnapshot | undefined => {
    const vm = getComponent(element)
    if (typeof vm.select !== 'function') return undefined
    const disabled = Boolean(vm.disabled || vm.$props?.disabled)
    const field = fieldFor(element, vm)
    if (!picker.has(field) && !inline.has(field)) return undefined
    let token = element.getAttribute('data-superpoe-picker-token')
    if (!token) {
      token = `sp-${crypto.randomUUID()}`
      element.setAttribute('data-superpoe-picker-token', token)
    }
    const label = normalize(element.closest('.filter-body, .filter')?.querySelector('.filter-title')?.textContent
      || element.querySelector('input')?.getAttribute('placeholder')) || field
    const candidates = full || inline.has(field) ? optionRows(vm).flatMap(({ option, group }) => {
      if (option?.$isLabel) return []
      let source = ''
      try { source = normalize(vm.getOptionLabel?.(option)) } catch { /* use the official raw label */ }
      source ||= normalize(option?.text || option?.name || option?.type || (typeof option === 'string' ? option : ''))
      if (!source) return []
      return [{ key: identity(option), field, value: option?.id ?? null, source, text: source, group,
        ...(field === 'items' ? { item: { type: normalize(option?.type), name: normalize(option?.name),
          unique: option?.flags?.unique === true ? true : undefined } } : {}),
        disabled: disabled || Boolean(option?.$isDisabled || option?.disabled) }]
    }) : []
    const value = vm.value ?? vm.$props?.value
    let selectionLabel = ''
    try { selectionLabel = normalize(vm.getOptionLabel?.(value)) } catch { /* empty select */ }
    selectionLabel ||= normalize(value?.text || value?.name || value?.type)
    let itemScope: OfficialItemScope | undefined
    let statContext: MarketStatContext | undefined
    if (field === 'items' || field === 'stats') {
      itemScope = { category: '', rarity: '' }
      statContext = { ...itemScope }
      for (const control of document.querySelectorAll('.multiselect')) {
        const component = getComponent(control)
        const scopeField = fieldFor(control, component)
        if (scopeField === 'items') {
          const item = component.value ?? component.$props?.value
          if (typeof item?.type === 'string' && item.type) {
            statContext.item = { type: item.type, name: normalize(item.name) || undefined, unique: item.flags?.unique === true }
            try { statContext.selectionLabel = normalize(component.getOptionLabel?.(item)) } catch { /* use item identity */ }
          }
        }
        if (scopeField !== 'category' && scopeField !== 'rarity') continue
        const selected = component.value ?? component.$props?.value
        itemScope[scopeField] = typeof selected?.id === 'string' ? selected.id : ''
        let label = ''
        try { label = normalize(component.getOptionLabel?.(selected)) } catch { /* empty */ }
        itemScope[scopeField === 'category' ? 'categoryLabel' : 'rarityLabel'] = label
      }
      Object.assign(statContext, itemScope)
    }
    return { token, field, label, kind: picker.has(field) ? 'picker' : 'inline', candidates, itemScope, statContext, selectionValue: value?.id ?? null,
      selected: selectedKeys(vm, field), multiple: field === 'stats', selectionLabel, disabled }
  }
  if (command.action === 'scan') {
    return Array.from(document.querySelectorAll('.multiselect')).filter((element) => !element.closest(owned)
      || Boolean(element.closest('[data-superpoe-official-source="true"]')))
      .flatMap((element) => { const result = snapshot(element, false); return result ? [result] : [] })
  }
  const element = Array.from(document.querySelectorAll('.multiselect[data-superpoe-picker-token]'))
    .find((element) => element.getAttribute('data-superpoe-picker-token') === command.token)
  if (!element) return false
  const vm = getComponent(element)
  if (command.action === 'native') {
    if (element.hasAttribute('data-superpoe-picker-managed') || element.hasAttribute('data-superpoe-picker-pending')) return false
    vm.activate?.()
    ;(element.querySelector('input') as HTMLInputElement | null)?.focus()
    return true
  }
  const before = snapshot(element, true)
  if (!before) return false
  if (command.action === 'read') return before
  if (before.disabled) return false
  const match = optionRows(vm).find(({ option }) => identity(option) === command.key)
  if (!match || match.option?.$isDisabled || match.option?.disabled) return false
  if (before.selected.includes(command.key!)) return before
  // An empty required multiselect does not have a selected object for its default.
  // The official select handler, not input.value, owns the actual query change.
  vm.select(match.option)
  if (typeof vm.$nextTick === 'function') await new Promise<void>((resolve) => vm.$nextTick(resolve))
  await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
  const after = snapshot(element, true)
  if (!after) return false
  if (before.multiple) {
    // An unrecognised group binding must never report a successful addition.
    return after.selected.includes(command.key!) ? after : false
  }
  return after.selected.includes(command.key!) ? after : false
}

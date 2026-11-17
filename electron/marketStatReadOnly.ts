/** Locks existing stat identities/options without changing official query state. */
export class MarketStatReadOnly {
  private locks = new Map<HTMLElement, { inert: boolean; readonly: string | null; label?: HTMLDivElement }>()
  private observer: MutationObserver
  private events = ['pointerdown', 'mousedown', 'click', 'dblclick', 'keydown', 'beforeinput', 'input', 'change'] as const

  constructor(private readonly panel: HTMLElement) {
    for (const name of this.events) panel.addEventListener(name, this.preventEditing, true)
    this.observer = new MutationObserver(() => this.refresh())
    this.observer.observe(panel, { childList: true, characterData: true, subtree: true })
    this.refresh()
  }

  private preventEditing = (event: Event): void => {
    if (!(event.target instanceof Element)) return
    const target = event.target.closest('.filter-title-clickable, .edit-btn, [data-superpoe-stat-readonly]')
    if (!target?.closest('.filter-group-body') || !this.panel.contains(target)) return
    event.preventDefault()
    event.stopImmediatePropagation()
  }

  refresh(): void {
    for (const [control, original] of this.locks) {
      if (this.panel.contains(control)) continue
      this.restore(control, original)
      this.locks.delete(control)
    }
    for (const control of this.panel.querySelectorAll<HTMLElement>('.filter-group-body .multiselect, .filter-group-body select, .filter-group-body input')) {
      if (control.classList.contains('multiselect')) {
        // The dedicated add-stat picker is still the only way to add a stat.
        if (control.classList.contains('filter-select-mutate') && !control.classList.contains('filter-select-title')) continue
      } else if (control.closest('.multiselect, [data-superpoe-market-owned="true"]:not(dialog)')) continue
      else if (control instanceof HTMLInputElement && (control.matches('.minmax') || control.type === 'checkbox')) continue
      let original = this.locks.get(control)
      if (!original) {
        original = { inert: control.inert, readonly: control.getAttribute('aria-readonly') }
        if (control.matches('.multiselect, select')) {
          const label = document.createElement('div')
          label.className = 'filter-title sp-market-stat-locked-label'
          label.style.width = control.style.width || getComputedStyle(control).width
          control.after(label)
          original.label = label
        }
        this.locks.set(control, original)
      }
      if (original.label) {
        const text = control instanceof HTMLSelectElement ? control.selectedOptions[0]?.textContent || ''
          : control.querySelector('.multiselect__single')?.textContent?.trim()
            || control.querySelector('.multiselect__placeholder')?.textContent?.trim()
            || control.querySelector('input')?.getAttribute('placeholder') || ''
        if (original.label.textContent !== text) original.label.textContent = text
        if (control.nextElementSibling !== original.label) control.after(original.label)
      }
      if (!control.inert) control.inert = true
      if (control.getAttribute('aria-readonly') !== 'true') control.setAttribute('aria-readonly', 'true')
      if (!control.hasAttribute('data-superpoe-stat-readonly')) control.setAttribute('data-superpoe-stat-readonly', 'true')
    }
  }

  private restore(control: HTMLElement, original: { inert: boolean; readonly: string | null; label?: HTMLDivElement }): void {
    control.inert = original.inert
    if (original.readonly === null) control.removeAttribute('aria-readonly')
    else control.setAttribute('aria-readonly', original.readonly)
    control.removeAttribute('data-superpoe-stat-readonly')
    original.label?.remove()
  }

  dispose(): void {
    this.observer.disconnect()
    for (const name of this.events) this.panel.removeEventListener(name, this.preventEditing, true)
    for (const [control, original] of this.locks) this.restore(control, original)
    this.locks.clear()
  }
}

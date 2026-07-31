import { ipcRenderer } from 'electron'
import type { OpportunityOverlayState } from '../src/types/market.js'

function text(selector: string, value: string): void {
  const element = document.querySelector<HTMLElement>(selector)
  if (element) element.textContent = value
}

function render(state: OpportunityOverlayState): void {
  text('#target-name', state.searchName || '购买目标')
  text('#summary', `刚发现 ${state.detectedCount} 件 · 当前可尝试 ${state.actionableCount} 件${state.matchedTargetCount && state.matchedTargetCount > 1 ? ` · 匹配 ${state.matchedTargetCount} 个目标` : ''}`)
  const current = state.current
  const details = document.querySelector<HTMLElement>('#details')
  if (details) details.classList.toggle('empty', !current)
  text('#item-name', current?.item?.name || current?.item?.baseType || '暂无可处理机会')
  text('#item-base', current?.item?.baseType || '')
  text('#item-price', current?.item?.price || '未标价')
  text('#item-age', current ? relativeAge(current.detectedAt) : '')
  text('#item-status', state.statusMessage || statusLabel(current?.status))
  const visit = document.querySelector<HTMLButtonElement>('[data-action="attempt"]')
  if (visit) visit.disabled = !current || !state.canVisitHideout || current.status === 'attempting' || current.status === 'attempted'
  for (const action of ['next', 'skip', 'pause', 'complete']) {
    const button = document.querySelector<HTMLButtonElement>(`[data-action="${action}"]`)
    if (button) button.disabled = !current || (action === 'next' && state.alternatives.length < 2)
  }
  const properties = document.querySelector<HTMLElement>('#properties')
  if (properties) {
    const values = [
      current?.item?.itemLevel != null ? `物品等级 ${current.item.itemLevel}` : '',
      current?.item?.quality != null ? `品质 ${current.item.quality}%` : '',
      current?.item?.sockets ? `插槽 ${current.item.sockets}` : '',
      current?.item?.corrupted ? '已腐化' : '',
    ].filter(Boolean)
    properties.replaceChildren(...values.map((value) => { const span = document.createElement('span'); span.textContent = value; return span }))
  }
  const mods = document.querySelector<HTMLElement>('#mods')
  if (mods) {
    mods.replaceChildren(...(current?.item?.modifiers || []).map((modifier) => {
      const row = document.createElement('div')
      row.className = `mod ${modifier.group}`
      const group = document.createElement('em')
      group.textContent = modifier.group === 'explicit' ? (modifier.affixKind === 'prefix' ? '前缀' : modifier.affixKind === 'suffix' ? '后缀' : '显式') : modifier.group === 'implicit' ? '隐式' : modifier.group === 'enchant' ? '附魔' : '符文'
      const line = document.createElement('span')
      line.textContent = modifier.original.displayText
      const tier = document.createElement('b')
      tier.textContent = modifier.tier?.rank != null ? `T${modifier.tier.rank}` : modifier.tier?.name || ''
      row.append(group, line, tier)
      return row
    }))
  }
  const queue = document.querySelector<HTMLElement>('#queue')
  if (queue) {
    queue.replaceChildren(...state.alternatives.map((opportunity) => {
      const button = document.createElement('button')
      button.dataset.action = `select:${opportunity.id}`
      if (opportunity.id === current?.id) button.className = 'active'
      const name = document.createElement('strong')
      name.textContent = opportunity.item?.name || opportunity.item?.baseType || '正在校验'
      const meta = document.createElement('small')
      meta.textContent = `${opportunity.item?.price || '未标价'} · ${relativeAge(opportunity.detectedAt)}`
      button.append(name, meta)
      return button
    }))
  }
}

function relativeAge(value: string): string {
  const seconds = Math.max(0, Math.round((Date.now() - Date.parse(value)) / 1_000))
  if (seconds < 5) return '刚刚'
  if (seconds < 15) return `${seconds} 秒前 · 新挂单`
  return `${seconds} 秒前 · 可能已被抢先`
}

function statusLabel(status: string | undefined): string {
  if (status === 'attempting') return '正在重新校验'
  if (status === 'attempted') return '已发送藏身处请求，不代表购买成功'
  if (status === 'unavailable') return '挂单可能已经失效'
  if (status === 'error') return '校验失败，可以重试'
  return '已取得 listing 信息'
}

window.addEventListener('DOMContentLoaded', () => {
  document.addEventListener('click', (event) => {
    const button = (event.target as Element | null)?.closest<HTMLButtonElement>('[data-action]')
    if (button && !button.disabled) ipcRenderer.send('market-opportunity:action', button.dataset.action)
  })
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') ipcRenderer.send('market-opportunity:action', 'close')
  })
})

ipcRenderer.on('market-opportunity:update', (_event, state: OpportunityOverlayState) => render(state))
ipcRenderer.on('market-opportunity:sound', (_event, volume: number) => {
  try {
    const AudioContextClass = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AudioContextClass) return
    const context = new AudioContextClass()
    const oscillator = context.createOscillator()
    const gain = context.createGain()
    oscillator.type = 'sine'
    oscillator.frequency.setValueAtTime(740, context.currentTime)
    gain.gain.setValueAtTime(Math.max(0, Math.min(1, volume)) * 0.16, context.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.18)
    oscillator.connect(gain).connect(context.destination)
    oscillator.start()
    oscillator.stop(context.currentTime + 0.18)
    oscillator.addEventListener('ended', () => void context.close())
  } catch { /* Sound failure must not affect monitoring. */ }
})

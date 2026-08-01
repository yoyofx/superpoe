import { ipcRenderer } from 'electron'
import type { MarketSoundId, OpportunityOverlayState } from '../src/types/market.js'

function text(selector: string, value: string): void {
  const element = document.querySelector<HTMLElement>(selector)
  if (element) element.textContent = value
}

function render(state: OpportunityOverlayState): void {
  text('#target-name', state.searchName || '购买目标')
  text('#summary', `刚发现 ${state.detectedCount} 件 · 当前可尝试 ${state.actionableCount} 件${state.matchedTargetCount && state.matchedTargetCount > 1 ? ` · 匹配 ${state.matchedTargetCount} 个目标` : ''}`)
  const current = state.current
  const isTest = Boolean(current?.id.startsWith('overlay-test-'))
  const details = document.querySelector<HTMLElement>('#details')
  if (details) details.classList.toggle('empty', !current)
  text('#item-name', current?.item?.name || current?.item?.baseType || '暂无可处理机会')
  text('#item-base', current?.item?.baseType || '')
  text('#item-price', current?.item?.price || '未标价')
  text('#item-age', current ? relativeAge(current.detectedAt) : '')
  text('#item-status', state.statusMessage || statusLabel(current?.status))
  const visit = document.querySelector<HTMLButtonElement>('[data-action="attempt"]')
  if (visit) visit.disabled = isTest || !current || !state.canVisitHideout || current.status === 'attempting' || current.status === 'attempted'
  for (const action of ['next', 'skip', 'pause', 'complete']) {
    const button = document.querySelector<HTMLButtonElement>(`[data-action="${action}"]`)
    if (button) button.disabled = isTest || !current || (action === 'next' && state.alternatives.length < 2)
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
  const readableOverlayStyle = document.createElement('style')
  readableOverlayStyle.textContent = `
    body { font-size: 14px; }
    .head { padding: 10px 12px; }
    .head strong { font-size: 17px; }
    .head small { font-size: 11px; }
    .queue button { min-height: 68px; padding: 9px 10px; }
    .queue strong { font-size: 12px; }
    .queue small { font-size: 11px; }
    .details { gap: 9px; padding: 13px; }
    .item-head h2 { font-size: 20px; }
    .item-head .base { font-size: 12px; }
    .item-head .price { font-size: 13px; }
    .properties { gap: 6px 13px; font-size: 11px; }
    .mod { padding: 8px 4px; }
    .mod em { font-size: 10px; }
    .mod span { font-size: 12px; line-height: 1.48; }
    .mod b { font-size: 11px; }
    .meta { font-size: 11px; }
    .foot button { font-size: 11px; }
    .head-actions { display: flex; align-items: center; gap: 6px; -webkit-app-region: no-drag; }
    .head-actions button[data-action="open-app"] { width: auto; padding: 0 8px; color: #d6bd83; font-size: 11px; }
  `
  document.head.append(readableOverlayStyle)
  const head = document.querySelector<HTMLElement>('.head')
  const closeButton = head?.querySelector<HTMLButtonElement>('[data-action="close"]')
  if (head && closeButton) {
    const actions = document.createElement('div')
    actions.className = 'head-actions'
    const openApp = document.createElement('button')
    openApp.dataset.action = 'open-app'
    openApp.title = '打开实时监控'
    openApp.textContent = '实时监控'
    closeButton.replaceWith(actions)
    actions.append(openApp, closeButton)
  }
  document.addEventListener('click', (event) => {
    const button = (event.target as Element | null)?.closest<HTMLButtonElement>('[data-action]')
    if (button && !button.disabled) ipcRenderer.send('market-opportunity:action', button.dataset.action)
  })
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') ipcRenderer.send('market-opportunity:action', 'close')
  })
})

ipcRenderer.on('market-opportunity:update', (_event, state: OpportunityOverlayState) => render(state))
type Tone = { frequency: number; start: number; duration: number; type: OscillatorType }
const SOUND_PATTERNS: Record<MarketSoundId, Tone[]> = {
  'chime-rise': [{ frequency: 660, start: 0, duration: 0.14, type: 'triangle' }, { frequency: 990, start: 0.11, duration: 0.24, type: 'triangle' }],
  'double-beep': [{ frequency: 740, start: 0, duration: 0.1, type: 'square' }, { frequency: 740, start: 0.16, duration: 0.1, type: 'square' }],
  bell: [{ frequency: 523, start: 0, duration: 0.3, type: 'sine' }, { frequency: 784, start: 0.015, duration: 0.25, type: 'triangle' }],
  digital: [{ frequency: 880, start: 0, duration: 0.07, type: 'square' }, { frequency: 1320, start: 0.09, duration: 0.1, type: 'square' }, { frequency: 1760, start: 0.21, duration: 0.1, type: 'square' }],
  alert: [{ frequency: 620, start: 0, duration: 0.14, type: 'sawtooth' }, { frequency: 620, start: 0.18, duration: 0.14, type: 'sawtooth' }],
  soft: [{ frequency: 440, start: 0, duration: 0.22, type: 'sine' }, { frequency: 554, start: 0.08, duration: 0.28, type: 'sine' }],
  triple: [{ frequency: 700, start: 0, duration: 0.08, type: 'triangle' }, { frequency: 880, start: 0.1, duration: 0.08, type: 'triangle' }, { frequency: 1100, start: 0.2, duration: 0.13, type: 'triangle' }],
  'low-pulse': [{ frequency: 300, start: 0, duration: 0.18, type: 'sine' }, { frequency: 360, start: 0.2, duration: 0.22, type: 'sine' }],
  bright: [{ frequency: 1200, start: 0, duration: 0.1, type: 'triangle' }, { frequency: 1500, start: 0.12, duration: 0.18, type: 'triangle' }],
  warble: [{ frequency: 520, start: 0, duration: 0.32, type: 'triangle' }, { frequency: 780, start: 0.04, duration: 0.28, type: 'sine' }],
}
const SOUND_IDS = new Set(Object.keys(SOUND_PATTERNS) as MarketSoundId[])

ipcRenderer.on('market-opportunity:sound', (_event, payload: { volume?: unknown; soundId?: unknown } | number) => {
  try {
    const AudioContextClass = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AudioContextClass) return
    const volume = typeof payload === 'number' ? payload : payload.volume
    const requestedSoundId = typeof payload === 'number' ? undefined : payload.soundId
    const soundId = typeof requestedSoundId === 'string' && SOUND_IDS.has(requestedSoundId as MarketSoundId) ? requestedSoundId as MarketSoundId : 'chime-rise'
    const pattern = SOUND_PATTERNS[soundId]
    const context = new AudioContextClass()
    const now = context.currentTime
    const master = context.createGain()
    const compressor = context.createDynamicsCompressor()
    const level = Math.max(0, Math.min(1, typeof volume === 'number' && Number.isFinite(volume) ? volume : 0.7))
    const end = Math.max(...pattern.map((tone) => tone.start + tone.duration))
    master.gain.setValueAtTime(level * 0.38, now)
    compressor.threshold.setValueAtTime(-18, now)
    compressor.knee.setValueAtTime(12, now)
    compressor.ratio.setValueAtTime(8, now)
    compressor.attack.setValueAtTime(0.003, now)
    compressor.release.setValueAtTime(0.14, now)
    master.connect(compressor).connect(context.destination)
    for (const tone of pattern) {
      const oscillator = context.createOscillator()
      const gain = context.createGain()
      const start = now + tone.start
      const end = start + tone.duration
      oscillator.type = tone.type
      oscillator.frequency.setValueAtTime(tone.frequency, start)
      gain.gain.setValueAtTime(0.0001, start)
      gain.gain.exponentialRampToValueAtTime(0.78, start + 0.012)
      gain.gain.exponentialRampToValueAtTime(0.0001, end)
      oscillator.connect(gain).connect(master)
      oscillator.start(start)
      oscillator.stop(end + 0.02)
    }
    void context.resume().catch(() => {})
    window.setTimeout(() => void context.close(), (end + 0.18) * 1_000)
  } catch { /* Sound failure must not affect monitoring. */ }
})

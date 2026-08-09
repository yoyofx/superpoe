import { ipcRenderer } from 'electron'
import type { MarketSoundId, OpportunityOverlayState } from '../src/types/market.js'
import { desktopText, type UiLanguage } from './uiLocale.js'

let language: UiLanguage = 'en'
const l = (en: string, zhCN: string, zhTW: string, koKR: string) => desktopText(language, en, zhCN, zhTW, koKR)

function text(selector: string, value: string): void {
  const element = document.querySelector<HTMLElement>(selector)
  if (element) element.textContent = value
}

function render(state: OpportunityOverlayState): void {
  language = state.language
  document.documentElement.lang = ({ en: 'en-US', 'zh-rCN': 'zh-CN', 'zh-rTW': 'zh-TW', 'ko-KR': 'ko-KR' })[language]
  localizeStaticControls()
  text('#target-name', state.searchName || l('Purchase target', '购买目标', '購買目標', '구매 대상'))
  text('#summary', `${l('Found', '刚发现', '剛發現', '발견')} ${state.detectedCount} ${l('items', '件', '件', '개')} · ${l('Actionable', '当前可尝试', '目前可嘗試', '시도 가능')} ${state.actionableCount}${state.matchedTargetCount && state.matchedTargetCount > 1 ? ` · ${l('Matches', '匹配', '符合', '일치')} ${state.matchedTargetCount} ${l('targets', '个目标', '個目標', '개 대상')}` : ''}`)
  const current = state.current
  const isTest = Boolean(current?.id.startsWith('overlay-test-'))
  const details = document.querySelector<HTMLElement>('#details')
  if (details) details.classList.toggle('empty', !current)
  text('#item-name', current?.item?.name || current?.item?.baseType || l('No actionable opportunities', '暂无可处理机会', '暫無可處理機會', '처리할 기회가 없습니다'))
  text('#item-base', current?.item?.baseType || '')
  text('#item-price', current?.item?.price || l('Unpriced', '未标价', '未標價', '가격 없음'))
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
      current?.item?.itemLevel != null ? `${l('Item Level', '物品等级', '物品等級', '아이템 레벨')} ${current.item.itemLevel}` : '',
      current?.item?.quality != null ? `${l('Quality', '品质', '品質', '퀄리티')} ${current.item.quality}%` : '',
      current?.item?.sockets ? `${l('Sockets', '插槽', '插槽', '홈')} ${current.item.sockets}` : '',
      current?.item?.corrupted ? l('Corrupted', '已腐化', '已汙染', '타락') : '',
    ].filter(Boolean)
    properties.replaceChildren(...values.map((value) => { const span = document.createElement('span'); span.textContent = value; return span }))
  }
  const mods = document.querySelector<HTMLElement>('#mods')
  if (mods) {
    mods.replaceChildren(...(current?.item?.modifiers || []).map((modifier) => {
      const row = document.createElement('div')
      row.className = `mod ${modifier.group}`
      const group = document.createElement('em')
      group.textContent = modifier.group === 'explicit' ? (modifier.affixKind === 'prefix' ? l('Prefix', '前缀', '前綴', '접두어') : modifier.affixKind === 'suffix' ? l('Suffix', '后缀', '後綴', '접미어') : l('Explicit', '显式', '顯性', '명시')) : modifier.group === 'implicit' ? l('Implicit', '隐式', '固定', '고정') : modifier.group === 'enchant' ? l('Enchant', '附魔', '附魔', '인챈트') : l('Rune', '符文', '符文', '룬')
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
      name.textContent = opportunity.item?.name || opportunity.item?.baseType || l('Validating', '正在校验', '正在驗證', '확인 중')
      const meta = document.createElement('small')
      meta.textContent = `${opportunity.item?.price || l('Unpriced', '未标价', '未標價', '가격 없음')} · ${relativeAge(opportunity.detectedAt)}`
      button.append(name, meta)
      return button
    }))
  }
}

function relativeAge(value: string): string {
  const seconds = Math.max(0, Math.round((Date.now() - Date.parse(value)) / 1_000))
  if (seconds < 5) return l('Just now', '刚刚', '剛剛', '방금')
  if (seconds < 15) return `${seconds} ${l('seconds ago · new listing', '秒前 · 新挂单', '秒前 · 新掛單', '초 전 · 새 매물')}`
  return `${seconds} ${l('seconds ago · may already be taken', '秒前 · 可能已被抢先', '秒前 · 可能已被搶先', '초 전 · 이미 거래됐을 수 있음')}`
}

function statusLabel(status: string | undefined): string {
  if (status === 'attempting') return l('Revalidating', '正在重新校验', '正在重新驗證', '다시 확인 중')
  if (status === 'attempted') return l('Hideout request sent; purchase is not confirmed', '已发送藏身处请求，不代表购买成功', '已傳送藏身處請求，不代表購買成功', '은신처 요청 전송됨, 구매는 확정되지 않음')
  if (status === 'unavailable') return l('The listing may no longer be available', '挂单可能已经失效', '掛單可能已失效', '매물이 더 이상 유효하지 않을 수 있음')
  if (status === 'error') return l('Validation failed; try again', '校验失败，可以重试', '驗證失敗，可再次嘗試', '확인 실패, 다시 시도하세요')
  return l('Listing information received', '已取得 listing 信息', '已取得 listing 資訊', '매물 정보 수신됨')
}

function localizeStaticControls(): void {
  const labels: Record<string, string> = {
    next: l('Next item', '下一件', '下一件', '다음 아이템'),
    skip: l('Skip item', '跳过这件', '跳過此件', '아이템 건너뛰기'),
    pause: l('Pause target', '暂停此目标', '暫停此目標', '대상 일시 중지'),
    complete: l('Complete target', '完成目标', '完成目標', '대상 완료'),
    attempt: l('Visit hideout', '前往藏身处', '前往藏身處', '은신처 방문'),
  }
  for (const [action, label] of Object.entries(labels)) text(`[data-action="${action}"]`, label)
  const close = document.querySelector<HTMLButtonElement>('[data-action="close"]')
  if (close) close.title = l('Close', '关闭', '關閉', '닫기')
  const openApp = document.querySelector<HTMLButtonElement>('[data-action="open-app"]')
  if (openApp) {
    openApp.title = l('Open live monitoring', '打开实时监控', '開啟即時監控', '실시간 모니터링 열기')
    openApp.textContent = l('Live monitoring', '实时监控', '即時監控', '실시간 모니터링')
  }
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
    openApp.title = l('Open live monitoring', '打开实时监控', '開啟即時監控', '실시간 모니터링 열기')
    openApp.textContent = l('Live monitoring', '实时监控', '即時監控', '실시간 모니터링')
    closeButton.replaceWith(actions)
    actions.append(openApp, closeButton)
  }
  localizeStaticControls()
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

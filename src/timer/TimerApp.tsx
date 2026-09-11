import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { Check, ChevronDown, Maximize2, Minus, Move, Pause, Play, RotateCcw, Settings2, Square, X } from 'lucide-react'
import { useTranslation } from '@/i18n/useTranslation'
import { uiText } from '@/i18n/uiLocale'
import './timer.css'

type TimerState = 'idle' | 'running' | 'paused' | 'finished'
type SkinId = 'obsidian' | 'ember' | 'frost' | 'strip'
type TimerSnapshot = { state: TimerState; elapsed: number; gameRunning: boolean }

const isSettingsSurface = new URLSearchParams(location.search).get('surface') === 'timer-settings'

const SKINS: Array<{ id: SkinId; en: string; zh: string }> = [
  { id: 'obsidian', en: 'Obsidian Gold', zh: '黑曜流金' },
  { id: 'ember', en: 'Ember Iron', zh: '赤炼铸铁' },
  { id: 'frost', en: 'Frost Silver', zh: '霜银秘仪' },
  { id: 'strip', en: 'Obsidian Rail', zh: '黑曜横轨' },
]

function formatElapsed(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1_000))
  const hours = Math.floor(totalSeconds / 3_600)
  const minutes = Math.floor((totalSeconds % 3_600) / 60)
  const seconds = totalSeconds % 60
  return hours > 0
    ? `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
    : `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
}

function formatSystemTime(date: Date): string {
  return [date.getHours(), date.getMinutes(), date.getSeconds()]
    .map((value) => value.toString().padStart(2, '0'))
    .join(':')
}

export function TimerApp() {
  const { lang } = useTranslation()
  const l = (en: string, zhCN: string, zhTW: string, koKR: string) => uiText(lang, en, zhCN, zhTW, koKR)
  const [state, setState] = useState<TimerState>('idle')
  const [elapsed, setElapsed] = useState(0)
  const [gameRunning, setGameRunning] = useState(false)
  const [showSystemTime, setShowSystemTime] = useState(false)
  const [systemTime, setSystemTime] = useState(() => new Date())
  const [skin, setSkin] = useState<SkinId>(() => {
    const saved = localStorage.getItem('superpoe-timer-skin')
    return saved === 'ember' || saved === 'frost' || saved === 'strip' ? saved : 'obsidian'
  })
  const [isResizing, setIsResizing] = useState(false)
  const resizeStartRef = useRef<{ x: number; y: number; width: number; skin: SkinId } | null>(null)
  const faceClickRef = useRef<number | null>(null)
  useEffect(() => {
    document.documentElement.style.setProperty('background', 'transparent', 'important')
    document.documentElement.style.setProperty('background-color', 'transparent', 'important')
    document.body.style.setProperty('background', 'transparent', 'important')
    document.body.style.setProperty('background-color', 'transparent', 'important')
    const root = document.getElementById('root')
    root?.style.setProperty('background', 'transparent', 'important')
    root?.style.setProperty('background-color', 'transparent', 'important')
  }, [])

  useEffect(() => {
    const applySnapshot = (snapshot: TimerSnapshot) => {
      setState(snapshot.state)
      setElapsed(Math.max(0, snapshot.elapsed))
      setGameRunning(snapshot.gameRunning)
    }
    const unsubscribe = window.pob2Timer?.onStateChanged((snapshot) => applySnapshot(snapshot))
    void window.pob2Timer?.getState().then((snapshot) => applySnapshot(snapshot))
    return unsubscribe
  }, [])

  useEffect(() => {
    const unsubscribe = window.pob2Timer?.onSkinChanged((value) => {
      if (value === 'obsidian' || value === 'ember' || value === 'frost' || value === 'strip') setSkin(value)
    })
    return unsubscribe
  }, [])

  useEffect(() => { localStorage.setItem('superpoe-timer-skin', skin) }, [skin])
  useEffect(() => { void window.pob2Timer?.setSkin(skin) }, [skin])
  useEffect(() => {
    setShowSystemTime(!gameRunning)
  }, [gameRunning])
  useEffect(() => {
    const timer = window.setInterval(() => setSystemTime(new Date()), 1_000)
    return () => window.clearInterval(timer)
  }, [])
  useEffect(() => () => {
    if (faceClickRef.current !== null) window.clearTimeout(faceClickRef.current)
  }, [])

  const start = () => { void window.pob2Timer?.start() }
  const pause = () => { void window.pob2Timer?.pause() }
  const finish = () => { void window.pob2Timer?.finish() }
  const reset = () => { void window.pob2Timer?.reset() }
  const handleFaceClick = () => {
    if (!gameRunning) return
    if (faceClickRef.current !== null) window.clearTimeout(faceClickRef.current)
    faceClickRef.current = window.setTimeout(() => {
      faceClickRef.current = null
      setShowSystemTime((value) => !value)
    }, 220)
  }
  const handleFaceDoubleClick = () => {
    if (faceClickRef.current !== null) {
      window.clearTimeout(faceClickRef.current)
      faceClickRef.current = null
    }
    void window.pob2Timer?.openSettings()
  }

  const beginResize = (event: ReactPointerEvent<HTMLButtonElement>) => {
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    resizeStartRef.current = { x: event.clientX, y: event.clientY, width: window.innerWidth, skin }
    setIsResizing(true)
  }

  useEffect(() => {
    if (!isResizing) return
    const handlePointerMove = (event: PointerEvent) => {
      const start = resizeStartRef.current
      if (!start) return
      const deltaX = event.clientX - start.x
      const deltaY = event.clientY - start.y
      const primaryDelta = start.skin === 'strip'
        ? deltaX
        : Math.abs(deltaX) >= Math.abs(deltaY) ? deltaX : deltaY
      const width = Math.max(1, Math.round(start.width + primaryDelta))
      const height = start.skin === 'strip' ? Math.max(1, Math.round(width * 84 / 276)) : width
      void window.pob2Timer?.resize({ width, height })
    }
    const stopResize = () => {
      resizeStartRef.current = null
      setIsResizing(false)
    }
    document.addEventListener('pointermove', handlePointerMove)
    document.addEventListener('pointerup', stopResize, { once: true })
    return () => {
      document.removeEventListener('pointermove', handlePointerMove)
      document.removeEventListener('pointerup', stopResize)
    }
  }, [isResizing])

  const skinLabel = (entry: typeof SKINS[number]) => lang === 'en' ? entry.en : lang === 'zh-rCN' ? entry.zh : lang === 'zh-rTW' ? entry.zh : entry.en
  const stateLabel = state === 'running'
    ? l('RUNNING', '计时中', '計時中', '진행 중')
    : state === 'paused'
      ? l('PAUSED', '已暂停', '已暫停', '일시 정지')
      : state === 'finished'
        ? l('RECORDED', '已记录', '已記錄', '기록됨')
        : l('READY', '准备开始', '準備開始', '시작 준비')

  return (
    <main className={`timer-app skin-${skin} ${isSettingsSurface ? 'is-settings' : 'is-collapsed'} state-${state} ${isResizing ? 'is-resizing' : ''}`}>
      {!isSettingsSurface ? (
        <div className="timer-face-container">
          <div className="timer-face-collapsed timer-drag-region" role="img" aria-label={l('Map timer. Double-click the center to open.', '地图计时器。双击中心展开。', '地圖計時器。雙擊中心展開。', '지도 타이머. 중앙을 두 번 클릭하여 열기.')}>
            <span className="timer-face-ornament" aria-hidden="true" />
            <span className="timer-face-caption">MAP</span>
            <strong>{!gameRunning || showSystemTime ? formatSystemTime(systemTime) : formatElapsed(elapsed)}</strong>
            <span className="timer-face-state">{stateLabel}</span>
            <i className="timer-hand" aria-hidden="true" />
            <button className="timer-face-open-button no-drag" type="button" onClick={handleFaceClick} onDoubleClick={handleFaceDoubleClick} aria-label={l('Click to toggle system time. Double-click to open timer settings.', '单击切换系统时间，双击打开计时器设置。', '單擊切換系統時間，雙擊開啟計時器設定。', '한 번 클릭하여 시스템 시간 전환, 두 번 클릭하여 타이머 설정 열기')} />
          </div>
          <div className="timer-hover-actions" onPointerDown={(event) => event.stopPropagation()}>
            <button type="button" className="timer-action-button no-drag" onClick={() => void window.pob2Timer?.openSettings()} title={l('Timer settings', '计时器设置', '計時器設定', '타이머 설정')} aria-label={l('Timer settings', '计时器设置', '計時器設定', '타이머 설정')}><Settings2 /></button>
            <button type="button" className="timer-action-button timer-move-handle" title={l('Move timer', '移动计时器', '移動計時器', '타이머 이동')} aria-label={l('Move timer', '移动计时器', '移動計時器', '타이머 이동')}><Move /></button>
            <button type="button" className="timer-action-button no-drag" onPointerDown={beginResize} title={l('Resize timer', '调整计时器大小', '調整計時器大小', '타이머 크기 조절')} aria-label={l('Resize timer', '调整计时器大小', '調整計時器大小', '타이머 크기 조절')}><Maximize2 /></button>
          </div>
        </div>
      ) : (
        <section className="timer-settings-shell">
          <div className="timer-settings-header timer-drag-region">
            <span className="timer-brand-mark" aria-hidden="true">◈</span>
            <div className="timer-settings-heading">
              <strong>{l('Timer settings', '计时器设置', '計時器設定', '타이머 설정')}</strong>
              <small>{l('Appearance', '外观', '外觀', '외관')}</small>
            </div>
            <div className="timer-window-actions">
              <button type="button" className="timer-window-button no-drag" onClick={() => void window.pob2Timer?.closeSettings()} title={l('Back to timer', '返回计时器', '返回計時器', '타이머로 돌아가기')} aria-label={l('Back to timer', '返回计时器', '返回計時器', '타이머로 돌아가기')}><ChevronDown /></button>
              <button type="button" className="timer-window-button no-drag" onClick={() => void window.pob2Timer?.minimize()} title={l('Minimize', '最小化', '最小化', '최소화')} aria-label={l('Minimize', '最小化', '最小化', '최소화')}><Minus /></button>
              <button type="button" className="timer-window-button no-drag" onClick={() => void window.pob2Timer?.closeSettings()} title={l('Close', '关闭', '關閉', '닫기')} aria-label={l('Close', '关闭', '關閉', '닫기')}><X /></button>
            </div>
          </div>
          <div className="timer-settings-body no-drag">
            <div className="timer-settings-section-title">
              <Settings2 />
              <strong>{l('Skins', '皮肤', '皮膚', '스킨')}</strong>
              <small>{l('Choose a timer appearance', '选择计时器外观', '選擇計時器外觀', '타이머 외관 선택')}</small>
            </div>
            <div className="timer-skin-grid">
              {SKINS.map((entry) => (
                <button key={entry.id} type="button" className={`timer-skin-card ${skin === entry.id ? 'active' : ''}`} onClick={() => setSkin(entry.id)} title={skinLabel(entry)} aria-label={skinLabel(entry)}>
                  <span className={`timer-skin-preview skin-${entry.id}`} aria-hidden="true"><i /><b>00:00</b></span>
                  <span className="timer-skin-card-label"><strong>{skinLabel(entry)}</strong><small>{entry.id === 'strip' ? l('Compact rail', '紧凑横轨', '緊湊橫軌', '컴팩트 레일') : l('Dial display', '圆盘显示', '圓盤顯示', '다이얼 표시')}</small></span>
                  {skin === entry.id && <Check className="timer-skin-card-check" aria-hidden="true" />}
                </button>
              ))}
            </div>
          </div>
          <div className="timer-settings-footer no-drag">
            <div className="timer-settings-status"><span>{stateLabel}</span><strong>{formatElapsed(elapsed)}</strong></div>
            <div className="timer-controls">
              {state === 'running'
                ? <button type="button" className="timer-control-main" onClick={pause}><Pause />{l('Pause', '暂停', '暫停', '일시 정지')}</button>
                : <button type="button" className="timer-control-main" onClick={start}><Play />{state === 'finished' ? l('Again', '再来一局', '再來一局', '다시 시작') : l('Start', '开始', '開始', '시작')}</button>}
              <button type="button" className="timer-control" onClick={finish} disabled={elapsed <= 0 || state === 'finished'} title={l('Finish and record', '结束并记录', '結束並記錄', '종료 및 기록')} aria-label={l('Finish and record', '结束并记录', '結束並記錄', '종료 및 기록')}><Square /></button>
              <button type="button" className="timer-control" onClick={reset} disabled={elapsed <= 0 && state === 'idle'} title={l('Reset', '重置', '重設', '초기화')} aria-label={l('Reset', '重置', '重設', '초기화')}><RotateCcw /></button>
            </div>
          </div>
        </section>
      )}
    </main>
  )
}

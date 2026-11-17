import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { BookOpen, Check, ChevronDown, Maximize2, Minus, Move, Pause, Play, RotateCcw, Settings2, Square, Timer, X } from 'lucide-react'
import { useTranslation } from '@/i18n/useTranslation'
import { uiText } from '@/i18n/uiLocale'
import './timer.css'

type TimerState = 'idle' | 'running' | 'paused' | 'finished'
type TimerMode = 'map' | 'campaign' | 'system'
type SkinId = 'obsidian' | 'ember' | 'frost' | 'strip'
type CampaignSegmentKey = 'act1' | 'act2' | 'act3' | 'act4' | 'interlude'
type CampaignSnapshot = {
  runId: number | null
  status: 'idle' | 'running' | 'paused' | 'completed'
  elapsed: number
  currentSegment: CampaignSegmentKey | null
  currentAreaId: string | null
  segments: Array<{ key: CampaignSegmentKey; elapsed: number; status: 'current' | 'completed' | 'pending' }>
}
type TimerSnapshot = {
  mode: TimerMode
  state: TimerState
  elapsed: number
  gameRunning: boolean
  opacity: number
  mapAreaId: string | null
  campaign: CampaignSnapshot
}

const surface = new URLSearchParams(location.search).get('surface')
const isCampaignSurface = surface === 'timer-campaign'
const isSettingsSurface = surface === 'timer-settings' || isCampaignSurface

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
  const [mode, setMode] = useState<TimerMode>('map')
  const [elapsed, setElapsed] = useState(0)
  const [gameRunning, setGameRunning] = useState(false)
  const [opacity, setOpacity] = useState(1)
  const [mapAreaId, setMapAreaId] = useState<string | null>(null)
  const [campaign, setCampaign] = useState<CampaignSnapshot>({ runId: null, status: 'idle', elapsed: 0, currentSegment: null, currentAreaId: null, segments: [] })
  const [systemTime, setSystemTime] = useState(() => new Date())
  const [modeMenuOpen, setModeMenuOpen] = useState(false)
  const [skin, setSkin] = useState<SkinId>(() => {
    const saved = localStorage.getItem('superpoe-timer-skin')
    return saved === 'ember' || saved === 'frost' || saved === 'strip' ? saved : 'obsidian'
  })
  const [isResizing, setIsResizing] = useState(false)
  const [isMoving, setIsMoving] = useState(false)
  const moveStartRef = useRef<{ x: number; y: number } | null>(null)
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
      setMode(snapshot.mode)
      setState(snapshot.state)
      setElapsed(Math.max(0, snapshot.elapsed))
      setGameRunning(snapshot.gameRunning)
      setOpacity(Math.max(0.45, Math.min(1, snapshot.opacity)))
      setMapAreaId(snapshot.mapAreaId)
      setCampaign(snapshot.campaign)
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
    const timer = window.setInterval(() => setSystemTime(new Date()), 1_000)
    return () => window.clearInterval(timer)
  }, [])
  useEffect(() => {
    const closeModeMenu = () => setModeMenuOpen(false)
    window.addEventListener('blur', closeModeMenu)
    document.addEventListener('visibilitychange', closeModeMenu)
    return () => {
      window.removeEventListener('blur', closeModeMenu)
      document.removeEventListener('visibilitychange', closeModeMenu)
    }
  }, [])
  useEffect(() => () => {
    if (faceClickRef.current !== null) window.clearTimeout(faceClickRef.current)
  }, [])

  const start = () => { void window.pob2Timer?.start() }
  const pause = () => { void window.pob2Timer?.pause() }
  const finish = () => { void window.pob2Timer?.finish() }
  const reset = () => { void window.pob2Timer?.reset() }
  const changeOpacity = (value: number) => {
    const next = Math.max(0.45, Math.min(1, value))
    setOpacity(next)
    void window.pob2Timer?.setOpacity(next)
  }
  const handleFaceClick = () => setModeMenuOpen(false)
  const handleFaceContextMenu = (event: React.MouseEvent) => {
    event.preventDefault()
    setModeMenuOpen(true)
  }
  const handleFaceDoubleClick = () => {
    if (faceClickRef.current !== null) {
      window.clearTimeout(faceClickRef.current)
      faceClickRef.current = null
    }
    if (mode === 'campaign') void window.pob2Timer?.openCampaign()
    else void window.pob2Timer?.openSettings()
  }

  const beginResize = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    moveStartRef.current = null
    setIsMoving(false)
    resizeStartRef.current = { x: event.screenX, y: event.screenY, width: window.innerWidth, skin }
    setIsResizing(true)
  }

  const beginMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    resizeStartRef.current = null
    setIsResizing(false)
    moveStartRef.current = { x: event.screenX, y: event.screenY }
    setIsMoving(true)
  }

  useEffect(() => {
    if (!isMoving) return
    const move = (event: PointerEvent) => {
      const previous = moveStartRef.current
      if (!previous) return
      const delta = { x: event.screenX - previous.x, y: event.screenY - previous.y }
      moveStartRef.current = { x: event.screenX, y: event.screenY }
      if (delta.x || delta.y) void window.pob2Timer?.moveBy(delta)
    }
    const stop = () => {
      moveStartRef.current = null
      setIsMoving(false)
    }
    document.addEventListener('pointermove', move)
    document.addEventListener('pointerup', stop)
    document.addEventListener('pointercancel', stop)
    document.addEventListener('lostpointercapture', stop)
    window.addEventListener('blur', stop)
    return () => {
      document.removeEventListener('pointermove', move)
      document.removeEventListener('pointerup', stop)
      document.removeEventListener('pointercancel', stop)
      document.removeEventListener('lostpointercapture', stop)
      window.removeEventListener('blur', stop)
    }
  }, [isMoving])

  useEffect(() => {
    if (!isResizing) return
    const handlePointerMove = (event: PointerEvent) => {
      const start = resizeStartRef.current
      if (!start) return
      const deltaX = event.screenX - start.x
      const deltaY = event.screenY - start.y
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
    document.addEventListener('pointercancel', stopResize)
    document.addEventListener('lostpointercapture', stopResize)
    window.addEventListener('blur', stopResize)
    return () => {
      document.removeEventListener('pointermove', handlePointerMove)
      document.removeEventListener('pointerup', stopResize)
      document.removeEventListener('pointercancel', stopResize)
      document.removeEventListener('lostpointercapture', stopResize)
      window.removeEventListener('blur', stopResize)
    }
  }, [isResizing])

  const skinLabel = (entry: typeof SKINS[number]) => lang === 'en' ? entry.en : lang === 'zh-rCN' ? entry.zh : lang === 'zh-rTW' ? entry.zh : entry.en
  const modeLabel = (value: TimerMode) => value === 'map'
    ? l('MAP', '异界地图', '異界地圖', '지도')
    : value === 'campaign'
      ? l('CAMPAIGN', '故事开荒', '故事開荒', '스토리')
      : l('CLOCK', '系统时间', '系統時間', '시계')
  const segmentLabel = (key: CampaignSegmentKey) => ({
    act1: l('Act 1', '第一章', '第一章', '1장'),
    act2: l('Act 2', '第二章', '第二章', '2장'),
    act3: l('Act 3', '第三章', '第三章', '3장'),
    act4: l('Act 4', '第四章', '第四章', '4장'),
    interlude: l('Interlude', '幕间', '幕間', '막간'),
  })[key]
  const stateLabel = state === 'running'
    ? l('RUNNING', '计时中', '計時中', '진행 중')
    : state === 'paused'
      ? l('PAUSED', '已暂停', '已暫停', '일시 정지')
      : state === 'finished'
        ? l('RECORDED', '已记录', '已記錄', '기록됨')
        : l('READY', '准备开始', '準備開始', '시작 준비')

  return (
    <main className={`timer-app skin-${skin} ${isSettingsSurface ? 'is-settings' : 'is-collapsed'} state-${state} mode-${mode} ${isResizing ? 'is-resizing' : ''} ${isMoving ? 'is-moving' : ''}`} onClick={() => setModeMenuOpen(false)} onContextMenu={isSettingsSurface ? undefined : handleFaceContextMenu}>
      {!isSettingsSurface ? (
        <div className="timer-face-container">
          <div className="timer-face-collapsed" role="img" aria-label={l('Right-click to switch mode. Double-click to open.', '右键切换模式，双击打开详情。', '右鍵切換模式，雙擊開啟詳情。', '오른쪽 클릭으로 모드 전환, 두 번 클릭으로 열기.')} onContextMenu={handleFaceContextMenu}>
            <span className="timer-face-ornament" aria-hidden="true" />
            <span className="timer-face-caption">{modeLabel(mode)}</span>
            <strong>{mode === 'system' ? formatSystemTime(systemTime) : formatElapsed(elapsed)}</strong>
            {mode === 'campaign' && <div className="timer-face-quick-actions no-drag" onPointerDown={(event) => event.stopPropagation()}>
              <button type="button" className="timer-face-quick-button" onClick={state === 'running' ? pause : start} aria-label={state === 'running' ? l('Pause campaign timer', '暂停故事开荒计时', '暫停故事開荒計時', '스토리 타이머 일시 정지') : l('Start campaign timer', '开始故事开荒计时', '開始故事開荒計時', '스토리 타이머 시작')} title={state === 'running' ? l('Pause', '暂停', '暫停', '일시 정지') : l('Start', '开始', '開始', '시작')}>
                {state === 'running' ? <Pause /> : <Play />}
              </button>
              <button type="button" className="timer-face-quick-button" onClick={finish} disabled={elapsed <= 0 || state === 'finished'} aria-label={l('Finish campaign timer', '完成故事开荒计时', '完成故事開荒計時', '스토리 타이머 완료')} title={l('Finish', '完成', '完成', '완료')}><Square /></button>
              <button type="button" className="timer-face-quick-button" onClick={reset} disabled={elapsed <= 0 && state === 'idle'} aria-label={l('Reset campaign timer', '重置故事开荒计时', '重設故事開荒計時', '스토리 타이머 초기화')} title={l('Reset', '重置', '重設', '초기화')}><RotateCcw /></button>
            </div>}
            <span className="timer-face-state">{mode === 'campaign' && campaign.currentSegment ? segmentLabel(campaign.currentSegment) : mode === 'map' && mapAreaId ? mapAreaId : stateLabel}</span>
            <i className="timer-hand" aria-hidden="true" />
            <button className="timer-face-open-button no-drag" type="button" onClick={handleFaceClick} onDoubleClick={handleFaceDoubleClick} onContextMenu={handleFaceContextMenu} aria-label={l('Right-click to switch mode. Double-click to open details.', '右键切换模式，双击打开详情。', '右鍵切換模式，雙擊開啟詳情。', '오른쪽 클릭으로 모드 전환, 두 번 클릭으로 상세 열기')} />
          </div>
          {modeMenuOpen && <div className="timer-mode-menu no-drag" onClick={(event) => event.stopPropagation()}>
            <div className="timer-mode-menu-title">{l('Timer mode', '计时模式', '計時模式', '타이머 모드')}</div>
            {(['map', 'campaign', 'system'] as TimerMode[]).map((entry) => <button key={entry} type="button" className={mode === entry ? 'active' : ''} onClick={() => { void window.pob2Timer?.setMode(entry); setModeMenuOpen(false) }}><span>{mode === entry ? '✓' : ''}</span>{modeLabel(entry)}</button>)}
          </div>}
          <div className="timer-hover-actions" onPointerDown={(event) => event.stopPropagation()}>
            <button type="button" className="timer-action-button no-drag" onClick={() => void window.pob2Timer?.openSettings()} title={l('Timer skins', '计时器皮肤', '計時器皮膚', '타이머 스킨')} aria-label={l('Timer skins', '计时器皮肤', '計時器皮膚', '타이머 스킨')}><Settings2 /></button>
            <button type="button" className="timer-action-button timer-move-handle" onPointerDown={beginMove} title={l('Move timer', '移动计时器', '移動計時器', '타이머 이동')} aria-label={l('Move timer', '移动计时器', '移動計時器', '타이머 이동')}><Move /></button>
            <button type="button" className="timer-action-button no-drag" onPointerDown={beginResize} title={l('Resize timer', '调整计时器大小', '調整計時器大小', '타이머 크기 조절')} aria-label={l('Resize timer', '调整计时器大小', '調整計時器大小', '타이머 크기 조절')}><Maximize2 /></button>
          </div>
          <div className="timer-hover-actions timer-guide-actions" onPointerDown={(event) => event.stopPropagation()}>
            <button type="button" className="timer-action-button no-drag" onClick={() => void window.pob2Timer?.openStoryGuide()} title={l('Open campaign racing', '打开剧情竞速', '開啟劇情競速', '캠페인 레이싱 열기')} aria-label={l('Open campaign racing', '打开剧情竞速', '開啟劇情競速', '캠페인 레이싱 열기')}><BookOpen /></button>
            <button type="button" className="timer-action-button no-drag" onClick={() => void window.pob2Timer?.openCampaign()} title={l('Campaign race timer', '开荒竞速', '開荒競速', '캠페인 레이스 타이머')} aria-label={l('Campaign race timer', '开荒竞速', '開荒競速', '캠페인 레이스 타이머')}><Timer /></button>
          </div>
        </div>
      ) : (
        <section className="timer-settings-shell">
          <div className="timer-settings-header timer-drag-region">
            <span className="timer-brand-mark" aria-hidden="true">◈</span>
            <div className="timer-settings-heading">
              <strong>{isCampaignSurface ? l('Campaign race timer', '开荒竞速', '開荒競速', '캠페인 레이스 타이머') : l('Timer skins', '计时器皮肤', '計時器皮膚', '타이머 스킨')}</strong>
              <small>{isCampaignSurface ? l('Campaign segments', '章节分段', '章節分段', '스토리 구간') : l('Appearance', '外观设置', '外觀設定', '외관 설정')}</small>
            </div>
            <label className="timer-opacity-control no-drag">
              <span>{l('Opacity', '透明度', '透明度', '투명도')}</span>
              <input type="range" min="45" max="100" step="5" value={Math.round(opacity * 100)} onChange={(event) => changeOpacity(Number(event.target.value) / 100)} aria-label={l('Window opacity', '窗口透明度', '窗口透明度', '창 투명도')} />
              <output>{Math.round(opacity * 100)}%</output>
            </label>
            <div className="timer-window-actions">
              {isCampaignSurface && <button type="button" className="timer-window-button no-drag" onClick={() => void window.pob2Timer?.openStoryGuide()} title={l('Open campaign racing', '打开剧情竞速', '開啟劇情競速', '캠페인 레이싱 열기')} aria-label={l('Open campaign racing', '打开剧情竞速', '開啟劇情競速', '캠페인 레이싱 열기')}><BookOpen /></button>}
              <button type="button" className="timer-window-button no-drag" onClick={() => void window.pob2Timer?.closeSettings()} title={l('Back to timer', '返回计时器', '返回計時器', '타이머로 돌아가기')} aria-label={l('Back to timer', '返回计时器', '返回計時器', '타이머로 돌아가기')}><ChevronDown /></button>
              <button type="button" className="timer-window-button no-drag" onClick={() => void window.pob2Timer?.minimize()} title={l('Minimize', '最小化', '最小化', '최소화')} aria-label={l('Minimize', '最小化', '最小化', '최소화')}><Minus /></button>
              <button type="button" className="timer-window-button no-drag" onClick={() => void window.pob2Timer?.closeSettings()} title={l('Close', '关闭', '關閉', '닫기')} aria-label={l('Close', '关闭', '關閉', '닫기')}><X /></button>
            </div>
          </div>
          <div className="timer-settings-body no-drag">
            {isCampaignSurface ? <section className="timer-campaign-panel">
              <div className="timer-campaign-summary">
                <div><span>{l('Total time', '总耗时', '總耗時', '총 시간')}</span><strong>{formatElapsed(campaign.elapsed)}</strong></div>
                <div><span>{l('Current segment', '当前分段', '目前分段', '현재 구간')}</span><strong>{campaign.currentSegment ? segmentLabel(campaign.currentSegment) : l('Not started', '未开始', '尚未開始', '시작 전')}</strong></div>
              </div>
              <div className="timer-settings-section-title"><Settings2 /><strong>{l('Campaign segments', '章节分段', '章節分段', '스토리 구간')}</strong><small>{l('All story time', '完整记录故事计时', '完整記錄故事計時', '전체 스토리 시간')}</small></div>
              <div className="timer-campaign-segments">
                {(campaign.segments.length ? campaign.segments : (['act1', 'act2', 'act3', 'act4', 'interlude'] as CampaignSegmentKey[]).map((key) => ({ key, elapsed: 0, status: 'pending' as const }))).map((segment) => <div key={segment.key} className={`timer-campaign-segment ${segment.status}`}>
                  <span className="timer-campaign-segment-mark">{segment.status === 'completed' ? '✓' : segment.status === 'current' ? '●' : ''}</span>
                  <strong>{segmentLabel(segment.key)}</strong>
                  <span>{formatElapsed(segment.elapsed)}</span>
                </div>)}
              </div>
            </section> : <>
              <div className="timer-settings-section-title"><Settings2 /><strong>{l('Skins', '皮肤', '皮膚', '스킨')}</strong><small>{l('Choose a timer appearance', '选择计时器外观', '選擇計時器外觀', '타이머 외관 선택')}</small></div>
              <div className="timer-skin-grid">
                {SKINS.map((entry) => (
                  <button key={entry.id} type="button" className={`timer-skin-card ${skin === entry.id ? 'active' : ''}`} onClick={() => setSkin(entry.id)} title={skinLabel(entry)} aria-label={skinLabel(entry)}>
                    <span className={`timer-skin-preview skin-${entry.id}`} aria-hidden="true"><i /><b>00:00</b></span>
                    <span className="timer-skin-card-label"><strong>{skinLabel(entry)}</strong><small>{entry.id === 'strip' ? l('Compact rail', '紧凑横轨', '緊湊橫軌', '컴팩트 레일') : l('Dial display', '圆盘显示', '圓盤顯示', '다이얼 표시')}</small></span>
                    {skin === entry.id && <Check className="timer-skin-card-check" aria-hidden="true" />}
                  </button>
                ))}
              </div>
            </>}
          </div>
          <div className="timer-settings-footer no-drag">
            {isCampaignSurface ? <>
            <div className="timer-settings-status"><span>{campaign.status === 'completed' ? l('COMPLETED', '已完成', '已完成', '완료') : modeLabel('campaign')}</span><strong>{formatElapsed(campaign.elapsed)}</strong></div>
            <div className="timer-controls">
              {campaign.status === 'running'
                ? <button type="button" className="timer-control-main" onClick={pause}><Pause />{l('Pause', '暂停', '暫停', '일시 정지')}</button>
                : <button type="button" className="timer-control-main" onClick={start}><Play />{campaign.status === 'completed' ? l('Again', '再来一局', '再來一局', '다시 시작') : l('Start', '开始', '開始', '시작')}</button>}
              <button type="button" className="timer-control" onClick={finish} disabled={campaign.elapsed <= 0 || campaign.status === 'completed'} title={l('Finish and record', '结束并记录', '結束並記錄', '종료 및 기록')} aria-label={l('Finish and record', '结束并记录', '結束並記錄', '종료 및 기록')}><Square /></button>
              <button type="button" className="timer-control" onClick={reset} disabled={campaign.elapsed <= 0 && campaign.status === 'idle'} title={l('Reset', '重置', '重設', '초기化')} aria-label={l('Reset', '重置', '重設', '초기化')}><RotateCcw /></button>
            </div>
            </> : <span className="timer-skin-current">{l('Current skin', '当前皮肤', '目前皮膚', '현재 스킨')} · {skinLabel(SKINS.find(entry => entry.id === skin)!)}</span>}
          </div>
        </section>
      )}
    </main>
  )
}

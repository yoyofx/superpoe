import { BrowserWindow, screen, type Rectangle, type WebContents } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { MarketMonitorSettings, MarketMonitoringSnapshot, MarketOpportunity, MarketOpportunityAttemptResult, OpportunityOverlayState } from '../src/types/market.js'
import { desktopText, type UiLanguage } from './uiLocale.js'

const currentDir = path.dirname(fileURLToPath(import.meta.url))
const preloadPath = path.join(currentDir, 'opportunityPreload.cjs')

const OVERLAY_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><style>
*{box-sizing:border-box;letter-spacing:0}html,body{width:100%;height:100%;margin:0;overflow:hidden;background:transparent;color:#c9c3b7;font:12px Arial,'Microsoft YaHei',sans-serif}button{font:inherit}.panel{height:100%;display:grid;grid-template-rows:52px minmax(0,1fr) 44px;overflow:hidden;border:1px solid #a58c5e;border-radius:4px;background:#10110f;box-shadow:0 12px 34px #000}.head{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:7px 10px;border-bottom:1px solid #494033;background:#181814;-webkit-app-region:drag}.head>span{min-width:0;display:grid;gap:2px}.head strong{overflow:hidden;color:#dbc491;font:500 14px Georgia,'Microsoft YaHei',serif;text-overflow:ellipsis;white-space:nowrap}.head small{color:#777168;font-size:9px}.head button{-webkit-app-region:no-drag;width:28px;height:28px;border:1px solid #4b463c;background:#151613;color:#aaa;cursor:pointer}.body{min-height:0;display:grid;grid-template-columns:168px minmax(0,1fr)}.queue{min-height:0;overflow-y:auto;border-right:1px solid #66583f;background:#0c0d0c}.queue button{width:100%;min-height:58px;display:grid;gap:3px;padding:7px 8px;border:0;border-bottom:1px solid #292821;background:transparent;color:#918b80;text-align:left;cursor:pointer}.queue button.active{background:#29251c;color:#e2c691;box-shadow:inset 3px 0 #b89a5f}.queue strong,.queue small{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.queue small{font-size:9px;color:#716c63}.details{min-height:0;display:grid;grid-template-rows:auto auto minmax(0,1fr) auto;gap:7px;overflow:hidden;padding:10px}.item-head{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:3px 10px;padding-bottom:8px;border-bottom:1px solid #3b372f}.item-head h2{margin:0;overflow:hidden;color:#d6c574;font:500 16px Georgia,'Microsoft YaHei',serif;text-overflow:ellipsis;white-space:nowrap}.item-head .base{color:#8a8479;font-size:10px}.item-head .price{grid-column:2;grid-row:1/3;color:#e0c38c;font-weight:700}.properties{display:flex;flex-wrap:wrap;gap:4px 10px;color:#858078;font-size:9px}.mods{min-height:0;overflow-y:auto;padding-right:3px}.mod{display:grid;grid-template-columns:44px minmax(0,1fr) auto;gap:6px;padding:5px 3px;border-bottom:1px solid #292823}.mod em{color:#756e62;font:normal 8px Arial}.mod span{color:#b7b0a5;line-height:1.35}.mod b{color:#b99255;font-size:9px;font-weight:500}.mod.implicit span{color:#8caac0}.mod.enchant span,.mod.rune span{color:#b19bd0}.empty{height:100%;display:grid;place-items:center;color:#6e6961;text-align:center}.meta{display:flex;justify-content:space-between;gap:8px;color:#777168;font-size:9px}.foot{display:grid;grid-template-columns:76px 76px 1fr 76px 88px;gap:5px;padding:7px 8px;border-top:1px solid #494033;background:#151613}.foot button{min-width:0;border:1px solid #49443b;background:#1b1c18;color:#aaa399;cursor:pointer;font-size:9px}.foot button:hover,.head button:hover{border-color:#8f7b58;color:#e2c691}.foot button:disabled{opacity:.38;cursor:default}.foot .pause{color:#c29b7e}::-webkit-scrollbar{width:8px}::-webkit-scrollbar-track{background:#0b0c0b}::-webkit-scrollbar-thumb{background:#4a4337;border:2px solid #0b0c0b}
</style></head><body><main class="panel"><header class="head"><span><strong id="target-name"></strong><small id="summary"></small></span><button data-action="close">×</button></header><section class="body"><aside class="queue" id="queue"></aside><article class="details" id="details"><div class="item-head"><h2 id="item-name"></h2><span class="base" id="item-base"></span><span class="price" id="item-price"></span></div><div class="properties" id="properties"></div><div class="mods" id="mods"></div><div class="meta"><span id="item-age"></span><span id="item-status"></span></div></article></section><footer class="foot"><button data-action="next"></button><button data-action="skip"></button><button class="pause" data-action="pause"></button><button data-action="complete"></button><button data-action="attempt"></button></footer></main></body></html>`

export class OpportunityOverlayController {
  private window?: BrowserWindow
  private candidates: MarketOpportunity[] = []
  private currentIndex = 0
  private snapshot?: MarketMonitoringSnapshot
  private dismissedSession = false
  private dismissedBatchIds = new Set<string>()
  private statusMessage?: string
  private revealPending = false
  private language: UiLanguage = 'en'

  constructor(
    private readonly mainWindow: BrowserWindow,
    private readonly actions: {
      skip: (id: string) => void
      pause: (searchId: string) => void
      complete: (searchId: string) => void
      attempt: (id: string) => Promise<MarketOpportunityAttemptResult>
      searchName: (searchId: string) => string | undefined
    },
  ) {}

  setLanguage(language: UiLanguage): void {
    this.language = language
    if (this.window && !this.window.isDestroyed() && !this.window.webContents.isLoading()) this.publish()
  }

  updateSnapshot(snapshot: MarketMonitoringSnapshot): void {
    this.snapshot = snapshot
    const active = new Map(snapshot.opportunities
      .filter((opportunity) => ['actionable', 'attempting', 'error'].includes(opportunity.status))
      .map((opportunity) => [opportunity.id, opportunity]))
    this.candidates = this.candidates.flatMap((candidate) => active.get(candidate.id) || [])
    if (this.currentIndex >= this.displayedCandidates().length) this.currentIndex = 0
    if (this.window?.isVisible()) {
      const overlayFocused = this.window.isFocused()
      const gameRunning = snapshot.game.status === 'foreground' || snapshot.game.status === 'background'
      if ((!gameRunning && !overlayFocused) || !snapshot.settings.overlayEnabled || snapshot.settings.doNotDisturb) this.window.hide()
      else {
        this.position('bounds' in snapshot.game ? snapshot.game.bounds : undefined)
        this.publish()
      }
    }
  }

  actionable(opportunities: MarketOpportunity[]): void {
    if (this.dismissedSession && opportunities.some((opportunity) => !this.dismissedBatchIds.has(opportunity.batchId))) {
      this.dismissedSession = false
      this.dismissedBatchIds.clear()
    }
    const existing = new Set(this.candidates.map((candidate) => candidate.id))
    let added = 0
    for (const opportunity of opportunities) if (!existing.has(opportunity.id)) {
      this.candidates.push(opportunity)
      existing.add(opportunity.id)
      added += 1
    }
    if (!added) return
    if (!this.snapshot || !['foreground', 'background'].includes(this.snapshot.game.status) || !this.snapshot.settings.overlayEnabled || this.snapshot.settings.doNotDisturb || this.dismissedSession) return
    this.ensureWindow()
    const reveal = () => {
      this.revealPending = false
      if (!this.window || !this.snapshot || !['foreground', 'background'].includes(this.snapshot.game.status)) return
      this.position('bounds' in this.snapshot.game ? this.snapshot.game.bounds : undefined)
      this.publish()
      const wasVisible = this.window.isVisible()
      this.window.showInactive()
      if (!wasVisible && this.snapshot.settings.soundEnabled) this.playSound(this.snapshot.settings.soundVolume, this.snapshot.settings.soundId)
    }
    if (this.window!.webContents.isLoading()) {
      if (!this.revealPending) {
        this.revealPending = true
        this.window!.webContents.once('did-finish-load', reveal)
      }
    } else reveal()
  }

  dispose(): void {
    if (this.window && !this.window.isDestroyed()) this.window.destroy()
    this.window = undefined
  }

  private ensureWindow(): void {
    if (this.window && !this.window.isDestroyed()) return
    this.window = new BrowserWindow({
      width: 600, height: 480, frame: false, transparent: true, resizable: false,
      minimizable: false, maximizable: false, skipTaskbar: true, show: false, alwaysOnTop: true,
      webPreferences: { preload: preloadPath, contextIsolation: true, nodeIntegration: false, sandbox: true },
    })
    this.window.setAlwaysOnTop(true, 'screen-saver')
    this.window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
    this.window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    void this.window.loadURL(`data:text/html;charset=UTF-8,${encodeURIComponent(OVERLAY_HTML)}`)
  }

  private position(gameBounds?: Rectangle): void {
    if (!this.window) return
    const display = gameBounds ? screen.getDisplayMatching(gameBounds) : screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
    const area = display.workArea
    const corner = this.snapshot?.settings.overlayCorner || 'top-right'
    const x = corner.endsWith('right') ? area.x + area.width - 600 - 18 : area.x + 18
    const y = corner.startsWith('bottom') ? area.y + area.height - 480 - 18 : area.y + 18
    this.window.setPosition(Math.round(x), Math.round(y), false)
  }

  private publish(): void {
    if (!this.window || this.window.isDestroyed() || !this.snapshot) return
    const displayed = this.displayedCandidates()
    const current = displayed[this.currentIndex]
    const searchName = current ? this.actions.searchName(current.targetId) : undefined
    const overlayFocused = this.window.isFocused()
    const clientRealm = 'clientRealm' in this.snapshot.game ? this.snapshot.game.clientRealm : 'unknown'
    const matchedTargetCount = current ? new Set(this.candidates
      .filter((candidate) => candidate.realm === current.realm && candidate.listingId === current.listingId)
      .map((candidate) => candidate.targetId)).size : 0
    const state: OpportunityOverlayState = {
      language: this.language,
      searchName: searchName || desktopText(this.language, 'Purchase target', '购买目标', '購買目標', '구매 대상'),
      detectedCount: this.candidates.length,
      actionableCount: this.candidates.filter((candidate) => candidate.status === 'actionable').length,
      current,
      alternatives: displayed,
      canVisitHideout: Boolean(current && !current.id.startsWith('overlay-test-') && (this.snapshot.game.status === 'foreground' || overlayFocused) && (clientRealm === 'unknown' || clientRealm === current.realm)),
      ...(matchedTargetCount > 1 ? { matchedTargetCount } : {}),
      ...(this.statusMessage ? { statusMessage: this.statusMessage } : {}),
    }
    this.window.webContents.send('market-opportunity:update', state)
  }

  handleAction(action: string): void {
    const displayed = this.displayedCandidates()
    const current = displayed[this.currentIndex]
    if (action === 'close') {
      this.dismissedSession = true
      this.dismissedBatchIds = new Set(this.candidates.map((candidate) => candidate.batchId))
      this.window?.hide()
    } else if (action.startsWith('select:')) {
      const index = displayed.findIndex((candidate) => candidate.id === action.slice(7))
      if (index >= 0) { this.currentIndex = index; this.statusMessage = undefined; this.publish() }
    } else if (action === 'next' && displayed.length > 1) {
      this.currentIndex = (this.currentIndex + 1) % displayed.length
      this.statusMessage = undefined
      this.publish()
    } else if (action === 'skip' && current) {
      this.actions.skip(current.id)
      this.candidates = this.candidates.filter((candidate) => candidate.realm !== current.realm || candidate.listingId !== current.listingId)
      this.currentIndex = 0
      this.publish()
    } else if (action === 'pause' && current) {
      this.actions.pause(current.targetId)
      this.candidates = this.candidates.filter((candidate) => candidate.targetId !== current.targetId)
      this.currentIndex = 0
      this.publish()
    } else if (action === 'complete' && current) {
      this.actions.complete(current.targetId)
      this.candidates = this.candidates.filter((candidate) => candidate.targetId !== current.targetId)
      this.currentIndex = 0
      this.publish()
    } else if (action === 'attempt' && current) {
      this.statusMessage = desktopText(this.language, 'Revalidating listing', '正在重新校验挂单', '正在重新驗證掛單', '매물 다시 확인 중')
      this.publish()
      void this.actions.attempt(current.id).then((result) => {
        this.statusMessage = result === 'attempted' ? desktopText(this.language, 'Hideout request sent; this does not confirm a purchase', '已发送藏身处请求，不代表购买成功', '已傳送藏身處請求，不代表購買成功', '은신처 요청을 보냈습니다. 구매 성공을 의미하지 않습니다')
          : result === 'game-offline' ? desktopText(this.language, 'The game is offline; try again after entering the game', '游戏未在线，进入游戏后可再次尝试', '遊戲未上線，進入遊戲後可再次嘗試', '게임이 오프라인입니다. 게임 접속 후 다시 시도하세요')
            : result === 'unavailable' ? desktopText(this.language, 'The listing may no longer be available', '挂单可能已经失效', '掛單可能已失效', '매물이 더 이상 유효하지 않을 수 있습니다')
              : desktopText(this.language, 'Request failed; check your login and try again', '请求失败，请检查登录状态后重试', '請求失敗，請檢查登入狀態後重試', '요청에 실패했습니다. 로그인 상태를 확인하고 다시 시도하세요')
        if (this.snapshot) this.updateSnapshot(this.snapshot)
      })
    } else if (action === 'open-app') {
      if (this.mainWindow.isMinimized()) this.mainWindow.restore()
      this.mainWindow.show()
      this.mainWindow.focus()
      this.mainWindow.webContents.send('market:open-monitoring')
      this.window?.hide()
    }
  }

  ownsWebContents(contents: WebContents): boolean {
    return Boolean(this.window && !this.window.isDestroyed() && this.window.webContents === contents)
  }

  previewSound(volume: number, soundId: MarketMonitorSettings['soundId']): void {
    this.ensureWindow()
    const play = () => this.playSound(volume, soundId)
    if (this.window!.webContents.isLoading()) this.window!.webContents.once('did-finish-load', play)
    else play()
  }

  previewWindow(): void {
    const actual = new Map<string, MarketOpportunity>()
    for (const candidate of this.candidates) if (!candidate.id.startsWith('overlay-test-')) actual.set(candidate.id, candidate)
    for (const opportunity of this.snapshot?.opportunities || []) {
      if (['actionable', 'attempting', 'error'].includes(opportunity.status) && !opportunity.id.startsWith('overlay-test-')) actual.set(opportunity.id, opportunity)
    }
    if (this.hasActiveMonitoring()) {
      this.candidates = [...actual.values()]
      this.statusMessage = undefined
    } else {
      const now = new Date().toISOString()
      const target = this.snapshot?.purchaseTargets[0]
      const testOpportunity: MarketOpportunity = {
        id: `overlay-test-${Date.now()}`,
        targetId: target?.id || 'overlay-test-target',
        batchId: 'overlay-test-batch',
        searchId: target?.id || 'overlay-test-search',
        realm: target?.search.realm || 'global',
        leagueId: target?.search.leagueId || desktopText(this.language, 'Test league', '测试赛季', '測試賽季', '테스트 리그'),
        searchCode: target?.search.searchCode || 'overlay-test',
        listingId: 'overlay-test-listing',
        status: 'actionable',
        detectedAt: now,
        fetchedAt: now,
        item: {
          name: desktopText(this.language, 'Overlay test item', '置顶窗口测试装备', '置頂視窗測試裝備', '오버레이 테스트 아이템'),
          baseType: desktopText(this.language, 'Test base · not added to the library', '测试基底 · 不会进入仓库', '測試基底 · 不會加入倉庫', '테스트 베이스 · 보관함에 추가되지 않음'),
          price: desktopText(this.language, 'Test price: 1 Exalted Orb', '测试价格 1 Exalted Orb', '測試價格 1 Exalted Orb', '테스트 가격: 1 Exalted Orb'),
          itemLevel: 81,
          quality: 20,
          sockets: 'S S S',
          modifiers: [],
        },
      }
      this.candidates = [testOpportunity]
      this.statusMessage = desktopText(this.language, 'No live monitoring is enabled; showing an overlay preview', '当前没有启用的实时监控，以下为窗口预览', '目前未啟用即時監控，以下為視窗預覽', '활성화된 실시간 모니터링이 없어 오버레이 미리보기를 표시합니다')
    }
    this.currentIndex = 0
    this.ensureWindow()
    const reveal = () => {
      if (!this.window || this.window.isDestroyed()) return
      const gameBounds = this.snapshot && 'bounds' in this.snapshot.game ? this.snapshot.game.bounds : undefined
      this.position(gameBounds)
      this.publish()
      this.window.showInactive()
    }
    if (this.window!.webContents.isLoading()) this.window!.webContents.once('did-finish-load', reveal)
    else reveal()
  }

  private playSound(volume: number, soundId: MarketMonitorSettings['soundId']): void {
    if (this.window && !this.window.isDestroyed()) this.window.webContents.send('market-opportunity:sound', { volume: Math.max(0, Math.min(1, volume)), soundId })
  }

  private hasActiveMonitoring(): boolean {
    return Boolean(this.snapshot && !this.snapshot.globalPaused && this.snapshot.purchaseTargets.some((target) => target.status === 'armed'))
  }

  private displayedCandidates(): MarketOpportunity[] {
    const seen = new Set<string>()
    return this.candidates.filter((candidate) => {
      const key = `${candidate.realm}:${candidate.listingId}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
  }
}

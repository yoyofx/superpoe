import { useEffect, useMemo, useState } from 'react'
import { BellRing, CheckCircle2, CirclePause, CirclePlay, Clock3, ExternalLink, Moon, PanelTop, Play, RefreshCw, Trash2, Volume2 } from 'lucide-react'
import { useTranslation } from '@/i18n/useTranslation'
import { translateGameText, type Language } from '@/i18n/translationLoader'
import { formatUiDate, uiText, type UiMessage } from '@/i18n/uiLocale'
import { MAX_ACTIVE_PURCHASE_TARGETS, type MarketMonitoringSnapshot, type MarketOpportunity, type MarketSoundId, type PurchaseTarget } from '@/types/market'

const pendingStatuses = new Set(['detected', 'fetching', 'actionable', 'error'])
const soundOptions: Array<{ id: MarketSoundId; label: UiMessage }> = [
  { id: 'chime-rise', label: { en: 'Rising chime', 'zh-rCN': '升调铃声', 'zh-rTW': '升調鈴聲', 'ko-KR': '상승 차임' } },
  { id: 'double-beep', label: { en: 'Double beep', 'zh-rCN': '双音提示', 'zh-rTW': '雙音提示', 'ko-KR': '이중 신호음' } },
  { id: 'bell', label: { en: 'Bright bell', 'zh-rCN': '清脆钟声', 'zh-rTW': '清脆鐘聲', 'ko-KR': '밝은 벨' } },
  { id: 'digital', label: { en: 'Digital', 'zh-rCN': '数字提示', 'zh-rTW': '數位提示', 'ko-KR': '디지털' } },
  { id: 'alert', label: { en: 'Alert', 'zh-rCN': '警示提示', 'zh-rTW': '警示提示', 'ko-KR': '경고' } },
  { id: 'soft', label: { en: 'Soft', 'zh-rCN': '柔和提示', 'zh-rTW': '柔和提示', 'ko-KR': '부드러운 알림' } },
  { id: 'triple', label: { en: 'Triple tone', 'zh-rCN': '三连提示', 'zh-rTW': '三連提示', 'ko-KR': '삼중 신호음' } },
  { id: 'low-pulse', label: { en: 'Low pulse', 'zh-rCN': '低沉脉冲', 'zh-rTW': '低沉脈衝', 'ko-KR': '낮은 펄스' } },
  { id: 'bright', label: { en: 'Bright tone', 'zh-rCN': '高音提示', 'zh-rTW': '高音提示', 'ko-KR': '밝은 신호음' } },
  { id: 'warble', label: { en: 'Warble', 'zh-rCN': '起伏提示', 'zh-rTW': '起伏提示', 'ko-KR': '워블' } },
]

export function MonitoringWorkspace() {
  const { lang } = useTranslation()
  const l = (en: string, zhCN: string, zhTW: string, koKR: string) => uiText(lang, en, zhCN, zhTW, koKR)
  const bridge = window.pob2Market
  const [snapshot, setSnapshot] = useState<MarketMonitoringSnapshot | null>(null)
  const [selectedTargetId, setSelectedTargetId] = useState('all')
  const [selectedOpportunityId, setSelectedOpportunityId] = useState<string>()
  const [message, setMessage] = useState<string>()

  useEffect(() => {
    let active = true
    void bridge?.getMonitoring().then((value) => { if (active) setSnapshot(value) })
    const off = bridge?.onMonitoringChanged((value) => { if (active) setSnapshot(value) })
    return () => { active = false; off?.() }
  }, [bridge])

  const opportunities = useMemo(() => (snapshot?.opportunities || []).filter((item) => selectedTargetId === 'all' || item.targetId === selectedTargetId), [selectedTargetId, snapshot])
  const selected = opportunities.find((item) => item.id === selectedOpportunityId) || opportunities[0]
  const run = async (work: () => Promise<unknown>, success: string) => {
    try { await work(); setMessage(success) } catch (error) { setMessage(error instanceof Error ? error.message : String(error)) }
  }
  const previewOverlay = async () => {
    setMessage(undefined)
    try { await bridge!.previewOpportunityOverlay() } catch (error) { setMessage(error instanceof Error ? error.message : String(error)) }
  }
  if (!snapshot) return <section className="monitoring-workspace loading"><BellRing /><span>{l('Loading monitoring', '正在读取实时监控', '正在讀取即時監控', '모니터링 불러오는 중')}</span></section>

  const runtime = new Map(snapshot.targets.map((item) => [item.targetId, item]))
  const armed = snapshot.purchaseTargets.filter((target) => target.status === 'armed').length
  const pending = opportunities.filter((item) => pendingStatuses.has(item.status)).length

  return <section className="monitoring-workspace">
    <header className="monitoring-toolbar">
      <div className="monitoring-toolbar-controls">
        <button className={`monitoring-toggle${snapshot.settings.overlayEnabled ? ' active' : ''}`} aria-pressed={snapshot.settings.overlayEnabled} onClick={() => void bridge?.updateMonitorSettings({ overlayEnabled: !snapshot.settings.overlayEnabled })}><BellRing /><span className="monitoring-toggle-label">{l('Overlay', '游戏窗口', '遊戲視窗', '오버레이')}</span><i aria-hidden="true"><b /></i></button>
        <button className={`monitoring-toggle${snapshot.settings.doNotDisturb ? ' active' : ''}`} aria-pressed={snapshot.settings.doNotDisturb} onClick={() => void bridge?.updateMonitorSettings({ doNotDisturb: !snapshot.settings.doNotDisturb })}><Moon /><span className="monitoring-toggle-label">{l('DND', '勿扰', '勿擾', '방해 금지')}</span><i aria-hidden="true"><b /></i></button>
      </div>
      <div className="monitoring-toolbar-sound">
        <span>{l('Sound', '提示音', '提示音', '알림음')}</span>
        <select value={snapshot.settings.soundId} onChange={(event) => void bridge?.updateMonitorSettings({ soundId: event.target.value as MarketSoundId })} aria-label={l('Select sound', '选择提示音', '選擇提示音', '알림음 선택')} title={l('Choose notification sound', '选择提示音音色', '選擇提示音音色', '알림음 선택')}>
          {soundOptions.map((option) => <option key={option.id} value={option.id}>{option.label[lang]}</option>)}
        </select>
        <button className={`monitoring-toggle${snapshot.settings.soundEnabled ? ' active' : ''}`} aria-pressed={snapshot.settings.soundEnabled} aria-label={snapshot.settings.soundEnabled ? l('Disable sound', '关闭提示音', '關閉提示音', '알림음 끄기') : l('Enable sound', '开启提示音', '開啟提示音', '알림음 켜기')} onClick={() => void bridge?.updateMonitorSettings({ soundEnabled: !snapshot.settings.soundEnabled })}><Volume2 /><i aria-hidden="true"><b /></i></button>
        <button onClick={() => void bridge?.previewMonitorSound()} title={l('Preview sound', '试听提示音', '試聽提示音', '알림음 미리 듣기')} aria-label={l('Preview sound', '试听提示音', '試聽提示音', '알림음 미리 듣기')}><Play /></button>
        <input aria-label={l('Sound volume', '提示音量', '提示音量', '알림음 볼륨')} type="range" min="0" max="1" step="0.05" value={snapshot.settings.soundVolume} onChange={(event) => void bridge?.updateMonitorSettings({ soundVolume: Number(event.target.value) })} />
      </div>
      <div className="monitoring-toolbar-preview">
        <span>{l('Window preview', '窗口预览', '視窗預覽', '창 미리 보기')}</span>
        <button className="monitoring-overlay-preview" onClick={() => void previewOverlay()} title={l('Show the monitoring overlay; use a test item when monitoring is inactive', '查看当前实时监控置顶提醒；没有启用监控时显示测试装备', '查看目前即時監控置頂提醒；未啟用監控時顯示測試裝備', '현재 모니터링 오버레이를 표시하며 비활성 상태에서는 테스트 아이템을 사용합니다')} aria-label={l('View overlay', '查看置顶提醒', '查看置頂提醒', '오버레이 보기')}><PanelTop />{l('View overlay', '查看置顶提醒', '查看置頂提醒', '오버레이 보기')}</button>
      </div>
    </header>
    {message && <div className="monitoring-notice" role="status">{message}</div>}
    <div className="monitoring-layout">
      <aside className="target-pane">
        <header><strong>{l('Purchase targets', '购买目标', '購買目標', '구매 대상')}</strong><small>{l(`${armed}/${MAX_ACTIVE_PURCHASE_TARGETS}`, `监控 ${armed}/${MAX_ACTIVE_PURCHASE_TARGETS}`, `監控 ${armed}/${MAX_ACTIVE_PURCHASE_TARGETS}`, `모니터링 ${armed}/${MAX_ACTIVE_PURCHASE_TARGETS}`)}</small></header>
        <button className={selectedTargetId === 'all' ? 'selected' : ''} onClick={() => setSelectedTargetId('all')}><BellRing /><span><strong>{l('All opportunities', '全部机会', '所有機會', '모든 기회')}</strong><small>{l(`${pending} pending`, `${pending} 待处理`, `${pending} 待處理`, `${pending}개 대기 중`)}</small></span></button>
        {snapshot.purchaseTargets.map((target) => <TargetRow key={target.id} target={target} connection={runtime.get(target.id)?.connectionStatus || 'disabled'} pending={runtime.get(target.id)?.pendingOpportunityCount || 0} selected={selectedTargetId === target.id} language={lang} onSelect={() => setSelectedTargetId(target.id)} onRun={run} />)}
        {!snapshot.purchaseTargets.length && <p>{l('Create a purchase target from Saved searches.', '从“保存的搜索”创建购买目标后，会在这里连接官方 Live。', '從「已儲存搜尋」建立購買目標後，會在此連線官方 Live。', '저장된 검색에서 구매 대상을 생성하면 공식 Live에 연결됩니다.')}</p>}
      </aside>
      <section className="opportunity-center">
        <header><span><strong>{l('Opportunity center', '机会中心', '機會中心', '기회 센터')}</strong><small>{l('A Live hit does not guarantee availability', 'Live 命中只代表出现新挂单，不保证仍可购买', 'Live 命中僅代表出現新掛單，不保證仍可購買', 'Live 감지는 새 매물 등록만 의미하며 구매 가능성을 보장하지 않습니다')}</small></span><em>{opportunities.length}</em></header>
        <div className="opportunity-layout">
          <div className="opportunity-list">
            {opportunities.map((item) => <button key={item.id} className={selected?.id === item.id ? 'selected' : ''} onClick={() => setSelectedOpportunityId(item.id)}><span><strong>{localizeItem(item.item?.name || item.item?.baseType, lang) || l('Fetching', '正在获取挂单', '正在取得掛單', '매물 가져오는 중')}</strong><small>{targetName(snapshot.purchaseTargets, item.targetId, lang)} · {formatUiDate(item.detectedAt, lang, { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</small></span><em>{item.item?.price || statusLabel(item.status, lang)}</em></button>)}
            {!opportunities.length && <div className="opportunity-empty"><Clock3 /><strong>{snapshot.globalPaused ? l('Monitoring paused', '实时监控已暂停', '即時監控已暫停', '모니터링 일시 중지됨') : l('Waiting for Live listings', '等待新的 Live 挂单', '等待新的 Live 掛單', '새 Live 매물 대기 중')}</strong><small>{l('New opportunities appear here in batches', '新机会会按批次记录在这里', '新機會會分批記錄於此', '새 기회가 여기에 묶음으로 표시됩니다')}</small></div>}
          </div>
          <OpportunityDetail opportunity={selected} target={snapshot.purchaseTargets.find((target) => target.id === selected?.targetId)} language={lang} onAttempt={(id) => void run(async () => {
            const result = await bridge!.attemptMonitorOpportunity(id)
            if (result !== 'attempted') throw new Error(result === 'game-offline' ? l('The game is not online', '游戏未在线，请登录角色后再试', '遊戲未在線，請登入角色後再試', '게임이 온라인 상태가 아닙니다') : result === 'unavailable' ? l('The listing may be unavailable', '挂单可能已经失效', '掛單可能已失效', '매물을 사용할 수 없을 수 있습니다') : result === 'login-required' ? l('Trade login is required', '交易站登录已失效，请重新登录', '交易站登入已失效，請重新登入', '거래소 로그인이 필요합니다') : result === 'rate-limited' ? l('Too many requests; try again shortly', '请求过于频繁，请稍后重试', '請求過於頻繁，請稍後重試', '요청이 너무 많습니다. 잠시 후 다시 시도하세요') : l('Request failed', '请求失败，请检查登录状态', '請求失敗，請檢查登入狀態', '요청 실패'))
          }, l('Hideout request sent', '已发送藏身处请求，不代表购买成功', '已傳送藏身處請求，不代表購買成功', '은신처 요청을 보냈습니다'))}/>
        </div>
      </section>
    </div>
  </section>
}

function TargetRow({ target, connection, pending, selected, language, onSelect, onRun }: { target: PurchaseTarget; connection: string; pending: number; selected: boolean; language: Language; onSelect: () => void; onRun: (work: () => Promise<unknown>, success: string) => Promise<void> }) {
  const l = (en: string, zhCN: string, zhTW: string, koKR: string) => uiText(language, en, zhCN, zhTW, koKR)
  const bridge = window.pob2Market!
  return <article className={`target-row${selected ? ' selected' : ''}`} onClick={onSelect}>
    <div><i className={`connection-${connection}`} /><span><strong>{target.name}</strong><small>{target.sourceSearchChanged ? l('Source search changed', '源搜索已更新，请确认同步', '來源搜尋已更新，請確認同步', '원본 검색이 변경됨') : `${target.search.leagueId} · ${connectionLabel(connection, language)}`}</small></span><em>{pending}</em></div>
    <footer>
      {target.status === 'armed' ? <button onClick={(event) => { event.stopPropagation(); void onRun(() => bridge.setMonitorTarget(target.id, 'paused'), l('Target paused', '目标已暂停', '目標已暫停', '대상 일시 중지됨')) }} title={l('Pause', '暂停', '暫停', '일시 중지')}><CirclePause /></button> : target.status !== 'completed' ? <button onClick={(event) => { event.stopPropagation(); void onRun(() => bridge.setMonitorTarget(target.id, 'armed'), l('Target resumed', '目标已恢复', '目標已恢復', '대상 재개됨')) }} title={l('Resume', '恢复', '恢復', '재개')}><CirclePlay /></button> : null}
      <select value={target.priority} onClick={(event) => event.stopPropagation()} onChange={(event) => void onRun(() => bridge.setMonitorPriority(target.id, event.target.value as PurchaseTarget['priority']), l('Priority updated', '优先级已更新', '優先級已更新', '우선순위 업데이트됨'))}><option value="high">{l('High', '高', '高', '높음')}</option><option value="normal">{l('Normal', '普通', '普通', '보통')}</option><option value="low">{l('Low', '低', '低', '낮음')}</option></select>
      {target.sourceSearchChanged && <button onClick={(event) => { event.stopPropagation(); if (window.confirm(l('Update this target from its saved search and reconnect?', '用保存搜索的最新条件更新此目标并重新连接？', '使用已儲存搜尋的最新條件更新此目標並重新連線？', '저장된 검색에서 대상을 업데이트하고 다시 연결할까요?'))) void onRun(() => bridge.refreshMonitorTarget(target.id), l('Target updated', '目标条件已更新', '目標條件已更新', '대상 업데이트됨')) }} title={l('Sync saved search', '同步源搜索', '同步來源搜尋', '저장된 검색 동기화')}><RefreshCw /></button>}
      {target.status !== 'completed' && <button onClick={(event) => { event.stopPropagation(); void onRun(() => bridge.setMonitorTarget(target.id, 'completed'), l('Target completed', '目标已完成', '目標已完成', '대상 완료됨')) }} title={l('Complete', '完成目标', '完成目標', '완료')}><CheckCircle2 /></button>}
      <button className="danger" onClick={(event) => { event.stopPropagation(); if (window.confirm(l('Delete target? The saved search is retained.', '删除购买目标？保存的搜索不会被删除。', '刪除購買目標？已儲存搜尋不會被刪除。', '대상을 삭제할까요? 저장된 검색은 유지됩니다.'))) void onRun(() => bridge.deleteMonitorTarget(target.id), l('Target deleted', '购买目标已删除', '購買目標已刪除', '대상 삭제됨')) }} title={l('Delete target', '删除目标', '刪除目標', '대상 삭제')}><Trash2 /></button>
    </footer>
  </article>
}

function OpportunityDetail({ opportunity, target, language, onAttempt }: { opportunity?: MarketOpportunity; target?: PurchaseTarget; language: Language; onAttempt: (id: string) => void }) {
  const l = (en: string, zhCN: string, zhTW: string, koKR: string) => uiText(language, en, zhCN, zhTW, koKR)
  if (!opportunity) return <div className="opportunity-detail empty"><BellRing /><span>{l('Select an item to inspect it', '选择一件装备查看完整词缀', '選擇一件裝備查看完整詞綴', '아이템을 선택하여 전체 속성을 확인하세요')}</span></div>
  const item = opportunity.item
  return <article className="opportunity-detail">
    <header><span><strong>{localizeItem(item?.name || item?.baseType, language) || l('Fetching listing', '正在获取挂单', '正在取得掛單', '매물 가져오는 중')}</strong><small>{localizeItem(item?.baseType, language)} · {target?.name}</small></span><em>{item?.price || l('No price', '未标价', '未標價', '가격 없음')}</em></header>
    <div className="opportunity-properties">{item?.itemLevel != null && <span>iLvl {item.itemLevel}</span>}{item?.quality != null && <span>{l('Quality', '品质', '品質', '퀄리티')} {item.quality}%</span>}{item?.sockets && <span>{l('Sockets', '插槽', '插槽', '홈')} {item.sockets}</span>}{item?.corrupted && <span className="corrupted">{l('Corrupted', '已腐化', '已汙染', '타락')}</span>}</div>
    <div className="opportunity-modifiers">{item?.modifiers?.map((modifier) => <div className={`modifier-${modifier.group}`} key={modifier.id}><em>{modifier.group === 'explicit' ? modifier.affixKind === 'prefix' ? l('Prefix', '前缀', '前綴', '접두어') : modifier.affixKind === 'suffix' ? l('Suffix', '后缀', '後綴', '접미어') : l('Explicit', '显式', '顯性', '명시') : modifier.group}</em><span>{translateGameText(modifier.original.displayText, language)}</span><b>{modifier.tier?.rank != null ? `T${modifier.tier.rank}` : modifier.tier?.name}</b></div>)}</div>
    <footer><span>{statusLabel(opportunity.status, language)} · {formatUiDate(opportunity.detectedAt, language, { dateStyle: 'short', timeStyle: 'short' })}</span><button disabled={opportunity.status !== 'actionable'} onClick={() => onAttempt(opportunity.id)} title={l('Revalidate and try to visit the seller', '重新校验挂单并尝试前往卖家藏身处', '重新驗證掛單並嘗試前往賣家藏身處', '매물을 다시 확인하고 판매자의 은신처 방문 시도')}><ExternalLink />{l('Visit hideout', '前往藏身处', '前往藏身處', '은신처 방문')}</button></footer>
  </article>
}

function localizeItem(value: string | undefined, language: Language) { return value ? translateGameText(value, language) : '' }
function targetName(targets: PurchaseTarget[], id: string, language: Language) { return targets.find((target) => target.id === id)?.name || uiText(language, 'Purchase target', '购买目标', '購買目標', '구매 대상') }
function connectionLabel(status: string, language: Language) { return status === 'connected' ? uiText(language, 'Live connected', 'Live 已连接', 'Live 已連線', 'Live 연결됨') : status === 'connecting' || status === 'reconnecting' ? uiText(language, 'Connecting', '正在连接', '正在連線', '연결 중') : status === 'auth-required' ? uiText(language, 'Login required', '需要登录', '需要登入', '로그인 필요') : status === 'error' ? uiText(language, 'Connection error', '连接错误', '連線錯誤', '연결 오류') : uiText(language, 'Stopped', '未运行', '未執行', '중지됨') }
function statusLabel(status: string, language: Language) { return status === 'actionable' ? uiText(language, 'Actionable', '可尝试', '可嘗試', '시도 가능') : status === 'attempted' ? uiText(language, 'Attempted', '已尝试', '已嘗試', '시도됨') : status === 'skipped' ? uiText(language, 'Skipped', '已跳过', '已略過', '건너뜀') : status === 'expired' ? uiText(language, 'Expired', '已过期', '已過期', '만료됨') : status === 'unavailable' ? uiText(language, 'Unavailable', '已失效', '已失效', '사용 불가') : status === 'error' ? uiText(language, 'Error', '校验失败', '驗證失敗', '오류') : uiText(language, 'Processing', '处理中', '處理中', '처리 중') }

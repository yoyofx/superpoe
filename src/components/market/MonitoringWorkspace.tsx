import { useEffect, useMemo, useState } from 'react'
import { BellRing, CheckCircle2, CirclePause, CirclePlay, Clock3, ExternalLink, Moon, PanelTop, Play, RefreshCw, Trash2, Volume2 } from 'lucide-react'
import { MAX_ACTIVE_PURCHASE_TARGETS, type MarketMonitoringSnapshot, type MarketOpportunity, type MarketSoundId, type PurchaseTarget } from '@/types/market'

interface MonitoringWorkspaceProps { zh: boolean }

const pendingStatuses = new Set(['detected', 'fetching', 'actionable', 'error'])
const soundOptions: Array<{ id: MarketSoundId; zh: string; en: string }> = [
  { id: 'chime-rise', zh: '升调铃声', en: 'Rising chime' },
  { id: 'double-beep', zh: '双音提示', en: 'Double beep' },
  { id: 'bell', zh: '清脆钟声', en: 'Bright bell' },
  { id: 'digital', zh: '数字提示', en: 'Digital' },
  { id: 'alert', zh: '警示提示', en: 'Alert' },
  { id: 'soft', zh: '柔和提示', en: 'Soft' },
  { id: 'triple', zh: '三连提示', en: 'Triple tone' },
  { id: 'low-pulse', zh: '低沉脉冲', en: 'Low pulse' },
  { id: 'bright', zh: '高音提示', en: 'Bright tone' },
  { id: 'warble', zh: '起伏提示', en: 'Warble' },
]

export function MonitoringWorkspace({ zh }: MonitoringWorkspaceProps) {
  const bridge = window.pob2Market
  const [snapshot, setSnapshot] = useState<MarketMonitoringSnapshot | null>(null)
  const [selectedTargetId, setSelectedTargetId] = useState<string>('all')
  const [selectedOpportunityId, setSelectedOpportunityId] = useState<string>()
  const [, setMessage] = useState<string>()

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
  if (!snapshot) return <section className="monitoring-workspace loading"><BellRing /><span>{zh ? '正在读取实时监控' : 'Loading monitoring'}</span></section>

  const runtime = new Map(snapshot.targets.map((item) => [item.targetId, item]))

  return <section className="monitoring-workspace">
    <header className="monitoring-toolbar">
      <div className="monitoring-toolbar-controls">
        <button className={`monitoring-toggle${snapshot.settings.overlayEnabled ? ' active' : ''}`} aria-pressed={snapshot.settings.overlayEnabled} onClick={() => void bridge?.updateMonitorSettings({ overlayEnabled: !snapshot.settings.overlayEnabled })}><BellRing /><span className="monitoring-toggle-label">{zh ? '游戏窗口' : 'Overlay'}</span><i aria-hidden="true"><b /></i></button>
        <button className={`monitoring-toggle${snapshot.settings.doNotDisturb ? ' active' : ''}`} aria-pressed={snapshot.settings.doNotDisturb} onClick={() => void bridge?.updateMonitorSettings({ doNotDisturb: !snapshot.settings.doNotDisturb })}><Moon /><span className="monitoring-toggle-label">{zh ? '勿扰' : 'DND'}</span><i aria-hidden="true"><b /></i></button>
      </div>
      <div className="monitoring-toolbar-sound">
        <span>{zh ? '提示音' : 'Sound'}</span>
        <select value={snapshot.settings.soundId} onChange={(event) => void bridge?.updateMonitorSettings({ soundId: event.target.value as MarketSoundId })} aria-label={zh ? '选择提示音' : 'Select sound'} title={zh ? '选择提示音音色' : 'Choose notification sound'}>
          {soundOptions.map((option) => <option key={option.id} value={option.id}>{zh ? option.zh : option.en}</option>)}
        </select>
        <button className={`monitoring-toggle${snapshot.settings.soundEnabled ? ' active' : ''}`} aria-pressed={snapshot.settings.soundEnabled} aria-label={snapshot.settings.soundEnabled ? (zh ? '关闭提示音' : 'Disable sound') : (zh ? '开启提示音' : 'Enable sound')} onClick={() => void bridge?.updateMonitorSettings({ soundEnabled: !snapshot.settings.soundEnabled })}><Volume2 /><i aria-hidden="true"><b /></i></button>
        <button onClick={() => void bridge?.previewMonitorSound()} title={zh ? '试听提示音' : 'Preview sound'} aria-label={zh ? '试听提示音' : 'Preview sound'}><Play /></button>
        <input aria-label={zh ? '提示音量' : 'Sound volume'} type="range" min="0" max="1" step="0.05" value={snapshot.settings.soundVolume} onChange={(event) => void bridge?.updateMonitorSettings({ soundVolume: Number(event.target.value) })} />
      </div>
      <div className="monitoring-toolbar-preview">
        <span>{zh ? '窗口预览' : 'Window preview'}</span>
        <button className="monitoring-overlay-preview" onClick={() => void previewOverlay()} title={zh ? '查看当前实时监控置顶提醒；没有启用监控时显示测试装备' : 'Show current monitoring overlay; use a test item only when monitoring is inactive'} aria-label={zh ? '查看置顶提醒' : 'View overlay'}><PanelTop />{zh ? '查看置顶提醒' : 'View overlay'}</button>
      </div>
    </header>
    <div className="monitoring-layout">
      <aside className="target-pane">
        <header><strong>{zh ? '购买目标' : 'Purchase targets'}</strong><small>{zh ? '监控 ' : ''}{snapshot.purchaseTargets.filter((target) => target.status === 'armed').length}/{MAX_ACTIVE_PURCHASE_TARGETS}</small></header>
        <button className={selectedTargetId === 'all' ? 'selected' : ''} onClick={() => setSelectedTargetId('all')}><BellRing /><span><strong>{zh ? '全部机会' : 'All opportunities'}</strong><small>{opportunities.filter((item) => pendingStatuses.has(item.status)).length}{zh ? ' 待处理' : ' pending'}</small></span></button>
        {snapshot.purchaseTargets.map((target) => <TargetRow key={target.id} target={target} connection={runtime.get(target.id)?.connectionStatus || 'disabled'} pending={runtime.get(target.id)?.pendingOpportunityCount || 0} selected={selectedTargetId === target.id} zh={zh} onSelect={() => setSelectedTargetId(target.id)} onRun={run} />)}
        {!snapshot.purchaseTargets.length && <p>{zh ? '从“保存的搜索”创建购买目标后，会在这里连接官方 Live。' : 'Create a purchase target from Saved searches.'}</p>}
      </aside>
      <section className="opportunity-center">
        <header><span><strong>{zh ? '机会中心' : 'Opportunity center'}</strong><small>{zh ? 'Live 命中只代表出现新挂单，不保证仍可购买' : 'A Live hit does not guarantee availability'}</small></span><em>{opportunities.length}</em></header>
        <div className="opportunity-layout">
          <div className="opportunity-list">
            {opportunities.map((item) => <button key={item.id} className={selected?.id === item.id ? 'selected' : ''} onClick={() => setSelectedOpportunityId(item.id)}><span><strong>{item.item?.name || item.item?.baseType || (zh ? '正在获取挂单' : 'Fetching')}</strong><small>{targetName(snapshot.purchaseTargets, item.targetId)} · {new Date(item.detectedAt).toLocaleTimeString()}</small></span><em>{item.item?.price || statusLabel(item.status, zh)}</em></button>)}
            {!opportunities.length && <div className="opportunity-empty"><Clock3 /><strong>{snapshot.globalPaused ? (zh ? '实时监控已暂停' : 'Monitoring paused') : zh ? '等待新的 Live 挂单' : 'Waiting for Live listings'}</strong><small>{zh ? '新机会会按批次记录在这里' : 'New opportunities appear here in batches'}</small></div>}
          </div>
          <OpportunityDetail opportunity={selected} target={snapshot.purchaseTargets.find((target) => target.id === selected?.targetId)} zh={zh} onAttempt={(id) => void run(async () => {
            const result = await bridge!.attemptMonitorOpportunity(id)
            if (result !== 'attempted') throw new Error(result === 'game-offline' ? (zh ? '游戏未在线，请登录角色后再试' : 'The game is not online') : result === 'unavailable' ? (zh ? '挂单可能已经失效' : 'The listing may be unavailable') : (zh ? '请求失败，请检查登录状态' : 'Request failed'))
          }, zh ? '已发送藏身处请求，不代表购买成功' : 'Hideout request sent')}/>
        </div>
      </section>
    </div>
  </section>
}

function TargetRow({ target, connection, pending, selected, zh, onSelect, onRun }: { target: PurchaseTarget; connection: string; pending: number; selected: boolean; zh: boolean; onSelect: () => void; onRun: (work: () => Promise<unknown>, success: string) => Promise<void> }) {
  const bridge = window.pob2Market!
  return <article className={`target-row${selected ? ' selected' : ''}`} onClick={onSelect}>
      <div><i className={`connection-${connection}`} /><span><strong>{target.name}</strong><small>{target.sourceSearchChanged ? (zh ? '源搜索已更新，请确认同步' : 'Source search changed') : `${target.search.leagueId} · ${connectionLabel(connection, zh)}`}</small></span><em>{pending}</em></div>
    <footer>
      {target.status === 'armed' ? <button onClick={(event) => { event.stopPropagation(); void onRun(() => bridge.setMonitorTarget(target.id, 'paused'), zh ? '目标已暂停' : 'Target paused') }} title={zh ? '暂停' : 'Pause'}><CirclePause /></button> : target.status !== 'completed' ? <button onClick={(event) => { event.stopPropagation(); void onRun(() => bridge.setMonitorTarget(target.id, 'armed'), zh ? '目标已恢复' : 'Target resumed') }} title={zh ? '恢复' : 'Resume'}><CirclePlay /></button> : null}
      <select value={target.priority} onClick={(event) => event.stopPropagation()} onChange={(event) => void onRun(() => bridge.setMonitorPriority(target.id, event.target.value as PurchaseTarget['priority']), zh ? '优先级已更新' : 'Priority updated')}><option value="high">{zh ? '高' : 'High'}</option><option value="normal">{zh ? '普通' : 'Normal'}</option><option value="low">{zh ? '低' : 'Low'}</option></select>
      {target.sourceSearchChanged && <button onClick={(event) => { event.stopPropagation(); if (window.confirm(zh ? '用保存搜索的最新条件更新此目标并重新连接？' : 'Update this target from its saved search and reconnect?')) void onRun(() => bridge.refreshMonitorTarget(target.id), zh ? '目标条件已更新' : 'Target updated') }} title={zh ? '同步源搜索' : 'Sync saved search'}><RefreshCw /></button>}
      {target.status !== 'completed' && <button onClick={(event) => { event.stopPropagation(); void onRun(() => bridge.setMonitorTarget(target.id, 'completed'), zh ? '目标已完成' : 'Target completed') }} title={zh ? '完成目标' : 'Complete'}><CheckCircle2 /></button>}
      <button className="danger" onClick={(event) => { event.stopPropagation(); if (window.confirm(zh ? '删除购买目标？保存的搜索不会被删除。' : 'Delete target? The saved search is retained.')) void onRun(() => bridge.deleteMonitorTarget(target.id), zh ? '购买目标已删除' : 'Target deleted') }} title={zh ? '删除目标' : 'Delete target'}><Trash2 /></button>
    </footer>
  </article>
}

function OpportunityDetail({ opportunity, target, zh, onAttempt }: { opportunity?: MarketOpportunity; target?: PurchaseTarget; zh: boolean; onAttempt: (id: string) => void }) {
  if (!opportunity) return <div className="opportunity-detail empty"><BellRing /><span>{zh ? '选择一件装备查看完整词缀' : 'Select an item to inspect it'}</span></div>
  const item = opportunity.item
  return <article className="opportunity-detail">
    <header><span><strong>{item?.name || item?.baseType || (zh ? '正在获取挂单' : 'Fetching listing')}</strong><small>{item?.baseType} · {target?.name}</small></span><em>{item?.price || (zh ? '未标价' : 'No price')}</em></header>
    <div className="opportunity-properties">{item?.itemLevel != null && <span>iLvl {item.itemLevel}</span>}{item?.quality != null && <span>{zh ? '品质' : 'Quality'} {item.quality}%</span>}{item?.sockets && <span>{zh ? '插槽' : 'Sockets'} {item.sockets}</span>}{item?.corrupted && <span className="corrupted">{zh ? '已腐化' : 'Corrupted'}</span>}</div>
    <div className="opportunity-modifiers">{item?.modifiers?.map((modifier) => <div className={`modifier-${modifier.group}`} key={modifier.id}><em>{modifier.group === 'explicit' ? modifier.affixKind === 'prefix' ? (zh ? '前缀' : 'Prefix') : modifier.affixKind === 'suffix' ? (zh ? '后缀' : 'Suffix') : (zh ? '显式' : 'Explicit') : modifier.group}</em><span>{modifier.original.displayText}</span><b>{modifier.tier?.rank != null ? `T${modifier.tier.rank}` : modifier.tier?.name}</b></div>)}</div>
    <footer><span>{statusLabel(opportunity.status, zh)} · {new Date(opportunity.detectedAt).toLocaleString()}</span><button disabled={opportunity.status !== 'actionable'} onClick={() => onAttempt(opportunity.id)} title={zh ? '重新校验挂单并尝试前往卖家藏身处' : 'Revalidate and try to visit the seller'}><ExternalLink />{zh ? '前往藏身处' : 'Visit hideout'}</button></footer>
  </article>
}

function targetName(targets: PurchaseTarget[], id: string) { return targets.find((target) => target.id === id)?.name || '购买目标' }
function connectionLabel(status: string, zh: boolean) { return status === 'connected' ? (zh ? 'Live 已连接' : 'Live connected') : status === 'connecting' || status === 'reconnecting' ? (zh ? '正在连接' : 'Connecting') : status === 'auth-required' ? (zh ? '需要登录' : 'Login required') : status === 'error' ? (zh ? '连接错误' : 'Connection error') : (zh ? '未运行' : 'Stopped') }
function statusLabel(status: string, zh: boolean) { return status === 'actionable' ? (zh ? '可尝试' : 'Actionable') : status === 'attempted' ? (zh ? '已尝试' : 'Attempted') : status === 'skipped' ? (zh ? '已跳过' : 'Skipped') : status === 'expired' ? (zh ? '已过期' : 'Expired') : status === 'unavailable' ? (zh ? '已失效' : 'Unavailable') : status === 'error' ? (zh ? '校验失败' : 'Error') : (zh ? '处理中' : 'Processing') }

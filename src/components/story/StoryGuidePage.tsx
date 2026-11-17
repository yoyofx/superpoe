import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ChangeEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { BarChart3, BookOpen, ChevronLeft, ChevronRight, Copy, Download, Edit3, LocateFixed, Plus, RefreshCw, Search, Timer, Trash2, Upload, X, ZoomIn, ZoomOut } from 'lucide-react'
import { BuildCenterNav } from '@/components/BuildCenter'
import { reloadStoryChapters, storyAreas, storyAssetUrl, storyChapters } from '@/data/storyGuide/loadContent'
import { createStoryNode, deleteStoryNode, findStoryArea, parseStoryChapter, serializeStoryChapter, setStoryFlow, storyNodeName, validateStoryChapter } from '@/engine/storyGuide'
import type { StoryAreaEvent, StoryChapter, StoryNode, StoryStep } from '@/types/storyGuide'
import { CampaignStatistics } from './CampaignStatistics'
import './storyGuide.css'

interface Props {
  realm: 'international' | 'chinese'
  onCenter: () => void
  onLibrary: () => void
  onTradeCenter: () => void
  onStoryGuide: () => void
  onCommunity: () => void
  onReference: () => void
  onAbout: () => void
}

// Drafts survive navigation within this app session; game progress is never stored.
let sessionDrafts: StoryChapter[] | undefined
const sessionDirty = new Set<string>()
const copyChapters = () => structuredClone(sessionDrafts ?? storyChapters)
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error)
const queryFlag = (name: string) => new URLSearchParams(location.search).get(name) === '1' || new URLSearchParams(location.hash.split('?')[1] ?? '').get(name) === '1'

export function StoryGuidePage({ realm: initialRealm, ...navigation }: Props) {
  const [chapters, setChapters] = useState(copyChapters)
  const [chapterId, setChapterId] = useState(chapters[0].id)
  const [nodeId, setNodeId] = useState(chapters[0].flowOrder[0] ?? chapters[0].nodes[0]?.id ?? '')
  const [mapId, setMapId] = useState(chapters[0].maps[0]?.id ?? '')
  const [realm, setRealm] = useState(initialRealm)
  const [editing, setEditing] = useState(() => queryFlag('edit'))
  const [statsOpen, setStatsOpen] = useState(false)
  const debug = queryFlag('debug')
  const [following, setFollowing] = useState(true)
  const [area, setArea] = useState<StoryAreaEvent | null>(null)
  const lastEventAt = useRef(-1)
  const [query, setQuery] = useState('')
  const [zoom, setZoom] = useState(1)
  const [notice, setNotice] = useState('')
  const [reloading, setReloading] = useState(false)
  const reloadPending = useRef(false)
  const [timerVisible, setTimerVisible] = useState<boolean | null>(null)
  const [timerPending, setTimerPending] = useState(false)
  const timerChanging = useRef(false)
  const timerRevision = useRef(0)

  useEffect(() => {
    const desktop = window.pob2Desktop
    if (!desktop) return
    let active = true
    const unsubscribe = desktop.onTimerVisibilityChanged(visible => {
      timerRevision.current += 1
      if (active) setTimerVisible(visible)
    })
    const revision = timerRevision.current
    void desktop.getTimerVisibility().then(visible => {
      if (active && timerRevision.current === revision) setTimerVisible(visible)
    }).catch(error => {
      if (active) setNotice(`读取计时器状态失败：${errorText(error)}`)
    })
    return () => { active = false; unsubscribe() }
  }, [])

  const toggleTimer = async () => {
    const desktop = window.pob2Desktop
    if (!desktop || timerVisible === null || timerChanging.current) return
    timerChanging.current = true
    setTimerPending(true)
    const revision = timerRevision.current
    try {
      const visible = await desktop.setTimerVisibility(!timerVisible, 'campaign')
      if (timerRevision.current === revision) setTimerVisible(visible)
    } catch (error) {
      setNotice(`切换计时器显示失败：${errorText(error)}`)
    } finally {
      timerChanging.current = false
      setTimerPending(false)
    }
  }
  const [lightbox, setLightbox] = useState<{ url: string; caption?: string } | null>(null)
  const [jsonDraft, setJsonDraft] = useState<string | null>(null)
  const jsonOriginal = useRef('')
  const chaptersRef = useRef(chapters)
  chaptersRef.current = chapters
  const importInput = useRef<HTMLInputElement>(null)
  const itinerary = useRef<HTMLElement>(null)
  const details = useRef<HTMLElement>(null)
  const chapter = chapters.find(item => item.id === chapterId) ?? chapters[0]
  const node = chapter.nodes.find(item => item.id === nodeId)
  const map = chapter.maps.find(item => item.id === mapId) ?? chapter.maps[0]
  const issues = useMemo(() => validateStoryChapter(chapter), [chapter])
  const currentMatch = useMemo(() => area ? findStoryArea(chapters, area.areaId) : null, [chapters, area])
  const matchedChapterId = currentMatch?.chapter.id
  const matchedNodeId = currentMatch?.node.id
  const matchedMapId = currentMatch?.node.mapId
  const selectNode = (target: StoryNode) => { setNodeId(target.id); setMapId(target.mapId) }
  const selectChapter = (target: StoryChapter) => {
    setChapterId(target.id)
    const first = target.nodes.find(item => item.id === target.flowOrder[0]) ?? target.nodes[0]
    setNodeId(first?.id ?? '')
    setMapId(first?.mapId ?? target.maps[0]?.id ?? '')
    setZoom(1)
    setQuery('')
    setNotice('')
  }
  const replaceChapter = (next: StoryChapter) => {
    setChapters(previous => {
      const updated = previous.map(item => item.id === chapter.id ? next : item)
      sessionDrafts = updated
      return updated
    })
    sessionDirty.add(next.id)
  }
  const updateNode = (patch: Partial<StoryNode>) => {
    if (node) replaceChapter({ ...chapter, nodes: chapter.nodes.map(item => item.id === node.id ? { ...item, ...patch } : item) })
  }
  const reloadData = async () => {
    if (reloadPending.current) return
    if (sessionDirty.size && !window.confirm('重新加载将放弃所有章节中未导出的修改，并重新读取章节数据。继续吗？')) return
    reloadPending.current = true
    setReloading(true)
    try {
      const loaded = await reloadStoryChapters()
      const nextChapter = loaded.find(item => item.id === chapter.id) ?? loaded[0]
      const nextNode = nextChapter.nodes.find(item => item.id === nodeId)
        ?? nextChapter.nodes.find(item => item.id === nextChapter.flowOrder[0]) ?? nextChapter.nodes[0]
      sessionDrafts = loaded
      sessionDirty.clear()
      setChapters(loaded)
      setChapterId(nextChapter.id)
      setNodeId(nextNode?.id ?? '')
      setMapId(nextChapter.maps.some(item => item.id === mapId) ? mapId : nextNode?.mapId ?? nextChapter.maps[0]?.id ?? '')
      setJsonDraft(null)
      setLightbox(null)
      setNotice(`已重新加载 ${loaded.length} 个章节，${loaded.reduce((total, item) => total + item.nodes.length, 0)} 个区域。`)
    } catch (error) {
      setNotice(`重新加载失败：${errorText(error)}。现有内容和草稿已保留。`)
    } finally {
      reloadPending.current = false
      setReloading(false)
    }
  }
  useEffect(() => setRealm(initialRealm), [initialRealm])
  useEffect(() => {
    const bridge = window.pob2StoryGuide
    if (!bridge) return
    let disposed = false
    const receive = (event: StoryAreaEvent | null) => {
      if (!disposed && event && event.enteredAt >= lastEventAt.current) {
        lastEventAt.current = event.enteredAt
        if (findStoryArea(chaptersRef.current, event.areaId)) setArea(event)
      }
    }
    const unsubscribe = bridge.onAreaChanged(receive)
    void bridge.getCurrentArea().then(receive).catch(() => {})
    return () => { disposed = true; unsubscribe() }
  }, [])
  useEffect(() => {
    if (!matchedChapterId || !matchedNodeId || !matchedMapId || !following || editing) return
    setChapterId(matchedChapterId)
    setNodeId(matchedNodeId)
    setMapId(matchedMapId)
  }, [matchedChapterId, matchedNodeId, matchedMapId, area?.enteredAt, following, editing])
  useEffect(() => {
    const protect = (event: BeforeUnloadEvent) => {
      if (sessionDirty.size) { event.preventDefault(); event.returnValue = '' }
    }
    window.addEventListener('beforeunload', protect)
    return () => window.removeEventListener('beforeunload', protect)
  }, [])
  const closeJson = () => {
    if (jsonDraft !== jsonOriginal.current && !window.confirm('关闭后将放弃尚未应用的 JSON 修改，继续吗？')) return
    setJsonDraft(null)
  }
  useEffect(() => {
    if (details.current) details.current.scrollTop = 0
    const container = itinerary.current
    const selected = container?.querySelector<HTMLElement>('[aria-current="step"]')
    if (!container || !selected) return
    const bounds = container.getBoundingClientRect()
    const target = selected.getBoundingClientRect()
    if (target.top < bounds.top) container.scrollTop += target.top - bounds.top - 12
    else if (target.bottom > bounds.bottom) container.scrollTop += target.bottom - bounds.bottom + 12
  }, [chapterId, nodeId, editing, query])

  const addNode = (duplicate = false) => {
    if (!map) return
    const added = createStoryNode(chapter, map.id, duplicate ? node : undefined)
    replaceChapter({ ...chapter, nodes: [...chapter.nodes, added] })
    selectNode(added)
  }
  const applyImported = (text: string) => {
    const imported = parseStoryChapter(text)
    if (chapters.some(item => item.id === imported.id && item.id !== chapter.id)) throw new Error('该章节 ID 已存在，请切换到对应章节后导入。')
    if (imported.id !== chapter.id) sessionDirty.delete(chapter.id)
    replaceChapter(imported)
    selectChapter(imported)
    setNotice(`已载入 ${imported.nodes.length} 个节点。请检查校验结果后导出。`)
  }
  const importFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    try {
      if (file.size > 8 * 1024 * 1024) throw new Error('章节 JSON 请控制在 8 MB 以内。')
      if (sessionDirty.has(chapter.id) && !window.confirm('导入将替换当前章节草稿，继续吗？')) return
      applyImported(await file.text())
    } catch (error) { setNotice(`导入失败：${errorText(error)}`) }
  }
  const exportChapter = () => {
    try {
      const data = serializeStoryChapter(chapter)
      const url = URL.createObjectURL(new Blob([data], { type: 'application/json;charset=utf-8' }))
      const link = document.createElement('a')
      link.href = url
      link.download = `${chapter.id}.json`
      link.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
      sessionDirty.delete(chapter.id)
      setNotice(`已生成 ${chapter.id}.json，请保存下载文件；其中包含地图、路线、节点及赛季任务。`)
    } catch (error) { setNotice(`无法导出：${errorText(error)}`) }
  }
  const orderedNodes = [...chapter.flowOrder.map(id => chapter.nodes.find(item => item.id === id)).filter((item): item is StoryNode => Boolean(item)), ...chapter.nodes.filter(item => !chapter.flowOrder.includes(item.id))]
  const visibleNodes = orderedNodes.filter(item => `${storyNodeName(item, realm)} ${item.title} ${item.id} ${item.areaId ?? ''}`.toLowerCase().includes(query.toLowerCase()))
  const flowIndex = node ? chapter.flowOrder.indexOf(node.id) : -1
  const liveNodeId = currentMatch?.chapter.id === chapter.id ? currentMatch.node.id : undefined

  return <div className={`story-guide${editing ? ' is-editing' : ''}`}>
    <BuildCenterNav active="story" {...navigation} />
    <main className="sg-workspace">
      <header className="sg-header">
        <div className="sg-heading"><BookOpen size={23} /><div><small>SUPERPOE2 · CAMPAIGN RACING</small><h1>剧情竞速</h1></div></div>
        <div className="sg-header-actions">
          <button className={statsOpen ? 'active' : ''} aria-pressed={statsOpen} onClick={() => setStatsOpen(value => !value)}><BarChart3 size={15} />{statsOpen ? '返回路线' : '竞速统计'}</button>
          <button type="button" role="switch" aria-label="计时竞速" aria-checked={timerVisible === true} className={timerVisible ? 'active' : ''} disabled={!window.pob2Desktop || timerVisible === null || timerPending} title={window.pob2Desktop ? '显示或隐藏计时竞速窗口，计时会继续运行' : '计时竞速仅在桌面版中可用'} onClick={() => void toggleTimer()}><Timer size={15} />{timerPending ? '正在切换…' : timerVisible === null ? '计时竞速' : timerVisible ? '计时竞速：显示' : '计时竞速：隐藏'}</button>
          <select aria-label="区域名称版本" value={realm} onChange={event => setRealm(event.target.value as typeof realm)}><option value="chinese">国服名称</option><option value="international">国际服名称</option></select>
          <button disabled={reloading} onClick={() => void reloadData()}><RefreshCw size={15} className={reloading ? 'sg-reloading' : undefined} />{reloading ? '正在加载…' : '重新加载数据'}</button>
          <button disabled={reloading} className={editing ? 'active' : ''} onClick={() => { setStatsOpen(false); setEditing(!editing); setNotice('') }}><Edit3 size={15} />{editing ? '返回路线' : '编辑内容'}</button>
        </div>
      </header>
      <div className="sg-status">
        <span className={currentMatch ? 'sg-live' : ''}><i />{currentMatch ? `当前区域 · ${storyNodeName(currentMatch.node, realm)}` : '等待游戏区域日志'}</span>
        <button className={following && !editing ? 'active' : ''} disabled={editing} onClick={() => setFollowing(!following)}><LocateFixed size={14} />{editing ? '编辑时暂停跟随' : following ? '自动跟随' : '跟随已暂停'}</button>
      </div>
      {editing && !statsOpen && <div className="sg-editor-toolbar" ref={element => element?.toggleAttribute('inert', reloading)}>
        <button onClick={() => addNode()}><Plus size={14} />添加支线节点</button>
        <button disabled={!node} onClick={() => addNode(true)}><Copy size={14} />复制节点</button>
        <button onClick={() => importInput.current?.click()}><Upload size={14} />导入章节</button>
        <button onClick={() => { jsonOriginal.current = JSON.stringify(chapter, null, 2); setJsonDraft(jsonOriginal.current) }}>整章 JSON</button>
        <button className="sg-primary" onClick={exportChapter}><Download size={14} />导出完整章节</button>
        <input ref={importInput} type="file" accept=".json,application/json" hidden onChange={event => void importFile(event)} />
        <small>{sessionDirty.has(chapter.id) ? '有未导出的修改' : '拖动地图节点维护坐标'}</small>
      </div>}
      {notice && <div className="sg-notice" role="status"><span>{notice}</span><button aria-label="关闭提示" onClick={() => setNotice('')}><X size={14} /></button></div>}
      {statsOpen ? <CampaignStatistics /> : <div className="sg-columns" ref={element => element?.toggleAttribute('inert', reloading)} aria-busy={reloading}>
        <aside ref={itinerary} className="sg-itinerary" aria-label="章节和路线">
          <nav className="sg-chapters" aria-label="章节">{chapters.map(item => <button key={item.id} className={chapter.id === item.id ? 'active' : ''} onClick={() => selectChapter(item)}>{item.title}</button>)}</nav>
          <label className="sg-search"><Search size={14} /><input aria-label="查找区域" placeholder="查找区域 / ID" value={query} onChange={event => setQuery(event.target.value)} /></label>
          <div className="sg-route-label"><span>{chapter.title} · 路线</span><small>{chapter.nodes.length} 个区域</small></div>
          <ol className="sg-node-list">{visibleNodes.map((item, row) => {
            const index = chapter.flowOrder.indexOf(item.id)
            return <li key={`${item.id}-${row}`}><button className={`${node?.id === item.id ? 'selected' : ''} ${liveNodeId === item.id ? 'live' : ''}`} onClick={() => selectNode(item)} aria-current={node?.id === item.id ? 'step' : undefined}>
              <span className="sg-route-number">{index < 0 ? '支' : String(index + 1).padStart(2, '0')}</span><span><strong>{storyNodeName(item, realm)}</strong><small>{editing ? item.areaId || '待关联区域 ID' : item.badge?.text || (index < 0 ? '可选支线' : item.hint?.trim().split('\n')[0] || '主线路')}</small></span>{liveNodeId === item.id && <i title="游戏当前区域" />}
            </button></li>
          })}</ol>
          {!visibleNodes.length && <p className="sg-empty">没有匹配区域，试试区域名称或日志 ID。</p>}
          {editing && <details className="sg-validation"><summary>校验 · {issues.filter(issue => issue.level === 'error').length} 个错误 / {issues.filter(issue => issue.level === 'warning').length} 个提醒</summary>{issues.length ? issues.map((issue, index) => <button key={index} className={issue.level} onClick={() => { const target = chapter.nodes.find(item => item.id === issue.nodeId); if (target) selectNode(target) }}>{issue.nodeId && `${issue.nodeId}：`}{issue.message}</button>) : <p>章节结构校验通过。</p>}</details>}
        </aside>
        <section className="sg-map-panel" aria-label="章节地图">
          <div className="sg-map-toolbar"><select aria-label="章节地图" value={map?.id ?? ''} onChange={event => setMapId(event.target.value)}>{chapter.maps.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select><span /><button aria-label="缩小地图" disabled={zoom <= 1} onClick={() => setZoom(value => Math.max(1, value - .25))}><ZoomOut size={15} /></button><button onClick={() => setZoom(1)}>{Math.round(zoom * 100)}%</button><button aria-label="放大地图" disabled={zoom >= 2.5} onClick={() => setZoom(value => Math.min(2.5, value + .25))}><ZoomIn size={15} /></button></div>
          {map && <StoryMapStage key={`${chapter.id}:${map.id}`} chapter={chapter} mapId={map.id} selectedId={node?.id} liveId={liveNodeId} realm={realm} editing={editing} debug={debug} zoom={zoom} onZoom={setZoom} onSelect={selectNode} onMove={(id, point) => replaceChapter({ ...chapter, nodes: chapter.nodes.map(item => item.id === id ? { ...item, ...point } : item) })} />}
          <footer className="sg-map-caption"><span>{debug ? '测量模式 · 单击取坐标 · 拖动平移 · 滚轮缩放' : editing ? '拖动节点编辑 · 拖动空白平移 · 滚轮缩放' : '拖动地图 · 滚轮缩放 · 点击区域查看攻略'}</span><small>地图来自游戏截图</small></footer>
        </section>
        <aside ref={details} className="sg-details" aria-label={editing ? '节点编辑器' : '区域攻略'}>
          {editing ? node ? <NodeEditor key={`${chapter.id}:${node.id}`} chapter={chapter} node={node} onChange={updateNode} onChapter={replaceChapter} onDelete={() => {
            const next = deleteStoryNode(chapter, node.id)
            replaceChapter(next)
            const first = next.nodes.find(item => item.id === next.flowOrder[0]) ?? next.nodes[0]
            if (first) selectNode(first); else setNodeId('')
          }} /> : <p className="sg-empty">添加一个节点，开始维护当前章节。</p> : node ? <>
            <div className="sg-detail-heading"><small>{chapter.title} / {flowIndex >= 0 ? `主线 ${flowIndex + 1}` : '可选支线'}</small><h2>{storyNodeName(node, realm)}</h2>{node.names && <p>{storyNodeName(node, realm === 'chinese' ? 'international' : 'chinese')}</p>}{node.badge && <span className="sg-reward">{node.badge.text}</span>}</div>
            <div className="sg-detail-body"><p className="sg-description">{node.description}</p>{node.hint && <blockquote>{node.hint}</blockquote>}{node.rewards && <div className="sg-reward">奖励 · {node.rewards}</div>}{node.seasonReward && <div className="sg-season-reward">赛季奖励 · {node.seasonReward}</div>}
              {node.coverImage && <GuideImage url={node.coverImage} onOpen={setLightbox} />}
              {node.steps?.map((step, index) => <section className="sg-step" key={index}><h3><span>{index + 1}</span>{step.title}</h3>{step.body && <p>{step.body}</p>}{step.image && <GuideImage url={step.image} caption={step.title} onOpen={setLightbox} />}</section>)}
              {node.images?.map((img, index) => <GuideImage key={index} {...img} onOpen={setLightbox} />)}
              {chapter.seasonQuests?.length ? <section className="sg-season"><h2 className="sg-season-title">赛季任务 · {chapter.seasonQuests.length}</h2>{chapter.seasonQuests.map(quest => <section key={quest.id}><h3>{quest.title}</h3><p>{quest.overview}</p>{quest.steps.map((step, index) => <div key={index}><h4>{index + 1}. {step.title}</h4><p>{step.body}</p>{step.image && <GuideImage url={step.image} caption={step.title} onOpen={setLightbox} />}</div>)}{quest.reward && <p className="sg-reward">奖励 · {quest.reward}</p>}{quest.note && <p>{quest.note}</p>}</section>)}</section> : null}
            </div>
            <nav className="sg-next"><button disabled={flowIndex <= 0} onClick={() => { const previous = chapter.nodes.find(item => item.id === chapter.flowOrder[flowIndex - 1]); if (previous) selectNode(previous) }}><ChevronLeft size={15} />上一区域</button><button disabled={!node.next || !chapter.nodes.some(item => item.id === node.next)} onClick={() => { const next = chapter.nodes.find(item => item.id === node.next); if (next) selectNode(next) }}>下一区域<ChevronRight size={15} /></button></nav>
          </> : <p className="sg-empty">选择一个地图节点查看攻略。</p>}
        </aside>
      </div>}
    </main>
    {lightbox && <StoryDialog label="攻略图片" className="sg-lightbox" onClose={() => setLightbox(null)}><button aria-label="关闭图片" onClick={() => setLightbox(null)}><X /></button><figure onClick={event => event.stopPropagation()}><img src={storyAssetUrl(lightbox.url)} alt={lightbox.caption || '攻略地图'} />{lightbox.caption && <figcaption>{lightbox.caption}</figcaption>}</figure></StoryDialog>}
    {jsonDraft !== null && <StoryDialog label="编辑完整章节 JSON" onClose={closeJson}><section className="sg-json-dialog" onClick={event => event.stopPropagation()}><header><h2>编辑完整章节 JSON</h2><button aria-label="关闭 JSON 编辑器" onClick={closeJson}><X size={18} /></button></header><p>用于维护地图、赛季任务和附加字段。应用后可继续在地图上调整节点。</p><textarea aria-label="完整章节 JSON" spellCheck={false} value={jsonDraft} onChange={event => setJsonDraft(event.target.value)} /><footer><button onClick={closeJson}>取消</button><button className="sg-primary" onClick={() => { try { applyImported(jsonDraft); setJsonDraft(null) } catch (error) { setNotice(`JSON 无效：${errorText(error)}`) } }}>应用章节</button></footer>{notice && <p role="status">{notice}</p>}</section></StoryDialog>}
  </div>
}

function StoryDialog({ label, className = '', onClose, children }: { label: string; className?: string; onClose: () => void; children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null)
  const close = useRef(onClose)
  close.current = onClose
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const dialog = root.current!
    const focusable = () => [...dialog.querySelectorAll<HTMLElement>('button:not(:disabled), textarea, input, select, a[href], [tabindex="0"]')]
    ;(focusable()[0] ?? dialog).focus()
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); close.current(); return }
      if (event.key !== 'Tab') return
      const targets = focusable()
      const first = targets[0] ?? dialog
      const last = targets[targets.length - 1] ?? dialog
      if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) { event.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', keydown)
    return () => { document.removeEventListener('keydown', keydown); if (previous?.isConnected) previous.focus() }
  }, [])
  return <div ref={root} tabIndex={-1} className={`sg-modal ${className}`} role="dialog" aria-modal="true" aria-label={label} onClick={event => { if (event.target === event.currentTarget) close.current() }}>{children}</div>
}

function GuideImage({ url, caption, onOpen }: { url: string; caption?: string; onOpen: (image: { url: string; caption?: string }) => void }) {
  if (!storyAssetUrl(url)) return null
  return <figure className="sg-guide-image"><button onClick={() => onOpen({ url, caption })} aria-label={`放大图片${caption ? `：${caption}` : ''}`}><img loading="lazy" src={storyAssetUrl(url)} alt={caption || '区域攻略截图'} /></button>{caption && <figcaption>{caption}</figcaption>}</figure>
}

function StoryMapStage({ chapter, mapId, selectedId, liveId, realm, editing, debug, zoom, onZoom, onSelect, onMove }: {
  chapter: StoryChapter; mapId: string; selectedId?: string; liveId?: string; realm: 'international' | 'chinese'; editing: boolean; debug: boolean; zoom: number
  onZoom: (zoom: number) => void; onSelect: (node: StoryNode) => void; onMove: (id: string, point: { x: number; y: number }) => void
}) {
  const frame = useRef<HTMLDivElement>(null)
  const viewport = useRef<HTMLDivElement>(null)
  const drag = useRef<{ id?: string; pointerId: number; x: number; y: number; left: number; top: number; moved: boolean; capture: HTMLElement } | null>(null)
  const suppressClick = useRef(false)
  const zoomRef = useRef(zoom)
  const zoomAnchor = useRef<{ x: number; y: number; u: number; v: number } | null>(null)
  const [panning, setPanning] = useState(false)
  const [position, setPosition] = useState<{ id: string; x: number; y: number } | null>(null)
  const [marker, setMarker] = useState<{ x: number; y: number } | null>(null)
  const map = chapter.maps.find(item => item.id === mapId)!
  const nodes = chapter.nodes.filter(node => node.mapId === mapId && Number.isFinite(node.x) && Number.isFinite(node.y))
  const selected = nodes.find(node => node.id === selectedId)
  const selectedX = selected?.x
  const selectedY = selected?.y
  const locateSelected = useCallback(() => {
    if (editing || selectedX === undefined || selectedY === undefined || !frame.current || !viewport.current) return
    const container = viewport.current
    const bounds = container.getBoundingClientRect()
    const mapBounds = frame.current.getBoundingClientRect()
    const x = mapBounds.left - bounds.left + mapBounds.width * selectedX / 100
    const y = mapBounds.top - bounds.top + mapBounds.height * selectedY / 100
    container.scrollBy({
      left: x < 28 || x > container.clientWidth - 28 ? x - container.clientWidth / 2 : 0,
      top: y < 28 || y > container.clientHeight - 28 ? y - container.clientHeight / 2 : 0,
    })
  }, [editing, selectedX, selectedY])
  useEffect(() => {
    const request = requestAnimationFrame(locateSelected)
    return () => cancelAnimationFrame(request)
  }, [chapter.id, mapId, selectedId, locateSelected])
  // Keep the same map point under the pointer (or viewport centre for toolbar zoom).
  useLayoutEffect(() => {
    const container = viewport.current
    const image = frame.current
    const previousZoom = zoomRef.current
    zoomRef.current = zoom
    if (!container || !image || previousZoom === zoom) return
    const width = image.offsetWidth
    const height = image.offsetHeight
    const oldWidth = width * previousZoom / zoom
    const oldHeight = height * previousZoom / zoom
    const x = container.clientWidth / 2
    const y = container.clientHeight / 2
    const anchor = zoomAnchor.current ?? {
      x, y,
      u: (container.scrollLeft + x) / oldWidth,
      v: (container.scrollTop + y - Math.max(0, (container.clientHeight - oldHeight) / 2)) / oldHeight,
    }
    zoomAnchor.current = null
    container.scrollLeft = anchor.u * width - anchor.x
    container.scrollTop = Math.max(0, (container.clientHeight - height) / 2) + anchor.v * height - anchor.y
  }, [zoom])
  useEffect(() => {
    const container = viewport.current!
    const wheel = (event: WheelEvent) => {
      event.preventDefault()
      if (drag.current || !event.deltaY || !frame.current) return
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? container.clientHeight : 1)
      const next = Math.max(1, Math.min(2.5, zoomRef.current * Math.exp(-delta * .0015)))
      if (next === zoomRef.current) return
      const bounds = container.getBoundingClientRect()
      const image = frame.current.getBoundingClientRect()
      zoomAnchor.current = {
        x: event.clientX - bounds.left - container.clientLeft,
        y: event.clientY - bounds.top - container.clientTop,
        u: (event.clientX - image.left) / image.width,
        v: (event.clientY - image.top) / image.height,
      }
      onZoom(next)
    }
    container.addEventListener('wheel', wheel, { passive: false })
    return () => container.removeEventListener('wheel', wheel)
  }, [onZoom])
  useEffect(() => {
    const cancel = () => {
      const active = drag.current
      drag.current = null
      if (active?.capture.hasPointerCapture(active.pointerId)) active.capture.releasePointerCapture(active.pointerId)
      setPosition(null)
      setPanning(false)
    }
    cancel()
    setMarker(null)
    window.addEventListener('blur', cancel)
    return () => { window.removeEventListener('blur', cancel); cancel() }
  }, [editing, debug])
  const coordinates = (event: ReactPointerEvent) => {
    const rect = frame.current!.getBoundingClientRect()
    return { x: Math.round(Math.max(0, Math.min(100, (event.clientX - rect.left) / rect.width * 100)) * 10) / 10, y: Math.round(Math.max(0, Math.min(100, (event.clientY - rect.top) / rect.height * 100)) * 10) / 10 }
  }
  const finishDrag = (event: ReactPointerEvent, cancelled = false) => {
    const active = drag.current
    if (!active || active.pointerId !== event.pointerId) return
    suppressClick.current = active.moved || cancelled
    if (!cancelled && active.moved && active.id) onMove(active.id, coordinates(event))
    if (!cancelled && !active.moved && !active.id && debug && event.target === frame.current?.querySelector('img')) {
      const point = coordinates(event)
      setMarker(point)
      console.info(`[StoryGuide] ${chapter.id}/${mapId} x: ${point.x.toFixed(1)}, y: ${point.y.toFixed(1)}`)
    }
    drag.current = null
    if (active.capture.hasPointerCapture(event.pointerId)) active.capture.releasePointerCapture(event.pointerId)
    setPosition(null)
    setPanning(false)
  }
  return <div ref={viewport} className={`sg-map-scroll${panning ? ' is-panning' : ''}`} onClickCapture={event => {
    if (suppressClick.current && event.detail !== 0) { event.preventDefault(); event.stopPropagation(); suppressClick.current = false }
  }} onPointerDown={event => {
    if (event.button !== 0 || !event.isPrimary || drag.current) return
    suppressClick.current = false
    const container = event.currentTarget
    const bounds = container.getBoundingClientRect()
    if (event.clientX - bounds.left >= container.clientWidth || event.clientY - bounds.top >= container.clientHeight) return
    // Nodes retain their native click/focus; capture starts only after a pan threshold.
    if (!(event.target instanceof Element && event.target.closest('.sg-map-node'))) event.preventDefault()
    drag.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, left: container.scrollLeft, top: container.scrollTop, moved: false, capture: container }
  }} onPointerMove={event => {
    const active = drag.current
    if (!active || active.pointerId !== event.pointerId) return
    if (Math.hypot(event.clientX - active.x, event.clientY - active.y) > 3) active.moved = true
    if (!active.moved) return
    if (active.id) setPosition({ id: active.id, ...coordinates(event) })
    else {
      if (!active.capture.hasPointerCapture(event.pointerId)) active.capture.setPointerCapture(event.pointerId)
      setPanning(true)
      event.currentTarget.scrollLeft = active.left - (event.clientX - active.x)
      event.currentTarget.scrollTop = active.top - (event.clientY - active.y)
    }
  }} onPointerUp={event => finishDrag(event)} onPointerCancel={event => finishDrag(event, true)} onLostPointerCapture={event => finishDrag(event, true)}><div className={`sg-map-frame${editing ? ' sg-coordinate-grid' : ''}`} ref={frame} style={{ width: `${zoom * 100}%` }}>
    <img className="sg-map-image" src={storyAssetUrl(map.image)} alt={map.title} draggable={false} onLoad={locateSelected} />
    <svg className="sg-route-lines" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><defs><marker id="sg-route-arrow" viewBox="0 0 10 10" refX="17" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#d2b578" /></marker></defs>{chapter.flowOrder.slice(0, -1).map((id, index) => {
      const a = nodes.find(node => node.id === id)
      const b = nodes.find(node => node.id === chapter.flowOrder[index + 1])
      if (!a || !b) return null
      const from = position?.id === a.id ? position : a
      const to = position?.id === b.id ? position : b
      return <line key={`${id}-${index}`} x1={from.x} y1={from.y} x2={to.x} y2={to.y} markerEnd="url(#sg-route-arrow)" />
    })}</svg>
    {nodes.map((node, row) => {
      const point = position?.id === node.id ? position : node
      const index = chapter.flowOrder.indexOf(node.id)
      return <button key={`${node.id}-${row}`} className={`sg-map-node ${node.id === selectedId ? 'selected' : ''} ${node.id === liveId ? 'live' : ''} ${debug ? 'debug' : ''}`} style={{ left: `${point.x}%`, top: `${point.y}%` }} title={`${storyNodeName(node, realm)}${editing ? ` · ${point.x.toFixed(1)}, ${point.y.toFixed(1)}` : ''}`} aria-label={`${storyNodeName(node, realm)}${node.id === liveId ? '，游戏当前区域' : ''}`} aria-pressed={node.id === selectedId} onClick={() => onSelect(node)} onPointerDown={event => {
        if (editing && !debug && event.button === 0 && event.isPrimary) {
          event.stopPropagation()
          event.preventDefault()
          onSelect(node)
          suppressClick.current = false
          drag.current = { id: node.id, pointerId: event.pointerId, x: event.clientX, y: event.clientY, left: 0, top: 0, moved: false, capture: event.currentTarget }
          setPosition({ id: node.id, x: node.x, y: node.y })
          event.currentTarget.setPointerCapture(event.pointerId)
        }
      }} onKeyDown={event => {
        if (!editing || debug || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return
        event.preventDefault()
        const step = event.shiftKey ? 1 : .1
        onMove(node.id, { x: Math.round(Math.max(0, Math.min(100, node.x + (event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : 0))) * 10) / 10, y: Math.round(Math.max(0, Math.min(100, node.y + (event.key === 'ArrowDown' ? step : event.key === 'ArrowUp' ? -step : 0))) * 10) / 10 })
      }}><span>{index < 0 ? '+' : index + 1}</span><em>{storyNodeName(node, realm)}</em></button>
    })}
    {marker && <i className="sg-click-marker" style={{ left: `${marker.x}%`, top: `${marker.y}%` }} />}
  </div></div>
}

function NodeEditor({ chapter, node, onChange, onChapter, onDelete }: { chapter: StoryChapter; node: StoryNode; onChange: (patch: Partial<StoryNode>) => void; onChapter: (chapter: StoryChapter) => void; onDelete: () => void }) {
  const [confirmDelete, setConfirmDelete] = useState(false)
  const flowIndex = chapter.flowOrder.indexOf(node.id)
  const moveFlow = (direction: number) => {
    const flow = [...chapter.flowOrder]
    const target = flowIndex + direction
    if (flowIndex < 0 || target < 0 || target >= flow.length) return
    ;[flow[flowIndex], flow[target]] = [flow[target], flow[flowIndex]]
    onChapter(setStoryFlow(chapter, flow))
  }
  const updateStep = (index: number, patch: Partial<StoryStep>) => onChange({ steps: node.steps?.map((step, i) => i === index ? { ...step, ...patch } : step) })
  return <div className="sg-node-editor">
    <header><small>{chapter.id} / {node.id}</small><h2>节点内容</h2></header>
    <label>节点标题<input value={node.title} onChange={event => onChange({ title: event.target.value })} /></label>
    <div className="sg-field-pair"><label>国服名称<input value={node.names?.chinese ?? ''} onChange={event => onChange({ names: { international: node.names?.international ?? '', chinese: event.target.value } })} /></label><label>国际服名称<input value={node.names?.international ?? ''} onChange={event => onChange({ names: { chinese: node.names?.chinese ?? '', international: event.target.value } })} /></label></div>
    <label>真实区域 ID<input list="sg-area-options" placeholder="例如 G4_1_1" value={node.areaId ?? ''} onChange={event => onChange({ areaId: event.target.value.trim() })} /><datalist id="sg-area-options">{storyAreas.map(area => <option key={area.areaId} value={area.areaId}>{area.names.chinese} / {area.names.international}</option>)}</datalist></label>
    <button disabled={!storyAreas.some(area => area.areaId === node.areaId)} onClick={() => { const area = storyAreas.find(area => area.areaId === node.areaId); if (area) onChange({ names: structuredClone(area.names) }) }}>使用快照中的双服名称</button>
    <label>所属地图<select value={node.mapId} onChange={event => onChange({ mapId: event.target.value })}>{chapter.maps.map(map => <option key={map.id} value={map.id}>{map.title} ({map.id})</option>)}</select></label>
    <div className="sg-field-pair">{(['x', 'y'] as const).map(axis => <label key={axis}>{axis.toUpperCase()} (%)<input type="number" min="0" max="100" step="0.1" value={Number.isFinite(node[axis]) ? node[axis] : ''} onChange={event => onChange({ [axis]: event.target.value === '' ? NaN : Number(event.target.value) })} /></label>)}</div>
    <fieldset><legend>路线</legend><label className="sg-checkbox"><input type="checkbox" checked={flowIndex >= 0} onChange={event => onChapter(setStoryFlow(chapter, event.target.checked ? [...chapter.flowOrder, node.id] : chapter.flowOrder.filter(id => id !== node.id)))} />加入主线路</label>{flowIndex >= 0 ? <div className="sg-flow-controls"><button disabled={flowIndex === 0} onClick={() => moveFlow(-1)}>前移</button><span>第 {flowIndex + 1} / {chapter.flowOrder.length} 站</span><button disabled={flowIndex === chapter.flowOrder.length - 1} onClick={() => moveFlow(1)}>后移</button></div> : <label>支线返回节点<select value={node.next ?? ''} onChange={event => onChange({ next: event.target.value || null })}><option value="">无</option>{chapter.nodes.filter(item => item.id !== node.id).map(item => <option key={item.id} value={item.id}>{item.title} ({item.id})</option>)}</select></label>}</fieldset>
    <label>攻略说明<textarea rows={5} value={node.description} onChange={event => onChange({ description: event.target.value })} /></label>
    <label>路线提示<textarea rows={2} value={node.hint ?? ''} onChange={event => onChange({ hint: event.target.value })} /></label>
    <label>奖励<input value={node.rewards ?? ''} onChange={event => onChange({ rewards: event.target.value })} /></label>
    <div className="sg-field-pair"><label>节点标签<input value={node.badge?.text ?? ''} onChange={event => onChange({ badge: { ...node.badge, text: event.target.value } })} /></label><label>赛季奖励<input value={node.seasonReward ?? ''} onChange={event => onChange({ seasonReward: event.target.value })} /></label></div>
    <label>封面图片路径<input value={node.coverImage ?? ''} placeholder="/InfoMap/xxx.png" onChange={event => onChange({ coverImage: event.target.value || null })} /></label>
    <fieldset><legend>攻略步骤</legend>{node.steps?.map((step, index) => <div className="sg-edit-step" key={index}><label>步骤 {index + 1}<input value={step.title} onChange={event => updateStep(index, { title: event.target.value })} /></label><textarea aria-label={`步骤 ${index + 1} 说明`} rows={3} value={step.body ?? ''} onChange={event => updateStep(index, { body: event.target.value })} /><input aria-label={`步骤 ${index + 1} 图片路径`} placeholder="图片路径（可选）" value={step.image ?? ''} onChange={event => updateStep(index, { image: event.target.value })} /><button onClick={() => onChange({ steps: node.steps?.filter((_, i) => i !== index) })}>移除步骤</button></div>)}<button onClick={() => onChange({ steps: [...node.steps ?? [], { title: '新步骤', body: '' }] })}><Plus size={13} />添加步骤</button></fieldset>
    <fieldset><legend>攻略图片</legend>{node.images?.map((image, index) => <div className="sg-edit-step" key={index}><label>本地路径<input value={image.url} onChange={event => onChange({ images: node.images?.map((item, i) => i === index ? { ...item, url: event.target.value } : item) })} /></label><label>图片说明<input value={image.caption ?? ''} onChange={event => onChange({ images: node.images?.map((item, i) => i === index ? { ...item, caption: event.target.value } : item) })} /></label><button onClick={() => onChange({ images: node.images?.filter((_, i) => i !== index) })}>移除图片</button></div>)}<button onClick={() => onChange({ images: [...node.images ?? [], { url: '', caption: '' }] })}><Plus size={13} />添加图片</button></fieldset>
    <div className="sg-delete">{confirmDelete ? <><p>删除 {node.title}？主线和返回链接会同步修复。</p><button onClick={onDelete}>确认删除</button><button onClick={() => setConfirmDelete(false)}>取消</button></> : <button onClick={() => setConfirmDelete(true)}><Trash2 size={14} />删除节点</button>}</div>
  </div>
}

import { Fragment, useEffect, useState } from 'react'
import { ChevronDown, ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react'
import type { CampaignStatistics as Statistics, CampaignStatsSegment } from '@/types/campaignStats'

const chapters: Record<CampaignStatsSegment, string> = { act1: '第一章', act2: '第二章', act3: '第三章', act4: '第四章', interlude: '幕间' }
const statuses = { idle: '尚未开始', running: '计时中', paused: '已暂停', completed: '已完成' }
const duration = (value: number | null) => {
  if (value === null) return '—'
  const seconds = Math.floor(value / 1000)
  return `${String(Math.floor(seconds / 3600)).padStart(2, '0')}:${String(Math.floor(seconds / 60) % 60).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
}

export function CampaignStatistics() {
  const [data, setData] = useState<Statistics | null>(null)
  const [page, setPage] = useState(0)
  const [refresh, setRefresh] = useState(0)
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState('')
  const [expanded, setExpanded] = useState<number | null>(null)
  const available = !!window.pob2StoryGuide?.getCampaignStatistics

  useEffect(() => {
    const api = window.pob2StoryGuide
    if (!api?.getCampaignStatistics) { setBusy(false); return }
    let active = true
    let pending = false
    const load = async () => {
      if (pending) return
      pending = true
      setBusy(true)
      try {
        const result = await api.getCampaignStatistics(page)
        if (active) { setData(result); setError('') }
      } catch (reason) {
        if (active) setError(`读取竞速成绩失败：${reason instanceof Error ? reason.message : String(reason)}`)
      } finally {
        pending = false
        if (active) setBusy(false)
      }
    }
    void load()
    const interval = window.setInterval(() => void load(), 5000)
    const focus = () => void load()
    window.addEventListener('focus', focus)
    return () => { active = false; window.clearInterval(interval); window.removeEventListener('focus', focus) }
  }, [page, refresh])

  return <section className="sg-stats" aria-label="竞速统计">
    <header className="sg-stats-heading">
      <div><small>CAMPAIGN RECORDS</small><h2>竞速统计</h2><p>每次完成，都是下一次出发的参照。</p></div>
      <button disabled={!available || busy} onClick={() => setRefresh(value => value + 1)}><RefreshCw size={14} className={busy ? 'sg-reloading' : undefined} />刷新成绩</button>
    </header>
    {!available ? <p className="sg-stats-empty">竞速统计仅在桌面版中可用。</p> : <>
      {error && <p className="sg-stats-error" role="alert">{error}，可点击“刷新成绩”重试。</p>}
      {!data && !error && <p className="sg-stats-empty" role="status">正在读取竞速成绩…</p>}
      {data && <>
        <div className="sg-stats-current"><span className={data.current.status === 'running' ? 'sg-live' : ''}>当前计时 · {statuses[data.current.status]}{data.current.segment ? ` / ${chapters[data.current.segment]}` : ''}</span><strong>{duration(data.current.elapsed)}</strong><small>进行中的计时不计入成绩汇总 · 每 5 秒更新</small></div>
        <dl className="sg-stats-metrics">
          <div><dt>完成记录</dt><dd>{data.completedRuns}<small> 场</small></dd><span>{data.fullRouteRuns} 场有全章节用时</span></div>
          <div><dt>累计完成用时</dt><dd>{duration(data.totalElapsed)}</dd><span>所有已完成记录</span></div>
          <div className="sg-stats-best"><dt>全章节最快</dt><dd>{duration(data.bestElapsed)}</dd><span>第一章至幕间均有计时</span></div>
          <div><dt>全章节平均</dt><dd>{duration(data.averageElapsed)}</dd><span>按 {data.fullRouteRuns} 场记录计算</span></div>
        </dl>
        <section className="sg-stats-section" aria-labelledby="sg-chapter-stats">
          <header><h3 id="sg-chapter-stats">章节用时</h3><span>有计时的已完成记录</span></header>
          <div className="sg-stats-table-wrap"><table className="sg-stats-table"><thead><tr><th scope="col">章节</th><th scope="col">最快</th><th scope="col">平均</th><th scope="col">最近一次</th><th scope="col">记录数</th></tr></thead>
            <tbody>{data.chapters.map(chapter => <tr key={chapter.key}><th scope="row">{chapters[chapter.key]}</th><td className="sg-stats-best">{duration(chapter.best)}</td><td>{duration(chapter.average)}</td><td>{duration(chapter.latest)}</td><td>{chapter.count || '—'}</td></tr>)}</tbody>
          </table></div>
        </section>
        <section className="sg-stats-section" aria-labelledby="sg-run-stats">
          <header><h3 id="sg-run-stats">历史成绩</h3><span>最近完成在前 · 本地保存</span></header>
          {!data.runs.length ? <div className="sg-stats-empty"><strong>还没有完成记录</strong><p>打开“计时竞速”，在故事开荒模式下开始计时，完成本次竞速后即可在这里查看成绩。</p></div> : <div className="sg-stats-table-wrap"><table className="sg-stats-table sg-stats-history"><thead><tr><th scope="col">完成时间</th><th scope="col">总用时</th><th scope="col">计时范围</th><th scope="col">章节明细</th></tr></thead><tbody>
            {data.runs.map(run => <Fragment key={run.id}><tr><th scope="row"><time dateTime={new Date(run.completedAt).toISOString()}>{new Date(run.completedAt).toLocaleString('zh-CN', { hour12: false })}</time><small>记录 #{run.id}</small></th><td className={run.fullRoute && run.elapsed === data.bestElapsed ? 'sg-stats-best' : ''}>{duration(run.elapsed)}</td><td>{run.fullRoute ? '全章节' : '部分章节'}</td><td><button aria-label={`${expanded === run.id ? '收起' : '展开'}记录 ${run.id} 章节明细`} aria-expanded={expanded === run.id} onClick={() => setExpanded(expanded === run.id ? null : run.id)}>{expanded === run.id ? '收起' : '展开'}<ChevronDown size={14} className={expanded === run.id ? 'sg-stats-expanded' : ''} /></button></td></tr>
              {expanded === run.id && <tr><td colSpan={4}><dl className="sg-stats-splits">{run.segments.map(segment => <div key={segment.key}><dt>{chapters[segment.key]}</dt><dd>{duration(segment.elapsed > 0 ? segment.elapsed : null)}</dd></div>)}</dl><p className="sg-stats-started">开始于 {new Date(run.startedAt).toLocaleString('zh-CN', { hour12: false })}</p></td></tr>}
            </Fragment>)}
          </tbody></table></div>}
          {data.completedRuns > data.pageSize && <footer className="sg-stats-pagination"><span>第 {data.page + 1} / {Math.ceil(data.completedRuns / data.pageSize)} 页 · 共 {data.completedRuns} 场</span><button disabled={busy || data.page === 0} onClick={() => { setPage(data.page - 1); setExpanded(null) }}><ChevronLeft size={14} />上一页</button><button disabled={busy || (data.page + 1) * data.pageSize >= data.completedRuns} onClick={() => { setPage(data.page + 1); setExpanded(null) }}>下一页<ChevronRight size={14} /></button></footer>}
        </section>
        <p className="sg-stats-note">仅汇总已完成记录；重置未完成计时不计入成绩。全章节指五个章节都有计时，中途开始或手动完成可能包含部分章节用时，请结合章节明细比较。</p>
      </>}
    </>}
  </section>
}

import { useEffect } from 'react'
import { Activity, CircleStop } from 'lucide-react'
import { useTranslation } from '@/i18n/useTranslation'
import { subscribeGameRuntime, useGameRuntimeStore } from '@/store/gameRuntimeStore'

export function GameRuntimeIndicator() {
  const { lang } = useTranslation()
  const game = useGameRuntimeStore((state) => state.game)
  const running = game.status === 'foreground' || game.status === 'background'
  const zh = lang === 'zh-rCN'

  useEffect(() => subscribeGameRuntime(), [])

  const label = running
    ? (zh ? '游戏运行中' : 'Game running')
    : game.status === 'stopped'
      ? (zh ? '游戏未运行' : 'Game not running')
      : (zh ? '正在检测游戏运行状态' : 'Checking game status')
  const detail = running
    ? `${label} · ${game.status === 'foreground' ? (zh ? '前台' : 'Foreground') : (zh ? '后台' : 'Background')}`
    : label

  return <div className={`global-game-status ${running ? 'running' : game.status}`} role="status" aria-live="polite" aria-label={detail} data-tooltip={detail} tabIndex={0}>
    <span className="global-game-status-icon">{running || game.status === 'unknown' ? <Activity /> : <CircleStop />}<i /></span>
  </div>
}

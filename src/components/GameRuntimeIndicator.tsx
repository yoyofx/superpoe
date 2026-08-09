import { useEffect } from 'react'
import { Activity, CircleStop } from 'lucide-react'
import { useTranslation } from '@/i18n/useTranslation'
import { uiText } from '@/i18n/uiLocale'
import { subscribeGameRuntime, useGameRuntimeStore } from '@/store/gameRuntimeStore'

export function GameRuntimeIndicator() {
  const { lang } = useTranslation()
  const game = useGameRuntimeStore((state) => state.game)
  const running = game.status === 'foreground' || game.status === 'background'
  const l = (en: string, zhCN: string, zhTW: string, koKR: string) => uiText(lang, en, zhCN, zhTW, koKR)

  useEffect(() => subscribeGameRuntime(), [])

  const label = running
    ? l('Game running', '游戏运行中', '遊戲執行中', '게임 실행 중')
    : game.status === 'stopped'
      ? l('Game not running', '游戏未运行', '遊戲未執行', '게임이 실행 중이 아님')
      : l('Checking game status', '正在检测游戏运行状态', '正在偵測遊戲執行狀態', '게임 상태 확인 중')
  const detail = running
    ? `${label} · ${game.status === 'foreground' ? l('Foreground', '前台', '前景', '포그라운드') : l('Background', '后台', '背景', '백그라운드')}`
    : label

  return <div className={`global-game-status ${running ? 'running' : game.status}`} role="status" aria-live="polite" aria-label={detail} data-tooltip={detail} tabIndex={0}>
    <span className="global-game-status-icon">{running || game.status === 'unknown' ? <Activity /> : <CircleStop />}<i /></span>
  </div>
}

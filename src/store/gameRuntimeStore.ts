import { create } from 'zustand'
import type { GameRuntimeState } from '@/types/market'

interface GameRuntimeStore {
  game: GameRuntimeState
  setGame: (game: GameRuntimeState) => void
}

export const useGameRuntimeStore = create<GameRuntimeStore>((set) => ({
  game: { status: 'unknown' },
  setGame: (game) => set({ game }),
}))

export function subscribeGameRuntime(): () => void {
  const bridge = window.pob2Market
  if (!bridge) return () => {}
  let active = true
  void bridge.getMonitoring()
    .then((snapshot) => { if (active) useGameRuntimeStore.getState().setGame(snapshot.game) })
    .catch(() => {})
  const unsubscribe = bridge.onMonitoringChanged((snapshot) => {
    if (active) useGameRuntimeStore.getState().setGame(snapshot.game)
  })
  return () => {
    active = false
    unsubscribe()
  }
}

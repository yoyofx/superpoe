import { describe, expect, it } from 'vitest'
import { classifyGameClient } from '../../electron/gameWindowService'

describe('game client realm classification', () => {
  it('classifies Tencent/WeGame and international installations', () => {
    expect(classifyGameClient('D:\\WeGameApps\\rail_apps\\2002052\\PathOfExile.exe', '流放之路')).toBe('cn')
    expect(classifyGameClient('C:\\Program Files (x86)\\Steam\\steamapps\\common\\Path of Exile 2\\PathOfExileSteam.exe', 'Path of Exile 2')).toBe('global')
    expect(classifyGameClient('C:\\Games\\unknown.exe', 'Game')).toBe('unknown')
  })
})

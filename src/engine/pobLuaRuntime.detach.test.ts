import { describe, expect, it } from 'vitest'
import { detachLuaValue } from '@/engine/pobLuaRuntime'

describe('detachLuaValue', () => {
  it('normalizes Lua arrays detached as numeric-keyed objects', () => {
    expect(detachLuaValue({
      2: { label: 'Projectile' },
      1: { label: 'Melee' },
    })).toEqual([
      { label: 'Melee' },
      { label: 'Projectile' },
    ])
  })

  it('preserves non-array Lua tables as objects', () => {
    expect(detachLuaValue({ 1: 'first', mode: 'UNBUFFED' })).toEqual({
      1: 'first',
      mode: 'UNBUFFED',
    })
  })
})

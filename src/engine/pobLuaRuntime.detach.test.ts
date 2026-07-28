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

  it('preserves item indexes when a batched equipment inspection fails in the middle', () => {
    expect(detachLuaValue({
      results: {
        1: { baseType: 'Gold Ring' },
        2: false,
        3: { baseType: 'Bladed Quarterstaff' },
      },
      errors: { 2: 'PoB could not resolve the item base' },
    })).toEqual({
      results: [
        { baseType: 'Gold Ring' },
        false,
        { baseType: 'Bladed Quarterstaff' },
      ],
      errors: { 2: 'PoB could not resolve the item base' },
    })
  })
})

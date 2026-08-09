import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { ItemIconIndex } from '../../electron/itemIconIndex'

describe('main-process item icon index', () => {
  it('resolves canonical items by base type and unique name', () => {
    const index = new ItemIconIndex(path.join(process.cwd(), 'public', 'data', 'item-icons.json'))

    expect(index.resolve('RARE', 'Wrath Spell', 'Sanctified Staff')).toMatch(/^\/assets\/items\/poe2db\//)
    expect(index.resolve('UNIQUE', 'Svalinn', 'Crucible Tower Shield')).toMatch(/^\/assets\/items\/poe2db\//)
  })
})

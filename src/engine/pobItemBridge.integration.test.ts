import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

describe('native PoB item bridge', () => {
  it('normalizes an item and generates complete trade stat ids', () => {
    if (process.platform !== 'win32' || process.arch !== 'x64') return
    const root = process.cwd()
    const executable = path.join(root, 'native', 'bin', 'win32-x64', 'luajit.exe')
    const runner = path.join(root, 'native', 'pob-lua-runner.lua')
    const bundle = path.join(root, 'public', 'pob-lua')
    const raw = [
      'Rarity: RARE',
      'Doom Branch',
      'Wrapped Quarterstaff',
      'Item Level: 80',
      'Implicits: 0',
      '+100 to maximum Life',
      '+35% to Fire Resistance',
    ].join('\n')
    const request = JSON.stringify({ id: 1, type: 'normalizeItem', payload: { raw } }) + '\n'
    const result = spawnSync(executable, [runner, bundle], { cwd: bundle, input: request, encoding: 'utf8', timeout: 30_000 })

    expect(result.status).toBe(0)
    const lines = result.stdout.trim().split(/\r?\n/)
    const response = JSON.parse(lines[1])
    expect(response.data).toMatchObject({
      success: true,
      item: { format: 'pob2-item' },
      view: { rarity: 'RARE', name: 'Doom Branch', baseType: 'Wrapped Quarterstaff', tradeCategory: 'weapon.warstaff' },
    })
    expect(response.data.item.raw).toContain('+100 to maximum Life')
    expect(response.data.view.modifiers[0]).toMatchObject({
      text: '+100 to maximum Life',
      tradeStatIds: ['explicit.stat_3299347043'],
      tradeValue: 100,
      unsupported: false,
    })
    expect(response.data.item.modifierSupport).toEqual(expect.arrayContaining([
      expect.objectContaining({ text: '+100 to maximum Life', supported: true }),
      expect.objectContaining({ text: '+35% to Fire Resistance', supported: true }),
    ]))
  })
})

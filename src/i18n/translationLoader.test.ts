import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  LANGUAGE_OPTIONS,
  getLocalizedNodeDisplay,
  getLocalizedSearchText,
  isTranslationLoaded,
  loadTranslations,
  resetTranslationsForTest,
} from '@/i18n/translationLoader'
import type { TreeNode } from '@/types/tree'

const node = {
  id: '1',
  name: 'Energy Shield',
  icon: '',
  stats: [
    '+10 to Intelligence',
    '12% increased Mana Regeneration Rate',
    '15% increased chance to Shock',
    'Adds 2 to 5 Fire Damage',
  ],
  type: 'Normal',
  group: '1',
  orbit: 0,
  orbitIndex: 0,
  x: 0,
  y: 0,
  out: [],
  in: [],
} satisfies TreeNode

function parseCsvRows(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]
    const next = text[i + 1]
    if (quoted) {
      if (char === '"' && next === '"') {
        field += '"'
        i += 1
      } else if (char === '"') {
        quoted = false
      } else {
        field += char
      }
      continue
    }
    if (char === '"') quoted = true
    else if (char === ',') {
      row.push(field)
      field = ''
    } else if (char === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else if (char !== '\r') {
      field += char
    }
  }

  if (field || row.length > 0) {
    row.push(field)
    rows.push(row)
  }

  return rows.filter((item) => item.length >= 2 && item[0] && item[1])
}

afterEach(() => {
  vi.restoreAllMocks()
  resetTranslationsForTest()
})

describe('translationLoader', () => {
  it('loads CSV translations and localizes passive node display/search text', async () => {
    const csvByFile: Record<string, string> = {
      'tree_dn.csv': '"Energy Shield",能量护盾\n',
      'tree_sd.csv': '"+10 to Intelligence","+10 智慧"\n"12% increased Mana Regeneration Rate","魔力再生率提高 12%"\n"+10% to all Elemental Resistances","+10% 所有元素抗性"\n',
      'tree_rt.csv': '',
      'passiveTree.csv': '',
      'statDescriptions.csv': '"{0}% increased chance to Shock","感电几率提高 {0}%"\n"Energy Shield does not Recharge","能量护盾无法充能"\n',
      'Query_Mod.csv': '"Adds # to # Fire Damage","附加 # - # 火焰伤害"\n',
    }

    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const file = url.split('/').pop() || ''
      return {
        ok: true,
        text: async () => csvByFile[file] ?? '',
      }
    }))

    await loadTranslations('zh-rCN')

    expect(isTranslationLoaded('zh-rCN')).toBe(true)
    expect(getLocalizedNodeDisplay(node, 'zh-rCN')).toMatchObject({
      name: '能量护盾',
      stats: ['+10 智慧', '魔力再生率提高 12%', '感电几率提高 15%', '附加 2 - 5 火焰伤害'],
    })
    expect(getLocalizedSearchText(node, 'zh-rCN')).toContain('能量护盾')
    expect(getLocalizedSearchText(node, 'zh-rCN')).toContain('魔力再生率提高 12%')
    expect(getLocalizedSearchText(node, 'zh-rCN')).toContain('感电几率提高 15%')
  })

  it('reuses numeric translation patterns for matching stat lines', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const file = url.split('/').pop() || ''
      return {
        ok: true,
        status: 200,
        json: async () => ({ 'zh-rCN': [] }),
        text: async () => file === 'tree_sd.csv' ? '"+10% to all Elemental Resistances","+10% 所有元素抗性"\n' : '',
      }
    }))

    await loadTranslations('zh-rCN')

    expect(getLocalizedNodeDisplay({
      ...node,
      stats: ['-4% to all Elemental Resistances'],
    }, 'zh-rCN').stats[0]).toBe('-4% 所有元素抗性')
  })

  it('falls back to translating multi-line passive text line by line', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const file = url.split('/').pop() || ''
      const rows = file === 'statDescriptions.csv'
        ? '"Excess Life Recovery from Regeneration is applied to Energy Shield","过量生命再生回复应用于能量护盾"\n"Energy Shield does not Recharge","能量护盾无法充能"\n'
        : ''
      return {
        ok: true,
        text: async () => rows,
      }
    }))

    await loadTranslations('zh-rTW')

    expect(getLocalizedNodeDisplay({
      ...node,
      stats: ['Excess Life Recovery from Regeneration is applied to Energy Shield\nEnergy Shield does not Recharge'],
    }, 'zh-rTW').stats[0]).toBe('过量生命再生回复应用于能量护盾\n能量护盾无法充能')
  })

  it('recognizes every bundled non-English language option', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const parts = url.split('/')
      const language = parts[parts.length - 2]
      const file = parts[parts.length - 1] || ''
      const rows = file === 'tree_dn.csv' ? `"Energy Shield","${language} Energy Shield"\n` : ''
      return {
        ok: true,
        text: async () => rows,
      }
    }))

    expect(LANGUAGE_OPTIONS.map((option) => option.value)).toEqual(['en', 'zh-rCN', 'zh-rTW', 'ko-KR'])

    for (const option of LANGUAGE_OPTIONS.filter((item) => item.value === 'zh-rTW' || item.value === 'ko-KR')) {
      await loadTranslations(option.value)
      expect(isTranslationLoaded(option.value)).toBe(true)
      expect(getLocalizedNodeDisplay(node, option.value).name).toBe(`${option.value} Energy Shield`)
    }
  })

  it('ignores missing optional translation CSV files', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const file = url.split('/').pop() || ''
      return {
        ok: file !== 'tree_rt.csv',
        status: file === 'tree_rt.csv' ? 404 : 200,
        text: async () => file === 'tree_dn.csv' ? '"Energy Shield","能量護盾"\n' : '',
      }
    }))

    await loadTranslations('zh-rTW')

    expect(isTranslationLoaded('zh-rTW')).toBe(true)
    expect(getLocalizedNodeDisplay(node, 'zh-rTW').name).toBe('能量護盾')
  })

  it('does not include partial English supplement translations', () => {
    for (const language of ['zh-rCN', 'zh-rTW', 'ko-KR'] as const) {
      const file = resolve(process.cwd(), `public/data/Translate/${language}/superpoe_tree_supplement.csv`)
      const rows = parseCsvRows(readFileSync(file, 'utf8'))
      const mixedRows = rows.filter(([, translated]) => /[A-Za-z]{2,}/.test(translated))
      expect(mixedRows, `${language} supplement has mixed English rows`).toEqual([])
    }
  })
})

import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { getGrantedSkillInfo } from '@/i18n/grantedSkills'
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

  it('localizes granted ascendancy skill details from node stats', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const file = url.split('/').pop() || ''
      const rows = file === 'superpoe_tree_supplement.csv'
        ? [
          '"Grants Skill: Hollow Form","获得技能：空洞形态"',
          '"Hollow Form","空洞形态"',
          '"Attack","攻击"',
          '"Melee, Sustained, Channelling, Meta","近战、持续、引导、元技能"',
          '"Any Melee Martial Weapon","任意近战武术武器"',
          '"Channel to create fleeting images of your astral self near the target location. The images perform a Socketed Melee Attack once then vanish, targeting the closest enemy if possible. The images cannot perform Channelled Skills or Conditional Skills. Consuming a Power Charge creates additional images.","引导以在目标位置附近创造短暂的星体幻影。幻影会施放一次镶嵌的近战攻击后消失。"',
        ].join('\n')
        : ''
      return {
        ok: true,
        status: 200,
        json: async () => ({ 'zh-rCN': ['superpoe_tree_supplement.csv'] }),
        text: async () => rows,
      }
    }))

    await loadTranslations('zh-rCN')

    const display = getLocalizedNodeDisplay({
      ...node,
      stats: ['Grants Skill: Hollow Form'],
    }, 'zh-rCN')

    expect(display.stats[0]).toBe('获得技能：空洞形态')
    expect(display.grantedSkills[0]).toMatchObject({
      skillId: 'MetaHollowFormPlayer',
      name: '空洞形态',
      gemType: '攻击',
      tags: '近战、持续、引导、元技能',
      weaponRequirements: '任意近战武术武器',
      description: '引导以在目标位置附近创造短暂的星体幻影。幻影会施放一次镶嵌的近战攻击后消失。',
    })
  })

  it('leaves ordinary stats unchanged when no granted skill detail exists', () => {
    const display = getLocalizedNodeDisplay({
      ...node,
      stats: ['12% increased Mana Regeneration Rate'],
    }, 'en')

    expect(display.stats).toEqual(['12% increased Mana Regeneration Rate'])
    expect(display.grantedSkills).toEqual([])
  })

  it('falls back to English granted skill details when a language has no matching translation', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ 'zh-rTW': [] }),
      text: async () => '',
    })))

    await loadTranslations('zh-rTW')

    const display = getLocalizedNodeDisplay({
      ...node,
      stats: ['Grants Skill: Hollow Form'],
    }, 'zh-rTW')

    expect(display.stats[0]).toBe('Grants Skill: Hollow Form')
    expect(display.grantedSkills[0]).toMatchObject({
      skillId: 'MetaHollowFormPlayer',
      name: 'Hollow Form',
    })
  })

  it('has granted skill details for every 0.5 ascendancy granted skill stat', () => {
    const tree = JSON.parse(readFileSync(resolve(process.cwd(), 'public/data/tree-web-0_5.json'), 'utf8')) as {
      nodes: Record<string, TreeNode>
    }
    const missing = Object.values(tree.nodes)
      .filter((item) => item.ascendancyName)
      .flatMap((item) => item.stats || [])
      .filter((stat) => stat.startsWith('Grants Skill: '))
      .filter((stat) => !getGrantedSkillInfo(stat))

    expect(missing).toEqual([])
  })

  it('does not use syllabified supplement translations for Martial Artist key stats', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const manifestPath = resolve(process.cwd(), 'public/data/Translate/translation-files.json')
      if (url === '/data/Translate/translation-files.json') {
        return {
          ok: true,
          status: 200,
          json: async () => JSON.parse(readFileSync(manifestPath, 'utf8')),
          text: async () => readFileSync(manifestPath, 'utf8'),
        }
      }

      const match = url.match(/^\/data\/Translate\/([^/]+)\/(.+)$/)
      if (!match) {
        return { ok: false, status: 404, text: async () => '' }
      }

      const [, language, file] = match
      const filePath = resolve(process.cwd(), `public/data/Translate/${language}/${file}`)
      return {
        ok: true,
        status: 200,
        text: async () => readFileSync(filePath, 'utf8'),
      }
    }))

    await loadTranslations('zh-rCN')

    const martialArtistNode = {
      ...node,
      stats: [
        'Grants Skill: Hollow Form',
        'Grants Skill: Hollow Resonance',
        'Grants Skill: Hollow Focus',
        'Can tattoo Runes onto your body, gaining\nadditional Rune-only sockets:\n1 Helmet socket\n2 Body Armour sockets\n1 Gloves socket\n1 Boots socket',
        'Gloves you equip have their Base Type transformed to Fists of Stone while equipped, and\ntheir Explicit Modifiers are transformed into more powerful related Modifiers',
        'Ignore Attribute Requirements to equip Gloves',
        'When you gain Combo, gain an additional Combo',
        '-0.2 seconds to current Energy Shield Recharge delay per Combo expended when using Skills',
        "100% Surpassing chance per enemy Power to gain Mountain's Teachings on Immobilising an enemy, up to a maximum of 30\nLose a Mountain's Teaching when you are Hit, or when you use or Sustain an Attack that benefits from Mountain's Teachings",
      ],
    }

    const text = getLocalizedNodeDisplay(martialArtistNode, 'zh-rCN').stats.join('\n')

    expect(text).not.toMatch(/赫奥|克阿恩|格阿伊恩|沃赫厄恩|特赫|弗弗|德厄|勒厄|姆厄|尔厄|丘乌/)
    expect(text).toContain('获得技能：空洞形态')
    expect(text).toContain('可以将符文纹刻在身体上')
    expect(text).toContain('无视装备手套的属性需求')
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

import { describe, expect, it, vi } from 'vitest'
import { parsePoeNinjaCharacterUrl, requestPoeNinjaBuild } from '../../electron/poeNinjaClient'

const characterUrl = 'https://poe.ninja/poe2/profile/deep_darkfantasy-5016/runesofaldur/character/%E7%8C%8E%E9%AD%94%E4%BA%BA%E4%BA%8C%E9%98%B6%E6%AE%B5'

describe('poe.ninja build import', () => {
  it('parses a PoE2 character link', () => {
    expect(parsePoeNinjaCharacterUrl(characterUrl)).toMatchObject({
      account: 'deep_darkfantasy-5016',
      league: 'runesofaldur',
      character: '猎魔人二阶段',
    })
  })

  it('parses the build character route and passive-tree suffix', () => {
    expect(parsePoeNinjaCharacterUrl('https://poe.ninja/poe2/builds/runesofaldur/character/deep_darkfantasy-5016/%E7%8C%8E%E9%AD%94%E4%BA%BA%E4%BA%8C%E9%98%B6%E6%AE%B5/passive-tree')).toMatchObject({
      account: 'deep_darkfantasy-5016',
      league: 'runesofaldur',
      character: '猎魔人二阶段',
    })
  })

  it('rejects non-character or non-poe.ninja links', () => {
    expect(() => parsePoeNinjaCharacterUrl('https://poe.ninja/poe2/builds')).toThrow('PoE2 character links')
    expect(() => parsePoeNinjaCharacterUrl('https://example.com/poe2/profile/a/b/character/c')).toThrow('HTTPS poe.ninja links')
  })

  it('extracts the official Path of Building export from the character model', async () => {
    const fetchImpl = vi.fn(async (input: URL | RequestInfo) => {
      const url = String(input)
      expect(url).toContain('/poe2/api/profile/characters/deep_darkfantasy-5016/runesofaldur/')
      expect(url).toContain('/model/0')
      return new Response(JSON.stringify({ type: 'found', charModel: { name: '猎魔人二阶段', pathOfBuildingExport: 'eNrt_test-code' } }), { status: 200 })
    })

    await expect(requestPoeNinjaBuild(characterUrl, fetchImpl as unknown as typeof fetch)).resolves.toMatchObject({
      code: 'eNrt_test-code',
      suggestedName: '猎魔人二阶段',
      sourceUrl: characterUrl,
    })
    expect(fetchImpl).toHaveBeenCalledOnce()
  })
})

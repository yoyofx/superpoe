import { describe, expect, it } from 'vitest'
import { createSearchQuerySnapshot, diagnoseOfficialSearchUrl, parseOfficialSearchUrl } from '../../electron/marketSearch'

describe('official market search references', () => {
  it('parses and canonicalizes CN and global search URLs', () => {
    expect(parseOfficialSearchUrl(
      'https://poe.game.qq.com/trade2/search/poe2/%E5%A5%A5%E6%9D%9C%E5%B0%94%E7%A7%98%E7%AC%A6/lV8QjDksV?status=online#ignored',
      'cn',
    )).toMatchObject({
      realm: 'cn', leagueId: '奥杜尔秘符', searchCode: 'lV8QjDksV',
      canonicalUrl: 'https://poe.game.qq.com/trade2/search/poe2/%E5%A5%A5%E6%9D%9C%E5%B0%94%E7%A7%98%E7%AC%A6/lV8QjDksV',
    })
    expect(parseOfficialSearchUrl('https://pathofexile.com/trade2/search/poe2/Test/abc-123/', 'global')?.canonicalUrl)
      .toBe('https://www.pathofexile.com/trade2/search/poe2/Test/abc-123')
  })

  it('accepts compressed search codes longer than API result IDs', () => {
    const searchCode = 'A'.repeat(210)
    const reference = parseOfficialSearchUrl(
      `https://www.pathofexile.com/trade2/search/poe2/Forbidden%20Rites/${searchCode}`,
      'global',
    )
    expect(reference?.searchCode).toBe(searchCode)
  })

  it('rejects non-search pages, realm mismatches, malformed encoding and invalid codes', () => {
    expect(parseOfficialSearchUrl('https://poe.game.qq.com/trade2', 'cn')).toBeNull()
    expect(parseOfficialSearchUrl('https://poe.game.qq.com/trade2/search/poe2/Test', 'cn')).toBeNull()
    expect(parseOfficialSearchUrl('https://www.pathofexile.com/trade2/search/poe2/Test/abc', 'cn')).toBeNull()
    expect(parseOfficialSearchUrl('https://poe.game.qq.com/trade2/search/poe2/%ZZ/abc', 'cn')).toBeNull()
    expect(parseOfficialSearchUrl('https://poe.game.qq.com/trade2/search/poe2/Test/a.b', 'cn')).toBeNull()
  })

  it('explains why a generated official search reference was rejected', () => {
    expect(diagnoseOfficialSearchUrl(
      'https://www.pathofexile.com/trade2/search/poe2/Standard/a.b',
      'global',
    )).toEqual({
      ok: false,
      code: 'invalid-search-code',
      reason: 'the search ID contains unsupported characters (U+002E); allowed characters are A-Z, a-z, 0-9, _ and -',
    })
    expect(diagnoseOfficialSearchUrl(
      `https://www.pathofexile.com/trade2/search/poe2/Standard/${'A'.repeat(8_193)}`,
      'global',
    )).toMatchObject({ ok: false, code: 'invalid-search-code' })
  })

  it('sanitizes query snapshots and creates stable hashes', () => {
    const left = createSearchQuerySnapshot({ sort: { price: 'asc' }, query: { status: { option: 'online' }, token: 'secret' } }, 'superpoe-query')
    const right = createSearchQuerySnapshot({ query: { token: 'different', status: { option: 'online' } }, sort: { price: 'asc' } }, 'superpoe-query')
    expect(left.hash).toBe(right.hash)
    expect(left.body).toEqual({ sort: { price: 'asc' }, query: { status: { option: 'online' } } })
    expect(() => createSearchQuerySnapshot({ sort: {} }, 'official-page')).toThrow('Invalid official trade search query')
  })
})

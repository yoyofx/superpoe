import { describe, expect, it, vi } from 'vitest'
import { extractPobCode, parseWeGameShareCode, requestPoe2dbBuild } from '../../electron/poe2dbClient'

const SHARE_URL = 'https://www.wegame.com.cn/helper/poe2/#/share/hQv3y9do6ZTBff5aX1kJoqR_kqimMmdIOIpWImQYbzOycNC3ohszWhXdEFIDToL7'
const SHARE_CODE = 'hQv3y9do6ZTBff5aX1kJoqR_kqimMmdIOIpWImQYbzOycNC3ohszWhXdEFIDToL7'
const POB_CODE = 'eJzlXMuO5EZ23edXEAU0vOiUxAg-gtGQ='

describe('Electron PoE2DB import client', () => {
  it('extracts only a valid WeGame PoE2 share code', () => {
    expect(parseWeGameShareCode(SHARE_URL)).toBe(SHARE_CODE)
    expect(() => parseWeGameShareCode('https://example.com/#/share/' + SHARE_CODE)).toThrow('Only WeGame')
  })

  it('extracts the PoB code from the fixed PoE2DB result field', () => {
    expect(extractPobCode(`<input class="form-control" id="pobCode" value="${POB_CODE}" readonly>`)).toBe(POB_CODE)
  })

  it('uses only the PoE2DB conversion endpoint and returned build page', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: 200, location: 'qq_build?name=test-build' })))
      .mockResolvedValueOnce(new Response(`<input id="pobCode" value="${POB_CODE}">`))

    await expect(requestPoe2dbBuild(SHARE_CODE, fetchMock as typeof fetch)).resolves.toEqual({
      code: POB_CODE,
      sourceUrl: 'https://poe2db.tw/cn/qq_build?name=test-build',
    })
  })
})

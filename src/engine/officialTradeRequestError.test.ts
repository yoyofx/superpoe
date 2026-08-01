import { describe, expect, it } from 'vitest'
import { isGameOfflineVisitError, OfficialTradeRequestError } from '../../electron/officialTradeRequestError'

describe('official trade request errors', () => {
  it('recognizes a 400 response from the hideout visit request as game offline', () => {
    expect(isGameOfflineVisitError(new OfficialTradeRequestError(400))).toBe(true)
  })

  it('does not hide authentication or server failures behind the offline prompt', () => {
    expect(isGameOfflineVisitError(new OfficialTradeRequestError(401))).toBe(false)
    expect(isGameOfflineVisitError(new OfficialTradeRequestError(500))).toBe(false)
    expect(isGameOfflineVisitError(new Error('network failure'))).toBe(false)
  })
})

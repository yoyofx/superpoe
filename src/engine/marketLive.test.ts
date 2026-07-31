import { describe, expect, it } from 'vitest'
import { parseLiveListingIds, parseLiveResult } from '../../electron/marketLive'

describe('official Trade2 Live messages', () => {
  it('reads the current official count/result payload', () => {
    expect(parseLiveListingIds({ count: 3, result: ['listing-a', 'listing-b', 'listing-a'] }))
      .toEqual(['listing-a', 'listing-b'])
    expect(parseLiveResult({ count: 1, result: 'header.payload.signature' })).toEqual({
      listingIds: [], resultTokens: ['header.payload.signature'],
    })
  })

  it('keeps compatibility with new-list payloads and rejects malformed IDs', () => {
    expect(parseLiveListingIds({ new: ['valid_id', '../invalid', 42] })).toEqual(['valid_id'])
    expect(parseLiveListingIds({ auth: true })).toEqual([])
    expect(parseLiveListingIds({ count: 0, result: ['not-a-hit'] })).toEqual([])
  })
})

export class OfficialTradeRequestError extends Error {
  constructor(readonly status: number, readonly detail?: string) {
    const normalizedDetail = detail?.replace(/\s+/g, ' ').trim().slice(0, 240)
    const prefix = status === 429
      ? 'Official trade request was rate-limited. Please wait a moment and try again.'
      : `Official trade request failed (${status})`
    super(`${prefix}${normalizedDetail ? `: ${normalizedDetail}` : ''}`)
    this.name = 'OfficialTradeRequestError'
  }
}

export function isGameOfflineVisitError(error: unknown): boolean {
  return error instanceof OfficialTradeRequestError && error.status === 400
}

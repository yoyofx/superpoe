export class OfficialTradeRequestError extends Error {
  constructor(readonly status: number, readonly detail?: string) {
    const normalizedDetail = detail?.replace(/\s+/g, ' ').trim().slice(0, 240)
    super(`Official trade request failed (${status})${normalizedDetail ? `: ${normalizedDetail}` : ''}`)
    this.name = 'OfficialTradeRequestError'
  }
}

export function isGameOfflineVisitError(error: unknown): boolean {
  return error instanceof OfficialTradeRequestError && error.status === 400
}

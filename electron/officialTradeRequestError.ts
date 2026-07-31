export class OfficialTradeRequestError extends Error {
  constructor(readonly status: number) {
    super(`Official trade request failed (${status})`)
    this.name = 'OfficialTradeRequestError'
  }
}

export function isGameOfflineVisitError(error: unknown): boolean {
  return error instanceof OfficialTradeRequestError && error.status === 400
}

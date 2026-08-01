export interface Poe2dbImportResponse {
  code: string
  sourceUrl: string
}

export async function requestPoe2dbImport(wegameUrl: string): Promise<Poe2dbImportResponse> {
  if (!window.pob2Desktop) {
    throw new Error('WeGame share import is available only in the Electron desktop app')
  }
  return window.pob2Desktop.importWeGame(wegameUrl)
}

export function isPoe2dbDesktopImportAvailable(): boolean {
  return Boolean(window.pob2Desktop)
}

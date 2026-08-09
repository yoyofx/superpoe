export interface PoeNinjaImportResponse {
  code: string
  sourceUrl: string
  suggestedName: string
}

export async function requestPoeNinjaImport(url: string): Promise<PoeNinjaImportResponse> {
  if (!window.pob2Desktop) {
    throw new Error('poe.ninja import is available only in the Electron desktop app')
  }
  return window.pob2Desktop.importPoeNinja(url)
}

export function isPoeNinjaImportAvailable(): boolean {
  return Boolean(window.pob2Desktop)
}

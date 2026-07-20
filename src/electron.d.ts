export {}

declare global {
  interface Window {
    pob2Desktop?: {
      importWeGame(url: string): Promise<{ code: string; sourceUrl: string }>
    }
  }
}

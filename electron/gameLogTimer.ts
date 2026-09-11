import { promises as fs, watch, type FSWatcher, type Stats } from 'node:fs'
import path from 'node:path'
import { StringDecoder } from 'node:string_decoder'

const READ_CHUNK_SIZE = 64 * 1024
const POLL_INTERVAL_MS = 350
const GENERATING_FALLBACK_MS = 5_000

export type GameLogMapEvent = {
  type: 'map-start' | 'map-end'
  areaId: string
  sceneName?: string
}

type AreaState = {
  areaId: string
  sceneName?: string
}

type LineHandler = (line: string) => void

/**
 * Reads only bytes appended after the current end of Client.txt. PoE2 can
 * keep this file for a very long time, so startup must never scan its history.
 */
export class ClientLogTailer {
  private filePath?: string
  private fileHandle?: Awaited<ReturnType<typeof fs.open>>
  private fileSignature?: string
  private offset = 0
  private lineRemainder = ''
  private decoder = new StringDecoder('utf8')
  private watcher?: FSWatcher
  private pollTimer?: NodeJS.Timeout
  private reading = false
  private pollAgain = false

  constructor(private readonly onLine: LineHandler) {}

  setFilePath(filePath: string | undefined): void {
    const nextPath = filePath ? path.resolve(filePath) : undefined
    if (nextPath === this.filePath) return
    this.stop()
    this.filePath = nextPath
    if (!nextPath) return

    this.watchParent(nextPath)
    this.pollTimer = setInterval(() => { void this.poll() }, POLL_INTERVAL_MS)
    this.pollTimer.unref()
    void this.poll()
  }

  stop(): void {
    if (this.pollTimer) clearInterval(this.pollTimer)
    this.pollTimer = undefined
    this.watcher?.close()
    this.watcher = undefined
    void this.closeFile()
    this.filePath = undefined
    this.fileSignature = undefined
    this.offset = 0
    this.lineRemainder = ''
    this.decoder = new StringDecoder('utf8')
    this.reading = false
    this.pollAgain = false
  }

  private watchParent(filePath: string): void {
    try {
      this.watcher = watch(path.dirname(filePath), { persistent: false }, (_event, name) => {
        if (!name || name.toString() === path.basename(filePath)) void this.poll()
      })
      this.watcher.on('error', () => {
        // Polling remains the source of truth when fs.watch is unavailable.
      })
    } catch {
      // The directory may not exist yet. The polling loop will pick it up
      // after the game creates the installation or log directory.
    }
  }

  private async poll(): Promise<void> {
    if (!this.filePath) return
    if (this.reading) {
      this.pollAgain = true
      return
    }
    this.reading = true
    try {
      const stats = await fs.stat(this.filePath)
      const signature = this.signature(stats)
      if (this.fileSignature && signature !== this.fileSignature) {
        await this.reopenAtEnd(stats, signature)
      } else if (stats.size < this.offset) {
        // Client.txt was truncated or rotated in place. Start at its current
        // end so old entries are not replayed as a new map.
        await this.reopenAtEnd(stats, signature)
      } else {
        this.fileSignature = signature
        if (!this.fileHandle) {
          this.fileHandle = await fs.open(this.filePath, 'r')
          this.offset = stats.size
        } else {
          await this.readAppended(stats.size)
        }
      }
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') {
        // A transient sharing/rotation error is retried by the next poll.
      }
      await this.closeFile()
      this.fileSignature = undefined
    } finally {
      this.reading = false
      if (this.pollAgain) {
        this.pollAgain = false
        void this.poll()
      }
    }
  }

  private async readAppended(fileSize: number): Promise<void> {
    if (!this.fileHandle || !this.filePath) return
    while (this.offset < fileSize) {
      const length = Math.min(READ_CHUNK_SIZE, fileSize - this.offset)
      const buffer = Buffer.allocUnsafe(length)
      const result = await this.fileHandle.read(buffer, 0, length, this.offset)
      if (result.bytesRead <= 0) break
      this.offset += result.bytesRead
      this.consumeBytes(buffer.subarray(0, result.bytesRead))
      if (result.bytesRead < length) break
    }
  }

  private consumeBytes(bytes: Buffer): void {
    const text = this.lineRemainder + this.decoder.write(bytes)
    const lines = text.split(/\r?\n/u)
    this.lineRemainder = lines.pop() || ''
    for (const line of lines) this.onLine(line)
  }

  private async reopenAtEnd(stats: Stats, signature: string): Promise<void> {
    await this.closeFile()
    if (!this.filePath) return
    this.fileHandle = await fs.open(this.filePath, 'r')
    this.fileSignature = signature
    this.offset = stats.size
    this.lineRemainder = ''
    this.decoder = new StringDecoder('utf8')
  }

  private signature(stats: Stats): string {
    return `${stats.dev}:${stats.ino}`
  }

  private async closeFile(): Promise<void> {
    const handle = this.fileHandle
    this.fileHandle = undefined
    if (!handle) return
    try { await handle.close() } catch { /* The file may already be rotated. */ }
  }
}

/**
 * Converts the language-specific log lines into map transitions. Only the
 * internal area id is used for classification; scene names are informational.
 */
export class GameLogMapParser {
  private pendingArea?: AreaState
  private activeArea?: AreaState
  private fallbackTimer?: NodeJS.Timeout

  constructor(private readonly emit: (event: GameLogMapEvent) => void) {}

  processLine(line: string): void {
    const generatedArea = /Generating level\s+\d+\s+area\s+"([^"]+)"/iu.exec(line)?.[1]
    if (generatedArea) {
      this.clearFallback()
      if (this.activeArea) {
        this.emit({ type: 'map-end', ...this.activeArea })
        this.activeArea = undefined
      }
      this.pendingArea = generatedArea.startsWith('Map') ? { areaId: generatedArea } : undefined
      if (this.pendingArea) {
        this.fallbackTimer = setTimeout(() => this.activatePending(), GENERATING_FALLBACK_MS)
        this.fallbackTimer.unref()
      }
      return
    }

    const sceneName = /\[SCENE\]\s+Set Source\s+\[([^\]]*)\]/u.exec(line)?.[1]?.trim()
    if (sceneName) {
      if (this.pendingArea) this.pendingArea.sceneName = sceneName
      else if (this.activeArea) this.activeArea.sceneName = sceneName
    }

    if (/\[LOADING SCREEN\]/u.test(line)) this.activatePending()
    if (/Closing game gracefully/iu.test(line)) {
      this.clearFallback()
      this.pendingArea = undefined
      if (this.activeArea) {
        this.emit({ type: 'map-end', ...this.activeArea })
        this.activeArea = undefined
      }
    }
  }

  reset(): void {
    this.clearFallback()
    this.pendingArea = undefined
    this.activeArea = undefined
  }

  private activatePending(): void {
    this.clearFallback()
    const pending = this.pendingArea
    this.pendingArea = undefined
    if (!pending) return
    if (this.activeArea?.areaId === pending.areaId) return
    if (this.activeArea) this.emit({ type: 'map-end', ...this.activeArea })
    this.activeArea = pending
    this.emit({ type: 'map-start', ...pending })
  }

  private clearFallback(): void {
    if (this.fallbackTimer) clearTimeout(this.fallbackTimer)
    this.fallbackTimer = undefined
  }
}

export function clientLogPath(gameDirectory: string | undefined, executablePath?: string): string | undefined {
  const source = gameDirectory?.trim() || executablePath?.trim()
  if (!source) return undefined
  const root = /\.exe$/iu.test(source) ? path.dirname(source) : source
  return path.join(root, 'logs', 'Client.txt')
}

export class GameLogTimerController {
  private readonly parser: GameLogMapParser
  private readonly tailer: ClientLogTailer
  private realm: 'cn' | 'global' = 'global'
  private gameDirectory?: string
  private currentExecutablePath?: string
  private activeAreaId?: string
  private currentLogPath?: string

  constructor(private readonly onEvent: (event: GameLogMapEvent) => void) {
    this.parser = new GameLogMapParser((event) => this.handleEvent(event))
    this.tailer = new ClientLogTailer((line) => this.parser.processLine(line))
  }

  setContext(realm: 'cn' | 'global', gameDirectory: string | undefined, runningExecutablePath?: string): void {
    this.realm = realm
    this.gameDirectory = gameDirectory?.trim() || undefined
    this.currentExecutablePath = runningExecutablePath?.trim() || undefined
    this.refreshPath()
  }

  setRunningExecutablePath(executablePath: string | undefined): void {
    this.currentExecutablePath = executablePath?.trim() || undefined
    if (!this.gameDirectory) this.refreshPath()
  }

  dispose(): void {
    this.finishActiveArea()
    this.tailer.stop()
    this.parser.reset()
    this.currentLogPath = undefined
  }

  private refreshPath(): void {
    const nextPath = clientLogPath(this.gameDirectory, this.currentExecutablePath)
    if (nextPath === this.currentLogPath) return
    this.finishActiveArea()
    this.parser.reset()
    this.tailer.setFilePath(nextPath)
    this.currentLogPath = nextPath
  }

  private handleEvent(event: GameLogMapEvent): void {
    if (event.type === 'map-start') {
      if (this.activeAreaId === event.areaId) return
      this.finishActiveArea()
      this.activeAreaId = event.areaId
      this.onEvent(event)
      return
    }
    if (!this.activeAreaId) return
    if (event.areaId !== this.activeAreaId) return
    this.activeAreaId = undefined
    this.onEvent(event)
  }

  private finishActiveArea(): void {
    if (!this.activeAreaId) return
    const areaId = this.activeAreaId
    this.activeAreaId = undefined
    this.onEvent({ type: 'map-end', areaId })
  }
}

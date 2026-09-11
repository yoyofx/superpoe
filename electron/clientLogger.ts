import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'

export type ClientLogLevel = 'INFO' | 'WARN' | 'ERROR'

const MAX_LOG_FILE_BYTES = 5 * 1024 * 1024
const MAX_LOG_ENTRY_BYTES = 32 * 1024
const MAX_EXPORT_BYTES = 4 * 1024 * 1024
const MAX_EXPORT_EVENTS = 4_000
const RETENTION_DAYS = 14
const LOG_FILE_PATTERN = /^app-(\d{4}-\d{2}-\d{2})(?:-\d+)?\.jsonl$/
const SENSITIVE_KEY_PATTERN = /(?:password|cookie|authorization|poesessid|session|secret|token|raw|clipboard|xml)/i

function dayKey(date = new Date()): string {
  return date.toISOString().slice(0, 10)
}

function logFileName(date = new Date(), part?: number): string {
  return `app-${dayKey(date)}${part && part > 1 ? `-${part}` : ''}.jsonl`
}

function safeString(value: string): string {
  return value
    .replace(/POESESSID\s*[=:]\s*[^\s,;]+/gi, 'POESESSID=[redacted]')
    .replace(/(?:authorization|cookie|token|password)\s*[=:]\s*[^\s,;]+/gi, '$1=[redacted]')
}

function sanitize(value: unknown, key = '', depth = 0): unknown {
  if (key && SENSITIVE_KEY_PATTERN.test(key)) return '[redacted]'
  if (depth > 6) return '[depth-limited]'
  if (value == null || typeof value === 'boolean') return value
  if (typeof value === 'string') return safeString(value.slice(0, 4_000))
  if (typeof value === 'number') return Number.isFinite(value) ? value : '[invalid-number]'
  if (value instanceof Error) {
    return {
      name: safeString(value.name),
      message: safeString(value.message),
      ...(value.stack ? { stack: safeString(value.stack.slice(0, 8_000)) } : {}),
    }
  }
  if (Array.isArray(value)) return value.slice(0, 200).map((entry) => sanitize(entry, '', depth + 1))
  if (typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).slice(0, 200)
      .map(([entryKey, entryValue]) => [entryKey, sanitize(entryValue, entryKey, depth + 1)]))
  }
  return String(value)
}

function byteLength(value: string): number {
  return Buffer.byteLength(value, 'utf8')
}

export class ClientLogger {
  readonly directory: string

  constructor(directory: string) {
    this.directory = directory
    mkdirSync(directory, { recursive: true })
    this.removeExpiredFiles()
  }

  info(module: string, event: string, data?: unknown): void {
    this.write('INFO', module, event, data)
  }

  warn(module: string, event: string, data?: unknown): void {
    this.write('WARN', module, event, data)
  }

  error(module: string, event: string, data?: unknown): void {
    this.write('ERROR', module, event, data)
  }

  exportDiagnosticLog(destination: string, environment: Record<string, unknown>): void {
    const files = this.logFiles().sort()
    const events: unknown[] = []
    for (const file of files) {
      let lines: string[]
      try {
        lines = readFileSync(path.join(this.directory, file), 'utf8').split('\n')
      } catch {
        continue
      }
      for (const line of lines) {
        if (!line.trim()) continue
        try {
          events.push(JSON.parse(line))
        } catch {
          events.push({ level: 'ERROR', module: 'logger', event: 'unparseable-line' })
        }
      }
    }
    const recentEvents = events.slice(-MAX_EXPORT_EVENTS)
    const payload = JSON.stringify({
      format: 'superpoe-diagnostic-v1',
      exportedAt: new Date().toISOString(),
      environment: sanitize(environment),
      events: recentEvents,
    }, null, 2)
    if (byteLength(payload) > MAX_EXPORT_BYTES) {
      const compact = JSON.stringify({
        format: 'superpoe-diagnostic-v1',
        exportedAt: new Date().toISOString(),
        environment: sanitize(environment),
        events: recentEvents.slice(-500),
        truncated: true,
      }, null, 2)
      writeFileSync(destination, compact, 'utf8')
      return
    }
    writeFileSync(destination, payload, 'utf8')
  }

  private write(level: ClientLogLevel, module: string, event: string, data?: unknown): void {
    const base = {
      time: new Date().toISOString(),
      level,
      module: safeString(module.slice(0, 80)),
      event: safeString(event.slice(0, 120)),
      ...(data === undefined ? {} : { data: sanitize(data) }),
    }
    let line = JSON.stringify(base)
    if (byteLength(line) > MAX_LOG_ENTRY_BYTES) {
      line = JSON.stringify({ ...base, data: { truncated: true, originalBytes: byteLength(line) } })
    }
    const filePath = this.nextFilePath()
    try {
      appendFileSync(filePath, `${line}\n`, 'utf8')
    } catch {
      // Logging must never make the application operation fail.
    }
  }

  private nextFilePath(): string {
    const date = new Date()
    const first = path.join(this.directory, logFileName(date))
    try {
      if (!existsSync(first) || statSync(first).size < MAX_LOG_FILE_BYTES) return first
    } catch {
      return first
    }
    for (let part = 2; part <= 20; part += 1) {
      const candidate = path.join(this.directory, logFileName(date, part))
      try {
        if (!existsSync(candidate) || statSync(candidate).size < MAX_LOG_FILE_BYTES) return candidate
      } catch {
        return candidate
      }
    }
    return first
  }

  private logFiles(): string[] {
    try {
      return readdirSync(this.directory).filter((file) => LOG_FILE_PATTERN.test(file))
    } catch {
      return []
    }
  }

  private removeExpiredFiles(): void {
    const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1_000
    for (const file of this.logFiles()) {
      try {
        if (statSync(path.join(this.directory, file)).mtimeMs < cutoff) unlinkSync(path.join(this.directory, file))
      } catch {
        // Best-effort cleanup.
      }
    }
  }
}

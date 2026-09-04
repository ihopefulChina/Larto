import { appendFileSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'

type Level = 'debug' | 'info' | 'warn' | 'error'

const MAX_BYTES = 5 * 1024 * 1024
let logDir = ''
let logFile = ''

export function initLogger(): string {
  logDir = join(app.getPath('userData'), 'logs')
  mkdirSync(logDir, { recursive: true })
  logFile = join(logDir, 'main.log')
  return logDir
}

export function getLogDir(): string {
  return logDir
}

function rotateIfNeeded(): void {
  try {
    if (statSync(logFile).size > MAX_BYTES) {
      const previous = `${logFile}.1`
      // POSIX rename replaces the destination; Windows rename does not do so reliably.
      rmSync(previous, { force: true })
      renameSync(logFile, previous)
    }
  } catch {
    /* file does not exist yet */
  }
}

/**
 * When the parent process that spawned us (a test runner, an agent) exits, stdout/stderr
 * become broken pipes. Writing then raises EPIPE asynchronously; without this guard the
 * uncaughtException handler would log again and spin forever. Swallow stream errors and
 * stop mirroring to the console once a pipe is gone.
 */
let consoleBroken = false
for (const stream of [process.stdout, process.stderr]) {
  stream.on('error', () => {
    consoleBroken = true
  })
}

function write(level: Level, scope: string, args: unknown[]): void {
  const line = `${new Date().toISOString()} [${level.toUpperCase()}] [${scope}] ${args
    .map((a) =>
      a instanceof Error
        ? `${a.message}\n${a.stack ?? ''}`
        : typeof a === 'string'
          ? a
          : safeJson(a)
    )
    .join(' ')}\n`
  if (!consoleBroken) {
    try {
      if (level === 'error') console.error(line.trimEnd())
      else if (!app.isPackaged) console.log(line.trimEnd())
    } catch {
      consoleBroken = true
    }
  }
  if (!logFile) return
  try {
    rotateIfNeeded()
    appendFileSync(logFile, line)
  } catch {
    /* never throw from logger */
  }
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

export function createLogger(scope: string) {
  return {
    debug: (...args: unknown[]) => write('debug', scope, args),
    info: (...args: unknown[]) => write('info', scope, args),
    warn: (...args: unknown[]) => write('warn', scope, args),
    error: (...args: unknown[]) => write('error', scope, args)
  }
}

export type Logger = ReturnType<typeof createLogger>

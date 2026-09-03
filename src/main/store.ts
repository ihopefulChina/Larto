import { EventEmitter } from 'node:events'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { app } from 'electron'
import type { z } from 'zod'
import { MAX_URL_HISTORY, type Settings, type WritableSettingKey } from '@shared/settings'
import { SettingsSchema } from './settings-schema'
import { createLogger } from './logger'

const log = createLogger('store')

/**
 * Minimal JSON file store with atomic writes and schema validation.
 * Intentionally dependency-free (electron-store v11 is ESM-only and heavy).
 */
export class JsonStore<T> {
  private value: T

  constructor(
    private readonly file: string,
    private readonly schema: z.ZodType<T>
  ) {
    this.value = this.read()
  }

  private read(): T {
    let raw: unknown = {}
    try {
      raw = JSON.parse(readFileSync(this.file, 'utf8'))
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') log.warn(`unreadable ${this.file}`, err)
    }
    const parsed = this.schema.safeParse(raw)
    if (parsed.success) return parsed.data
    log.warn(`invalid ${this.file}, falling back to defaults`, parsed.error.message)
    // Fall back to defaults but keep unknown-but-valid keys where possible.
    return this.schema.parse({})
  }

  get(): T {
    return this.value
  }

  set(next: T): void {
    this.value = this.schema.parse(next)
    mkdirSync(dirname(this.file), { recursive: true })
    const tmp = `${this.file}.${process.pid}.tmp`
    writeFileSync(tmp, JSON.stringify(this.value, null, 2))
    renameSync(tmp, this.file)
  }
}

export interface SettingsStoreEvents {
  change: [settings: Settings, changedKeys: (keyof Settings)[]]
}

export class SettingsStore extends EventEmitter<SettingsStoreEvents> {
  private readonly store: JsonStore<Settings>

  constructor(file = join(app.getPath('userData'), 'settings.json')) {
    super()
    this.store = new JsonStore(file, SettingsSchema)
  }

  get(): Settings {
    return this.store.get()
  }

  patch(patch: Partial<Settings>): Settings {
    const prev = this.store.get()
    const next = { ...prev, ...patch }
    const changed = (Object.keys(patch) as (keyof Settings)[]).filter(
      (k) => JSON.stringify(prev[k]) !== JSON.stringify(next[k])
    )
    if (changed.length === 0) return prev
    this.store.set(next)
    this.emit('change', this.store.get(), changed)
    return this.store.get()
  }

  /** Renderer-facing setter restricted to whitelisted keys. */
  patchWritable(patch: Partial<Pick<Settings, WritableSettingKey>>): Settings {
    return this.patch(patch)
  }

  pushHistory(url: string): string[] {
    const history = [url, ...this.get().urlHistory.filter((u) => u !== url)].slice(
      0,
      MAX_URL_HISTORY
    )
    this.patch({ urlHistory: history, lastUrl: url })
    return history
  }

  clearHistory(): string[] {
    this.patch({ urlHistory: [] })
    return []
  }
}

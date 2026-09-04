import { EventEmitter } from 'node:events'
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { app } from 'electron'
import type { z } from 'zod'
import {
  MAX_URL_HISTORY,
  WritableSettingKeys,
  type Settings,
  type WritableSettingKey
} from '@shared/settings'
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
    let result = this.schema.safeParse(raw)
    if (result.success) return result.data
    log.warn(`invalid ${this.file}, dropping offending keys`, result.error.message)
    // Drop only the offending top-level keys (they get their defaults) instead of resetting
    // every setting because of one bad field.
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      const salvaged: Record<string, unknown> = { ...(raw as Record<string, unknown>) }
      while (!result.success) {
        const keys = result.error.issues
          .map((issue) => issue.path[0])
          .filter((k): k is string => typeof k === 'string' && k in salvaged)
        if (keys.length === 0) break
        for (const k of keys) delete salvaged[k]
        result = this.schema.safeParse(salvaged)
      }
      if (result.success) return result.data
    }
    return this.schema.parse({})
  }

  get(): T {
    return this.value
  }

  set(next: T): void {
    const validated = this.schema.parse(next)
    mkdirSync(dirname(this.file), { recursive: true })
    const tmp = `${this.file}.${process.pid}.tmp`
    try {
      writeFileSync(tmp, JSON.stringify(validated, null, 2))
      renameSync(tmp, this.file)
    } catch (err) {
      // A failed disk commit must not make callers observe settings that cannot survive restart.
      // Also remove the best-effort temporary file so a partial write is never mistaken for state.
      try {
        rmSync(tmp, { force: true })
      } catch {
        /* preserve the original storage error */
      }
      throw err
    }
    this.value = validated
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

  /** Renderer-facing setter restricted to whitelisted keys (enforced, not just typed). */
  patchWritable(patch: Partial<Pick<Settings, WritableSettingKey>>): Settings {
    const allowed: Partial<Settings> = {}
    for (const key of WritableSettingKeys) {
      if (key in patch) (allowed as Record<string, unknown>)[key] = patch[key]
    }
    return this.patch(allowed)
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

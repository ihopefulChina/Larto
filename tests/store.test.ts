import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => tmpdir() } }))

const { JsonStore, SettingsStore } = await import('../src/main/store')
const { SettingsSchema } = await import('../src/main/settings-schema')
const { DEFAULT_SETTINGS } = await import('../src/shared/settings')

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'fdt-store-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('JsonStore', () => {
  it('applies defaults when the file is missing', () => {
    const store = new JsonStore(join(dir, 'settings.json'), SettingsSchema)
    expect(store.get()).toEqual(DEFAULT_SETTINGS)
    expect(store.get().deviceId).toBe('iphone-17-pro')
  })

  it('preserves an existing device choice and window bounds', () => {
    const file = join(dir, 'settings.json')
    const windowBounds = { x: 20, y: 30, width: 1180, height: 845 }
    writeFileSync(file, JSON.stringify({ version: 1, deviceId: 'iphone-13', windowBounds }))
    const store = new JsonStore(file, SettingsSchema)
    expect(store.get().deviceId).toBe('iphone-13')
    expect(store.get().windowBounds).toEqual(windowBounds)
  })

  it('keeps valid keys when one field is invalid', () => {
    const file = join(dir, 'settings.json')
    writeFileSync(
      file,
      JSON.stringify({
        version: 1,
        theme: 'dark',
        deviceId: 'nexus-5',
        zoom: 'huge', // invalid
        mcp: { enabled: true, port: 80 } // port below 1024 → invalid
      })
    )
    const store = new JsonStore(join(dir, 'settings.json'), SettingsSchema)
    const s = store.get()
    expect(s.theme).toBe('dark')
    expect(s.deviceId).toBe('nexus-5')
    expect(s.zoom).toBe(DEFAULT_SETTINGS.zoom)
    expect(s.mcp).toEqual(DEFAULT_SETTINGS.mcp)
  })

  it('does not restore a persisted manual proxy without an address', () => {
    const file = join(dir, 'settings.json')
    writeFileSync(
      file,
      JSON.stringify({ version: 1, proxy: { mode: 'manual', url: ' ', bypass: '<local>' } })
    )
    const store = new JsonStore(file, SettingsSchema)
    expect(store.get().proxy).toEqual(DEFAULT_SETTINGS.proxy)
  })

  it('falls back to defaults for non-object content', () => {
    const file = join(dir, 'settings.json')
    writeFileSync(file, '[1,2,3]')
    const store = new JsonStore(file, SettingsSchema)
    expect(store.get()).toEqual(DEFAULT_SETTINGS)
  })

  it('writes atomically and re-validates', () => {
    const file = join(dir, 'settings.json')
    const store = new JsonStore(file, SettingsSchema)
    store.set({ ...store.get(), theme: 'light' })
    expect(JSON.parse(readFileSync(file, 'utf8')).theme).toBe('light')
  })

  it('keeps the last committed value when the atomic rename fails', () => {
    const file = join(dir, 'settings.json')
    writeFileSync(file, JSON.stringify({ version: 1, theme: 'dark' }))
    const store = new JsonStore(file, SettingsSchema)
    const committed = store.get()
    rmSync(file)
    mkdirSync(file)

    expect(() => store.set({ ...committed, theme: 'light' })).toThrow()
    expect(store.get()).toEqual(committed)
    expect(readdirSync(dir)).toEqual(['settings.json'])
  })
})

describe('SettingsStore', () => {
  it('pushHistory dedupes, caps and updates lastUrl', () => {
    const store = new SettingsStore(join(dir, 'settings.json'))
    for (let i = 0; i < 12; i++) store.pushHistory(`https://example.com/${i}`)
    store.pushHistory('https://example.com/11')
    const s = store.get()
    expect(s.urlHistory).toHaveLength(10)
    expect(s.urlHistory[0]).toBe('https://example.com/11')
    expect(new Set(s.urlHistory).size).toBe(10)
    expect(s.lastUrl).toBe('https://example.com/11')
  })

  it('patchWritable drops keys outside the renderer whitelist', () => {
    const store = new SettingsStore(join(dir, 'settings.json'))
    store.pushHistory('https://example.com/kept')
    const next = store.patchWritable({
      theme: 'dark',
      urlHistory: [],
      windowBounds: { x: 0, y: 0, width: 1, height: 1 }
    } as never)
    expect(next.theme).toBe('dark')
    expect(next.urlHistory).toEqual(['https://example.com/kept'])
    expect(next.windowBounds).toEqual(DEFAULT_SETTINGS.windowBounds)
  })

  it('emits change only for keys whose value differs', () => {
    const store = new SettingsStore(join(dir, 'settings.json'))
    const changes: string[][] = []
    store.on('change', (_s, keys) => changes.push(keys))
    store.patch({ theme: DEFAULT_SETTINGS.theme })
    store.patch({
      theme: DEFAULT_SETTINGS.theme === 'dark' ? 'light' : 'dark',
      zoom: DEFAULT_SETTINGS.zoom
    })
    expect(changes).toEqual([['theme']])
  })

  it('does not publish or retain a patch that fails to reach disk', () => {
    const file = join(dir, 'settings.json')
    writeFileSync(file, JSON.stringify({ version: 1, theme: 'dark' }))
    const store = new SettingsStore(file)
    const committed = store.get()
    const onChange = vi.fn()
    store.on('change', onChange)
    rmSync(file)
    mkdirSync(file)

    expect(() => store.patch({ theme: 'light' })).toThrow()
    expect(store.get()).toEqual(committed)
    expect(onChange).not.toHaveBeenCalled()
  })
})

import { describe, expect, it, vi } from 'vitest'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { findDevice } from '../src/shared/devices'

vi.mock('electron', () => ({
  app: {},
  BrowserWindow: class {},
  nativeTheme: {
    themeSource: 'dark',
    shouldUseDarkColors: true,
    on: vi.fn(),
    off: vi.fn()
  },
  screen: {},
  shell: {}
}))

const { isTrustedShellUrl, sizeForDevice } = await import('../src/main/window')

describe('sizeForDevice', () => {
  const area = { x: 0, y: 0, width: 2000, height: 1400 }

  it('adds native frame insets to preserve the intended content area', () => {
    const device = findDevice('iphone-17-pro')
    const frameless = sizeForDevice(device, 75, area)
    const framed = sizeForDevice(device, 75, area, { width: 16, height: 54 })
    expect(framed).toEqual({ width: frameless.width + 16, height: frameless.height + 54 })
  })

  it('clamps the complete outer window to the display work area', () => {
    const area = { x: 0, y: 0, width: 1000, height: 700 }
    const framed = sizeForDevice(findDevice('ipad-pro'), 100, area, {
      width: 16,
      height: 54
    })
    expect(framed).toEqual({ width: 1000, height: 700 })
  })
})

describe('trusted shell URL', () => {
  const shellFile = resolve('fixtures', 'app.asar', 'out', 'renderer', 'index.html')

  it('allows only the packaged renderer file when no dev server is configured', () => {
    expect(isTrustedShellUrl(pathToFileURL(shellFile).href, undefined, shellFile)).toBe(true)
    expect(isTrustedShellUrl('file:///tmp/untrusted.html', undefined, shellFile)).toBe(false)
    expect(isTrustedShellUrl('https://example.com/', undefined, shellFile)).toBe(false)
  })

  it('matches a development origin instead of a string prefix', () => {
    const dev = 'http://127.0.0.1:5173/'
    expect(isTrustedShellUrl('http://127.0.0.1:5173/settings', dev, shellFile)).toBe(true)
    expect(isTrustedShellUrl('http://127.0.0.1:51730/', dev, shellFile)).toBe(false)
    expect(isTrustedShellUrl('http://127.0.0.1:5173.attacker.example/', dev, shellFile)).toBe(false)
    expect(isTrustedShellUrl('blob:http://127.0.0.1:5173/untrusted', dev, shellFile)).toBe(false)
  })
})

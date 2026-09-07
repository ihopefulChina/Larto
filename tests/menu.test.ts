import { describe, expect, it, vi } from 'vitest'
import type { MenuItemConstructorOptions } from 'electron'
import { DEFAULT_SETTINGS } from '../src/shared/settings'

vi.mock('electron', () => ({
  app: { name: 'Larto' },
  clipboard: { writeText: vi.fn() },
  dialog: { showMessageBox: vi.fn() },
  Menu: { buildFromTemplate: vi.fn(), setApplicationMenu: vi.fn() },
  shell: { openExternal: vi.fn(), openPath: vi.fn() },
  BrowserWindow: class {},
  screen: {}
}))

const { createMenuTemplate } = await import('../src/main/menu')

function makeDeps() {
  return {
    settings: {
      get: () => DEFAULT_SETTINGS,
      patch: vi.fn()
    },
    updater: { check: vi.fn().mockResolvedValue({ status: 'notAvailable' }) },
    getLang: () => 'en-US' as const,
    sendCommand: vi.fn(),
    diagnostics: () => 'diagnostics'
  }
}

function items(value: MenuItemConstructorOptions['submenu']): MenuItemConstructorOptions[] {
  return Array.isArray(value) ? value : []
}

function collectAccelerators(menu: MenuItemConstructorOptions[]): string[] {
  return menu.flatMap((item) => [
    ...(item.accelerator ? [String(item.accelerator)] : []),
    ...collectAccelerators(items(item.submenu))
  ])
}

describe('native application menu', () => {
  it('keeps macOS-only system roles out of Windows and Linux menus', () => {
    const mac = createMenuTemplate(makeDeps() as never, 'darwin')
    const windows = createMenuTemplate(makeDeps() as never, 'win32')
    const linux = createMenuTemplate(makeDeps() as never, 'linux')

    const macRoles = items(mac[0]?.submenu).map((item) => item.role)
    expect(macRoles).toEqual(expect.arrayContaining(['services', 'hide', 'hideOthers', 'unhide']))
    for (const menu of [windows, linux]) {
      const roles = items(menu[0]?.submenu).map((item) => item.role)
      expect(roles).not.toEqual(
        expect.arrayContaining(['services', 'hide', 'hideOthers', 'unhide'])
      )
      const help = menu.at(-1)
      expect(items(help?.submenu)[0]?.label).toBe('About Larto')
    }
  })

  it('uses CommandOrControl accelerators on every platform', () => {
    for (const platform of ['darwin', 'win32', 'linux'] as const) {
      const accelerators = collectAccelerators(createMenuTemplate(makeDeps() as never, platform))
      expect(accelerators).toContain('CmdOrCtrl+R')
      expect(accelerators.every((value) => !/(^|\+)Cmd\+/.test(value))).toBe(true)
    }
  })
})

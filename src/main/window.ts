import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { app, BrowserWindow, screen, shell } from 'electron'
import { findDevice, type DeviceSpec } from '@shared/devices'
import type { IpcEventChannel, IpcEvents } from '@shared/ipc'
import type { SettingsStore } from './store'
import { resolveTheme, windowBackgroundColor } from './theme'
import { createLogger } from './logger'

const log = createLogger('window')

/** Official content proportions; macOS additionally uses the hidden-inset title bar from §2. */
export const DEFAULT_WINDOW = { width: 1180, height: 845, minWidth: 909, minHeight: 640 }

/**
 * Shell chrome around the simulated device, in CSS px (app.css, border-box): title bar 40,
 * address bar 40, simulator padding 18px above/below, controls 36 and status 24. The column is the
 * scaled device width + 32 (16px breathing room per side, min 410) and DevTools needs 300.
 */
const FRAME_CHROME_H = 40 + 40 + 18 + 18 + 36 + 24
const SIMULATOR_COLUMN_MIN_W = 410
const SIMULATOR_COLUMN_PAD_W = 32
const DEVTOOLS_MIN_W = 300

export interface NativeFrameSize {
  width: number
  height: number
}

let mainWindow: BrowserWindow | null = null
export const SHELL_ENTRY_FILE = join(import.meta.dirname, '../renderer/index.html')

export function getMainWindow(): BrowserWindow | null {
  return mainWindow && !mainWindow.isDestroyed() ? mainWindow : null
}

/**
 * Window size at which the simulated device is fully visible next to a DevTools column,
 * clamped to the work area. PC presets fill whatever column they get, so they keep the default.
 */
export function sizeForDevice(
  device: DeviceSpec,
  zoom: number,
  area: Electron.Rectangle,
  frame: NativeFrameSize = { width: 0, height: 0 }
): { width: number; height: number } {
  const framed = (width: number, height: number) => ({
    width: Math.min(width + frame.width, area.width),
    height: Math.min(height + frame.height, area.height)
  })
  if (device.platform === 'pc') {
    return framed(DEFAULT_WINDOW.width, DEFAULT_WINDOW.height)
  }
  const scale = zoom / 100
  const column = Math.max(
    SIMULATOR_COLUMN_MIN_W,
    Math.ceil(device.width * scale) + SIMULATOR_COLUMN_PAD_W
  )
  return framed(
    Math.max(DEFAULT_WINDOW.width, column + DEVTOOLS_MIN_W),
    Math.max(DEFAULT_WINDOW.minHeight, FRAME_CHROME_H + Math.ceil(device.height * scale))
  )
}

function nativeFrameSize(win: BrowserWindow): NativeFrameSize {
  const outer = win.getBounds()
  const content = win.getContentBounds()
  return {
    width: Math.max(0, outer.width - content.width),
    height: Math.max(0, outer.height - content.height)
  }
}

/**
 * Official rule (`setBrowserOptions`): the window's minimum width follows the simulated
 * device, `deviceWidth + 70 + 387 + 100`, so the frame and the DevTools column always fit.
 * On top of that the window grows (never shrinks) until the whole device at the current zoom
 * is visible, so switching to a taller preset or zooming in does not leave the frame cut off.
 * Everything is clamped to the current display so large presets (iPad Pro) stay on screen.
 */
export function fitWindowToDevice(device: DeviceSpec, zoom: number): void {
  const win = getMainWindow()
  if (!win) return
  const area = screen.getDisplayMatching(win.getBounds()).workArea
  // macOS hiddenInset is effectively frameless. Native Windows/Linux title/menu bars reduce the
  // content area, so size the *outer* window by that measured inset. We keep persisting outer
  // bounds; unlike `useContentSize`, this therefore cannot add the frame again on every launch.
  const frame = nativeFrameSize(win)
  const isPc = device.platform === 'pc'
  const wantedMin = isPc ? DEFAULT_WINDOW.minWidth : device.width + 70 + 387 + 100
  const minWidth = Math.min(
    Math.max(DEFAULT_WINDOW.minWidth + frame.width, wantedMin + frame.width),
    area.width
  )
  const minHeight = Math.min(DEFAULT_WINDOW.minHeight + frame.height, area.height)
  win.setMinimumSize(minWidth, minHeight)
  if (win.isFullScreen() || win.isMaximized()) return
  const bounds = win.getBounds()
  const wanted = sizeForDevice(device, zoom, area, frame)
  const width = Math.max(bounds.width, minWidth, isPc ? 0 : wanted.width)
  const height = isPc ? bounds.height : Math.max(bounds.height, wanted.height)
  if (width === bounds.width && height === bounds.height) return
  const x = Math.max(area.x, Math.min(bounds.x, area.x + area.width - width))
  const y = Math.max(area.y, Math.min(bounds.y, area.y + area.height - height))
  win.setBounds({ x, y, width, height }, true)
}

export function sendToRenderer<C extends IpcEventChannel>(channel: C, payload: IpcEvents[C]): void {
  const win = getMainWindow()
  if (win) win.webContents.send(channel, payload)
}

export function createMainWindow(settings: SettingsStore): BrowserWindow {
  const existing = getMainWindow()
  if (existing) {
    existing.show()
    existing.focus()
    return existing
  }

  const bounds = restoreBounds(settings)
  const { dark } = resolveTheme()

  const nativeChrome =
    process.platform === 'darwin'
      ? ({
          titleBarStyle: 'hiddenInset',
          trafficLightPosition: { x: 12, y: 14 }
        } as const)
      : {}

  const win = new BrowserWindow({
    ...bounds,
    ...nativeChrome,
    minWidth: DEFAULT_WINDOW.minWidth,
    minHeight: DEFAULT_WINDOW.minHeight,
    show: false,
    title: 'FeishuDevTools',
    backgroundColor: windowBackgroundColor(dark),
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/shell.cjs'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
      spellcheck: false
    }
  })
  mainWindow = win

  win.once('ready-to-show', () => win.show())
  win.on('close', () => persistBounds(win, settings))
  win.on('closed', () => {
    mainWindow = null
  })

  // The shell renderer never opens new windows; external links go to the OS browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  const guardShellNavigation = (event: Electron.Event, url: string) => {
    if (!isCurrentShellUrl(url)) {
      event.preventDefault()
      log.warn('blocked shell navigation', url)
    }
  }
  win.webContents.on('will-navigate', guardShellNavigation)
  win.webContents.on('will-redirect', guardShellNavigation)

  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void win.loadFile(SHELL_ENTRY_FILE)
  }
  return win
}

export function isTrustedShellUrl(
  url: string,
  devUrl?: string,
  shellFile = SHELL_ENTRY_FILE
): boolean {
  try {
    const candidate = new URL(url)
    if (devUrl) {
      const dev = new URL(devUrl)
      return (
        (dev.protocol === 'http:' || dev.protocol === 'https:') &&
        candidate.protocol === dev.protocol &&
        candidate.origin === dev.origin
      )
    }
    return candidate.protocol === 'file:' && fileURLToPath(candidate) === shellFile
  } catch {
    return false
  }
}

export function isCurrentShellUrl(url: string): boolean {
  const devUrl = !app.isPackaged ? process.env['ELECTRON_RENDERER_URL'] : undefined
  return isTrustedShellUrl(url, devUrl)
}

function restoreBounds(settings: SettingsStore) {
  const { windowBounds: saved, deviceId, zoom } = settings.get()
  // First launch: size the window so the default device is fully visible (centred by Electron).
  if (!saved) return sizeForDevice(findDevice(deviceId), zoom, screen.getPrimaryDisplay().workArea)
  const display = screen.getDisplayMatching(saved)
  const { x, y, width, height } = display.workArea
  const fits =
    saved.x >= x - 20 &&
    saved.y >= y - 20 &&
    saved.x + saved.width <= x + width + 20 &&
    saved.y + saved.height <= y + height + 20
  return fits
    ? saved
    : { width: Math.min(saved.width, width), height: Math.min(saved.height, height) }
}

function persistBounds(win: BrowserWindow, settings: SettingsStore): void {
  if (win.isMinimized() || win.isFullScreen()) return
  settings.patch({ windowBounds: win.getNormalBounds() })
}

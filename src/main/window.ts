import { join } from 'node:path'
import { app, BrowserWindow, screen, shell } from 'electron'
import type { IpcEventChannel, IpcEvents } from '@shared/ipc'
import type { SettingsStore } from './store'
import { resolveTheme, windowBackgroundColor } from './theme'
import { createLogger } from './logger'

const log = createLogger('window')

/** Official window: 909×845 with hiddenInset title bar (docs/RESEARCH_OFFICIAL_TOOL.md §2). */
export const DEFAULT_WINDOW = { width: 1180, height: 845, minWidth: 909, minHeight: 640 }

let mainWindow: BrowserWindow | null = null

export function getMainWindow(): BrowserWindow | null {
  return mainWindow && !mainWindow.isDestroyed() ? mainWindow : null
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

  const win = new BrowserWindow({
    ...bounds,
    minWidth: DEFAULT_WINDOW.minWidth,
    minHeight: DEFAULT_WINDOW.minHeight,
    show: false,
    title: 'FeishuDevTools',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 12, y: 14 },
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
  win.webContents.on('will-navigate', (event, url) => {
    if (!isShellUrl(url)) {
      event.preventDefault()
      log.warn('blocked shell navigation', url)
    }
  })

  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void win.loadFile(join(import.meta.dirname, '../renderer/index.html'))
  }
  return win
}

function isShellUrl(url: string): boolean {
  const dev = process.env['ELECTRON_RENDERER_URL']
  return url.startsWith('file:') || (!!dev && url.startsWith(dev))
}

function restoreBounds(settings: SettingsStore) {
  const saved = settings.get().windowBounds
  if (!saved) return { width: DEFAULT_WINDOW.width, height: DEFAULT_WINDOW.height }
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

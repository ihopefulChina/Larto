import { join } from 'node:path'
import { EventEmitter } from 'node:events'
import { app, session, webContents, type WebContents, type WebPreferences } from 'electron'
import { findDevice, type DeviceSpec } from '@shared/devices'
import { GUEST_PARTITION } from '@shared/constants'
import { createLogger } from './logger'

const log = createLogger('guest')

export interface ConsoleEntry {
  ts: number
  level: 'verbose' | 'info' | 'warning' | 'error'
  message: string
  source: string
  line: number
}

export interface GuestEvents {
  navigated: [url: string]
  title: [title: string]
  console: [entry: ConsoleEntry]
  loadFailed: [info: { url: string; code: number; description: string }]
  attached: [contents: WebContents]
  detached: []
}

const CONSOLE_LIMIT = 500
const GUEST_PRELOAD = join(import.meta.dirname, '../preload/guest.cjs')

/**
 * Tracks the single H5 <webview> (the "guest") hosted by the shell renderer and
 * applies host policy to it: preload enforcement, popups, device emulation,
 * DevTools docking, cache clearing and diagnostics for MCP.
 */
class GuestManager extends EventEmitter<GuestEvents> {
  private guest: WebContents | null = null
  private device: DeviceSpec = findDevice(undefined)
  private viewport: { width: number; height: number } | null = null
  private readonly consoleBuffer: ConsoleEntry[] = []
  private lastUrl = ''
  private lastTitle = ''

  installGlobalHooks(): void {
    app.on('web-contents-created', (_event, contents) => {
      if (contents.getType() !== 'webview') return
      // Every webview inherits the same popup policy as the official tool:
      // window.open()/target=_blank navigate the same webview instead of spawning windows.
      contents.setWindowOpenHandler(({ url }) => {
        if (/^(https?|about|data|blob):/i.test(url)) void contents.loadURL(url)
        return { action: 'deny' }
      })
    })

    // Development servers often use self-signed certificates on localhost.
    app.on('certificate-error', (event, contents, url, error, _cert, callback) => {
      const host = safeHost(url)
      const trusted = contents.getType() === 'webview' && isPrivateHost(host)
      if (trusted) {
        log.warn(`ignoring certificate error for ${host}: ${error}`)
        event.preventDefault()
        callback(true)
      } else {
        callback(false)
      }
    })

    const guestSession = session.fromPartition(GUEST_PARTITION)
    guestSession.setPermissionRequestHandler((_wc, permission, callback) => {
      const allowed = new Set([
        'clipboard-read',
        'clipboard-sanitized-write',
        'media',
        'geolocation',
        'notifications',
        'fullscreen',
        'pointerLock'
      ])
      callback(allowed.has(permission))
    })
  }

  /** Called from the main window's `will-attach-webview`; hardens every webview the renderer creates. */
  hardenWebPreferences(
    prefs: WebPreferences & { preloadURL?: string },
    params: Record<string, string>
  ): void {
    delete prefs.preloadURL
    const wantsGuestPreload = params['preload'] !== undefined || prefs.preload !== undefined
    if (wantsGuestPreload) prefs.preload = GUEST_PRELOAD
    prefs.nodeIntegration = false
    prefs.nodeIntegrationInSubFrames = false
    prefs.contextIsolation = true
    prefs.sandbox = true
    prefs.webSecurity = true
    prefs.allowRunningInsecureContent = false
    prefs.experimentalFeatures = false
  }

  get guestPreloadPath(): string {
    return GUEST_PRELOAD
  }

  attach(webContentsId: number): void {
    const contents = webContents.fromId(webContentsId)
    if (!contents) throw new Error(`webContents ${webContentsId} not found`)
    if (this.guest === contents) return
    this.detach()
    this.guest = contents
    this.consoleBuffer.length = 0

    contents.on('did-navigate', (_e, url) => this.setUrl(url))
    contents.on('did-navigate-in-page', (_e, url) => this.setUrl(url))
    contents.on('page-title-updated', (_e, title) => {
      this.lastTitle = title
      this.emit('title', title)
    })
    contents.on('console-message', (event) => {
      const entry: ConsoleEntry = {
        ts: Date.now(),
        level: normaliseLevel(event.level),
        message: event.message,
        source: event.sourceId,
        line: event.lineNumber
      }
      this.consoleBuffer.push(entry)
      if (this.consoleBuffer.length > CONSOLE_LIMIT) this.consoleBuffer.shift()
      this.emit('console', entry)
    })
    contents.on('did-fail-load', (_e, code, description, url, isMainFrame) => {
      if (isMainFrame && code !== -3) this.emit('loadFailed', { url, code, description })
    })
    contents.on('render-process-gone', (_e, details) => log.error('guest renderer gone', details))
    contents.on('destroyed', () => {
      if (this.guest === contents) this.detach()
    })

    void this.applyEmulation(contents, this.device)
    this.emit('attached', contents)
    log.info(`guest attached: wc#${webContentsId}`)
  }

  private detach(): void {
    if (!this.guest) return
    this.guest = null
    this.emit('detached')
  }

  private setUrl(url: string): void {
    this.lastUrl = url
    this.emit('navigated', url)
  }

  get contents(): WebContents | null {
    return this.guest && !this.guest.isDestroyed() ? this.guest : null
  }

  get currentDevice(): DeviceSpec {
    return this.device
  }

  get state() {
    return {
      attached: !!this.contents,
      url: this.contents?.getURL() ?? this.lastUrl,
      title: this.contents?.getTitle() ?? this.lastTitle,
      loading: this.contents?.isLoading() ?? false,
      canGoBack: this.contents?.navigationHistory.canGoBack() ?? false,
      deviceId: this.device.id
    }
  }

  async setDevice(
    webContentsId: number,
    deviceId: string,
    viewport?: { width: number; height: number }
  ): Promise<void> {
    this.device = findDevice(deviceId)
    this.viewport = viewport ?? null
    const contents = webContents.fromId(webContentsId)
    if (contents) await this.applyEmulation(contents, this.device)
  }

  /**
   * Device emulation through CDP. `webContents.enableDeviceEmulation` has no effect on
   * <webview> guests (verified on Electron 44), so we drive Emulation.* directly. For mobile
   * presets the viewport is pinned to the <webview> CSS size supplied by the renderer (0 = use the
   * element size, which reports 0×0 to scripts that run before the guest's first layout); DPR,
   * `mobile`, screen size and touch emulation come from the preset. Overrides survive navigations.
   */
  private async applyEmulation(contents: WebContents, device: DeviceSpec): Promise<void> {
    if (process.env['FDT_NO_EMULATION']) return
    const dbg = contents.debugger
    try {
      if (!dbg.isAttached()) {
        dbg.attach('1.3')
        dbg.on('detach', (_e, reason) => log.warn(`guest debugger detached: ${reason}`))
      }
      const mobile = device.platform !== 'pc'
      await dbg.sendCommand('Emulation.setDeviceMetricsOverride', {
        width: mobile && this.viewport ? this.viewport.width : 0,
        height: mobile && this.viewport ? this.viewport.height : 0,
        deviceScaleFactor: device.dpr,
        mobile,
        screenWidth: device.width,
        screenHeight: device.height,
        positionX: 0,
        positionY: 0
      })
      await dbg.sendCommand('Emulation.setTouchEmulationEnabled', {
        enabled: mobile,
        maxTouchPoints: 5
      })
      await dbg.sendCommand('Emulation.setEmitTouchEventsForMouse', {
        enabled: mobile,
        configuration: mobile ? 'mobile' : 'desktop'
      })
    } catch (err) {
      log.warn('device emulation failed', err)
    }
  }

  async clearCache(webContentsId: number): Promise<void> {
    const contents = webContents.fromId(webContentsId)
    const ses = contents?.session ?? session.fromPartition(GUEST_PARTITION)
    await ses.clearCache()
    await ses.clearStorageData()
    await ses.clearCodeCaches({})
    log.info('guest cache cleared')
  }

  consoleEntries(limit = 100, level?: ConsoleEntry['level']): ConsoleEntry[] {
    const filtered = level
      ? this.consoleBuffer.filter((e) => e.level === level)
      : this.consoleBuffer
    return filtered.slice(-limit)
  }

  clearConsole(): void {
    this.consoleBuffer.length = 0
  }
}

function normaliseLevel(level: number | string): ConsoleEntry['level'] {
  switch (level) {
    case 0:
    case 'debug':
      return 'verbose'
    case 2:
    case 'warning':
      return 'warning'
    case 3:
    case 'error':
      return 'error'
    default:
      return 'info'
  }
}

function safeHost(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return ''
  }
}

export function isPrivateHost(host: string): boolean {
  if (!host) return false
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return true
  if (/^127\.|^10\.|^192\.168\.|^0\.0\.0\.0$|^\[::1\]$|^::1$/.test(host)) return true
  const m = /^172\.(\d+)\./.exec(host)
  return !!m && Number(m[1]) >= 16 && Number(m[1]) <= 31
}

export const guestManager = new GuestManager()

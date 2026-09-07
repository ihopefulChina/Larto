import { join } from 'node:path'
import { EventEmitter } from 'node:events'
import { isIP } from 'node:net'
import { app, dialog, session, webContents, type WebContents, type WebPreferences } from 'electron'
import { findDevice, guestViewport, type DeviceSpec } from '@shared/devices'
import { GUEST_PARTITION } from '@shared/constants'
import { createLogger } from './logger'
import { GuestPermissionPolicy } from './permissions'
import { getMainWindow } from './window'

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
  deviceApplied: [
    info: {
      deviceId: string
      viewport: { width: number; height: number }
      requestId?: string
    }
  ]
  deviceFailed: [info: { deviceId: string; error: string; requestId?: string }]
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
  /** Shared by main's did-attach hook and the renderer's attach barrier for this guest. */
  private attachPromise: Promise<void> | null = null
  /** MCP health is ready only after renderer has configured and started the real first URL. */
  private rendererReady = false
  private attachError: string | null = null
  private device: DeviceSpec = findDevice(undefined)
  private viewport: { width: number; height: number } = guestViewport(this.device)
  private emulationGeneration = 0
  private inspecting = false
  private readonly permissions = new GuestPermissionPolicy()
  private reloadQueue: Promise<void> = Promise.resolve()
  private activeReload: {
    generation: number
    contents: WebContents
    controller: AbortController
  } | null = null

  /**
   * Device to emulate for the next guest, before the renderer has reported anything. Called with
   * the persisted setting at startup so the very first navigation already runs under the right
   * viewport/DPR/touch (see `did-attach-webview` in index.ts).
   */
  presetDevice(deviceId: string): void {
    this.device = findDevice(deviceId)
    this.viewport = guestViewport(this.device)
  }
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
    guestSession.setPermissionCheckHandler((_wc, permission, requestingOrigin, details) =>
      this.permissions.check(
        permission,
        details.securityOrigin ?? details.requestingUrl ?? requestingOrigin,
        details.mediaType ? [details.mediaType] : []
      )
    )
    guestSession.setPermissionRequestHandler((contents, permission, callback, details) => {
      const requestingUrl =
        ('securityOrigin' in details ? details.securityOrigin : undefined) ??
        details.requestingUrl ??
        contents.getURL()
      void this.permissions
        .request(
          permission,
          requestingUrl,
          'mediaTypes' in details ? (details.mediaTypes ?? []) : [],
          (origin, requested) => confirmGuestPermission(origin, requested, details)
        )
        .then(callback)
        .catch(() => callback(false))
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

  attach(webContentsId: number): Promise<void> {
    const contents = webContents.fromId(webContentsId)
    if (!contents) throw new Error(`webContents ${webContentsId} not found`)
    if (this.guest === contents) {
      // A failed first CDP round is retriable, but the WebContents listeners below must only be
      // installed once for this guest.
      return this.attachPromise ?? this.applyInitialEmulation(contents)
    }
    this.detach()
    this.guest = contents
    this.rendererReady = false
    this.attachError = null
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

    return this.applyInitialEmulation(contents)
  }

  private applyInitialEmulation(contents: WebContents): Promise<void> {
    this.attachError = null
    const initialDevice = this.device
    const initialViewport = this.viewport
    let shared: Promise<void>
    shared = this.applyEmulation(contents, initialDevice, 'all', initialViewport)
      .then(() => {
        // The webview may have been replaced or destroyed while CDP commands were in flight.
        if (this.guest !== contents || contents.isDestroyed()) return
        log.info(`guest emulation attached: wc#${contents.id}`)
      })
      .catch((err) => {
        // A rejected shared promise must not poison every renderer retry for this same guest.
        if (this.guest === contents && this.attachPromise === shared) {
          this.attachPromise = null
          this.attachError = err instanceof Error ? err.message : String(err)
        }
        throw err
      })
    this.attachPromise = shared
    return shared
  }

  private detach(): void {
    if (!this.guest) return
    // Any CDP operation completing for the old guest is stale and must not acknowledge a command
    // that targets the replacement guest.
    this.emulationGeneration++
    this.guest = null
    this.attachPromise = null
    this.rendererReady = false
    this.attachError = null
    this.emit('detached')
  }

  markRendererReady(webContentsId: number): void {
    const contents = webContents.fromId(webContentsId)
    if (!contents || contents !== this.guest || contents.isDestroyed()) {
      throw new Error(`webContents ${webContentsId} is not the active guest`)
    }
    if (this.rendererReady) return
    this.rendererReady = true
    this.attachError = null
    this.emit('attached', contents)
    log.info(`guest ready: wc#${contents.id}`)
  }

  /**
   * Authorise a main-process capability requested through the injected JSAPI bridge. The caller's
   * `url` field is intentionally ignored: only the active guest WebContents can establish origin.
   */
  requestPagePermission(permission: 'clipboard-read' | 'clipboard-write'): Promise<boolean> {
    const contents = this.contents
    if (!contents) return Promise.resolve(false)
    return this.permissions.request(permission, contents.getURL(), [], (origin, requested) =>
      confirmGuestPermission(origin, requested)
    )
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
      attached: !!this.contents && this.rendererReady,
      attaching: !!this.contents && !this.rendererReady,
      error: this.attachError,
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
    viewport?: { width: number; height: number },
    options: { reload?: boolean; background?: boolean; requestId?: string } = {}
  ): Promise<void> {
    const device = findDevice(deviceId)
    // A ResizeObserver callback can pass its renderer-side guard just before the user switches
    // away from PC. Recheck main's desired device so a late IPC cannot restore stale PC metrics.
    if (options.background && device.id !== this.device.id) return
    const generation = options.background ? this.emulationGeneration : ++this.emulationGeneration
    if (options.reload) this.interruptActiveReload()
    const nextViewport = viewport ?? guestViewport(device)
    this.device = device
    this.viewport = nextViewport
    const contents = webContents.fromId(webContentsId)
    log.debug(
      `set device start generation=${generation} device=${device.id} request=${options.requestId ?? '-'} reload=${!!options.reload} background=${!!options.background}`
    )
    try {
      if (!contents || contents.isDestroyed()) {
        throw new Error(`webContents ${webContentsId} not found`)
      }
      await this.applyEmulation(contents, device, 'all', nextViewport)
      if (generation !== this.emulationGeneration) {
        log.debug(
          `set device superseded generation=${generation} current=${this.emulationGeneration} request=${options.requestId ?? '-'}`
        )
        if (options.requestId) {
          this.emit('deviceFailed', {
            deviceId: device.id,
            error: 'device request was superseded',
            requestId: options.requestId
          })
        }
        return
      }
      if (options.reload) await this.reloadAndWait(contents, generation)
      if (generation !== this.emulationGeneration) {
        if (options.requestId) {
          this.emit('deviceFailed', {
            deviceId: device.id,
            error: 'device request was superseded during reload',
            requestId: options.requestId
          })
        }
        return
      }
      log.debug(
        `set device applied generation=${generation} device=${device.id} request=${options.requestId ?? '-'}`
      )
      this.emit('deviceApplied', {
        deviceId: device.id,
        viewport: nextViewport,
        requestId: options.requestId
      })
    } catch (err) {
      if (generation === this.emulationGeneration) {
        if (!this.rendererReady) this.attachError = err instanceof Error ? err.message : String(err)
        this.emit('deviceFailed', {
          deviceId: device.id,
          error: err instanceof Error ? err.message : String(err),
          requestId: options.requestId
        })
      } else if (options.requestId) {
        this.emit('deviceFailed', {
          deviceId: device.id,
          error: 'device request was superseded',
          requestId: options.requestId
        })
      }
      throw err
    }
  }

  /** Lets command surfaces acknowledge the completed CDP operation instead of guessing a delay. */
  waitForDeviceApplied(deviceId: string, requestId?: string, timeoutMs = 15_000): Promise<void> {
    return new Promise((resolve, reject) => {
      const matches = (info: { deviceId: string; requestId?: string }) =>
        info.deviceId === deviceId && info.requestId === requestId
      const onApplied = (info: { deviceId: string; requestId?: string }) => {
        if (!matches(info)) return
        cleanup()
        resolve()
      }
      const onFailed = (info: { deviceId: string; error: string; requestId?: string }) => {
        if (!matches(info)) return
        cleanup()
        reject(new Error(info.error))
      }
      const cleanup = () => {
        clearTimeout(timer)
        this.off('deviceApplied', onApplied)
        this.off('deviceFailed', onFailed)
      }
      const timer = setTimeout(() => {
        cleanup()
        reject(new Error(`timed out waiting for device ${deviceId}`))
      }, timeoutMs)
      this.on('deviceApplied', onApplied)
      this.on('deviceFailed', onFailed)
    })
  }

  failDeviceRequest(info: { deviceId: string; requestId: string; message: string }): void {
    this.emit('deviceFailed', {
      deviceId: info.deviceId,
      requestId: info.requestId,
      error: info.message
    })
  }

  /**
   * Device changes are latest-wins, but Chromium only has one loading state per WebContents. A
   * second reload issued while the first is still loading can either share its `did-stop-loading`
   * event (false success) or emit no new `did-start-loading` event (timeout). Keep reloads on one
   * queue: a newer generation aborts the old waiter, stops its navigation, then starts and waits
   * for one fresh load cycle of its own.
   */
  private reloadAndWait(contents: WebContents, generation: number): Promise<void> {
    const task = this.reloadQueue
      .catch(() => undefined)
      .then(() => this.runReload(contents, generation))
    this.reloadQueue = task.then(
      () => undefined,
      () => undefined
    )
    return task
  }

  private interruptActiveReload(): void {
    const active = this.activeReload
    if (!active) return
    if (!active.contents.isDestroyed() && active.contents.isLoading()) {
      // Let the active waiter consume this navigation's real stop event. Its generation check
      // will reject it, and the queue will not start the newer reload before that event drains.
      active.contents.stop()
    } else {
      active.controller.abort()
    }
  }

  private async runReload(contents: WebContents, generation: number): Promise<void> {
    if (generation !== this.emulationGeneration) throw new Error('device reload was superseded')
    const controller = new AbortController()
    const active = { generation, contents, controller }
    this.activeReload = active
    try {
      await this.stopCurrentLoad(contents, controller.signal)
      // Keep a late stop notification from the cancelled navigation out of the fresh waiter's
      // event window; Electron dispatches these WebContents events on the next main-loop turn.
      await new Promise<void>((resolve) => setImmediate(resolve))
      if (controller.signal.aborted || generation !== this.emulationGeneration) {
        throw new Error('device reload was superseded')
      }
      await this.waitForFreshReload(contents, controller.signal, generation)
    } finally {
      if (this.activeReload === active) this.activeReload = null
    }
  }

  private stopCurrentLoad(contents: WebContents, signal: AbortSignal): Promise<void> {
    if (!contents.isLoading()) return Promise.resolve()
    return new Promise((resolve, reject) => {
      let settled = false
      const cleanup = () => {
        clearTimeout(timer)
        contents.off('did-stop-loading', onStop)
        contents.off('destroyed', onDestroyed)
        signal.removeEventListener('abort', onAbort)
      }
      const settle = (error?: Error) => {
        if (settled) return
        settled = true
        cleanup()
        if (error) reject(error)
        else resolve()
      }
      const onStop = () => settle()
      const onDestroyed = () => settle(new Error('guest was destroyed while stopping a reload'))
      const onAbort = () => settle(new Error('device reload was superseded'))
      const timer = setTimeout(() => {
        settle(new Error('timed out stopping the previous device reload'))
      }, 5_000)
      contents.on('did-stop-loading', onStop)
      contents.once('destroyed', onDestroyed)
      signal.addEventListener('abort', onAbort, { once: true })
      if (signal.aborted) return onAbort()
      contents.stop()
    })
  }

  private waitForFreshReload(
    contents: WebContents,
    signal: AbortSignal,
    generation: number
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false
      let started = false
      const cleanup = () => {
        clearTimeout(timer)
        contents.off('did-start-navigation', onStart)
        contents.off('did-finish-load', onFinish)
        contents.off('did-fail-load', onFail)
        contents.off('destroyed', onDestroyed)
        signal.removeEventListener('abort', onAbort)
      }
      const settle = (error?: Error) => {
        if (settled) return
        settled = true
        cleanup()
        if (error) reject(error)
        else resolve()
      }
      const onStart = (
        details: Electron.Event<Electron.WebContentsDidStartNavigationEventParams>
      ) => {
        if (details.isMainFrame && !details.isSameDocument) {
          started = true
          log.debug(`device reload main navigation started generation=${generation}`)
        }
      }
      const onFinish = () => {
        log.debug(`device reload did-finish-load generation=${generation} started=${started}`)
        if (started) settle()
      }
      const onFail = (
        _event: Electron.Event,
        _errorCode: number,
        _errorDescription: string,
        _validatedURL: string,
        isMainFrame: boolean
      ) => {
        log.debug(
          `device reload did-fail-load generation=${generation} started=${started} main=${isMainFrame}`
        )
        // The emulation is already applied. A main-frame network error still completes this
        // reload attempt and the normal guest failure UI reports the page error.
        if (started && isMainFrame) settle()
      }
      const onDestroyed = () => settle(new Error('guest was destroyed while reloading'))
      const onAbort = () => settle(new Error('device reload was superseded'))
      const timer = setTimeout(() => {
        log.warn(`device reload timed out generation=${generation} started=${started}`)
        settle(new Error('timed out waiting for the device reload'))
      }, 15_000)
      contents.on('did-start-navigation', onStart)
      contents.on('did-finish-load', onFinish)
      contents.on('did-fail-load', onFail)
      contents.once('destroyed', onDestroyed)
      signal.addEventListener('abort', onAbort, { once: true })
      if (signal.aborted) return onAbort()
      try {
        contents.reload()
      } catch (err) {
        settle(err instanceof Error ? err : new Error(String(err)))
      }
    })
  }

  /**
   * DevTools "select an element" needs real mouse events: with touch emulation on, the browser
   * turns hovers and clicks into touch gestures and the inspect overlay never highlights or picks
   * (stock DevTools device mode disables touch for the same reason). Suspend touch emulation
   * while inspect mode is active and restore the preset afterwards.
   */
  async setInspecting(on: boolean): Promise<void> {
    if (this.inspecting === on) return
    const previous = this.inspecting
    this.inspecting = on
    const contents = this.contents
    try {
      if (contents) await this.applyEmulation(contents, this.device, 'touch')
    } catch (err) {
      this.inspecting = previous
      throw err
    }
  }

  /**
   * Device emulation through CDP. `webContents.enableDeviceEmulation` has no effect on
   * <webview> guests (verified on Electron 44), so we drive Emulation.* directly. For mobile
   * presets the viewport is pinned to the <webview> CSS size (`guestViewport(device)`, never 0:
   * "use the element size" reports 0×0 to scripts that run before the guest's first layout); DPR,
   * `mobile`, screen size and touch emulation come from the preset. Overrides survive navigations.
   */
  private async applyEmulation(
    contents: WebContents,
    device: DeviceSpec,
    scope: 'all' | 'touch' = 'all',
    viewport = this.viewport
  ): Promise<void> {
    if (process.env['LARTO_NO_EMULATION']) return
    try {
      const dbg = contents.debugger
      if (!dbg.isAttached()) {
        dbg.attach('1.3')
        dbg.on('detach', (_e, reason) => log.warn(`guest debugger detached: ${reason}`))
      }
      const mobile = device.platform !== 'pc'
      const touch = mobile && !this.inspecting
      // Fire the commands back-to-back (the session processes them in order): on attach this
      // races the first navigation, so every round trip saved is emulation the page sees earlier.
      const commands: Promise<unknown>[] = []
      if (scope === 'all') {
        commands.push(
          dbg.sendCommand('Emulation.setDeviceMetricsOverride', {
            width: mobile ? viewport.width : 0,
            height: mobile ? viewport.height : 0,
            deviceScaleFactor: device.dpr,
            mobile,
            screenWidth: device.platform === 'pc' ? viewport.width || device.width : device.width,
            screenHeight:
              device.platform === 'pc' ? viewport.height || device.height : device.height,
            positionX: 0,
            positionY: 0
          })
        )
      }
      commands.push(
        dbg.sendCommand('Emulation.setTouchEmulationEnabled', {
          enabled: touch,
          maxTouchPoints: 5
        }),
        dbg.sendCommand('Emulation.setEmitTouchEventsForMouse', {
          enabled: touch,
          configuration: mobile ? 'mobile' : 'desktop'
        })
      )
      const results = await Promise.allSettled(commands)
      const failures = results
        .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
        .map((result) => result.reason)
      if (failures.length) throw new AggregateError(failures, 'one or more CDP commands failed')
    } catch (err) {
      log.warn('device emulation failed', err)
      throw err
    }
  }

  async clearCache(webContentsId: number): Promise<void> {
    const contents = webContents.fromId(webContentsId)
    const ses = contents?.session ?? session.fromPartition(GUEST_PARTITION)
    await ses.clearCache()
    await ses.clearStorageData()
    await ses.clearCodeCaches({})
    this.permissions.clear()
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

async function confirmGuestPermission(
  origin: string,
  permission: string,
  details?: Electron.PermissionRequest | Electron.MediaAccessPermissionRequest
): Promise<boolean> {
  const zh = app.getLocale().toLowerCase().startsWith('zh')
  const labels: Record<string, [string, string]> = {
    'clipboard-read': ['剪贴板内容', 'clipboard contents'],
    'clipboard-write': ['剪贴板', 'the clipboard'],
    media: ['摄像头或麦克风', 'camera or microphone'],
    geolocation: ['位置信息', 'location'],
    notifications: ['系统通知', 'system notifications'],
    fullscreen: ['全屏显示', 'full-screen display'],
    pointerLock: ['鼠标指针锁定', 'pointer lock']
  }
  let label = labels[permission]?.[zh ? 0 : 1] ?? permission
  if (permission === 'media' && details && 'mediaTypes' in details && details.mediaTypes?.length) {
    const mediaLabels = details.mediaTypes.map((type) =>
      type === 'video' ? (zh ? '摄像头' : 'camera') : zh ? '麦克风' : 'microphone'
    )
    label = zh ? mediaLabels.join('和') : mediaLabels.join(' and ')
  }
  const options: Electron.MessageBoxOptions = {
    type: 'question',
    title: zh ? '网页权限请求' : 'Page Permission Request',
    message: zh ? `${origin} 请求访问${label}` : `${origin} wants to access ${label}`,
    detail: zh
      ? '选择“允许本次运行”后，该网站在退出应用或清缓存前无需再次询问。'
      : 'If allowed, this site will not ask again until you quit the app or clear its cache.',
    buttons: zh ? ['允许本次运行', '拒绝'] : ['Allow for This Run', 'Deny'],
    defaultId: 1,
    cancelId: 1,
    noLink: true
  }
  const win = getMainWindow()
  const result = win
    ? await dialog.showMessageBox(win, options)
    : await dialog.showMessageBox(options)
  return result.response === 0
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
  const address = host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host
  const family = isIP(address)
  if (family === 6) return address === '::1'
  if (family !== 4) return false

  const [first = -1, second = -1] = address.split('.').map(Number)
  return (
    first === 127 ||
    first === 10 ||
    (first === 192 && second === 168) ||
    (first === 172 && second >= 16 && second <= 31) ||
    address === '0.0.0.0'
  )
}

export const guestManager = new GuestManager()

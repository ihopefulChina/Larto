import { EventEmitter } from 'node:events'
import {
  BrowserWindow,
  nativeTheme,
  webContents,
  WebContentsView,
  type WebContents
} from 'electron'
import type { Rect } from '@shared/ipc'
import { INSPECT_HOOK_JS, INSPECT_MARK, THEME_CSS } from './devtools-frontend'
import { createLogger } from './logger'

const log = createLogger('devtools')

export interface DevToolsDockEvents {
  /** The frontend entered (true) or left (false) "select an element" mode. */
  'inspect-mode': [on: boolean]
}

/**
 * Hosts Chromium DevTools for the guest in a WebContentsView overlaid on the shell window.
 * `setDevToolsWebContents` requires a never-navigated WebContents, which a fresh
 * WebContentsView guarantees (a <webview> target is broken upstream: electron#15874).
 * The renderer owns layout and reports the placeholder bounds; we just mirror them.
 */
export class DevToolsDock extends EventEmitter<DevToolsDockEvents> {
  private view: WebContentsView | null = null
  private target: WebContents | null = null
  private dark = nativeTheme.shouldUseDarkColors
  private inspecting = false
  private detachGuest: (() => void) | null = null
  /** Invalidates delayed theme-reopen callbacks when the user explicitly opens or closes. */
  private reopenGeneration = 0
  private reopenTarget: WebContents | null = null
  private readonly reopenTimers = new Set<ReturnType<typeof setTimeout>>()

  constructor() {
    super()
    // The DevTools frontend resolves `prefers-color-scheme` once at load and, unlike a
    // BrowserWindow's contents, is not re-themed when `nativeTheme.themeSource` changes.
    // Re-creating the view is the only reliable way to make it follow the appearance setting.
    nativeTheme.on('updated', () => {
      const dark = nativeTheme.shouldUseDarkColors
      if (dark === this.dark) return
      this.dark = dark
      this.reopen()
    })
  }

  private reopen(): void {
    const view = this.view
    const target = this.target
    if (!view || !target || target.isDestroyed()) return
    const win = findOwner(view)
    if (!win) return
    const bounds = view.getBounds()
    const visible = view.getVisible()
    const generation = this.cancelPendingReopen()
    this.reopenTarget = target
    // Opening again in the same tick as closeDevTools() yields an empty Elements panel: the
    // agent host has not detached yet. Wait for `devtools-closed` (with a fallback timer).
    let done = false
    const go = () => {
      if (done) return
      if (
        generation !== this.reopenGeneration ||
        this.reopenTarget !== target ||
        target.isDestroyed() ||
        webContents.fromId(target.id) !== target
      )
        return
      done = true
      this.clearReopenTimers()
      this.reopenTarget = null
      if (win.isDestroyed()) return
      try {
        this.openNow(win, target, bounds)
        this.setBounds(bounds, visible)
      } catch (err) {
        log.warn('reopen after theme change failed', err)
      }
    }
    const later = (delay: number) => {
      if (generation !== this.reopenGeneration || this.reopenTarget !== target) return
      const timer = setTimeout(() => {
        this.reopenTimers.delete(timer)
        go()
      }, delay)
      this.reopenTimers.add(timer)
    }
    target.once('devtools-closed', () => later(50))
    this.closeNow()
    later(1000)
  }

  private clearReopenTimers(): void {
    for (const timer of this.reopenTimers) clearTimeout(timer)
    this.reopenTimers.clear()
  }

  private cancelPendingReopen(): number {
    this.reopenGeneration += 1
    this.reopenTarget = null
    this.clearReopenTimers()
    return this.reopenGeneration
  }

  get isOpen(): boolean {
    return !!this.view
  }

  get state() {
    return {
      open: !!this.view,
      bounds: this.view ? this.view.getBounds() : null,
      visible: this.view ? this.view.getVisible() : false,
      url:
        this.view && !this.view.webContents.isDestroyed() ? this.view.webContents.getURL() : null,
      targetOpen: this.target && !this.target.isDestroyed() ? this.target.isDevToolsOpened() : false
    }
  }

  /** PNG of the DevTools frontend (it is a separate compositor layer, invisible to shell captures). */
  async capture(): Promise<Electron.NativeImage | null> {
    if (!this.view || this.view.webContents.isDestroyed()) return null
    return this.view.webContents.capturePage()
  }

  open(win: BrowserWindow, guestId: number, bounds: Rect): void {
    const guest = webContents.fromId(guestId)
    if (!guest) throw new Error(`guest webContents ${guestId} not found`)
    this.cancelPendingReopen()
    this.openNow(win, guest, bounds)
  }

  private openNow(win: BrowserWindow, guest: WebContents, bounds: Rect): void {
    if (this.view && this.target === guest) {
      this.setBounds(bounds, true)
      return
    }
    this.closeNow()
    const view = new WebContentsView({
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false }
    })
    view.setBackgroundColor('#00000000')
    win.contentView.addChildView(view)
    view.setBounds(roundRect(bounds))
    guest.setDevToolsWebContents(view.webContents)
    guest.openDevTools({ mode: 'detach', activate: false })
    // Removed again in close(): every toggle would otherwise stack one more listener on the guest.
    const onGone = () => {
      if (this.target === guest) this.close()
    }
    guest.once('destroyed', onGone)
    guest.on('devtools-closed', onGone)
    this.detachGuest = () => {
      guest.off('destroyed', onGone)
      guest.off('devtools-closed', onGone)
    }
    this.view = view
    this.target = guest
    log.info(`devtools docked for wc#${guest.id}`)
    view.webContents.on('console-message', (event) => {
      if (!event.message.startsWith(INSPECT_MARK)) return
      this.setInspecting(event.message.slice(INSPECT_MARK.length) === 'on')
    })
    // The devtools:// frontend commits in a new RenderWidgetHostView that stays hidden
    // (document.visibilityState === 'hidden', no frames, capturePage fails) until the native
    // view is re-attached to the window. Re-attaching once after load makes it paint normally.
    view.webContents.once('did-finish-load', () => {
      if (this.view !== view || view.webContents.isDestroyed()) return
      win.contentView.removeChildView(view)
      win.contentView.addChildView(view)
      view.webContents
        .insertCSS(THEME_CSS)
        .catch((err) => log.warn('devtools theme css failed', err))
      view.webContents
        .executeJavaScript(INSPECT_HOOK_JS)
        .catch((err) => log.warn('devtools inspect hook failed', err))
    })
  }

  private setInspecting(on: boolean): void {
    if (this.inspecting === on) return
    this.inspecting = on
    this.emit('inspect-mode', on)
  }

  setBounds(bounds: Rect, visible: boolean): void {
    if (!this.view) return
    // Only touch the native view when something changed: re-applying identical bounds resets
    // the compositor surface and, since an idle DevTools UI produces no new frame, capturePage
    // then fails with "Current display surface not available for capture".
    if (this.view.getVisible() !== visible) this.view.setVisible(visible)
    if (!visible) return
    const next = roundRect(bounds)
    const cur = this.view.getBounds()
    if (
      cur.x !== next.x ||
      cur.y !== next.y ||
      cur.width !== next.width ||
      cur.height !== next.height
    )
      this.view.setBounds(next)
  }

  close(): void {
    this.cancelPendingReopen()
    this.closeNow()
  }

  private closeNow(): void {
    const view = this.view
    const target = this.target
    this.view = null
    this.target = null
    this.detachGuest?.()
    this.detachGuest = null
    this.setInspecting(false)
    if (!view) return
    try {
      if (target && !target.isDestroyed()) target.closeDevTools()
    } catch (err) {
      log.warn('closeDevTools failed', err)
    }
    const win = view.webContents.isDestroyed() ? null : findOwner(view)
    win?.contentView.removeChildView(view)
    if (!view.webContents.isDestroyed()) view.webContents.close()
  }
}

function findOwner(view: WebContentsView): BrowserWindow | null {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.contentView.children.includes(view)) return win
  }
  return null
}

function roundRect(r: Rect): Rect {
  return {
    x: Math.round(r.x),
    y: Math.round(r.y),
    width: Math.max(0, Math.round(r.width)),
    height: Math.max(0, Math.round(r.height))
  }
}

export const devToolsDock = new DevToolsDock()

import { BrowserWindow, webContents, WebContentsView, type WebContents } from 'electron'
import type { Rect } from '@shared/ipc'
import { createLogger } from './logger'

const log = createLogger('devtools')

/**
 * Hosts Chromium DevTools for the guest in a WebContentsView overlaid on the shell window.
 * `setDevToolsWebContents` requires a never-navigated WebContents, which a fresh
 * WebContentsView guarantees (a <webview> target is broken upstream: electron#15874).
 * The renderer owns layout and reports the placeholder bounds; we just mirror them.
 */
export class DevToolsDock {
  private view: WebContentsView | null = null
  private target: WebContents | null = null

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
    if (this.view && this.target === guest) {
      this.setBounds(bounds, true)
      return
    }
    this.close()
    const view = new WebContentsView({
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false }
    })
    view.setBackgroundColor('#00000000')
    win.contentView.addChildView(view)
    view.setBounds(roundRect(bounds))
    guest.setDevToolsWebContents(view.webContents)
    guest.openDevTools({ mode: 'detach', activate: false })
    guest.once('destroyed', () => this.close())
    guest.on('devtools-closed', () => {
      if (this.target === guest) this.close()
    })
    this.view = view
    this.target = guest
    log.info(`devtools docked for wc#${guestId}`)
    // The devtools:// frontend commits in a new RenderWidgetHostView that stays hidden
    // (document.visibilityState === 'hidden', no frames, capturePage fails) until the native
    // view is re-attached to the window. Re-attaching once after load makes it paint normally.
    view.webContents.once('did-finish-load', () => {
      if (this.view !== view || view.webContents.isDestroyed()) return
      win.contentView.removeChildView(view)
      win.contentView.addChildView(view)
    })
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
    const view = this.view
    const target = this.target
    this.view = null
    this.target = null
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

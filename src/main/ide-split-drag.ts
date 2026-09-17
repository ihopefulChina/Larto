import { screen, WebContentsView, type InputEvent, type WebContents } from 'electron'
import {
  clampSimulatorColumnWidth,
  isSplitPress,
  isSplitRelease,
  sashViewBounds,
  type IdeSplitLayout
} from '@shared/ide-split'
import type { SettingsStore } from './store'
import { getMainWindow, sendToRenderer } from './window'

/**
 * Official-style column sash: a native 10px strip in the gap between the
 * simulator column and DevTools. Press starts a drag; a full-window overlay
 * then follows the screen cursor until mouseup.
 */
export class IdeSplitController {
  private layout: IdeSplitLayout | null = null
  private seed: { startX: number; startWidth: number; latest: number } | null = null
  private dragging = false
  private sash: WebContentsView | null = null
  private overlay: WebContentsView | null = null
  private ticker: ReturnType<typeof setInterval> | null = null
  private raiseTimer: ReturnType<typeof setInterval> | null = null
  private readonly hooked = new WeakSet<WebContents>()
  private blurWin: Electron.BrowserWindow | null = null

  constructor(private readonly settings: SettingsStore) {}

  setLayout(layout: IdeSplitLayout): void {
    this.layout = layout
    if (!layout.enabled) {
      this.cancel()
      return
    }
    this.syncSash()
    this.watchBlur()
    this.startRaise()
  }

  refreshHooks(): void {
    if (this.sash) this.hook(this.sash.webContents, 'sash')
    if (this.overlay) this.hook(this.overlay.webContents, 'overlay')
    this.syncSash()
  }

  handleRendererPointer(type: 'down' | 'move' | 'up'): void {
    if (type === 'down') this.begin()
    else if (type === 'move' && this.dragging) this.track()
    else if (type === 'up') this.finish()
  }

  private watchBlur(): void {
    const win = getMainWindow()
    if (!win || this.blurWin === win) return
    this.blurWin?.off('blur', this.onBlur)
    this.blurWin = win
    win.on('blur', this.onBlur)
  }

  private readonly onBlur = (): void => {
    this.finish()
  }

  private hook(wc: WebContents, role: 'sash' | 'overlay'): void {
    if (wc.isDestroyed() || this.hooked.has(wc)) return
    this.hooked.add(wc)
    const onInput = (_event: Electron.Event, input: InputEvent) => {
      if (isSplitPress(input.type)) {
        const clickCount = 'clickCount' in input ? Number(input.clickCount) : 1
        if (clickCount >= 2) this.resetToAuto()
        else this.begin()
        return
      }
      if (isSplitRelease(input.type)) this.finish()
    }
    wc.on('input-event', onInput)
    wc.once('destroyed', () => wc.off('input-event', onInput))
    void role
  }

  private screenX(): number {
    return screen.getCursorScreenPoint().x
  }

  private begin(): void {
    const layout = this.layout
    if (!layout?.enabled || this.dragging) return
    this.dragging = true
    this.seed = {
      startX: this.screenX(),
      startWidth: layout.columnWidth,
      latest: layout.columnWidth
    }
    this.showOverlay()
    this.startTicker()
    this.emit(layout.columnWidth, true)
  }

  private track(): void {
    const layout = this.layout
    const seed = this.seed
    if (!layout || !seed || !this.dragging) return
    const next = clampSimulatorColumnWidth(
      seed.startWidth + this.screenX() - seed.startX,
      layout.panelWidth
    )
    if (next === seed.latest) return
    seed.latest = next
    this.emit(next, true)
  }

  private finish(): void {
    const seed = this.seed
    const wasDragging = this.dragging
    this.stopTicker()
    this.hideOverlay()
    this.dragging = false
    this.seed = null
    this.syncSash()
    if (!wasDragging || !seed) return
    if (this.settings.get().simulatorColumnWidth !== seed.latest) {
      this.settings.patchWritable({ simulatorColumnWidth: seed.latest })
    }
    this.emit(seed.latest, false)
  }

  private cancel(): void {
    this.stopTicker()
    this.hideOverlay()
    this.dragging = false
    this.seed = null
    if (this.raiseTimer) {
      clearInterval(this.raiseTimer)
      this.raiseTimer = null
    }
    this.hideSash()
  }

  private resetToAuto(): void {
    this.stopTicker()
    this.hideOverlay()
    this.dragging = false
    this.seed = null
    if (this.settings.get().simulatorColumnWidth !== null) {
      this.settings.patchWritable({ simulatorColumnWidth: null })
    }
    this.syncSash()
    this.emit(0, false)
  }

  private emit(width: number, dragging: boolean): void {
    sendToRenderer('split:changed', { width, dragging })
  }

  private startTicker(): void {
    this.stopTicker()
    this.ticker = setInterval(() => this.track(), 16)
  }

  private stopTicker(): void {
    if (!this.ticker) return
    clearInterval(this.ticker)
    this.ticker = null
  }

  private startRaise(): void {
    if (this.raiseTimer) return
    this.raiseTimer = setInterval(() => {
      if (this.layout?.enabled && !this.dragging) this.syncSash()
    }, 500)
  }

  private syncSash(): void {
    const win = getMainWindow()
    const layout = this.layout
    if (!win || win.isDestroyed() || !layout?.enabled || this.dragging) return
    const view = this.ensureSash()
    const next = sashViewBounds(layout)
    const cur = view.getBounds()
    if (
      cur.x !== next.x ||
      cur.y !== next.y ||
      cur.width !== next.width ||
      cur.height !== next.height
    ) {
      view.setBounds(next)
    }
    view.setVisible(true)
    const children = win.contentView.children
    if (children[children.length - 1] !== view) {
      win.contentView.addChildView(view)
    }
  }

  private hideSash(): void {
    const view = this.sash
    if (!view) return
    const win = getMainWindow()
    if (win && !win.isDestroyed()) win.contentView.removeChildView(view)
    view.setVisible(false)
  }

  private ensureSash(): WebContentsView {
    if (this.sash && !this.sash.webContents.isDestroyed()) {
      this.hook(this.sash.webContents, 'sash')
      return this.sash
    }
    const view = new WebContentsView({
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false }
    })
    view.setBackgroundColor('#00000001')
    void view.webContents.loadURL(
      'data:text/html;charset=utf-8,' +
        encodeURIComponent(
          `<!doctype html><html><body style="margin:0;height:100%;cursor:col-resize;background:rgba(0,0,0,.01)">
            <div style="position:absolute;inset:0 3px;background:rgba(128,128,128,.4)"></div>
          </body></html>`
        )
    )
    this.sash = view
    this.hook(view.webContents, 'sash')
    return view
  }

  private showOverlay(): void {
    const win = getMainWindow()
    if (!win || win.isDestroyed()) return
    const view = this.ensureOverlay()
    const { width, height } = win.getContentBounds()
    view.setBounds({ x: 0, y: 0, width, height })
    view.setVisible(true)
    win.contentView.addChildView(view)
  }

  private hideOverlay(): void {
    const view = this.overlay
    if (!view) return
    const win = getMainWindow()
    if (win && !win.isDestroyed()) win.contentView.removeChildView(view)
    view.setVisible(false)
  }

  private ensureOverlay(): WebContentsView {
    if (this.overlay && !this.overlay.webContents.isDestroyed()) {
      this.hook(this.overlay.webContents, 'overlay')
      return this.overlay
    }
    const view = new WebContentsView({
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false }
    })
    view.setBackgroundColor('#00000001')
    void view.webContents.loadURL(
      'data:text/html;charset=utf-8,' +
        encodeURIComponent(
          '<!doctype html><html><body style="margin:0;height:100%;cursor:col-resize;background:rgba(0,0,0,.01)"></body></html>'
        )
    )
    this.overlay = view
    this.hook(view.webContents, 'overlay')
    return view
  }
}

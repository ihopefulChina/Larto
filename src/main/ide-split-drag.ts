import { screen, WebContentsView, type InputEvent, type WebContents } from 'electron'
import {
  clampSimulatorColumnWidth,
  isSplitPress,
  isSplitRelease,
  sameIdeSplitLayout,
  sashViewBounds,
  type IdeSplitLayout
} from '@shared/ide-split'
import type { SettingsStore } from './store'
import { getMainWindow, sendToRenderer } from './window'

/**
 * Official-style column sash: a native 10px strip in the gap between the
 * simulator column and DevTools. Press starts a drag; the gray mark is
 * hidden so it does not stay parked over the phone. The sash view stays
 * mounted (mouseup must not be lost) and a full-window overlay follows
 * the screen cursor until mouseup.
 */
export class IdeSplitController {
  private layout: IdeSplitLayout | null = null
  private seed: { startX: number; startWidth: number; latest: number } | null = null
  private dragging = false
  private sash: WebContentsView | null = null
  private overlay: WebContentsView | null = null
  private ticker: ReturnType<typeof setInterval> | null = null
  private readonly hooked = new WeakSet<WebContents>()
  private readonly ready = new WeakSet<WebContents>()
  private blurWin: Electron.BrowserWindow | null = null

  constructor(private readonly settings: SettingsStore) {}

  setLayout(layout: IdeSplitLayout): void {
    if (this.layout && sameIdeSplitLayout(this.layout, layout)) return
    this.layout = layout
    if (!layout.enabled) {
      this.cancel()
      return
    }
    this.syncSash()
    this.watchBlur()
  }

  refreshHooks(): void {
    if (this.sash) this.hook(this.sash.webContents, 'sash')
    if (this.overlay) this.hook(this.overlay.webContents, 'overlay')
    const win = getMainWindow()
    if (win && !win.isDestroyed()) this.hook(win.webContents, 'window')
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
    this.hook(win.webContents, 'window')
  }

  private readonly onBlur = (): void => {
    this.finish()
  }

  private hook(wc: WebContents, role: 'sash' | 'overlay' | 'window'): void {
    if (wc.isDestroyed() || this.hooked.has(wc)) return
    this.hooked.add(wc)
    const onInput = (_event: Electron.Event, input: InputEvent) => {
      if (isSplitRelease(input.type)) {
        if (this.dragging) this.finish()
        return
      }
      if (role === 'window' || !this.ready.has(wc)) return
      if (isSplitPress(input.type)) {
        const clickCount = 'clickCount' in input ? Number(input.clickCount) : 1
        if (clickCount >= 2) this.resetToAuto()
        else this.begin()
      }
    }
    wc.on('input-event', onInput)
    if (role !== 'window') {
      wc.once('did-finish-load', () => {
        this.ready.add(wc)
        if (role === 'sash') this.setSashMark(!this.dragging)
      })
      if (wc.getURL() && !wc.isLoading()) this.ready.add(wc)
    }
    wc.once('destroyed', () => wc.off('input-event', onInput))
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
    this.setSashMark(false)
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
    this.setSashMark(true)
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
    this.setSashMark(true)
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
    const children = win.contentView.children ?? []
    if (children[children.length - 1] !== view) {
      win.contentView.addChildView(view)
    }
  }

  private hideSash(): void {
    const view = this.sash
    if (!view) return
    this.detachView(view)
    view.setVisible(false)
  }

  private setSashMark(visible: boolean): void {
    const view = this.sash
    if (!view || view.webContents.isDestroyed()) return
    const display = visible ? 'block' : 'none'
    void view.webContents
      .executeJavaScript(
        `(() => { const el = document.getElementById('mark'); if (el) el.style.display = '${display}'; })()`
      )
      .catch(() => undefined)
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
            <div id="mark" style="position:absolute;inset:0 3px;background:rgba(128,128,128,.4)"></div>
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
    this.detachView(view)
    view.setVisible(false)
  }

  private detachView(view: WebContentsView): void {
    const win = getMainWindow()
    if (!win || win.isDestroyed()) return
    const children = win.contentView.children ?? []
    if (children.includes(view)) win.contentView.removeChildView(view)
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

import { create } from 'zustand'
import type { WebviewTag } from 'electron'
import { buildUserAgent, findDevice, guestViewport } from '@shared/devices'
import { translate } from '@shared/i18n'
import { invoke } from '@/lib/bridge'
import { afterLayout } from '@/lib/layout'
import { useApp } from '@/store/app'

export interface NavItem {
  id?: string
  text?: string
  /** Base64 image (data URL) — official caps at 10240 chars. */
  imageBase64?: string
  /** Built-in glyphs used by `setLeft`/`setRight`. */
  icon?: 'back' | 'close' | 'more' | 'refresh'
  control?: boolean
}

export interface NavBarState {
  title: string
  showBack: boolean
  showClose: boolean
  left: NavItem[] | null
  right: NavItem[] | null
  menu: NavItem[] | null
}

export interface DialogState {
  id: number
  type: 'alert' | 'confirm' | 'prompt' | 'modal'
  title: string
  message: string
  buttons: string[]
  /** prompt only */
  defaultValue?: string
  placeholder?: string
  resolve: (result: {
    buttonIndex: number
    value?: string
    confirm?: boolean
    cancel?: boolean
  }) => void
}

export interface ActionSheetState {
  title?: string
  items: string[]
  resolve: (index: number | null) => void
}

export interface ToastState {
  text: string
  icon: 'none' | 'success' | 'error' | 'loading'
  duration: number
}

interface SimulatorState {
  webview: WebviewTag | null
  webContentsId: number | null
  url: string
  title: string
  loading: boolean
  canGoBack: boolean
  closed: boolean
  navBar: NavBarState
  dialogs: DialogState[]
  actionSheet: ActionSheetState | null
  toast: ToastState | null
  preloader: { text: string } | null
  imagePreview: { urls: string[]; current: number } | null

  setWebview: (el: WebviewTag | null, id: number | null) => void
  patch: (
    p: Partial<Pick<SimulatorState, 'url' | 'title' | 'loading' | 'canGoBack' | 'closed'>>
  ) => void
  setNavBar: (p: Partial<NavBarState>) => void
  resetPage: () => void
  pushDialog: (d: Omit<DialogState, 'id'>) => void
  popDialog: (id: number) => void
  setActionSheet: (a: ActionSheetState | null) => void
  setToast: (t: ToastState | null) => void
  setPreloader: (p: { text: string } | null) => void
  setImagePreview: (p: { urls: string[]; current: number } | null) => void
}

const DEFAULT_NAV: NavBarState = {
  title: '',
  showBack: true,
  showClose: true,
  left: null,
  right: null,
  menu: null
}
let dialogSeq = 0

export const useSimulator = create<SimulatorState>((set) => ({
  webview: null,
  webContentsId: null,
  url: '',
  title: '',
  loading: false,
  canGoBack: false,
  closed: false,
  navBar: DEFAULT_NAV,
  dialogs: [],
  actionSheet: null,
  toast: null,
  preloader: null,
  imagePreview: null,

  setWebview: (webview, webContentsId) => set({ webview, webContentsId }),
  patch: (p) => set(p),
  setNavBar: (p) => set((s) => ({ navBar: { ...s.navBar, ...p } })),
  resetPage: () =>
    set((s) => {
      // Settle whatever the previous page was still waiting on, otherwise the JSAPI host awaits
      // forever and never records the call. Treat it as "dismissed" (first button / no item).
      for (const d of s.dialogs) d.resolve({ buttonIndex: 0, cancel: true, confirm: false })
      s.actionSheet?.resolve(null)
      return {
        navBar: DEFAULT_NAV,
        dialogs: [],
        actionSheet: null,
        toast: null,
        preloader: null,
        imagePreview: null,
        closed: false
      }
    }),
  pushDialog: (d) => set((s) => ({ dialogs: [...s.dialogs, { ...d, id: ++dialogSeq }] })),
  popDialog: (id) => set((s) => ({ dialogs: s.dialogs.filter((d) => d.id !== id) })),
  setActionSheet: (actionSheet) => set({ actionSheet }),
  setToast: (toast) => set({ toast }),
  setPreloader: (preloader) => set({ preloader }),
  setImagePreview: (imagePreview) => set({ imagePreview })
}))

/** URL requested before the <webview> had a guest; loaded as soon as it does. */
let pendingUrl: string | null = null
let deviceChangeGeneration = 0
let activeDeviceChange: { generation: number; deviceId: string; requestId?: string } | null = null

function resolveDeviceViewport(device: ReturnType<typeof findDevice>): {
  width: number
  height: number
} {
  const pc = useApp.getState().settings.pcViewport
  const adaptivePc =
    device.platform === 'pc' && !pc ? document.querySelector('.gadgetBox.pc') : null
  const rect = adaptivePc?.getBoundingClientRect()
  if (device.platform === 'pc' && pc) return pc
  if (rect && rect.width >= 50 && rect.height >= 50) {
    return { width: Math.round(rect.width), height: Math.round(rect.height) }
  }
  return guestViewport(device)
}

function failDeviceCommand(deviceId: string, requestId: string | undefined, message: string): void {
  if (!requestId) return
  void invoke('guest:deviceCommandFailed', { deviceId, requestId, message }).catch(() => undefined)
}

/** Navigation helpers used by toolbar, menu commands, MCP and JSAPI. */
export const simulatorActions = {
  loadUrl(url: string): void {
    void simulatorActions.loadUrlAndWait(url).catch(() => undefined)
  },
  async loadUrlAndWait(url: string): Promise<void> {
    const { webview } = useSimulator.getState()
    if (!webview) {
      pendingUrl = url
      return
    }
    pendingUrl = null
    useSimulator.getState().resetPage()
    await webview.loadURL(url)
  },
  takePendingUrl(): string | null {
    const url = pendingUrl
    pendingUrl = null
    return url
  },
  reload(): void {
    const { webview } = useSimulator.getState()
    if (!webview) return
    useSimulator.getState().resetPage()
    webview.reload()
  },
  goBack(): void {
    const { webview } = useSimulator.getState()
    if (!webview) return
    if (webview.canGoBack()) webview.goBack()
    else simulatorActions.close()
  },
  close(): void {
    useSimulator.getState().patch({ closed: true })
  },
  /**
   * Official behaviour: switch UA → reload. We also re-apply CDP emulation and wait for the
   * resized <webview> to lay out before reloading (an OOPIF guest reports 0×0 while resizing).
   */
  async changeDevice(deviceId: string, requestId?: string): Promise<void> {
    const generation = ++deviceChangeGeneration
    let appliedByMain = false
    const superseded = activeDeviceChange
    if (superseded?.requestId) {
      failDeviceCommand(superseded.deviceId, superseded.requestId, 'device request was superseded')
    }
    activeDeviceChange = { generation, deviceId, ...(requestId ? { requestId } : {}) }
    try {
      const previousDeviceId = useApp.getState().settings.deviceId
      try {
        await useApp.getState().setSetting('deviceId', deviceId)
      } catch (err) {
        if (generation === deviceChangeGeneration) {
          const app = useApp.getState()
          app.showToast(translate(app.lang, 'toolbar.deviceFailed'))
        }
        console.warn('could not save device setting', err)
        failDeviceCommand(deviceId, requestId, 'could not save device setting')
        return
      }
      if (
        generation !== deviceChangeGeneration ||
        useApp.getState().settings.deviceId !== deviceId
      ) {
        failDeviceCommand(deviceId, requestId, 'device request was superseded')
        return
      }
      await afterLayout()
      if (
        generation !== deviceChangeGeneration ||
        useApp.getState().settings.deviceId !== deviceId
      ) {
        failDeviceCommand(deviceId, requestId, 'device request was superseded')
        return
      }
      const { webview, webContentsId } = useSimulator.getState()
      if (!webview || webContentsId === null) {
        failDeviceCommand(deviceId, requestId, 'simulator is not ready')
        return
      }
      const device = findDevice(deviceId)
      webview.setUserAgent(
        buildUserAgent(device, useApp.getState().lang === 'zh-CN' ? 'zh_CN' : 'en_US')
      )
      const viewport = resolveDeviceViewport(device)
      try {
        await invoke('guest:setDevice', {
          webContentsId,
          deviceId,
          viewport,
          reload: true,
          ...(requestId ? { requestId } : {})
        })
        appliedByMain = true
      } catch (err) {
        if (generation !== deviceChangeGeneration) return
        const app = useApp.getState()
        app.showToast(translate(app.lang, 'toolbar.deviceFailed'))
        console.warn('device emulation failed', err)
        // A failed CDP round may have applied only some metrics. Restore the previous preset and
        // reload it; if even that fails, keep the guest on a safe blank page instead of pretending
        // the selected device is active.
        try {
          await app.setSetting('deviceId', previousDeviceId)
          await afterLayout()
          if (generation !== deviceChangeGeneration) return
          const previous = findDevice(previousDeviceId)
          webview.setUserAgent(buildUserAgent(previous, app.lang === 'zh-CN' ? 'zh_CN' : 'en_US'))
          await invoke('guest:setDevice', {
            webContentsId,
            deviceId: previous.id,
            viewport: resolveDeviceViewport(previous),
            reload: true
          })
        } catch (rollbackError) {
          console.warn('could not restore previous device', rollbackError)
          void webview.loadURL('about:blank').catch(() => undefined)
        }
        return
      }
      if (generation !== deviceChangeGeneration || useApp.getState().settings.deviceId !== deviceId)
        return
      useSimulator.getState().resetPage()
    } catch (err) {
      if (generation === deviceChangeGeneration) {
        const app = useApp.getState()
        app.showToast(translate(app.lang, 'toolbar.deviceFailed'))
      }
      console.warn('device change failed before reaching the emulator', err)
      if (!appliedByMain) {
        failDeviceCommand(
          deviceId,
          requestId,
          err instanceof Error ? err.message : 'device change failed'
        )
      }
    } finally {
      if (activeDeviceChange?.generation === generation) activeDeviceChange = null
    }
  }
}

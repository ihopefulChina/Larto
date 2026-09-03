import { create } from 'zustand'
import type { WebviewTag } from 'electron'
import { buildUserAgent, findDevice, guestViewport } from '@shared/devices'
import { invoke } from '@/lib/bridge'
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
    set({
      navBar: DEFAULT_NAV,
      dialogs: [],
      actionSheet: null,
      toast: null,
      preloader: null,
      imagePreview: null,
      closed: false
    }),
  pushDialog: (d) => set((s) => ({ dialogs: [...s.dialogs, { ...d, id: ++dialogSeq }] })),
  popDialog: (id) => set((s) => ({ dialogs: s.dialogs.filter((d) => d.id !== id) })),
  setActionSheet: (actionSheet) => set({ actionSheet }),
  setToast: (toast) => set({ toast }),
  setPreloader: (preloader) => set({ preloader }),
  setImagePreview: (imagePreview) => set({ imagePreview })
}))

/** Navigation helpers used by toolbar, menu commands, MCP and JSAPI. */
export const simulatorActions = {
  loadUrl(url: string): void {
    const { webview } = useSimulator.getState()
    if (!webview) return
    useSimulator.getState().resetPage()
    void webview.loadURL(url).catch(() => undefined)
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
  async changeDevice(deviceId: string): Promise<void> {
    await useApp.getState().setSetting('deviceId', deviceId)
    await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())))
    const { webview, webContentsId } = useSimulator.getState()
    if (!webview || webContentsId === null) return
    const device = findDevice(deviceId)
    webview.setUserAgent(
      buildUserAgent(device, useApp.getState().lang === 'zh-CN' ? 'zh_CN' : 'en_US')
    )
    await invoke('guest:setDevice', { webContentsId, deviceId, viewport: guestViewport(device) })
    useSimulator.getState().resetPage()
    webview.reload()
  }
}

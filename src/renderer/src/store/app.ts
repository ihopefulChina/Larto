import { useCallback, useEffect, type RefObject } from 'react'
import { create } from 'zustand'
import type { AccountState } from '@shared/account'
import { resolveLanguage, translate, type I18nKey } from '@shared/i18n'
import type { AccessConsentPrompt, AppInfo, UpdateState } from '@shared/ipc'
import {
  DEFAULT_SETTINGS,
  type ResolvedLanguage,
  type Settings,
  type WritableSettingKey
} from '@shared/settings'
import { invoke, on } from '@/lib/bridge'

export type ModalId = 'preview' | 'settings' | 'about' | 'update' | 'consent' | null

interface AppState {
  ready: boolean
  settings: Settings
  dark: boolean
  lang: ResolvedLanguage
  account: AccountState
  update: UpdateState
  info: AppInfo | null
  mcp: { running: boolean; url: string | null; error?: string }
  modal: ModalId
  /** Pending requestAccess consent (main is waiting on `jsapi:consentDecision`). */
  consent: AccessConsentPrompt | null
  /**
   * Number of open popovers (dropdowns, history) that overlap the DevTools column. The DevTools
   * overlay is a native view above the DOM, so it is hidden while this is > 0 (see DevToolsPane).
   */
  devtoolsCovers: number
  /** Transient shell notice (bottom-centre), e.g. "cache cleared" or a failed sign-in. */
  toast: string | null

  init: () => Promise<void>
  setSetting: <K extends WritableSettingKey>(key: K, value: Settings[K]) => Promise<void>
  openModal: (id: ModalId) => void
  coverDevTools: (delta: 1 | -1) => void
  showToast: (message: string, ms?: number) => void
}

let toastTimer: ReturnType<typeof setTimeout> | undefined
let initPromise: Promise<void> | null = null
let settingWriteQueue: Promise<void> = Promise.resolve()

const systemLocale = navigator.language

export const useApp = create<AppState>((set, get) => ({
  ready: false,
  settings: DEFAULT_SETTINGS,
  dark: matchMedia('(prefers-color-scheme: dark)').matches,
  lang: resolveLanguage('system', systemLocale),
  account: { status: 'signedOut' },
  update: { status: 'idle' },
  info: null,
  mcp: { running: false, url: null },
  modal: null,
  consent: null,
  devtoolsCovers: 0,
  toast: null,

  async init() {
    if (!initPromise) {
      initPromise = (async () => {
        const [settings, theme, account, update, info, mcp] = await Promise.all([
          invoke('settings:get'),
          invoke('theme:resolve'),
          invoke('account:getState'),
          invoke('update:getState'),
          invoke('app:getInfo'),
          invoke('mcp:getStatus')
        ])
        set({
          settings,
          dark: theme.dark,
          lang: resolveLanguage(settings.language, systemLocale),
          account,
          update,
          info,
          mcp,
          ready: true
        })
        on('settings:changed', (s) => {
          set({ settings: s, lang: resolveLanguage(s.language, systemLocale) })
          void invoke('mcp:getStatus').then((m) => set({ mcp: m }))
        })
        on('theme:changed', ({ dark }) => set({ dark }))
        on('account:changed', (account) => set({ account }))
        on('update:state', (update) => {
          set({ update })
          // Only good news interrupts the user. Errors from the silent startup check (offline,
          // proxy…) stay in the state and show up when the dialog is opened from the menu, which
          // also covers user-initiated checks. Never steal the screen from a pending consent.
          const { modal } = get()
          if (
            (update.status === 'available' || update.status === 'downloaded') &&
            modal !== 'consent' &&
            modal !== 'update'
          )
            get().openModal('update')
        })
        on('jsapi:consent', (consent) => set({ consent, modal: 'consent' }))
      })().catch((err) => {
        initPromise = null
        throw err
      })
    }
    await initPromise
  },

  setSetting(key, value) {
    // `settings:set` returns the complete snapshot. Serialise renderer-originated writes so two
    // fast controls cannot apply their responses out of order and restore an older value for an
    // unrelated key (for example set_zoom immediately followed by set_device from MCP).
    const operation = settingWriteQueue
      .catch(() => undefined)
      .then(async () => {
        const settings = await invoke('settings:set', { [key]: value } as Partial<
          Pick<Settings, WritableSettingKey>
        >)
        set({ settings, lang: resolveLanguage(settings.language, systemLocale) })
      })
    settingWriteQueue = operation.then(
      () => undefined,
      () => undefined
    )
    return operation
  },

  openModal(id) {
    const { consent, modal } = get()
    // Dismissing the consent dialog by any other means counts as a refusal.
    if (modal === 'consent' && id !== 'consent' && consent) {
      void invoke('jsapi:consentDecision', { id: consent.id, accept: false }).catch(() => undefined)
      set({ modal: id, consent: null })
      return
    }
    set({ modal: id })
  },

  coverDevTools(delta) {
    set((s) => ({ devtoolsCovers: Math.max(0, s.devtoolsCovers + delta) }))
  },

  showToast(message, ms = 2000) {
    clearTimeout(toastTimer)
    set({ toast: message })
    toastTimer = setTimeout(() => set({ toast: null }), ms)
  }
}))

/**
 * Hides the DevTools overlay while `open` and the popover element overlaps the DevTools column.
 * Native child views always paint above the DOM, so this is the only way a dropdown can be
 * shown "on top" of DevTools.
 */
export function useCoversDevTools(open: boolean, ref: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    if (!open) return
    const el = ref.current
    const pane = document.querySelector('.devtoolsColumn')
    if (!el || !pane) return
    const a = el.getBoundingClientRect()
    const b = pane.getBoundingClientRect()
    const overlaps = a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
    if (!overlaps) return
    useApp.getState().coverDevTools(1)
    return () => useApp.getState().coverDevTools(-1)
  }, [open, ref])
}

/**
 * Translation hook bound to the current language. Stable per language so callbacks/effects that
 * depend on `t` (e.g. the `shell:command` subscription in App) do not re-run every render.
 */
export function useT(): (key: I18nKey) => string {
  const lang = useApp((s) => s.lang)
  return useCallback((key: I18nKey) => translate(lang, key), [lang])
}

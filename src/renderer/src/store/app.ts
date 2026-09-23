import { useCallback, useLayoutEffect, type RefObject } from 'react'
import { create } from 'zustand'
import type { AccountState } from '@shared/account'
import { rectsOverlap } from '@shared/ide-split'
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
  /**
   * Open popovers that overlap the column sash. That strip is a native view above the DOM, so it
   * is detached while this is > 0 (see IdePanel / IdeSplitController).
   */
  sashCovers: number
  /** Transient shell notice (bottom-centre), e.g. "cache cleared" or a failed sign-in. */
  toast: string | null

  init: () => Promise<void>
  setSetting: <K extends WritableSettingKey>(key: K, value: Settings[K]) => Promise<void>
  openModal: (id: ModalId) => void
  coverDevTools: (delta: 1 | -1) => void
  coverSash: (delta: 1 | -1) => void
  showToast: (message: string, ms?: number) => void
}

let toastTimer: ReturnType<typeof setTimeout> | undefined
let initPromise: Promise<void> | null = null
let settingWriteQueue: Promise<void> = Promise.resolve()
let settingsRevision = 0

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
  sashCovers: 0,
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
          settingsRevision += 1
          set({ settings: s, lang: resolveLanguage(s.language, systemLocale) })
          void invoke('mcp:getStatus').then((m) => set({ mcp: m }))
        })
        on('jsapi:consentClosed', ({ id }) => {
          const { consent, modal } = get()
          if (consent?.id !== id) return
          set({ consent: null, modal: modal === 'consent' ? null : modal })
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
        const revision = settingsRevision
        const settings = await invoke('settings:set', { [key]: value } as Partial<
          Pick<Settings, WritableSettingKey>
        >)
        if (settingsRevision !== revision) return
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

  coverSash(delta) {
    set((s) => ({ sashCovers: Math.max(0, s.sashCovers + delta) }))
  },

  showToast(message, ms = 2000) {
    clearTimeout(toastTimer)
    set({ toast: message })
    toastTimer = setTimeout(() => set({ toast: null }), ms)
  }
}))

/**
 * Hides native overlays while `open` and the popover overlaps them. Child views always paint
 * above the DOM, so a dropdown can sit on top only after DevTools and the column sash step aside.
 * Overlap is measured again while the popover stays open: column width and window size move the
 * sash without changing the menu's own box.
 */
export function useCoversDevTools(open: boolean, ref: RefObject<HTMLElement | null>): void {
  useLayoutEffect(() => {
    if (!open) return
    const el = ref.current
    if (!el) return
    let devtools = false
    let sash = false
    const apply = (nextDevtools: boolean, nextSash: boolean): void => {
      if (nextDevtools !== devtools) {
        useApp.getState().coverDevTools(nextDevtools ? 1 : -1)
        devtools = nextDevtools
      }
      if (nextSash !== sash) {
        useApp.getState().coverSash(nextSash ? 1 : -1)
        sash = nextSash
      }
    }
    const measure = (): void => {
      const menu = el.getBoundingClientRect()
      if (menu.width === 0 || menu.height === 0) return
      const hit = (selector: string): boolean => {
        const pane = document.querySelector(selector)
        return !!pane && rectsOverlap(menu, pane.getBoundingClientRect())
      }
      apply(hit('.devtoolsColumn'), hit('.resizer'))
    }
    const ro = new ResizeObserver(() => measure())
    const observe = (node: Element | null): void => {
      if (node) ro.observe(node)
    }
    const bind = (): void => {
      ro.disconnect()
      observe(el)
      observe(document.querySelector('.idePanel'))
      observe(document.querySelector('.simulatorColumn'))
      observe(document.querySelector('.devtoolsColumn'))
      observe(document.querySelector('.resizer'))
      measure()
    }
    const panel = document.querySelector('.idePanel')
    const mutations = new MutationObserver(() => bind())
    if (panel) mutations.observe(panel, { childList: true })
    window.addEventListener('resize', measure)
    bind()
    return () => {
      mutations.disconnect()
      ro.disconnect()
      window.removeEventListener('resize', measure)
      apply(false, false)
    }
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

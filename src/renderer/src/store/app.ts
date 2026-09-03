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

  init: () => Promise<void>
  setSetting: <K extends WritableSettingKey>(key: K, value: Settings[K]) => Promise<void>
  openModal: (id: ModalId) => void
}

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

  async init() {
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
      if (
        update.status === 'available' ||
        update.status === 'downloaded' ||
        update.status === 'error'
      )
        get().openModal('update')
    })
    on('jsapi:consent', (consent) => set({ consent, modal: 'consent' }))
  },

  async setSetting(key, value) {
    const settings = await invoke('settings:set', { [key]: value } as Partial<
      Pick<Settings, WritableSettingKey>
    >)
    set({ settings, lang: resolveLanguage(settings.language, systemLocale) })
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
  }
}))

/** Translation hook bound to the current language. */
export function useT(): (key: I18nKey) => string {
  const lang = useApp((s) => s.lang)
  return (key) => translate(lang, key)
}

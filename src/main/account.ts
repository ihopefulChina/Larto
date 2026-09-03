import { EventEmitter } from 'node:events'
import { join } from 'node:path'
import { app, BrowserWindow, safeStorage, session } from 'electron'
import { z } from 'zod'
import type { AccountInfo, AccountState, AccountTenant, AccountUser } from '@shared/account'
import {
  ENV_ENDPOINTS,
  LOGIN_PARTITION_PREFIX,
  OPEN_PLATFORM_APP_ID,
  buildLoginUrl
} from '@shared/constants'
import type { FeishuEnv, ResolvedLanguage } from '@shared/settings'
import { JsonStore } from './store'
import { HttpError, requestJson } from './http'
import { createLogger } from './logger'

const log = createLogger('account')

const LOGIN_TIMEOUT_MS = 180_000

/** Encrypted-at-rest persisted form. Secrets are `safeStorage` ciphertext (base64). */
const PersistedSchema = z.object({
  version: z.literal(1).default(1),
  env: z.enum(['feishu', 'lark']).nullable().default(null),
  sessionEnc: z.string().nullable().default(null),
  sessionListEnc: z.string().nullable().default(null),
  account: z.any().nullable().default(null)
})
type Persisted = z.infer<typeof PersistedSchema>

interface Secrets {
  session: string
  sessionList: string[]
}

export interface AccountEvents {
  change: [state: AccountState]
}

/** Extra headers passport expects from the IDE (docs/RESEARCH_OFFICIAL_TOOL.md §4.1). */
function passportHeaders(lang: ResolvedLanguage): Record<string, string> {
  return {
    'X-Api-Version': '1.0.0',
    'X-App-Id': OPEN_PLATFORM_APP_ID,
    'X-Device-Info': 'platform=websdk',
    'X-Locale': lang,
    'X-Terminal-Type': '2',
    'Accept-Language': lang
  }
}

export function cookieHeader(secrets: Secrets): string {
  return `session=${secrets.session}; session_list=${secrets.sessionList.join('_')}`
}

interface PassportUser {
  id: string
  name: string
  avatar_url?: string
  display_name?: string
  login_credential_id?: string
  tenant?: { id: string; name: string; icon_url?: string; tenant_brand?: string }
}

export class AccountService extends EventEmitter<AccountEvents> {
  private readonly store: JsonStore<Persisted>
  private secrets: Secrets | null = null
  private state: AccountState = { status: 'signedOut' }
  private loginWindow: BrowserWindow | null = null

  constructor(
    private readonly getEnv: () => FeishuEnv,
    private readonly getLang: () => ResolvedLanguage
  ) {
    super()
    this.store = new JsonStore(join(app.getPath('userData'), 'account.json'), PersistedSchema)
    this.restore()
  }

  getState(): AccountState {
    return this.state
  }

  /** Cookie header for open platform / passport calls, or null when signed out. */
  getCookie(): string | null {
    return this.secrets && this.state.status === 'signedIn' ? cookieHeader(this.secrets) : null
  }

  getSession(): string | null {
    return this.state.status === 'signedIn' ? (this.secrets?.session ?? null) : null
  }

  private setState(state: AccountState): void {
    this.state = state
    this.emit('change', state)
  }

  private restore(): void {
    const persisted = this.store.get()
    if (!persisted.sessionEnc || !persisted.sessionListEnc || !persisted.account || !persisted.env)
      return
    if (persisted.env !== this.getEnv()) return
    try {
      this.secrets = {
        session: decrypt(persisted.sessionEnc),
        sessionList: decrypt(persisted.sessionListEnc).split('_').filter(Boolean)
      }
      this.state = { status: 'signedIn', account: persisted.account as AccountInfo }
      // Validate lazily so startup is never blocked by the network.
      void this.refresh().catch((err) => log.warn('refresh after restore failed', err))
    } catch (err) {
      log.warn('could not decrypt stored session; signing out', err)
      this.store.set(PersistedSchema.parse({}))
    }
  }

  private persist(account: AccountInfo | null): void {
    if (!account || !this.secrets) {
      this.store.set(PersistedSchema.parse({}))
      return
    }
    this.store.set({
      version: 1,
      env: account.env,
      sessionEnc: encrypt(this.secrets.session),
      sessionListEnc: encrypt(this.secrets.sessionList.join('_')),
      account
    })
  }

  /** Re-fetches profile; on 401 marks the account expired (official `sessionExpired`). */
  async refresh(): Promise<AccountState> {
    if (!this.secrets || this.state.status === 'signedOut') return this.state
    try {
      const account = await this.loadAccount(this.getEnv(), this.secrets)
      this.persist(account)
      this.setState({ status: 'signedIn', account })
    } catch (err) {
      if (err instanceof HttpError && err.status === 401) {
        const previous =
          this.state.status === 'signedIn' || this.state.status === 'expired'
            ? this.state.account
            : null
        this.secrets = null
        this.persist(null)
        this.setState(previous ? { status: 'expired', account: previous } : { status: 'signedOut' })
      } else {
        throw err
      }
    }
    return this.state
  }

  async login(): Promise<AccountState> {
    if (this.state.status === 'signingIn') return this.state
    const env = this.getEnv()
    const lang = this.getLang()
    this.setState({ status: 'signingIn' })
    try {
      const secrets = await this.openLoginWindow(env, lang)
      const account = await this.loadAccount(env, secrets)
      this.secrets = secrets
      this.persist(account)
      this.setState({ status: 'signedIn', account })
      log.info(`signed in as ${account.user.name} @ ${account.tenant.name}`)
    } catch (err) {
      log.warn('login failed', err)
      this.setState({ status: 'signedOut' })
      throw err
    }
    return this.state
  }

  logout(): AccountState {
    this.loginWindow?.close()
    this.secrets = null
    this.persist(null)
    this.setState({ status: 'signedOut' })
    return this.state
  }

  async switchTenant(tenantUserId: string): Promise<AccountState> {
    if (!this.secrets || this.state.status !== 'signedIn') throw new Error('not signed in')
    const env = this.getEnv()
    const target = this.state.account.tenantList.find((t) => t.userId === tenantUserId)
    if (!target) throw new Error('unknown tenant')
    const ep = ENV_ENDPOINTS[env]
    const res = await requestJson<{ code?: number }>(`${ep.passport}/accounts/web/switch`, {
      method: 'POST',
      headers: passportHeaders(this.getLang()),
      cookie: cookieHeader(this.secrets),
      body: { user_id: target.userId, credential_id: this.state.account.user.loginCredentialId }
    })
    const setCookies = res.headers.getSetCookie?.() ?? []
    const next = { ...this.secrets }
    for (const c of setCookies) {
      const m = /^(session|session_list)=([^;]+)/.exec(c)
      if (m?.[1] === 'session' && m[2]) next.session = m[2]
      if (m?.[1] === 'session_list' && m[2]) next.sessionList = m[2].split('_').filter(Boolean)
    }
    this.secrets = next
    return this.refresh()
  }

  private async loadAccount(env: FeishuEnv, secrets: Secrets): Promise<AccountInfo> {
    const ep = ENV_ENDPOINTS[env]
    const headers = passportHeaders(this.getLang())
    const cookie = cookieHeader(secrets)
    const me = await requestJson<{ user: PassportUser }>(
      `${ep.passport}/accounts/web/user?app_id=${OPEN_PLATFORM_APP_ID}`,
      {
        headers,
        cookie
      }
    )
    const list = await requestJson<
      | { user_list?: { user: PassportUser; is_login: boolean }[] }
      | { user: PassportUser; is_login: boolean }[]
    >(`${ep.passport}/accounts/security/user/web_list`, {
      method: 'POST',
      headers,
      cookie,
      body: { app_id: Number(OPEN_PLATFORM_APP_ID) }
    }).catch((err) => {
      log.warn('web_list failed; continuing with current tenant only', err)
      return null
    })
    const u = me.data.user
    const user: AccountUser = {
      id: u.id,
      name: u.name,
      displayName: u.display_name ?? u.name,
      avatar: u.avatar_url ?? '',
      loginCredentialId: u.login_credential_id ?? ''
    }
    const toTenant = (pu: PassportUser, isLogin: boolean): AccountTenant => ({
      id: pu.tenant?.id ?? '',
      name: pu.tenant?.name ?? '',
      avatar: pu.tenant?.icon_url ?? '',
      brand: pu.tenant?.tenant_brand ?? env,
      isLogin,
      userId: pu.id
    })
    const rawList = list ? (Array.isArray(list.data) ? list.data : (list.data.user_list ?? [])) : []
    const tenantList = rawList.map((e) => toTenant(e.user, e.is_login))
    const tenant = tenantList.find((t) => t.userId === u.id) ?? toTenant(u, true)
    return { env, user, tenant, tenantList: tenantList.length ? tenantList : [tenant] }
  }

  /**
   * Opens the Feishu passport login page (QR code + password) in a child window using a
   * throw-away session partition, and resolves with the `session`/`session_list` cookies
   * once passport redirects to the IDE success page (docs/RESEARCH_OFFICIAL_TOOL.md §4).
   */
  private openLoginWindow(env: FeishuEnv, lang: ResolvedLanguage): Promise<Secrets> {
    return new Promise<Secrets>((resolve, reject) => {
      const partition = `${LOGIN_PARTITION_PREFIX}${Date.now()}`
      const ses = session.fromPartition(partition)
      const parent = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed() && w.isVisible())
      const win = new BrowserWindow({
        width: 600,
        height: 720,
        resizable: false,
        minimizable: false,
        titleBarStyle: 'hiddenInset',
        title: lang === 'zh-CN' ? '登录飞书' : 'Sign in to Feishu',
        show: false,
        ...(parent ? { parent } : {}),
        webPreferences: { partition, sandbox: true, contextIsolation: true, nodeIntegration: false }
      })
      this.loginWindow = win
      let settled = false
      const finish = (fn: () => void) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        fn()
        if (!win.isDestroyed()) win.close()
        void ses.clearStorageData().catch(() => undefined)
      }
      const timer = setTimeout(
        () => finish(() => reject(new Error('login timeout'))),
        LOGIN_TIMEOUT_MS
      )

      win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
      win.webContents.on('did-finish-load', () => {
        void win.webContents.insertCSS(
          '.passport-layout-web-login.web-v3-layout-box{padding:20px 5px;height:calc(100% - 40px);width:auto}'
        )
      })
      win.webContents.on('did-navigate', (_e, url) => {
        if (!isSuccessPage(url)) return
        void ses.cookies.get({}).then((cookies) => {
          const sessionCookie = cookies.find((c) => c.name === 'session')?.value
          const listCookie = cookies.find((c) => c.name === 'session_list')?.value
          if (!sessionCookie || !listCookie) {
            finish(() => reject(new Error('get session error')))
            return
          }
          finish(() =>
            resolve({ session: sessionCookie, sessionList: listCookie.split('_').filter(Boolean) })
          )
        })
      })
      win.once('ready-to-show', () => win.show())
      win.on('closed', () => {
        this.loginWindow = null
        finish(() => reject(new Error('login cancelled')))
      })
      void win.loadURL(buildLoginUrl(env, lang))
    })
  }
}

function isSuccessPage(url: string): boolean {
  try {
    return new URL(url).pathname.endsWith('success.html')
  } catch {
    return false
  }
}

function encrypt(plain: string): string {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('safeStorage unavailable')
  return safeStorage.encryptString(plain).toString('base64')
}

function decrypt(b64: string): string {
  return safeStorage.decryptString(Buffer.from(b64, 'base64'))
}

import { EventEmitter } from 'node:events'
import { join } from 'node:path'
import { app, BrowserWindow, safeStorage, session, type Session } from 'electron'
import { z } from 'zod'
import type { AccountInfo, AccountState, AccountTenant, AccountUser } from '@shared/account'
import {
  ENV_ENDPOINTS,
  LOGIN_PARTITION_PREFIX,
  OPEN_PLATFORM_APP_ID,
  buildLoginUrl
} from '@shared/constants'
import type { FeishuEnv, ProxySettings, ResolvedLanguage } from '@shared/settings'
import { JsonStore } from './store'
import { HttpError, requestJson } from './http'
import { createLogger } from './logger'
import { summarizeErrorForLog } from './log-summary'
import { applyProxyToSession } from './proxy'
import {
  brandMatchesEnv,
  NOT_LOGIN_CODE,
  parseSessionCookies,
  SESSION_EXPIRED_CODES,
  SessionExpiredError,
  toUserEntries,
  unwrapPassport,
  type Envelope,
  type PassportUser,
  type PassportUserEntry
} from './passport'

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

/**
 * Electron's Linux `basic_text` backend reports encryption as available even though it only
 * obfuscates the value. Never persist a Feishu session unless the selected OS backend actually
 * protects it; an unsupported Linux desktop can still stay signed in for the current process.
 */
export function hasSecureAccountStorage(platform: NodeJS.Platform = process.platform): boolean {
  if (!safeStorage.isEncryptionAvailable()) return false
  if (platform !== 'linux') return true
  try {
    const backend = safeStorage.getSelectedStorageBackend()
    return backend !== 'basic_text' && backend !== 'unknown'
  } catch {
    return false
  }
}

/** Passport sign-in does not need browser permissions; its throw-away partition denies all. */
export function denyAllSessionPermissions(
  target: Pick<Session, 'setPermissionCheckHandler' | 'setPermissionRequestHandler'>
): void {
  target.setPermissionCheckHandler(() => false)
  target.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
}

export class AccountService extends EventEmitter<AccountEvents> {
  private readonly store: JsonStore<Persisted>
  private secrets: Secrets | null = null
  private state: AccountState = { status: 'signedOut' }
  private loginWindow: BrowserWindow | null = null
  private warnedMemoryOnly = false

  constructor(
    private readonly getEnv: () => FeishuEnv,
    private readonly getLang: () => ResolvedLanguage,
    private readonly getProxy: () => ProxySettings
  ) {
    super()
    this.store = new JsonStore(join(app.getPath('userData'), 'account.json'), PersistedSchema)
  }

  getState(): AccountState {
    return this.state
  }

  /** Reconfigure an already-open login window as part of a live proxy policy change. */
  async applyProxy(proxy: ProxySettings): Promise<void> {
    const win = this.loginWindow
    if (!win || win.isDestroyed()) return
    await applyProxyToSession(win.webContents.session, proxy)
    if (this.loginWindow === win && !win.isDestroyed()) win.webContents.reload()
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

  /**
   * Decrypt the persisted session. Must run after `app.whenReady()` because every platform's
   * secure-storage backend is selected during application startup.
   */
  restore(): void {
    const persisted = this.store.get()
    if (!persisted.sessionEnc || !persisted.sessionListEnc || !persisted.account || !persisted.env)
      return
    if (persisted.env !== this.getEnv()) return
    if (!hasSecureAccountStorage()) {
      // A session written while a real keyring was available must not be handed to Linux's
      // `basic_text` fallback (nor should old basic-text data remain on disk).
      log.warn('secure credential storage unavailable; discarding persisted session')
      this.clearPersistedSessionBestEffort()
      return
    }
    try {
      this.secrets = {
        session: decrypt(persisted.sessionEnc),
        sessionList: decrypt(persisted.sessionListEnc).split('_').filter(Boolean)
      }
      this.state = { status: 'signedIn', account: persisted.account as AccountInfo }
      // Validate lazily so startup is never blocked by the network.
      void this.refresh().catch((err) =>
        log.warn('refresh after restore failed', summarizeErrorForLog(err))
      )
    } catch (err) {
      // Keychain access can be denied transiently (unsigned builds re-prompt on every launch).
      // Stay signed out for this run but keep the file; a later launch or a fresh login fixes it.
      log.warn(
        'could not decrypt stored session; signed out for this session',
        summarizeErrorForLog(err)
      )
      this.secrets = null
    }
  }

  private persist(account: AccountInfo | null): void {
    if (!account || !this.secrets) {
      this.clearPersistedSession()
      return
    }
    if (!hasSecureAccountStorage()) {
      if (!this.warnedMemoryOnly) {
        this.warnedMemoryOnly = true
        log.warn('secure credential storage unavailable; keeping session in memory only')
      }
      this.clearPersistedSessionBestEffort()
      return
    }
    let sessionEnc: string
    let sessionListEnc: string
    try {
      sessionEnc = encrypt(this.secrets.session)
      sessionListEnc = encrypt(this.secrets.sessionList.join('_'))
    } catch (err) {
      // Losing persistence must not turn a successful network login into a failed login. Keep
      // the authenticated process alive, but never fall back to plaintext storage.
      log.warn(
        'could not encrypt account session; keeping session in memory only',
        summarizeErrorForLog(err)
      )
      this.clearPersistedSessionBestEffort()
      return
    }
    this.store.set({
      version: 1,
      env: account.env,
      sessionEnc,
      sessionListEnc,
      account
    })
  }

  private clearPersistedSession(): void {
    this.store.set(PersistedSchema.parse({}))
  }

  private clearPersistedSessionBestEffort(): void {
    try {
      this.clearPersistedSession()
    } catch (err) {
      // The in-memory session is still safe and usable. Report the exact storage failure without
      // leaking any credential material into logs.
      log.warn('could not clear persisted account session', summarizeErrorForLog(err))
    }
  }

  /**
   * Re-fetches the profile; an expired session (HTTP 401 or passport code 34/4401/4) marks the
   * account expired like the official `sessionExpired` hook. Other errors (offline…) keep state.
   */
  async refresh(): Promise<AccountState> {
    if (!this.secrets || this.state.status === 'signedOut') return this.state
    try {
      const account = await this.loadAccount(this.getEnv(), this.secrets, true)
      this.persist(account)
      this.setState({ status: 'signedIn', account })
    } catch (err) {
      if (isSessionExpired(err)) {
        log.warn('passport session expired; signing out', summarizeErrorForLog(err))
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
    if (this.state.status === 'signingIn') {
      this.loginWindow?.focus()
      return this.state
    }
    const env = this.getEnv()
    const lang = this.getLang()
    const previous = this.state
    this.setState({ status: 'signingIn' })
    try {
      const secrets = await this.openLoginWindow(env, lang)
      const account = await this.loadAccount(env, secrets, false)
      this.secrets = secrets
      this.persist(account)
      this.setState({ status: 'signedIn', account })
      log.info(`signed in (${account.tenantList.length} tenant(s), env=${env})`)
    } catch (err) {
      log.warn('login failed', summarizeErrorForLog(err))
      // A cancelled re-login must not throw away a still valid session, nor the expired
      // account the menu was showing.
      const keep = (previous.status === 'signedIn' && this.secrets) || previous.status === 'expired'
      this.setState(keep ? previous : { status: 'signedOut' })
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
    // Official `switchTenant`: POST { user_id, credential_id } of the *target* identity and read
    // the new `session` / `session_list` cookies from the response headers.
    const res = await requestJson<Envelope<unknown>>(`${ep.passport}/accounts/web/switch`, {
      method: 'POST',
      headers: passportHeaders(this.getLang()),
      cookie: cookieHeader(this.secrets),
      body: {
        user_id: target.userId,
        credential_id: target.credentialId || this.state.account.user.loginCredentialId
      }
    })
    const cookies = parseSessionCookies(res.headers.getSetCookie?.() ?? [])
    if (!cookies.session) {
      const code = res.data?.code ?? 0
      if (SESSION_EXPIRED_CODES.has(code) || code === NOT_LOGIN_CODE)
        throw new SessionExpiredError(code)
      throw new Error(
        `switch tenant failed: ${res.data?.message ?? res.data?.msg ?? `code ${code}, no session cookie`}`
      )
    }
    // Swap cookies and state together: if the new identity cannot be loaded (network…), the
    // old session and the old tenant stay in place instead of drifting apart.
    const next: Secrets = {
      session: cookies.session,
      sessionList: cookies.sessionList ?? this.secrets.sessionList
    }
    try {
      const account = await this.loadAccount(env, next, true)
      this.secrets = next
      this.persist(account)
      this.setState({ status: 'signedIn', account })
    } catch (err) {
      if (!isSessionExpired(err)) throw err
      // The *new* cookies are already dead; the old ones are most likely gone too (passport
      // rotates the session on switch), so treat it like an expired refresh.
      this.secrets = next
      return this.refresh()
    }
    return this.state
  }

  /**
   * Profile + tenant list, following the official `loginV2`: `GET /accounts/web/user` (current
   * identity), `POST /accounts/security/user/web_list` (identities that already have a
   * session) and `POST /accounts/security/user/user_center` (every bound identity; the ones not
   * in `web_list` are listed as `isLogin: false`). Only the first call is fatal.
   */
  private async loadAccount(
    env: FeishuEnv,
    secrets: Secrets,
    signedIn: boolean
  ): Promise<AccountInfo> {
    const ep = ENV_ENDPOINTS[env]
    const headers = passportHeaders(this.getLang())
    const cookie = cookieHeader(secrets)
    const appId = Number(OPEN_PLATFORM_APP_ID)
    const me = unwrapPassport(
      (
        await requestJson<Envelope<{ user?: PassportUser }>>(
          `${ep.passport}/accounts/web/user?app_id=${OPEN_PLATFORM_APP_ID}`,
          { headers, cookie }
        )
      ).data,
      signedIn
    )
    const u = me.user
    if (!u || typeof u.id !== 'string') throw new Error('passport: /accounts/web/user has no user')

    const optional = async (path: string, label: string): Promise<PassportUserEntry[]> => {
      try {
        const res = await requestJson<Envelope<unknown>>(`${ep.passport}${path}`, {
          method: 'POST',
          headers,
          cookie,
          body: { app_id: appId }
        })
        return toUserEntries(unwrapPassport(res.data, signedIn))
      } catch (err) {
        if (isSessionExpired(err)) throw err
        log.warn(`${label} failed; continuing without it`, summarizeErrorForLog(err))
        return []
      }
    }
    const loggedIn = await optional('/accounts/security/user/web_list', 'web_list')
    const bound = await optional('/accounts/security/user/user_center', 'user_center')

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
      userId: pu.id,
      credentialId: pu.login_credential_id ?? ''
    })
    const seen = new Set<string>()
    const tenantList: AccountTenant[] = []
    const add = (pu: PassportUser, isLogin: boolean) => {
      if (seen.has(pu.id) || !brandMatchesEnv(pu.tenant?.tenant_brand, env)) return
      seen.add(pu.id)
      tenantList.push(toTenant(pu, isLogin))
    }
    for (const e of loggedIn) add(e.user, e.is_login ?? true)
    for (const e of bound) add(e.user, false)
    if (!seen.has(u.id)) tenantList.unshift(toTenant(u, true))
    const tenant = tenantList.find((t) => t.userId === u.id) ?? toTenant(u, true)
    // The current identity is by definition logged in even if web_list omitted it.
    tenant.isLogin = true
    return { env, user, tenant, tenantList }
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
      denyAllSessionPermissions(ses)
      const parent = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed() && w.isVisible())
      const win = new BrowserWindow({
        width: 600,
        height: 720,
        resizable: false,
        minimizable: false,
        ...(process.platform === 'darwin' ? { titleBarStyle: 'hiddenInset' as const } : {}),
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
      // This throw-away partition is not one of the long-lived sessions configured at startup.
      // Apply the current policy before its first request so QR/password login never bypasses the
      // proxy selected in Settings. Proxy and navigation failures reject the existing login flow.
      void Promise.resolve()
        .then(() => applyProxyToSession(ses, this.getProxy()))
        .then(() => {
          if (!settled && !win.isDestroyed()) return win.loadURL(buildLoginUrl(env, lang))
          return undefined
        })
        .catch((err) => finish(() => reject(err)))
    })
  }
}

function isSessionExpired(err: unknown): boolean {
  return err instanceof SessionExpiredError || (err instanceof HttpError && err.status === 401)
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

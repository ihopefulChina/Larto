/**
 * Pure helpers for talking to Feishu passport (no Electron imports so they can be unit-tested).
 * Response shapes follow the official IDE core (`Middleware.formatResponse` /
 * `Middleware.isSessionExpired` / `AccountModule.formatTenantList`, docs/RESEARCH_OFFICIAL_TOOL.md §4).
 */
import type { FeishuEnv } from '@shared/settings'

export interface PassportUser {
  id: string
  name: string
  avatar_url?: string
  display_name?: string
  login_credential_id?: string
  tenant?: { id: string; name: string; icon_url?: string; tenant_brand?: string }
}

/** Entry of `/accounts/security/user/web_list` and of `user_center` identities. */
export interface PassportUserEntry {
  user: PassportUser
  is_login?: boolean
}

/**
 * Every passport/open-platform response is wrapped as `{ code, message, data }`; the official
 * client hands `data` to callers and treats these codes as an expired session regardless of
 * the HTTP status.
 */
export interface Envelope<T> {
  code?: number
  message?: string
  msg?: string
  data?: T
}

export const SESSION_EXPIRED_CODES: ReadonlySet<number> = new Set([34, 4401])
export const NOT_LOGIN_CODE = 4

export class SessionExpiredError extends Error {
  constructor(readonly code: number | 'http-401') {
    super(`passport session expired (${code})`)
    this.name = 'SessionExpiredError'
  }
}

/** Tenants of the other brand are hidden, like the official `isbrandInEnv` filter. */
export function brandMatchesEnv(brand: string | undefined, env: FeishuEnv): boolean {
  if (!brand) return true
  return env === 'feishu'
    ? ['feishu', 'feishu-boe', 'feishu-pre'].includes(brand)
    : ['lark', 'lark-boe', 'lark-pre'].includes(brand)
}

/** Unwraps the passport envelope; `signedIn` decides whether `code 4` means "expired". */
export function unwrapPassport<T>(body: Envelope<T> | null | undefined, signedIn: boolean): T {
  if (!body || typeof body !== 'object') throw new Error('passport: empty response')
  const code = body.code ?? 0
  if (SESSION_EXPIRED_CODES.has(code) || (code === NOT_LOGIN_CODE && signedIn))
    throw new SessionExpiredError(code)
  if (code !== 0) throw new Error(`passport: code ${code} ${body.message ?? body.msg ?? ''}`.trim())
  if (body.data === undefined || body.data === null) throw new Error('passport: no data')
  return body.data
}

/**
 * `web_list` returns the logged-in identities as a bare array; `user_center` nests every
 * bound identity under `step_info.credential_binding_identities[].user_list`. Accept both.
 */
export function toUserEntries(data: unknown): PassportUserEntry[] {
  if (Array.isArray(data)) return data.filter(isUserEntry)
  if (data && typeof data === 'object') {
    const d = data as {
      user_list?: unknown
      step_info?: { credential_binding_identities?: { user_list?: unknown }[] }
    }
    if (Array.isArray(d.user_list)) return d.user_list.filter(isUserEntry)
    const identities = d.step_info?.credential_binding_identities
    if (Array.isArray(identities))
      return identities.flatMap((i) =>
        Array.isArray(i.user_list) ? i.user_list.filter(isUserEntry) : []
      )
  }
  return []
}

function isUserEntry(e: unknown): e is PassportUserEntry {
  const u = (e as PassportUserEntry | null)?.user
  return !!u && typeof u === 'object' && typeof u.id === 'string'
}

/** New `session` / `session_list` cookies from `/accounts/web/switch`'s Set-Cookie headers. */
export function parseSessionCookies(setCookies: readonly string[]): {
  session?: string
  sessionList?: string[]
} {
  const out: { session?: string; sessionList?: string[] } = {}
  for (const c of setCookies) {
    const m = /^\s*(session|session_list)=([^;]+)/.exec(c)
    if (!m?.[2]) continue
    if (m[1] === 'session') out.session = m[2]
    else out.sessionList = m[2].split('_').filter(Boolean)
  }
  return out
}

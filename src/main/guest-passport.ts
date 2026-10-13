/**
 * Guest-side passport request rewriting, mirroring the official tool
 * (official tool reference §3 BaseWindow + §4.4 guest session):
 * requests the H5 page itself sends to the passport/open-platform auth
 * endpoints get the signed-in account's session cookies injected at the
 * header layer (the guest partition's own cookie jar is deliberately not
 * logged in) and are marked with `X-Device-Info: platform=websdk`.
 *
 * Pure functions only (no Electron imports) so they stay unit-testable.
 */
import { ENV_ENDPOINTS } from '@shared/constants'

/**
 * Official BaseWindow passport path table (7 paths, 5 patterns): tenant switch,
 * user identity lists and the authen family — plus `/authen/v1/authorize`, the
 * OAuth web-flow entry that H5 pages redirect to (`open.feishu.cn/open-apis/
 * authen/v1/authorize`); without an injected session that navigation bounces to
 * the accounts login page. The whole `/authen/v1/` family is covered by prefix
 * because the endpoint names drift over time (confirm vs confirm_inner) and the
 * open-origin variants appear both with and without the `/open-apis` prefix —
 * the prefix is stripped before matching.
 */
const PASSPORT_API_PATHS: readonly string[] = [
  '/accounts/web/switch',
  '/accounts/security/user/',
  '/accounts/auth/code/',
  '/authen/v1/'
]

/**
 * Origins whose requests get the account session injected. Covers the passport
 * host, the accounts host (where the web session actually lives — the OAuth
 * authorize flow lands there after open.* delegates to it) and the open host.
 */
export function passportApiOrigins(): string[] {
  return Object.values(ENV_ENDPOINTS).flatMap((ep) => [ep.passport, ep.accounts, ep.open])
}

/** Hostnames of the passport + accounts origins (for cookie-domain matching). */
export function passportHosts(): string[] {
  return [
    ...new Set(
      Object.values(ENV_ENDPOINTS).flatMap((ep) => [
        new URL(ep.passport).hostname,
        new URL(ep.accounts).hostname
      ])
    )
  ]
}

/** True when the URL is one of the passport endpoints the official tool rewrites. */
export function isPassportApiUrl(url: string, origins: readonly string[]): boolean {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  if (!origins.includes(parsed.origin)) return false
  const pathname = parsed.pathname.replace(/^\/open-apis(?=\/)/, '')
  return PASSPORT_API_PATHS.some((p) => pathname === p || pathname.startsWith(p))
}

/**
 * Official cookie splice: drop the guest's own `session`/`session_list` entries
 * and append the account's `session=…; session_list=…` pair (`_` joined).
 */
export function rewriteCookieHeader(existing: string | undefined, accountCookie: string): string {
  const kept = (existing ?? '')
    .split(';')
    .map((c) => c.trim())
    .filter(Boolean)
    .filter((c) => {
      const eq = c.indexOf('=')
      const name = eq === -1 ? c : c.slice(0, eq).trim()
      return name !== 'session' && name !== 'session_list'
    })
  return [...kept, accountCookie].join('; ')
}

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
 * user identity lists, auth code exchange and the authen confirm pair. The
 * `/accounts/*` paths live on the passport origin, `/authen/v1/*` on the open
 * origin — both are covered by `passportApiOrigins()`.
 */
const PASSPORT_API_PATHS: readonly string[] = [
  '/accounts/web/switch',
  '/accounts/security/user/',
  '/accounts/auth/code/',
  '/authen/v1/get_auth_info_inner',
  '/authen/v1/confirm_inner'
]

/** Passport + open origins of every supported env. */
export function passportApiOrigins(): string[] {
  return Object.values(ENV_ENDPOINTS).flatMap((ep) => [ep.passport, ep.open])
}

/** Hostnames of the passport origins (for cookie-domain matching). */
export function passportHosts(): string[] {
  return [...new Set(Object.values(ENV_ENDPOINTS).map((ep) => new URL(ep.passport).hostname))]
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
  return PASSPORT_API_PATHS.some((p) => parsed.pathname === p || parsed.pathname.startsWith(p))
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

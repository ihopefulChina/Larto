import { DEFAULT_PAGE_PATTERN } from './constants'
import { MAX_URL_LENGTH } from './settings'

/**
 * Address bar normalisation, identical to the official tool (§7): trim, cap at 2048
 * characters, prepend `http://` when no scheme is present. Returns null for empty input.
 */
export function normalizeUrl(input: string): string | null {
  const trimmed = input.trim().slice(0, MAX_URL_LENGTH)
  if (!trimmed) return null
  // `localhost:5173` must not be mistaken for a `localhost:` scheme.
  const candidate =
    /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) || /^(about|data|blob|file):/i.test(trimmed)
      ? trimmed
      : `http://${trimmed}`
  try {
    const parsed = new URL(candidate)
    if ((parsed.protocol === 'http:' || parsed.protocol === 'https:') && !parsed.hostname)
      return null
    return candidate
  } catch {
    return null
  }
}

/** Official default pages are hidden from the address bar. */
export function isDefaultPage(url: string): boolean {
  try {
    return DEFAULT_PAGE_PATTERN.test(new URL(url).pathname)
  } catch {
    return false
  }
}

export function displayUrl(url: string): string {
  return !url || url === 'about:blank' || isDefaultPage(url) ? '' : url
}

/**
 * Official page-driven tenant/debug protocol (official tool reference §3): a page
 * navigation ending in `#mode=account` tells the tool to adopt the guest partition's
 * session as the account; `#mode=debug` switches the guest to the page's own identity.
 */
export function guestHashMode(url: string): 'account' | 'debug' | null {
  try {
    const hash = new URL(url).hash
    if (hash === '#mode=account') return 'account'
    if (hash === '#mode=debug' || hash.startsWith('#mode=debug&')) return 'debug'
    return null
  } catch {
    return null
  }
}

/**
 * `opdev://` deep links (official URL scheme). Accepts `opdev://open?url=<http(s) url>`
 * and `opdev://<host>/<path>` forms; returns the wrapped http(s) target or null.
 */
export function parseOpdevDeepLink(raw: string): string | null {
  if (!raw.startsWith('opdev://')) return null
  try {
    const parsed = new URL(raw)
    const query = parsed.searchParams.get('url')
    if (query && /^https?:\/\//i.test(query)) return query
    const candidate = decodeURIComponent(`${parsed.host}${parsed.pathname}`.replace(/^\/*/, ''))
    if (/^https?:\/\//i.test(candidate)) return candidate
  } catch {
    /* fall through */
  }
  return null
}

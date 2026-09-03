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
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) || /^(about|data|blob|file):/i.test(trimmed))
    return trimmed
  return `http://${trimmed}`
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

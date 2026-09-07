import { app, session } from 'electron'
import { APP_NAME } from '@shared/constants'
import { createLogger } from './logger'
import { summarizeErrorForLog } from './log-summary'

const log = createLogger('http')

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT'
  headers?: Record<string, string>
  body?: unknown
  /** Cookie header value, e.g. "session=…; session_list=…" */
  cookie?: string
  timeoutMs?: number
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly url: string,
    readonly bodyText: string
  ) {
    super(`HTTP ${status} for ${url}`)
  }
}

/**
 * Thin JSON HTTP client for passport / open platform calls.
 * Uses the default Electron session's fetch so passport/open-platform calls obey the same
 * system/manual/direct proxy policy as the guest. Cookies remain explicit and independent from
 * the session cookie jar.
 */
export async function requestJson<T = unknown>(
  url: string,
  opts: RequestOptions = {}
): Promise<{ status: number; headers: Headers; data: T }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 15000)
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'User-Agent': `opdev-ide/${app.getVersion()} ${APP_NAME}`,
    ...opts.headers
  }
  if (opts.cookie) headers['Cookie'] = opts.cookie
  let body: string | undefined
  if (opts.body !== undefined) {
    body = typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body)
    headers['Content-Type'] ??= 'application/json'
  }
  try {
    const res = await session.defaultSession.fetch(url, {
      method: opts.method ?? 'GET',
      headers,
      ...(body !== undefined ? { body } : {}),
      // Chromium otherwise replaces our explicit passport session with unrelated cookies from
      // the default session's jar (for example passport_web_did), which makes a fresh login 401.
      credentials: 'omit',
      signal: controller.signal,
      redirect: 'manual'
    })
    const text = await res.text()
    let data: unknown = null
    try {
      data = text ? JSON.parse(text) : null
    } catch {
      data = text
    }
    if (!res.ok) throw new HttpError(res.status, url, text)
    return { status: res.status, headers: res.headers, data: data as T }
  } catch (err) {
    if (!(err instanceof HttpError)) {
      let host = 'invalid-url'
      try {
        host = new URL(url).host
      } catch {
        /* only the non-sensitive classification is logged */
      }
      log.warn('request failed', {
        method: opts.method ?? 'GET',
        host,
        ...summarizeErrorForLog(err)
      })
    }
    throw err
  } finally {
    clearTimeout(timer)
  }
}

import { app } from 'electron'
import { createLogger } from './logger'

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
 * Uses Node's fetch (undici) so we can set the Cookie header explicitly and stay
 * independent from any Electron session cookie jar. Proxy support: see
 * `applyProxyToNodeFetch` in settings phase (docs/IMPLEMENTATION_PLAN.md).
 */
export async function requestJson<T = unknown>(
  url: string,
  opts: RequestOptions = {}
): Promise<{ status: number; headers: Headers; data: T }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 15000)
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'User-Agent': `opdev-ide/${app.getVersion()} FeishuDevTools`,
    ...opts.headers
  }
  if (opts.cookie) headers['Cookie'] = opts.cookie
  let body: string | undefined
  if (opts.body !== undefined) {
    body = typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body)
    headers['Content-Type'] ??= 'application/json'
  }
  try {
    const res = await fetch(url, {
      method: opts.method ?? 'GET',
      headers,
      ...(body !== undefined ? { body } : {}),
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
    if (!(err instanceof HttpError)) log.warn(`request failed ${opts.method ?? 'GET'} ${url}`, err)
    throw err
  } finally {
    clearTimeout(timer)
  }
}

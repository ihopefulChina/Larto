/**
 * Feishu Open Platform calls that back the JSAPI bridge and PC preview.
 * Endpoints and payloads are reverse-engineered from the official tool
 * (docs/RESEARCH_OFFICIAL_TOOL.md §4.1, §5.3, §6). All of them need a signed-in session.
 */
import { ENV_ENDPOINTS } from '@shared/constants'
import type { AccessConsentInfo } from '@shared/ipc'
import type { JsapiConfigParams } from '@shared/jsapi'
import type { FeishuEnv } from '@shared/settings'
import { requestJson } from './http'

export interface OpenApiSession {
  env: FeishuEnv
  session: string
  cookie: string
}

export interface VerifyResult {
  code: number
  msg?: string
}

export async function verifyJsapiSignature(
  s: OpenApiSession,
  url: string,
  cfg: JsapiConfigParams
): Promise<VerifyResult> {
  const ep = ENV_ENDPOINTS[s.env]
  const res = await requestJson<VerifyResult>(`${ep.open}/openapi/jssdk/verify`, {
    method: 'POST',
    headers: { 'X-Session-ID': s.session },
    cookie: s.cookie,
    body: {
      url,
      app_id: cfg.appId,
      js_api_list: cfg.jsApiList,
      nonce_str: cfg.nonceStr,
      signature: cfg.signature,
      timestamp: cfg.timestamp
    }
  })
  return res.data
}

/** Maps open platform verify codes to the JSAPI error code the JSSDK expects. */
export function verifyCodeToJsapiError(code: number): number {
  const str = String(code)
  return str.length >= 8 ? code : Number(`333${str.slice(2)}`)
}

export async function requestAuthCode(
  s: OpenApiSession,
  appId: string,
  url: string
): Promise<{ code: string }> {
  const ep = ENV_ENDPOINTS[s.env]
  const res = await requestJson<{ code: number; msg?: string; data?: { code?: string } }>(
    `${ep.open}/open-platform/api/LoginH5`,
    { method: 'POST', cookie: s.cookie, body: { appid: appId, sessionid: s.session, url } }
  )
  if (res.data.code !== 0 || !res.data.data?.code) {
    throw Object.assign(new Error(res.data.msg ?? 'LoginH5 failed'), { code: res.data.code })
  }
  return { code: res.data.data.code }
}

export interface RequestAccessParams {
  appId: string
  scopeList: string[]
  state?: string
}

export interface RequestAccessResult {
  autoConfirm: boolean
  code?: string
  state?: string
  /** Present when the server wants the user to confirm the scopes first. */
  consent?: AccessConsentInfo
}

/** Raw shape of `get_auth_info_inner` / `confirm_inner` payloads (passport web SDK). */
export interface AuthInfoInnerData {
  auto_confirm?: boolean
  code?: string
  state?: string
  app_info?: { app_name?: string; app_icon_url?: string }
  suite_info?: { suite_icon_url?: string }
  current_user?: {
    user_name?: string
    tenant_icon_url?: string
    scope_list?: { name?: string; desc?: string }[]
  }
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '')

/** Extracts the consent dialog data; `null` when the payload carries no `app_info`. */
export function parseAccessConsent(d: AuthInfoInnerData): AccessConsentInfo | null {
  if (!d.app_info) return null
  return {
    appName: str(d.app_info.app_name),
    appIconUrl: str(d.app_info.app_icon_url),
    suiteIconUrl: str(d.suite_info?.suite_icon_url),
    userName: str(d.current_user?.user_name),
    tenantIconUrl: str(d.current_user?.tenant_icon_url),
    scopes: (d.current_user?.scope_list ?? [])
      .map((sc) => ({ name: str(sc.name), desc: str(sc.desc) || str(sc.name) }))
      .filter((sc) => sc.desc)
  }
}

function accessBody(p: RequestAccessParams, url: string) {
  return {
    app_id: p.appId,
    scope: p.scopeList.join(' '),
    state: p.state ?? '',
    open_app_type: 2,
    redirect_uri: url
  }
}

async function postAuthen(
  s: OpenApiSession,
  path: 'get_auth_info_inner' | 'confirm_inner',
  p: RequestAccessParams,
  url: string
): Promise<AuthInfoInnerData> {
  const ep = ENV_ENDPOINTS[s.env]
  const res = await requestJson<{ code: number; msg?: string; data?: AuthInfoInnerData }>(
    `${ep.open}/authen/v1/${path}`,
    {
      method: 'POST',
      headers: { 'X-Device-Info': 'platform=websdk' },
      cookie: s.cookie,
      body: accessBody(p, url)
    }
  )
  if (res.data.code !== 0)
    throw Object.assign(new Error(res.data.msg ?? `${path} failed`), { code: res.data.code })
  return res.data.data ?? {}
}

export async function requestAccess(
  s: OpenApiSession,
  p: RequestAccessParams,
  url: string
): Promise<RequestAccessResult> {
  const d = await postAuthen(s, 'get_auth_info_inner', p, url)
  const consent = parseAccessConsent(d)
  return {
    autoConfirm: !!d.auto_confirm,
    ...(d.code ? { code: d.code } : {}),
    ...(d.state ? { state: d.state } : {}),
    ...(consent ? { consent } : {})
  }
}

/**
 * Second step after the user accepted the consent dialog. The official AuthzModal posts the
 * very same auth params to `/authen/v1/confirm_inner` and reads `data.code`.
 */
export async function confirmAccess(
  s: OpenApiSession,
  p: RequestAccessParams,
  url: string
): Promise<{ code: string; state: string }> {
  const d = await postAuthen(s, 'confirm_inner', p, url)
  if (!d.code) throw Object.assign(new Error('confirm_inner returned no code'), { code: 20050 })
  return { code: d.code, state: d.state ?? p.state ?? '' }
}

export async function pushPcPreview(
  s: OpenApiSession,
  previewUrl: string,
  appId?: string
): Promise<void> {
  const ep = ENV_ENDPOINTS[s.env]
  const res = await requestJson<{ code: number; msg?: string }>(
    `${ep.open}/miniprogram/api/v4/h5/push_preview`,
    {
      method: 'PUT',
      cookie: s.cookie,
      body: { preview_url: previewUrl, app_id: appId ?? '' }
    }
  )
  if (res.data.code !== 0) throw new Error(res.data.msg ?? `push_preview failed (${res.data.code})`)
}

/**
 * Feishu Open Platform calls that back the JSAPI bridge and PC preview.
 * Endpoints and payloads are reverse-engineered from the official tool
 * (docs/RESEARCH_OFFICIAL_TOOL.md §4.1, §5.3, §6). All of them need a signed-in session.
 */
import { ENV_ENDPOINTS } from '@shared/constants'
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
  raw: unknown
}

export async function requestAccess(
  s: OpenApiSession,
  p: RequestAccessParams,
  url: string
): Promise<RequestAccessResult> {
  const ep = ENV_ENDPOINTS[s.env]
  const res = await requestJson<{
    code: number
    msg?: string
    data?: { auto_confirm?: boolean; code?: string; state?: string }
  }>(`${ep.open}/authen/v1/get_auth_info_inner`, {
    method: 'POST',
    headers: { 'X-Device-Info': 'platform=websdk' },
    cookie: s.cookie,
    body: {
      app_id: p.appId,
      scope: p.scopeList.join(' '),
      state: p.state ?? '',
      open_app_type: 2,
      redirect_uri: url
    }
  })
  if (res.data.code !== 0)
    throw Object.assign(new Error(res.data.msg ?? 'get_auth_info_inner failed'), {
      code: res.data.code
    })
  const d = res.data.data ?? {}
  return {
    autoConfirm: !!d.auto_confirm,
    raw: res.data,
    ...(d.code ? { code: d.code } : {}),
    ...(d.state ? { state: d.state } : {})
  }
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

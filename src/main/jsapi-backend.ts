/**
 * Main-process side of the JSAPI bridge: methods that need network or OS access.
 * Called by the shell renderer via `jsapi:backend` (see src/shared/jsapi.ts).
 */
import { networkInterfaces } from 'node:os'
import { clipboard } from 'electron'
import { JSAPI_ERROR, jsapiFail, okMsg, type JsapiConfigParams } from '@shared/jsapi'
import type { JsapiBackendRequest, JsapiBackendResponse } from '@shared/ipc'
import type { ResolvedLanguage } from '@shared/settings'
import type { AccountService } from './account'
import type { SettingsStore } from './store'
import {
  requestAccess,
  requestAuthCode,
  verifyCodeToJsapiError,
  verifyJsapiSignature,
  type OpenApiSession
} from './openapi'
import { createLogger } from './logger'

const log = createLogger('jsapi')

export interface JsapiBackendDeps {
  account: AccountService
  settings: SettingsStore
  getLang: () => ResolvedLanguage
}

const ok = (method: string, data: Record<string, unknown> = {}): JsapiBackendResponse => ({
  ok: true,
  data: { errMsg: okMsg(method), ...data }
})
const fail = (method: string, code: number, message: string): JsapiBackendResponse => ({
  ok: false,
  data: jsapiFail(method, code, message)
})

export function getLanIp(): string | null {
  for (const infos of Object.values(networkInterfaces())) {
    for (const info of infos ?? []) {
      if (info.family === 'IPv4' && !info.internal) return info.address
    }
  }
  return null
}

export async function handleJsapiBackend(
  deps: JsapiBackendDeps,
  req: JsapiBackendRequest
): Promise<JsapiBackendResponse> {
  const { method, params, url } = req
  const withSession = (): OpenApiSession | null => {
    const cookie = deps.account.getCookie()
    const session = deps.account.getSession()
    if (!cookie || !session) return null
    return { env: deps.settings.get().env, session, cookie }
  }

  try {
    switch (method) {
      case 'config': {
        const s = withSession()
        if (!s) return fail(method, JSAPI_ERROR.NOT_LOGGED_IN, 'invalid session, please login')
        const cfg = params as unknown as JsapiConfigParams
        const cleanUrl = url.split('#')[0] ?? url
        const result = await verifyJsapiSignature(s, cleanUrl, cfg).catch((err) => {
          log.warn('verify failed', err)
          return null
        })
        if (!result) return fail(method, JSAPI_ERROR.NETWORK, 'network error')
        if (result.code === 0) return ok(method)
        return fail(
          method,
          verifyCodeToJsapiError(result.code),
          result.msg ?? 'signature verify failed'
        )
      }
      case 'requestAuthCode': {
        const s = withSession()
        if (!s) return fail(method, JSAPI_ERROR.NOT_LOGGED_IN, 'invalid session, please login')
        const appId = String(params['appId'] ?? params['appid'] ?? '')
        const { code } = await requestAuthCode(s, appId, url)
        return ok(method, { code })
      }
      case 'requestAccess': {
        const s = withSession()
        if (!s) return fail(method, JSAPI_ERROR.NOT_LOGGED_IN, 'invalid session, please login')
        const appId = String(params['appId'] ?? '')
        const scopeList = Array.isArray(params['scopeList'])
          ? (params['scopeList'] as string[])
          : []
        const state = typeof params['state'] === 'string' ? params['state'] : undefined
        const res = await requestAccess(
          s,
          { appId, scopeList, ...(state !== undefined ? { state } : {}) },
          url
        )
        if (res.autoConfirm && res.code)
          return ok(method, { code: res.code, state: res.state ?? state ?? '' })
        // Consent UI (`/authen/v1/confirm_inner`) is not implemented yet — see IMPLEMENTATION_PLAN.md phase 6.
        return fail(
          method,
          JSAPI_ERROR.NOT_SUPPORTED,
          'user consent required; grant the scopes in the Feishu app first'
        )
      }
      case 'biz.util.copyText':
      case 'setClipboardData': {
        clipboard.writeText(String(params['text'] ?? params['data'] ?? ''))
        return ok(method)
      }
      case 'biz.util.getClipboardInfo':
      case 'getClipboardData': {
        const text = clipboard.readText()
        return ok(method, { text, data: text })
      }
      case 'device.connection.getGatewayIP':
        return ok(method, { ip: getLanIp() ?? '127.0.0.1' })
      case 'biz.util.getAppLanguage': {
        const lang = deps.getLang()
        return ok(method, { name: lang === 'zh-CN' ? '简体中文' : 'English', code: lang })
      }
      case 'device.geolocation.get':
      case 'device.geolocation.start':
      case 'getLocation': {
        const loc = deps.settings.get().mockLocation
        if (!loc)
          return fail(
            method,
            JSAPI_ERROR.NOT_SUPPORTED,
            'no mock location configured (Settings → Mock Location)'
          )
        return ok(method, {
          latitude: loc.latitude,
          longitude: loc.longitude,
          accuracy: 65,
          time: Date.now(),
          netType: 'wifi',
          operatorType: 'unknown'
        })
      }
      case 'device.geolocation.stop':
        return ok(method)
      default:
        return fail(method, JSAPI_ERROR.NOT_SUPPORTED, `not handler api ${method}`)
    }
  } catch (err) {
    log.warn(`jsapi ${method} failed`, err)
    const code =
      typeof (err as { code?: unknown }).code === 'number'
        ? (err as { code: number }).code
        : JSAPI_ERROR.NETWORK
    return fail(method, code, err instanceof Error ? err.message : String(err))
  }
}

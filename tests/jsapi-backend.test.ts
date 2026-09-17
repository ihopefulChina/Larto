import { beforeEach, describe, expect, it, vi } from 'vitest'
import { JSAPI_ERROR } from '@shared/jsapi'

const clipboard = vi.hoisted(() => ({
  readText: vi.fn(() => 'private clipboard value'),
  writeText: vi.fn()
}))
const openapi = vi.hoisted(() => ({
  confirmAccess: vi.fn(),
  requestAccess: vi.fn(),
  requestAuthCode: vi.fn(),
  verifyCodeToJsapiError: vi.fn(),
  verifyJsapiSignature: vi.fn()
}))
const logger = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn()
}))

vi.mock('electron', () => ({
  clipboard,
  app: { getVersion: () => '0.1.0', isPackaged: false },
  session: { defaultSession: { fetch: vi.fn() } }
}))
vi.mock('../src/main/openapi', () => openapi)
vi.mock('../src/main/consent', () => ({ consentBroker: { ask: vi.fn() } }))
vi.mock('../src/main/logger', () => ({
  createLogger: () => logger
}))

const { handleJsapiBackend, mapJsapiCaughtError } = await import('../src/main/jsapi-backend')
const { HttpError } = await import('../src/main/http')
const { SessionExpiredError } = await import('../src/main/passport')

function deps(permission: boolean) {
  return {
    account: { getCookie: () => null, getSession: () => null },
    settings: { get: () => ({ env: 'feishu', mockLocation: null }) },
    getLang: () => 'en-US' as const,
    requestGuestPermission: vi.fn(async () => permission)
  } as unknown as Parameters<typeof handleJsapiBackend>[0]
}

function signedInDeps() {
  const dependencies = deps(true)
  dependencies.account = {
    getCookie: () => 'session=secret',
    getSession: () => 'secret',
    refresh: vi.fn(async () => ({ status: 'expired' }))
  } as never
  return dependencies
}

beforeEach(() => {
  clipboard.readText.mockClear()
  clipboard.writeText.mockClear()
  for (const fn of Object.values(openapi)) fn.mockReset()
  for (const fn of Object.values(logger)) fn.mockClear()
})

describe('JSAPI error logging', () => {
  it('logs only an incomplete-response summary, never the authorization payload', async () => {
    const sensitive = 'Private User at Secret Tenant'
    openapi.requestAccess.mockResolvedValueOnce({
      autoConfirm: false,
      raw: { current_user: { user_name: sensitive } }
    })

    const result = await handleJsapiBackend(signedInDeps(), {
      method: 'requestAccess',
      params: { appId: 'cli_a', scopeList: ['contact:user.base:readonly'] },
      url: 'https://example.com/'
    })

    expect(result.data).toEqual(expect.objectContaining({ errorCode: JSAPI_ERROR.ACCESS_INTERNAL }))
    expect(logger.warn).toHaveBeenCalledWith('get_auth_info_inner returned incomplete data', {
      autoConfirm: false,
      hasCode: false,
      hasConsent: false
    })
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain(sensitive)
  })

  it('retains a numeric error code but drops server messages and response objects', async () => {
    const sensitive = 'Private User at Secret Tenant'
    openapi.requestAuthCode.mockRejectedValueOnce(
      Object.assign(new Error(sensitive), {
        code: 230001,
        response: { data: { tenant: sensitive } }
      })
    )

    await handleJsapiBackend(signedInDeps(), {
      method: 'requestAuthCode',
      params: { appId: 'cli_a' },
      url: 'https://example.com/'
    })

    expect(logger.warn).toHaveBeenCalledWith('jsapi requestAuthCode failed', {
      kind: 'Error',
      code: 230001,
      resultCode: 230001
    })
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain(sensitive)
  })
})

describe('JSAPI session errors', () => {
  it('maps HTTP 401 and passport expiry to the not-logged-in JSAPI code', () => {
    expect(mapJsapiCaughtError(new HttpError(401, 'https://open.feishu.cn/x', ''))).toEqual({
      code: JSAPI_ERROR.NOT_LOGGED_IN,
      message: 'invalid session, please login',
      sessionExpired: true
    })
    expect(mapJsapiCaughtError(new SessionExpiredError(4401))).toMatchObject({
      code: JSAPI_ERROR.NOT_LOGGED_IN,
      sessionExpired: true
    })
    expect(mapJsapiCaughtError(new HttpError(500, 'https://open.feishu.cn/x', ''))).toMatchObject({
      code: JSAPI_ERROR.NETWORK,
      sessionExpired: false
    })
  })

  it('refreshes the account and returns 99991691 when verify gets HTTP 401', async () => {
    openapi.verifyJsapiSignature.mockRejectedValueOnce(
      new HttpError(401, 'https://open.feishu.cn/openapi/jssdk/verify', '')
    )
    const dependencies = signedInDeps()
    const result = await handleJsapiBackend(dependencies, {
      method: 'config',
      params: { appId: 'cli_a', jsApiList: [], nonceStr: 'n', signature: 's', timestamp: 1 },
      url: 'https://example.com/#hash'
    })
    expect(dependencies.account.refresh).toHaveBeenCalledOnce()
    expect(result).toEqual({
      ok: false,
      data: expect.objectContaining({ errorCode: JSAPI_ERROR.NOT_LOGGED_IN })
    })
  })

  it('refreshes the account when requestAuthCode sees an expired session', async () => {
    openapi.requestAuthCode.mockRejectedValueOnce(
      new HttpError(401, 'https://open.feishu.cn/x', '')
    )
    const dependencies = signedInDeps()
    const result = await handleJsapiBackend(dependencies, {
      method: 'requestAuthCode',
      params: { appId: 'cli_a' },
      url: 'https://example.com/'
    })
    expect(dependencies.account.refresh).toHaveBeenCalledOnce()
    expect(result.data).toEqual(expect.objectContaining({ errorCode: JSAPI_ERROR.NOT_LOGGED_IN }))
  })
})

describe('JSAPI clipboard permissions', () => {
  it('does not read clipboard contents when the active guest denies access', async () => {
    const dependencies = deps(false)
    const result = await handleJsapiBackend(dependencies, {
      method: 'getClipboardData',
      params: {},
      url: 'https://spoofed.example/'
    })

    expect(dependencies.requestGuestPermission).toHaveBeenCalledWith('clipboard-read')
    expect(clipboard.readText).not.toHaveBeenCalled()
    expect(result).toEqual({
      ok: false,
      data: expect.objectContaining({ errorCode: JSAPI_ERROR.USER_CANCEL })
    })
  })

  it('requires a separate approval before writing the clipboard', async () => {
    const denied = deps(false)
    await handleJsapiBackend(denied, {
      method: 'setClipboardData',
      params: { data: 'replacement' },
      url: 'https://spoofed.example/'
    })
    expect(denied.requestGuestPermission).toHaveBeenCalledWith('clipboard-write')
    expect(clipboard.writeText).not.toHaveBeenCalled()

    const allowed = deps(true)
    const result = await handleJsapiBackend(allowed, {
      method: 'setClipboardData',
      params: { data: 'replacement' },
      url: 'https://spoofed.example/'
    })
    expect(clipboard.writeText).toHaveBeenCalledWith('replacement')
    expect(result.ok).toBe(true)
  })
})

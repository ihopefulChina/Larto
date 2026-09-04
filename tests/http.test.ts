import { beforeEach, describe, expect, it, vi } from 'vitest'

const electron = vi.hoisted(() => ({
  fetch: vi.fn<(input: string, init?: RequestInit) => Promise<Response>>()
}))

vi.mock('electron', () => ({
  app: { getVersion: () => '0.1.0', isPackaged: false },
  session: { defaultSession: { fetch: electron.fetch } }
}))

const { requestJson } = await import('../src/main/http')

beforeEach(() => {
  electron.fetch.mockReset()
})

describe('requestJson', () => {
  it('keeps the explicit account cookies isolated from the Electron session cookie jar', async () => {
    electron.fetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ code: 0, data: { ok: true } }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    )

    await requestJson('https://passport.feishu.cn/accounts/web/user?app_id=7', {
      cookie: 'session=fresh-session; session_list=fresh-session_other-session'
    })

    expect(electron.fetch).toHaveBeenCalledOnce()
    const [, init] = electron.fetch.mock.calls[0]!
    expect(init?.credentials).toBe('omit')
    expect(new Headers(init?.headers).get('cookie')).toBe(
      'session=fresh-session; session_list=fresh-session_other-session'
    )
  })
})

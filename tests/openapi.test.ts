import { describe, expect, it } from 'vitest'
import { parseAccessConsent, verifyCodeToJsapiError } from '../src/main/openapi'

describe('parseAccessConsent', () => {
  it('returns null when the server already issued a code (no app_info)', () => {
    expect(parseAccessConsent({ auto_confirm: true, code: 'abc' })).toBeNull()
  })

  it('maps the passport AuthzModal payload', () => {
    const info = parseAccessConsent({
      auto_confirm: false,
      app_info: { app_name: 'Demo', app_icon_url: 'https://x/app.png' },
      suite_info: { suite_icon_url: 'https://x/feishu.png' },
      current_user: {
        user_name: '张三',
        tenant_icon_url: 'https://x/tenant.png',
        scope_list: [
          { name: 'contact:user.base:readonly', desc: '获取用户基本信息' },
          { name: 'no.desc' },
          { name: '', desc: '' }
        ]
      }
    })
    expect(info).toEqual({
      appName: 'Demo',
      appIconUrl: 'https://x/app.png',
      suiteIconUrl: 'https://x/feishu.png',
      userName: '张三',
      tenantIconUrl: 'https://x/tenant.png',
      scopes: [
        { name: 'contact:user.base:readonly', desc: '获取用户基本信息' },
        { name: 'no.desc', desc: 'no.desc' }
      ]
    })
  })

  it('tolerates partial payloads', () => {
    expect(parseAccessConsent({ app_info: {} })).toEqual({
      appName: '',
      appIconUrl: '',
      suiteIconUrl: '',
      userName: '',
      tenantIconUrl: '',
      scopes: []
    })
  })
})

describe('verifyCodeToJsapiError', () => {
  it('prefixes short open-platform codes with 333 (official rule)', () => {
    expect(verifyCodeToJsapiError(10012)).toBe(333012)
    expect(verifyCodeToJsapiError(99991663)).toBe(99991663)
  })
})

import { describe, expect, it } from 'vitest'
import {
  isPassportApiUrl,
  passportApiOrigins,
  rewriteCookieHeader
} from '../src/main/guest-passport'

const ORIGINS = passportApiOrigins()
const OPEN = ORIGINS.find((o) => o.includes('open.')) ?? 'https://open.feishu.cn'
const PASSPORT = ORIGINS.find((o) => o.includes('passport.')) ?? 'https://passport.feishu.cn'

describe('isPassportApiUrl', () => {
  it('matches the OAuth authorize navigation pages redirect to (prefixed)', () => {
    const url =
      `${OPEN}/open-apis/authen/v1/authorize?client_id=cli_x&redirect_uri=` +
      encodeURIComponent('https://miaoda.feishu.cn/af/api/v1/account/oauth/callback')
    expect(isPassportApiUrl(url, ORIGINS)).toBe(true)
  })

  it('matches the authorize hop on the accounts host where the session is checked', () => {
    const ACCOUNTS = ORIGINS.find((o) => o.includes('accounts.')) ?? 'https://accounts.feishu.cn'
    const url = `${ACCOUNTS}/open-apis/authen/v1/authorize?client_id=cli_a8fcb11112a89013`
    expect(isPassportApiUrl(url, ORIGINS)).toBe(true)
  })

  it('matches authen endpoints with and without the /open-apis prefix', () => {
    expect(isPassportApiUrl(`${OPEN}/open-apis/authen/v1/get_auth_info_inner`, ORIGINS)).toBe(true)
    expect(isPassportApiUrl(`${OPEN}/authen/v1/get_auth_info_inner`, ORIGINS)).toBe(true)
    expect(isPassportApiUrl(`${OPEN}/authen/v1/confirm_inner?x=1`, ORIGINS)).toBe(true)
  })

  it('matches the renamed confirm endpoint used by the consent page', () => {
    expect(isPassportApiUrl(`${OPEN}/open-apis/authen/v1/confirm`, ORIGINS)).toBe(true)
    expect(
      isPassportApiUrl(`${OPEN}/open-apis/authen/v1/confirm_inner`, ORIGINS)
    ).toBe(true)
  })

  it('matches the passport-origin account endpoints', () => {
    expect(isPassportApiUrl(`${PASSPORT}/accounts/web/switch`, ORIGINS)).toBe(true)
    expect(isPassportApiUrl(`${PASSPORT}/accounts/security/user/u1`, ORIGINS)).toBe(true)
    expect(isPassportApiUrl(`${PASSPORT}/accounts/auth/code/abc`, ORIGINS)).toBe(true)
  })

  it('rejects unrelated paths on the same origins', () => {
    expect(isPassportApiUrl(`${OPEN}/open-apis/doc/v2/index`, ORIGINS)).toBe(false)
    expect(isPassportApiUrl(`${PASSPORT}/accounts/page/login`, ORIGINS)).toBe(false)
    expect(isPassportApiUrl(`${OPEN}/`, ORIGINS)).toBe(false)
  })

  it('rejects matching paths on foreign origins and malformed URLs', () => {
    expect(isPassportApiUrl('https://evil.example/open-apis/authen/v1/authorize', ORIGINS)).toBe(
      false
    )
    expect(isPassportApiUrl('not a url', ORIGINS)).toBe(false)
  })
})

describe('rewriteCookieHeader', () => {
  it('drops the guest session entries and appends the account pair', () => {
    expect(
      rewriteCookieHeader(
        'foo=1; session=guest; session_list=guest_a',
        'session=acc; session_list=acc_a'
      )
    ).toBe('foo=1; session=acc; session_list=acc_a')
  })

  it('keeps unrelated cookies and works without an existing header', () => {
    expect(rewriteCookieHeader('foo=1; bar=2', 'session=acc')).toBe('foo=1; bar=2; session=acc')
    expect(rewriteCookieHeader(undefined, 'session=acc')).toBe('session=acc')
  })
})

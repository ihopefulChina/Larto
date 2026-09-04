import { describe, expect, it } from 'vitest'
import {
  brandMatchesEnv,
  parseSessionCookies,
  SessionExpiredError,
  toUserEntries,
  unwrapPassport
} from '../src/main/passport'

describe('unwrapPassport', () => {
  it('returns the data field of the { code, data } envelope', () => {
    expect(unwrapPassport({ code: 0, data: { user: { id: 'u1' } } }, false)).toEqual({
      user: { id: 'u1' }
    })
  })

  it('treats passport session codes as expired regardless of HTTP status', () => {
    expect(() => unwrapPassport({ code: 4401, data: null }, false)).toThrow(SessionExpiredError)
    expect(() => unwrapPassport({ code: 34 }, false)).toThrow(SessionExpiredError)
    // code 4 (not login) only counts as expired once we believe we are signed in
    expect(() => unwrapPassport({ code: 4 }, true)).toThrow(SessionExpiredError)
    expect(() => unwrapPassport({ code: 4 }, false)).toThrow(/code 4/)
  })

  it('fails loudly on other error codes and on empty payloads', () => {
    expect(() => unwrapPassport({ code: 500, message: 'boom' }, false)).toThrow(/500 boom/)
    expect(() => unwrapPassport({ code: 0 }, false)).toThrow(/no data/)
    expect(() => unwrapPassport(null, false)).toThrow(/empty/)
  })
})

describe('toUserEntries', () => {
  const alice = { id: 'a', name: 'Alice', tenant: { id: 't1', name: 'T1' } }
  const bob = { id: 'b', name: 'Bob', tenant: { id: 't2', name: 'T2' } }

  it('accepts the bare array returned by web_list', () => {
    expect(toUserEntries([{ user: alice, is_login: true }, { nope: 1 }])).toEqual([
      { user: alice, is_login: true }
    ])
  })

  it('flattens user_center credential_binding_identities', () => {
    const entries = toUserEntries({
      step_info: {
        credential_binding_identities: [
          { credential: { credential: 'x', credential_type: 1 }, user_list: [{ user: alice }] },
          { credential: { credential: 'y', credential_type: 2 }, user_list: [{ user: bob }] },
          { credential: { credential: 'z', credential_type: 32 } }
        ]
      }
    })
    expect(entries.map((e) => e.user.id)).toEqual(['a', 'b'])
  })

  it('returns [] for unknown shapes', () => {
    expect(toUserEntries(null)).toEqual([])
    expect(toUserEntries({ foo: 1 })).toEqual([])
  })
})

describe('brandMatchesEnv', () => {
  it('mirrors the official isbrandInEnv filter', () => {
    expect(brandMatchesEnv('feishu', 'feishu')).toBe(true)
    expect(brandMatchesEnv('lark', 'feishu')).toBe(false)
    expect(brandMatchesEnv('lark-pre', 'lark')).toBe(true)
    expect(brandMatchesEnv(undefined, 'lark')).toBe(true)
  })
})

describe('parseSessionCookies', () => {
  it('extracts the new session cookies from Set-Cookie headers', () => {
    expect(
      parseSessionCookies([
        'session=XN0YXJ0; Path=/; HttpOnly',
        'session_list=XN0YXJ0_YWJj; Path=/',
        'other=1'
      ])
    ).toEqual({ session: 'XN0YXJ0', sessionList: ['XN0YXJ0', 'YWJj'] })
    expect(parseSessionCookies([])).toEqual({})
  })
})

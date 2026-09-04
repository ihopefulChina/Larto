import { describe, expect, it, vi } from 'vitest'
import {
  defaultPermissionDecision,
  GuestPermissionPolicy,
  permissionOrigin
} from '../src/main/permissions'
import { hasSandboxOptOut } from '../src/main/security'

describe('guest permission policy', () => {
  it('only accepts HTTP(S) origins', () => {
    expect(permissionOrigin('https://example.com/path')).toBe('https://example.com')
    expect(permissionOrigin('http://localhost:5173/page')).toBe('http://localhost:5173')
    expect(permissionOrigin('file:///tmp/page.html')).toBeNull()
    expect(permissionOrigin('data:text/html,hello')).toBeNull()
    expect(permissionOrigin('not a url')).toBeNull()
  })

  it('allows sanitized writes, prompts for known sensitive capabilities and denies unknowns', () => {
    expect(defaultPermissionDecision('clipboard-sanitized-write')).toBe('allow')
    expect(defaultPermissionDecision('clipboard-write')).toBe('prompt')
    expect(defaultPermissionDecision('media')).toBe('prompt')
    expect(defaultPermissionDecision('geolocation')).toBe('prompt')
    expect(defaultPermissionDecision('usb')).toBe('deny')
  })

  it('caches an explicit choice only for the same origin and permission', async () => {
    const policy = new GuestPermissionPolicy()
    const confirm = vi.fn(async () => true)
    await expect(
      policy.request('media', 'https://one.example/a', ['video'], confirm)
    ).resolves.toBe(true)
    await expect(
      policy.request('media', 'https://one.example/b', ['video'], confirm)
    ).resolves.toBe(true)
    expect(policy.check('media', 'https://one.example/c', ['video'])).toBe(true)
    expect(policy.check('media', 'https://one.example/c', ['audio'])).toBe(false)
    expect(policy.check('geolocation', 'https://one.example/c')).toBe(false)
    expect(policy.check('media', 'https://two.example/c', ['video'])).toBe(false)
    expect(confirm).toHaveBeenCalledTimes(1)
    policy.clear()
    expect(policy.check('media', 'https://one.example/c')).toBe(false)
  })

  it('coalesces simultaneous prompts and fails closed when confirmation throws', async () => {
    const policy = new GuestPermissionPolicy()
    let release = () => {}
    const confirm = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          release = () => resolve(false)
        })
    )
    const first = policy.request('geolocation', 'https://example.com/a', [], confirm)
    const second = policy.request('geolocation', 'https://example.com/b', [], confirm)
    release()
    await expect(Promise.all([first, second])).resolves.toEqual([false, false])
    expect(confirm).toHaveBeenCalledTimes(1)

    await expect(
      new GuestPermissionPolicy().request('media', 'https://example.com', ['video'], async () => {
        throw new Error('dialog failed')
      })
    ).resolves.toBe(false)
  })

  it('keeps camera and microphone decisions separate', async () => {
    const policy = new GuestPermissionPolicy()
    const confirm = vi.fn(async (_origin: string, permission: string) => permission === 'media')
    await expect(policy.request('media', 'https://example.com', ['video'], confirm)).resolves.toBe(
      true
    )
    expect(policy.check('media', 'https://example.com', ['video'])).toBe(true)
    expect(policy.check('media', 'https://example.com', ['audio'])).toBe(false)
    await expect(policy.request('media', 'https://example.com', ['audio'], confirm)).resolves.toBe(
      true
    )
    expect(confirm).toHaveBeenCalledTimes(2)
  })

  it('records a combined media approval for both requested device types', async () => {
    const policy = new GuestPermissionPolicy()
    await policy.request('media', 'https://example.com', ['video', 'audio'], async () => true)
    expect(policy.check('media', 'https://example.com', ['video'])).toBe(true)
    expect(policy.check('media', 'https://example.com', ['audio'])).toBe(true)
    expect(policy.check('media', 'https://example.com', ['unknown'])).toBe(true)
  })

  it('keeps JSAPI clipboard read and write approvals separate', async () => {
    const policy = new GuestPermissionPolicy()
    await policy.request('clipboard-write', 'https://example.com', [], async () => true)
    expect(policy.check('clipboard-write', 'https://example.com')).toBe(true)
    expect(policy.check('clipboard-read', 'https://example.com')).toBe(false)
  })
})

describe('sandbox launch guard', () => {
  it('rejects every --no-sandbox command-line form', () => {
    expect(hasSandboxOptOut(['electron', '.'], {})).toBe(false)
    expect(hasSandboxOptOut(['electron', '.', '--no-sandbox'], {})).toBe(true)
    expect(hasSandboxOptOut(['electron', '.', '--no-sandbox=true'], {})).toBe(true)
    expect(hasSandboxOptOut(['electron', '.'], {}, { hasSwitch: () => true })).toBe(true)
  })

  it('rejects ELECTRON_DISABLE_SANDBOX even when its value is empty', () => {
    expect(hasSandboxOptOut(['electron', '.'], { ELECTRON_DISABLE_SANDBOX: '1' })).toBe(true)
    expect(hasSandboxOptOut(['electron', '.'], { ELECTRON_DISABLE_SANDBOX: '' })).toBe(true)
  })
})

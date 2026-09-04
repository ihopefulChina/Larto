import { beforeEach, describe, expect, it, vi } from 'vitest'

const storage = vi.hoisted(() => ({
  available: true,
  failBackendLookup: false,
  backend: 'gnome_libsecret' as Electron.SafeStorage extends {
    getSelectedStorageBackend(): infer B
  }
    ? B
    : string
}))

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp' },
  BrowserWindow: class {},
  safeStorage: {
    isEncryptionAvailable: () => storage.available,
    getSelectedStorageBackend: () => {
      if (storage.failBackendLookup) throw new Error('backend unavailable')
      return storage.backend
    }
  },
  session: {}
}))

const { denyAllSessionPermissions, hasSecureAccountStorage } = await import('../src/main/account')

beforeEach(() => {
  storage.available = true
  storage.failBackendLookup = false
  storage.backend = 'gnome_libsecret'
})

describe('hasSecureAccountStorage', () => {
  it('requires the OS encryption service on every platform', () => {
    storage.available = false
    expect(hasSecureAccountStorage('darwin')).toBe(false)
    expect(hasSecureAccountStorage('win32')).toBe(false)
    expect(hasSecureAccountStorage('linux')).toBe(false)
  })

  it('accepts macOS Keychain and Windows DPAPI when available', () => {
    storage.backend = 'basic_text'
    expect(hasSecureAccountStorage('darwin')).toBe(true)
    expect(hasSecureAccountStorage('win32')).toBe(true)
  })

  it('rejects Linux basic_text and unknown backends but accepts keyrings', () => {
    storage.backend = 'basic_text'
    expect(hasSecureAccountStorage('linux')).toBe(false)
    storage.backend = 'unknown'
    expect(hasSecureAccountStorage('linux')).toBe(false)
    storage.failBackendLookup = true
    expect(hasSecureAccountStorage('linux')).toBe(false)
    storage.failBackendLookup = false
    for (const backend of ['gnome_libsecret', 'kwallet', 'kwallet5', 'kwallet6'] as const) {
      storage.backend = backend
      expect(hasSecureAccountStorage('linux')).toBe(true)
    }
  })
})

describe('login session permissions', () => {
  it('denies checks and requests in the throw-away passport partition', () => {
    const setPermissionCheckHandler = vi.fn()
    const setPermissionRequestHandler = vi.fn()
    denyAllSessionPermissions({
      setPermissionCheckHandler,
      setPermissionRequestHandler
    } as unknown as Parameters<typeof denyAllSessionPermissions>[0])

    const check = setPermissionCheckHandler.mock.calls[0]?.[0] as () => boolean
    expect(check()).toBe(false)
    let decision: boolean | undefined
    const request = setPermissionRequestHandler.mock.calls[0]?.[0] as (
      contents: unknown,
      permission: string,
      callback: (allowed: boolean) => void
    ) => void
    request(null, 'media', (allowed) => {
      decision = allowed
    })
    expect(decision).toBe(false)
  })
})

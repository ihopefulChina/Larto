import { describe, expect, it, vi } from 'vitest'

const electron = vi.hoisted(() => {
  const defaultSetProxy = vi.fn().mockResolvedValue(undefined)
  const guestSetProxy = vi.fn().mockResolvedValue(undefined)
  const updaterSetProxy = vi.fn().mockResolvedValue(undefined)
  const defaultCloseConnections = vi.fn().mockResolvedValue(undefined)
  const guestCloseConnections = vi.fn().mockResolvedValue(undefined)
  const updaterCloseConnections = vi.fn().mockResolvedValue(undefined)
  const fromPartition = vi.fn((partition: string) => ({
    setProxy: partition === 'electron-updater' ? updaterSetProxy : guestSetProxy,
    closeAllConnections:
      partition === 'electron-updater' ? updaterCloseConnections : guestCloseConnections
  }))
  return {
    session: {
      defaultSession: { setProxy: defaultSetProxy, closeAllConnections: defaultCloseConnections },
      fromPartition
    },
    defaultSetProxy,
    guestSetProxy,
    updaterSetProxy,
    defaultCloseConnections,
    guestCloseConnections,
    updaterCloseConnections,
    fromPartition
  }
})

vi.mock('electron', () => ({ session: electron.session }))

const { applyProxy, resolveProxyConfig } = await import('../src/main/proxy')

describe('proxy policy', () => {
  it('resolves system, direct and manual settings for Electron sessions', () => {
    expect(resolveProxyConfig({ mode: 'system', url: '', bypass: '<local>' })).toEqual({
      mode: 'system'
    })
    expect(resolveProxyConfig({ mode: 'none', url: '', bypass: '<local>' })).toEqual({
      mode: 'direct'
    })
    expect(
      resolveProxyConfig({
        mode: 'manual',
        url: ' http://127.0.0.1:8080 ',
        bypass: '<local>'
      })
    ).toEqual({
      mode: 'fixed_servers',
      proxyRules: 'http://127.0.0.1:8080',
      proxyBypassRules: '<local>'
    })
    expect(() => resolveProxyConfig({ mode: 'manual', url: '  ', bypass: '<local>' })).toThrow(
      'manual proxy address is required'
    )
  })

  it('applies one policy to default, guest and electron-updater sessions', async () => {
    const proxy = { mode: 'none' as const, url: '', bypass: '<local>' }
    await applyProxy(proxy)

    expect(electron.defaultSetProxy).toHaveBeenCalledWith({ mode: 'direct' })
    expect(electron.guestSetProxy).toHaveBeenCalledWith({ mode: 'direct' })
    expect(electron.updaterSetProxy).toHaveBeenCalledWith({ mode: 'direct' })
    expect(electron.defaultCloseConnections).toHaveBeenCalledOnce()
    expect(electron.guestCloseConnections).toHaveBeenCalledOnce()
    expect(electron.updaterCloseConnections).toHaveBeenCalledOnce()
    expect(electron.fromPartition).toHaveBeenCalledWith('persist:h5-guest')
    expect(electron.fromPartition).toHaveBeenCalledWith('electron-updater', { cache: false })
  })

  it('waits for every session before reporting a partial failure', async () => {
    let finishGuest!: () => void
    electron.defaultSetProxy.mockRejectedValueOnce(new Error('default failed'))
    electron.guestSetProxy.mockImplementationOnce(
      () => new Promise<void>((resolve) => (finishGuest = resolve))
    )
    const pending = applyProxy({ mode: 'none', url: '', bypass: '<local>' })
    let settled = false
    void pending.catch(() => {
      settled = true
    })
    await Promise.resolve()
    expect(settled).toBe(false)

    finishGuest()
    await expect(pending).rejects.toThrow('one or more proxy sessions failed')
  })
})

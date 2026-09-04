import { beforeEach, describe, expect, it, vi } from 'vitest'

const updater = vi.hoisted(() => {
  const listeners = new Map<string, ((...args: unknown[]) => void)[]>()
  const checkForUpdates = vi.fn<() => Promise<unknown>>()
  const autoUpdater = {
    autoDownload: true,
    autoInstallOnAppQuit: true,
    allowPrerelease: true,
    logger: null as unknown,
    updateConfigPath: '',
    forceDevUpdateConfig: false,
    checkForUpdates,
    downloadUpdate: vi.fn(),
    quitAndInstall: vi.fn(),
    on(event: string, listener: (...args: unknown[]) => void) {
      listeners.set(event, [...(listeners.get(event) ?? []), listener])
      return autoUpdater
    },
    emit(event: string, ...args: unknown[]) {
      for (const listener of listeners.get(event) ?? []) listener(...args)
    }
  }
  return { autoUpdater, checkForUpdates, downloadUpdate: autoUpdater.downloadUpdate, listeners }
})

vi.mock('electron', () => ({
  app: {
    isPackaged: true,
    getVersion: () => '1.0.0',
    getPath: () => '/tmp'
  }
}))
vi.mock('electron-updater', () => ({ default: { autoUpdater: updater.autoUpdater } }))

const { UpdaterService, resolveUpdateCapability } = await import('../src/main/updater')

beforeEach(() => {
  updater.listeners.clear()
  updater.checkForUpdates.mockReset()
  updater.downloadUpdate.mockReset()
  updater.autoUpdater.allowPrerelease = true
})

describe('UpdaterService.check', () => {
  it('enables only package formats that can update in place', () => {
    expect(resolveUpdateCapability({ platform: 'darwin', isPackaged: true }).enabled).toBe(true)
    expect(resolveUpdateCapability({ platform: 'win32', isPackaged: true }).enabled).toBe(true)
    expect(
      resolveUpdateCapability({
        platform: 'win32',
        isPackaged: true,
        portableExecutable: 'FeishuDevTools.exe'
      })
    ).toEqual({ enabled: false, unsupportedReason: 'windowsPortable' })
    expect(
      resolveUpdateCapability({
        platform: 'linux',
        isPackaged: true,
        appImage: '/tmp/FeishuDevTools.AppImage'
      }).enabled
    ).toBe(true)
    expect(resolveUpdateCapability({ platform: 'linux', isPackaged: true })).toMatchObject({
      enabled: false,
      unsupportedReason: 'linuxPackage'
    })
    expect(resolveUpdateCapability({ platform: 'linux', isPackaged: false }).enabled).toBe(false)
    expect(
      resolveUpdateCapability({
        platform: 'linux',
        isPackaged: false,
        testFeed: 'http://127.0.0.1:1234/'
      }).enabled
    ).toBe(true)
    expect(
      resolveUpdateCapability({
        platform: 'linux',
        isPackaged: true,
        testFeed: 'http://127.0.0.1:1234/'
      }).enabled
    ).toBe(false)
  })

  it('does not call electron-updater for a non-AppImage Linux package', async () => {
    const settings = { get: () => ({ skippedUpdateVersion: null }), patch: vi.fn() }
    const service = new UpdaterService(settings as never, {
      platform: 'linux',
      isPackaged: true
    })
    const state = await service.check()
    expect(updater.checkForUpdates).not.toHaveBeenCalled()
    expect(state).toMatchObject({
      status: 'unsupported',
      currentVersion: '1.0.0',
      reason: 'linuxPackage'
    })
  })

  it('preserves electron-updater prerelease channel selection', () => {
    const settings = { get: () => ({ skippedUpdateVersion: null }), patch: vi.fn() }
    new UpdaterService(settings as never)
    expect(updater.autoUpdater.allowPrerelease).toBe(true)
  })

  it('shares one in-flight check and lets a manual caller override silent semantics', async () => {
    let finish!: () => void
    updater.checkForUpdates.mockImplementationOnce(
      () => new Promise((resolve) => (finish = () => resolve(null)))
    )
    const settings = {
      get: () => ({ skippedUpdateVersion: '2.0.0' }),
      patch: vi.fn()
    }
    const service = new UpdaterService(settings as never)

    const manual = service.check({ manual: true })
    const silentJoiner = service.check({ manual: false })
    expect(silentJoiner).toBe(manual)
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1)

    updater.autoUpdater.emit('update-available', {
      version: '2.0.0',
      releaseDate: '2026-09-04',
      releaseNotes: 'notes'
    })
    expect(service.getState().status).toBe('available')
    finish()
    await manual
    service.skip()
    expect(service.getState().status).toBe('notAvailable')

    updater.checkForUpdates.mockResolvedValueOnce(null)
    const silent = service.check({ manual: false })
    updater.autoUpdater.emit('update-available', {
      version: '2.0.0',
      releaseDate: '2026-09-04',
      releaseNotes: 'notes'
    })
    expect(service.getState().status).toBe('notAvailable')
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(2)
    await silent

    let finishJoined!: () => void
    updater.checkForUpdates.mockImplementationOnce(
      () => new Promise((resolve) => (finishJoined = () => resolve(null)))
    )
    const silentFirst = service.check({ manual: false })
    const manualJoiner = service.check({ manual: true })
    expect(manualJoiner).toBe(silentFirst)
    updater.autoUpdater.emit('update-available', {
      version: '2.0.0',
      releaseDate: '2026-09-04',
      releaseNotes: 'notes'
    })
    expect(service.getState().status).toBe('available')
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(3)
    finishJoined()
    await silentFirst
  })

  it('locks the state while downloading and does not let checks or skip overwrite it', async () => {
    let finishDownload!: () => void
    updater.downloadUpdate.mockImplementationOnce(
      () => new Promise((resolve) => (finishDownload = () => resolve(undefined)))
    )
    const settings = {
      get: () => ({ skippedUpdateVersion: null }),
      patch: vi.fn()
    }
    const service = new UpdaterService(settings as never)
    updater.autoUpdater.emit('update-available', {
      version: '2.0.0',
      releaseDate: '2026-09-04',
      releaseNotes: 'notes'
    })

    const download = service.download()
    expect(service.getState()).toMatchObject({ status: 'downloading', percent: 0 })
    await service.check({ manual: true })
    expect(updater.checkForUpdates).not.toHaveBeenCalled()
    service.skip()
    expect(service.getState().status).toBe('downloading')
    expect(settings.patch).not.toHaveBeenCalled()

    updater.autoUpdater.emit('update-downloaded', {
      version: '2.0.0',
      releaseDate: '2026-09-04',
      releaseNotes: 'notes'
    })
    finishDownload()
    await download
    expect(service.getState().status).toBe('downloaded')
    await service.check({ manual: true })
    expect(updater.checkForUpdates).not.toHaveBeenCalled()
  })
})

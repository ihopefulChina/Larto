import { EventEmitter } from 'node:events'
import { app } from 'electron'
import electronUpdater from 'electron-updater'
import type { UpdateInfoLite, UpdateState } from '@shared/ipc'
import { createLogger } from './logger'

const { autoUpdater } = electronUpdater
const log = createLogger('updater')

export interface UpdaterEvents {
  state: [state: UpdateState]
}

/**
 * Mirrors the official flow (docs/RESEARCH_OFFICIAL_TOOL.md §9): check → available → download
 * (explicit) → downloaded → user confirms → quitAndInstall. Feed is GitHub Releases
 * (electron-builder `publish` in electron-builder.yml, `latest-mac.yml` + zip for arm64).
 */
export class UpdaterService extends EventEmitter<UpdaterEvents> {
  private state: UpdateState = { status: 'idle' }
  private readonly enabled = app.isPackaged

  constructor() {
    super()
    autoUpdater.autoDownload = false
    autoUpdater.autoInstallOnAppQuit = false
    autoUpdater.allowPrerelease = false
    autoUpdater.logger = {
      info: (m: unknown) => log.info(m),
      warn: (m: unknown) => log.warn(m),
      error: (m: unknown) => log.error(m),
      debug: (m: unknown) => log.debug(m)
    }
    autoUpdater.on('checking-for-update', () => this.set({ status: 'checking' }))
    autoUpdater.on('update-available', (info) =>
      this.set({ status: 'available', info: lite(info) })
    )
    autoUpdater.on('update-not-available', () =>
      this.set({ status: 'notAvailable', currentVersion: app.getVersion() })
    )
    autoUpdater.on('download-progress', (p) =>
      this.set({
        status: 'downloading',
        percent: p.percent,
        bytesPerSecond: p.bytesPerSecond,
        transferred: p.transferred,
        total: p.total
      })
    )
    autoUpdater.on('update-downloaded', (info) =>
      this.set({ status: 'downloaded', info: lite(info) })
    )
    autoUpdater.on('error', (err) => this.set({ status: 'error', message: err.message }))
  }

  getState(): UpdateState {
    return this.state
  }

  private set(state: UpdateState): void {
    this.state = state
    this.emit('state', state)
  }

  async check(): Promise<UpdateState> {
    if (!this.enabled) {
      this.set({
        status: 'notAvailable',
        currentVersion: `${app.getVersion()} (dev build, updater disabled)`
      })
      return this.state
    }
    try {
      await autoUpdater.checkForUpdates()
    } catch (err) {
      this.set({ status: 'error', message: err instanceof Error ? err.message : String(err) })
    }
    return this.state
  }

  async download(): Promise<UpdateState> {
    if (this.state.status !== 'available') return this.state
    try {
      await autoUpdater.downloadUpdate()
    } catch (err) {
      this.set({ status: 'error', message: err instanceof Error ? err.message : String(err) })
    }
    return this.state
  }

  install(): void {
    if (this.state.status !== 'downloaded') return
    setImmediate(() => autoUpdater.quitAndInstall(false, true))
  }
}

function lite(info: {
  version: string
  releaseNotes?: unknown
  releaseDate: string
}): UpdateInfoLite {
  const notes = info.releaseNotes
  const releaseNotes =
    typeof notes === 'string'
      ? notes
      : Array.isArray(notes)
        ? notes.map((n) => (n as { note?: string }).note ?? '').join('\n')
        : ''
  return { version: info.version, releaseNotes, releaseDate: info.releaseDate }
}

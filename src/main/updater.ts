import { EventEmitter } from 'node:events'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import electronUpdater from 'electron-updater'
import type { UnsupportedUpdateReason, UpdateInfoLite, UpdateState } from '@shared/ipc'
import { createLogger } from './logger'
import type { SettingsStore } from './store'

const { autoUpdater } = electronUpdater
const log = createLogger('updater')

export interface UpdaterEvents {
  state: [state: UpdateState]
}

export interface UpdateRuntime {
  platform: NodeJS.Platform
  isPackaged: boolean
  testFeed?: string
  appImage?: string
  portableExecutable?: string
}

export interface UpdateCapability {
  enabled: boolean
  unsupportedReason?: UnsupportedUpdateReason
}

/**
 * Packaging support is broader than in-place update support. electron-updater can replace the
 * macOS app, a Windows NSIS installation and Linux AppImage. Package-manager/tarball builds and
 * electron-builder's portable Windows executable must instead be replaced by the user.
 */
export function resolveUpdateCapability(runtime: UpdateRuntime): UpdateCapability {
  if (runtime.testFeed && !runtime.isPackaged) return { enabled: true }
  if (!runtime.isPackaged) return { enabled: false, unsupportedReason: 'development' }
  if (runtime.platform === 'darwin') return { enabled: true }
  if (runtime.platform === 'win32') {
    return runtime.portableExecutable
      ? { enabled: false, unsupportedReason: 'windowsPortable' }
      : { enabled: true }
  }
  if (runtime.platform === 'linux') {
    return runtime.appImage
      ? { enabled: true }
      : { enabled: false, unsupportedReason: 'linuxPackage' }
  }
  return { enabled: false, unsupportedReason: 'platform' }
}

/**
 * Mirrors the official flow (docs/RESEARCH_OFFICIAL_TOOL.md §9): check → available → download
 * (explicit) → downloaded → user confirms → quitAndInstall. Feed is GitHub Releases
 * (electron-builder `publish` in electron-builder.yml); the release body is what the dialog shows
 * as release notes. Runtime capability is checked below so non-updatable package formats do not
 * start a broken background check.
 *
 * Sparkle semantics on top: a version the user chose to "skip" stays silent for automatic
 * (startup) checks but is still reported by a manual "Check for Updates…".
 *
 * Testing hook (dev builds only): `LARTO_UPDATE_FEED=http://127.0.0.1:<port>/` points the updater
 * at a generic feed so the whole dialog can be exercised without a GitHub release.
 */
export class UpdaterService extends EventEmitter<UpdaterEvents> {
  private state: UpdateState = { status: 'idle' }
  private checkInFlight: Promise<UpdateState> | null = null
  /** Becomes true if any caller joining the current check explicitly requested visible results. */
  private manualRequested = false
  /** The version last reported as available; carried into the download progress state. */
  private offered: UpdateInfoLite | null = null
  private readonly enabled: boolean
  private readonly unsupportedReason: UnsupportedUpdateReason

  constructor(
    private readonly settings: SettingsStore,
    runtime: UpdateRuntime = {
      platform: process.platform,
      isPackaged: app.isPackaged,
      ...(process.env.LARTO_UPDATE_FEED ? { testFeed: process.env.LARTO_UPDATE_FEED } : {}),
      ...(process.env.APPIMAGE ? { appImage: process.env.APPIMAGE } : {}),
      ...(process.env.PORTABLE_EXECUTABLE_FILE
        ? { portableExecutable: process.env.PORTABLE_EXECUTABLE_FILE }
        : {})
    }
  ) {
    super()
    autoUpdater.autoDownload = false
    autoUpdater.autoInstallOnAppQuit = false
    // Keep electron-updater's version-derived allowPrerelease value: an installed rc.1 must be
    // able to discover rc.2 on the same channel, while stable builds remain on stable releases.
    autoUpdater.logger = {
      info: (m: unknown) => log.info(m),
      warn: (m: unknown) => log.warn(m),
      error: (m: unknown) => log.error(m),
      debug: (m: unknown) => log.debug(m)
    }
    const testFeed = runtime.isPackaged ? undefined : runtime.testFeed
    if (testFeed) {
      // electron-updater reads provider/url and the cache dir name from a config file in dev
      // (`dev-app-update.yml`); write one into userData instead of the repo root.
      const cfg = join(app.getPath('userData'), 'dev-app-update.yml')
      writeFileSync(
        cfg,
        `provider: generic\nurl: ${testFeed}\nupdaterCacheDirName: larto-updater-dev\n`
      )
      autoUpdater.updateConfigPath = cfg
      autoUpdater.forceDevUpdateConfig = true
      log.warn(`using test update feed ${testFeed}`)
    }
    const capability = resolveUpdateCapability({
      platform: runtime.platform,
      isPackaged: runtime.isPackaged,
      ...(testFeed ? { testFeed } : {}),
      ...(runtime.appImage ? { appImage: runtime.appImage } : {}),
      ...(runtime.portableExecutable ? { portableExecutable: runtime.portableExecutable } : {})
    })
    this.enabled = capability.enabled
    this.unsupportedReason = capability.unsupportedReason ?? 'platform'
    if (runtime.isPackaged && !this.enabled) {
      log.info(`automatic updater disabled: ${this.unsupportedReason}`)
    }

    autoUpdater.on('checking-for-update', () => this.set({ status: 'checking' }))
    autoUpdater.on('update-available', (info) => {
      if (!this.manualRequested && info.version === this.settings.get().skippedUpdateVersion) {
        log.info(`update ${info.version} skipped by user; staying quiet`)
        this.set({ status: 'notAvailable', currentVersion: app.getVersion() })
        return
      }
      this.offered = lite(info)
      this.set({ status: 'available', info: this.offered })
    })
    autoUpdater.on('update-not-available', () =>
      this.set({ status: 'notAvailable', currentVersion: app.getVersion() })
    )
    autoUpdater.on('download-progress', (p) =>
      this.set({
        status: 'downloading',
        info: this.offered ?? { version: '', releaseNotes: '', releaseDate: '' },
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

  /** `manual: false` is the silent startup check, which honours "Skip This Version". */
  check(opts: { manual?: boolean } = {}): Promise<UpdateState> {
    const manual = opts.manual ?? true
    if (this.checkInFlight) {
      // All callers share the same updater operation. A manual request always wins so an
      // overlapping silent startup check cannot hide the result the user explicitly requested.
      this.manualRequested ||= manual
      return this.checkInFlight
    }
    // Never let a second check replace an actionable update or an in-progress download.
    if (
      this.state.status === 'available' ||
      this.state.status === 'downloading' ||
      this.state.status === 'downloaded'
    ) {
      return Promise.resolve(this.state)
    }
    if (!this.enabled) {
      this.set({
        status: 'unsupported',
        currentVersion: app.getVersion(),
        reason: this.unsupportedReason
      })
      return Promise.resolve(this.state)
    }
    this.manualRequested = manual
    const operation = (async () => {
      try {
        await autoUpdater.checkForUpdates()
      } catch (err) {
        this.set({ status: 'error', message: err instanceof Error ? err.message : String(err) })
      }
      return this.state
    })()
    const inFlight = operation.finally(() => {
      if (this.checkInFlight !== inFlight) return
      this.checkInFlight = null
      this.manualRequested = false
    })
    this.checkInFlight = inFlight
    return inFlight
  }

  async download(): Promise<UpdateState> {
    if (this.state.status !== 'available') return this.state
    const info = this.state.info
    // Move out of `available` synchronously: otherwise a fast second click can still skip or
    // re-check the update before electron-updater emits its first progress event.
    this.set({
      status: 'downloading',
      info,
      percent: 0,
      bytesPerSecond: 0,
      transferred: 0,
      total: 0
    })
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

  /** Remember the offered version so the next automatic checks do not bring it up again. */
  skip(): UpdateState {
    if (this.state.status !== 'available' && this.state.status !== 'downloaded') return this.state
    this.settings.patch({ skippedUpdateVersion: this.state.info.version })
    this.set({ status: 'notAvailable', currentVersion: app.getVersion() })
    return this.state
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

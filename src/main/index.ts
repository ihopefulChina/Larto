import { cpSync, existsSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { app, BrowserWindow, dialog } from 'electron'
import { APP_ID, APP_NAME } from '@shared/constants'
import { resolveLanguage } from '@shared/i18n'
import type { ShellCommand } from '@shared/ipc'
import {
  DEFAULT_SETTINGS,
  type ProxySettings,
  type ResolvedLanguage,
  type Settings
} from '@shared/settings'
import { AccountService } from './account'
import { devToolsDock } from './devtools-dock'
import { guestManager } from './guest'
import { getAppInfo, registerIpc } from './ipc'
import { createLogger, initLogger } from './logger'
import { McpService } from './mcp'
import { buildMenu, showErrorDialog } from './menu'
import { applyProxy } from './proxy'
import { hasSandboxOptOut } from './security'
import { SettingsStore } from './store'
import { applyThemeMode, onThemeUpdated, resolveTheme, windowBackgroundColor } from './theme'
import { UpdaterService } from './updater'
import { createMainWindow, fitWindowToDevice, getMainWindow, sendToRenderer } from './window'

app.setName(APP_NAME)
if (process.platform === 'win32') app.setAppUserModelId(APP_ID)

// Tests (scripts/e2e.mjs, --smoke-test runs) point this at a scratch directory so they never
// touch the real settings/account/session of an installed copy. Must precede the instance lock.
const userDataOverride = process.env['LARTO_USER_DATA']
if (userDataOverride) {
  app.setPath('userData', userDataOverride)
  app.setPath('sessionData', userDataOverride)
} else {
  migrateLegacyUserData()
}

// Single instance: a second launch focuses the existing window.
if (hasSandboxOptOut(process.argv, process.env, app.commandLine)) {
  dialog.showErrorBox(
    `${APP_NAME} refused an unsafe launch`,
    `A Chromium sandbox opt-out was detected. Remove --no-sandbox or ELECTRON_DISABLE_SANDBOX, install user-namespace support, or use another package format; ${APP_NAME} will not open in this mode.`
  )
  app.exit(1)
} else if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  void bootstrap()
}

async function bootstrap(): Promise<void> {
  const logDir = initLogger()
  const log = createLogger('main')
  log.info(`starting ${app.getVersion()} (${process.arch}) logs=${logDir}`)

  const smoke = process.argv.some((a) => a.startsWith('--smoke-test='))
  process.on('uncaughtException', (err) => {
    log.error('uncaughtException', err)
    if (smoke) app.exit(1)
  })
  process.on('unhandledRejection', (reason) => {
    log.error('unhandledRejection', reason)
    if (smoke) app.exit(1)
  })
  // A smoke run is an isolated CI process. Keep a hard process watchdog because some Electron
  // builds can finish app teardown yet leave the main process alive waiting on native helpers.
  if (smoke) setTimeout(() => process.exit(1), 60_000)

  const settings = new SettingsStore()
  const getLang = (): ResolvedLanguage => resolveLanguage(settings.get().language, app.getLocale())
  applyThemeMode(settings.get().theme)

  const account = new AccountService(
    () => settings.get().env,
    getLang,
    () => settings.get().proxy
  )
  const updater = new UpdaterService(settings)
  const sendCommand = (cmd: ShellCommand) => sendToRenderer('shell:command', cmd)
  const mcp = new McpService({ settings, account, sendCommand })
  let appliedProxy = settings.get().proxy
  let proxyReady = false
  let proxyQueue = Promise.resolve()
  let startupProxyError: string | null = null

  const sameProxy = (a: ProxySettings, b: ProxySettings) =>
    a.mode === b.mode && a.url === b.url && a.bypass === b.bypass
  const applyProxyEverywhere = async (proxy: ProxySettings) => {
    await applyProxy(proxy)
    await account.applyProxy(proxy)
  }
  const showProxyFailure = (message: string) =>
    showErrorDialog(
      getLang() === 'zh-CN' ? '网络代理设置失败' : 'Proxy Settings Failed',
      getLang() === 'zh-CN'
        ? `无法应用新的网络代理设置：${message}`
        : `Could not apply the new network proxy settings: ${message}`
    )
  const queueProxyChange = (requested: ProxySettings) => {
    proxyQueue = proxyQueue.then(async () => {
      // Coalesce edits that were superseded before their turn reached Chromium.
      if (!sameProxy(settings.get().proxy, requested)) return
      try {
        await applyProxyEverywhere(requested)
        appliedProxy = requested
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        log.error('could not apply proxy settings', err)
        // Promise.all may have changed only some sessions. Put every path back on the last policy
        // known to have applied before restoring the persisted/UI setting.
        try {
          await applyProxyEverywhere(appliedProxy)
        } catch (rollbackError) {
          log.error('could not restore previous proxy settings', rollbackError)
        }
        if (sameProxy(settings.get().proxy, requested)) {
          try {
            settings.patch({ proxy: appliedProxy })
          } catch (writeError) {
            log.error('could not restore persisted proxy setting', writeError)
          }
          showProxyFailure(message)
        }
      }
    })
  }

  const diagnostics = (): string => {
    const info = getAppInfo()
    const s = settings.get()
    return [
      `${APP_NAME} ${info.version} (${info.arch}, packaged=${info.isPackaged})`,
      `Electron ${info.electron} / Chrome ${info.chrome} / Node ${info.node}`,
      `OS ${info.platform} ${process.getSystemVersion()}`,
      `device=${s.deviceId} zoom=${s.zoom} theme=${s.theme} lang=${getLang()} env=${s.env}`,
      `mcp=${JSON.stringify(mcp.status())}`,
      `guest=${JSON.stringify(guestManager.state)}`
    ].join('\n')
  }

  const rebuildMenu = () => buildMenu({ settings, updater, getLang, sendCommand, diagnostics })

  settings.on('change', (next, keys) => {
    if (keys.includes('mcp')) {
      const requested = { ...next.mcp }
      // Publish the settings event only after the requested socket transition settles. The
      // renderer asks for MCP status when it receives this event; sending it before listen()
      // completed left the Settings screen stuck on the previous/off state. Superseded edits do
      // not emit a stale snapshot—the newest queued restart will publish its own result.
      void mcp.start().then(() => {
        const current = settings.get()
        if (current.mcp.enabled === requested.enabled && current.mcp.port === requested.port) {
          sendToRenderer('settings:changed', current)
        }
      })
    } else {
      sendToRenderer('settings:changed', next)
    }
    if (keys.includes('theme')) applyThemeMode(next.theme)
    if (keys.includes('proxy') && proxyReady) queueProxyChange(next.proxy)
    if (keys.includes('env')) {
      account.logout()
    }
    // Zooming in must not leave the frame cut off (device switches go through guest:setDevice).
    if (keys.includes('zoom')) fitWindowToDevice(guestManager.currentDevice, next.zoom)
    if (
      keys.some((k) =>
        (['theme', 'language', 'deviceId', 'zoom'] as (keyof Settings)[]).includes(k)
      )
    )
      rebuildMenu()
  })
  account.on('change', (state) => sendToRenderer('account:changed', state))
  updater.on('state', (state) => sendToRenderer('update:state', state))
  onThemeUpdated(() => {
    const theme = resolveTheme()
    // Keep the native background in step, otherwise resizing flashes the old colour.
    getMainWindow()?.setBackgroundColor(windowBackgroundColor(theme.dark))
    sendToRenderer('theme:changed', theme)
  })
  guestManager.on('title', (title) => sendToRenderer('guest:titleChanged', { title }))
  devToolsDock.on('inspect-mode', (on) => {
    void guestManager
      .setInspecting(on)
      .catch((err) => log.warn('could not update inspect-mode emulation', err))
  })

  app.on('second-instance', () => {
    const win = getMainWindow()
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  })
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) openWindow()
  })
  app.on('window-all-closed', () => app.quit())
  app.on('before-quit', () => void mcp.stop())

  await app.whenReady()
  guestManager.installGlobalHooks()
  try {
    await applyProxyEverywhere(appliedProxy)
  } catch (err) {
    startupProxyError = err instanceof Error ? err.message : String(err)
    log.error('could not apply saved proxy settings at startup', err)
    const fallback = DEFAULT_SETTINGS.proxy
    if (!sameProxy(appliedProxy, fallback)) {
      try {
        await applyProxyEverywhere(fallback)
        appliedProxy = fallback
        settings.patch({ proxy: fallback })
      } catch (fallbackError) {
        log.error('could not apply system proxy fallback', fallbackError)
      }
    }
  }
  proxyReady = true
  account.restore()
  registerIpc({ settings, account, updater, mcp, getLang })
  rebuildMenu()
  // Complete the initial listen before the renderer reads its first MCP status.
  await mcp.start()
  openWindow()
  if (startupProxyError) setImmediate(() => showProxyFailure(startupProxyError!))
  if (app.isPackaged) {
    setTimeout(() => {
      // Re-check the live preference and state: the user may disable auto-check or complete a
      // manual check during the five-second startup delay.
      if (settings.get().autoCheckUpdates && updater.getState().status === 'idle') {
        void updater.check({ manual: false })
      }
    }, 5000)
  }

  function openWindow(): void {
    guestManager.presetDevice(settings.get().deviceId)
    const win = createMainWindow(settings)
    // Restored bounds may predate a taller preset or zoom (or this rule); grow to fit once.
    fitWindowToDevice(guestManager.currentDevice, settings.get().zoom)
    win.webContents.on('will-attach-webview', (_event, webPreferences, params) => {
      guestManager.hardenWebPreferences(webPreferences, params)
    })
    // Attach from main the moment the guest exists: this runs before the <webview> element
    // issues its `src` navigation, so emulation and console capture cover the first page load.
    // The renderer's own `guest:attach` (did-attach / dom-ready) is then a no-op.
    win.webContents.on('did-attach-webview', (_event, guest) => {
      void guestManager
        .attach(guest.id)
        .catch((err) => log.warn('initial guest emulation failed; renderer will retry', err))
    })
    runSmokeTestIfRequested(win)
  }

  /**
   * `--smoke-test=<file.png>`: headless-ish self check used by CI and agents. Waits for the
   * shell to render and the guest to attach, captures the window to <file.png>, then quits.
   */
  function runSmokeTestIfRequested(win: BrowserWindow): void {
    const arg = process.argv.find((a) => a.startsWith('--smoke-test='))
    if (!arg) return
    const file = arg.slice('--smoke-test='.length)
    let finished = false
    const deadline = setTimeout(() => finish(false, 'timeout waiting for guest'), 30_000)
    const finish = (ok: boolean, reason: string) => {
      if (finished) return
      finished = true
      clearTimeout(deadline)
      let exitCode = ok ? 0 : 1
      void win.webContents
        .capturePage()
        .then((img) => writeFile(file, img.toPNG()))
        .then(() =>
          log.info(`smoke test ${ok ? 'passed' : 'FAILED'}: ${reason}; screenshot=${file}`)
        )
        .catch((err) => {
          exitCode = 1
          log.error('smoke test capture failed', err)
        })
        // This is an isolated CI-only process. Even app.exit() can wait on Electron/native helper
        // teardown after the screenshot is complete (notably under Rosetta), so exit deterministically.
        .finally(() => process.exit(exitCode))
    }
    guestManager.once('attached', () =>
      setTimeout(() => finish(true, `guest url=${guestManager.state.url}`), 4000)
    )
  }
}

function migrateLegacyUserData(): void {
  const next = app.getPath('userData')
  if (existsSync(join(next, 'settings.json')) || existsSync(join(next, 'account.json'))) return
  // Previous product directory; copy once so a rename does not drop settings or login.
  const legacy = join(dirname(next), 'FeishuDevTools')
  if (!existsSync(legacy)) return
  try {
    cpSync(legacy, next, { recursive: true, force: false })
  } catch {
    // A fresh profile is preferable to blocking launch.
  }
}

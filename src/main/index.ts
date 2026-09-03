import { writeFile } from 'node:fs/promises'
import { app, BrowserWindow, session } from 'electron'
import { GUEST_PARTITION } from '@shared/constants'
import { resolveLanguage } from '@shared/i18n'
import type { ShellCommand } from '@shared/ipc'
import type { ProxySettings, ResolvedLanguage, Settings } from '@shared/settings'
import { AccountService } from './account'
import { guestManager } from './guest'
import { getAppInfo, registerIpc } from './ipc'
import { createLogger, initLogger } from './logger'
import { McpService } from './mcp'
import { buildMenu } from './menu'
import { SettingsStore } from './store'
import { applyThemeMode, onThemeUpdated, resolveTheme } from './theme'
import { UpdaterService } from './updater'
import { createMainWindow, getMainWindow, sendToRenderer } from './window'

app.setName('FeishuDevTools')

// Single instance: a second launch focuses the existing window.
if (!app.requestSingleInstanceLock()) {
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
  if (smoke) setTimeout(() => app.exit(1), 60_000).unref()

  const settings = new SettingsStore()
  const getLang = (): ResolvedLanguage => resolveLanguage(settings.get().language, app.getLocale())
  applyThemeMode(settings.get().theme)

  const account = new AccountService(() => settings.get().env, getLang)
  const updater = new UpdaterService()
  const sendCommand = (cmd: ShellCommand) => sendToRenderer('shell:command', cmd)
  const mcp = new McpService({ settings, account, sendCommand })

  const diagnostics = (): string => {
    const info = getAppInfo()
    const s = settings.get()
    return [
      `FeishuDevTools ${info.version} (${info.arch}, packaged=${info.isPackaged})`,
      `Electron ${info.electron} / Chrome ${info.chrome} / Node ${info.node}`,
      `macOS ${process.getSystemVersion()}`,
      `device=${s.deviceId} zoom=${s.zoom} theme=${s.theme} lang=${getLang()} env=${s.env}`,
      `mcp=${JSON.stringify(mcp.status())}`,
      `guest=${JSON.stringify(guestManager.state)}`
    ].join('\n')
  }

  const rebuildMenu = () => buildMenu({ settings, updater, getLang, sendCommand, diagnostics })

  settings.on('change', (next, keys) => {
    sendToRenderer('settings:changed', next)
    if (keys.includes('theme')) applyThemeMode(next.theme)
    if (keys.includes('proxy')) void applyProxy(next.proxy)
    if (keys.includes('mcp')) void mcp.start()
    if (keys.includes('env')) {
      account.logout()
    }
    if (
      keys.some((k) =>
        (['theme', 'language', 'deviceId', 'zoom'] as (keyof Settings)[]).includes(k)
      )
    )
      rebuildMenu()
  })
  account.on('change', (state) => sendToRenderer('account:changed', state))
  updater.on('state', (state) => sendToRenderer('update:state', state))
  onThemeUpdated(() => sendToRenderer('theme:changed', resolveTheme()))
  guestManager.on('title', (title) => sendToRenderer('guest:titleChanged', { title }))

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
  await applyProxy(settings.get().proxy)
  registerIpc({ settings, account, updater, mcp, getLang })
  rebuildMenu()
  openWindow()
  void mcp.start()
  if (settings.get().autoCheckUpdates && app.isPackaged) {
    setTimeout(() => void updater.check(), 5000)
  }

  function openWindow(): void {
    const win = createMainWindow(settings)
    win.webContents.on('will-attach-webview', (_event, webPreferences, params) => {
      guestManager.hardenWebPreferences(webPreferences, params)
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
    const deadline = setTimeout(() => finish(false, 'timeout waiting for guest'), 30_000)
    const finish = (ok: boolean, reason: string) => {
      clearTimeout(deadline)
      void win.webContents
        .capturePage()
        .then((img) => writeFile(file, img.toPNG()))
        .then(() =>
          log.info(`smoke test ${ok ? 'passed' : 'FAILED'}: ${reason}; screenshot=${file}`)
        )
        .catch((err) => log.error('smoke test capture failed', err))
        .finally(() => {
          process.exitCode = ok ? 0 : 1
          app.quit()
        })
    }
    guestManager.once('attached', () =>
      setTimeout(() => finish(true, `guest url=${guestManager.state.url}`), 4000)
    )
  }
}

async function applyProxy(proxy: ProxySettings): Promise<void> {
  const config =
    proxy.mode === 'none'
      ? { mode: 'direct' as const }
      : proxy.mode === 'manual' && proxy.url
        ? { mode: 'fixed_servers' as const, proxyRules: proxy.url, proxyBypassRules: proxy.bypass }
        : { mode: 'system' as const }
  await Promise.all([
    session.defaultSession.setProxy(config),
    session.fromPartition(GUEST_PARTITION).setProxy(config)
  ])
}

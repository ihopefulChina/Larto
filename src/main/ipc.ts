import { app, clipboard, ipcMain, shell, type IpcMainInvokeEvent } from 'electron'
import { DEVICES } from '@shared/devices'
import type { AppInfo, IpcArgs, IpcRequestChannel, IpcResult } from '@shared/ipc'
import type { ResolvedLanguage } from '@shared/settings'
import type { AccountService } from './account'
import { devToolsDock } from './devtools-dock'
import { guestManager } from './guest'
import { handleJsapiBackend } from './jsapi-backend'
import { getLogDir } from './logger'
import type { McpService } from './mcp'
import { buildMobilePreviewQr, pushPcPreviewAndOpen } from './preview'
import type { SettingsStore } from './store'
import { resolveTheme } from './theme'
import type { UpdaterService } from './updater'
import { consentBroker } from './consent'
import { fitWindowToDevice, getMainWindow } from './window'

export interface IpcDeps {
  settings: SettingsStore
  account: AccountService
  updater: UpdaterService
  mcp: McpService
  getLang: () => ResolvedLanguage
}

type Handler<C extends IpcRequestChannel> = (
  event: IpcMainInvokeEvent,
  ...args: IpcArgs<C>
) => IpcResult<C> | Promise<IpcResult<C>>

/** Type-safe `ipcMain.handle` that only accepts calls from the shell window. */
function handle<C extends IpcRequestChannel>(channel: C, handler: Handler<C>): void {
  ipcMain.handle(channel, (event, ...args) => {
    const win = getMainWindow()
    if (!win || event.sender !== win.webContents)
      throw new Error(`ipc ${channel}: unauthorised sender`)
    return handler(event, ...(args as IpcArgs<C>))
  })
}

export function getAppInfo(): AppInfo {
  return {
    name: app.name,
    version: app.getVersion(),
    electron: process.versions.electron ?? '',
    chrome: process.versions.chrome ?? '',
    node: process.versions.node ?? '',
    platform: process.platform,
    arch: process.arch,
    isPackaged: app.isPackaged,
    userDataPath: app.getPath('userData'),
    logPath: getLogDir()
  }
}

export function registerIpc(deps: IpcDeps): void {
  handle('app:getInfo', () => getAppInfo())
  handle('app:openExternal', (_e, url) => {
    if (/^(https?|mailto|lark):/i.test(url)) return shell.openExternal(url)
    throw new Error('blocked url scheme')
  })
  handle('app:openLogFolder', () => shell.openPath(getLogDir()).then(() => undefined))
  handle('app:relaunch', () => {
    app.relaunch()
    app.quit()
  })
  handle('app:copyText', (_e, text) => clipboard.writeText(text))

  handle('settings:get', () => deps.settings.get())
  handle('settings:set', (_e, patch) => deps.settings.patchWritable(patch))
  handle('settings:pushHistory', (_e, url) => deps.settings.pushHistory(url))
  handle('settings:clearHistory', () => deps.settings.clearHistory())

  handle('theme:resolve', () => resolveTheme())
  handle('devices:list', () => [...DEVICES])

  handle('guest:attach', (_e, id) => guestManager.attach(id))
  handle('guest:setDevice', async (_e, req) => {
    await guestManager.setDevice(req.webContentsId, req.deviceId, req.viewport)
    const device = guestManager.currentDevice
    fitWindowToDevice(device.width, device.platform === 'pc')
  })
  handle('guest:clearCache', (_e, id) => guestManager.clearCache(id))
  handle('jsapi:consentDecision', (_e, req) => consentBroker.decide(req.id, req.accept))
  handle('guest:openDevTools', (_e, req) => {
    const win = getMainWindow()
    if (!win) throw new Error('no main window')
    devToolsDock.open(win, req.guestWebContentsId, req.bounds)
  })
  handle('guest:setDevToolsBounds', (_e, req) => devToolsDock.setBounds(req.bounds, req.visible))
  handle('guest:closeDevTools', () => devToolsDock.close())

  handle('account:getState', () => deps.account.getState())
  handle('account:login', () => deps.account.login())
  handle('account:logout', () => deps.account.logout())
  handle('account:switchTenant', (_e, userId) => deps.account.switchTenant(userId))

  handle('preview:mobileQr', (_e, req) => buildMobilePreviewQr(req))
  handle('preview:pushPc', (_e, req) => pushPcPreviewAndOpen(deps, req))

  handle('jsapi:backend', (_e, req) => handleJsapiBackend(deps, req))
  handle('jsapi:log', (_e, entry) => deps.mcp.recordJsapi(entry))

  handle('update:check', () => deps.updater.check())
  handle('update:download', () => deps.updater.download())
  handle('update:install', () => deps.updater.install())
  handle('update:getState', () => deps.updater.getState())

  handle('mcp:getStatus', () => deps.mcp.status())
}

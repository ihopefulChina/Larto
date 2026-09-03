import { contextBridge, ipcRenderer } from 'electron'
import type { IpcArgs, IpcEventChannel, IpcEvents, IpcRequestChannel, IpcResult } from '@shared/ipc'

/**
 * Shell renderer bridge. Exposes a tiny typed surface (`window.fdt`) — the renderer
 * never touches ipcRenderer directly. Channel names are validated against the shared contract.
 */
const REQUEST_CHANNELS: ReadonlySet<string> = new Set<IpcRequestChannel>([
  'app:getInfo',
  'app:openExternal',
  'app:openLogFolder',
  'app:relaunch',
  'app:copyText',
  'settings:get',
  'settings:set',
  'settings:pushHistory',
  'settings:clearHistory',
  'theme:resolve',
  'devices:list',
  'guest:attach',
  'guest:setDevice',
  'guest:clearCache',
  'guest:openDevTools',
  'guest:setDevToolsBounds',
  'guest:closeDevTools',
  'account:getState',
  'account:login',
  'account:logout',
  'account:switchTenant',
  'preview:mobileQr',
  'preview:pushPc',
  'jsapi:backend',
  'jsapi:consentDecision',
  'jsapi:log',
  'update:check',
  'update:download',
  'update:install',
  'update:getState',
  'mcp:getStatus'
])

const EVENT_CHANNELS: ReadonlySet<string> = new Set<IpcEventChannel>([
  'settings:changed',
  'theme:changed',
  'account:changed',
  'update:state',
  'shell:command',
  'guest:titleChanged',
  'jsapi:consent'
])

export interface ShellBridge {
  invoke<C extends IpcRequestChannel>(channel: C, ...args: IpcArgs<C>): Promise<IpcResult<C>>
  on<C extends IpcEventChannel>(channel: C, listener: (payload: IpcEvents[C]) => void): () => void
  platform: NodeJS.Platform
}

const bridge: ShellBridge = {
  invoke(channel, ...args) {
    if (!REQUEST_CHANNELS.has(channel))
      return Promise.reject(new Error(`unknown ipc channel ${channel}`))
    return ipcRenderer.invoke(channel, ...args)
  },
  on(channel, listener) {
    if (!EVENT_CHANNELS.has(channel)) throw new Error(`unknown ipc event ${channel}`)
    const wrapped = (_e: Electron.IpcRendererEvent, payload: unknown) => listener(payload as never)
    ipcRenderer.on(channel, wrapped)
    return () => ipcRenderer.off(channel, wrapped)
  },
  platform: process.platform
}

contextBridge.exposeInMainWorld('fdt', bridge)

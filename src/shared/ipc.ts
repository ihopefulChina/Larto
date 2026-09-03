/**
 * Typed IPC contract between the shell renderer and the main process.
 *
 * - `IpcRequests`: request/response pairs (ipcRenderer.invoke / ipcMain.handle)
 * - `IpcEvents`:   main → renderer pushes (webContents.send / ipcRenderer.on)
 *
 * Add a new channel here first; `src/preload/shell.ts` and `src/main/ipc.ts` are
 * type-checked against this file so a missing handler is a compile error.
 */
import type { AccountState } from './account'
import type { DeviceSpec } from './devices'
import type { Settings, ThemeMode, WritableSettingKey } from './settings'

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export interface UpdateInfoLite {
  version: string
  releaseNotes: string
  releaseDate: string
}

export type UpdateState =
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'available'; info: UpdateInfoLite }
  | { status: 'notAvailable'; currentVersion: string }
  | {
      status: 'downloading'
      percent: number
      bytesPerSecond: number
      transferred: number
      total: number
    }
  | { status: 'downloaded'; info: UpdateInfoLite }
  | { status: 'error'; message: string }

export interface AppInfo {
  name: string
  version: string
  electron: string
  chrome: string
  node: string
  platform: NodeJS.Platform
  arch: string
  isPackaged: boolean
  userDataPath: string
  logPath: string
}

export interface PreviewQrResult {
  /** lark:// deep link encoded in the QR. */
  schema: string
  /** PNG data URL (240×240 canvas with 200×200 QR, official layout). */
  dataUrl: string
  /** Warnings shown under the QR, e.g. "localhost is not reachable from a phone". */
  warnings: string[]
}

export interface GuestEmulationRequest {
  /** webContents id of the <webview> (from `webview.getWebContentsId()`). */
  webContentsId: number
  deviceId: string
  /**
   * CSS size of the <webview> element (device size minus status/navigation bars). Passed as an
   * explicit CDP viewport override so `innerWidth/innerHeight` are correct from the first script.
   */
  viewport?: { width: number; height: number }
}

export interface JsapiBackendRequest {
  method: string
  params: Record<string, unknown>
  url: string
}

export interface JsapiBackendResponse {
  ok: boolean
  data: Record<string, unknown>
}

export interface JsapiLogEntry {
  ts: number
  method: string
  params: unknown
  /** null while pending (subscriptions). */
  ok: boolean | null
  result?: unknown
  handler: 'main' | 'shell' | 'mock'
}

/** request channel → [args, result] */
export interface IpcRequests {
  'app:getInfo': [[], AppInfo]
  'app:openExternal': [[url: string], void]
  'app:openLogFolder': [[], void]
  'app:relaunch': [[], void]
  'app:copyText': [[text: string], void]

  'settings:get': [[], Settings]
  'settings:set': [[patch: Partial<Pick<Settings, WritableSettingKey>>], Settings]
  'settings:pushHistory': [[url: string], string[]]
  'settings:clearHistory': [[], string[]]

  'theme:resolve': [[], { mode: ThemeMode; dark: boolean }]

  'devices:list': [[], DeviceSpec[]]

  'guest:attach': [[webContentsId: number], void]
  'guest:setDevice': [[req: GuestEmulationRequest], void]
  'guest:clearCache': [[webContentsId: number], void]
  /**
   * DevTools are hosted in a main-process WebContentsView overlaid on the shell at `bounds`
   * (CSS px relative to the window content). `setDevToolsWebContents` into a <webview> is
   * broken upstream (electron#15874/#17168), hence the overlay approach.
   */
  'guest:openDevTools': [[req: { guestWebContentsId: number; bounds: Rect }], void]
  'guest:setDevToolsBounds': [[req: { bounds: Rect; visible: boolean }], void]
  'guest:closeDevTools': [[], void]

  'account:getState': [[], AccountState]
  'account:login': [[], AccountState]
  'account:logout': [[], AccountState]
  'account:switchTenant': [[tenantUserId: string], AccountState]

  'preview:mobileQr': [[req: { url: string; appId?: string; useLanIp?: boolean }], PreviewQrResult]
  'preview:pushPc': [[req: { url: string; appId?: string }], { ok: boolean; message?: string }]

  'jsapi:backend': [[req: JsapiBackendRequest], JsapiBackendResponse]
  /** Renderer reports every JSAPI call (any handler kind) for the MCP `get_jsapi_log` tool. */
  'jsapi:log': [[entry: JsapiLogEntry], void]

  'update:check': [[], UpdateState]
  'update:download': [[], UpdateState]
  'update:install': [[], void]
  'update:getState': [[], UpdateState]

  'mcp:getStatus': [[], { running: boolean; url: string | null; error?: string }]
}

export type IpcRequestChannel = keyof IpcRequests
export type IpcArgs<C extends IpcRequestChannel> = IpcRequests[C][0]
export type IpcResult<C extends IpcRequestChannel> = IpcRequests[C][1]

/** event channel → payload */
export interface IpcEvents {
  'settings:changed': Settings
  'theme:changed': { mode: ThemeMode; dark: boolean }
  'account:changed': AccountState
  'update:state': UpdateState
  /** Menu / MCP driven commands the renderer must execute. */
  'shell:command': ShellCommand
  'guest:titleChanged': { title: string }
}
export type IpcEventChannel = keyof IpcEvents

export type ShellCommand =
  | { type: 'reload' }
  | { type: 'navigate'; url: string }
  | { type: 'toggleDevTools'; show?: boolean }
  | { type: 'setDevice'; deviceId: string }
  | { type: 'setZoom'; zoom: number }
  | { type: 'clearCache' }
  | { type: 'openPreview' }
  | { type: 'openSettings' }
  | { type: 'openAbout' }
  | { type: 'focusUrlBar' }
  | { type: 'showUpdateDialog' }

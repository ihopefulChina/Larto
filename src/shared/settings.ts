/**
 * Settings model shared by main and renderer. This file is intentionally free of
 * runtime dependencies (no zod) so the renderer bundle stays small; validation
 * lives in `settings-schema.ts` (main process only).
 */
import { DEFAULT_DEVICE_ID, DEFAULT_ZOOM } from './devices'

export type ThemeMode = 'system' | 'light' | 'dark'
export type Language = 'system' | 'zh-CN' | 'en-US'
export type ResolvedLanguage = Exclude<Language, 'system'>
/** Feishu (China) vs Lark (international) backends. */
export type FeishuEnv = 'feishu' | 'lark'

export interface ProxySettings {
  mode: 'system' | 'none' | 'manual'
  /** e.g. "http://127.0.0.1:7890" — only used when mode === 'manual'. */
  url: string
  /** Comma separated bypass list, same syntax as Chromium's --proxy-bypass-list. */
  bypass: string
}

export interface McpSettings {
  enabled: boolean
  /** Loopback only; the server never binds to non-loopback interfaces. */
  port: number
}

export interface Settings {
  version: 1
  theme: ThemeMode
  language: Language
  env: FeishuEnv
  deviceId: string
  zoom: number
  showDevTools: boolean
  /** Most recent first, at most MAX_URL_HISTORY entries. */
  urlHistory: string[]
  lastUrl: string
  proxy: ProxySettings
  mcp: McpSettings
  autoCheckUpdates: boolean
  /** "Skip this version" in the update dialog: automatic checks stay quiet about this version. */
  skippedUpdateVersion: string | null
  /** Manual geolocation override used by the JSAPI geolocation bridge. */
  mockLocation: { latitude: number; longitude: number } | null
  /**
   * Fixed CSS size for the PC preset. `null` = fill the simulator column (official
   * `calc(100% - 40px)` behaviour); the guest then uses the laid-out webview size.
   */
  pcViewport: { width: number; height: number } | null
  windowBounds: { x: number; y: number; width: number; height: number } | null
}

export const MAX_URL_HISTORY = 10
export const MAX_URL_LENGTH = 2048
export const DEFAULT_MCP_PORT = 17331

export const DEFAULT_SETTINGS: Settings = {
  version: 1,
  /** Match the dense dark workbench used by the reference developer tool; users can opt back
   * into system/light appearance from Settings. */
  theme: 'dark',
  language: 'system',
  env: 'feishu',
  deviceId: DEFAULT_DEVICE_ID,
  zoom: DEFAULT_ZOOM,
  /** The debugger is what people open the tool for; start with it docked. */
  showDevTools: true,
  urlHistory: [],
  lastUrl: '',
  proxy: { mode: 'system', url: '', bypass: '<local>' },
  mcp: { enabled: true, port: DEFAULT_MCP_PORT },
  autoCheckUpdates: true,
  skippedUpdateVersion: null,
  mockLocation: null,
  pcViewport: null,
  windowBounds: null
}

/** Keys the renderer may write through `settings:set`. */
export const WritableSettingKeys = [
  'theme',
  'language',
  'env',
  'deviceId',
  'zoom',
  'showDevTools',
  'proxy',
  'mcp',
  'autoCheckUpdates',
  'mockLocation',
  'pcViewport'
] as const satisfies readonly (keyof Settings)[]
export type WritableSettingKey = (typeof WritableSettingKeys)[number]

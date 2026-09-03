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
  /** Manual geolocation override used by the JSAPI geolocation bridge. */
  mockLocation: { latitude: number; longitude: number } | null
  windowBounds: { x: number; y: number; width: number; height: number } | null
}

export const MAX_URL_HISTORY = 10
export const MAX_URL_LENGTH = 2048
export const DEFAULT_MCP_PORT = 17331

export const DEFAULT_SETTINGS: Settings = {
  version: 1,
  theme: 'system',
  language: 'system',
  env: 'feishu',
  deviceId: DEFAULT_DEVICE_ID,
  zoom: DEFAULT_ZOOM,
  showDevTools: false,
  urlHistory: [],
  lastUrl: '',
  proxy: { mode: 'system', url: '', bypass: '<local>' },
  mcp: { enabled: true, port: DEFAULT_MCP_PORT },
  autoCheckUpdates: true,
  mockLocation: null,
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
  'mockLocation'
] as const satisfies readonly (keyof Settings)[]
export type WritableSettingKey = (typeof WritableSettingKeys)[number]

import { z } from 'zod'
import { DEFAULT_SETTINGS, MAX_URL_HISTORY, MAX_URL_LENGTH, type Settings } from '@shared/settings'

export const ThemeModeSchema = z.enum(['system', 'light', 'dark'])
export const LanguageSchema = z.enum(['system', 'zh-CN', 'en-US'])
export const FeishuEnvSchema = z.enum(['feishu', 'lark'])

const d = DEFAULT_SETTINGS

export const ProxySettingsSchema = z.object({
  mode: z.enum(['system', 'none', 'manual']).default(d.proxy.mode),
  url: z.string().default(d.proxy.url),
  bypass: z.string().default(d.proxy.bypass)
})

export const McpSettingsSchema = z.object({
  enabled: z.boolean().default(d.mcp.enabled),
  port: z.number().int().min(1024).max(65535).default(d.mcp.port)
})

/** Validates settings.json on disk; unknown keys are stripped, invalid values fall back to defaults. */
export const SettingsSchema: z.ZodType<Settings, unknown> = z.object({
  version: z.literal(1).default(1),
  theme: ThemeModeSchema.default(d.theme),
  language: LanguageSchema.default(d.language),
  env: FeishuEnvSchema.default(d.env),
  deviceId: z.string().default(d.deviceId),
  zoom: z.number().int().default(d.zoom),
  showDevTools: z.boolean().default(d.showDevTools),
  urlHistory: z.array(z.string().max(MAX_URL_LENGTH)).max(MAX_URL_HISTORY).default([]),
  lastUrl: z.string().default(''),
  proxy: ProxySettingsSchema.default(() => ({ ...d.proxy })),
  mcp: McpSettingsSchema.default(() => ({ ...d.mcp })),
  autoCheckUpdates: z.boolean().default(d.autoCheckUpdates),
  mockLocation: z.object({ latitude: z.number(), longitude: z.number() }).nullable().default(null),
  windowBounds: z
    .object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() })
    .nullable()
    .default(null)
})

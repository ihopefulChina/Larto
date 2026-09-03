import { nativeTheme } from 'electron'
import type { ThemeMode } from '@shared/settings'

export function applyThemeMode(mode: ThemeMode): void {
  nativeTheme.themeSource = mode
}

export function resolveTheme(): { mode: ThemeMode; dark: boolean } {
  return { mode: nativeTheme.themeSource, dark: nativeTheme.shouldUseDarkColors }
}

export function onThemeUpdated(listener: () => void): () => void {
  nativeTheme.on('updated', listener)
  return () => nativeTheme.off('updated', listener)
}

/** Window chrome colours matching the renderer CSS tokens (see src/renderer/src/styles/tokens.css). */
export function windowBackgroundColor(dark: boolean): string {
  return dark ? '#1f2329' : '#f5f6f7'
}

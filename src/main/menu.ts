import { app, clipboard, dialog, Menu, shell, type MenuItemConstructorOptions } from 'electron'
import {
  FEISHU_H5_DOCS_URL,
  GITHUB_URL,
  OFFICIAL_TOOL_DOCS_URL,
  WEBSITE_URL
} from '@shared/constants'
import { DEVICES, ZOOM_LEVELS } from '@shared/devices'
import { translate, type I18nKey } from '@shared/i18n'
import type { ShellCommand } from '@shared/ipc'
import type { Language, ResolvedLanguage, ThemeMode } from '@shared/settings'
import { getLogDir } from './logger'
import type { SettingsStore } from './store'
import type { UpdaterService } from './updater'
import { getMainWindow } from './window'

export interface MenuDeps {
  settings: SettingsStore
  updater: UpdaterService
  getLang: () => ResolvedLanguage
  sendCommand: (cmd: ShellCommand) => void
  diagnostics: () => string
}

/**
 * macOS application menu. Layout follows the official tool (docs/RESEARCH_OFFICIAL_TOOL.md §8)
 * minus the mini-program/CLI items, plus Appearance/Device/Zoom which the official tool lacks.
 * Rebuilt whenever settings that affect labels or checked state change.
 */
export function buildMenu(deps: MenuDeps): void {
  const lang = deps.getLang()
  const t = (k: I18nKey) => translate(lang, k)
  const s = deps.settings.get()
  const cmd = (c: ShellCommand) => () => deps.sendCommand(c)

  const appearance = (mode: ThemeMode, key: I18nKey): MenuItemConstructorOptions => ({
    label: t(key),
    type: 'radio',
    checked: s.theme === mode,
    click: () => deps.settings.patch({ theme: mode })
  })
  const language = (value: Language, label: string): MenuItemConstructorOptions => ({
    label,
    type: 'radio',
    checked: s.language === value,
    click: () => deps.settings.patch({ language: value })
  })

  const template: MenuItemConstructorOptions[] = [
    {
      label: app.name,
      submenu: [
        { label: t('menu.about'), click: cmd({ type: 'openAbout' }) },
        {
          label: t('menu.checkUpdate'),
          click: () =>
            void deps.updater.check().then(() => deps.sendCommand({ type: 'showUpdateDialog' }))
        },
        { type: 'separator' },
        { label: t('menu.settings'), accelerator: 'Cmd+,', click: cmd({ type: 'openSettings' }) },
        { type: 'separator' },
        {
          label: t('menu.debug'),
          submenu: [
            { label: t('menu.openLogs'), click: () => void shell.openPath(getLogDir()) },
            {
              label: t('menu.copyDiagnostics'),
              click: () => {
                clipboard.writeText(deps.diagnostics())
              }
            },
            {
              label: t('menu.toggleShellDevTools'),
              accelerator: 'Alt+Cmd+I',
              click: () => getMainWindow()?.webContents.toggleDevTools()
            }
          ]
        },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { label: t('menu.quit'), role: 'quit' }
      ]
    },
    {
      label: t('menu.edit'),
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    },
    {
      label: t('menu.view'),
      submenu: [
        { label: t('menu.reload'), accelerator: 'Cmd+R', click: cmd({ type: 'reload' }) },
        { label: t('menu.focusUrl'), accelerator: 'Cmd+L', click: cmd({ type: 'focusUrlBar' }) },
        {
          label: t('menu.toggleDevTools'),
          accelerator: 'Cmd+Shift+D',
          click: cmd({ type: 'toggleDevTools' })
        },
        {
          label: t('menu.clearCache'),
          accelerator: 'Cmd+Shift+Delete',
          click: cmd({ type: 'clearCache' })
        },
        { type: 'separator' },
        {
          label: t('menu.device'),
          submenu: DEVICES.map((d) => ({
            label: d.name,
            type: 'radio' as const,
            checked: s.deviceId === d.id,
            click: () => deps.sendCommand({ type: 'setDevice', deviceId: d.id })
          }))
        },
        {
          label: t('menu.zoom'),
          submenu: ZOOM_LEVELS.map((z) => ({
            label: `${z}%`,
            type: 'radio' as const,
            checked: s.zoom === z,
            click: () => deps.sendCommand({ type: 'setZoom', zoom: z })
          }))
        },
        {
          label: t('menu.appearance'),
          submenu: [
            appearance('system', 'menu.appearance.system'),
            appearance('light', 'menu.appearance.light'),
            appearance('dark', 'menu.appearance.dark')
          ]
        },
        {
          label: t('menu.language'),
          submenu: [
            language('system', t('menu.language.system')),
            language('zh-CN', '简体中文'),
            language('en-US', 'English')
          ]
        },
        { type: 'separator' },
        { label: t('menu.togglefullscreen'), role: 'togglefullscreen' }
      ]
    },
    {
      label: t('menu.window'),
      role: 'windowMenu'
    },
    {
      label: t('menu.help'),
      role: 'help',
      submenu: [
        { label: t('menu.help.docs'), click: () => void shell.openExternal(FEISHU_H5_DOCS_URL) },
        {
          label: t('menu.help.officialTool'),
          click: () => void shell.openExternal(OFFICIAL_TOOL_DOCS_URL)
        },
        { type: 'separator' },
        { label: t('menu.help.website'), click: () => void shell.openExternal(WEBSITE_URL) },
        { label: t('menu.help.github'), click: () => void shell.openExternal(GITHUB_URL) },
        {
          label: t('menu.help.issue'),
          click: () => {
            const body = encodeURIComponent(`\n\n---\n${deps.diagnostics()}`)
            void shell.openExternal(`${GITHUB_URL}/issues/new?body=${body}`)
          }
        }
      ]
    }
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

export function showErrorDialog(title: string, message: string): void {
  const win = getMainWindow()
  const opts = { type: 'error' as const, title, message }
  if (win) void dialog.showMessageBox(win, opts)
  else void dialog.showMessageBox(opts)
}

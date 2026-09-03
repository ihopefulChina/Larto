import { useCallback, useEffect, useState } from 'react'
import { ZOOM_LEVELS } from '@shared/devices'
import type { ShellCommand } from '@shared/ipc'
import { invoke, on } from '@/lib/bridge'
import { useApp, useT } from '@/store/app'
import { simulatorActions, useSimulator } from '@/store/simulator'
import { DevToolsPane } from './components/DevToolsPane'
import { Simulator } from './components/Simulator'
import { Toolbar } from './components/Toolbar'
import { navigateTo } from './components/UrlBar'
import { AboutModal } from './components/modals/AboutModal'
import { PreviewModal } from './components/modals/PreviewModal'
import { SettingsModal } from './components/modals/SettingsModal'
import { UpdateDialog } from './components/modals/UpdateDialog'
import { ConsentModal } from './components/modals/ConsentModal'

export function App() {
  const t = useT()
  const ready = useApp((s) => s.ready)
  const dark = useApp((s) => s.dark)
  const modal = useApp((s) => s.modal)
  const showDevTools = useApp((s) => s.settings.showDevTools)
  const setSetting = useApp((s) => s.setSetting)
  const [focusSignal, setFocusSignal] = useState(0)
  const [appToast, setAppToast] = useState<string | null>(null)

  useEffect(() => {
    void useApp.getState().init()
  }, [])

  useEffect(() => {
    document.documentElement.dataset['theme'] = dark ? 'dark' : 'light'
  }, [dark])

  const clearCache = useCallback(async () => {
    const id = useSimulator.getState().webContentsId
    if (id === null) return
    await invoke('guest:clearCache', id)
    simulatorActions.reload()
    setAppToast(t('cache.cleared'))
    setTimeout(() => setAppToast(null), 1500)
  }, [t])

  const toggleDevTools = useCallback(
    (show?: boolean) => {
      const next = show ?? !useApp.getState().settings.showDevTools
      void setSetting('showDevTools', next)
    },
    [setSetting]
  )

  // Commands from the native menu and the MCP server.
  useEffect(() => {
    return on('shell:command', (cmd: ShellCommand) => {
      switch (cmd.type) {
        case 'reload':
          simulatorActions.reload()
          break
        case 'navigate':
          void navigateTo(cmd.url)
          break
        case 'toggleDevTools':
          toggleDevTools(cmd.show)
          break
        case 'setDevice':
          void simulatorActions.changeDevice(cmd.deviceId)
          break
        case 'setZoom':
          if (ZOOM_LEVELS.includes(cmd.zoom)) void setSetting('zoom', cmd.zoom)
          break
        case 'clearCache':
          void clearCache()
          break
        case 'openPreview':
          useApp.getState().openModal('preview')
          break
        case 'openSettings':
          useApp.getState().openModal('settings')
          break
        case 'openAbout':
          useApp.getState().openModal('about')
          break
        case 'showUpdateDialog':
          useApp.getState().openModal('update')
          break
        case 'focusUrlBar':
          setFocusSignal((n) => n + 1)
          break
      }
    })
  }, [clearCache, setSetting, toggleDevTools])

  if (!ready) return <div className="main" />

  return (
    <div className="main">
      <Toolbar
        focusSignal={focusSignal}
        onClearCache={() => void clearCache()}
        onToggleDevTools={() => toggleDevTools()}
      />
      <div className="idePanel">
        <Simulator />
        {showDevTools && <DevToolsPane />}
      </div>
      {modal === 'preview' && <PreviewModal />}
      {modal === 'settings' && <SettingsModal />}
      {modal === 'about' && <AboutModal />}
      {modal === 'update' && <UpdateDialog />}
      {modal === 'consent' && <ConsentModal />}
      {appToast && <div className="appToast">{appToast}</div>}
    </div>
  )
}

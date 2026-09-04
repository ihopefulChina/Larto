import { invoke } from '@/lib/bridge'
import { useApp, useT } from '@/store/app'
import { useSimulator } from '@/store/simulator'
import { AccountMenu } from './AccountMenu'
import { CodeIcon, PreviewIcon, TrashIcon } from './icons'

interface ToolbarProps {
  onClearCache: () => void
  onToggleDevTools: () => void
}

/** Compact window-level command bar. Page navigation lives with the simulator below it. */
export function Toolbar({ onClearCache, onToggleDevTools }: ToolbarProps) {
  const t = useT()
  const showDevTools = useApp((s) => s.settings.showDevTools)
  const checkingUpdate = useApp((s) => s.update.status === 'checking')
  const openModal = useApp((s) => s.openModal)
  const hasUrl = useSimulator((s) => !!s.url && s.url !== 'about:blank')
  const pageTitle = useSimulator((s) => s.title)

  const checkForUpdates = () => {
    openModal('update')
    void invoke('update:check')
  }

  return (
    <header className="toolPanel">
      <div className="toolBar-title" title={pageTitle || t('app.windowTitle')}>
        {pageTitle ? `${pageTitle} - ${t('app.windowTitle')}` : t('app.windowTitle')}
      </div>
      <div className="toolBar-content">
        <div className="toolBar-mode" aria-label={t('toolbar.webMode')}>
          <CodeIcon aria-hidden />
          <span>{t('toolbar.webMode')}</span>
        </div>
        <div className="toolBar-group toolBar-actions">
          <button
            type="button"
            className="tbtn"
            onClick={() => openModal('preview')}
            disabled={!hasUrl}
            title={t('toolbar.preview')}
          >
            <PreviewIcon aria-hidden />
            {t('toolbar.preview')}
          </button>
          <button
            type="button"
            className="tbtn"
            onClick={onClearCache}
            disabled={!hasUrl}
            title={t('toolbar.clearCache')}
          >
            <TrashIcon aria-hidden />
            {t('toolbar.clearCache')}
          </button>
          <button
            type="button"
            className={`tbtn ${showDevTools ? 'selected' : ''}`}
            onClick={onToggleDevTools}
            aria-pressed={showDevTools}
            title={t('toolbar.devtools')}
          >
            <CodeIcon aria-hidden />
            {t('toolbar.devtools')}
          </button>
          <span className="toolBar-divider" aria-hidden />
          <button type="button" className="tbtn text" onClick={() => openModal('settings')}>
            {t('settings.title')}
          </button>
          <button
            type="button"
            className="tbtn text"
            onClick={checkForUpdates}
            disabled={checkingUpdate}
            aria-busy={checkingUpdate}
          >
            {t('toolbar.checkUpdate')}
          </button>
          <AccountMenu />
        </div>
      </div>
    </header>
  )
}

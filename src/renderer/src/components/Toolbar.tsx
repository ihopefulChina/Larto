import { useApp, useT } from '@/store/app'
import { useSimulator } from '@/store/simulator'
import { AccountMenu } from './AccountMenu'
import { UrlBar } from './UrlBar'

interface ToolbarProps {
  focusSignal: number
  onClearCache: () => void
  onToggleDevTools: () => void
}

/** Top panel: drag-able title row + official three-group toolbar (§2.1). */
export function Toolbar({ focusSignal, onClearCache, onToggleDevTools }: ToolbarProps) {
  const t = useT()
  const showDevTools = useApp((s) => s.settings.showDevTools)
  const openModal = useApp((s) => s.openModal)
  const hasUrl = useSimulator((s) => !!s.url)

  return (
    <div className="toolPanel">
      <div className="toolBar-title">{t('app.windowTitle')}</div>
      <div className="toolBar-content">
        <div className="toolBar-group left">
          <UrlBar focusSignal={focusSignal} />
          <button className="tbtn" onClick={() => openModal('preview')} disabled={!hasUrl}>
            {t('toolbar.preview')}
          </button>
          <button className="tbtn" onClick={onClearCache}>
            {t('toolbar.clearCache')}
          </button>
        </div>
        <div className="toolBar-group">
          <button className="tbtn selected" disabled>
            {t('toolbar.simulator')}
          </button>
          <button className={`tbtn ${showDevTools ? 'selected' : ''}`} onClick={onToggleDevTools}>
            {t('toolbar.devtools')}
          </button>
        </div>
        <div className="toolBar-group">
          <AccountMenu />
        </div>
      </div>
    </div>
  )
}

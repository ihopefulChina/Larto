import { invoke } from '@/lib/bridge'
import { useApp, useT } from '@/store/app'
import { Modal } from '../Modal'

/** Official flow (§9): available → user downloads → downloaded → user restarts. */
export function UpdateDialog() {
  const t = useT()
  const update = useApp((s) => s.update)
  const close = () => useApp.getState().openModal(null)

  let body: React.ReactNode
  let footer: React.ReactNode = (
    <button className="btn" onClick={close}>
      {t('common.close')}
    </button>
  )
  switch (update.status) {
    case 'checking':
    case 'idle':
      body = <p className="hint">{t('update.checking')}</p>
      break
    case 'notAvailable':
      body = (
        <p className="hint">
          {t('update.notAvailable')} ({update.currentVersion})
        </p>
      )
      break
    case 'available':
      body = (
        <>
          <p>
            {t('update.available')}: <b>v{update.info.version}</b>
          </p>
          {update.info.releaseNotes && (
            <div className="notes" dangerouslySetInnerHTML={{ __html: update.info.releaseNotes }} />
          )}
        </>
      )
      footer = (
        <>
          <button className="btn" onClick={close}>
            {t('update.later')}
          </button>
          <button className="btn primary" onClick={() => void invoke('update:download')}>
            {t('update.download')}
          </button>
        </>
      )
      break
    case 'downloading':
      body = (
        <>
          <p>
            {t('update.downloading')} {update.percent.toFixed(0)}%
          </p>
          <div className="progress">
            <span style={{ width: `${update.percent}%` }} />
          </div>
          <p className="hint">
            {(update.transferred / 1048576).toFixed(1)} / {(update.total / 1048576).toFixed(1)} MB ·{' '}
            {(update.bytesPerSecond / 1048576).toFixed(2)} MB/s
          </p>
        </>
      )
      footer = null
      break
    case 'downloaded':
      body = (
        <p>
          {t('update.downloaded')}: <b>v{update.info.version}</b>
        </p>
      )
      footer = (
        <>
          <button className="btn" onClick={close}>
            {t('update.later')}
          </button>
          <button className="btn primary" onClick={() => void invoke('update:install')}>
            {t('update.install')}
          </button>
        </>
      )
      break
    case 'error':
      body = (
        <p style={{ color: 'var(--danger)' }}>
          {t('update.error')}: {update.message}
        </p>
      )
      break
  }
  return (
    <Modal title={t('menu.checkUpdate')} width={400} footer={footer}>
      {body}
    </Modal>
  )
}

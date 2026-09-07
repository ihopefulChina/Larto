import { useMemo, type MouseEvent, type ReactNode } from 'react'
import { APP_NAME, GITHUB_URL } from '@shared/constants'
import type { I18nKey } from '@shared/i18n'
import { invoke } from '@/lib/bridge'
import { isMarkup, sanitizeReleaseNotes } from '@/lib/release-notes'
import { useApp, useT } from '@/store/app'
import iconUrl from '@/assets/icon.png'
import { Modal } from '../Modal'

const RELEASES_URL = `${GITHUB_URL}/releases/latest`

/**
 * Sparkle-style update window: app icon, headline, one-line status, release notes, then
 * "Skip This Version" on the left and "Remind Me Later" / "Install Update" on the right.
 * Flow stays the official one (§9): available → download → downloaded → relaunch.
 */
export function UpdateDialog() {
  const t = useT()
  const update = useApp((s) => s.update)
  const info = useApp((s) => s.info)
  const autoCheck = useApp((s) => s.settings.autoCheckUpdates)
  const close = () => useApp.getState().openModal(null)
  const app = info?.name ?? APP_NAME
  const vars = (extra: Record<string, string> = {}) => ({
    app,
    cur: info?.version ?? '',
    ...extra
  })
  const msg = (key: I18nKey, values: Record<string, string>) =>
    Object.entries(values).reduce((s, [k, v]) => s.replaceAll(`{${k}}`, v), t(key))

  let title: string
  let hint: string
  let body: ReactNode = null
  let left: ReactNode = null
  let right: ReactNode
  switch (update.status) {
    case 'idle':
    case 'checking':
      title = t('update.checking')
      hint = t('update.checking.hint')
      body = <div className="progress indeterminate" aria-hidden="true" />
      right = (
        <button className="btn" onClick={close}>
          {t('common.cancel')}
        </button>
      )
      break
    case 'notAvailable':
      title = t('update.notAvailable')
      hint = msg('update.notAvailable.hint', vars({ cur: update.currentVersion }))
      right = (
        <button className="btn primary" onClick={close} autoFocus>
          {t('common.ok')}
        </button>
      )
      break
    case 'unsupported': {
      title = t('update.unsupported')
      const hintKey = `update.unsupported.${update.reason}` as I18nKey
      hint = msg(hintKey, vars({ cur: update.currentVersion }))
      right = (
        <>
          <button className="btn" onClick={close}>
            {t('common.close')}
          </button>
          <button
            className="btn primary"
            onClick={() => void invoke('app:openExternal', RELEASES_URL).then(close)}
            autoFocus
          >
            {t('update.openReleases')}
          </button>
        </>
      )
      break
    }
    case 'available':
      title = msg('update.available', vars())
      hint = msg('update.available.hint', vars({ new: update.info.version }))
      body = (
        <>
          <ReleaseNotes notes={update.info.releaseNotes} label={t('update.releaseNotes')} />
          <label className="updateAuto">
            <input
              type="checkbox"
              checked={autoCheck}
              onChange={(e) =>
                void useApp.getState().setSetting('autoCheckUpdates', e.target.checked)
              }
            />
            {t('settings.autoCheckUpdates')}
          </label>
        </>
      )
      left = (
        <button className="btn" onClick={() => void invoke('update:skip').then(close)}>
          {t('update.skip')}
        </button>
      )
      right = (
        <>
          <button className="btn" onClick={close}>
            {t('update.later')}
          </button>
          <button className="btn primary" onClick={() => void invoke('update:download')} autoFocus>
            {t('update.install')}
          </button>
        </>
      )
      break
    case 'downloading':
      title = t('update.downloading')
      hint = msg('update.downloading.hint', vars({ new: update.info.version }))
      body = (
        <>
          <div className="progress">
            <span style={{ width: `${update.percent}%` }} />
          </div>
          <p className="updateMeta">
            {mb(update.transferred)} / {mb(update.total)} MB · {mb(update.bytesPerSecond, 2)} MB/s ·{' '}
            {update.percent.toFixed(0)}%
          </p>
        </>
      )
      right = null
      break
    case 'downloaded':
      title = t('update.downloaded')
      hint = msg('update.downloaded.hint', vars({ new: update.info.version }))
      body = <ReleaseNotes notes={update.info.releaseNotes} label={t('update.releaseNotes')} />
      right = (
        <>
          <button className="btn" onClick={close}>
            {t('update.later')}
          </button>
          <button className="btn primary" onClick={() => void invoke('update:install')} autoFocus>
            {t('update.relaunch')}
          </button>
        </>
      )
      break
    case 'error':
      title = t('update.error')
      hint = t('update.error.hint')
      body = <p className="updateError">{update.message}</p>
      right = (
        <>
          <button className="btn" onClick={close}>
            {t('common.close')}
          </button>
          <button
            className="btn primary"
            onClick={() => void invoke('app:openExternal', RELEASES_URL).then(close)}
            autoFocus
          >
            {t('update.openReleases')}
          </button>
        </>
      )
      break
  }

  return (
    <Modal
      title={title}
      width={560}
      chrome="plain"
      className="update"
      footer={
        right || left ? (
          <>
            <div className="updateFootLeft">{left}</div>
            <div className="updateFootRight">{right}</div>
          </>
        ) : undefined
      }
    >
      <div className="updateHead">
        <img src={iconUrl} alt="" />
        <div>
          <h2>{title}</h2>
          <p>{hint}</p>
        </div>
      </div>
      {body}
    </Modal>
  )
}

function ReleaseNotes({ notes, label }: { notes: string; label: string }) {
  const html = useMemo(
    () => (notes && isMarkup(notes) ? sanitizeReleaseNotes(notes) : null),
    [notes]
  )
  if (!notes.trim()) return null
  const onClick = (e: MouseEvent<HTMLDivElement>) => {
    const a = (e.target as HTMLElement).closest('a')
    if (!a) return
    e.preventDefault()
    const href = a.getAttribute('href')
    if (href) void invoke('app:openExternal', href)
  }
  return html !== null ? (
    <div
      className="releaseNotes"
      role="document"
      aria-label={label}
      onClick={onClick}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  ) : (
    <div className="releaseNotes plain" role="document" aria-label={label}>
      {notes}
    </div>
  )
}

function mb(bytes: number, digits = 1): string {
  return (bytes / 1048576).toFixed(digits)
}

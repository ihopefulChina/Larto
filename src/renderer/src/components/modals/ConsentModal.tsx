import { useState } from 'react'
import { invoke } from '@/lib/bridge'
import { useApp, useT } from '@/store/app'
import { Modal } from '../Modal'

const PREVIEW_COUNT = 3

/**
 * requestAccess scope confirmation. Mirrors the passport `AuthzModal` the official tool
 * renders: app icon ⇄ Feishu icon, "<app> requests your authorization", the account that
 * will grant it, the scope list (first 3, expandable) and Cancel / Authorize.
 */
export function ConsentModal() {
  const t = useT()
  const prompt = useApp((s) => s.consent)
  const [expanded, setExpanded] = useState(false)
  const [busy, setBusy] = useState(false)
  if (!prompt) return null
  const { info } = prompt

  const decide = async (accept: boolean) => {
    if (busy) return
    setBusy(true)
    try {
      await invoke('jsapi:consentDecision', { id: prompt.id, accept })
    } finally {
      useApp.setState({ modal: null, consent: null })
    }
  }
  const scopes = expanded ? info.scopes : info.scopes.slice(0, PREVIEW_COUNT)

  return (
    <Modal
      title={t('consent.title').replace('{appName}', info.appName)}
      width={420}
      onClose={() => void decide(false)}
      footer={
        <>
          <button className="btn" disabled={busy} onClick={() => void decide(false)}>
            {t('common.cancel')}
          </button>
          <button className="btn primary" disabled={busy} onClick={() => void decide(true)}>
            {t('consent.authorize')}
          </button>
        </>
      }
    >
      <div className="consent">
        <div className="consent-icons">
          {info.appIconUrl ? <img src={info.appIconUrl} alt="" /> : <span className="ph" />}
          <span className="consent-arrow">⇄</span>
          {info.suiteIconUrl ? <img src={info.suiteIconUrl} alt="" /> : <span className="ph" />}
        </div>
        <p className="hint">{t('consent.account')}</p>
        <div className="consent-user">
          {info.tenantIconUrl && <img src={info.tenantIconUrl} alt="" />}
          <span>{info.userName}</span>
        </div>
        <p className="hint">{t('consent.scopes')}</p>
        <ul className="consent-scopes">
          {scopes.map((s) => (
            <li key={s.name || s.desc}>{s.desc}</li>
          ))}
        </ul>
        {!expanded && info.scopes.length > PREVIEW_COUNT && (
          <button className="linkBtn" onClick={() => setExpanded(true)}>
            {t('consent.more')}
          </button>
        )}
      </div>
    </Modal>
  )
}

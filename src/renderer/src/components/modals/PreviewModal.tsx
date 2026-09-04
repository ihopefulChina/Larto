import { useEffect, useState } from 'react'
import type { PreviewQrResult } from '@shared/ipc'
import { invoke } from '@/lib/bridge'
import { useApp, useT } from '@/store/app'
import { useSimulator } from '@/store/simulator'
import { Modal } from '../Modal'

/** Official preview dialog (§6): Mobile tab = lark://client/web QR; PC tab = push_preview. */
export function PreviewModal() {
  const t = useT()
  const url = useSimulator((s) => s.url)
  const account = useApp((s) => s.account)
  const [tab, setTab] = useState<'mobile' | 'pc'>('mobile')
  const [useLanIp, setUseLanIp] = useState(/localhost|127\.0\.0\.1/.test(url))
  const [qr, setQr] = useState<PreviewQrResult | null>(null)
  const [copied, setCopied] = useState(false)
  const [pcMessage, setPcMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!url) return
    let cancelled = false
    void invoke('preview:mobileQr', { url, useLanIp }).then((r) => {
      if (!cancelled) setQr(r)
    })
    return () => {
      cancelled = true
    }
  }, [url, useLanIp])

  const copy = async () => {
    if (!qr) return
    // Copy the PNG through the renderer clipboard API (image) and fall back to the schema text.
    try {
      const blob = await (await fetch(qr.dataUrl)).blob()
      await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })])
    } catch {
      await invoke('app:copyText', qr.schema)
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const openPc = async () => {
    setBusy(true)
    const r = await invoke('preview:pushPc', { url })
    setBusy(false)
    setPcMessage(r.ok ? null : (r.message ?? 'failed'))
    if (r.ok) useApp.getState().openModal(null)
  }

  return (
    <Modal title={t('preview.title')} width={420}>
      <div className="tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'mobile'}
          className={tab === 'mobile' ? 'active' : ''}
          onClick={() => setTab('mobile')}
        >
          {t('preview.mobile')}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'pc'}
          className={tab === 'pc' ? 'active' : ''}
          onClick={() => setTab('pc')}
        >
          {t('preview.pc')}
        </button>
      </div>
      {tab === 'mobile' ? (
        <>
          <div className="qrWrap">
            {qr ? <img src={qr.dataUrl} alt={t('preview.qrAlt')} /> : <span className="spinner" />}
          </div>
          <p className="hint">{t('preview.scanHint')}</p>
          <label className="field" style={{ justifyContent: 'center' }}>
            <input
              type="checkbox"
              checked={useLanIp}
              onChange={(e) => setUseLanIp(e.target.checked)}
            />{' '}
            {t('preview.useLanIp')}
          </label>
          {qr?.warnings.map((w) => (
            <div key={w} className="warn">
              {w}
            </div>
          ))}
          <div style={{ textAlign: 'center', marginTop: 12 }}>
            <button
              type="button"
              className="btn primary"
              onClick={() => void copy()}
              disabled={!qr}
            >
              {copied ? t('preview.copied') : t('preview.copyQr')}
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="hint">{t('preview.pcHint')}</p>
          {account.status !== 'signedIn' && <div className="warn">{t('preview.needLogin')}</div>}
          {pcMessage && <div className="warn">{pcMessage}</div>}
          <div style={{ textAlign: 'center', marginTop: 12 }}>
            <button
              type="button"
              className="btn primary"
              disabled={account.status !== 'signedIn' || busy}
              onClick={() => void openPc()}
            >
              {t('preview.openPc')}
            </button>
          </div>
        </>
      )}
    </Modal>
  )
}

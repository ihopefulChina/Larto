import { useEffect, useState } from 'react'
import { useT } from '@/store/app'
import { useSimulator, type DialogState } from '@/store/simulator'

function Dialog({ d }: { d: DialogState }) {
  const popDialog = useSimulator((s) => s.popDialog)
  const [value, setValue] = useState(d.defaultValue ?? '')
  const finish = (buttonIndex: number) => {
    popDialog(d.id)
    d.resolve(d.type === 'prompt' ? { buttonIndex, value } : { buttonIndex })
  }
  return (
    <div className="overlay">
      <div className="dlg" role="dialog">
        <div className="body">
          {d.title && <h4>{d.title}</h4>}
          {d.message && <p>{d.message}</p>}
          {d.type === 'prompt' && (
            <input
              autoFocus
              value={value}
              placeholder={d.placeholder}
              onChange={(e) => setValue(e.target.value)}
            />
          )}
        </div>
        <div className="btns">
          {d.buttons.map((b, i) => (
            <button key={`${b}-${i}`} onClick={() => finish(i)}>
              {b}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

/** All JSAPI-driven UI drawn inside the device frame: dialogs, action sheet, toast, preloader, image preview. */
export function JsapiOverlays() {
  const t = useT()
  const dialogs = useSimulator((s) => s.dialogs)
  const actionSheet = useSimulator((s) => s.actionSheet)
  const toast = useSimulator((s) => s.toast)
  const preloader = useSimulator((s) => s.preloader)
  const imagePreview = useSimulator((s) => s.imagePreview)
  const closed = useSimulator((s) => s.closed)
  const { setActionSheet, setToast, setImagePreview } = useSimulator.getState()

  useEffect(() => {
    if (!toast || toast.icon === 'loading') return
    const id = setTimeout(() => setToast(null), Math.max(500, toast.duration))
    return () => clearTimeout(id)
  }, [toast, setToast])

  return (
    <>
      {dialogs[0] && <Dialog key={dialogs[0].id} d={dialogs[0]} />}
      {actionSheet && (
        <div className="overlay bottom">
          <div className="sheet">
            {actionSheet.title && <div className="title">{actionSheet.title}</div>}
            {actionSheet.items.map((item, i) => (
              <button
                key={`${item}-${i}`}
                onClick={() => {
                  setActionSheet(null)
                  actionSheet.resolve(i)
                }}
              >
                {item}
              </button>
            ))}
            <button
              className="cancel"
              onClick={() => {
                setActionSheet(null)
                actionSheet.resolve(null)
              }}
            >
              {t('simulator.cancel')}
            </button>
          </div>
        </div>
      )}
      {preloader && (
        <div className="overlay transparent">
          <div className="toast">
            <span className="spinner" />
            {preloader.text}
          </div>
        </div>
      )}
      {toast && (
        <div className="overlay transparent">
          <div className="toast">
            {toast.icon === 'loading' && <span className="spinner" />}
            {toast.icon === 'success' && <span>✓</span>}
            {toast.icon === 'error' && <span>✕</span>}
            {toast.text}
          </div>
        </div>
      )}
      {imagePreview && (
        <div className="overlay imgPreview" onClick={() => setImagePreview(null)}>
          <img src={imagePreview.urls[imagePreview.current]} alt="" />
          {imagePreview.urls.length > 1 && (
            <div className="counter" onClick={(e) => e.stopPropagation()}>
              <button
                style={{ color: '#fff' }}
                onClick={() =>
                  setImagePreview({
                    ...imagePreview,
                    current:
                      (imagePreview.current - 1 + imagePreview.urls.length) %
                      imagePreview.urls.length
                  })
                }
              >
                ‹
              </button>
              {` ${imagePreview.current + 1} / ${imagePreview.urls.length} `}
              <button
                style={{ color: '#fff' }}
                onClick={() =>
                  setImagePreview({
                    ...imagePreview,
                    current: (imagePreview.current + 1) % imagePreview.urls.length
                  })
                }
              >
                ›
              </button>
            </div>
          )}
        </div>
      )}
      {closed && <div className="closedPage">{t('simulator.closed')}</div>}
    </>
  )
}

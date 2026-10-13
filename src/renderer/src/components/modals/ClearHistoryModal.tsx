import { invoke } from '@/lib/bridge'
import { useApp, useT } from '@/store/app'
import { Modal } from '../Modal'

/** Confirmation step before `settings:clearHistory` wipes every stored address. */
export function ClearHistoryModal() {
  const t = useT()
  const close = () => useApp.getState().openModal(null)
  return (
    <Modal
      title={t('toolbar.clearHistoryConfirmTitle')}
      width={360}
      footer={
        <>
          <button type="button" className="btn" onClick={close}>
            {t('common.cancel')}
          </button>
          <button
            type="button"
            className="btn primary"
            onClick={() => {
              void invoke('settings:clearHistory').then((h) =>
                useApp.setState((s) => ({ settings: { ...s.settings, urlHistory: h } }))
              )
              close()
            }}
          >
            {t('toolbar.clearHistory')}
          </button>
        </>
      }
    >
      <p className="confirmText">{t('toolbar.clearHistoryConfirm')}</p>
    </Modal>
  )
}

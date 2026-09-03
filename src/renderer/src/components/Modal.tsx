import { useEffect, type ReactNode } from 'react'
import { useApp, useT } from '@/store/app'

interface ModalProps {
  title: string
  children: ReactNode
  footer?: ReactNode
  width?: number
}

export function Modal({ title, children, footer, width }: ModalProps) {
  const t = useT()
  const close = () => useApp.getState().openModal(null)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  return (
    <div className="modalMask" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal" style={width ? { width } : undefined} role="dialog" aria-label={title}>
        <div className="modal-head">
          <span>{title}</span>
          <button className="tbtn icon" onClick={close} title={t('common.close')}>
            ✕
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  )
}

import { useEffect, useRef, type ReactNode } from 'react'
import { useApp, useT } from '@/store/app'
import { CloseIcon } from './icons'

interface ModalProps {
  title: string
  children: ReactNode
  footer?: ReactNode
  width?: number
  /** `plain` drops the title bar; the body draws its own header (update dialog). */
  chrome?: 'default' | 'plain'
  className?: string
  /** Overlay click and Escape dismiss. Default true. */
  dismissible?: boolean
  onClose?: () => void
}

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea, [tabindex]:not([tabindex="-1"])'

export function Modal({
  title,
  children,
  footer,
  width,
  chrome = 'default',
  className,
  dismissible = true,
  onClose
}: ModalProps) {
  const t = useT()
  const dialogRef = useRef<HTMLDivElement>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  const close = () => {
    if (onCloseRef.current) onCloseRef.current()
    else useApp.getState().openModal(null)
  }

  useEffect(() => {
    const root = dialogRef.current
    if (!root) return
    const prev = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const items = () =>
      [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
        (el) => !el.hasAttribute('aria-hidden')
      )
    const starter =
      root.querySelector<HTMLElement>('[autofocus]') ??
      (chrome === 'default' ? root.querySelector<HTMLElement>('.modal-head .tbtn') : null) ??
      items()[0]
    starter?.focus()

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (!dismissible) return
        e.preventDefault()
        e.stopPropagation()
        close()
        return
      }
      if (e.key !== 'Tab') return
      const list = items()
      if (list.length === 0) return
      const first = list[0]
      const last = list[list.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last?.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first?.focus()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      prev?.focus()
    }
  }, [chrome, dismissible])

  return (
    <div
      className="modalMask"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && dismissible) close()
      }}
    >
      <div
        ref={dialogRef}
        className={`modal${className ? ' ' + className : ''}`}
        style={width ? { width } : undefined}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {chrome === 'default' && (
          <div className="modal-head">
            <span id="fdt-modal-title">{title}</span>
            <button
              type="button"
              className="tbtn icon"
              onClick={close}
              title={t('common.close')}
              aria-label={t('common.close')}
            >
              <CloseIcon aria-hidden />
            </button>
          </div>
        )}
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  )
}

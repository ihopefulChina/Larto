import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useCoversDevTools } from '@/store/app'

interface DropdownProps {
  trigger: (open: boolean, toggle: () => void) => ReactNode
  align?: 'left' | 'right'
  placement?: 'bottom' | 'top'
  children: (close: () => void) => ReactNode
  className?: string
}

/** Minimal click-outside dropdown used for history, device, zoom and account menus. */
export function Dropdown({
  trigger,
  align = 'left',
  placement = 'bottom',
  children,
  className
}: DropdownProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  useCoversDevTools(open, menuRef)

  const closeAndRestoreFocus = () => {
    setOpen(false)
    requestAnimationFrame(() =>
      ref.current?.querySelector<HTMLButtonElement>(':scope > button')?.focus()
    )
  }

  useEffect(() => {
    if (!open) return
    const items = () => [
      ...(menuRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])
    ]
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        closeAndRestoreFocus()
        return
      }
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Home' && e.key !== 'End')
        return
      const list = items()
      if (!list.length) return
      e.preventDefault()
      const i = list.findIndex((el) => el === document.activeElement)
      let next = 0
      if (e.key === 'ArrowDown') next = i < 0 ? 0 : (i + 1) % list.length
      else if (e.key === 'ArrowUp')
        next = i < 0 ? list.length - 1 : (i - 1 + list.length) % list.length
      else if (e.key === 'End') next = list.length - 1
      list[next]?.focus()
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div ref={ref} className={`dropdown ${placement === 'top' ? 'dropup' : ''} ${className ?? ''}`}>
      {trigger(open, () => setOpen((v) => !v))}
      {open && (
        <div ref={menuRef} className={`menu ${align}`} role="menu">
          {children(closeAndRestoreFocus)}
        </div>
      )}
    </div>
  )
}

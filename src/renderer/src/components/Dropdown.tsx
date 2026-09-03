import { useEffect, useRef, useState, type ReactNode } from 'react'

interface DropdownProps {
  trigger: (open: boolean, toggle: () => void) => ReactNode
  align?: 'left' | 'right'
  children: (close: () => void) => ReactNode
  className?: string
}

/** Minimal click-outside dropdown used for history, device, zoom and account menus. */
export function Dropdown({ trigger, align = 'left', children, className }: DropdownProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div ref={ref} className={`dropdown ${className ?? ''}`}>
      {trigger(open, () => setOpen((v) => !v))}
      {open && <div className={`menu ${align}`}>{children(() => setOpen(false))}</div>}
    </div>
  )
}

import { useEffect, useRef, useState } from 'react'
import { clampSimulatorColumnWidth } from '@shared/devices'
import { useT } from '@/store/app'

/**
 * Splitter between the simulator column and docked DevTools. Lives in the 1px flex gap and
 * overlaps only the simulator so the native DevTools overlay cannot steal pointer events.
 */
export function ColumnResizer({
  onPreview,
  onCommit,
  onCancel,
  onReset
}: {
  onPreview: (width: number) => void
  onCommit: (width: number) => void
  onCancel: () => void
  onReset: () => void
}) {
  const t = useT()
  const drag = useRef<{
    pointerId: number
    startX: number
    startW: number
    latest: number
  } | null>(null)
  const [active, setActive] = useState(false)

  const measureColumn = () =>
    document.querySelector('.simulatorColumn')?.getBoundingClientRect().width ?? 410
  const measurePanel = () =>
    document.querySelector('.idePanel')?.getBoundingClientRect().width ?? 1200
  const clamp = (width: number) => clampSimulatorColumnWidth(width, measurePanel())

  const finish = (commit: boolean) => {
    const current = drag.current
    drag.current = null
    setActive(false)
    document.body.classList.remove('col-resizing')
    if (!current) return
    if (commit) onCommit(current.latest)
    else onCancel()
  }

  useEffect(
    () => () => {
      document.body.classList.remove('col-resizing')
    },
    []
  )

  return (
    <button
      type="button"
      className={`resizer ${active ? 'active' : ''}`}
      title={t('toolbar.resizeColumn')}
      aria-label={t('toolbar.resizeColumn')}
      onPointerDown={(event) => {
        if (event.button !== 0) return
        event.preventDefault()
        event.currentTarget.setPointerCapture(event.pointerId)
        const startW = measureColumn()
        drag.current = {
          pointerId: event.pointerId,
          startX: event.clientX,
          startW,
          latest: startW
        }
        setActive(true)
        document.body.classList.add('col-resizing')
        onPreview(startW)
      }}
      onPointerMove={(event) => {
        const current = drag.current
        if (!current || current.pointerId !== event.pointerId) return
        const next = clamp(current.startW + event.clientX - current.startX)
        current.latest = next
        onPreview(next)
      }}
      onPointerUp={(event) => {
        if (drag.current?.pointerId !== event.pointerId) return
        if (event.currentTarget.hasPointerCapture(event.pointerId))
          event.currentTarget.releasePointerCapture(event.pointerId)
        finish(true)
      }}
      onPointerCancel={() => finish(false)}
      onDoubleClick={() => {
        drag.current = null
        setActive(false)
        document.body.classList.remove('col-resizing')
        onReset()
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault()
          const current = drag.current
          if (current && event.currentTarget.hasPointerCapture(current.pointerId))
            event.currentTarget.releasePointerCapture(current.pointerId)
          finish(false)
          return
        }
        if (event.key === 'Home') {
          event.preventDefault()
          onReset()
        }
      }}
    />
  )
}

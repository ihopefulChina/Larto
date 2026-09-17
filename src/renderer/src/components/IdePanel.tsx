import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { findDevice } from '@shared/devices'
import {
  autoSimulatorColumnWidth,
  clampSimulatorColumnWidth,
  DEVTOOLS_COLUMN_MIN_W,
  SIMULATOR_COLUMN_MIN_W
} from '@shared/ide-split'
import { invoke, on } from '@/lib/bridge'
import { useApp, useT } from '@/store/app'
import { DevToolsPane } from './DevToolsPane'
import { Simulator } from './Simulator'

export function IdePanel() {
  const t = useT()
  const showDevTools = useApp((s) => s.settings.showDevTools)
  const deviceId = useApp((s) => s.settings.deviceId)
  const zoom = useApp((s) => s.settings.zoom)
  const savedWidth = useApp((s) => s.settings.simulatorColumnWidth)
  const setSetting = useApp((s) => s.setSetting)

  const panelRef = useRef<HTMLDivElement>(null)
  const lastDeviceId = useRef(deviceId)

  const [panelWidth, setPanelWidth] = useState(0)
  const [draftWidth, setDraftWidth] = useState<number | null>(null)
  const [active, setActive] = useState(false)

  const device = findDevice(deviceId)
  const autoWidth = autoSimulatorColumnWidth(device, zoom)
  const desired = draftWidth ?? savedWidth ?? autoWidth
  const columnWidth = panelWidth > 0 ? clampSimulatorColumnWidth(desired, panelWidth) : desired

  useLayoutEffect(() => {
    const el = panelRef.current
    if (!el) return
    const report = () => {
      const r = el.getBoundingClientRect()
      if (r.width > 0) setPanelWidth(r.width)
      void invoke('split:setLayout', {
        enabled: showDevTools,
        panelLeft: r.left,
        panelWidth: r.width,
        panelTop: r.top,
        panelBottom: r.bottom,
        columnWidth
      })
    }
    report()
    const ro = new ResizeObserver(report)
    ro.observe(el)
    window.addEventListener('resize', report)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', report)
    }
  }, [showDevTools, columnWidth])

  useEffect(() => {
    return on('split:changed', ({ width, dragging }) => {
      setActive(dragging)
      document.body.classList.toggle('ide-resizing', dragging)
      if (dragging && width > 0) setDraftWidth(width)
      else if (!dragging) setDraftWidth(null)
    })
  }, [])

  useEffect(
    () => () => {
      document.body.classList.remove('ide-resizing')
    },
    []
  )

  useEffect(() => {
    if (lastDeviceId.current === deviceId) return
    lastDeviceId.current = deviceId
    if (useApp.getState().settings.simulatorColumnWidth !== null) {
      void setSetting('simulatorColumnWidth', null)
    }
    setDraftWidth(null)
  }, [deviceId, setSetting])

  return (
    <div className="idePanel" ref={panelRef}>
      <Simulator {...(showDevTools ? { columnWidth } : {})} />
      {showDevTools && (
        <>
          <div
            className={`resizer ${active ? 'active' : ''}`}
            role="separator"
            aria-orientation="vertical"
            aria-label={t('toolbar.splitResize')}
            aria-valuemin={SIMULATOR_COLUMN_MIN_W}
            aria-valuemax={Math.max(SIMULATOR_COLUMN_MIN_W, panelWidth - DEVTOOLS_COLUMN_MIN_W)}
            aria-valuenow={columnWidth}
            tabIndex={0}
            onPointerDown={(event) => {
              if (event.button !== 0 || event.buttons !== 1) return
              event.preventDefault()
              void invoke('split:pointer', { type: 'down' })
            }}
            onPointerUp={() => {
              void invoke('split:pointer', { type: 'up' })
            }}
            onKeyDown={(event) => {
              const step = event.altKey ? 1 : event.shiftKey ? 50 : 10
              let delta = 0
              if (event.key === 'ArrowLeft') delta = -step
              if (event.key === 'ArrowRight') delta = step
              if (!delta) return
              event.preventDefault()
              const panel = panelRef.current?.getBoundingClientRect().width ?? panelWidth
              const next = clampSimulatorColumnWidth(columnWidth + delta, panel)
              setDraftWidth(next)
              void setSetting('simulatorColumnWidth', next).then(() => {
                setDraftWidth((d) => (d === next ? null : d))
              })
            }}
          />
          <DevToolsPane />
        </>
      )}
    </div>
  )
}

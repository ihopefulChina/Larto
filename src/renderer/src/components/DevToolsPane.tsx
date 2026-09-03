import { useEffect, useRef } from 'react'
import type { Rect } from '@shared/ipc'
import { invoke } from '@/lib/bridge'
import { useApp } from '@/store/app'
import { useSimulator } from '@/store/simulator'

/**
 * Docked Chromium DevTools. This component only renders a placeholder; the main process
 * overlays a WebContentsView hosting the DevTools frontend at the placeholder's bounds
 * (see src/main/devtools-dock.ts for why a second <webview> cannot be used).
 * The overlay is hidden while an app modal is open so dialogs are never covered.
 */
export function DevToolsPane() {
  const ref = useRef<HTMLDivElement>(null)
  const guestId = useSimulator((s) => s.webContentsId)
  const modalOpen = useApp((s) => s.modal !== null)
  const openedFor = useRef<number | null>(null)

  useEffect(() => {
    const el = ref.current
    if (!el || guestId === null) return
    const bounds = (): Rect => {
      const r = el.getBoundingClientRect()
      return { x: r.left, y: r.top, width: r.width, height: r.height }
    }
    let alive = true
    // Main ignores bounds updates while no view exists, so reporting early is harmless; the
    // post-open report matters: the first layout pass may have observed a 0-width column.
    const report = () => {
      if (alive)
        void invoke('guest:setDevToolsBounds', {
          bounds: bounds(),
          visible: !useApp.getState().modal
        })
    }
    void invoke('guest:openDevTools', { guestWebContentsId: guestId, bounds: bounds() })
      .then(() => {
        if (!alive) return
        openedFor.current = guestId
        report()
      })
      .catch((err) => console.warn('openDevTools failed', err))
    const ro = new ResizeObserver(report)
    ro.observe(el)
    window.addEventListener('resize', report)
    return () => {
      alive = false
      ro.disconnect()
      window.removeEventListener('resize', report)
      openedFor.current = null
      void invoke('guest:closeDevTools').catch(() => undefined)
    }
  }, [guestId])

  useEffect(() => {
    const el = ref.current
    if (!el || openedFor.current === null) return
    const r = el.getBoundingClientRect()
    void invoke('guest:setDevToolsBounds', {
      bounds: { x: r.left, y: r.top, width: r.width, height: r.height },
      visible: !modalOpen
    })
  }, [modalOpen])

  return <div ref={ref} className="devtoolsColumn" />
}

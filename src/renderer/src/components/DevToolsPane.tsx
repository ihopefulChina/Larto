import { useEffect, useRef } from 'react'
import type { Rect } from '@shared/ipc'
import { invoke } from '@/lib/bridge'
import { useApp } from '@/store/app'
import { useSimulator } from '@/store/simulator'

/**
 * Docked Chromium DevTools. This component only renders a placeholder; the main process
 * overlays a WebContentsView hosting the DevTools frontend at the placeholder's bounds
 * (see src/main/devtools-dock.ts for why a second <webview> cannot be used).
 *
 * Native views always paint above the DOM, so whenever something in the shell must appear on
 * top of DevTools (app modals, the account/history dropdowns) the overlay is hidden. To keep
 * that invisible to the user, a screenshot of the panel is painted into the placeholder first.
 */
export function DevToolsPane() {
  const ref = useRef<HTMLDivElement>(null)
  const guestId = useSimulator((s) => s.webContentsId)
  const covered = useApp((s) => s.modal !== null || s.devtoolsCovers > 0)
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
      if (!alive) return
      const s = useApp.getState()
      void invoke('guest:setDevToolsBounds', {
        bounds: bounds(),
        visible: s.modal === null && s.devtoolsCovers === 0
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
    const rect = (): Rect => {
      const r = el.getBoundingClientRect()
      return { x: r.left, y: r.top, width: r.width, height: r.height }
    }
    let cancelled = false
    if (covered) {
      // Snapshot first, then hide: the placeholder shows the frozen panel underneath the popover.
      void invoke('guest:snapshotDevTools')
        .catch(() => null)
        .then((dataUrl) => {
          if (cancelled) return
          if (dataUrl) el.style.backgroundImage = `url(${dataUrl})`
          void invoke('guest:setDevToolsBounds', { bounds: rect(), visible: false })
        })
      return () => {
        cancelled = true
      }
    }
    void invoke('guest:setDevToolsBounds', { bounds: rect(), visible: true })
    // Leave the snapshot behind the (now visible) view for a moment: a re-shown view needs a
    // frame or two before it paints again.
    const timer = setTimeout(() => {
      el.style.backgroundImage = ''
    }, 400)
    return () => clearTimeout(timer)
  }, [covered])

  return <div ref={ref} className="devtoolsColumn" />
}

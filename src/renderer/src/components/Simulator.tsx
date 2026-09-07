import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { WebviewTag } from 'electron'
import { ENV_ENDPOINTS, GUEST_PARTITION } from '@shared/constants'
import {
  DEVICES,
  ZOOM_LEVELS,
  buildUserAgent,
  clampPcSize,
  deviceCornerRadius,
  deviceMenuGroup,
  findDevice,
  guestViewport
} from '@shared/devices'
import { attachJsapiHost } from '@/jsapi/host'
import { invoke } from '@/lib/bridge'
import { afterLayout } from '@/lib/layout'
import { useApp, useT } from '@/store/app'
import { simulatorActions, useSimulator } from '@/store/simulator'
import { Dropdown } from './Dropdown'
import { ChevronDown } from './icons'
import { JsapiOverlays } from './JsapiOverlays'
import { NavBar } from './NavBar'
import { StatusBar } from './StatusBar'
import { UrlBar } from './UrlBar'

/** Any truthy value works: main replaces it with the real guest preload in `will-attach-webview`. */
const PRELOAD_PLACEHOLDER = 'file:///larto-guest-preload.cjs'

export function Simulator({ focusSignal }: { focusSignal: number }) {
  const settings = useApp((s) => s.settings)
  const lang = useApp((s) => s.lang)
  const setSetting = useApp((s) => s.setSetting)
  const toast = useApp((s) => s.toast)
  const t = useT()
  const device = useMemo(() => findDevice(settings.deviceId), [settings.deviceId])
  const zoom = ZOOM_LEVELS.includes(settings.zoom) ? settings.zoom : 100
  const ua = useMemo(
    () => buildUserAgent(device, lang === 'zh-CN' ? 'zh_CN' : 'en_US'),
    [device, lang]
  )
  const webviewRef = useRef<WebviewTag>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const isPc = device.platform === 'pc'
  const pcFixed = isPc ? settings.pcViewport : null
  const [livePc, setLivePc] = useState({ width: device.width, height: device.height })
  // `fit` is distinct from no draft: it lets the frame lay out responsively before the persisted
  // fixed size is cleared, so we can apply the measured viewport before committing the setting.
  const [pcDraft, setPcDraft] = useState<{ width: number; height: number } | 'fit' | null>(null)
  // Fixed PC frames are normally centred. During a corner drag, hold the current left edge in
  // place so the bottom-right handle tracks the pointer 1:1 instead of moving only half as far.
  const [pcDragLeft, setPcDragLeft] = useState<number | null>(null)
  const pcPreviewQueue = useRef<{
    deviceId: string
    size: { width: number; height: number }
  } | null>(null)
  const pcPreviewRun = useRef<Promise<void> | null>(null)
  const pcResizeGeneration = useRef(0)
  const [attachFailed, setAttachFailed] = useState(false)
  const [attachRetry, setAttachRetry] = useState(0)
  const currentUrl = useSimulator((s) => s.url)
  const loading = useSimulator((s) => s.loading)

  // The `useragent` attribute is only read before the first navigation; later changes (language →
  // LarkLocale) have to go through setUserAgent and apply from the next load on.
  useEffect(() => {
    const wv = webviewRef.current
    if (!wv || useSimulator.getState().webContentsId === null) return
    try {
      if (wv.getUserAgent() !== ua) wv.setUserAgent(ua)
    } catch {
      /* not attached yet: the attribute still applies */
    }
  }, [ua])

  // Wire webview events once the element exists.
  useEffect(() => {
    const wv = webviewRef.current
    if (!wv) return
    const sim = useSimulator.getState()
    let attached = false
    let disposed = false
    let retries = 0
    setAttachFailed(false)
    // Hand the guest to main as soon as it exists (`did-attach`, before the first navigation
    // commits) so device emulation and console capture cover the very first page load too.
    // `dom-ready` stays as a fallback for Electron versions where `did-attach` fires early.
    const attachGuest = () => {
      if (attached) return
      let id: number
      try {
        id = wv.getWebContentsId()
      } catch {
        // `did-attach` is dispatched by main as a plain message and can reach the element before
        // the reply to its own create-and-attach call, i.e. before it knows its guest id. Retry
        // on the next turn; `dom-ready` (hundreds of ms later) stays the last-resort fallback.
        if (retries++ < 50) setTimeout(attachGuest, 10)
        return
      }
      attached = true
      // Keep the real page behind an about:blank barrier until main confirms every CDP
      // emulation command. This prevents zero-delay pages from observing desktop/touch defaults.
      void (async () => {
        await invoke('guest:attach', id)
        let launchSettings = useApp.getState().settings
        let configured = false
        for (let attempt = 0; attempt < 10 && !disposed; attempt++) {
          const before = useApp.getState().settings
          const beforeKey = JSON.stringify([before.deviceId, before.pcViewport, before.language])
          // Wait for the matching React layout and user-agent effect. If the user chooses another
          // device while the guest is attaching, loop and configure only the newest stable state.
          await afterLayout()
          const currentSettings = useApp.getState().settings
          const currentKey = JSON.stringify([
            currentSettings.deviceId,
            currentSettings.pcViewport,
            currentSettings.language
          ])
          if (currentKey !== beforeKey) continue
          const current = findDevice(currentSettings.deviceId)
          wv.setUserAgent(
            buildUserAgent(current, useApp.getState().lang === 'zh-CN' ? 'zh_CN' : 'en_US')
          )
          let initialViewport =
            current.platform === 'pc' && currentSettings.pcViewport
              ? currentSettings.pcViewport
              : guestViewport(current)
          if (current.platform === 'pc' && !currentSettings.pcViewport) {
            // Adaptive PC fills its rendered box, which is often much smaller than the preset's
            // nominal 900×866. Measure it before allowing the real page's first script to run.
            const rect = boxRef.current?.getBoundingClientRect()
            if (rect && rect.width >= 50 && rect.height >= 50) {
              initialViewport = { width: Math.round(rect.width), height: Math.round(rect.height) }
            }
          }
          await invoke('guest:setDevice', {
            webContentsId: id,
            deviceId: current.id,
            viewport: initialViewport
          })
          launchSettings = useApp.getState().settings
          const launchKey = JSON.stringify([
            launchSettings.deviceId,
            launchSettings.pcViewport,
            launchSettings.language
          ])
          if (launchKey !== currentKey) continue
          configured = true
          break
        }
        if (!configured) throw new Error('device settings did not settle while attaching guest')
        if (disposed) return
        sim.setWebview(wv, id)
        // A navigate that arrived while the element had no guest yet (MCP clients fire as soon as
        // the shell starts) wins over the persisted startup URL. Do not report MCP health ready
        // until this navigation has committed or failed, otherwise an immediate set_device reload
        // can cancel it and strand the guest on about:blank.
        const launchUrl =
          simulatorActions.takePendingUrl() ||
          launchSettings.lastUrl ||
          ENV_ENDPOINTS[launchSettings.env].defaultPage
        try {
          await simulatorActions.loadUrlAndWait(launchUrl)
        } catch (err) {
          // A network failure has completed the navigation attempt and leaves Chromium's error
          // document usable; it is not a device-emulation attach failure.
          console.warn('initial guest navigation failed', err)
        }
        if (disposed) return
        await invoke('guest:ready', id)
        setAttachFailed(false)
      })().catch((err) => {
        console.warn('guest attach failed', err)
        if (disposed) return
        attached = false
        if (retries++ < 50) setTimeout(attachGuest, 20)
        else {
          sim.setWebview(null, null)
          void wv.loadURL('about:blank').catch(() => undefined)
          setAttachFailed(true)
        }
      })
    }
    const onDomReady = attachGuest
    const onStart = () => sim.patch({ loading: true })
    const onStop = () => sim.patch({ loading: false, canGoBack: wv.canGoBack() })
    const onNavigate = (e: Electron.DidNavigateEvent) => {
      // A new document: nav bar, dialogs, toast, preloader and "closed" state belong to the old
      // one (link clicks and redirects do not go through simulatorActions.loadUrl).
      sim.resetPage()
      sim.patch({ url: e.url, canGoBack: wv.canGoBack() })
    }
    const onNavigateInPage = (e: Electron.DidNavigateInPageEvent) => sim.patch({ url: e.url })
    const onTitle = (e: Electron.PageTitleUpdatedEvent) => sim.patch({ title: e.title })
    const onFail = (e: Electron.DidFailLoadEvent) => {
      if (e.isMainFrame && e.errorCode !== -3)
        console.warn(`[guest] load failed ${e.errorCode} ${e.errorDescription} ${e.validatedURL}`)
    }
    wv.addEventListener('did-attach', attachGuest)
    wv.addEventListener('dom-ready', onDomReady)
    wv.addEventListener('did-start-loading', onStart)
    wv.addEventListener('did-stop-loading', onStop)
    wv.addEventListener('did-navigate', onNavigate)
    wv.addEventListener('did-navigate-in-page', onNavigateInPage)
    wv.addEventListener('page-title-updated', onTitle)
    wv.addEventListener('did-fail-load', onFail)
    const detachJsapi = attachJsapiHost(wv)
    // about:blank can attach and finish before React's passive effect installs the listeners.
    // Probe immediately as well; getWebContentsId's bounded retry covers the pre-attach window.
    attachGuest()
    return () => {
      disposed = true
      attached = true // stop pending retries
      detachJsapi()
      wv.removeEventListener('did-attach', attachGuest)
      wv.removeEventListener('dom-ready', onDomReady)
      wv.removeEventListener('did-start-loading', onStart)
      wv.removeEventListener('did-stop-loading', onStop)
      wv.removeEventListener('did-navigate', onNavigate)
      wv.removeEventListener('did-navigate-in-page', onNavigateInPage)
      wv.removeEventListener('page-title-updated', onTitle)
      wv.removeEventListener('did-fail-load', onFail)
      sim.setWebview(null, null)
    }
  }, [attachRetry])

  /**
   * Background emulation updates are single-flight with a latest-value queue. A raw
   * ResizeObserver (and especially pointermove) can otherwise start several CDP rounds whose
   * promises complete out of order, leaving the guest at an older size.
   */
  const drainPcPreviews = useCallback((): Promise<void> => {
    if (pcPreviewRun.current) return pcPreviewRun.current
    const run = (async () => {
      while (pcPreviewQueue.current) {
        const next = pcPreviewQueue.current
        pcPreviewQueue.current = null
        const latest = useApp.getState().settings
        const id = useSimulator.getState().webContentsId
        if (id === null || latest.deviceId !== next.deviceId) continue
        await invoke('guest:setDevice', {
          webContentsId: id,
          deviceId: next.deviceId,
          viewport: next.size,
          background: true
        })
      }
    })()
      .catch((err) => console.warn('PC resize preview failed', err))
      .finally(() => {
        pcPreviewRun.current = null
        // A pointer event may have queued one last value while the previous run was settling.
        if (pcPreviewQueue.current) void drainPcPreviews()
      })
    pcPreviewRun.current = run
    return run
  }, [])

  const queuePcEmulation = useCallback(
    (size: { width: number; height: number }) => {
      if (findDevice(useApp.getState().settings.deviceId).platform !== 'pc') return
      pcPreviewQueue.current = { deviceId: device.id, size }
      void drainPcPreviews()
    },
    [device.id, drainPcPreviews]
  )

  const previewPcViewport = useCallback(
    (size: { width: number; height: number }) => {
      setPcDraft(size)
      queuePcEmulation(size)
    },
    [queuePcEmulation]
  )

  const commitPcViewport = useCallback(
    async (next: { width: number; height: number } | null) => {
      const generation = ++pcResizeGeneration.current
      const previous = useApp.getState().settings.pcViewport
      pcPreviewQueue.current = null
      const running = pcPreviewRun.current
      if (running) await running
      if (generation !== pcResizeGeneration.current) return

      let viewport = next
      setPcDraft(next ?? 'fit')
      if (!viewport) {
        // Return to the responsive PC frame first, then measure the actual laid-out viewport.
        await afterLayout()
        const rect = boxRef.current?.getBoundingClientRect()
        viewport = rect
          ? {
              width: clampPcSize(rect.width, device.width),
              height: clampPcSize(rect.height, device.height)
            }
          : { width: device.width, height: device.height }
      }

      try {
        const id = useSimulator.getState().webContentsId
        if (id !== null) {
          await invoke('guest:setDevice', {
            webContentsId: id,
            deviceId: device.id,
            viewport
          })
        }
        if (generation !== pcResizeGeneration.current) return
        await setSetting('pcViewport', next)
        setPcDraft(null)
      } catch (err) {
        if (generation !== pcResizeGeneration.current) return
        setPcDraft(null)
        const id = useSimulator.getState().webContentsId
        if (id !== null && previous) {
          void invoke('guest:setDevice', {
            webContentsId: id,
            deviceId: device.id,
            viewport: previous
          }).catch(() => undefined)
        }
        useApp.getState().showToast(t('toolbar.deviceFailed'))
        console.warn('PC viewport emulation failed', err)
      }
    },
    [device.height, device.id, device.width, drainPcPreviews, setSetting, t]
  )

  const cancelPcResize = useCallback(() => {
    ++pcResizeGeneration.current
    pcPreviewQueue.current = null
    setPcDraft(null)
    const previous = useApp.getState().settings.pcViewport
    const id = useSimulator.getState().webContentsId
    if (id !== null && previous) {
      void Promise.resolve(pcPreviewRun.current)
        .then(() =>
          invoke('guest:setDevice', {
            webContentsId: id,
            deviceId: device.id,
            viewport: previous
          })
        )
        .catch((err) => console.warn('could not restore PC size after cancelling resize', err))
    }
  }, [device.id])

  useEffect(() => {
    // Device switches interrupt a pointer session; late background work is ignored by main's
    // device guard and must not keep a stale draft visible in the next preset.
    ++pcResizeGeneration.current
    pcPreviewQueue.current = null
    setPcDraft(null)
    setPcDragLeft(null)
  }, [device.id])

  // Official PC gadget is `calc(100% - 40px)`: fill the column and let CDP use the element size.
  // A stored `pcViewport` pins a CSS size; pointer dragging previews locally and persists once.
  useEffect(() => {
    if (!isPc || pcFixed || pcDraft) return
    const el = boxRef.current
    if (!el) return
    const report = () => {
      const latest = useApp.getState().settings
      // A ResizeObserver callback already queued for the PC layout can run after a device switch.
      // Do not let that stale callback overwrite the newly selected device's CDP metrics.
      if (latest.deviceId !== device.id || latest.pcViewport) return
      const id = useSimulator.getState().webContentsId
      if (id === null) return
      const r = el.getBoundingClientRect()
      const width = Math.round(r.width)
      const height = Math.round(r.height)
      if (width < 50 || height < 50) return
      setLivePc({ width, height })
      queuePcEmulation({ width, height })
    }
    const ro = new ResizeObserver(report)
    ro.observe(el)
    report()
    return () => ro.disconnect()
  }, [isPc, pcFixed, pcDraft, device.id, queuePcEmulation])

  // PC resize is a direct 1 CSS px → 1 viewport px manipulation. Mobile zoom must not leak into
  // it when the user switches from a scaled phone preset.
  const scale = isPc ? 1 : zoom / 100
  const shownPc = isPc ? (pcDraft === 'fit' ? null : (pcDraft ?? pcFixed)) : null
  const displayedPc = pcDraft && pcDraft !== 'fit' ? pcDraft : (pcFixed ?? livePc)
  // The frame keeps its CSS-pixel size and is scaled visually; the box around it takes the
  // scaled size so centring and scrolling work on the visible footprint.
  const boxStyle = isPc
    ? shownPc
      ? {
          width: shownPc.width,
          height: shownPc.height,
          ...(pcDragLeft === null ? {} : { marginLeft: pcDragLeft, marginRight: 'auto' })
        }
      : undefined
    : { width: device.width * scale, height: device.height * scale }
  const radius = deviceCornerRadius(device)
  const frameStyle = isPc
    ? { borderRadius: radius }
    : {
        width: device.width,
        height: device.height,
        transform: `scale(${scale})`,
        borderRadius: radius
      }

  return (
    <div
      className="simulatorColumn"
      style={{
        width:
          isPc || !settings.showDevTools ? undefined : Math.max(410, device.width * scale + 32),
        flex: isPc || !settings.showDevTools ? 1 : undefined
      }}
    >
      <div className="simulatorHeader">
        <UrlBar focusSignal={focusSignal} />
      </div>
      <div className="simulatorContent">
        <div
          ref={boxRef}
          className={`gadgetBox ${isPc ? `pc ${shownPc ? 'fixed' : 'fit'}` : ''}`}
          style={boxStyle}
        >
          <div className={`gadget ${isPc ? 'pc' : ''}`} style={frameStyle}>
            {!isPc && <StatusBar device={device} />}
            {!isPc && <NavBar />}
            <div className="webviewContainer">
              <webview
                ref={webviewRef}
                src="about:blank"
                partition={GUEST_PARTITION}
                preload={PRELOAD_PLACEHOLDER}
                useragent={ua}
                allowpopups
              />
              {attachFailed && (
                <div className="guestAttachError" role="alert">
                  <strong>{t('simulator.attachFailed')}</strong>
                  <span>{t('simulator.attachFailedHint')}</span>
                  <button
                    type="button"
                    onClick={() => {
                      setAttachFailed(false)
                      setAttachRetry((value) => value + 1)
                    }}
                  >
                    {t('simulator.retry')}
                  </button>
                </div>
              )}
              <JsapiOverlays />
            </div>
            {device.homeIndicator && (
              <div className="homeIndicator">
                <span />
              </div>
            )}
          </div>
          {isPc && (
            <PcResizeHandle
              size={displayedPc}
              onPreview={previewPcViewport}
              onCommit={(size) => void commitPcViewport(size)}
              onCancel={cancelPcResize}
              onActiveChange={(active) => {
                setPcDragLeft(active ? (boxRef.current?.offsetLeft ?? 0) : null)
              }}
            />
          )}
        </div>
      </div>
      <div className="simulatorToolBox">
        <Dropdown
          className="wide"
          placement="top"
          trigger={(open, toggle) => (
            <button
              type="button"
              className="tbtn"
              onClick={toggle}
              aria-haspopup="menu"
              aria-expanded={open}
              aria-label={`${t('menu.device')}: ${device.name}`}
            >
              {device.name} <ChevronDown aria-hidden className="chevron" />
            </button>
          )}
        >
          {(close) =>
            DEVICES.flatMap((d, i) => {
              const prev = i > 0 ? DEVICES[i - 1] : undefined
              const sep =
                prev && deviceMenuGroup(prev) !== deviceMenuGroup(d) ? (
                  <div key={`sep-${d.id}`} className="menu-sep" role="separator" />
                ) : null
              const item = (
                <button
                  key={d.id}
                  type="button"
                  role="menuitemradio"
                  className={`menu-item ${d.id === device.id ? 'checked' : ''}`}
                  aria-checked={d.id === device.id}
                  onClick={() => {
                    close()
                    void simulatorActions.changeDevice(d.id)
                  }}
                >
                  {d.name}
                  <span className="dim">
                    {d.width}×{d.height}
                  </span>
                </button>
              )
              return sep ? [sep, item] : [item]
            })
          }
        </Dropdown>
        <span className="sep" />
        {isPc ? (
          <span className="fitMode">{shownPc ? '1:1' : t('toolbar.pcFit')}</span>
        ) : (
          <Dropdown
            placement="top"
            trigger={(open, toggle) => (
              <button
                type="button"
                className="tbtn"
                onClick={toggle}
                aria-haspopup="menu"
                aria-expanded={open}
                aria-label={`${t('menu.zoom')}: ${zoom}%`}
              >
                {zoom}% <ChevronDown aria-hidden className="chevron" />
              </button>
            )}
          >
            {(close) =>
              ZOOM_LEVELS.map((z) => (
                <button
                  key={z}
                  type="button"
                  role="menuitemradio"
                  className={`menu-item ${z === zoom ? 'checked' : ''}`}
                  aria-checked={z === zoom}
                  onClick={() => {
                    close()
                    void setSetting('zoom', z)
                  }}
                >
                  {z}%
                </button>
              ))
            }
          </Dropdown>
        )}
        {isPc && (
          <PcSizeFields
            fallback={displayedPc}
            fixed={!!pcFixed}
            onCommit={(size) => void commitPcViewport(size)}
            onFit={() => void commitPcViewport(null)}
          />
        )}
      </div>
      <div className="simulatorStatus">
        <span className="simulatorStatus-label">{t('toolbar.pagePath')}</span>
        <span className="simulatorStatus-path" title={currentUrl}>
          {formatPagePath(currentUrl)}
        </span>
        <span className={`simulatorStatus-state ${loading ? 'loading' : ''}`}>
          <span aria-hidden />
          {loading ? t('toolbar.loading') : t('toolbar.ready')}
        </span>
      </div>
      {/* Lives in the simulator column: the DevTools native view would cover a window-centred toast. */}
      {toast && (
        <div className="appToast" role="status" aria-live="polite">
          {toast}
        </div>
      )}
    </div>
  )
}

function formatPagePath(raw: string): string {
  if (!raw || raw === 'about:blank') return '—'
  try {
    const url = new URL(raw)
    return `${url.pathname || '/'}${url.search}${url.hash}`
  } catch {
    return raw
  }
}

interface PcViewport {
  width: number
  height: number
}

function PcResizeHandle({
  size,
  onPreview,
  onCommit,
  onCancel,
  onActiveChange
}: {
  size: PcViewport
  onPreview: (size: PcViewport) => void
  onCommit: (size: PcViewport) => void
  onCancel: () => void
  onActiveChange: (active: boolean) => void
}) {
  const t = useT()
  const drag = useRef<{
    pointerId: number
    x: number
    y: number
    start: PcViewport
    latest: PcViewport
  } | null>(null)
  const [active, setActive] = useState(false)

  const moved = (width: number, height: number): PcViewport => ({
    width: clampPcSize(width, size.width),
    height: clampPcSize(height, size.height)
  })
  const finish = (commit: boolean) => {
    const current = drag.current
    drag.current = null
    setActive(false)
    onActiveChange(false)
    document.body.classList.remove('pc-resizing')
    if (!current) return
    if (commit) onCommit(current.latest)
    else onCancel()
  }

  useEffect(
    () => () => {
      document.body.classList.remove('pc-resizing')
    },
    []
  )

  return (
    <button
      type="button"
      className={`pcResizeHandle ${active ? 'active' : ''}`}
      title={t('toolbar.pcResize')}
      aria-label={`${t('toolbar.pcResize')}: ${size.width} × ${size.height}`}
      onPointerDown={(event) => {
        if (event.button !== 0) return
        event.preventDefault()
        event.currentTarget.setPointerCapture(event.pointerId)
        drag.current = {
          pointerId: event.pointerId,
          x: event.clientX,
          y: event.clientY,
          start: size,
          latest: size
        }
        setActive(true)
        onActiveChange(true)
        document.body.classList.add('pc-resizing')
      }}
      onPointerMove={(event) => {
        const current = drag.current
        if (!current || current.pointerId !== event.pointerId) return
        const next = moved(
          current.start.width + event.clientX - current.x,
          current.start.height + event.clientY - current.y
        )
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
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault()
          const current = drag.current
          if (current && event.currentTarget.hasPointerCapture(current.pointerId))
            event.currentTarget.releasePointerCapture(current.pointerId)
          if (current) finish(false)
          else onCancel()
          return
        }
        const step = event.altKey ? 1 : event.shiftKey ? 50 : 10
        let next: PcViewport | null = null
        if (event.key === 'ArrowLeft') next = moved(size.width - step, size.height)
        if (event.key === 'ArrowRight') next = moved(size.width + step, size.height)
        if (event.key === 'ArrowUp') next = moved(size.width, size.height - step)
        if (event.key === 'ArrowDown') next = moved(size.width, size.height + step)
        if (!next) return
        event.preventDefault()
        onCommit(next)
      }}
    >
      <span aria-hidden />
      {active && (
        <output className="pcResizeValue" aria-live="polite">
          {size.width} × {size.height}
        </output>
      )}
    </button>
  )
}

function PcSizeFields({
  fallback,
  fixed,
  onCommit,
  onFit
}: {
  fallback: PcViewport
  fixed: boolean
  onCommit: (size: PcViewport) => void
  onFit: () => void
}) {
  const t = useT()
  const device = findDevice(useApp((s) => s.settings.deviceId))
  const shown = fallback
  const [w, setW] = useState(String(shown.width))
  const [h, setH] = useState(String(shown.height))

  useEffect(() => {
    setW(String(shown.width))
    setH(String(shown.height))
  }, [shown.width, shown.height])

  const commit = (nextW: string, nextH: string) => {
    const width = clampPcSize(Number(nextW), device.width)
    const height = clampPcSize(Number(nextH), device.height)
    setW(String(width))
    setH(String(height))
    onCommit({ width, height })
  }

  return (
    <>
      <span className="sep" />
      <div className="pcSize">
        <input
          type="number"
          inputMode="numeric"
          min={320}
          max={2560}
          aria-label={t('toolbar.pcWidth')}
          value={w}
          onChange={(e) => setW(e.target.value)}
          onBlur={() => commit(w, h)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
          }}
        />
        <span>×</span>
        <input
          type="number"
          inputMode="numeric"
          min={320}
          max={2560}
          aria-label={t('toolbar.pcHeight')}
          value={h}
          onChange={(e) => setH(e.target.value)}
          onBlur={() => commit(w, h)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
          }}
        />
      </div>
      {fixed && (
        <button type="button" className="tbtn" onClick={onFit}>
          {t('toolbar.pcFit')}
        </button>
      )}
    </>
  )
}

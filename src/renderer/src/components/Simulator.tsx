import { useEffect, useMemo, useRef } from 'react'
import type { WebviewTag } from 'electron'
import { ENV_ENDPOINTS, GUEST_PARTITION } from '@shared/constants'
import { DEVICES, ZOOM_LEVELS, buildUserAgent, findDevice, guestViewport } from '@shared/devices'
import { attachJsapiHost } from '@/jsapi/host'
import { invoke } from '@/lib/bridge'
import { useApp } from '@/store/app'
import { simulatorActions, useSimulator } from '@/store/simulator'
import { Dropdown } from './Dropdown'
import { ChevronDown } from './icons'
import { JsapiOverlays } from './JsapiOverlays'
import { NavBar } from './NavBar'
import { StatusBar } from './StatusBar'

/** Any truthy value works: main replaces it with the real guest preload in `will-attach-webview`. */
const PRELOAD_PLACEHOLDER = 'file:///fdt-guest-preload.cjs'

export function Simulator() {
  const settings = useApp((s) => s.settings)
  const lang = useApp((s) => s.lang)
  const setSetting = useApp((s) => s.setSetting)
  const device = useMemo(() => findDevice(settings.deviceId), [settings.deviceId])
  const zoom = ZOOM_LEVELS.includes(settings.zoom) ? settings.zoom : 100
  const ua = useMemo(
    () => buildUserAgent(device, lang === 'zh-CN' ? 'zh_CN' : 'en_US'),
    [device, lang]
  )
  const webviewRef = useRef<WebviewTag>(null)
  const initialSrc = useRef(settings.lastUrl || ENV_ENDPOINTS[settings.env].defaultPage)
  const isPc = device.platform === 'pc'

  // Wire webview events once the element exists.
  useEffect(() => {
    const wv = webviewRef.current
    if (!wv) return
    const sim = useSimulator.getState()
    let attached = false
    const onDomReady = () => {
      if (attached) return
      attached = true
      const id = wv.getWebContentsId()
      sim.setWebview(wv, id)
      void invoke('guest:attach', id)
      const current = findDevice(useApp.getState().settings.deviceId)
      void invoke('guest:setDevice', {
        webContentsId: id,
        deviceId: current.id,
        viewport: guestViewport(current)
      })
    }
    const onStart = () => sim.patch({ loading: true })
    const onStop = () => sim.patch({ loading: false, canGoBack: wv.canGoBack() })
    const onNavigate = (e: Electron.DidNavigateEvent) => {
      sim.patch({ url: e.url, canGoBack: wv.canGoBack() })
      sim.setNavBar({ title: '', left: null, right: null, menu: null })
    }
    const onNavigateInPage = (e: Electron.DidNavigateInPageEvent) => sim.patch({ url: e.url })
    const onTitle = (e: Electron.PageTitleUpdatedEvent) => sim.patch({ title: e.title })
    const onFail = (e: Electron.DidFailLoadEvent) => {
      if (e.isMainFrame && e.errorCode !== -3)
        console.warn(`[guest] load failed ${e.errorCode} ${e.errorDescription} ${e.validatedURL}`)
    }
    wv.addEventListener('dom-ready', onDomReady)
    wv.addEventListener('did-start-loading', onStart)
    wv.addEventListener('did-stop-loading', onStop)
    wv.addEventListener('did-navigate', onNavigate)
    wv.addEventListener('did-navigate-in-page', onNavigateInPage)
    wv.addEventListener('page-title-updated', onTitle)
    wv.addEventListener('did-fail-load', onFail)
    const detachJsapi = attachJsapiHost(wv)
    return () => {
      detachJsapi()
      wv.removeEventListener('dom-ready', onDomReady)
      wv.removeEventListener('did-start-loading', onStart)
      wv.removeEventListener('did-stop-loading', onStop)
      wv.removeEventListener('did-navigate', onNavigate)
      wv.removeEventListener('did-navigate-in-page', onNavigateInPage)
      wv.removeEventListener('page-title-updated', onTitle)
      wv.removeEventListener('did-fail-load', onFail)
      sim.setWebview(null, null)
    }
  }, [])

  const scale = zoom / 100
  const frameStyle = isPc
    ? undefined
    : {
        width: device.width,
        height: device.height,
        transform: `scale(${scale})`,
        marginBottom: (scale - 1) * device.height
      }

  return (
    <div
      className="simulatorColumn"
      style={{
        width: isPc ? undefined : Math.max(442, device.width * scale + 64),
        flex: isPc ? 1 : undefined
      }}
    >
      <div className="simulatorToolBox">
        <Dropdown
          trigger={(_o, toggle) => (
            <button className="tbtn" onClick={toggle}>
              {device.name} <ChevronDown />
            </button>
          )}
        >
          {(close) =>
            DEVICES.map((d) => (
              <button
                key={d.id}
                className={`menu-item ${d.id === device.id ? 'checked' : ''}`}
                onClick={() => {
                  close()
                  void simulatorActions.changeDevice(d.id)
                }}
              >
                {d.name}
                <span style={{ marginLeft: 'auto', color: 'var(--fg-tertiary)' }}>
                  {d.width}×{d.height}
                </span>
              </button>
            ))
          }
        </Dropdown>
        <span className="sep" />
        <Dropdown
          trigger={(_o, toggle) => (
            <button className="tbtn" onClick={toggle}>
              {zoom}% <ChevronDown />
            </button>
          )}
        >
          {(close) =>
            ZOOM_LEVELS.map((z) => (
              <button
                key={z}
                className={`menu-item ${z === zoom ? 'checked' : ''}`}
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
      </div>
      <div className="simulatorContent">
        <div className={`gadget ${isPc ? 'pc' : ''}`} style={frameStyle}>
          {!isPc && <StatusBar device={device} />}
          {!isPc && <NavBar />}
          <div className="webviewContainer">
            <webview
              ref={webviewRef}
              src={initialSrc.current}
              partition={GUEST_PARTITION}
              preload={PRELOAD_PLACEHOLDER}
              useragent={ua}
              allowpopups
            />
            <JsapiOverlays />
          </div>
          {device.homeIndicator && (
            <div className="homeIndicator">
              <span />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

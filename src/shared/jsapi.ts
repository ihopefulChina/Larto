/**
 * JSAPI bridge protocol between the guest preload (injected into the H5
 * <webview>), the shell renderer (simulator UI) and the main process
 * (network/system capabilities). See docs/RESEARCH_OFFICIAL_TOOL.md §5.
 *
 *   H5 page (official JSSDK)
 *     └─ window.WebViewJavascriptBridge / __LarkPCSDK__ / LkWebViewJavascriptBridge   (main world, installed by preload)
 *          └─ preload (isolated world)  ── ipcRenderer.sendToHost(JSAPI_CHANNEL, GuestToHost) ──▶ shell renderer
 *                                        ◀── webview.send(JSAPI_CHANNEL, HostToGuest) ───────────┘
 *                                                                shell renderer ── ipc 'jsapi:backend' ──▶ main
 */
export const JSAPI_CHANNEL = 'fdt:jsapi'

/** How an invocation reached the preload; determines the callback style. */
export type BridgeFlavor = 'ios' | 'pc' | 'android'

export interface JsapiInvoke {
  kind: 'invoke'
  id: number
  method: string
  params: Record<string, unknown>
  /** location.href of the calling page at invocation time (without hash for `config`). */
  url: string
}

/** Emitted whenever document.title changes in the guest page (mirrors official preload). */
export interface JsapiTitleChanged {
  kind: 'title'
  title: string
}

/** Preload finished installing the bridge into the main world. */
export interface JsapiBridgeReady {
  kind: 'ready'
  flavor: BridgeFlavor
}

export type GuestToHost = JsapiInvoke | JsapiTitleChanged | JsapiBridgeReady

export interface JsapiResult {
  kind: 'result'
  id: number
  /** Payload merged into the callback object; `errMsg` is added by the preload. */
  data: Record<string, unknown>
  ok: boolean
}

/** Continued callback for subscriptions (geolocation updates, navigation button clicks…). */
export interface JsapiPush {
  kind: 'push'
  id: number
  data: Record<string, unknown>
}

/** Host → guest events not tied to an invocation (e.g. left/right nav bar taps). */
export interface JsapiHostEvent {
  kind: 'event'
  name: 'onLeftNavigationBarClick' | 'onRightNavigationBarClick' | 'onMenuItemClick'
  data: Record<string, unknown>
}

export type HostToGuest = JsapiResult | JsapiPush | JsapiHostEvent

export function okMsg(method: string): string {
  return `${method}:ok`
}
export function failMsg(method: string): string {
  return `${method}:fail`
}

/** Standard failure payload. */
export function jsapiFail(
  method: string,
  errorCode: number,
  errorMessage: string
): Record<string, unknown> {
  return {
    errMsg: failMsg(method),
    errorCode,
    errorMessage,
    errCode: errorCode,
    errString: errorMessage
  }
}

export const JSAPI_ERROR = {
  /** Returned by `config` when there is no Feishu session. */
  NOT_LOGGED_IN: 99991691,
  NETWORK: 1014,
  INVALID_PARAM: 104,
  NOT_SUPPORTED: 1001,
  USER_CANCEL: 1002
} as const

/**
 * Where a JSAPI is handled.
 *  - `main`:  needs network/system access (verify signature, auth code, clipboard, geolocation…)
 *  - `shell`: rendered by the simulator UI (dialogs, toasts, navigation bar, image preview)
 *  - `mock`:  fixed response inside the preload (device sensors etc.), matching the official tool
 */
export type JsapiHandlerKind = 'main' | 'shell' | 'mock'

export const JSAPI_MAIN_METHODS = new Set<string>([
  'config',
  'requestAuthCode',
  'requestAccess',
  'biz.util.copyText',
  'setClipboardData',
  'biz.util.getClipboardInfo',
  'getClipboardData',
  'device.connection.getGatewayIP',
  'device.geolocation.get',
  'device.geolocation.start',
  'device.geolocation.stop',
  'getLocation',
  'biz.util.getAppLanguage'
])

export const JSAPI_SHELL_METHODS = new Set<string>([
  'device.notification.alert',
  'device.notification.confirm',
  'device.notification.prompt',
  'device.notification.toast',
  'device.notification.showPreloader',
  'device.notification.hidePreloader',
  'showModal',
  'showToast',
  'hideToast',
  'showActionSheet',
  'showPrompt',
  'biz.navigation.setTitle',
  'biz.navigation.setLeft',
  'biz.navigation.setRight',
  'biz.navigation.setMenu',
  'biz.navigation.close',
  'biz.navigation.goBack',
  'setNavigationBar',
  'biz.util.openLink',
  'previewImage'
])

export function classifyJsapi(method: string): JsapiHandlerKind {
  if (JSAPI_MAIN_METHODS.has(method)) return 'main'
  if (JSAPI_SHELL_METHODS.has(method)) return 'shell'
  return 'mock'
}

/** Payload of `config`, as sent by the JSSDK (`tt.config` / `h5sdk.config`). */
export interface JsapiConfigParams {
  appId: string
  timestamp: number | string
  nonceStr: string
  signature: string
  jsApiList: string[]
}

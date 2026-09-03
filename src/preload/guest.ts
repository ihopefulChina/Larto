/**
 * Guest preload: installs the Feishu JSAPI host bridge into the H5 page so the official
 * JSSDK (h5sdk / tt.*) believes it runs inside a Feishu container. Runs sandboxed with
 * context isolation; page-visible objects are installed with contextBridge.
 *
 * Protocol and rationale: src/shared/jsapi.ts, docs/RESEARCH_OFFICIAL_TOOL.md §5.
 */
import { contextBridge, ipcRenderer } from 'electron'
import { JSAPI_CHANNEL, type BridgeFlavor, type GuestToHost, type HostToGuest } from '@shared/jsapi'

type Callback = (result: Record<string, unknown>) => void

interface Pending {
  method: string
  onSuccess?: Callback | undefined
  onFail?: Callback | undefined
  /** Page-global function names (iOS flavour) resolved in the main world. */
  successName?: string | undefined
  failName?: string | undefined
  /** `tt.*` style callback id routed through window.ttJSBridge. */
  callbackId?: string | number | undefined
}

const pending = new Map<number, Pending>()
let seq = 0

function send(msg: GuestToHost): void {
  ipcRenderer.sendToHost(JSAPI_CHANNEL, msg)
}

/** Runs a small function in the page's main world (needed for name-based callbacks / ttJSBridge). */
function inMainWorld(func: (...args: never[]) => unknown, args: unknown[]): void {
  try {
    contextBridge.executeInMainWorld({ func: func as (...a: unknown[]) => unknown, args })
  } catch (err) {
    console.warn('[FeishuDevTools] main world call failed', err)
  }
}

function callNamed(name: string, result: Record<string, unknown>): void {
  inMainWorld(
    ((n: string, r: Record<string, unknown>) => {
      const fn = (window as unknown as Record<string, unknown>)[n]
      if (typeof fn === 'function') (fn as Callback)(r)
    }) as never,
    [name, result]
  )
}

function callTt(
  kind: 'invokeHandler' | 'subscribeHandler',
  callbackId: string | number,
  result: Record<string, unknown>
): void {
  inMainWorld(
    ((k: string, id: string | number, r: Record<string, unknown>) => {
      const bridge = (window as unknown as { ttJSBridge?: Record<string, unknown> }).ttJSBridge
      const fn = bridge?.[k]
      if (typeof fn === 'function')
        (fn as (id: string | number, r: unknown) => void).call(bridge, id, r)
    }) as never,
    [kind, callbackId, result]
  )
}

function isOk(result: Record<string, unknown>): boolean {
  const errMsg = typeof result['errMsg'] === 'string' ? result['errMsg'] : ''
  return errMsg.split(':').pop() === 'ok'
}

function deliver(p: Pending, result: Record<string, unknown>, ok: boolean): void {
  if (p.callbackId !== undefined) {
    callTt('invokeHandler', p.callbackId, result)
    return
  }
  if (ok) {
    if (p.onSuccess) p.onSuccess(result)
    else if (p.successName) callNamed(p.successName, result)
  } else {
    if (p.onFail) p.onFail(result)
    else if (p.failName) callNamed(p.failName, result)
  }
}

ipcRenderer.on(JSAPI_CHANNEL, (_event, msg: HostToGuest) => {
  if (msg.kind === 'result') {
    const p = pending.get(msg.id)
    if (!p) return
    pending.delete(msg.id)
    deliver(p, msg.data, msg.ok && isOk(msg.data))
  } else if (msg.kind === 'push') {
    const p = pending.get(msg.id)
    if (!p) return
    if (p.callbackId !== undefined) callTt('subscribeHandler', p.callbackId, msg.data)
    else if (p.onSuccess) p.onSuccess(msg.data)
    else if (p.successName) callNamed(p.successName, msg.data)
  } else if (msg.kind === 'event') {
    inMainWorld(
      ((name: string, data: Record<string, unknown>) => {
        document.dispatchEvent(new CustomEvent(name, { detail: data }))
        const fn = (window as unknown as Record<string, unknown>)[name]
        if (typeof fn === 'function') (fn as (d: unknown) => void)(data)
      }) as never,
      [msg.name, msg.data]
    )
  }
})

const CALLBACK_KEYS = new Set([
  'onSuccess',
  'onFailed',
  'onFail',
  'success',
  'fail',
  'complete',
  'callbackId'
])

function sanitise(args: unknown): Record<string, unknown> {
  if (!args || typeof args !== 'object') return {}
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(args as Record<string, unknown>)) {
    if (CALLBACK_KEYS.has(k) || typeof v === 'function') continue
    try {
      out[k] = JSON.parse(JSON.stringify(v))
    } catch {
      /* drop non-serialisable values */
    }
  }
  return out
}

function invoke(
  method: string,
  rawArgs: unknown,
  cbs: { onSuccess?: Callback; onFail?: Callback }
): void {
  const args = (rawArgs && typeof rawArgs === 'object' ? rawArgs : {}) as Record<string, unknown>
  const id = ++seq
  const p: Pending = { method }
  if (typeof cbs.onSuccess === 'function') p.onSuccess = cbs.onSuccess
  if (typeof cbs.onFail === 'function') p.onFail = cbs.onFail
  if (typeof args['onSuccess'] === 'function') p.onSuccess = args['onSuccess'] as Callback
  if (typeof args['onFailed'] === 'function') p.onFail = args['onFailed'] as Callback
  if (typeof args['onFail'] === 'function') p.onFail = args['onFail'] as Callback
  if (typeof args['success'] === 'function') p.onSuccess = args['success'] as Callback
  if (typeof args['fail'] === 'function') p.onFail = args['fail'] as Callback
  if (typeof args['onSuccess'] === 'string') p.successName = args['onSuccess']
  if (typeof args['onFailed'] === 'string') p.failName = args['onFailed']
  if (typeof args['callbackId'] === 'string' || typeof args['callbackId'] === 'number')
    p.callbackId = args['callbackId']
  pending.set(id, p)
  send({ kind: 'invoke', id, method: String(method), params: sanitise(args), url: location.href })
}

// iOS flavour: window.WebViewJavascriptBridge.invoke({ method, args })
contextBridge.exposeInMainWorld('WebViewJavascriptBridge', {
  invoke(e: { method: string; args?: unknown }) {
    invoke(e?.method, e?.args, {})
  },
  callHandler(method: string, args: unknown, callback?: Callback) {
    invoke(method, args, callback ? { onSuccess: callback, onFail: callback } : {})
  },
  registerHandler() {
    /* page → host handlers are not used by the JSSDK */
  }
})

// PC flavour: window.__LarkPCSDK__.bridge.invoke(method, args, { onSuccess, onFail })
contextBridge.exposeInMainWorld('__LarkPCSDK__', {
  bridge: {
    invoke(method: string, args: unknown, cbs?: { onSuccess?: Callback; onFail?: Callback }) {
      invoke(method, args, cbs ?? {})
    }
  }
})

// Android flavour: window.LkWebViewJavascriptBridge.callHandler(method, args, _, _, { onSuccess, onFail })
contextBridge.exposeInMainWorld('LkWebViewJavascriptBridge', {
  callHandler(
    method: string,
    args: unknown,
    _a: unknown,
    _b: unknown,
    cbs?: { onSuccess?: Callback; onFail?: Callback }
  ) {
    invoke(method, args, cbs ?? {})
  },
  registerHandler() {
    /* no-op, mirrors official preload */
  }
})

function detectFlavor(): BridgeFlavor {
  const ua = navigator.userAgent
  if (ua.includes('iPhone') || ua.includes('iPad')) return 'ios'
  if (ua.includes('Macintosh') || ua.includes('Windows')) return 'pc'
  return 'android'
}

function announceReady(): void {
  inMainWorld(
    (() => {
      document.dispatchEvent(new Event('WebViewJavascriptBridgeReady'))
      document.dispatchEvent(new Event('LkWebViewJavascriptBridgeReady'))
    }) as never,
    []
  )
}

announceReady()
document.addEventListener('DOMContentLoaded', announceReady)
send({ kind: 'ready', flavor: detectFlavor() })

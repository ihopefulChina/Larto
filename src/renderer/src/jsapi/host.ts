/**
 * Shell-side JSAPI host. Receives invocations from the guest preload (via the
 * <webview> `ipc-message` event), answers UI-type APIs with simulator overlays,
 * forwards network/system APIs to main, and serves fixed mocks for the rest.
 */
import type { WebviewTag } from 'electron'
import {
  JSAPI_CHANNEL,
  JSAPI_ERROR,
  classifyJsapi,
  jsapiFail,
  okMsg,
  type GuestToHost,
  type HostToGuest,
  type JsapiInvoke
} from '@shared/jsapi'
import { JSAPI_MOCKS } from '@shared/jsapi-mocks'
import { translate } from '@shared/i18n'
import { invoke } from '@/lib/bridge'
import { useApp } from '@/store/app'
import { simulatorActions, useSimulator, type NavItem } from '@/store/simulator'

type Result = { ok: boolean; data: Record<string, unknown> }
const ok = (method: string, data: Record<string, unknown> = {}): Result => ({
  ok: true,
  data: { errMsg: okMsg(method), ...data }
})
const fail = (method: string, code: number, message: string): Result => ({
  ok: false,
  data: jsapiFail(method, code, message)
})

function sendToGuest(webview: WebviewTag, msg: HostToGuest): void {
  try {
    webview.send(JSAPI_CHANNEL, msg)
  } catch (err) {
    console.warn('[jsapi] send failed', err)
  }
}

export function emitGuestEvent(
  name: 'onLeftNavigationBarClick' | 'onRightNavigationBarClick' | 'onMenuItemClick',
  data: Record<string, unknown> = {}
): void {
  const { webview } = useSimulator.getState()
  if (webview) sendToGuest(webview, { kind: 'event', name, data })
}

export function attachJsapiHost(webview: WebviewTag): () => void {
  const onMessage = (event: Electron.IpcMessageEvent) => {
    if (event.channel !== JSAPI_CHANNEL) return
    const msg = event.args[0] as GuestToHost | undefined
    if (!msg || typeof msg !== 'object') return
    if (msg.kind === 'ready') return
    if (msg.kind === 'title') {
      useSimulator.getState().setNavBar({ title: msg.title })
      return
    }
    if (msg.kind === 'invoke') void handleInvoke(webview, msg)
  }
  webview.addEventListener('ipc-message', onMessage)
  return () => webview.removeEventListener('ipc-message', onMessage)
}

async function handleInvoke(webview: WebviewTag, msg: JsapiInvoke): Promise<void> {
  const { method, params, url } = msg
  const handler = classifyJsapi(method)
  const started = Date.now()
  let result: Result
  try {
    if (handler === 'main') {
      result = await invoke('jsapi:backend', { method, params, url })
    } else if (handler === 'shell') {
      result = await handleShell(method, params)
    } else {
      const mock = JSAPI_MOCKS[method]
      if (mock) result = ok(method, mock(params))
      else {
        console.warn('not handler api', method, params)
        result = fail(method, JSAPI_ERROR.NOT_SUPPORTED, `not handler api ${method}`)
      }
    }
  } catch (err) {
    result = fail(method, JSAPI_ERROR.NETWORK, err instanceof Error ? err.message : String(err))
  }
  sendToGuest(webview, { kind: 'result', id: msg.id, data: result.data, ok: result.ok })
  void invoke('jsapi:log', {
    ts: started,
    method,
    params,
    ok: result.ok,
    result: result.data,
    handler
  }).catch(() => undefined)
}

const str = (v: unknown, fallback = ''): string =>
  typeof v === 'string' ? v : typeof v === 'number' ? String(v) : fallback
const t = (key: Parameters<typeof translate>[1]) => translate(useApp.getState().lang, key)

function dialog(
  d: Omit<Parameters<ReturnType<typeof useSimulator.getState>['pushDialog']>[0], 'resolve'>
) {
  return new Promise<{ buttonIndex: number; value?: string }>((resolve) => {
    useSimulator.getState().pushDialog({ ...d, resolve })
  })
}

async function handleShell(method: string, p: Record<string, unknown>): Promise<Result> {
  const sim = useSimulator.getState()
  switch (method) {
    case 'device.notification.alert': {
      await dialog({
        type: 'alert',
        title: str(p['title']),
        message: str(p['message']),
        buttons: [str(p['buttonName'], t('common.ok'))]
      })
      return ok(method)
    }
    case 'device.notification.confirm': {
      const labels =
        Array.isArray(p['buttonLabels']) && p['buttonLabels'].length
          ? (p['buttonLabels'] as string[])
          : [t('common.cancel'), t('common.ok')]
      const r = await dialog({
        type: 'confirm',
        title: str(p['title']),
        message: str(p['message']),
        buttons: labels
      })
      return ok(method, { buttonIndex: r.buttonIndex })
    }
    case 'device.notification.prompt': {
      const labels =
        Array.isArray(p['buttonLabels']) && p['buttonLabels'].length
          ? (p['buttonLabels'] as string[])
          : [t('common.cancel'), t('common.ok')]
      const r = await dialog({
        type: 'prompt',
        title: str(p['title']),
        message: str(p['message']),
        buttons: labels,
        defaultValue: str(p['defaultText'])
      })
      return ok(method, { buttonIndex: r.buttonIndex, value: r.value ?? '' })
    }
    case 'showModal': {
      const showCancel = p['showCancel'] !== false
      const buttons = showCancel
        ? [str(p['cancelText'], t('common.cancel')), str(p['confirmText'], t('common.ok'))]
        : [str(p['confirmText'], t('common.ok'))]
      const r = await dialog({
        type: 'modal',
        title: str(p['title']),
        message: str(p['content']),
        buttons
      })
      const confirm = r.buttonIndex === buttons.length - 1
      return ok(method, { confirm, cancel: !confirm })
    }
    case 'showPrompt': {
      const buttons = [
        str(p['cancelText'], t('common.cancel')),
        str(p['confirmText'], t('common.ok'))
      ]
      const r = await dialog({
        type: 'prompt',
        title: str(p['title']),
        message: '',
        buttons,
        placeholder: str(p['placeholder'])
      })
      const confirm = r.buttonIndex === 1
      return ok(method, { confirm, cancel: !confirm, inputValue: r.value ?? '' })
    }
    case 'device.notification.toast': {
      sim.setToast({
        text: str(p['text']),
        icon: toastIcon(p['icon']),
        duration: Number(p['duration'] ?? 2) * 1000
      })
      return ok(method)
    }
    case 'showToast': {
      sim.setToast({
        text: str(p['title']),
        icon: toastIcon(p['icon']),
        duration: Number(p['duration'] ?? 1500)
      })
      return ok(method)
    }
    case 'hideToast':
      sim.setToast(null)
      return ok(method)
    case 'device.notification.showPreloader':
      sim.setPreloader({ text: str(p['text']) })
      return ok(method)
    case 'device.notification.hidePreloader':
      sim.setPreloader(null)
      return ok(method)
    case 'showActionSheet': {
      const items = Array.isArray(p['itemList']) ? (p['itemList'] as string[]) : []
      const title = str(p['title'])
      const index = await new Promise<number | null>((resolve) =>
        sim.setActionSheet({ ...(title ? { title } : {}), items, resolve })
      )
      if (index === null) return fail(method, JSAPI_ERROR.USER_CANCEL, 'cancel')
      return ok(method, { tapIndex: index })
    }
    case 'biz.navigation.setTitle':
      sim.setNavBar({ title: str(p['title']) })
      return ok(method)
    case 'biz.navigation.setLeft': {
      const show = p['show'] !== false
      const item: NavItem = {
        text: str(p['text']),
        control: p['control'] === true,
        ...(p['showIcon'] !== false ? { icon: 'back' as const } : {})
      }
      sim.setNavBar({ left: show ? [item] : [], showBack: show })
      return ok(method)
    }
    case 'biz.navigation.setRight': {
      const show = p['show'] !== false
      sim.setNavBar({
        right: show ? [{ text: str(p['text'], 'More'), control: p['control'] === true }] : []
      })
      return ok(method)
    }
    case 'biz.navigation.setMenu': {
      const items = Array.isArray(p['items']) ? (p['items'] as NavItem[]) : []
      sim.setNavBar({ menu: items })
      return ok(method)
    }
    case 'setNavigationBar': {
      const items = Array.isArray(p['items']) ? (p['items'] as NavItem[]) : []
      if (items.length > 2 || items.some((i) => (i.imageBase64?.length ?? 0) > 10240)) {
        return fail(
          method,
          JSAPI_ERROR.INVALID_PARAM,
          'items must be ≤ 2 and imageBase64 ≤ 10240 chars'
        )
      }
      sim.setNavBar({
        ...(typeof p['title'] === 'string' ? { title: p['title'] } : {}),
        right: items
      })
      return ok(method)
    }
    case 'biz.navigation.close':
      simulatorActions.close()
      return ok(method)
    case 'biz.navigation.goBack':
      simulatorActions.goBack()
      return ok(method)
    case 'biz.util.openLink': {
      const url = str(p['url'])
      if (!/^https?:/i.test(url)) return fail(method, JSAPI_ERROR.INVALID_PARAM, 'invalid url')
      simulatorActions.loadUrl(url)
      return ok(method)
    }
    case 'previewImage': {
      const urls = Array.isArray(p['urls']) ? (p['urls'] as string[]) : []
      if (!urls.length) return fail(method, JSAPI_ERROR.INVALID_PARAM, 'urls required')
      const current =
        typeof p['current'] === 'string'
          ? Math.max(0, urls.indexOf(p['current']))
          : Number(p['current'] ?? 0)
      sim.setImagePreview({ urls, current: Number.isFinite(current) ? current : 0 })
      return ok(method)
    }
    default:
      return fail(method, JSAPI_ERROR.NOT_SUPPORTED, `not handler api ${method}`)
  }
}

function toastIcon(v: unknown): 'none' | 'success' | 'error' | 'loading' {
  return v === 'success' || v === 'error' || v === 'loading' ? v : 'none'
}

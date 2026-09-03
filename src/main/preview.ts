import QRCode from 'qrcode'
import { LARK_OPEN_SCHEMA, buildMobilePreviewSchema } from '@shared/constants'
import type { PreviewQrResult } from '@shared/ipc'
import { shell } from 'electron'
import type { AccountService } from './account'
import type { SettingsStore } from './store'
import { getLanIp } from './jsapi-backend'
import { pushPcPreview } from './openapi'

/** Replaces localhost/127.0.0.1 with the machine's LAN IP so a phone can reach the dev server. */
export function toLanUrl(url: string): { url: string; replaced: boolean } {
  try {
    const u = new URL(url)
    if (u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === '0.0.0.0') {
      const ip = getLanIp()
      if (ip) {
        u.hostname = ip
        return { url: u.toString(), replaced: true }
      }
    }
  } catch {
    /* not a URL */
  }
  return { url, replaced: false }
}

export async function buildMobilePreviewQr(req: {
  url: string
  appId?: string
  useLanIp?: boolean
}): Promise<PreviewQrResult> {
  const warnings: string[] = []
  let target = req.url
  if (req.useLanIp) {
    const r = toLanUrl(target)
    target = r.url
    if (!r.replaced && /localhost|127\.0\.0\.1/.test(req.url))
      warnings.push('no LAN IPv4 address found; phone cannot reach localhost')
  } else if (/^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0)/.test(target)) {
    warnings.push('localhost is not reachable from a phone; enable "Replace localhost with LAN IP"')
  }
  const schema = buildMobilePreviewSchema(target, req.appId)
  // Official layout: 240×240 canvas with a 200×200 code. `margin` is in modules; 4 modules ≈ 20px at this size.
  const dataUrl = await QRCode.toDataURL(schema, {
    width: 240,
    margin: 2,
    errorCorrectionLevel: 'M',
    color: { dark: '#000000ff', light: '#ffffffff' }
  })
  return { schema, dataUrl, warnings }
}

export async function pushPcPreviewAndOpen(
  deps: { account: AccountService; settings: SettingsStore },
  req: { url: string; appId?: string }
): Promise<{ ok: boolean; message?: string }> {
  const cookie = deps.account.getCookie()
  const session = deps.account.getSession()
  if (!cookie || !session) return { ok: false, message: 'not signed in' }
  try {
    await pushPcPreview({ env: deps.settings.get().env, session, cookie }, req.url, req.appId)
    await shell.openExternal(LARK_OPEN_SCHEMA)
    return { ok: true }
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) }
  }
}

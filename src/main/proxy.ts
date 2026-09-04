import { session, type Session } from 'electron'
import { GUEST_PARTITION } from '@shared/constants'
import type { ProxySettings } from '@shared/settings'

/** electron-updater 6.x creates this isolated session for update metadata and downloads. */
const UPDATER_PARTITION = 'electron-updater'

export function resolveProxyConfig(proxy: ProxySettings): Electron.ProxyConfig {
  if (proxy.mode === 'none') return { mode: 'direct' }
  if (proxy.mode === 'manual') {
    const proxyRules = proxy.url.trim()
    if (!proxyRules) throw new Error('manual proxy address is required')
    return {
      mode: 'fixed_servers',
      proxyRules,
      proxyBypassRules: proxy.bypass
    }
  }
  return { mode: 'system' }
}

export async function applyProxyToSession(target: Session, proxy: ProxySettings): Promise<void> {
  await target.setProxy(resolveProxyConfig(proxy))
  // Electron can keep using pooled sockets created under the previous proxy configuration.
  // Closing them makes the newly selected policy effective for the very next request.
  await target.closeAllConnections()
}

/** Keep every Chromium-backed network path on the same effective proxy policy. */
export async function applyProxy(proxy: ProxySettings): Promise<void> {
  const results = await Promise.allSettled([
    applyProxyToSession(session.defaultSession, proxy),
    applyProxyToSession(session.fromPartition(GUEST_PARTITION), proxy),
    // Match electron-updater's own cache:false creation so creating the partition here first
    // does not silently change its cache policy.
    applyProxyToSession(session.fromPartition(UPDATER_PARTITION, { cache: false }), proxy)
  ])
  const failures = results
    .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
    .map((result) => result.reason)
  // Wait for every Session before rejecting so a caller's rollback cannot race a late success
  // from this policy application and leave one network path on the wrong proxy.
  if (failures.length) throw new AggregateError(failures, 'one or more proxy sessions failed')
}

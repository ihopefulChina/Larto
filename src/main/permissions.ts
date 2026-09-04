export type GuestPermissionDecision = 'allow' | 'prompt' | 'deny'

const AUTO_ALLOWED = new Set(['clipboard-sanitized-write'])
const CONFIRMABLE = new Set([
  'clipboard-read',
  'clipboard-write',
  'media',
  'geolocation',
  'notifications',
  'fullscreen',
  'pointerLock'
])

/** Only web origins can receive a guest permission. `data:`, `file:` and invalid URLs fail closed. */
export function permissionOrigin(url: string): string | null {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.origin : null
  } catch {
    return null
  }
}

export function defaultPermissionDecision(permission: string): GuestPermissionDecision {
  if (AUTO_ALLOWED.has(permission)) return 'allow'
  if (CONFIRMABLE.has(permission)) return 'prompt'
  return 'deny'
}

/**
 * Keeps allow/deny choices for this process only. A new application launch (or Clear Cache) asks
 * again; no site permission is silently persisted beside the guest session.
 */
export class GuestPermissionPolicy {
  private readonly decisions = new Map<string, boolean>()
  private readonly pending = new Map<string, Promise<boolean>>()

  check(permission: string, url: string, mediaTypes: readonly string[] = []): boolean {
    const origin = permissionOrigin(url)
    if (!origin) return false
    const fallback = defaultPermissionDecision(permission)
    if (fallback === 'allow') return true
    if (fallback === 'deny') return false
    return this.scopes(permission, mediaTypes).every(
      (scope) => this.decisions.get(this.key(origin, scope)) === true
    )
  }

  request(
    permission: string,
    url: string,
    mediaTypes: readonly string[],
    confirm: (origin: string, permission: string) => Promise<boolean>
  ): Promise<boolean> {
    const origin = permissionOrigin(url)
    if (!origin) return Promise.resolve(false)
    const fallback = defaultPermissionDecision(permission)
    if (fallback === 'allow') return Promise.resolve(true)
    if (fallback === 'deny') return Promise.resolve(false)
    const scopes = this.scopes(permission, mediaTypes)
    const decided = scopes.map((scope) => this.decisions.get(this.key(origin, scope)))
    if (decided.every((value) => value !== undefined)) {
      return Promise.resolve(decided.every((value) => value === true))
    }
    const requestKey = this.key(origin, scopes.join('+'))
    const existing = this.pending.get(requestKey)
    if (existing) return existing
    const operation = confirm(origin, permission)
      .then((allowed) => {
        for (const scope of scopes) this.decisions.set(this.key(origin, scope), allowed)
        return allowed
      })
      .catch(() => false)
      .finally(() => this.pending.delete(requestKey))
    this.pending.set(requestKey, operation)
    return operation
  }

  clear(): void {
    this.decisions.clear()
  }

  private key(origin: string, permission: string): string {
    return `${origin}\n${permission}`
  }

  private scopes(permission: string, mediaTypes: readonly string[]): string[] {
    if (permission !== 'media') return [permission]
    const supported = mediaTypes.filter((type) => type === 'audio' || type === 'video')
    // Electron may omit mediaTypes on a request or report an `unknown` check. Treat that as a
    // request for both capabilities so an ambiguous check never inherits a narrower approval.
    const types = [...new Set(supported.length > 0 ? supported : ['audio', 'video'])]
      .sort()
      .map((type) => `media:${type}`)
    return types
  }
}

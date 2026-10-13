/**
 * `native-resource://` protocol (official guest-session behaviour, §4.4): serves local
 * files to the H5 page under a random, single-app-session token so guest features that
 * produce local files (image pickers, exports…) can hand them to the page without
 * exposing arbitrary filesystem reads. Only paths explicitly registered here are
 * reachable; the registry is cleared with the guest cache.
 */
import { randomBytes } from 'node:crypto'
import { basename } from 'node:path'
import { pathToFileURL } from 'node:url'
import { net, type Session } from 'electron'

const SCHEME = 'native-resource'

const registry = new Map<string, { path: string; name: string }>()

/** Registers a file and returns the `native-resource://<token>/<name>` URL. */
export function registerNativeResource(filePath: string, name?: string): string {
  const token = randomBytes(16).toString('hex')
  registry.set(token, { path: filePath, name: name ?? basename(filePath) })
  return `${SCHEME}://${token}/${encodeURIComponent(name ?? basename(filePath))}`
}

/** Drops every registered file (guest cache cleared / app restart). */
export function clearNativeResources(): void {
  registry.clear()
}

/** Handles the scheme for a session. Call once per session at startup. */
export function installNativeResourceProtocol(ses: Session): void {
  ses.protocol.handle(SCHEME, (request) => {
    const token = safeToken(request.url)
    const entry = token ? registry.get(token) : undefined
    if (!entry) return new Response('native resource not found', { status: 404 })
    return net.fetch(pathToFileURL(entry.path).toString())
  })
}

function safeToken(url: string): string | null {
  try {
    const host = new URL(url).host
    return /^[0-9a-f]{32}$/.test(host) ? host : null
  } catch {
    return null
  }
}

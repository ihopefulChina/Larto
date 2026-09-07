import { readFileSync } from 'node:fs'
import { endpoint, ensureApp } from './app.mjs'
import { runBridge } from './bridge.mjs'

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
// This public metadata is checked against the desktop server in tests/mcp.test.ts.
const catalog = JSON.parse(readFileSync(new URL('./tools.json', import.meta.url), 'utf8'))
const protocolVersions = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05']
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)

/** Keep client startup/discovery independent of the desktop application's lifecycle. */
export function createRouter({ port, launch, log = () => {}, ensureAppImpl = ensureApp }) {
  let connecting = null
  return async (message) => {
    const validId = typeof message?.id === 'string' || typeof message?.id === 'number'
    const id = validId ? message.id : null
    const result = (value) => ({ jsonrpc: '2.0', id, result: value })
    const error = (code, text) => ({ jsonrpc: '2.0', id, error: { code, message: text } })
    if (!object(message) || message.jsonrpc !== '2.0' || typeof message.method !== 'string') {
      return error(-32600, 'Invalid Request')
    }
    // Notifications and client responses must never open a desktop window.
    if (!Object.hasOwn(message, 'id')) return null
    if (!validId) return error(-32600, 'Invalid Request')
    switch (message.method) {
      case 'initialize': {
        const params = message.params
        if (
          !object(params) ||
          typeof params.protocolVersion !== 'string' ||
          !object(params.capabilities) ||
          !object(params.clientInfo) ||
          typeof params.clientInfo.name !== 'string' ||
          typeof params.clientInfo.version !== 'string'
        ) {
          return error(-32602, 'Invalid initialization parameters')
        }
        return result({
          protocolVersion: protocolVersions.includes(params.protocolVersion)
            ? params.protocolVersion
            : protocolVersions[0],
          capabilities: { tools: {} },
          serverInfo: { name: 'larto', version: pkg.version }
        })
      }
      case 'ping':
        return result({})
      case 'tools/list':
        return result(catalog)
      case 'resources/list':
        return result({ resources: [] })
      case 'resources/templates/list':
        return result({ resourceTemplates: [] })
      case 'prompts/list':
        return result({ prompts: [] })
      case 'tools/call': {
        if (!catalog.tools.some((tool) => tool.name === message.params?.name)) {
          return error(-32602, 'Unknown Larto tool')
        }
        if (message.params.arguments !== undefined && !object(message.params.arguments)) {
          return error(-32602, 'Tool arguments must be an object')
        }
        // Parallel calls share startup; a later call checks again if the user has quit the app.
        connecting ??= Promise.resolve()
          .then(() => ensureAppImpl({ port, launch, log }))
          .finally(() => {
            connecting = null
          })
        await connecting
        return undefined
      }
      default:
        return error(-32601, 'Method not found')
    }
  }
}

export function runServer({ port, launch = true, log = () => {}, ...streams }) {
  return runBridge({
    ...streams,
    url: endpoint(port),
    log,
    routeMessage: createRouter({ port, launch, log })
  })
}

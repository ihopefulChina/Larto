import { readFileSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: {
    focus: vi.fn(),
    getVersion: () => '0.1.1',
    isPackaged: false
  }
}))
vi.mock('../src/main/devtools-dock', () => ({ devToolsDock: { state: {} } }))
vi.mock('../src/main/guest', () => ({
  guestManager: { contents: null, state: { ready: true } }
}))
vi.mock('../src/main/window', () => ({ getMainWindow: () => null }))

const { McpService } = await import('../src/main/mcp')

async function listenOnFreePort(): Promise<{ port: number; server: Server }> {
  const server = createServer()
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('could not allocate test port')
  return { port: address.port, server }
}

async function close(server: Server): Promise<void> {
  if (!server.listening) return
  await new Promise<void>((resolve) => server.close(() => resolve()))
}

async function freePort(): Promise<number> {
  const reserved = await listenOnFreePort()
  await close(reserved.server)
  return reserved.port
}

const services: InstanceType<typeof McpService>[] = []
afterEach(async () => {
  await Promise.all(services.splice(0).map((service) => service.stop()))
})

function serviceFor(mcp: { enabled: boolean; port: number }) {
  const service = new McpService({
    settings: { get: () => ({ mcp }) } as never,
    account: {} as never,
    sendCommand: vi.fn()
  })
  services.push(service)
  return service
}

describe('McpService offline tool catalog', () => {
  it('matches the complete HTTP tools/list result', async () => {
    const port = await freePort()
    const service = serviceFor({ enabled: true, port })
    await service.start()

    const response = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'mcp-protocol-version': '2025-03-26'
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} })
    })
    expect(response.status).toBe(200)
    const body = await response.text()
    const messages = response.headers.get('content-type')?.includes('text/event-stream')
      ? body
          .split(/\r?\n/)
          .filter((line) => line.startsWith('data:'))
          .map((line) => JSON.parse(line.slice(5).trim()))
      : [JSON.parse(body)]
    const reply = messages.find((message) => message.id === 1)
    expect(reply).toBeDefined()
    expect(reply.error).toBeUndefined()
    expect(reply.result.tools).toHaveLength(18)

    const catalog = new URL('../packages/larto-mcp/src/tools.json', import.meta.url)
    // Regenerate only after intentionally changing the public tool contract:
    // LARTO_UPDATE_MCP_TOOLS=1 pnpm exec vitest run tests/mcp.test.ts -t 'complete HTTP tools/list'
    // pnpm exec prettier --write packages/larto-mcp/src/tools.json
    if (process.env.LARTO_UPDATE_MCP_TOOLS === '1') {
      writeFileSync(catalog, JSON.stringify(reply.result, null, 2) + '\n')
    }
    expect(reply.result).toStrictEqual(JSON.parse(readFileSync(catalog, 'utf8')))
  })
})

describe('McpService lifecycle', () => {
  it('serializes rapid restarts and publishes only the newest port', async () => {
    const initialPort = await freePort()
    const supersededPort = await freePort()
    const finalPort = await freePort()
    const mcp = { enabled: true, port: initialPort }
    const service = serviceFor(mcp)

    await service.start()
    expect(service.status()).toEqual({
      running: true,
      url: `http://127.0.0.1:${initialPort}/mcp`
    })

    mcp.port = supersededPort
    const superseded = service.start()
    mcp.port = finalPort
    const latest = service.start()
    await Promise.all([superseded, latest])

    expect(service.status()).toEqual({
      running: true,
      url: `http://127.0.0.1:${finalPort}/mcp`
    })
    await expect(
      fetch(`http://127.0.0.1:${finalPort}/health`).then((response) => response.status)
    ).resolves.toBe(200)
    await expect(fetch(`http://127.0.0.1:${initialPort}/health`)).rejects.toThrow()
    await expect(fetch(`http://127.0.0.1:${supersededPort}/health`)).rejects.toThrow()
  })

  it('clears a failed listen status when a newer setting disables MCP', async () => {
    const occupied = await listenOnFreePort()
    const mcp = { enabled: true, port: occupied.port }
    const service = serviceFor(mcp)
    try {
      await service.start()
      expect(service.status()).toEqual({
        running: false,
        url: null,
        error: `port ${occupied.port} is already in use`
      })

      mcp.enabled = false
      await service.start()
      expect(service.status()).toEqual({ running: false, url: null })
    } finally {
      await close(occupied.server)
    }
  })
})

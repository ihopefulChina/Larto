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

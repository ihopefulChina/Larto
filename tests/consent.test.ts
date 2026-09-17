import { beforeEach, describe, expect, it, vi } from 'vitest'

const windowMock = vi.hoisted(() => {
  const handlers = new Map<string, (...args: unknown[]) => void>()
  const win = {
    once(event: string, listener: (...args: unknown[]) => void) {
      handlers.set(event, listener)
      return win
    },
    off(event: string) {
      handlers.delete(event)
      return win
    }
  }
  return {
    handlers,
    win,
    sendToRenderer: vi.fn(),
    getMainWindow: vi.fn(() => win)
  }
})

vi.mock('../src/main/window', () => ({
  getMainWindow: () => windowMock.getMainWindow(),
  sendToRenderer: windowMock.sendToRenderer
}))
vi.mock('../src/main/logger', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() })
}))

const { ConsentBroker } = await import('../src/main/consent')

beforeEach(() => {
  windowMock.sendToRenderer.mockClear()
  windowMock.getMainWindow.mockImplementation(() => windowMock.win)
  windowMock.handlers.clear()
})

describe('ConsentBroker', () => {
  it('notifies the renderer when a newer prompt supersedes an open one', async () => {
    const broker = new ConsentBroker()
    const first = broker.ask({
      appName: 'A',
      appIconUrl: '',
      suiteIconUrl: '',
      userName: 'u',
      tenantIconUrl: '',
      scopes: []
    })
    const firstId = (windowMock.sendToRenderer.mock.calls[0]?.[1] as { id: string }).id

    const second = broker.ask({
      appName: 'B',
      appIconUrl: '',
      suiteIconUrl: '',
      userName: 'u',
      tenantIconUrl: '',
      scopes: []
    })
    expect(await first).toBe(false)
    expect(windowMock.sendToRenderer).toHaveBeenCalledWith('jsapi:consentClosed', {
      id: firstId,
      reason: 'superseded'
    })

    const secondPrompt = windowMock.sendToRenderer.mock.calls
      .filter((call) => call[0] === 'jsapi:consent')
      .at(-1)?.[1] as { id: string }
    broker.decide(secondPrompt.id, true)
    expect(await second).toBe(true)
  })

  it('cancels every pending prompt when the guest document changes', async () => {
    const broker = new ConsentBroker()
    const pending = broker.ask({
      appName: 'A',
      appIconUrl: '',
      suiteIconUrl: '',
      userName: 'u',
      tenantIconUrl: '',
      scopes: []
    })
    const id = (windowMock.sendToRenderer.mock.calls[0]?.[1] as { id: string }).id
    broker.cancelAll()
    expect(await pending).toBe(false)
    expect(windowMock.sendToRenderer).toHaveBeenCalledWith('jsapi:consentClosed', {
      id,
      reason: 'cancelled'
    })
  })
})

/**
 * MCP server (Streamable HTTP, loopback only) so AI agents can drive the simulator:
 * navigate, switch devices, take screenshots, evaluate JS, read console/JSAPI logs.
 *
 * Endpoint: http://127.0.0.1:<port>/mcp   (health: /health)
 * Stateless mode: a fresh McpServer + transport per request (SDK recommended pattern).
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { z } from 'zod'
import { app } from 'electron'
import { APP_NAME } from '@shared/constants'
import { DEVICES, ZOOM_LEVELS } from '@shared/devices'
import type { JsapiLogEntry, ShellCommand } from '@shared/ipc'
import { ThemeModeSchema } from './settings-schema'
import type { AccountService } from './account'
import { devToolsDock } from './devtools-dock'
import { guestManager, type ConsoleEntry } from './guest'
import type { SettingsStore } from './store'
import { createLogger } from './logger'
import { getMainWindow } from './window'

const log = createLogger('mcp')

export interface McpDeps {
  settings: SettingsStore
  account: AccountService
  sendCommand: (cmd: ShellCommand) => void
}

const JSAPI_LOG_LIMIT = 300

export class McpService {
  private server: Server | null = null
  private url: string | null = null
  private error: string | undefined
  /** Serializes stop/listen transitions; a newer settings change supersedes queued work. */
  private lifecycleQueue: Promise<void> = Promise.resolve()
  private lifecycleGeneration = 0
  private readonly jsapiLog: JsapiLogEntry[] = []
  private deviceRequestSequence = 0
  private pendingDeviceRequest: { deviceId: string; requestId: string } | null = null

  constructor(private readonly deps: McpDeps) {}

  status() {
    return { running: !!this.server, url: this.url, ...(this.error ? { error: this.error } : {}) }
  }

  recordJsapi(entry: JsapiLogEntry): void {
    this.jsapiLog.push(entry)
    if (this.jsapiLog.length > JSAPI_LOG_LIMIT) this.jsapiLog.shift()
  }

  async start(): Promise<void> {
    const generation = ++this.lifecycleGeneration
    return this.enqueueLifecycle(generation, async () => {
      // Coalesce settings edits that were superseded before their turn reached the socket.
      if (generation !== this.lifecycleGeneration) return
      await this.stopCurrentServer()
      if (generation !== this.lifecycleGeneration) return

      this.error = undefined
      const { enabled, port } = this.deps.settings.get().mcp
      if (!enabled) return

      const server = createServer((req, res) => void this.handle(req, res))
      const listenError = await this.listen(server, port)

      // A newer setting may arrive while listen() is pending. Never publish that older socket or
      // let its eventual callback overwrite the status of the requested configuration.
      if (generation !== this.lifecycleGeneration) {
        if (!listenError) await this.close(server)
        return
      }
      if (listenError) {
        this.error = this.listenErrorMessage(listenError, port)
        log.error('mcp listen failed', listenError)
        return
      }

      this.server = server
      this.url = `http://127.0.0.1:${port}/mcp`
      server.on('error', (err: NodeJS.ErrnoException) => {
        if (this.server !== server) return
        this.error = this.listenErrorMessage(err, port)
        log.error('mcp server failed', err)
      })
      server.once('close', () => {
        if (this.server !== server) return
        this.server = null
        this.url = null
      })
      log.info(`mcp listening on ${this.url}`)
    })
  }

  async stop(): Promise<void> {
    const generation = ++this.lifecycleGeneration
    return this.enqueueLifecycle(generation, async () => {
      if (generation !== this.lifecycleGeneration) return
      await this.stopCurrentServer()
      if (generation === this.lifecycleGeneration) this.error = undefined
    })
  }

  private enqueueLifecycle(generation: number, operation: () => Promise<void>): Promise<void> {
    const queued = this.lifecycleQueue.then(async () => {
      try {
        await operation()
      } catch (err) {
        if (generation === this.lifecycleGeneration) {
          this.error = err instanceof Error ? err.message : String(err)
        }
        log.error('mcp lifecycle failed', err)
      }
    })
    this.lifecycleQueue = queued
    return queued
  }

  private async stopCurrentServer(): Promise<void> {
    const s = this.server
    this.server = null
    this.url = null
    if (!s) return
    await this.close(s)
  }

  private close(server: Server): Promise<void> {
    if (!server.listening) return Promise.resolve()
    return new Promise<void>((resolve) => server.close(() => resolve()))
  }

  private listen(server: Server, port: number): Promise<NodeJS.ErrnoException | undefined> {
    return new Promise((resolve) => {
      const cleanup = () => {
        server.off('error', onError)
        server.off('listening', onListening)
      }
      const onError = (err: NodeJS.ErrnoException) => {
        cleanup()
        resolve(err)
      }
      const onListening = () => {
        cleanup()
        resolve(undefined)
      }
      server.once('error', onError)
      server.once('listening', onListening)
      try {
        server.listen(port, '127.0.0.1')
      } catch (err) {
        cleanup()
        resolve(err as NodeJS.ErrnoException)
      }
    })
  }

  private listenErrorMessage(err: NodeJS.ErrnoException, port: number): string {
    return err.code === 'EADDRINUSE' ? `port ${port} is already in use` : err.message
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // Loopback-only server; still reject cross-origin browser callers (DNS rebinding).
    const host = req.headers.host ?? ''
    if (!/^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(host)) {
      res.writeHead(403).end('forbidden')
      return
    }
    const url = new URL(req.url ?? '/', `http://${host}`)
    if (url.pathname === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(
        JSON.stringify({
          ok: true,
          app: APP_NAME,
          version: app.getVersion(),
          guest: guestManager.state
        })
      )
      return
    }
    if (url.pathname !== '/mcp') {
      res.writeHead(404).end('not found')
      return
    }
    try {
      const mcp = this.createServer()
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })
      res.on('close', () => {
        void transport.close()
        void mcp.close()
      })
      await mcp.connect(transport)
      await transport.handleRequest(req, res)
    } catch (err) {
      log.error('mcp request failed', err)
      if (!res.headersSent) res.writeHead(500, { 'content-type': 'application/json' })
      res.end(
        JSON.stringify({
          jsonrpc: '2.0',
          error: { code: -32603, message: 'internal error' },
          id: null
        })
      )
    }
  }

  private createServer(): McpServer {
    const server = new McpServer({ name: APP_NAME.toLowerCase(), version: app.getVersion() })
    const text = (value: unknown) => ({
      content: [
        {
          type: 'text' as const,
          text: typeof value === 'string' ? value : JSON.stringify(value, null, 2)
        }
      ]
    })
    const requireGuest = () => {
      const c = guestManager.contents
      if (!c) throw new Error('simulator webview is not attached yet')
      return c
    }

    server.registerTool(
      'get_state',
      {
        title: 'Get simulator state',
        description:
          'Current URL, title, device, zoom, theme, DevTools visibility, account and MCP info.'
      },
      async () => {
        const s = this.deps.settings.get()
        return text({
          guest: guestManager.state,
          devtools: devToolsDock.state,
          zoom: s.zoom,
          theme: s.theme,
          showDevTools: s.showDevTools,
          env: s.env,
          account: this.deps.account.getState(),
          version: app.getVersion()
        })
      }
    )

    server.registerTool(
      'navigate',
      {
        title: 'Navigate',
        description: 'Load a URL in the simulator (also records it in the address bar history).',
        inputSchema: { url: z.string().url() }
      },
      async ({ url }) => {
        this.deps.sendCommand({ type: 'navigate', url })
        return text({ ok: true, url })
      }
    )

    server.registerTool(
      'focus_window',
      {
        title: 'Focus window',
        description:
          'Bring the Larto window to the front (screenshots of the DevTools panel need an unoccluded window).'
      },
      async () => {
        const win = getMainWindow()
        if (!win) throw new Error('main window is not available')
        if (win.isMinimized()) win.restore()
        win.show()
        app.focus({ steal: true })
        return text({ focused: win.isFocused() })
      }
    )

    server.registerTool(
      'reload',
      { title: 'Reload page', description: 'Reload the current page in the simulator.' },
      async () => {
        this.deps.sendCommand({ type: 'reload' })
        return text({ ok: true })
      }
    )

    server.registerTool(
      'list_devices',
      {
        title: 'List devices',
        description: 'Device presets available in the simulator, with their ids.'
      },
      async () =>
        text(
          DEVICES.map((d) => ({
            id: d.id,
            name: d.name,
            width: d.width,
            height: d.height,
            dpr: d.dpr,
            platform: d.platform
          }))
        )
    )

    server.registerTool(
      'set_device',
      {
        title: 'Set device',
        description: 'Switch the simulated device (reloads the page with the matching user agent).',
        inputSchema: { deviceId: z.enum(DEVICES.map((d) => d.id) as [string, ...string[]]) }
      },
      async ({ deviceId }) => {
        const requestId = `mcp-device-${++this.deviceRequestSequence}`
        // A second MCP caller supersedes the first command immediately. Waiting until the
        // renderer reaches its next CDP call is too late: changing the webview user agent can
        // stop the older reload, which used to let that older request report a false success.
        if (this.pendingDeviceRequest) {
          guestManager.failDeviceRequest({
            ...this.pendingDeviceRequest,
            message: 'device request was superseded'
          })
        }
        this.pendingDeviceRequest = { deviceId, requestId }
        const applied = guestManager.waitForDeviceApplied(deviceId, requestId)
        this.deps.sendCommand({ type: 'setDevice', deviceId, requestId })
        try {
          await applied
          return text({ ok: true, deviceId })
        } finally {
          if (this.pendingDeviceRequest?.requestId === requestId) this.pendingDeviceRequest = null
        }
      }
    )

    server.registerTool(
      'set_zoom',
      {
        title: 'Set zoom',
        description: `Simulator zoom percentage. Allowed: ${ZOOM_LEVELS.join(', ')}.`,
        inputSchema: { zoom: z.number().int() }
      },
      async ({ zoom }) => {
        if (!ZOOM_LEVELS.includes(zoom))
          throw new Error(`zoom must be one of ${ZOOM_LEVELS.join(', ')}`)
        this.deps.sendCommand({ type: 'setZoom', zoom })
        return text({ ok: true, zoom })
      }
    )

    server.registerTool(
      'set_theme',
      {
        title: 'Set appearance',
        description: 'Switch app appearance.',
        inputSchema: { mode: ThemeModeSchema }
      },
      async ({ mode }) => {
        this.deps.settings.patch({ theme: mode })
        return text({ ok: true, mode })
      }
    )

    server.registerTool(
      'toggle_devtools',
      {
        title: 'Toggle DevTools',
        description: 'Show or hide the docked Chromium DevTools panel.',
        inputSchema: { show: z.boolean().optional() }
      },
      async ({ show }) => {
        this.deps.sendCommand({ type: 'toggleDevTools', ...(show !== undefined ? { show } : {}) })
        return text({ ok: true })
      }
    )

    server.registerTool(
      'clear_cache',
      {
        title: 'Clear cache',
        description: 'Clear all site data of the simulator session and reload.'
      },
      async () => {
        this.deps.sendCommand({ type: 'clearCache' })
        return text({ ok: true })
      }
    )

    server.registerTool(
      'screenshot',
      {
        title: 'Screenshot',
        description:
          'Capture a PNG of the page viewport (default), of the Larto shell window (toolbar + simulator frame), or of the docked DevTools panel.',
        inputSchema: { target: z.enum(['page', 'window', 'devtools']).optional() }
      },
      async ({ target }) => {
        const capture = async (): Promise<Electron.NativeImage | null> => {
          if (target === 'devtools') return devToolsDock.capture()
          if (target === 'window') return (await getMainWindow()?.webContents.capturePage()) ?? null
          return requireGuest().capturePage()
        }
        // A freshly shown surface can briefly report "not available for capture"; retry a few frames.
        let image: Electron.NativeImage | null = null
        for (let attempt = 0; attempt < 8; attempt++) {
          try {
            image = await capture()
            if (image && !image.isEmpty()) break
          } catch (err) {
            if (attempt === 7) throw err
          }
          await new Promise((r) => setTimeout(r, 250))
        }
        if (!image || image.isEmpty()) throw new Error(`${target ?? 'page'} is not available`)
        return {
          content: [
            {
              type: 'image' as const,
              data: image.toPNG().toString('base64'),
              mimeType: 'image/png'
            }
          ]
        }
      }
    )

    server.registerTool(
      'evaluate',
      {
        title: 'Evaluate JavaScript',
        description:
          'Run a JavaScript expression in the page (main world) and return its JSON-serialisable result.',
        inputSchema: { expression: z.string() }
      },
      async ({ expression }) => {
        const result: unknown = await requireGuest().executeJavaScript(expression, true)
        return text(result === undefined ? 'undefined' : result)
      }
    )

    server.registerTool(
      'get_dom',
      {
        title: 'Get DOM',
        description:
          'Return outerHTML of the first element matching a CSS selector (default: documentElement), truncated to maxLength.',
        inputSchema: {
          selector: z.string().optional(),
          maxLength: z.number().int().positive().max(200000).optional()
        }
      },
      async ({ selector, maxLength }) => {
        const html: string = await requireGuest().executeJavaScript(
          `(() => { const el = ${JSON.stringify(selector ?? '')} ? document.querySelector(${JSON.stringify(selector ?? '')}) : document.documentElement; return el ? el.outerHTML : ''; })()`,
          true
        )
        const limit = maxLength ?? 20000
        return text(
          html.length > limit
            ? `${html.slice(0, limit)}\n<!-- truncated ${html.length - limit} chars -->`
            : html
        )
      }
    )

    server.registerTool(
      'click',
      {
        title: 'Click element',
        description: 'Click the first element matching a CSS selector.',
        inputSchema: { selector: z.string() }
      },
      async ({ selector }) => {
        const ok: boolean = await requireGuest().executeJavaScript(
          `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; el.scrollIntoView({block:'center'}); el.click(); return true; })()`,
          true
        )
        if (!ok) throw new Error(`no element matches ${selector}`)
        return text({ ok: true })
      }
    )

    server.registerTool(
      'fill',
      {
        title: 'Fill input',
        description: 'Set the value of an input/textarea (dispatches input & change events).',
        inputSchema: { selector: z.string(), value: z.string() }
      },
      async ({ selector, value }) => {
        const ok: boolean = await requireGuest().executeJavaScript(
          `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; el.focus(); el.value = ${JSON.stringify(value)}; el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true})); return true; })()`,
          true
        )
        if (!ok) throw new Error(`no element matches ${selector}`)
        return text({ ok: true })
      }
    )

    server.registerTool(
      'get_console',
      {
        title: 'Get console logs',
        description: 'Recent console messages from the page.',
        inputSchema: {
          limit: z.number().int().positive().max(500).optional(),
          level: z.enum(['verbose', 'info', 'warning', 'error']).optional()
        }
      },
      async ({ limit, level }) =>
        text(guestManager.consoleEntries(limit ?? 100, level as ConsoleEntry['level'] | undefined))
    )

    server.registerTool(
      'clear_console',
      { title: 'Clear console buffer', description: 'Discard buffered console messages.' },
      async () => {
        guestManager.clearConsole()
        return text({ ok: true })
      }
    )

    server.registerTool(
      'get_jsapi_log',
      {
        title: 'Get JSAPI log',
        description:
          'Recent Feishu JSAPI calls made by the page and how the simulator answered them.',
        inputSchema: { limit: z.number().int().positive().max(300).optional() }
      },
      async ({ limit }) => text(this.jsapiLog.slice(-(limit ?? 100)))
    )

    return server
  }
}

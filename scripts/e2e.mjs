#!/usr/bin/env node
/**
 * End-to-end smoke test driven through the app's own MCP server.
 * Requires `pnpm build` first. Launches Electron, serves a tiny JSAPI test page,
 * then exercises navigation, emulation, DevTools docking, evaluate and console capture.
 *
 *   pnpm build && pnpm e2e
 *
 * Exit code 0 = all assertions passed. Screenshots land in /tmp/fdt-e2e/.
 */
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PORT = Number(process.env.FDT_MCP_PORT ?? 17331)
const MCP = `http://127.0.0.1:${PORT}/mcp`
const OUT = '/tmp/fdt-e2e'
mkdirSync(OUT, { recursive: true })

const page = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>fdt e2e</title></head><body style="font-family:-apple-system;padding:16px"><h3 id="h">JSAPI bridge test</h3>
<pre id="log" style="font-size:12px;white-space:pre-wrap;word-break:break-all"></pre>
<script>
const log = (m) => { document.getElementById('log').textContent += m + '\\n'; console.info('[e2e] ' + m) }
log('ua=' + navigator.userAgent)
log('inner=' + innerWidth + 'x' + innerHeight + ' dpr=' + devicePixelRatio)
log('bridges: ios=' + !!window.WebViewJavascriptBridge + ' pc=' + !!window.__LarkPCSDK__)
if (window.WebViewJavascriptBridge) {
  WebViewJavascriptBridge.callHandler('biz.util.getSystemInfo', {}, (r) => log('getSystemInfo ' + JSON.stringify(r)))
  WebViewJavascriptBridge.callHandler('biz.navigation.setTitle', { title: 'Bridge OK' }, (r) => log('setTitle ' + r.errMsg))
  WebViewJavascriptBridge.callHandler('device.notification.toast', { text: 'Hello from JSAPI', duration: 2 }, (r) => log('toast ' + r.errMsg))
}
</script></body></html>`

const srv = createServer((_req, res) => {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
  res.end(page)
}).listen(0, '127.0.0.1')
await new Promise((r) => srv.once('listening', r))
const PAGE_URL = `http://127.0.0.1:${srv.address().port}/e2e.html`

// A previous instance would win the single-instance lock and answer our MCP calls instead.
try {
  await fetch(`http://127.0.0.1:${PORT}/health`)
  console.error(
    `another FeishuDevTools instance is already serving MCP on port ${PORT}; quit it first`
  )
  process.exit(2)
} catch {
  /* port free */
}

const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
const app = spawn(resolve(ROOT, 'node_modules/.bin/electron'), ['.'], {
  cwd: ROOT,
  env,
  stdio: ['ignore', 'pipe', 'pipe']
})
app.stderr.on('data', (d) => {
  const s = String(d)
  if (/\[(WARN|ERROR)\]/.test(s)) process.stdout.write('[app] ' + s)
})

let rpcId = 0
async function rpc(method, params) {
  const res = await fetch(MCP, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params })
  })
  const text = await res.text()
  const frames = text
    .split('\n')
    .filter((l) => l.startsWith('data:'))
    .map((l) => JSON.parse(l.slice(5)))
  return frames.find((f) => f.id === rpcId) ?? frames.at(-1) ?? JSON.parse(text)
}
async function tool(name, args = {}) {
  const r = await rpc('tools/call', { name, arguments: args })
  if (r.error || r.result?.isError)
    throw new Error(`${name}: ${JSON.stringify(r.error ?? r.result.content)}`)
  return r.result
}
const text = (r) => r.content.find((c) => c.type === 'text')?.text ?? ''
const json = (r) => JSON.parse(text(r))
const png = (r) => Buffer.from(r.content.find((c) => c.type === 'image').data, 'base64')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let failures = 0
const check = (label, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`)
  if (!ok) failures++
}

try {
  let ready = false
  for (let i = 0; i < 60 && !ready; i++) {
    try {
      const h = await (await fetch(`http://127.0.0.1:${PORT}/health`)).json()
      ready = !!h.guest?.attached
    } catch {}
    if (!ready) await sleep(500)
  }
  check('app started and MCP reachable', ready)
  if (!ready) throw new Error('app did not become ready')

  await tool('toggle_devtools', { show: false })
  await tool('set_zoom', { zoom: 100 })
  await tool('set_device', { deviceId: 'iphone-13' })
  await sleep(1000)
  await tool('navigate', { url: PAGE_URL })
  await sleep(1500)

  const metrics = json(
    await tool('evaluate', {
      expression:
        'JSON.stringify({w:innerWidth,h:innerHeight,dpr:devicePixelRatio,sw:screen.width,sh:screen.height,ua:navigator.userAgent})'
    })
  )
  check(
    'iphone-13 emulation (390 wide, dpr 3, screen 390x844)',
    metrics.w === 390 && metrics.dpr === 3 && metrics.sw === 390 && metrics.sh === 844,
    JSON.stringify(metrics)
  )
  check('Lark UA injected', /Lark\/\d/.test(metrics.ua))

  const logs = json(await tool('get_console', { limit: 50 }))
  check(
    'console captured JSAPI test lines',
    logs.some((l) => /\[e2e\] getSystemInfo/.test(l.message))
  )
  check(
    'JSAPI callbacks answered with :ok',
    logs.some((l) => /setTitle biz\.navigation\.setTitle:ok/.test(l.message)) &&
      logs.some((l) => /toast device\.notification\.toast:ok/.test(l.message))
  )
  const jsapi = json(await tool('get_jsapi_log', { limit: 50 }))
  check(
    'JSAPI log records calls',
    Array.isArray(jsapi) &&
      ['biz.util.getSystemInfo', 'biz.navigation.setTitle'].every((m) =>
        jsapi.some((e) => e.method === m)
      )
  )

  await tool('set_device', { deviceId: 'nexus-5' })
  await sleep(1500)
  const android = json(
    await tool('evaluate', {
      expression: 'JSON.stringify({w:innerWidth,dpr:devicePixelRatio,ua:navigator.userAgent})'
    })
  )
  check(
    'android device switch applies UA + width',
    /Android/.test(android.ua) && android.w === 360,
    JSON.stringify(android)
  )

  await tool('set_zoom', { zoom: 75 })
  await sleep(500)
  const zoomed = json(
    await tool('evaluate', { expression: 'JSON.stringify({w:innerWidth,dpr:devicePixelRatio})' })
  )
  check(
    'zoom keeps CSS viewport stable',
    zoomed.w === 360 && zoomed.dpr === 3,
    JSON.stringify(zoomed)
  )
  await tool('set_zoom', { zoom: 100 })

  await tool('toggle_devtools', { show: true })
  await sleep(3500)
  const st = json(await tool('get_state'))
  check(
    'DevTools docked (devtools:// frontend loaded)',
    st.devtools?.open === true && /^devtools:\/\//.test(st.devtools.url ?? ''),
    JSON.stringify({ bounds: st.devtools?.bounds, visible: st.devtools?.visible })
  )
  const dt = png(await tool('screenshot', { target: 'devtools' }))
  writeFileSync(`${OUT}/devtools.png`, dt)
  check('DevTools screenshot captured', dt.length > 10_000, `${dt.length} bytes`)
  await tool('toggle_devtools', { show: false })
  await sleep(500)
  check('DevTools closed', json(await tool('get_state')).devtools?.open === false)

  const win = png(await tool('screenshot', { target: 'window' }))
  writeFileSync(`${OUT}/window.png`, win)
  check('window screenshot captured', win.length > 10_000, `${win.length} bytes`)

  await tool('set_theme', { mode: 'light' })
  await sleep(300)
  check('theme switch reflected in state', json(await tool('get_state')).theme === 'light')
  await tool('set_theme', { mode: 'system' })

  await tool('clear_cache')
  await sleep(1000)
  check(
    'clear_cache keeps page alive',
    /fdt e2e|Bridge OK/.test(text(await tool('evaluate', { expression: 'document.title' })))
  )
} catch (err) {
  failures++
  console.error('E2E ERROR', err)
} finally {
  app.kill('SIGTERM')
  srv.close()
  await sleep(300)
}
console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed')
process.exit(failures ? 1 : 0)

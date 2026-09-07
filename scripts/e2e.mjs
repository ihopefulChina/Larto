#!/usr/bin/env node
/**
 * End-to-end smoke test driven through the app's own MCP server.
 * Requires `pnpm build` first. Launches Electron, serves a tiny JSAPI test page,
 * then exercises navigation, emulation, DevTools docking, evaluate and console capture, and
 * finally runs one MCP session through the stdio bridge in packages/larto-mcp.
 *
 *   pnpm build && pnpm e2e
 *
 * Exit code 0 = all assertions passed. Screenshots land in the OS temp directory under
 * `larto-e2e/`.
 */
import { execFileSync, spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
const ELECTRON_PATH = require('electron')
const PORT = Number(process.env.LARTO_MCP_PORT ?? 17331)
const MCP = `http://127.0.0.1:${PORT}/mcp`
const OUT = resolve(tmpdir(), 'larto-e2e')
mkdirSync(OUT, { recursive: true })
// Scratch userData: the run must not leave its device/zoom/history in the real settings.json.
const USER_DATA = mkdtempSync(resolve(OUT, 'userdata-'))
const MCP_PACKAGE_DIR = mkdtempSync(resolve(OUT, 'mcp-package-'))

// Exercise the publishable npm artifact, not the repository's bin.mjs path. A local tarball keeps
// CI deterministic before the first registry publication while proving package files + bin entry.
let MCP_PACKAGE_ENTRY
try {
  execFileSync('npm', ['pack', '--silent', '--pack-destination', MCP_PACKAGE_DIR], {
    cwd: resolve(ROOT, 'packages/larto-mcp'),
    stdio: 'pipe'
  })
  const mcpPackage = resolve(
    MCP_PACKAGE_DIR,
    readdirSync(MCP_PACKAGE_DIR).find((name) => name.endsWith('.tgz')) ?? ''
  )
  if (!mcpPackage.endsWith('.tgz')) throw new Error('npm pack did not create an MCP package')
  const mcpPackageInstall = resolve(MCP_PACKAGE_DIR, 'install')
  execFileSync(
    'npm',
    [
      'install',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      '--package-lock=false',
      '--prefix',
      mcpPackageInstall,
      mcpPackage
    ],
    { stdio: 'pipe' }
  )
  // Execute the installed package entry with Node instead of relying on the platform-specific
  // `.bin` shim (`.cmd` on Windows, a symlink on Unix).
  MCP_PACKAGE_ENTRY = resolve(mcpPackageInstall, 'node_modules/larto-mcp/bin.mjs')
} catch (err) {
  rmSync(USER_DATA, { recursive: true, force: true })
  rmSync(MCP_PACKAGE_DIR, { recursive: true, force: true })
  throw err
}

const page = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>larto e2e</title></head><body style="font-family:-apple-system;padding:16px"><h3 id="h">JSAPI bridge test</h3>
<pre id="log" style="font-size:12px;white-space:pre-wrap;word-break:break-all"></pre>
<script>
window.__lartoPageRequestId = __LARTO_PAGE_REQUEST_ID__
const log = (m) => { document.getElementById('log').textContent += m + '\\n'; console.info('[e2e] ' + m) }
log('ua=' + navigator.userAgent)
log('inner=' + innerWidth + 'x' + innerHeight + ' dpr=' + devicePixelRatio +
  ' screen=' + screen.width + 'x' + screen.height + ' touch=' + navigator.maxTouchPoints)
log('bridges: ios=' + !!window.WebViewJavascriptBridge + ' pc=' + !!window.__LarkPCSDK__)
if (window.WebViewJavascriptBridge) {
  WebViewJavascriptBridge.callHandler('getSystemInfo', {}, (r) => log('getSystemInfo ' + JSON.stringify(r)))
  WebViewJavascriptBridge.callHandler('biz.navigation.setTitle', { title: 'Bridge OK' }, (r) => log('setTitle ' + r.errMsg))
  WebViewJavascriptBridge.callHandler('device.notification.toast', { text: 'Hello from JSAPI', duration: 2 }, (r) => log('toast ' + r.errMsg))
}
</script></body></html>`

let pageRequests = 0
let nextPageDelayMs = 0
let delayedPageResponses = 0
const srv = createServer((req, res) => {
  const isTestPage = new URL(req.url ?? '/', 'http://127.0.0.1').pathname === '/e2e.html'
  const requestId = isTestPage ? ++pageRequests : 0
  const send = () => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    res.end(page.replace('__LARTO_PAGE_REQUEST_ID__', String(requestId)))
  }
  if (isTestPage) {
    if (nextPageDelayMs > 0) {
      const delay = nextPageDelayMs
      nextPageDelayMs = 0
      delayedPageResponses++
      setTimeout(send, delay)
      return
    }
  }
  send()
}).listen(0, '127.0.0.1')
await new Promise((r) => srv.once('listening', r))
const PAGE_URL = `http://127.0.0.1:${srv.address().port}/e2e.html`
// Start on the test page so the very first navigation (emulation + console capture from attach)
// is what gets asserted; everything else in the profile stays at defaults.
writeFileSync(
  resolve(USER_DATA, 'settings.json'),
  JSON.stringify({ version: 1, lastUrl: PAGE_URL, mcp: { enabled: true, port: PORT } })
)

// A previous instance would win the single-instance lock and answer our MCP calls instead.
try {
  await fetch(`http://127.0.0.1:${PORT}/health`)
  console.error(`another Larto instance is already serving MCP on port ${PORT}; quit it first`)
  process.exit(2)
} catch {
  /* port free */
}

const env = { ...process.env, LARTO_USER_DATA: USER_DATA }
delete env.ELECTRON_RUN_AS_NODE
const app = spawn(ELECTRON_PATH, ['.'], {
  cwd: ROOT,
  env,
  stdio: ['ignore', 'pipe', 'pipe']
})
if (process.env.LARTO_E2E_VERBOSE) app.stdout.on('data', (d) => process.stdout.write('[app] ' + d))
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

/** Spawn the npm stdio bridge against this app instance and run one MCP session through it. */
async function runBridge() {
  const proc = spawn(process.execPath, [MCP_PACKAGE_ENTRY, '--port', String(PORT), '--no-launch'], {
    cwd: ROOT,
    stdio: ['pipe', 'pipe', 'pipe']
  })
  const byId = new Map()
  let buf = ''
  proc.stdout.on('data', (d) => {
    buf += String(d)
    let nl
    while ((nl = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, nl)
      buf = buf.slice(nl + 1)
      if (!line.trim()) continue
      const msg = JSON.parse(line)
      if (msg.id !== undefined) byId.set(msg.id, msg)
    }
  })
  proc.stderr.on('data', (d) => {
    if (!/connected to Larto/.test(String(d))) process.stdout.write('[bridge] ' + d)
  })
  const send = (m) => proc.stdin.write(JSON.stringify(m) + '\n')
  const waitId = async (id, ms = 15000) => {
    const t0 = Date.now()
    while (!byId.has(id) && Date.now() - t0 < ms) await sleep(50)
    return byId.get(id)
  }
  send({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2025-03-26',
      capabilities: {},
      clientInfo: { name: 'larto-e2e', version: '0' }
    }
  })
  const init = await waitId(1)
  send({ jsonrpc: '2.0', method: 'notifications/initialized' })
  send({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} })
  send({
    jsonrpc: '2.0',
    id: 3,
    method: 'tools/call',
    params: { name: 'get_state', arguments: {} }
  })
  const [list, call] = await Promise.all([waitId(2), waitId(3)])
  proc.stdin.end()
  const exitCode = await new Promise((r) => {
    const t = setTimeout(() => {
      proc.kill()
      r('timeout')
    }, 5000)
    proc.on('exit', (code) => {
      clearTimeout(t)
      r(code)
    })
  })
  return { init, list, call, exitCode }
}
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

  const fresh = json(await tool('get_state'))
  check(
    'fresh profile defaults: iPhone 17 Pro + debugger docked',
    fresh.guest?.deviceId === 'iphone-17-pro' && fresh.showDevTools === true,
    JSON.stringify({ deviceId: fresh.guest?.deviceId, showDevTools: fresh.showDevTools })
  )
  await sleep(1000)
  const firstLoad = json(await tool('get_console', { limit: 50 })).find((e) =>
    /\[e2e\] inner=/.test(e.message)
  )
  check(
    'first page load already emulated and its console captured',
    !!firstLoad && /inner=402x771 dpr=3 screen=402x874 touch=5/.test(firstLoad.message),
    firstLoad?.message ?? 'no first-load console entry'
  )

  await tool('toggle_devtools', { show: false })
  await tool('set_zoom', { zoom: 100 })
  const requestsBeforeDeviceReload = pageRequests
  nextPageDelayMs = 650
  const deviceReloadStartedAt = Date.now()
  await tool('set_device', { deviceId: 'iphone-13' })
  check(
    'set_device waits for its correlated page reload',
    pageRequests > requestsBeforeDeviceReload && Date.now() - deviceReloadStartedAt >= 600,
    JSON.stringify({ pageRequests, elapsed: Date.now() - deviceReloadStartedAt })
  )
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
    logs.some((l) => /getSystemInfo .*"errMsg":"getSystemInfo:ok"/.test(l.message)) &&
      logs.some((l) => /setTitle biz\.navigation\.setTitle:ok/.test(l.message)) &&
      logs.some((l) => /toast device\.notification\.toast:ok/.test(l.message))
  )
  const jsapi = json(await tool('get_jsapi_log', { limit: 50 }))
  check(
    'JSAPI log records calls',
    Array.isArray(jsapi) &&
      ['getSystemInfo', 'biz.navigation.setTitle'].every((m) => jsapi.some((e) => e.method === m))
  )

  const rapidSwitchStartedAt = Date.now()
  const delayedResponsesBeforeRapidSwitch = delayedPageResponses
  const pageRequestsBeforeRapidSwitch = pageRequests
  nextPageDelayMs = 650
  const firstRapidSwitch = tool('set_device', { deviceId: 'nexus-5' })
  // Start the newer command only after the older command's deliberately slow reload began.
  for (let i = 0; i < 500 && delayedPageResponses === delayedResponsesBeforeRapidSwitch; i++) {
    await sleep(10)
  }
  if (delayedPageResponses === delayedResponsesBeforeRapidSwitch) {
    throw new Error('rapid-switch setup did not observe the first reload within 5 seconds')
  }
  const secondRapidSwitch = tool('set_device', { deviceId: 'iphone-13' })
  const rapidSwitches = await Promise.allSettled([firstRapidSwitch, secondRapidSwitch])
  // Let the intentionally delayed, now-aborted response arrive. It must not replace the newer
  // page that the second command loaded and acknowledged.
  await sleep(800)
  const committedRapidRequest = Number(
    text(await tool('evaluate', { expression: 'window.__lartoPageRequestId' }))
  )
  const rapidState = json(await tool('get_state'))
  check(
    'rapid device commands correlate or reject without a stale reload',
    delayedPageResponses > delayedResponsesBeforeRapidSwitch &&
      rapidSwitches[0]?.status === 'rejected' &&
      rapidSwitches[1]?.status === 'fulfilled' &&
      pageRequests >= pageRequestsBeforeRapidSwitch + 2 &&
      committedRapidRequest === pageRequests &&
      rapidState.guest?.deviceId === 'iphone-13' &&
      Date.now() - rapidSwitchStartedAt < 10_000,
    JSON.stringify({
      results: rapidSwitches.map((result) => result.status),
      deviceId: rapidState.guest?.deviceId,
      pageRequests,
      committedRapidRequest,
      delayedPageResponses,
      elapsed: Date.now() - rapidSwitchStartedAt
    })
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

  await tool('toggle_devtools', { show: true })
  await sleep(500)
  nextPageDelayMs = 1200
  const pcResizeStartedAt = Date.now()
  const pcSwitch = tool('set_device', { deviceId: 'pc-mac' })
  await sleep(250)
  await tool('toggle_devtools', { show: false })
  await pcSwitch
  check(
    'PC resize observer does not steal a slow set_device acknowledgement',
    Date.now() - pcResizeStartedAt >= 1100 && Date.now() - pcResizeStartedAt < 10_000,
    `${Date.now() - pcResizeStartedAt}ms`
  )
  await sleep(300)
  const adaptivePc = json(
    await tool('evaluate', {
      expression:
        'JSON.stringify({w:innerWidth,h:innerHeight,sw:screen.width,sh:screen.height,ua:navigator.userAgent})'
    })
  )
  check(
    'PC fit mode keeps viewport and screen metrics aligned',
    adaptivePc.w === adaptivePc.sw &&
      adaptivePc.h === adaptivePc.sh &&
      /Macintosh/.test(adaptivePc.ua),
    JSON.stringify(adaptivePc)
  )
  await tool('set_device', { deviceId: 'nexus-5' })
  await sleep(1000)

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
  // Return to the product default for final visual QA and the stdio bridge assertion below.
  await tool('set_device', { deviceId: 'iphone-17-pro' })
  await sleep(1000)

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
  // The native DevTools view is not part of BrowserWindow.capturePage. Keep the matching shell
  // frame as a visual-QA source; it can be composited at st.devtools.bounds when needed.
  const shellWithDevTools = png(await tool('screenshot', { target: 'window' }))
  writeFileSync(`${OUT}/shell-with-devtools.png`, shellWithDevTools)
  check('shell frame with DevTools layout captured', shellWithDevTools.length > 10_000)
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
    /larto e2e|Bridge OK/.test(text(await tool('evaluate', { expression: 'document.title' })))
  )

  // packages/larto-mcp: the stdio bridge must expose the same server to stdio-only
  // clients. Drive a full initialize → tools/list → tools/call round trip through it.
  const bridge = await runBridge()
  check(
    'stdio bridge: initialize answered by the app server',
    bridge.init?.result?.serverInfo?.name === 'larto',
    JSON.stringify(bridge.init?.result?.serverInfo ?? bridge.init?.error)
  )
  const bridgeTools = bridge.list?.result?.tools?.map((t) => t.name) ?? []
  check(
    'stdio bridge: tools/list matches HTTP tools/list',
    bridgeTools.length > 0 &&
      JSON.stringify(bridgeTools) ===
        JSON.stringify((await rpc('tools/list', {})).result.tools.map((t) => t.name)),
    `${bridgeTools.length} tools`
  )
  const bridgeState = JSON.parse(
    bridge.call?.result?.content?.find((c) => c.type === 'text')?.text ?? 'null'
  )
  check(
    'stdio bridge: tools/call get_state round trip',
    bridgeState?.guest?.deviceId === 'iphone-17-pro',
    JSON.stringify({ deviceId: bridgeState?.guest?.deviceId, exit: bridge.exitCode })
  )
} catch (err) {
  failures++
  console.error('E2E ERROR', err)
} finally {
  app.kill('SIGTERM')
  srv.close()
  await sleep(300)
  if (process.env.LARTO_E2E_KEEP_USER_DATA) console.log(`kept E2E userData: ${USER_DATA}`)
  else rmSync(USER_DATA, { recursive: true, force: true })
  rmSync(MCP_PACKAGE_DIR, { recursive: true, force: true })
}
console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed')
process.exit(failures ? 1 : 0)

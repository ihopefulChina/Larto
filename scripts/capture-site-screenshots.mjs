#!/usr/bin/env node
/**
 * Capture the six product screenshots used by README.md and website/.
 *
 * The run uses a throwaway Electron profile and an anonymous localhost page. Chromium DevTools
 * is a separate native WebContentsView, so its bitmap is composited over the shell capture at the
 * bounds reported by the app's own MCP server.
 *
 *   pnpm screenshots
 */
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PUBLIC = resolve(ROOT, 'website/public')
const require = createRequire(import.meta.url)
const ELECTRON_PATH = require('electron')
const sleep = (ms) => new Promise((done) => setTimeout(done, ms))

const showcase = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
  <title>H5 设备诊断</title>
  <style>
    :root { color-scheme: light dark; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; color: #1f2329; background: #f4f6f8; }
    main { padding: 22px 18px calc(26px + env(safe-area-inset-bottom)); }
    .eyebrow { margin: 0 0 8px; color: #3370ff; font-size: 11px; font-weight: 750; letter-spacing: .12em; }
    h1 { margin: 0; font-size: 26px; letter-spacing: -.03em; }
    .lead { margin: 10px 0 18px; color: #646a73; font-size: 14px; line-height: 1.55; }
    .metrics { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
    .metric, .checks { border: 1px solid #e5e6eb; border-radius: 14px; background: #fff; box-shadow: 0 4px 18px rgba(31,35,41,.05); }
    .metric { padding: 14px; }
    .metric span { display: block; color: #8f959e; font-size: 11px; }
    .metric strong { display: block; margin-top: 6px; font-size: 17px; }
    .checks { margin-top: 12px; padding: 5px 14px; }
    .check { display: flex; align-items: center; gap: 10px; min-height: 43px; border-bottom: 1px solid #eff0f1; font-size: 13px; }
    .check:last-child { border: 0; }
    .dot { width: 8px; height: 8px; border-radius: 50%; background: #34c759; box-shadow: 0 0 0 4px rgba(52,199,89,.12); }
    button { width: 100%; height: 46px; margin-top: 14px; border: 0; border-radius: 12px; color: #fff; background: #3370ff; font: inherit; font-weight: 650; }
    @media (prefers-color-scheme: dark) {
      body { color: #f5f6f7; background: #20242b; }
      .lead { color: #aeb4bc; }
      .metric, .checks { border-color: #41464d; background: #2b3037; box-shadow: none; }
      .metric span { color: #aeb4bc; }
      .check { border-color: #3b4047; }
    }
  </style>
</head>
<body>
  <main>
    <p class="eyebrow">LIVE DEVICE PROFILE</p>
    <h1>H5 兼容性检查</h1>
    <p class="lead">当前页面正在设备预设与受限网页容器中运行。视口、像素密度、触摸事件和 JSAPI 桥会随机型同步。</p>
    <section class="metrics" aria-label="设备指标">
      <div class="metric"><span>视口</span><strong id="viewport">—</strong></div>
      <div class="metric"><span>像素密度</span><strong id="dpr">—</strong></div>
      <div class="metric"><span>触摸点</span><strong id="touch">—</strong></div>
      <div class="metric"><span>安全区</span><strong>已注入</strong></div>
    </section>
    <section class="checks" aria-label="运行状态">
      <div class="check"><i class="dot"></i><span>设备模拟已就绪</span></div>
      <div class="check"><i class="dot"></i><span id="bridge">JSAPI 桥检测中</span></div>
      <div class="check"><i class="dot"></i><span>网页隔离与沙箱已启用</span></div>
    </section>
    <button type="button">运行页面诊断</button>
  </main>
  <script>
    document.querySelector('#viewport').textContent = innerWidth + ' × ' + innerHeight
    document.querySelector('#dpr').textContent = devicePixelRatio + '×'
    document.querySelector('#touch').textContent = navigator.maxTouchPoints
    document.querySelector('#bridge').textContent = window.WebViewJavascriptBridge ? 'JSAPI 桥已连接' : '标准 Web 环境'
    window.WebViewJavascriptBridge?.callHandler('biz.navigation.setTitle', { title: '设备诊断' }, () => {})
  </script>
</body>
</html>`

async function freePort() {
  const server = createServer()
  server.listen(0, '127.0.0.1')
  await new Promise((done) => server.once('listening', done))
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0
  await new Promise((done) => server.close(done))
  return port
}

const pageServer = createServer((_req, res) => {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
  res.end(showcase)
})
pageServer.listen(0, '127.0.0.1')
await new Promise((done) => pageServer.once('listening', done))
const pageAddress = pageServer.address()
const pagePort = typeof pageAddress === 'object' && pageAddress ? pageAddress.port : 0
const pageUrl = `http://localhost:${pagePort}/device-check`

const mcpPort = await freePort()
const debugPort = await freePort()
const scratch = mkdtempSync(resolve(tmpdir(), 'larto-site-capture-'))
mkdirSync(PUBLIC, { recursive: true })
writeFileSync(
  resolve(scratch, 'settings.json'),
  JSON.stringify({
    version: 1,
    theme: 'dark',
    language: 'zh-CN',
    deviceId: 'iphone-17-pro',
    zoom: 100,
    showDevTools: true,
    lastUrl: pageUrl,
    autoCheckUpdates: false,
    mcp: { enabled: true, port: mcpPort }
  })
)

const env = { ...process.env, LARTO_USER_DATA: scratch }
delete env.ELECTRON_RUN_AS_NODE
const app = spawn(ELECTRON_PATH, [`--remote-debugging-port=${debugPort}`, '.'], {
  cwd: ROOT,
  env,
  stdio: ['ignore', 'pipe', 'pipe']
})
app.stderr.on('data', (chunk) => {
  const message = String(chunk)
  if (/\[(WARN|ERROR)\]/.test(message)) process.stderr.write(message)
})

let rpcId = 0
async function rpc(method, params) {
  const response = await fetch(`http://127.0.0.1:${mcpPort}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params })
  })
  const body = await response.text()
  const frames = body
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => JSON.parse(line.slice(5)))
  return frames.find((frame) => frame.id === rpcId) ?? frames.at(-1) ?? JSON.parse(body)
}

async function tool(name, args = {}) {
  const result = await rpc('tools/call', { name, arguments: args })
  if (result.error || result.result?.isError) {
    throw new Error(`${name}: ${JSON.stringify(result.error ?? result.result.content)}`)
  }
  return result.result
}

function text(result) {
  return result.content.find((item) => item.type === 'text')?.text ?? ''
}

function png(result) {
  const image = result.content.find((item) => item.type === 'image')
  if (!image) throw new Error('screenshot did not return an image')
  return Buffer.from(image.data, 'base64')
}

async function waitForApp() {
  for (let attempt = 0; attempt < 80; attempt++) {
    try {
      const health = await (
        await fetch(`http://127.0.0.1:${mcpPort}/health`, {
          signal: AbortSignal.timeout(1000)
        })
      ).json()
      if (health.guest?.attached) return
    } catch {}
    await sleep(250)
  }
  throw new Error('Larto did not become ready')
}

async function dismissDevToolsLanguageNotice() {
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      const targets = await (
        await fetch(`http://127.0.0.1:${debugPort}/json/list`, {
          signal: AbortSignal.timeout(1000)
        })
      ).json()
      const target = targets.find((item) => String(item.url).startsWith('devtools://'))
      if (!target?.webSocketDebuggerUrl) throw new Error('DevTools target is not ready')
      const clicked = await cdpEvaluate(
        target.webSocketDebuggerUrl,
        `(() => {
          const nodes = [];
          const walk = (root) => {
            for (const element of root.querySelectorAll('*')) {
              nodes.push(element);
              if (element.shadowRoot) walk(element.shadowRoot);
            }
          };
          walk(document);
          const dismiss = nodes.find((element) =>
            /don't show again/i.test(element.textContent || '') &&
            (element.matches('button,[role="button"]') || element.closest('button,[role="button"]') === element)
          );
          const close = nodes.find((element) =>
            /close/i.test(element.getAttribute?.('aria-label') || '') && element.matches('button,[role="button"]')
          );
          const target = dismiss || close;
          if (target) target.click();
          return !!target;
        })()`
      )
      if (clicked) {
        await sleep(350)
        return
      }
    } catch {}
    await sleep(250)
  }
}

async function cdpEvaluate(url, expression) {
  const socket = new WebSocket(url)
  await new Promise((resolveOpen, reject) => {
    socket.addEventListener('open', resolveOpen, { once: true })
    socket.addEventListener('error', reject, { once: true })
  })
  const result = await new Promise((resolveResult, reject) => {
    const timer = setTimeout(() => reject(new Error('CDP evaluate timed out')), 3000)
    socket.addEventListener(
      'message',
      (event) => {
        const message = JSON.parse(String(event.data))
        if (message.id !== 1) return
        clearTimeout(timer)
        if (message.error) reject(new Error(message.error.message))
        else resolveResult(message.result?.result?.value)
      },
      { once: false }
    )
    socket.send(
      JSON.stringify({
        id: 1,
        method: 'Runtime.evaluate',
        params: { expression, returnByValue: true }
      })
    )
  })
  socket.close()
  return result
}

async function capture(theme) {
  await tool('set_theme', { mode: theme })
  await tool('set_device', { deviceId: 'iphone-17-pro' })
  await tool('set_zoom', { zoom: 100 })
  await tool('toggle_devtools', { show: true })
  await sleep(3000)
  await dismissDevToolsLanguageNotice()

  const state = JSON.parse(text(await tool('get_state')))
  const bounds = state.devtools?.bounds
  if (!state.devtools?.open || !bounds) throw new Error('DevTools is not docked')
  const shell = png(await tool('screenshot', { target: 'window' }))
  const devtools = png(await tool('screenshot', { target: 'devtools' }))
  const [shellMeta, devtoolsMeta] = await Promise.all([
    sharp(shell).metadata(),
    sharp(devtools).metadata()
  ])
  if (!shellMeta.width || !shellMeta.height || !devtoolsMeta.width || !devtoolsMeta.height) {
    throw new Error('could not read screenshot dimensions')
  }
  const scale = devtoolsMeta.width / bounds.width
  const left = Math.round(bounds.x * scale)
  const top = Math.round(bounds.y * scale)
  const width = Math.min(devtoolsMeta.width, shellMeta.width - left)
  const height = Math.min(devtoolsMeta.height, shellMeta.height - top)
  const devtoolsLayer = await sharp(devtools)
    .extract({ left: 0, top: 0, width, height })
    .png()
    .toBuffer()

  await sharp(shell)
    .composite([{ input: devtoolsLayer, left, top }])
    .webp({ quality: 86, effort: 6 })
    .toFile(resolve(PUBLIC, `hero-${theme}.webp`))
  await sharp(shell)
    .extract({ left: 0, top, width: left, height: shellMeta.height - top })
    .webp({ quality: 86, effort: 6 })
    .toFile(resolve(PUBLIC, `simulator-${theme}.webp`))
  await sharp(devtoolsLayer)
    .webp({ quality: 86, effort: 6 })
    .toFile(resolve(PUBLIC, `devtools-${theme}.webp`))
  console.log(`captured ${theme}: ${shellMeta.width}x${shellMeta.height} @ ${scale}x`)
}

try {
  await waitForApp()
  await capture('dark')
  await capture('light')
} finally {
  app.kill('SIGTERM')
  pageServer.close()
  await sleep(300)
  rmSync(scratch, { recursive: true, force: true })
}

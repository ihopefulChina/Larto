import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable, Writable } from 'node:stream'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { ensureApp } from '../src/app.mjs'
import { runBridge } from '../src/bridge.mjs'
import { createRouter } from '../src/server.mjs'

const catalog = JSON.parse(readFileSync(new URL('../src/tools.json', import.meta.url), 'utf8'))
const initialize = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2025-03-26',
    capabilities: {},
    clientInfo: { name: 'test', version: '0' }
  }
}
const call = (id) => ({
  jsonrpc: '2.0',
  id,
  method: 'tools/call',
  params: { name: 'get_state', arguments: {} }
})

async function unusedPort() {
  const server = createServer()
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const { port } = server.address()
  await new Promise((resolve) => server.close(resolve))
  return port
}

test('repeated CLI connections discover tools offline without any network or desktop launch', async () => {
  const scratch = mkdtempSync(join(tmpdir(), 'larto-no-launch-'))
  const marker = join(scratch, 'unexpected-side-effect')
  // Intercept only the child under test, so a regression cannot open an installed application.
  const guard = `import cp from 'node:child_process'; import { writeFileSync } from 'node:fs';
    import { syncBuiltinESMExports } from 'node:module';
    const unexpected = () => { writeFileSync(${JSON.stringify(marker)}, 'called'); throw new Error('Unexpected desktop/network access'); };
    cp.spawn = unexpected; globalThis.fetch = unexpected; syncBuiltinESMExports();`
  const port = await unusedPort()
  try {
    for (let iteration = 0; iteration < 3; iteration++) {
      const child = spawn(
        process.execPath,
        [
          '--import',
          `data:text/javascript,${encodeURIComponent(guard)}`,
          fileURLToPath(new URL('../bin.mjs', import.meta.url)),
          '--port',
          String(port)
        ],
        { stdio: ['pipe', 'pipe', 'pipe'] }
      )
      let stdout = ''
      let stderr = ''
      child.stdout.on('data', (data) => {
        stdout += data
      })
      child.stderr.on('data', (data) => {
        stderr += data
      })
      const exit = once(child, 'close')
      const timeout = setTimeout(() => child.kill(), 5000)
      const messages =
        iteration === 0
          ? []
          : [
              initialize,
              { jsonrpc: '2.0', method: 'notifications/initialized' },
              { jsonrpc: '2.0', id: 2, method: 'tools/list' },
              { jsonrpc: '2.0', id: 3, method: 'ping' },
              { jsonrpc: '2.0', id: 4, method: 'resources/list' },
              { jsonrpc: '2.0', id: 5, method: 'prompts/list' }
            ]
      child.stdin.end(messages.map((message) => JSON.stringify(message) + '\n').join(''))
      const [code] = await exit
      clearTimeout(timeout)
      assert.equal(code, 0, stderr)
      assert.equal(
        existsSync(marker),
        false,
        'client startup must not contact or launch the desktop'
      )
      const replies = stdout
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line))
      if (iteration === 0) assert.deepEqual(replies, [])
      else {
        assert.equal(replies.length, 5)
        assert.equal(replies.find((reply) => reply.id === 1).result.protocolVersion, '2025-03-26')
        assert.deepEqual(replies.find((reply) => reply.id === 2).result, catalog)
        assert.deepEqual(replies.find((reply) => reply.id === 3).result, {})
      }
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
})

test('only a valid tool request starts the desktop; concurrent calls share startup', async () => {
  let starts = 0
  let ready
  const router = createRouter({
    port: 12345,
    launch: true,
    ensureAppImpl: async (options) => {
      assert.equal(options.launch, true)
      starts++
      await new Promise((resolve) => {
        ready = resolve
      })
    }
  })
  for (const message of [
    initialize,
    { jsonrpc: '2.0', id: 2, method: 'tools/list' },
    { jsonrpc: '2.0', method: 'tools/call', params: { name: 'get_state' } },
    { ...call(3), params: { name: 'unknown' } },
    { ...call(4), params: { name: 'get_state', arguments: [] } },
    { jsonrpc: '2.0', id: 5, method: 'unsupported' },
    null,
    [call(6)]
  ])
    await router(message)
  assert.equal(starts, 0)
  const pending = [router(call(7)), router(call(8))]
  await Promise.resolve()
  assert.equal(starts, 1)
  ready()
  assert.deepEqual(await Promise.all(pending), [undefined, undefined])
  const later = router(call(9))
  await Promise.resolve()
  assert.equal(starts, 2, 'check again if the user quit the desktop since the last call')
  ready()
  await later
})

test('startup failure answers every pending id once and allows a later retry', async () => {
  let attempts = 0
  const routeMessage = createRouter({
    port: 1,
    launch: true,
    ensureAppImpl: async () => {
      attempts++
      throw new Error('App could not start')
    }
  })
  let stdout = ''
  await runBridge({
    url: 'http://127.0.0.1:1/mcp',
    routeMessage,
    input: Readable.from([JSON.stringify(call(1)) + '\n' + JSON.stringify(call(2)) + '\n']),
    output: new Writable({
      write(chunk, _encoding, callback) {
        stdout += chunk
        callback()
      }
    })
  })
  const replies = stdout
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line))
  assert.deepEqual(replies.map((reply) => reply.id).sort(), [1, 2])
  assert.ok(replies.every((reply) => reply.error.message === 'App could not start'))
  assert.equal(attempts, 1)
  await assert.rejects(routeMessage(call(3)), /App could not start/)
  assert.equal(attempts, 2)
})

test('--no-launch still discovers tools offline and tool calls fail without launching', async () => {
  const port = await unusedPort()
  const router = createRouter({ port, launch: false })
  assert.deepEqual((await router({ jsonrpc: '2.0', id: 1, method: 'tools/list' })).result, catalog)
  await assert.rejects(router(call(2)), /Larto is not running/)
  // The low-level helper is conservative unless the tool-call path opts into launch.
  await assert.rejects(ensureApp({ port }), /Larto is not running/)
})

test('initialization validates parameters and negotiates a supported protocol version', async () => {
  const router = createRouter({ port: 1, launch: false })
  const future = await router({
    ...initialize,
    params: { ...initialize.params, protocolVersion: '2099-01-01' }
  })
  assert.equal(future.result.protocolVersion, '2025-11-25')
  assert.deepEqual(future.result.capabilities, { tools: {} })
  const invalid = await router({ ...initialize, params: {} })
  assert.equal(invalid.error.code, -32602)
})

import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { Readable, Writable } from 'node:stream'
import { test } from 'node:test'
import { BUNDLE_ID, launchApp, launchCandidates } from '../src/app.mjs'
import { runBridge } from '../src/bridge.mjs'
import { SseParser } from '../src/sse.mjs'
import {
  claudeDesktopConfigPath,
  cliInvocation,
  install,
  mergeCodexToml,
  mergeJsonConfig,
  serverEntry
} from '../src/install.mjs'

async function bridgeExchange(request, options = {}) {
  const input = Readable.from([JSON.stringify(request) + '\n'])
  let stdout = ''
  const output = new Writable({
    write(chunk, _encoding, callback) {
      stdout += chunk.toString()
      callback()
    }
  })
  const logs = []
  await runBridge({
    url: 'http://127.0.0.1:17331/mcp',
    input,
    output,
    log: (message) => logs.push(message),
    ...options
  })
  return {
    messages: stdout
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line)),
    logs
  }
}

test('SseParser yields complete data payloads across chunk boundaries', () => {
  const p = new SseParser()
  assert.deepEqual(p.push('event: message\ndata: {"a":1}\n\nda'), ['{"a":1}'])
  assert.deepEqual(p.push('ta: {"b":'), [])
  assert.deepEqual(p.push('2}\r\n\r\n: comment\n\n'), ['{"b":2}'])
  assert.deepEqual(p.push('data: line1\ndata: line2'), [])
  assert.deepEqual(p.end(), ['line1\nline2'])
})

test('auto-launch targets the packaged application on every supported platform', () => {
  assert.equal(BUNDLE_ID, 'app.ihopeful.FeishuDevTools')
  assert.deepEqual(launchCandidates({ platform: 'darwin', env: {}, home: '/Users/test' }), [
    { command: 'open', args: ['-g', '-b', BUNDLE_ID] }
  ])
  const windows = launchCandidates({
    platform: 'win32',
    env: { LOCALAPPDATA: 'C:\\Users\\test\\AppData\\Local' },
    home: 'C:\\Users\\test'
  })
  assert.equal(
    windows[0].command,
    'C:\\Users\\test\\AppData\\Local\\Programs\\FeishuDevTools\\FeishuDevTools.exe'
  )
  assert.equal(windows.at(-1).command, 'FeishuDevTools.exe')
  const linux = launchCandidates({ platform: 'linux', env: {}, home: '/home/test' })
  assert.deepEqual(linux[0], {
    command: '/home/test/.local/bin/feishu-dev-tools',
    args: []
  })
  assert.equal(linux.at(-1).command, 'FeishuDevTools')
})

test('auto-launch tries the next installation candidate without invoking a shell', async () => {
  const commands = []
  let unrefCalled = false
  const spawnImpl = (command, args, options) => {
    commands.push({ command, args, options })
    const child = new EventEmitter()
    child.unref = () => {
      unrefCalled = true
    }
    queueMicrotask(() => {
      if (commands.length === 1) child.emit('error', new Error('not found'))
      else child.emit('spawn')
    })
    return child
  }
  await launchApp({ platform: 'linux', env: {}, home: '/home/test', spawnImpl })
  assert.equal(commands.length, 2)
  assert.equal(commands[0].options.detached, true)
  assert.equal(commands[0].options.stdio, 'ignore')
  assert.equal(unrefCalled, true)
})

test('Claude Desktop config paths follow native platform conventions', () => {
  assert.equal(
    claudeDesktopConfigPath({ platform: 'darwin', home: '/Users/test', env: {} }),
    '/Users/test/Library/Application Support/Claude/claude_desktop_config.json'
  )
  assert.equal(
    claudeDesktopConfigPath({
      platform: 'win32',
      home: 'C:\\Users\\test',
      env: { APPDATA: 'C:\\Users\\test\\AppData\\Roaming' }
    }),
    'C:\\Users\\test\\AppData\\Roaming\\Claude\\claude_desktop_config.json'
  )
  assert.equal(
    claudeDesktopConfigPath({
      platform: 'linux',
      home: '/home/test',
      env: { XDG_CONFIG_HOME: '/home/test/.config-custom' }
    }),
    '/home/test/.config-custom/Claude/claude_desktop_config.json'
  )
})

test('serverEntry only adds --port when it differs from the default', () => {
  assert.deepEqual(serverEntry({ platform: 'darwin' }), {
    command: 'npx',
    args: ['--yes', 'feishu-devtools-mcp@latest']
  })
  assert.deepEqual(serverEntry({ port: 18000, platform: 'darwin' }), {
    command: 'npx',
    args: ['--yes', 'feishu-devtools-mcp@latest', '--port', '18000']
  })
  assert.deepEqual(
    serverEntry({
      platform: 'win32',
      env: { ComSpec: 'C:\\Windows\\System32\\cmd.exe' }
    }),
    {
      command: 'C:\\Windows\\System32\\cmd.exe',
      args: ['/d', '/s', '/c', 'npx', '--yes', 'feishu-devtools-mcp@latest']
    }
  )
})

test('Windows CLI shims run through ComSpec with fixed argument tokens', () => {
  assert.deepEqual(
    cliInvocation('codex', ['mcp', 'list'], {
      platform: 'win32',
      env: { COMSPEC: 'C:\\Windows\\System32\\cmd.exe' }
    }),
    {
      command: 'C:\\Windows\\System32\\cmd.exe',
      args: ['/d', '/s', '/c', 'codex', 'mcp', 'list']
    }
  )
  assert.deepEqual(cliInvocation('codex', ['mcp', 'list'], { platform: 'linux', env: {} }), {
    command: 'codex',
    args: ['mcp', 'list']
  })
})

test('--project fails instead of being silently ignored by unsupported clients', async () => {
  await assert.rejects(
    install({ client: 'claude-desktop', project: true }),
    /supported only for cursor and claude-code/
  )
  await assert.rejects(
    install({ client: 'codex', project: true }),
    /supported only for cursor and claude-code/
  )
})

test('mergeJsonConfig keeps other servers and creates the file when missing', () => {
  const entry = serverEntry({ platform: 'darwin' })
  const fresh = JSON.parse(mergeJsonConfig('', entry))
  assert.deepEqual(fresh, { mcpServers: { 'feishu-devtools': entry } })
  const existing = JSON.stringify({
    mcpServers: { other: { url: 'http://x' }, 'feishu-devtools': { command: 'old' } },
    theme: 'dark'
  })
  const merged = JSON.parse(mergeJsonConfig(existing, entry))
  assert.deepEqual(merged, {
    mcpServers: { other: { url: 'http://x' }, 'feishu-devtools': entry },
    theme: 'dark'
  })
  assert.throws(() => mergeJsonConfig('[]', entry))
})

test('installer preserves JSON formatting and keeps an exact backup before atomic replacement', async (t) => {
  const home = mkdtempSync(join(tmpdir(), 'fdt-mcp-install-'))
  t.after(() => rmSync(home, { recursive: true, force: true }))
  const path = join(home, '.cursor', 'mcp.json')
  const original =
    '{\r\n\t"theme": "dark",\r\n\t"mcpServers": {\r\n\t\t"other": { "url": "http://127.0.0.1:9000" }\r\n\t}\r\n}\r\n'
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, original)

  const result = await install({ client: 'cursor', home, platform: 'linux', env: {} })
  const updated = readFileSync(path, 'utf8')
  assert.equal(readFileSync(`${path}.bak`, 'utf8'), original)
  assert.match(
    result,
    new RegExp(`Backup saved to ${path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.bak`)
  )
  assert.equal(updated.replaceAll('\r\n', '').includes('\n'), false)
  assert.match(updated, /^\{\r\n\t"theme"/)
  assert.deepEqual(JSON.parse(updated), {
    theme: 'dark',
    mcpServers: {
      other: { url: 'http://127.0.0.1:9000' },
      'feishu-devtools': serverEntry({ platform: 'linux', env: {} })
    }
  })
  assert.equal(
    readdirSync(dirname(path)).some((name) => name.endsWith('.tmp')),
    false
  )

  // Re-running an identical install is a no-op and must not replace the recovery copy.
  const second = await install({ client: 'cursor', home, platform: 'linux', env: {} })
  assert.equal(readFileSync(path, 'utf8'), updated)
  assert.equal(readFileSync(`${path}.bak`, 'utf8'), original)
  assert.doesNotMatch(second, /Backup saved/)
})

test('installer preserves a UTF-8 BOM in JSON configuration', async (t) => {
  const home = mkdtempSync(join(tmpdir(), 'fdt-mcp-install-bom-'))
  t.after(() => rmSync(home, { recursive: true, force: true }))
  const path = join(home, '.cursor', 'mcp.json')
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, '\uFEFF{\r\n  "theme": "dark"\r\n}\r\n')

  await install({ client: 'cursor', home, platform: 'win32', env: { ComSpec: 'cmd.exe' } })
  const updated = readFileSync(path, 'utf8')
  assert.equal(updated.startsWith('\uFEFF'), true)
  assert.deepEqual(JSON.parse(updated.slice(1)), {
    theme: 'dark',
    mcpServers: {
      'feishu-devtools': serverEntry({ platform: 'win32', env: { ComSpec: 'cmd.exe' } })
    }
  })
})

test(
  'installer updates a symbolic-link target without replacing the link',
  { skip: process.platform === 'win32' },
  async (t) => {
    const home = mkdtempSync(join(tmpdir(), 'fdt-mcp-install-link-'))
    t.after(() => rmSync(home, { recursive: true, force: true }))
    const managedDir = join(home, 'managed')
    const target = join(managedDir, 'cursor.json')
    const path = join(home, '.cursor', 'mcp.json')
    mkdirSync(managedDir, { recursive: true })
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(target, '{"theme":"dark"}\n')
    symlinkSync(target, path)

    const result = await install({ client: 'cursor', home, platform: 'linux', env: {} })
    assert.equal(lstatSync(path).isSymbolicLink(), true)
    assert.deepEqual(JSON.parse(readFileSync(target, 'utf8')), {
      theme: 'dark',
      mcpServers: {
        'feishu-devtools': serverEntry({ platform: 'linux', env: {} })
      }
    })
    assert.equal(readFileSync(`${target}.bak`, 'utf8'), '{"theme":"dark"}\n')
    assert.match(
      result,
      new RegExp(
        `Backup saved to ${realpathSync.native(target).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.bak`
      )
    )
  }
)

test('mergeCodexToml appends or replaces the server table without touching the rest', () => {
  const entry = serverEntry({ port: 18000, platform: 'darwin' })
  const appended = mergeCodexToml('model = "gpt-5"\n', entry)
  assert.equal(
    appended,
    'model = "gpt-5"\n\n[mcp_servers.feishu-devtools]\ncommand = "npx"\nargs = ["--yes", "feishu-devtools-mcp@latest", "--port", "18000"]\n'
  )
  const replaced = mergeCodexToml(
    '[mcp_servers.feishu-devtools]\ncommand = "old"\nargs = []\n\n[mcp_servers.other]\ncommand = "x"\n',
    serverEntry({ platform: 'darwin' })
  )
  assert.equal(
    replaced,
    '[mcp_servers.feishu-devtools]\ncommand = "npx"\nargs = ["--yes", "feishu-devtools-mcp@latest"]\n\n[mcp_servers.other]\ncommand = "x"\n'
  )
  assert.match(mergeCodexToml('', entry), /^\[mcp_servers\.feishu-devtools\]\n/)
})

test('mergeCodexToml ignores commented examples and replaces equivalent quoted tables', () => {
  const entry = serverEntry({ platform: 'darwin' })
  for (const header of [
    '[mcp_servers."feishu-devtools"]',
    '["mcp_servers".feishu-devtools]',
    "['mcp_servers'.'feishu-devtools']",
    '[ mcp_servers . "feishu-devtools" ]'
  ]) {
    const merged = mergeCodexToml(
      `# [mcp_servers.feishu-devtools]\n# command = "example"\n\n${header} # active\ncommand = "old"\nargs = []\n\n[mcp_servers.other]\ncommand = "x"\n`,
      entry
    )
    assert.equal((merged.match(/^\[mcp_servers\.feishu-devtools\]$/gm) ?? []).length, 1)
    assert.match(merged, /^# \[mcp_servers\.feishu-devtools\]$/m)
    assert.doesNotMatch(merged, /command = "old"/)
    assert.match(merged, /\n\n\[mcp_servers\.other\]\ncommand = "x"\n$/)
  }
})

test('mergeCodexToml does not treat a commented table as active configuration', () => {
  const merged = mergeCodexToml(
    '# [mcp_servers.feishu-devtools]\n# command = "example"\n',
    serverEntry({ platform: 'darwin' })
  )
  assert.match(merged, /^# \[mcp_servers\.feishu-devtools\]$/m)
  assert.equal((merged.match(/^\[mcp_servers\.feishu-devtools\]$/gm) ?? []).length, 1)
})

test('mergeCodexToml preserves CRLF in the surrounding config', () => {
  const merged = mergeCodexToml(
    'model = "gpt-5"\r\n\r\n[mcp_servers.feishu-devtools]\r\ncommand = "old"\r\nargs = []\r\n\r\n[mcp_servers.other]\r\ncommand = "x"\r\n',
    serverEntry({ platform: 'darwin' })
  )
  assert.equal(merged.replaceAll('\r\n', '').includes('\n'), false)
  assert.match(merged, /\r\n\r\n\[mcp_servers\.other\]\r\ncommand = "x"\r\n$/)
})

test('mergeCodexToml preserves a UTF-8 BOM without duplicating the target table', () => {
  const merged = mergeCodexToml(
    '\uFEFF[mcp_servers.feishu-devtools]\r\ncommand = "old"\r\nargs = []\r\n',
    serverEntry({ platform: 'win32', env: { ComSpec: 'cmd.exe' } })
  )
  assert.equal(merged.startsWith('\uFEFF'), true)
  assert.equal((merged.match(/\[mcp_servers\.feishu-devtools\]/g) ?? []).length, 1)
  assert.doesNotMatch(merged, /command = "old"/)
  assert.equal(merged.slice(1).replaceAll('\r\n', '').includes('\n'), false)
})

test('runBridge returns one error only for unfinished ids when an SSE stream is interrupted', async (t) => {
  async function* body() {
    yield Buffer.from('data: {"jsonrpc":"2.0","id":1,"result":{"ok":true}}\n\n')
    throw new Error('socket reset')
  }
  t.mock.method(globalThis, 'fetch', async () => ({
    status: 200,
    ok: true,
    headers: new Headers({ 'content-type': 'text/event-stream' }),
    body: body()
  }))
  const { messages, logs } = await bridgeExchange([
    { jsonrpc: '2.0', id: 1, method: 'tools/list' },
    { jsonrpc: '2.0', id: 2, method: 'tools/call', params: {} }
  ])

  assert.deepEqual(messages[0], { jsonrpc: '2.0', id: 1, result: { ok: true } })
  assert.equal(messages.filter((message) => message.id === 1 && message.error).length, 0)
  const failures = messages.filter((message) => message.id === 2)
  assert.equal(failures.length, 1)
  assert.equal(failures[0].error.code, -32000)
  assert.match(failures[0].error.message, /interrupted.*socket reset/)
  assert.match(logs.join('\n'), /SSE response failed:.*socket reset/s)
})

test('runBridge returns one -32000 response for a successful non-JSON HTTP body', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => ({
    status: 200,
    ok: true,
    headers: new Headers({ 'content-type': 'text/html' }),
    text: async () => '<html>not json</html>'
  }))
  const { messages, logs } = await bridgeExchange({
    jsonrpc: '2.0',
    id: 'request-1',
    method: 'tools/list'
  })

  assert.equal(messages.length, 1)
  assert.equal(messages[0].id, 'request-1')
  assert.equal(messages[0].error.code, -32000)
  assert.match(messages[0].error.message, /Non-JSON response/)
  assert.match(logs.join('\n'), /non-JSON response body/)
})

test('runBridge rejects empty success statuses for requests but stays quiet for notifications', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => ({
    status: 202,
    ok: true,
    headers: new Headers()
  }))
  const request = await bridgeExchange({
    jsonrpc: '2.0',
    id: 'request-202',
    method: 'tools/list'
  })
  const notification = await bridgeExchange({
    jsonrpc: '2.0',
    method: 'notifications/initialized'
  })

  assert.equal(request.messages.length, 1)
  assert.equal(request.messages[0].id, 'request-202')
  assert.equal(request.messages[0].error.code, -32000)
  assert.match(request.messages[0].error.message, /HTTP 202.*no JSON-RPC response/)
  assert.deepEqual(notification.messages, [])
})

test('runBridge times out stalled SSE bodies without answering notifications', async (t) => {
  let fetchSignal
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    fetchSignal = init.signal
    return {
      status: 200,
      ok: true,
      headers: new Headers({ 'content-type': 'text/event-stream' }),
      body: {
        async *[Symbol.asyncIterator]() {
          await new Promise((resolve, reject) => {
            fetchSignal.addEventListener('abort', () => reject(fetchSignal.reason), { once: true })
          })
        }
      }
    }
  })

  const { messages } = await bridgeExchange(
    [
      { jsonrpc: '2.0', id: 9, method: 'tools/list' },
      { jsonrpc: '2.0', method: 'notifications/initialized' }
    ],
    { requestTimeoutMs: 10 }
  )

  assert.equal(fetchSignal.aborted, true)
  assert.equal(messages.length, 1)
  assert.equal(messages[0].id, 9)
  assert.equal(messages[0].error.code, -32000)
  assert.match(messages[0].error.message, /timed out after 10ms/)
})

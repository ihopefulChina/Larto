#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { DEFAULT_PORT, DOWNLOAD_URL, endpoint, ensureApp } from './src/app.mjs'
import { runBridge } from './src/bridge.mjs'
import { CLIENTS, SERVER_NAME, install, serverEntry } from './src/install.mjs'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))
const log = (msg) => process.stderr.write(`[larto-mcp] ${msg}\n`)

const HELP = `larto-mcp ${pkg.version}
stdio bridge to the MCP server inside Larto (http://127.0.0.1:${DEFAULT_PORT}/mcp).

Usage
  larto-mcp [--port <n>] [--no-launch]     run as an MCP stdio server
  larto-mcp install <client> [--project] [--port <n>]
                                                     register with a client (${CLIENTS.join(', ')})
  larto-mcp print [--port <n>]             print the JSON config entry instead of writing it

Options
  --port <n>     MCP port configured in Larto → Settings (default ${DEFAULT_PORT})
  --no-launch    fail instead of starting Larto when it is not running
  --project      use project scope (Cursor and Claude Code only)
  -h, --help     show this help
  -v, --version  print the version

Larto itself: ${DOWNLOAD_URL}
`

function parse(argv) {
  const opts = {
    port: Number(process.env.LARTO_MCP_PORT) || DEFAULT_PORT,
    launch: true,
    project: false
  }
  const positional = []
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--port') {
      const v = Number(argv[++i])
      if (!Number.isInteger(v) || v < 1 || v > 65535) throw new Error(`invalid --port ${argv[i]}`)
      opts.port = v
    } else if (a.startsWith('--port=')) {
      const v = Number(a.slice(7))
      if (!Number.isInteger(v) || v < 1 || v > 65535) throw new Error(`invalid ${a}`)
      opts.port = v
    } else if (a === '--no-launch') opts.launch = false
    else if (a === '--project') opts.project = true
    else if (a === '-h' || a === '--help') opts.help = true
    else if (a === '-v' || a === '--version') opts.version = true
    else if (a.startsWith('-')) throw new Error(`unknown option ${a}`)
    else positional.push(a)
  }
  return { opts, positional }
}

async function main() {
  const { opts, positional } = parse(process.argv.slice(2))
  if (opts.help) return process.stdout.write(HELP)
  if (opts.version) return process.stdout.write(pkg.version + '\n')
  const [command, ...rest] = positional
  if (command === 'install') {
    const client = rest[0]
    if (!client) throw new Error(`install needs a client: ${CLIENTS.join(', ')}`)
    const summary = await install({ client, port: opts.port, project: opts.project })
    process.stdout.write(summary + '\n')
    return
  }
  if (command === 'print') {
    process.stdout.write(
      JSON.stringify({ mcpServers: { [SERVER_NAME]: serverEntry({ port: opts.port }) } }, null, 2) +
        '\n'
    )
    return
  }
  if (command) throw new Error(`unknown command "${command}"\n\n${HELP}`)

  // Default: act as a stdio MCP server for the client that spawned us.
  const health = await ensureApp({ port: opts.port, launch: opts.launch, log })
  log(`connected to Larto ${health.version} at ${endpoint(opts.port)}`)
  await runBridge({ url: endpoint(opts.port), log })
}

main().catch((err) => {
  log(err.message ?? String(err))
  process.exit(1)
})

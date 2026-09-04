import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve, win32 } from 'node:path'
import { DEFAULT_PORT } from './app.mjs'

export const SERVER_NAME = 'feishu-devtools'
export const CLIENTS = ['cursor', 'claude-code', 'claude-desktop', 'codex']

function commandShell(env) {
  return env.ComSpec || env.COMSPEC || 'cmd.exe'
}

/** Execute a PATH-resolved CLI safely on Windows, where `.cmd` shims need `cmd.exe`. */
export function cliInvocation(
  command,
  args,
  { platform = process.platform, env = process.env } = {}
) {
  return platform === 'win32'
    ? { command: commandShell(env), args: ['/d', '/s', '/c', command, ...args] }
    : { command, args }
}

/** The registry-backed stdio entry every client gets: `npx --yes feishu-devtools-mcp@latest`. */
export function serverEntry({
  port = DEFAULT_PORT,
  platform = process.platform,
  env = process.env
} = {}) {
  const npxArgs = ['--yes', 'feishu-devtools-mcp@latest']
  if (port !== DEFAULT_PORT) npxArgs.push('--port', String(port))
  return cliInvocation('npx', npxArgs, { platform, env })
}

/** Native Claude Desktop config location for each supported desktop platform. */
export function claudeDesktopConfigPath({
  platform = process.platform,
  home = homedir(),
  env = process.env
} = {}) {
  if (platform === 'darwin')
    return join(home, 'Library/Application Support/Claude/claude_desktop_config.json')
  if (platform === 'win32') {
    const appData = env.APPDATA || win32.join(home, 'AppData', 'Roaming')
    return win32.join(appData, 'Claude', 'claude_desktop_config.json')
  }
  const configHome = env.XDG_CONFIG_HOME || join(home, '.config')
  return join(configHome, 'Claude', 'claude_desktop_config.json')
}

/** Merge `mcpServers[SERVER_NAME]` into a JSON config file, creating it when missing. */
export function mergeJsonConfig(text, entry) {
  const source = text ?? ''
  const bom = source.startsWith('\uFEFF') ? '\uFEFF' : ''
  const json = bom ? source.slice(1) : source
  let config = {}
  if (json.trim()) {
    config = JSON.parse(json)
    if (typeof config !== 'object' || config === null || Array.isArray(config))
      throw new Error('config root is not an object')
  }
  const servers =
    typeof config.mcpServers === 'object' && config.mcpServers !== null ? config.mcpServers : {}
  config.mcpServers = { ...servers, [SERVER_NAME]: entry }
  const eol = source.includes('\r\n') ? '\r\n' : '\n'
  const multiline = /\r?\n/.test(source)
  const indentation = multiline ? (source.match(/^[ \t]+(?=")/m)?.[0] ?? 2) : source.trim() ? 0 : 2
  const trailingEol = source.trim() ? (source.endsWith('\n') ? eol : '') : eol
  return bom + JSON.stringify(config, null, indentation).replace(/\n/g, eol) + trailingEol
}

/** Append (or replace) the `[mcp_servers.feishu-devtools]` table in a Codex `config.toml`. */
export function mergeCodexToml(text, entry) {
  const source = text ?? ''
  const bom = source.startsWith('\uFEFF') ? '\uFEFF' : ''
  const src = bom ? source.slice(1) : source
  const eol = src.includes('\r\n') ? '\r\n' : '\n'
  const header = `[mcp_servers.${SERVER_NAME}]`
  const table = [
    header,
    `command = ${JSON.stringify(entry.command)}`,
    `args = [${entry.args.map((a) => JSON.stringify(a)).join(', ')}]`,
    ''
  ].join(eol)
  const key = (value) => `(?:${value}|"${value}"|'${value}')`
  const targetHeader = new RegExp(
    `^[ \\t]*\\[[ \\t]*${key('mcp_servers')}[ \\t]*\\.[ \\t]*${key(SERVER_NAME)}[ \\t]*\\][ \\t]*(?:#[^\\r\\n]*)?\\r?$`,
    'm'
  )
  const match = targetHeader.exec(src)
  if (!match)
    return bom + (src.trimEnd() + (src.trim() ? eol + eol : '') + table).replace(/^(?:\r?\n)+/, '')

  // Replace the active table (quoted and bare keys are equivalent in TOML). Anchoring the match at
  // the first non-whitespace character prevents a commented example from being treated as config.
  const start = match.index
  const afterHeader = start + match[0].length
  const rest = src.slice(afterHeader)
  const next = rest.search(/^[ \t]*\[\[?[^\r\n]*\]\]?[ \t]*(?:#[^\r\n]*)?\r?$/m)
  const end = next === -1 ? src.length : afterHeader + next
  const suffix = src.slice(end)
  return bom + src.slice(0, start) + table.trimEnd() + (suffix ? eol + eol + suffix : eol)
}

function atomicWrite(path, contents, mode) {
  const temp = join(dirname(path), `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`)
  try {
    writeFileSync(temp, contents, { flag: 'wx', mode })
    renameSync(temp, path)
  } finally {
    rmSync(temp, { force: true })
  }
}

function resolveConfigTarget(path) {
  let entry
  try {
    entry = lstatSync(path)
  } catch (err) {
    if (err?.code === 'ENOENT') return path
    throw err
  }
  if (!entry.isSymbolicLink()) return path
  try {
    const target = realpathSync.native(path)
    if (!statSync(target).isFile()) throw new Error('target is not a regular file')
    return target
  } catch (err) {
    throw new Error(`Refusing to replace symbolic-link config ${path}: ${err.message}`)
  }
}

/**
 * Read, merge and replace one client config. Existing bytes are copied to a predictable sibling
 * backup before the atomic rename; neither the original nor its contents are emitted to stdout.
 */
function updateConfigFile(path, merge) {
  mkdirSync(dirname(path), { recursive: true })
  // Preserve dotfile-managed symlinks by atomically replacing their resolved file target.
  const target = resolveConfigTarget(path)
  const existed = existsSync(target)
  const original = existed ? readFileSync(target) : null
  const current = original?.toString('utf8') ?? ''
  const next = merge(current)
  if (existed && next === current) return undefined

  const mode = existed ? statSync(target).mode & 0o777 : 0o600
  let backupPath
  if (original) {
    backupPath = `${target}.bak`
    atomicWrite(backupPath, original, mode)
  }
  atomicWrite(target, next, mode)
  return backupPath
}

function backupSummary(path) {
  return path ? ` Backup saved to ${path}.` : ''
}

function run(cmd, args) {
  return new Promise((resolveRun, reject) => {
    execFile(cmd, args, (err, stdout, stderr) =>
      err ? reject(Object.assign(err, { stderr })) : resolveRun(stdout)
    )
  })
}

function isCommandMissing(err) {
  if (err?.code === 'ENOENT') return true
  return /(?:not recognized|not found|不是内部或外部命令)/i.test(String(err?.stderr ?? ''))
}

/**
 * Register the server with one client. Returns a human-readable summary of what was done.
 * @param {{ client: string, port?: number, project?: boolean, home?: string, cwd?: string, platform?: NodeJS.Platform, env?: NodeJS.ProcessEnv }} opts
 */
export async function install({
  client,
  port = DEFAULT_PORT,
  project = false,
  home = homedir(),
  cwd = process.cwd(),
  platform = process.platform,
  env = process.env
}) {
  const entry = serverEntry({ port, platform, env })
  if (project && client !== 'cursor' && client !== 'claude-code') {
    throw new Error(`--project is supported only for cursor and claude-code (received ${client})`)
  }
  switch (client) {
    case 'cursor': {
      const path = project ? resolve(cwd, '.cursor/mcp.json') : join(home, '.cursor/mcp.json')
      const backup = updateConfigFile(path, (text) => mergeJsonConfig(text, entry))
      return `Added "${SERVER_NAME}" to ${path}. Cursor picks it up immediately (Settings → MCP shows it).${backupSummary(backup)}`
    }
    case 'claude-desktop': {
      const path = claudeDesktopConfigPath({ platform, home, env })
      const backup = updateConfigFile(path, (text) => mergeJsonConfig(text, entry))
      return `Added "${SERVER_NAME}" to ${path}. Restart Claude Desktop.${backupSummary(backup)}`
    }
    case 'claude-code': {
      const args = [
        'mcp',
        'add',
        '--scope',
        project ? 'project' : 'user',
        SERVER_NAME,
        '--',
        entry.command,
        ...entry.args
      ]
      try {
        const invocation = cliInvocation('claude', args, { platform, env })
        await run(invocation.command, invocation.args)
        return `Registered "${SERVER_NAME}" with Claude Code (claude ${args.join(' ')}).`
      } catch (err) {
        if (isCommandMissing(err))
          throw new Error(
            `The \`claude\` CLI is not on PATH. Run manually:\n  claude ${args.join(' ')}`
          )
        throw new Error(`claude mcp add failed: ${err.stderr || err.message}`)
      }
    }
    case 'codex': {
      const args = ['mcp', 'add', SERVER_NAME, '--', entry.command, ...entry.args]
      try {
        const invocation = cliInvocation('codex', args, { platform, env })
        await run(invocation.command, invocation.args)
        return `Registered "${SERVER_NAME}" with Codex (codex ${args.join(' ')}).`
      } catch (err) {
        if (!isCommandMissing(err))
          throw new Error(`codex mcp add failed: ${err.stderr || err.message}`)
        const path = join(home, '.codex/config.toml')
        const backup = updateConfigFile(path, (text) => mergeCodexToml(text, entry))
        return `Added [mcp_servers.${SERVER_NAME}] to ${path}. Restart Codex.${backupSummary(backup)}`
      }
    }
    default:
      throw new Error(`Unknown client "${client}". Expected one of: ${CLIENTS.join(', ')}.`)
  }
}

import { spawn } from 'node:child_process'
import { homedir } from 'node:os'
import { posix, win32 } from 'node:path'

export const DEFAULT_PORT = 17331
export const BUNDLE_ID = 'app.ihopeful.Larto'
export const DOWNLOAD_URL = 'https://github.com/ihopefulChina/Larto/releases/latest'
export const APP_EXECUTABLE = 'Larto'

export function endpoint(port) {
  return `http://127.0.0.1:${port}/mcp`
}

/** @returns {Promise<{ ok: boolean, version?: string, attached?: boolean }>} */
export async function health(port) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`, {
      signal: AbortSignal.timeout(1500)
    })
    if (!res.ok) return { ok: false }
    const body = await res.json()
    return { ok: true, version: body.version, attached: !!body.guest?.attached }
  } catch {
    return { ok: false }
  }
}

/**
 * Ordered, platform-native ways to start an installed build. The explicit environment override
 * also covers portable archives and non-default install locations without invoking a shell.
 */
export function launchCandidates({
  platform = process.platform,
  env = process.env,
  home = homedir()
} = {}) {
  const candidates = []
  const override = env.LARTO_PATH?.trim()
  if (override) candidates.push({ command: override, args: [] })

  if (platform === 'darwin') {
    candidates.push({ command: 'open', args: ['-g', '-b', BUNDLE_ID] })
  } else if (platform === 'win32') {
    const roots = [
      env.LOCALAPPDATA && win32.join(env.LOCALAPPDATA, 'Programs'),
      env.ProgramFiles,
      env['ProgramFiles(x86)']
    ].filter(Boolean)
    for (const root of roots) {
      candidates.push({
        command: win32.join(root, APP_EXECUTABLE, `${APP_EXECUTABLE}.exe`),
        args: []
      })
    }
    candidates.push({ command: `${APP_EXECUTABLE}.exe`, args: [] })
  } else if (platform === 'linux') {
    candidates.push(
      { command: posix.join(home, '.local', 'bin', 'larto'), args: [] },
      { command: '/usr/local/bin/larto', args: [] },
      { command: '/usr/bin/larto', args: [] },
      { command: '/opt/Larto/larto', args: [] },
      { command: 'larto', args: [] },
      { command: APP_EXECUTABLE, args: [] }
    )
  }

  return candidates.filter(
    (candidate, index, all) =>
      all.findIndex(
        (other) =>
          other.command === candidate.command && other.args.join('\0') === candidate.args.join('\0')
      ) === index
  )
}

function spawnDetached(candidate, spawnImpl) {
  return new Promise((resolve, reject) => {
    const child = spawnImpl(candidate.command, candidate.args, {
      detached: true,
      stdio: 'ignore',
      windowsHide: true
    })
    let settled = false
    child.once('spawn', () => {
      if (settled) return
      settled = true
      child.unref()
      resolve()
    })
    child.once('error', (err) => {
      if (settled) return
      settled = true
      reject(err)
    })
  })
}

/** Launch the installed app without going through a command shell. */
export async function launchApp(options = {}) {
  const candidates = launchCandidates(options)
  let lastError = null
  for (const candidate of candidates) {
    try {
      await spawnDetached(candidate, options.spawnImpl ?? spawn)
      return
    } catch (err) {
      lastError = err
    }
  }
  throw (
    lastError ??
    new Error(`Larto auto-launch is unsupported on ${options.platform ?? process.platform}`)
  )
}

/**
 * Make sure the app is up and its simulator is attached. Starts the app when nothing answers on
 * `port` (unless `launch` is false). Resolves with the health payload, rejects with a message
 * suitable for the user.
 */
export async function ensureApp({ port, launch = true, timeoutMs = 45_000, log = () => {} }) {
  let h = await health(port)
  if (!h.ok) {
    if (!launch) throw new Error(`Larto is not running on 127.0.0.1:${port}.`)
    log('Larto is not running; launching the installed app…')
    try {
      await launchApp()
    } catch {
      throw new Error(
        `Larto is not installed or could not be started. Download it from ${DOWNLOAD_URL}` +
          ' or set LARTO_PATH to the executable.'
      )
    }
  }
  const deadline = Date.now() + timeoutMs
  while (!(h.ok && h.attached)) {
    if (Date.now() > deadline) {
      throw new Error(
        h.ok
          ? `Larto is running but the simulator did not attach within ${timeoutMs / 1000}s.`
          : `Larto did not start listening on 127.0.0.1:${port} within ${timeoutMs / 1000}s. ` +
              'Check that the MCP server is enabled in Settings and the port matches.'
      )
    }
    await new Promise((r) => setTimeout(r, 400))
    h = await health(port)
  }
  return h
}

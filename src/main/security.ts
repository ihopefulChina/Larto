interface ChromiumCommandLine {
  hasSwitch(name: string): boolean
}

/** Chromium's sandbox opt-outs disable the renderer isolation promised by this application. */
export function hasSandboxOptOut(
  args: readonly string[] = process.argv,
  env: NodeJS.ProcessEnv = process.env,
  commandLine?: ChromiumCommandLine
): boolean {
  return (
    Object.prototype.hasOwnProperty.call(env, 'ELECTRON_DISABLE_SANDBOX') ||
    commandLine?.hasSwitch('no-sandbox') === true ||
    args.some((arg) => arg === '--no-sandbox' || arg.startsWith('--no-sandbox='))
  )
}

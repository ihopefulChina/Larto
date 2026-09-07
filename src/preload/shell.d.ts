import type { ShellBridge } from './shell'

declare global {
  interface Window {
    larto: ShellBridge
  }
}

export {}

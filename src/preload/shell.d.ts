import type { ShellBridge } from './shell'

declare global {
  interface Window {
    fdt: ShellBridge
  }
}

export {}

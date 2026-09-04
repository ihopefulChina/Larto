/**
 * Device catalogue for the simulator. Mirrors the official tool's list
 * (`feishu-devtools-core/libs/modules/simulator/common/common.js`, see
 * docs/RESEARCH_OFFICIAL_TOOL.md §3). Dimensions are CSS pixels.
 */
export type DevicePlatform = 'ios' | 'android' | 'pc'

export interface DeviceSpec {
  /** Stable identifier persisted in settings and exposed via MCP. */
  id: string
  /** Display name, identical to the official tool's dropdown labels. */
  name: string
  width: number
  height: number
  /** Height of the simulated status bar in CSS px (0 for PC). */
  statusBarHeight: number
  dpr: number
  platform: DevicePlatform
  /** Human readable OS label, e.g. "iOS 14.2.0". */
  system: string
  notch: boolean
  homeIndicator: boolean
}

const ios = (
  id: string,
  name: string,
  width: number,
  height: number,
  statusBarHeight: number,
  dpr: number,
  notch: boolean,
  homeIndicator: boolean,
  system = 'iOS 14.2.0'
): DeviceSpec => ({
  id,
  name,
  width,
  height,
  statusBarHeight,
  dpr,
  platform: 'ios',
  system,
  notch,
  homeIndicator
})

export const DEVICES: readonly DeviceSpec[] = [
  ios('iphone-13', 'iPhone 13/13 Pro/14', 390, 844, 47, 3, true, true),
  ios('iphone-14-pro', 'iPhone 14 Pro', 393, 852, 54, 3, true, true),
  ios('iphone-14-pro-max', 'iPhone 14 Pro Max', 430, 932, 54, 3, true, true),
  // Official catalogue stops at 14 (tool last shipped 2022). Extra presets for current H5 work.
  ios('iphone-15', 'iPhone 15/15 Pro', 393, 852, 54, 3, true, true, 'iOS 17.0.0'),
  ios('iphone-15-plus', 'iPhone 15 Plus/15 Pro Max', 430, 932, 54, 3, true, true, 'iOS 17.0.0'),
  ios('iphone-16', 'iPhone 16', 393, 852, 54, 3, true, true, 'iOS 18.0.0'),
  ios('iphone-16-plus', 'iPhone 16 Plus', 430, 932, 54, 3, true, true, 'iOS 18.0.0'),
  ios('iphone-16-pro', 'iPhone 16 Pro', 402, 874, 59, 3, true, true, 'iOS 18.0.0'),
  ios('iphone-17-pro', 'iPhone 17 Pro', 402, 874, 59, 3, true, true, 'iOS 26.0.0'),
  ios(
    'iphone-16-pro-max',
    'iPhone 16 Pro Max/17 Pro Max',
    440,
    956,
    62,
    3,
    true,
    true,
    'iOS 18.0.0'
  ),
  ios('iphone-air', 'iPhone Air', 420, 912, 59, 3, true, true, 'iOS 18.0.0'),
  ios('iphone-13-mini', 'iPhone 13 mini', 375, 812, 50, 3, true, true),
  ios('iphone-13-pro-max', 'iPhone 13 Pro Max/14+', 428, 926, 47, 3, true, true),
  ios('iphone-12', 'iPhone 12/12 Pro', 390, 844, 47, 3, true, true),
  ios('iphone-12-mini', 'iPhone 12 mini', 375, 812, 50, 3, true, true),
  ios('iphone-12-pro-max', 'iPhone 12 Pro Max', 428, 926, 47, 3, true, true),
  ios('iphone-x', 'iPhone X/XS/11 Pro', 375, 812, 44, 3, true, true),
  ios('iphone-11', 'iPhone 11/XR', 414, 896, 48, 2, true, true),
  ios('iphone-xs-max', 'iPhone XS Max/11 Pro Max', 414, 896, 44, 3, true, true),
  ios('iphone-8', 'iPhone 6/6s/7/8/SE', 375, 667, 16, 2, false, false, 'iOS 10.0.1'),
  ios('iphone-8-plus', 'iPhone 6 +/6s +/7 +/8 +', 414, 736, 16, 3, false, false),
  {
    id: 'nexus-5',
    name: 'Nexus 5',
    width: 360,
    height: 640,
    statusBarHeight: 16,
    dpr: 3,
    platform: 'android',
    system: 'Android 10.0.1',
    notch: false,
    homeIndicator: false
  },
  {
    id: 'nexus-5x',
    name: 'Nexus 5x',
    width: 411,
    height: 731,
    statusBarHeight: 16,
    dpr: 2.6,
    platform: 'android',
    system: 'Android 10.0.1',
    notch: false,
    homeIndicator: false
  },
  {
    id: 'nexus-6',
    name: 'Nexus 6',
    width: 412,
    height: 732,
    statusBarHeight: 16,
    dpr: 3.5,
    platform: 'android',
    system: 'Android 10.0.1',
    notch: false,
    homeIndicator: false
  },
  ios('ipad-pro', 'iPad Pro', 1024, 1366, 16, 2, false, true),
  ios('ipad', 'iPad / iPad mini', 768, 1024, 16, 2, false, false),
  {
    id: 'pc-mac',
    name: 'PC',
    width: 900,
    height: 866,
    statusBarHeight: 0,
    dpr: 2,
    platform: 'pc',
    system: 'Mac OS X 10_15_7',
    notch: false,
    homeIndicator: false
  },
  {
    id: 'pc-windows',
    name: 'PC(window)',
    width: 900,
    height: 866,
    statusBarHeight: 0,
    dpr: 2,
    platform: 'pc',
    system: 'Windows 10',
    notch: false,
    homeIndicator: false
  }
]

export const DEFAULT_DEVICE_ID = 'iphone-17-pro'

export const ZOOM_LEVELS: readonly number[] = [50, 75, 85, 100, 125, 150]
export const DEFAULT_ZOOM = 100

/** Simulator chrome heights in CSS px (see renderer Simulator/StatusBar/NavBar). */
export const SIM_NAV_BAR_HEIGHT = 44
export const SIM_HOME_INDICATOR_HEIGHT = 20
export const SIM_STATUS_BAR_MIN_HEIGHT = 20

/** CSS size of the guest <webview> for a device: the area left for the page inside the frame. */
export function guestViewport(device: DeviceSpec): { width: number; height: number } {
  if (device.platform === 'pc') return { width: device.width, height: device.height }
  const status = device.notch ? device.statusBarHeight : SIM_STATUS_BAR_MIN_HEIGHT
  // The page extends behind the home-indicator safe area; only bars above the page consume height.
  return { width: device.width, height: device.height - status - SIM_NAV_BAR_HEIGHT }
}

export function findDevice(id: string | undefined): DeviceSpec {
  return (
    DEVICES.find((device) => device.id === id) ??
    DEVICES.find((device) => device.id === DEFAULT_DEVICE_ID)!
  )
}

/**
 * Corner radius of the simulated screen in CSS px. Notch iPhones have display corners that
 * are, to within a couple of points, as large as their status bar (iPhone 13: 47, 14 Pro: 55);
 * rounded iPads use ~18; the remaining phones/tablets get a modest radius so the frame still
 * reads as a device rather than a bare rectangle; PC is a window.
 */
export function deviceCornerRadius(device: DeviceSpec): number {
  if (device.platform === 'pc') return 8
  if (device.notch) return device.statusBarHeight
  if (device.id === 'ipad-pro') return 18
  return 12
}

/** Horizontal inset so status-bar clock/icons sit inside the display corner, not on the curve. */
export function statusBarInset(device: DeviceSpec): number {
  if (!device.notch) return 14
  return Math.max(20, Math.round(deviceCornerRadius(device) * 0.48))
}

/**
 * 14 Pro and later use a Dynamic Island (statusBarHeight 54+). Older notched iPhones keep
 * the hanging tongue. Android / iPad / 8-era phones have neither.
 */
export function deviceHasIsland(device: DeviceSpec): boolean {
  return device.notch && device.statusBarHeight >= 54
}

/** Coarse grouping for the simulator device menu (iPhone / Android / iPad / PC). */
export function deviceMenuGroup(device: DeviceSpec): 'iphone' | 'android' | 'ipad' | 'pc' {
  if (device.platform === 'pc') return 'pc'
  if (device.platform === 'android') return 'android'
  if (device.id.startsWith('ipad')) return 'ipad'
  return 'iphone'
}

export const PC_SIZE_MIN = 320
export const PC_SIZE_MAX = 2560

export function clampPcSize(n: number, fallback: number): number {
  if (!Number.isFinite(n)) return fallback
  return Math.min(PC_SIZE_MAX, Math.max(PC_SIZE_MIN, Math.round(n)))
}

/**
 * Lark client version advertised in the UA. The official JSSDK sniffs
 * `Lark/x.y.z` to decide it is running inside a Feishu container.
 */
export const LARK_UA_VERSION = '3.44.0'

/** Convert `iOS 17.0.0` to the UA forms `17_0` and `17.0`. */
function iosUserAgentVersion(system: string): { os: string; version: string } {
  const matched = /^iOS\s+(\d+(?:\.\d+){1,2})$/i.exec(system.trim())?.[1] ?? '14.2'
  const parts = matched.split('.')
  // Safari normally omits a zero patch component (`14.2.0` -> `14.2`) while retaining a
  // meaningful patch (`10.0.1`). Keep at least major.minor so both UA tokens remain valid.
  if (parts.length === 3 && parts[2] === '0') parts.pop()
  const version = parts.join('.')
  return { os: parts.join('_'), version }
}

/**
 * User agents exactly as used by the official renderer (§3): the JSSDK picks
 * its bridge by looking for `iPhone` (WebViewJavascriptBridge), `Macintosh`
 * (__LarkPCSDK__) or anything else (LkWebViewJavascriptBridge).
 */
export function buildUserAgent(device: DeviceSpec, locale: 'zh_CN' | 'en_US'): string {
  const lark = `Lark/${LARK_UA_VERSION} LarkLocale/${locale}`
  switch (device.platform) {
    case 'ios': {
      const iosVersion = iosUserAgentVersion(device.system)
      return `Mozilla/5.0 (iPhone; CPU iPhone OS ${iosVersion.os} like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/${iosVersion.version} Mobile/15E148 Safari/604.1 ${lark}`
    }
    case 'android':
      return `Mozilla/5.0 (Linux; Android 10; ${device.name}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Mobile Safari/537.36 ${lark}`
    case 'pc':
      return device.id === 'pc-windows'
        ? `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Safari/537.36 ${lark} Electron/Native`
        : `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Safari/537.36 ${lark} Electron/Native`
  }
}

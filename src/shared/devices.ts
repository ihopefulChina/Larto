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

export const DEFAULT_DEVICE_ID = DEVICES[0]!.id

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
  const home = device.homeIndicator ? SIM_HOME_INDICATOR_HEIGHT : 0
  return { width: device.width, height: device.height - status - SIM_NAV_BAR_HEIGHT - home }
}

export function findDevice(id: string | undefined): DeviceSpec {
  return DEVICES.find((d) => d.id === id) ?? DEVICES[0]!
}

/**
 * Lark client version advertised in the UA. The official JSSDK sniffs
 * `Lark/x.y.z` to decide it is running inside a Feishu container.
 */
export const LARK_UA_VERSION = '3.44.0'

/**
 * User agents exactly as used by the official renderer (§3): the JSSDK picks
 * its bridge by looking for `iPhone` (WebViewJavascriptBridge), `Macintosh`
 * (__LarkPCSDK__) or anything else (LkWebViewJavascriptBridge).
 */
export function buildUserAgent(device: DeviceSpec, locale: 'zh_CN' | 'en_US'): string {
  const lark = `Lark/${LARK_UA_VERSION} LarkLocale/${locale}`
  switch (device.platform) {
    case 'ios':
      return `Mozilla/5.0 (iPhone; CPU iPhone OS 14_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.2 Mobile/15E148 Safari/604.1 ${lark}`
    case 'android':
      return `Mozilla/5.0 (Linux; Android 10; ${device.name}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Mobile Safari/537.36 ${lark}`
    case 'pc':
      return device.id === 'pc-windows'
        ? `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Safari/537.36 ${lark} Electron/Native`
        : `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Safari/537.36 ${lark} Electron/Native`
  }
}

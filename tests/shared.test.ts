import { describe, expect, it } from 'vitest'
import {
  DEVICES,
  DEFAULT_DEVICE_ID,
  ZOOM_LEVELS,
  buildUserAgent,
  deviceHasIsland,
  deviceMenuGroup,
  findDevice,
  guestViewport,
  statusBarInset
} from '../src/shared/devices'
import { JSAPI_ERROR, classifyJsapi, failMsg, jsapiFail, okMsg } from '../src/shared/jsapi'
import { displayUrl, isDefaultPage, normalizeUrl } from '../src/shared/url'
import { resolveLanguage, translate } from '../src/shared/i18n'

describe('url', () => {
  it('normalises address bar input like the official tool', () => {
    expect(normalizeUrl('  ')).toBeNull()
    expect(normalizeUrl('example.com/h5')).toBe('http://example.com/h5')
    expect(normalizeUrl('https://a.b/c?d=1')).toBe('https://a.b/c?d=1')
    expect(normalizeUrl('localhost:5173')).toBe('http://localhost:5173')
    expect(normalizeUrl('127.0.0.1:8080/a')).toBe('http://127.0.0.1:8080/a')
    expect(normalizeUrl('about:blank')).toBe('about:blank')
    expect(normalizeUrl('file:///tmp/a.html')).toBe('file:///tmp/a.html')
    expect(normalizeUrl('x'.repeat(3000))!.length).toBeLessThanOrEqual(2048 + 'http://'.length)
  })
  it('rejects malformed addresses instead of persisting them to history', () => {
    expect(normalizeUrl('http://')).toBeNull()
    expect(normalizeUrl('https://exa mple.com')).toBeNull()
  })
  it('hides default pages and about:blank', () => {
    expect(displayUrl('about:blank')).toBe('')
    expect(displayUrl('')).toBe('')
    expect(isDefaultPage('not a url')).toBe(false)
    expect(displayUrl('https://open.feishu.cn/')).toBe('https://open.feishu.cn/')
  })
})

describe('devices', () => {
  it('has unique ids and a valid default', () => {
    const ids = DEVICES.map((d) => d.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(DEFAULT_DEVICE_ID).toBe('iphone-17-pro')
    expect(findDevice(DEFAULT_DEVICE_ID).id).toBe(DEFAULT_DEVICE_ID)
    expect(findDevice('nope').id).toBe(DEFAULT_DEVICE_ID)
    expect(findDevice(undefined).id).toBe(DEFAULT_DEVICE_ID)
    expect(ZOOM_LEVELS).toContain(100)
  })
  it('models the default iPhone 17 Pro screen and safe-area viewport', () => {
    const device = findDevice(DEFAULT_DEVICE_ID)
    expect(device).toMatchObject({
      id: 'iphone-17-pro',
      name: 'iPhone 17 Pro',
      width: 402,
      height: 874,
      statusBarHeight: 59,
      dpr: 3,
      system: 'iOS 26.0.0',
      notch: true,
      homeIndicator: true
    })
    expect(guestViewport(device)).toEqual({ width: 402, height: 771 })
    expect(deviceHasIsland(device)).toBe(true)
  })
  it('builds a Lark user agent per platform', () => {
    for (const d of DEVICES) {
      const ua = buildUserAgent(d, 'zh_CN')
      expect(ua).toMatch(/Lark\/\d+\.\d+\.\d+/)
      expect(ua).toContain('LarkLocale/zh_CN')
      if (d.platform === 'ios') expect(ua).toContain('iPhone OS')
      if (d.platform === 'android') expect(ua).toContain('Android')
      const vp = guestViewport(d)
      expect(vp.width).toBe(d.width)
      expect(vp.height).toBeGreaterThan(0)
      expect(vp.height).toBeLessThanOrEqual(d.height)
      if (d.platform !== 'pc') expect(vp.height).toBeLessThan(d.height)
    }
  })
  it.each([
    ['iphone-8', '10_0_1', '10.0.1'],
    ['iphone-13', '14_2', '14.2'],
    ['iphone-15', '17_0', '17.0'],
    ['iphone-16', '18_0', '18.0'],
    ['iphone-17-pro', '26_0', '26.0']
  ])('derives the %s iOS UA version from its preset', (deviceId, os, version) => {
    const ua = buildUserAgent(findDevice(deviceId), 'en_US')
    expect(ua).toContain(`CPU iPhone OS ${os} like Mac OS X`)
    expect(ua).toContain(`Version/${version}`)
    expect(ua).toContain('Lark/3.44.0')
    expect(ua).toContain('LarkLocale/en_US')
  })
  it('insets the status bar so clock and icons sit inside the display corner', () => {
    const pro = findDevice('iphone-14-pro')
    expect(statusBarInset(pro)).toBeGreaterThan(20)
    expect(statusBarInset(findDevice('iphone-8'))).toBe(14)
    expect(DEVICES.some((d) => d.id === 'iphone-16-pro')).toBe(true)
    expect(DEVICES.some((d) => d.id === 'iphone-air')).toBe(true)
  })
  it('uses a Dynamic Island on 14 Pro and later, a notch on 13', () => {
    expect(deviceHasIsland(findDevice('iphone-14-pro'))).toBe(true)
    expect(deviceHasIsland(findDevice('iphone-16-pro'))).toBe(true)
    expect(deviceHasIsland(findDevice('iphone-13'))).toBe(false)
    expect(deviceHasIsland(findDevice('iphone-8'))).toBe(false)
  })
  it('groups the device menu by form factor', () => {
    expect(deviceMenuGroup(findDevice('iphone-13'))).toBe('iphone')
    expect(deviceMenuGroup(findDevice('nexus-5'))).toBe('android')
    expect(deviceMenuGroup(findDevice('ipad'))).toBe('ipad')
    expect(deviceMenuGroup(findDevice('pc-mac'))).toBe('pc')
  })
})

describe('jsapi', () => {
  it('formats errMsg like the client', () => {
    expect(okMsg('getSystemInfo')).toBe('getSystemInfo:ok')
    expect(failMsg('getSystemInfo')).toBe('getSystemInfo:fail')
    const err = jsapiFail('foo', JSAPI_ERROR.NOT_HANDLER, 'not handler api foo')
    expect(err.errMsg).toBe('foo:fail')
    expect(err.errorCode).toBe(JSAPI_ERROR.NOT_HANDLER)
    expect(err.errCode).toBe(err.errorCode)
    expect(err.errString).toBe(err.errorMessage)
  })
  it('routes methods to the right handler', () => {
    expect(classifyJsapi('biz.util.getClipboardInfo')).toBe('main')
    expect(classifyJsapi('device.notification.toast')).toBe('shell')
    expect(classifyJsapi('nope.unknown')).toBe('mock')
  })
})

describe('i18n', () => {
  it('resolves system language and translates', () => {
    expect(resolveLanguage('system', 'zh-Hans-CN')).toBe('zh-CN')
    expect(resolveLanguage('system', 'en-GB')).toBe('en-US')
    expect(resolveLanguage('en-US', 'zh-CN')).toBe('en-US')
    expect(translate('zh-CN', 'toolbar.preview')).not.toBe(translate('en-US', 'toolbar.preview'))
  })
})

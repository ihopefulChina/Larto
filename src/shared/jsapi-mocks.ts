/**
 * Fixed JSAPI responses. The official tool hard-codes these in
 * extraResources/h5/preload.js (docs/RESEARCH_OFFICIAL_TOOL.md §5.3); values here follow
 * it closely so pages behave the same. A later phase can make them editable
 * (Mock panel) — keep the shape `{ [method]: payload | (params) => payload }`.
 */
export type MockResponder = (params: Record<string, unknown>) => Record<string, unknown>

const ok =
  (data: Record<string, unknown> = {}): MockResponder =>
  () =>
    data

export const JSAPI_MOCKS: Record<string, MockResponder> = {
  'device.base.getSystemInfo': ok({
    platform: 'android',
    model: 'MI 9',
    brand: 'Xiaomi',
    system: 'Android 10',
    version: '4.11.7',
    language: 'zh-CN',
    pixelRatio: 3,
    screenWidth: 393,
    screenHeight: 851,
    windowWidth: 393,
    windowHeight: 851,
    statusBarHeight: 24,
    safeArea: { left: 0, right: 393, top: 24, bottom: 851, width: 393, height: 827 }
  }),
  getSystemInfo: ok({
    platform: 'darwin',
    model: 'MacBook Pro',
    brand: 'Apple',
    system: 'macOS',
    version: '4.11.7',
    appName: 'Feishu',
    language: 'zh_CN',
    pixelRatio: 2,
    screenWidth: 1440,
    screenHeight: 900,
    windowWidth: 900,
    windowHeight: 866,
    statusBarHeight: 0,
    safeArea: { left: 0, right: 900, top: 0, bottom: 866, width: 900, height: 866 }
  }),
  getDeviceID: ok({ deviceId: 'fdt-simulator-device' }),
  getNetworkType: ok({ networkType: 'wifi', networkAvailable: true }),
  getConnectedWifi: ok({
    wifi: { SSID: 'FeishuDevTools', BSSID: '00:00:00:00:00:00', secure: true, signalStrength: 100 }
  }),
  'device.connection.getConnectedWifi': ok({
    ssid: 'FeishuDevTools',
    bssid: '00:00:00:00:00:00',
    macIp: '192.168.1.2'
  }),
  getWifiStatus: ok({ status: 'on' }),
  openBluetoothAdapter: ok(),
  closeBluetoothAdapter: ok(),
  getBluetoothAdapterState: ok({ discovering: false, available: true }),
  startBluetoothDevicesDiscovery: ok(),
  stopBluetoothDevicesDiscovery: ok(),
  getBluetoothDevices: ok({ devices: [] }),
  startAccelerometer: ok(),
  stopAccelerometer: ok(),
  startCompass: ok(),
  stopCompass: ok(),
  getScreenBrightness: ok({ value: 0.8 }),
  setScreenBrightness: ok(),
  setKeepScreenOn: ok(),
  makePhoneCall: ok(),
  vibrateLong: ok(),
  vibrateShort: ok(),
  'device.notification.vibrate': ok(),
  scanCode: ok({ result: 'https://open.feishu.cn', scanType: 'QR_CODE' }),
  chooseImage: ok({ tempFilePaths: [], tempFiles: [] }),
  getImageInfo: ok({ width: 0, height: 0, path: '', type: 'png', orientation: 'up' }),
  compressImage: ok({ tempFilePath: '' }),
  saveImageToPhotosAlbum: ok(),
  chooseVideo: ok({ tempFilePath: '', duration: 0, size: 0, width: 0, height: 0 }),
  saveVideoToPhotosAlbum: ok(),
  getUserInfo: ok({
    userInfo: {
      nickName: '张三',
      avatarUrl: '',
      gender: 0,
      country: 'China',
      province: '',
      city: '',
      language: 'zh_CN'
    }
  }),
  authorize: ok(),
  mailto: ok(),
  startDeviceCredential: ok({ result: true }),
  checkWatermark: ok({ hasWatermark: false }),
  startPasswordVerify: ok({ result: true }),
  getChatInfo: ok({ chatId: '', chatName: '', chatType: 0 }),
  chooseChat: ok({ data: [] }),
  sendMessageCard: ok(),
  getSetting: ok({ authSetting: {} }),
  openSetting: ok({ authSetting: {} }),
  openSchema: ok(),
  docsPicker: ok({ data: [] }),
  filePicker: ok({ list: [] }),
  saveFile: ok({ savedFilePath: '' }),
  openDocument: ok(),
  readFile: ok({ data: '' }),
  stat: ok({ stats: { size: 0, lastModifiedTime: 0, isDirectory: false, isFile: true } }),
  chooseLocation: ok({ name: '', address: '', latitude: 0, longitude: 0 }),
  openLocation: ok(),
  reverseGeocode: ok({
    address: '',
    country: 'China',
    province: '',
    city: '',
    district: '',
    street: ''
  }),
  startLocationUpdate: ok(),
  stopLocationUpdate: ok(),
  monitorReport: ok(),
  'device.screen.lockViewOrientation': ok(),
  'device.screen.unlockViewOrientation': ok(),
  getSDKConfig: ok({ code: 0 })
}

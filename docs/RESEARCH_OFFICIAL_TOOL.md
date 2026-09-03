# 官方「飞书开发者工具」网页调试模块逆向调研

> 本文是复刻工作的事实依据。所有结论来自本机 `/Applications/飞书开发者工具.app`（v3.4.2）的 `app.asar` 静态分析 + 运行中实例的 CDP 抓取（2026-09-03）。
> 后续接力的 AI/工程师：实现任何功能前先读对应章节；有疑问时按 §11 的方法重新提取源码验证，不要凭猜测实现。

## 1. 官方工具基本事实

| 项 | 值 |
| --- | --- |
| 版本 | 3.4.2（`CFBundleShortVersionString`），commit `f7fcbcad…` |
| 架构 | **x86_64 only**（Rosetta 运行），这是复刻 arm64 版本的动因 |
| 运行时 | Electron 26.6.1 / Chrome 116 / Node 18 |
| Bundle ID | `com.bytedance.feishu.opdev`，URL scheme `opdev://` |
| 依赖 | `@bdeefe/feishu-devtools-core`（业务核心）、`@opensumi/*`（IDE，小程序用）、`@bdeefe/electron-updater`（electron-updater fork）、`electron-store`、`express`、`ws`、`axios`、`@electron/remote` |
| 主进程入口 | `libs/index.js` → `libs/main/index.js` |
| H5 调试窗口 | `libs/main/browsers/h5.js`（主进程） + `libs/renders/h5.html`（渲染层，React + antd） |
| 注入 H5 页面的 preload | `Contents/Resources/extraResources/h5/preload.js`（22 KB，JSAPI 桥） |
| 自带 DevTools 前端 | `libs/devtools/h5/`（老版本 Chrome DevTools 前端，`inspector.html`） |
| 用户数据 | `~/Library/Application Support/@lark-opdev/electron` |
| 更新配置 | `app-update.yml`: `provider: generic`，运行时改为服务端下发的 `ideUpdateUrl` |

主进程启动参数（`libs/main/index.js`）：`remote-debugging-port=<debugPort>`、`remote-allow-origins=*`、`disable-site-isolation-trials`、`enable-features=SharedArrayBuffer`；`app.disableHardwareAcceleration()`；`requestSingleInstanceLock()`；`window-all-closed → quit`。

## 2. H5 调试窗口架构

```
BrowserWindow(h5.html)  titleBarStyle=hiddenInset, 909×845 (min 同), backgroundColor #1f2329
  webPreferences: nodeIntegration=true, webviewTag=true, contextIsolation=false, webSecurity=false   ← 官方很不安全，复刻时不要照抄
  ├─ <webview id="h5Webview">   src=用户 URL, useragent=移动/PC UA, allowpopups, webpreferences="contextIsolation=no", preload=extraResources/h5/preload.js
  └─ <webview id="DevTools">    src=http://127.0.0.1:<8090+>/inspector.html?ws=127.0.0.1:<debugPort>/devtools/page/<h5Webview 的 target id>
```

- DevTools 实现方式：主进程用 express 静态托管 `libs/devtools/h5`（老 DevTools 前端），渲染层通过 `getInspectorUrl(url)` 请求 `http://127.0.0.1:<debugPort>/json`，找到 `url` 包含当前 H5 地址的 target，拼出 `ws=` 参数交给 DevTools webview。失败时最多重试 5 次。
- 复刻决策：**不复刻老前端**，改用 Electron 原生 `webContents.setDevToolsWebContents(devtoolsWebview.webContents)` + `openDevTools()`（Electron 官方文档中给出的 `<webview>` 停靠示例），得到与 Chromium 版本一致的 stock DevTools。见 `docs/ARCHITECTURE.md`。
- `webview` 的 `dom-ready` 后官方调用 `setWindowOpenHandler(() => { webview.loadURL(url); return {action:'deny'} })`：所有 `window.open` 都在同一 webview 内打开。
- `did-navigate` → 同步地址栏；`did-start-loading` → 记录 FCP 计时。

### 2.1 渲染层 DOM 结构（CDP 抓取，已去噪）

```
#main.main
├─ .toolPanel                      (bg #373c43, height 82px, 含标题行)
│  └─ .ui-toolBar-Container
│     ├─ .ui-toolBar-title        "Web - 飞书开发者工具"
│     └─ .ui-toolBar-content > .container (flex, space-between)
│        ├─ 左组: .urlContainer(.urlbox: [刷新按钮 37px][input placeholder="about:blank" maxlength 2048][历史记录下拉 "历史记录" + 最多 10 条])
│        │        #previewContainer 按钮"预览"   按钮"清缓存"
│        ├─ 中组: 按钮"模拟器"(selected, disabled)   按钮"调试器"(toggle selected)
│        └─ 右组: 按钮"反馈"(FG 控制)   账号头像下拉(登录/切换租户/登出)
└─ .idePanel (flex row)
   └─ .resize-colunm
      ├─ .resize-colunm-0 (minWidth 442px, width 500px; 切设备后 = 设备宽 + 64)
      │  └─ .simulatorContainer (bg #1f2329)
      │     ├─ .simulatorToolBox (bg #2b2f36, h 28px) > 设备下拉 "iPhone 13/13 Pro/14 ▾" | 分隔线 | 缩放下拉 "100% ▾"
      │     └─ .simulatorContent (margin 20px 0, overflow auto)
      │        └─ #gadgetContainer (width×height = 设备尺寸, transform: scale(缩放), transform-origin: top, bg 白)
      │           ├─ .statusBar (h 20px, 12px 字号: 左 时间 "17:50" / 中 notch / 右 wifi、电池图标)
      │           ├─ .h5Container > .navigator (h 44px; showNotch 时容器 88px)
      │           │     左: [← 图标 + "Back"] ["关闭"]   中: 标题(=document.title)   右: ["More"]
      │           ├─ JSAPI UI: alert/confirm/prompt modal, preloader/toast(loading), 图片预览(PhotoSwipe), 分享菜单(ActionSheet: 刷新/取消)
      │           └─ #iframeContainer (flex 1) > <webview id="h5Webview">  (position absolute, 100%)
      └─ .resize-colunm-1 (minWidth 300px, showDevtools=false 时 hidden) > <webview id="DevTools">
```

### 2.2 视觉 token（官方为纯深色）

| 用途 | 值 |
| --- | --- |
| 窗口/模拟器背景 | `#1f2329` |
| 面板（模拟器工具条、历史下拉底） | `#2b2f36` |
| 顶部工具栏 / hover / 弹层 | `#373c43` |
| hover 加深 | `#51565d` |
| 地址栏输入底 | `#646a73`，圆角 4px，高 24px，文字白 12px PingFang SC |
| 主文字 | `#f8f9fa`；次级 `rgba(248,249,250,.6)`；分隔线 `rgba(255,255,255,.16)` |
| 强调色（飞书蓝） | `#3370ff` |
| 二维码复制底色 | `#373C43`（240×240 画布，QR 200×200 居中） |

窗口最小宽度随设备变化：`minWidth = deviceWidth + 70 + 387 + 100`（`setBrowserOptions`）。

## 3. 设备目录与 UA（`feishu-devtools-core/libs/modules/simulator/common/common.js`）

默认设备 = 列表第一项，默认缩放 100。缩放列表：50 / 75 / 85 / 100 / 125 / 150（%）。

| name | width×height (CSS px) | statusBarHeight | dpr | system | platform | notch | homeIndicator |
| --- | --- | --- | --- | --- | --- | --- | --- |
| iPhone 13/13 Pro/14 | 390×844 | 47 | 3 | iOS 14.2.0 | ios | ✓ | ✓ |
| iPhone 14 Pro | 393×852 | 54 | 3 | iOS 14.2.0 | ios | ✓ | ✓ |
| iPhone 14 Pro Max | 430×932 | 54 | 3 | iOS 14.2.0 | ios | ✓ | ✓ |
| iPhone 13 mini | 375×812 | 50 | 3 | iOS 14.2.0 | ios | ✓ | ✓ |
| iPhone 13 Pro Max/14+ | 428×926 | 47 | 3 | iOS 14.2.0 | ios | ✓ | ✓ |
| iPhone 12/12 Pro | 390×844 | 47 | 3 | iOS 14.2.0 | ios | ✓ | ✓ |
| iPhone 12 mini | 375×812 | 50 | 3 | iOS 14.2.0 | ios | ✓ | ✓ |
| iPhone 12 Pro Max | 428×926 | 47 | 3 | iOS 14.2.0 | ios | ✓ | ✓ |
| iPhone X/XS/11 Pro | 375×812 | 44 | 3 | iOS 14.2.0 | ios | ✓ | ✓ |
| iPhone 11/XR | 414×896 | 48 | 2 | iOS 14.2.0 | ios | ✓ | ✓ |
| iPhone XS Max/11 Pro Max | 414×896 | 44 | 3 | iOS 14.2.0 | ios | ✓ | ✓ |
| iPhone 6/6s/7/8/SE | 375×667 | 16 | 2 | iOS 10.0.1 | ios | – | – |
| iPhone 6 +/6s +/7 +/8 + | 414×736 | 16 | 3 | iOS 14.2.0 | ios | – | – |
| Nexus 5 | 360×640 | 16 | 3 | Android 10.0.1 | android | – | – |
| Nexus 5x | 411×731 | 16 | 2.6 | Android 10.0.1 | android | – | – |
| Nexus 6 | 412×732 | 16 | 3.5 | Android 10.0.1 | android | – | – |
| iPad Pro | 1024×1366 | 16 | 2 | iOS 14.2.0 | ios | – | ✓ |
| iPad / iPad mini | 768×1024 | 16 | 2 | iOS 14.2.0 | ios | – | – |
| PC | 900×866 | 16 | 2 | Mac OS X 10_15_7 | pc | – | – |
| PC(window) | 900×866 | 16 | 2 | Win64 | pc | – | – |

H5 webview 实际使用的 UA（渲染层常量，注意与 core 里的 `defaultUserAgent` 略有差别，以渲染层为准）：

- 移动端（platform ≠ pc）：`Mozilla/5.0 (iPhone; CPU iPhone OS 14_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.2 Mobile/15E148 Safari/604.1 Lark/3.44.0 LarkLocale/zh_CN`
- PC：`Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/87.0.4280.66 Safari/537.36 Lark/3.44.0 LarkLocale/zh_CN Electron/Native`
- Android 设备在 core 目录里有各自 UA（含 `Lark/3.44.0 LarkLocale/zh_CN`），但渲染层只按 pc / 非 pc 二分。复刻时可按 platform 三分（ios/android/pc），需保证 UA 含 `Lark/x.y.z`（JSSDK 以此识别飞书容器）。

切换设备时官方：`webview.setUserAgent(ua)` → `webview.reload()` → 调整 `#gadgetContainer` 尺寸（pc 为 `calc(100% - 40px)`）。官方**没有**使用 `enableDeviceEmulation`，`devicePixelRatio` 由 preload 粗暴改成 1。复刻时应使用 `webContents.enableDeviceEmulation` 提供正确的 `screen`/DPR。

## 4. 飞书扫码登录（`AccountModule.loginV2`，IDE 使用的是 V2）

1. 域名：环境 `feishu` → `feishu.cn`；`lark` → `larksuite.com`（`config.json` 还有 pre/boe/KA 私有化环境，复刻只做 feishu + lark）。
2. 登录 URL：
   ```
   https://passport.feishu.cn/accounts/page/login?app_id=7&redirect_uri=<enc(https://open.feishu.cn/miniprogram/api/v4/opdev_ide/pages/success.html?lang=zh-CN)>&lang=zh-CN
   ```
   `app_id=7` = 开放平台自身应用 ID（`OPEN_PLATFORM_APP_ID`）。该页面即飞书统一登录页，内含**扫码登录**。
3. 打开子窗口 `BrowserWindow({ titleBarStyle:'hiddenInset', width:600, height:720, resizable:false, parent: 主窗口 })`，登录前清空该 session 的 cookies/storage/cache（官方用 defaultSession；复刻请用独立临时 partition），并 `insertCSS` 微调 `.passport-layout-web-login.web-v3-layout-box{padding:20px 5px;height:calc(100% - 40px);width:auto}`。
4. 监听 `did-navigate`，当 `new URL(url).pathname.endsWith('success.html')` 时读取 `session.cookies.get({})`，取 `session` 与 `session_list`（`session_list` 以 `_` 分隔多个 session）。缺任一则报错 `get session error`。超时 180 s。
5. 用 session 请求 passport（headers 见 §4.1）：
   - `GET https://passport.feishu.cn/accounts/web/user?app_id=7` → `{ user: { id, name, avatar_url, display_name, i18n_names, i18n_display_names, login_credential_id, tenant: { id, name, icon_url, tenant_brand } } }`
   - `POST https://passport.feishu.cn/accounts/security/user/web_list` body `{app_id:7}` → 已登录用户/租户列表 `[{ user:{…tenant}, is_login }]`
   - `POST https://passport.feishu.cn/accounts/security/user/user_center` → `step_info.credential_binding_identities`（全部可切换租户）
   - 切换租户：`POST https://passport.feishu.cn/accounts/web/switch` body `{ user_id, credential_id }` → 响应 `set-cookie` 新 `session`/`session_list`
   - 会话失效判定：任一 passport 请求返回 401 → 登出（`sessionExpired`）
6. 持久化 `accountInfo = { env, larkSession, larkSessionList[], user:{id,name,avatar,displayName,i18nNames,i18nDisplayNames,loginCredentialId,env}, tenant:{id,name,avatar,isLogin}, tenantList[] }`，并按 env 存 `accountInfoMap`。复刻时 session 必须用 `safeStorage` 加密存储。

### 4.1 请求约定（`ServiceModule.Request`）

- Cookie：`session=<larkSession>; session_list=<larkSessionList.join('_')>`
- Passport 额外头：`X-Api-Version: 1.0.0`, `X-App-Id: 7`, `X-Device-Info: platform=websdk`, `X-locale: zh-CN|en-US`, `X-Terminal-Type: 2`
- 通用头：`User-Agent: opdev-ide/3.2.0`, `Accept-Language`
- Base URL 规则：`https://<subDomain>.<domain><basePath>`，`basePath`: `devtools=/miniprogram/api/v4`, `passport=/accounts`, `h5JSSDK=/openapi/jssdk`, `openPlatform=/open-platform`

## 5. JSAPI 桥（`extraResources/h5/preload.js`，全部核心逻辑）

### 5.1 官方 JSSDK 如何找到宿主桥（按 UA 分流）

| UA 含 | JSSDK 期望的全局对象 | 调用形态 | 就绪事件 |
| --- | --- | --- | --- |
| `iPhone` | `window.WebViewJavascriptBridge.invoke(e)` | `e = { method, args }`，`args.onSuccess` / `args.onFailed` 是**页面全局函数名**，宿主用 `window[name](result)` 回调 | `WebViewJavascriptBridgeReady` |
| `Macintosh` | `window.__LarkPCSDK__.bridge.invoke(method, args, { onSuccess, onFail })` | 直接传回调函数 | 无 |
| 其他（Android） | `window.LkWebViewJavascriptBridge.callHandler(method, args, _, _, { onSuccess, onFail })`，另需 `registerHandler` 空实现 | 第 5 个参数为回调对象 | `LkWebViewJavascriptBridgeReady` |

新版 `tt.*` API 使用 `callbackId`：当 `args.callbackId` 存在时，宿主必须调用 `window.ttJSBridge.invokeHandler(callbackId, { ...result, errMsg })`；持续回调（如地理位置）用 `window.ttJSBridge.subscribeHandler(callbackId, data)`。`ttJSBridge` 由 JSSDK 自己创建。

特殊方法：`getSDKConfig` → 直接 `onSuccess({ code: 0 })`。

结果约定：`errMsg = "<method>:ok" | "<method>:fail"`；按 `errMsg.split(':').pop()` 决定走 onSuccess / onFail。

其他行为：`window.devicePixelRatio = 1`（复刻不照抄）；页面 `load` 后劫持 `document.title` setter，任何标题变化都触发 `biz.navigation.setTitle` 同步到模拟器导航栏。

### 5.2 preload ⇄ 宿主消息通道

- preload → 宿主：`ipcRenderer.sendToHost('channel', { name, data, success: <cbId>, fail: <cbId> })`（`execute` 不带回调，`subscribe` 带自增回调 id）
- 宿主 → preload：`ipcRenderer.on('channel', (_, { callbackId, callbackType, data|message }))`；`callbackType === 'continued'` 表示订阅推送
- 宿主事件名（`i` 枚举）：`config, requestAuthCode, requestAccess, setNavigationInfo, navigateBack, navigateClose, alert, confirm, showPreloader, hidePreloader, toast, prompt, previewImage, openLink, copyText, getClipboardInfo, getIp, getAppLanguage, loadLocation, $syncMockList, $mockListUpdated, onLeftNavigationBarClick, onRightNavigationBarClick`

### 5.3 JSAPI 实现清单（`s` 枚举 → 处理方式）

需要宿主/服务端的（**必须真实实现**）：

| JSAPI | 宿主处理 |
| --- | --- |
| `config` | 取 `{appId, jsApiList, nonceStr, signature, timestamp}` + `url=location.href` 去 hash → 宿主 `POST https://open.feishu.cn/openapi/jssdk/verify` body `{url, app_id, js_api_list, nonce_str, signature, timestamp}` header `X-Session-ID: <larkSession>`（需登录）→ `code===0` 成功；失败 `errorCode = Number('333' + String(code).slice(2))`（code ≥ 8 位则原样）；未登录 → `errorCode 99991691 "invalid session, please login"`；网络错误 → `1014` |
| `requestAuthCode` | 宿主 `POST https://open.feishu.cn/open-platform/api/LoginH5` body `{appid, sessionid: larkSession, url: 当前页面 URL}` → 响应 `{code, msg, data:{code}}` → 返回 `{ code: data.code }` |
| `requestAccess` | 宿主用登录 session 调 `POST https://open.feishu.cn/authen/v1/get_auth_info_inner` body `{ app_id, scope: scopeList.join(' '), state, open_app_type: 2, redirect_uri: 当前 URL }`（附 `X-Device-Info: platform=websdk` 与 session cookie）→ `data.auto_confirm && data.code` 直接返回 `{code, state}`；否则需展示授权确认后 `POST /authen/v1/confirm_inner`（官方由 passport web SDK 完成，复刻阶段先返回失败并提示） |
| `device.notification.alert/confirm/showPreloader/hidePreloader/toast/prompt`, `showModal` | 模拟器内绘制 UI；confirm/prompt 回传 `{buttonIndex}` / `{buttonIndex, value}` |
| `biz.navigation.setTitle/setLeft/setRight/setMenu/close/goBack`, `setNavigationBar` | 更新模拟器导航栏；`setNavigationBar` 校验：items ≤ 2 且 imageBase64 ≤ 10240 字符，否则 `errCode 104` |
| `biz.util.copyText`, `setClipboardData`, `biz.util.getClipboardInfo`, `getClipboardData` | 系统剪贴板 |
| `biz.util.openLink` | 同 webview 内 `loadURL` |
| `biz.util.getAppLanguage` | `{ name: '简体中文'|'English', code: 'zh-CN'|'en-US' }` |
| `device.connection.getGatewayIP` | 本机 IP |
| `device.geolocation.get/start/stop`, `getLocation` | 宿主 `loadLocation`（官方用 IP 定位；复刻可用系统定位或设置里手填），附带 `{time, netType:'wifi', operatorType:'unknown', accuracy:65}` |
| `previewImage` | 模拟器内图片预览 |

官方**写死 Mock** 的（复刻可先同样返回固定值，后续做 Mock 面板）：
`device.base.getSystemInfo`（android/MI 9）、`getSystemInfo`（darwin/Feishu 4.11.7）、`getDeviceID`、`getNetworkType`、`getConnectedWifi`/`device.connection.getConnectedWifi`、`getWifiStatus`、蓝牙 6 个、加速度/罗盘、屏幕亮度、`makePhoneCall`、`vibrate*`、`scanCode`（返回 `https://open.feishu.cn`）、`chooseImage/getImageInfo/compressImage/saveImageToPhotosAlbum/chooseVideo/saveVideoToPhotosAlbum`、`getUserInfo`（张三）、`authorize`、`mailto`、`startDeviceCredential`、`checkWatermark`、`startPasswordVerify`、`getChatInfo/chooseChat/sendMessageCard`、`getSetting/openSetting`、`openSchema`、`docsPicker/filePicker/saveFile/openDocument/readFile/stat`、`hideToast/showToast/showActionSheet/showPrompt`、`chooseLocation/openLocation/reverseGeocode/startLocationUpdate/stopLocationUpdate`、`monitorReport`、`device.screen.lock/unlockViewOrientation`、`device.notification.vibrate`。

未在列表中的方法：`console.warn('not handler api', method)`，不回调。

### 5.4 Mock 规则引擎（preload 内 `c` 类）

`{ enable, rules: [{ ruleName, enable, apiName, paramRules: [{name, regExp}], response: { status: 'success'|'fail', data: [{ active, type:'custom', json }] } }] }`。命中时返回 `{ errMsg: apiName + ':ok|fail', ...json }`。宿主通过 `$syncMockList` 初始化、`mockConfig` 消息热更新。

## 6. 预览二维码（`PreviewModule.previewH5`）

- 移动端：schema `lark://client/web?isDev=1&url=<h5Url>[&app_id=<appId>]`，本地生成 QR 展示（tab「移动端」，按钮「复制二维码」）。用飞书 App 扫码即在真机飞书容器中打开该 H5（真实 JSAPI 环境）。
- PC 端：需登录，`PUT https://open.feishu.cn/miniprogram/api/v4/h5/push_preview` body `{ preview_url, app_id }`，然后 `open('lark://client/open')`，飞书桌面端收到卡片；文案「选择 PC 端模式，将会在飞书上直接打开 H5 应用」。
- localhost 地址扫码到手机不可达，官方未处理；复刻应提供「替换为局域网 IP」选项。

## 7. 其他交互

- 清缓存：`webContents.fromId(webviewId).session.clearStorageData()` 然后 `webview.reload()`（清的是 webview 所在 session 的全部站点数据）。
- URL 输入：≤ 2048 字符；无协议自动补 `http://`；回车且与当前 URL 相同 → reload；历史最多 10 条、最新在前，存 `history`。
- 默认页：未输入 URL 时加载 `https://sf1-cdn-tos.huoshanstatic.com/obj/larkdeveloper/opdev/staticPage/h5_zh_CN.html`（海外 `h5_lark_en_US.html`）。地址匹配 `/h5_.+\.html$/` 时不写入地址栏。
- 模拟器导航栏「More」→ ActionSheet：刷新 / 取消。「关闭」或 `navigateClose` → 弹窗「当前窗口已关闭」。
- `goBack`：`canGoBack ? goBack() : close()`。

## 8. 系统菜单（macOS，`libs/main/utils/customMenu.js`）

```
飞书开发者工具: 关于(role about) | 检查更新 | ─ | 调试 ▸ (打开日志, 复制 UUID, 调试开发者工具=打开 shell DevTools) | ─ | 退出 ⌘Q
视图:            刷新 ⌘R | ─ | 切换全屏 ⇧⌘F
编辑:            撤销 重做 ─ 剪切 复制 粘贴 全选 (roles)
设置:            代理设置(设置窗口) | 切换语言 ▸ (系统语言 / 中文 / English)
工具:            命令行工具 ▸ (opdev CLI 安装/卸载/复制路径)   ← 复刻不需要
```
Windows 端把「关于/检查更新/调试」放在「帮助」菜单。

## 9. 自动更新（`libs/main/utils/update.js`）

electron-updater，`autoDownload=false`, `autoInstallOnAppQuit=false`；`update-available → downloadUpdate()`；`update-downloaded → 打开更新说明窗口（版本号 + changelog）→ 用户确认 → quitAndInstall()`；`update-not-available → 提示「当前版本已是最新」`；`error → showErrorBox`。启动时仅在 `app.isPackaged` 检查一次；菜单「检查更新」手动触发。

## 10. 复刻边界与差异决策

| 官方做法 | 复刻决策 | 原因 |
| --- | --- | --- |
| `nodeIntegration=true, contextIsolation=false, webSecurity=false` | shell 与 guest 均 `contextIsolation=true, sandbox=true`；guest preload 用 `contextBridge.exposeInMainWorld` + `contextBridge.executeInMainWorld` 挂桥 | 安全；Electron 44 能力足够 |
| 自带老 DevTools 前端 + remote-debugging-port | `setDevToolsWebContents` 停靠 stock DevTools | 版本一致、无协议漂移、少两个本地服务 |
| 仅深色 | 深/浅/跟随系统 | 需求 |
| 无设备仿真（DPR 改 1） | `enableDeviceEmulation` + 正确 UA | 更接近真机 |
| session 明文存 electron-store | `safeStorage` 加密 | 安全 |
| 小程序/Block/编辑器/上传/CLI | 不做 | 需求仅网页调试 |
| 埃点、slardar、FG | 不做 | 无意义 |

## 11. 如何重新提取官方源码（研究材料不入库）

```bash
mkdir -p /tmp/fsdt-research && cd /tmp/fsdt-research
npx --yes @electron/asar extract "/Applications/飞书开发者工具.app/Contents/Resources/app.asar" app   # 沙箱内 .vscode 目录会 EPERM，需在非沙箱 shell 执行
npx --yes prettier@3 --parser babel --print-width 120 app/libs/renders/static/js/h5.*.js > h5.pretty.js
cat "/Applications/飞书开发者工具.app/Contents/Resources/extraResources/h5/preload.js"                 # JSAPI 桥全文
# 官方工具运行时可读 ~/Library/Application\ Support/@lark-opdev/electron/DevToolsActivePort 得到 CDP 端口，
# curl http://127.0.0.1:<port>/json 可看到 h5.html / DevTools webview / H5 webview 三个 target，用 Runtime.evaluate 抓 DOM。
```

关键文件索引：`libs/main/browsers/h5.js`（窗口 + H5Sdk：`h5Config/requestAuthCode/getSimulatorConfig/getExtraResourcePath`）、`libs/main/browsers/base.js`（登录窗口 cookie 处理、`passportPathName`）、`libs/main/adapters/Account.js`（登录窗口）、`node_modules/@bdeefe/feishu-devtools-core/libs/{config/api.js, modules/account/index.js, modules/service/index.js, modules/preview/index.js, modules/simulator/common/common.js}`。

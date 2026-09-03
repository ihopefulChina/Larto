# 架构

Electron 44 · electron-vite 5 · React 19 · TypeScript 5.9（strict）· zustand · zod（仅主进程）· `@modelcontextprotocol/sdk` · electron-updater · electron-builder。

## 1. 进程与模块

```
┌──────────────────────── main (Node, ESM) ────────────────────────┐
│ index.ts      启动、单实例、--smoke-test、装配下列模块            │
│ window.ts     BrowserWindow、窗口边界持久化、will-attach-webview 加固 │
│ menu.ts       原生菜单（应用/编辑/视图/帮助）→ shell:command 事件   │
│ theme.ts      nativeTheme 三态                                      │
│ store.ts + settings-schema.ts  原子 JSON 设置 + zod 校验            │
│ guest.ts      H5 guest WebContents：附着、加固、CDP 仿真、console、清缓存 │
│ devtools-dock.ts  WebContentsView 承载 DevTools 前端并叠加到窗口    │
│ account.ts    passport 扫码登录子窗口、Cookie safeStorage、租户切换 │
│ openapi.ts    JSAPI 签名校验、requestAuthCode、requestAccess、PC 预览推送 │
│ jsapi-backend.ts  `main` 类 JSAPI（剪贴板/网关 IP/定位/鉴权）       │
│ preview.ts    二维码生成（qrcode）、localhost→LAN、lark:// schema    │
│ updater.ts    electron-updater（GitHub Releases）状态机             │
│ mcp.ts        MCP Streamable HTTP（127.0.0.1:17331）+ /health       │
│ ipc.ts        ipcMain.handle 注册，全部按 shared/ipc.ts 类型        │
│ logger.ts / http.ts  文件日志 / fetch JSON 封装                     │
└──────────────────────────────────────────────────────────────────┘
          ▲ ipcRenderer.invoke / webContents.send（白名单）
┌──────── preload/shell.ts (CJS, sandbox) ────────┐
│ contextBridge.exposeInMainWorld('fdt', {invoke,on}) │
└─────────────────────────────────────────────────┘
          ▲
┌──────────────────── renderer (React) ───────────────────┐
│ App.tsx  → Toolbar(UrlBar, AccountMenu) / Simulator / DevToolsPane / modals │
│ store/app.ts        设置、主题、账号、更新、MCP 状态、当前 modal          │
│ store/simulator.ts  webview 引用、URL/标题/加载态、导航栏、JSAPI 覆盖层状态 │
│ jsapi/host.ts       监听 <webview> ipc-message，路由 main/shell/mock，记日志 │
│ components/Simulator.tsx  <webview partition="persist:h5-guest" preload=guest> │
└─────────────────────────────────────────────────────────┘
          ▲ ipcRenderer.sendToHost / webview.send（channel fdt:jsapi）
┌──────── preload/guest.ts (CJS, sandbox, contextIsolation) ────────┐
│ 在主世界注入 WebViewJavascriptBridge / __LarkPCSDK__ / LkWebViewJavascriptBridge │
└──────────────────────────────────────────────────────────────────┘
          ▲
        H5 页面（飞书 JSSDK 通过 UA `Lark/x.y.z` 识别为容器内）
```

## 2. 关键数据流

### 2.1 加载 URL

UrlBar 回车 → `normalizeUrl()`（`shared/url.ts`）→ `simulatorActions.navigateTo()` → `webview.loadURL` + `settings:pushHistory`（最多 10 条，最近优先）→ `did-navigate` 更新 `lastUrl`。官方默认页（`/h5_*.html`）不会写入地址栏（`displayUrl`）。

### 2.2 机型切换

Dropdown → `simulatorActions.changeDevice(id)` → 写 `settings.deviceId` → `guest:setDevice { guestWebContentsId, deviceId, locale, viewport }` → `guest.ts#applyEmulation()`：`debugger.attach('1.3')`，发送
`Emulation.setUserAgentOverride`（`buildUserAgent()`）、`Emulation.setDeviceMetricsOverride`（width/height = `guestViewport(device)`，deviceScaleFactor = dpr，mobile，screenWidth/Height = 设备物理逻辑尺寸）、`Emulation.setTouchEmulationEnabled`，然后 `reload()` 使 UA 生效。缩放只改 `<webview>` 的 CSS `transform: scale()`，不改 CSS 视口（E2E 有断言）。

### 2.3 DevTools

Toolbar「调试器」→ `settings.showDevTools` → 渲染 `DevToolsPane`（占位 div）→ `guest:openDevTools { guestWebContentsId, bounds }` → `devtools-dock.ts`：
`new WebContentsView()` → `win.contentView.addChildView` → `guest.setDevToolsWebContents(view.webContents)` → `guest.openDevTools({mode:'detach', activate:false})` → `did-finish-load` 后 remove+add child view（使 RWHV 由 hidden 变 visible）。`ResizeObserver`/窗口 resize → `guest:setDevToolsBounds`；modal 打开 → `visible=false`。关闭 → `guest:closeDevTools` → `closeDevTools()` + 销毁 view。

### 2.4 JSAPI 调用

页面 `WebViewJavascriptBridge.callHandler(method, params, cb)` → preload 生成 `callbackId`，`sendToHost('fdt:jsapi', {type:'invoke', ...})` → `jsapi/host.ts`：`classifyJsapi(method)`
- `main`：`invoke('jsapi:backend', ...)` → `jsapi-backend.ts`（`config` → `openapi.verifyJsapiSignature`，需要登录；未登录返回 `99991691`）。
- `shell`：写入 `useSimulator` 状态 → `JsapiOverlays`/`NavBar` 渲染，用户操作后回结果。
- `mock`：`jsapi-mocks.ts` 固定值（与官方一致）。

结果经 `webview.send('fdt:jsapi', {type:'result', callbackId, data})` 回 preload → 调 cb。每次调用 `invoke('jsapi:log', entry)` 进入主进程环形缓冲（MCP `get_jsapi_log`）。

### 2.5 登录

AccountMenu「登录」→ `account:login` → `account.ts#login()`：子 `BrowserWindow`（独立临时 partition `login-*`）加载 `buildLoginUrl(env, lang)`，注入官方相同的 CSS 让扫码区适配窄窗；监听导航到 `loginSuccessPage` → 读取该 partition 的 Cookie（`session`、`sessionList`）→ `loadAccount()` 调 `passport /accounts/web/user` 与 `/accounts/security/user/web_list` 得到用户与租户 → `safeStorage` 加密写 `account.json` → 广播 `account:changed`。`switchTenant` 调 `/accounts/web/switch` 后重新 `refresh()`。

### 2.6 更新

启动后（`autoCheckUpdates`）与菜单「检查更新」→ `updater.ts`：`autoUpdater.checkForUpdates()` → 状态机 `idle/checking/available/not-available/downloading/downloaded/error` 通过 `update:state` 事件推给 `UpdateDialog`；「下载」→ `downloadUpdate()`；「重启安装」→ `quitAndInstall()`。Feed 来自 `electron-builder.yml` `publish.github`，Release 中的 `latest-mac.yml` 为元数据。

### 2.7 MCP

`mcp.ts` 用 `McpServer.registerTool` 注册工具（列表见 README），每个 HTTP 请求新建 `StreamableHTTPServerTransport`（无会话），只绑定回环地址。工具通过 `guestManager`（主进程直接操控 guest WebContents：`loadURL`、`executeJavaScript`、`capturePage`、console 缓冲）与 `shell:command` 事件（让渲染层执行 UI 级操作：切机型/缩放/DevTools/主题）完成。`/health` 返回 guest 附着状态。

## 3. 安全模型

- 渲染层无 Node；shell preload 只暴露 `invoke(channel ∈ 白名单)` 与 `on(event ∈ 白名单)`。
- guest `<webview>`：`will-attach-webview` 强制 `preload` 为我们的 guest preload、删除 `nodeIntegration`、保留 `contextIsolation/sandbox`；`setWindowOpenHandler` 拦截 `window.open` → 在模拟器内导航或用系统浏览器打开；`permission` 请求由 `session.setPermissionRequestHandler` 只放行摄像头/麦克风/定位/剪贴板。
- 账号 Cookie（`session`/`sessionList`）只在主进程内存与 `safeStorage` 密文中；渲染层只拿到 `AccountState`（姓名/头像/租户列表）。
- 外链 `app:openExternal` 只允许 `http(s):`、`mailto:`、`lark:`；shell 窗口与 guest 的 `window.open` 分别由 `window.ts`/`guest.ts` 的 `setWindowOpenHandler` 接管。

## 4. 存储与路径

`~/Library/Application Support/FeishuDevTools/`
- `settings.json`：`Settings`（`shared/settings.ts`），version 字段用于迁移。
- `account.json`：`{ env, secrets }`，其中 `secrets` 为 safeStorage 加密后的 base64（含 `session`、`sessionList` Cookie）。
- `logs/main.log`：超过 5MB 轮转为 `main.log.1`。
- `Partitions/h5-guest/`：H5 会话 `persist:h5-guest`（清缓存会 `clearStorageData` + `clearCache`）。
- 登录子窗口使用非持久分区 `login-<timestamp>`，关闭即丢弃。

## 5. 构建

- `electron.vite.config.ts`：main → ESM（`out/main/index.js`），preload → CJS（sandbox preload 必须 CJS），renderer → Vite/React；`@shared` 别名指向 `src/shared`。
- 三个 tsconfig：`tsconfig.node.json`（main + shared）、`tsconfig.preload.json`（preload，含 DOM）、`tsconfig.web.json`（renderer）。
- `electron-builder.yml`：`mac.target = dmg+zip (arm64)`，hardenedRuntime + `build/entitlements.mac.plist`，`notarize: true`（有凭据时生效），`publish: github`。
- 图标：`resources/logo-source.png` → `scripts/make-icons.mjs`（sharp + iconutil）→ `build/icon.icns`、`build/icon.png`、`website/public/*`。

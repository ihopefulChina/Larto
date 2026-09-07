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
│ openapi.ts    JSAPI 签名校验、requestAuthCode、requestAccess(+confirm)、PC 预览推送 │
│ consent.ts    requestAccess 授权确认：主进程等待 shell 弹窗的决定    │
│ jsapi-backend.ts  `main` 类 JSAPI（剪贴板/网关 IP/定位/鉴权）       │
│ preview.ts    二维码生成（qrcode）、localhost→LAN、lark:// schema    │
│ updater.ts    electron-updater（GitHub Releases）状态机             │
│ proxy.ts      default/guest/login/updater Session 的统一代理策略    │
│ permissions.ts guest 按来源授权策略（敏感能力询问、未知能力拒绝）   │
│ security.ts   Chromium 沙箱安全门（拒绝参数、实际开关与环境变量）   │
│ mcp.ts        MCP Streamable HTTP（127.0.0.1:17331）+ /health       │
│ ipc.ts        ipcMain.handle 注册，全部按 shared/ipc.ts 类型        │
│ logger.ts / http.ts  文件日志 / Electron Session fetch JSON 封装    │
└──────────────────────────────────────────────────────────────────┘
          ▲ ipcRenderer.invoke / webContents.send（白名单）
┌──────── preload/shell.ts (CJS, sandbox) ────────┐
│ contextBridge.exposeInMainWorld('larto', {invoke,on}) │
└─────────────────────────────────────────────────┘
          ▲
┌──────────────────── renderer (React) ───────────────────┐
│ App.tsx  → Toolbar(AccountMenu) / Simulator(UrlBar) / DevToolsPane / modals │
│ store/app.ts        设置、主题、账号、更新、MCP 状态、当前 modal          │
│ store/simulator.ts  webview 引用、URL/标题/加载态、导航栏、JSAPI 覆盖层状态 │
│ jsapi/host.ts       监听 <webview> ipc-message，路由 main/shell/mock，记日志 │
│ components/Simulator.tsx  <webview partition="persist:h5-guest" preload=guest> │
└─────────────────────────────────────────────────────────┘
          ▲ ipcRenderer.sendToHost / webview.send（channel larto:jsapi）
┌──────── preload/guest.ts (CJS, sandbox, contextIsolation) ────────┐
│ 在主世界注入 WebViewJavascriptBridge / __LarkPCSDK__ / LkWebViewJavascriptBridge │
└──────────────────────────────────────────────────────────────────┘
          ▲
        H5 页面（飞书 JSSDK 通过 UA `Lark/x.y.z` 识别为容器内）
```

## 2. 关键数据流

### 2.1 加载 URL

模拟器顶部 UrlBar 回车 → `normalizeUrl()`（`shared/url.ts`）→ `UrlBar.navigateTo()` → `simulatorActions.loadUrl()` + `settings:pushHistory`（最多 10 条，最近优先）→ `did-navigate` 更新 `lastUrl`。无效 URL 会在 shell 中提示且不会写入历史；官方默认页（`/h5_*.html`）不会写入地址栏（`displayUrl`）。

### 2.2 机型切换

Dropdown → `simulatorActions.changeDevice(id)` → 写 `settings.deviceId` → `guest:setDevice { guestWebContentsId, deviceId, locale, viewport }` → `guest.ts#applyEmulation()`：`debugger.attach('1.3')`，发送
`webview.setUserAgent(buildUserAgent())`、`Emulation.setDeviceMetricsOverride`（width/height = `guestViewport(device)`，deviceScaleFactor = dpr，mobile，screenWidth/Height = 设备物理逻辑尺寸）、`Emulation.setTouchEmulationEnabled`，然后 `reload()` 使 UA 生效。默认机型是 iPhone 17 Pro（402×874、DPR 3）；其 59px 状态栏与 44px 导航栏从 guest viewport 扣除，底部 Home Indicator 则覆盖在网页上方，不再额外扣高度或绘制一条独立安全区背景。首次创建的 `<webview>` 先停在 `about:blank`，等主进程完成全部 CDP 仿真后才加载真实 URL，避免首屏脚本读到桌面 viewport 或 `maxTouchPoints=0`；PC 自适应模式还会等待布局并测量 `.gadgetBox.pc`，首屏的 `innerWidth/Height` 与 `screen.width/height` 从一开始就等于实际面板。布局等待正常走双 `requestAnimationFrame`，隐藏/最小化窗口则以 120ms 定时器兜底，避免 MCP 命令永久挂起。若 attach 期间设置发生变化，渲染层按最新稳定快照重新配置；任一 CDP 指令失败时保持 `about:blank` 并重试，不把半应用状态误报为成功。主进程只有在 renderer 完成配置、设置 webview 引用且首个真实 URL 导航已经完成或失败后才把 `/health.guest.attached` 置为 true；重试耗尽时模拟器显示错误和重试按钮。运行中切机由 generation 淘汰旧请求，失败会恢复上一机型及 UA，恢复也失败才回到安全空白页；PC `ResizeObserver` 尺寸上报标为 background，不增加显式切机 generation，也不能抢走带 request id 的回执。缩放只改 `<webview>` 的 CSS `transform: scale()`，不改 CSS 视口（E2E 有断言）；PC 自适应模式不展示无效的缩放选项。随后 `window.ts#fitWindowToDevice(device, zoom)` 按官方规则把窗口最小宽度设为 `deviceWidth + 70 + 387 + 100`（PC 机型回到 909），并在此之上"只增不减"地把窗口撑到能完整露出当前缩放下的机身：高度 = 40 顶栏 + 40 地址栏 + 36 控制栏 + 24 状态栏 + 18×2 内边距 + `device.height × zoom`，宽度 = 模拟器列（`device.width × zoom + 32`，最小 410）+ DevTools 列 300；均不超过当前显示器工作区（iPad Pro 在笔记本屏上仍会滚动）。首次启动没有 `windowBounds` 时按同一规则算默认尺寸，启动恢复旧尺寸后也会跑一次，`zoom` 变化经 `settings.on('change')` 触发。

渲染层采用微信开发者工具式高密度工作台：40px 窗口命令栏；左列为地址栏、模拟器画布、紧凑的设备/缩放胶囊与页面状态；右列原生 DevTools 从命令栏下方铺满。`.simulatorColumn` 宽 = `max(410, deviceWidth × zoom + 32)`；`.gadgetBox` 取缩放后的实际尺寸并 `margin: 0 auto` 居中（溢出时自动贴左、可滚动），内部 `.gadget` 保持 CSS 像素尺寸、`transform: scale()` 以左上角为原点。PC 机型默认 `.gadgetBox.pc` 填满列（`calc(100% - 40px)`）；右下角 28×28 命中区可按 1:1 指针位移拖成固定 viewport，拖动时用 latest-only 单飞队列发送 background CDP 预览，松开后才持久化一次。Esc 取消、方向键（10px；Shift 50px；Option 1px）和可编辑宽高输入提供非拖拽路径，「适应」恢复响应式布局。设备/缩放菜单向上展开，地址历史向下展开，承载工具条不再使用会裁剪弹层的 `overflow:auto`。

### 2.3 DevTools

Toolbar「调试器」→ `settings.showDevTools` → 渲染 `DevToolsPane`（占位 div）→ `guest:openDevTools { guestWebContentsId, bounds }` → `devtools-dock.ts`：
`new WebContentsView()` → `win.contentView.addChildView` → `guest.setDevToolsWebContents(view.webContents)` → `guest.openDevTools({mode:'detach', activate:false})` → `did-finish-load` 后 remove+add child view（使 RWHV 由 hidden 变 visible），再向前端 `insertCSS(THEME_CSS)` + `executeJavaScript(INSPECT_HOOK_JS)`（`devtools-frontend.ts`）。`ResizeObserver`/窗口 resize → `guest:setDevToolsBounds`。关闭 → `guest:closeDevTools` → `closeDevTools()` + 销毁 view。`settings.showDevTools` 默认 `true`（与官方一致，调试器随窗口打开）。

原生 view 永远盖在 DOM 之上，所以凡是要显示在 DevTools 上方的 shell UI（modal、账号菜单、地址栏历史）都要先把 view 藏起来：`useApp.modal`、`useApp.devtoolsCovers`（`useCoversDevTools(open, ref)` 在弹层与 `.devtoolsColumn` 相交时计数）→ `DevToolsPane` 先 `guest:snapshotDevTools` 拿到面板 PNG 画进占位 div 的 `background-image`，再 `guest:setDevToolsBounds { visible:false }`；弹层关闭后反向恢复。用户看到的是"冻结"的面板而不是空洞。

**主题**：DevTools 前端只在加载时读取 `prefers-color-scheme`，之后不跟随 `nativeTheme` 变化，因此 `devtools-dock.ts` 监听 `nativeTheme#updated`，深浅色变化时销毁并重建 view（等 `devtools-closed` 后再打开，否则 Elements 面板为空）。深色时 `THEME_CSS` 把 `--sys-color-cdt-base-container` 等表面/分割线 token 改成 app.css 的深色配色（#1f2329 / #2b2f36 / #373c43），语法高亮等语义色不动；浅色沿用 Chromium 原生白。

**选择元素**：移动机型开着 `Emulation.setTouchEmulationEnabled` 时，浏览器把鼠标移动/点击转成触摸手势，DevTools 的 inspect overlay 收不到 hover，因而不高亮、点不中（Chrome 自带的 device mode 也是在 inspect 期间关掉触摸模拟）。`INSPECT_HOOK_JS` 包一层 `InspectorFrontendHost.sendMessageToBackend`，看到 `Overlay.setInspectMode` 就 `console.info('[larto] inspect:on|off')`；`devtools-dock.ts` 在前端 `console-message` 里识别并 emit `inspect-mode` → `guestManager.setInspecting()` 临时关闭触摸模拟（`setTouchEmulationEnabled` / `setEmitTouchEventsForMouse`），选完或关掉 DevTools 后恢复。

### 2.4 JSAPI 调用

页面 `WebViewJavascriptBridge.callHandler(method, params, cb)` → preload 生成 `callbackId`，`sendToHost('larto:jsapi', {type:'invoke', ...})` → `jsapi/host.ts`：`classifyJsapi(method)`
- `main`：`invoke('jsapi:backend', ...)` → `jsapi-backend.ts`（`config` → `openapi.verifyJsapiSignature`，需要登录；未登录返回 `99991691`）。`requestAccess` 先 `POST /authen/v1/get_auth_info_inner`：`auto_confirm && code` 直接返回；否则 `consent.ts#ConsentBroker.ask()` 发事件 `jsapi:consent {id, info}` 让 shell 渲染 `ConsentModal`（与官方 passport `AuthzModal` 同款），用户点「授权」→ `jsapi:consentDecision {id, accept}` → `POST /authen/v1/confirm_inner`（同一份参数）取 `code`；取消/Esc/180 s 超时/窗口关闭 → `20047`。
- `shell`：写入 `useSimulator` 状态 → `JsapiOverlays`/`NavBar` 渲染，用户操作后回结果。
- `mock`：`jsapi-mocks.ts` 固定值（与官方一致）。

结果经 `webview.send('larto:jsapi', {type:'result', callbackId, data})` 回 preload → 调 cb。每次调用 `invoke('jsapi:log', entry)` 进入主进程环形缓冲（MCP `get_jsapi_log`）。

### 2.5 登录

未登录时 AccountMenu 只是一个「登录」按钮，点击直接 `account:login`（不再先展开菜单）→ `account.ts#login()`：子 `BrowserWindow`（`parent` = 主窗口，独立临时 partition `login-*`）加载 `buildLoginUrl(env, lang)`，注入官方相同的 CSS 让扫码区适配窄窗；监听导航到 `loginSuccessPage` → 读取该 partition 的 Cookie（`session`、`sessionList`）→ `loadAccount()` 调 `passport /accounts/web/user`（当前身份）、`/accounts/security/user/web_list`（已登录身份）、`/accounts/security/user/user_center`（全部绑定身份，未登录的标 `isLogin:false`）得到用户与租户 → `safeStorage` 加密写 `account.json` → 广播 `account:changed`。

passport 所有接口的响应体都是信封 `{ code, message, data }`（`http.ts#requestJson` 只拆 HTTP 层，信封由 `passport.ts#unwrapPassport()` 拆）；`code ∈ {34, 4401, 4}` 或 HTTP 401 视为会话过期（`SessionExpiredError`）→ `refresh()` 把状态置为 `expired`（保留头像原色，只用琥珀描边提示过期，菜单里给「登录」入口），其它错误（离线等）不改状态。`http.ts` 通过 `session.defaultSession.fetch(..., { credentials: 'omit' })` 发送显式 `session/session_list` Cookie，避免默认 Session 的同名 Cookie 覆盖扫码分区刚取到的会话，同时仍沿用 Electron 代理。`switchTenant` 用目标身份的 `user_id + credential_id` 调 `/accounts/web/switch`，从 `Set-Cookie` 取新 `session`/`session_list` 后 `refresh()`。登录中再点头像只是聚焦已打开的登录窗口；取消重新登录不会丢掉仍有效的旧会话。

### 2.6 更新

启动后（`autoCheckUpdates`，`check({manual:false})`）与菜单「检查更新」（`manual:true`）→ `updater.ts`：先判断当前包能否原地更新，再由 `autoUpdater.checkForUpdates()` 驱动状态机 `idle/checking/available/notAvailable/unsupported/downloading/downloaded/error`，通过 `update:state` 事件推给 `UpdateDialog`。macOS app、Windows NSIS 与 Linux AppImage 支持应用内更新；Windows portable 及 Linux DEB/RPM/tar.gz 明确显示需手动替换，开发构建也不会误连正式更新通道。更新弹窗采用 Sparkle 式布局：图标 + 版本行 + 经白名单清洗的 Release notes + 「自动检查」复选框。重叠的自动/手动检查只共享一个 updater 操作，并保留手动可见语义；五秒启动定时器会重读实时设置，已有可用版本或正在下载/已下载时不会再检查覆盖状态。「安装」会先同步进入 `downloading` 再调用 `downloadUpdate()`，防止连点绕过状态锁；`downloaded` 后「安装并重新启动」→ `quitAndInstall()`，`error` 时改为「前往下载页」。`update:skip` 让静默检查跳过指定版本，手动检查仍报告。Feed 来自 `electron-builder.yml` 的 GitHub provider；开发环境可用 `LARTO_UPDATE_FEED=http://127.0.0.1:<port>/` 走本地假 feed。

### 2.7 网络代理

`settings.proxy`（系统 / 直连 / 手动）→ `proxy.ts#applyProxy()`，同时更新 `session.defaultSession`、`persist:h5-guest` 与 electron-updater 分区，并关闭旧连接池，保证下一次请求立即采用新策略；登录子窗口每次新建临时 Session 后也先套用同一策略再加载扫码页，窗口打开期间切换策略会重配该临时 Session 并刷新登录页。手动模式的空地址只作为设置页草稿，不能落盘或静默退回系统代理。运行时修改按顺序应用；一次应用会等全部 Session settle 后才报告部分失败，随后恢复所有网络路径与持久设置到上一条已成功策略，避免迟到的原操作反向覆盖回滚；启动应用代理失败只记录并提示，不阻断主窗口。Passport / Open Platform 的 `http.ts#requestJson()` 使用 `session.defaultSession.fetch()`，因此不再绕开 Electron 代理；代理仍不读取或记录 Cookie。

### 2.8 MCP

`mcp.ts` 用 `McpServer.registerTool` 注册工具（列表见 README），每个 HTTP 请求新建 `StreamableHTTPServerTransport`（无会话），只绑定回环地址。端口启停经串行生命周期队列执行，并以 generation 淘汰被新设置覆盖的旧监听，避免连续修改开关或端口时并发占用、旧回调覆盖状态。工具通过 `guestManager`（主进程直接操控 guest WebContents：`loadURL`、`executeJavaScript`、`capturePage`、console 缓冲）与 `shell:command` 事件（让渲染层执行 UI 级操作：导航/切机型/缩放/DevTools/主题）完成。`set_device` 为每次调用生成 request id，在发命令前订阅完全匹配的 `guestManager.deviceApplied/deviceFailed`；新的 MCP 切机调用会在主进程先明确拒绝仍在等待的上一调用，renderer 的任何更新切机操作也会立即淘汰其尚未结束的带 id 请求，防止改 UA 让旧 reload 提前停止并误报成功。主进程完成 CDP、相关页面 reload 停止后才确认当前调用，不会被同机型的 ResizeObserver 事件误满足。离开 PC 后已排队的 ResizeObserver 回调会校验当前机型并退出，不能再覆盖新设备。`/health` 只在 renderer 真正就绪且首导航已完成尝试后返回 `guest.attached=true`。

`navigate` 走 `shell:command` → `navigateTo()` → `simulatorActions.loadUrl()`（写入地址栏历史）。渲染层 `<webview>` 元素拿到 guest id 会比主进程 `did-attach-webview` 晚一拍：Electron 把 `did-attach` 作为普通消息派发，可能先于元素自己 create-and-attach 调用的回包到达，此时 `getWebContentsId()` 抛错。因此 `Simulator.tsx#attachGuest` 失败后每 20ms 重试（`dom-ready` 仍是兜底），`loadUrl()` 在还没有 webview 时把 URL 记为 `pendingUrl`；attach 完成后用 `takePendingUrl()` 取出，并由 `loadUrlAndWait()` 等到导航完成或失败后才发 `guest:ready`。这样 `/health` 就绪后立刻 `navigate` 不会被静默吞掉，紧接着的 `set_device` 也不会取消启动导航并把页面留在 `about:blank`。

**stdio 桥（`packages/larto-mcp`，npm）**：面向只支持 stdio 的客户端与“由 AI 调用工具时拉起应用”的场景。`bin.mjs` 只启动 stdin 处理；`server.mjs` 在本地响应 `initialize`、`ping`、`tools/list` 与空资源/提示词列表，后台连接、枚举、重连和通知都不会探测或拉起应用。`src/tools.json` 保存完整的公开工具目录；`tests/mcp.test.ts` 启动隔离的真实 `McpService` HTTP 服务，严格比对目录与 `tools/list` 全量响应，防止工具参数漂移。变更工具后可通过 `LARTO_UPDATE_MCP_TOOLS=1 pnpm exec vitest run tests/mcp.test.ts -t 'complete HTTP tools/list'` 重新生成，再格式化目录文件。

只有具备请求 id 的已知 `tools/call` 才执行 `ensureApp()`：`GET /health` 不通则按系统尝试启动已安装应用——macOS 用 bundle id，Windows 查 LocalAppData/Program Files 与 PATH，Linux 查常见 bin/opt 路径与 PATH；非标准或 portable 位置可用 `LARTO_PATH` 明确指定。随后轮询到 `guest.attached`（45 s 超时）；`--no-launch` 时只报告应用未运行，握手和工具发现仍可正常完成。同一个桥里的并发工具请求共享一次启动操作，失败会逐个回复请求 id，下一次显式调用可以重试。工具调用再由 `bridge.mjs` 转发到无会话的 `/mcp`，将 SSE/JSON 响应逐条写回 stdout（诊断只走 stderr）。桥跟踪每个请求 id：SSE 中断、空/非 JSON/未完成响应与超时都会为尚未完成的请求返回一次 `-32000`，通知保持静默。`install <cursor|claude-code|claude-desktop|codex>` 合并写入对应客户端配置，统一注册 `npx --yes larto-mcp@latest`。桥只内置公开工具描述，不缓存应用状态、不持有凭证；升级桌面安装包不会替换客户端固定的旧 npm 包或本地桥脚本，需同步更新入口。

## 3. 安全模型

- 渲染层无 Node；shell preload 只暴露 `invoke(channel ∈ 白名单)` 与 `on(event ∈ 白名单)`。
- guest `<webview>`：`will-attach-webview` 强制使用项目内 guest preload，并固定 `nodeIntegration=false`、`contextIsolation=true`、`sandbox=true`、`webSecurity=true`；启动入口检测到任何 `--no-sandbox` 参数、Electron 实际开关或 `ELECTRON_DISABLE_SANDBOX` 环境变量即报错退出。AppImage 的 desktop entry 不携带该参数，Linux 原生构建还会解包检查实际 `Exec=` 行，避免打包器升级后静默降级隔离。自签名证书例外仅适用于实际解析为 loopback / RFC1918 的 IP、`localhost` / `*.localhost` 与 mDNS `.local` 名称；字符前缀相似的公网域名不会进入例外。
- guest Session 同时安装 Electron 的 permission check/request handler：仅 sanitized clipboard write 自动允许；剪贴板读取、摄像头/麦克风、定位、通知、全屏与 pointer lock 按 HTTP(S) origin 弹原生确认，选择仅保留到本次进程；未知权限与非 Web origin 默认拒绝，清缓存同时清除选择。注入桥的 JSAPI 剪贴板读写也复用同一策略，主进程从当前 guest WebContents 取 origin，忽略请求携带的 URL。Passport 登录窗口使用独立临时分区并拒绝全部 Web 权限。
- 账号 Cookie（`session`/`sessionList`）只在主进程内存与受保护的 `safeStorage` 密文中；Linux 检测到 `basic_text`/未知后端时绝不落盘，设置页明确提示会话仅在当前进程有效。渲染层只拿到 `AccountState`（姓名/头像/租户列表）。
- 外链 `app:openExternal` 只允许 `http(s):`、`mailto:`、`lark:`；shell 窗口与 guest 的 `window.open` 分别由 `window.ts`/`guest.ts` 的 `setWindowOpenHandler` 接管。生产 shell 顶层导航只接受精确的打包 renderer 入口，开发 shell 只接受配置的同源页面；IPC 还必须来自主窗口的 main frame 且当前 URL 可信。

## 4. 存储与路径

平台 userData 目录（macOS `~/Library/Application Support/Larto`、Windows `%APPDATA%/Larto`、Linux `~/.config/Larto`）：
- `settings.json`：`Settings`（`shared/settings.ts`），version 字段用于迁移。
- `account.json`：仅在系统提供受保护的 `safeStorage` 后端时存在；`sessionEnc` / `sessionListEnc` 是加密后的 base64。Linux `basic_text`/未知后端只使用内存，不写会话文件。
- 环境变量 `LARTO_USER_DATA=<dir>` 可把 userData / sessionData 整体指到别处（`scripts/e2e.mjs` 用临时目录，避免测试污染真实设置）。
- `logs/main.log`：超过 5MB 轮转为 `main.log.1`。
- `Partitions/h5-guest/`：H5 会话 `persist:h5-guest`（清缓存会 `clearStorageData` + `clearCache`）。
- 登录子窗口使用非持久分区 `login-<timestamp>`，关闭即丢弃。

## 5. 构建

- `electron.vite.config.ts`：main → ESM（`out/main/index.js`），preload → CJS（sandbox preload 必须 CJS），renderer → Vite/React；`@shared` 别名指向 `src/shared`。
- 三个 tsconfig：`tsconfig.node.json`（main + shared）、`tsconfig.preload.json`（preload，含 DOM）、`tsconfig.web.json`（renderer）。
- `electron-builder.yml`：macOS arm64/x64 均产出 DMG+ZIP，Windows x64 产出 NSIS/portable/ZIP，Linux x64 产出 AppImage/DEB/RPM/tar.gz；文件名均含平台与架构。有正式 Apple 凭据时启用 hardened runtime、entitlements、Developer ID 签名与公证；没有凭据时 `after-pack.mjs` 只对包内 `.app` 做可验证的 ad-hoc 签名，DMG/ZIP 容器不具备 Developer ID 签名，且该 fallback 不宣称 hardened runtime。Windows/Linux 当前未签名。Release workflow 在各原生 runner 构建并启动 unpacked app 冒烟，通过后才聚合发布元数据、SHA-256 与 GitHub artifact attestation。
- 官网 `website/`：纯静态（`index.html` / `styles.css` / `script.js`），跟随系统外观，自动识别平台只提供首选下载，完整矩阵始终可见。六张 WebP 由 `pnpm screenshots` 以匿名临时 profile 和本地 H5 诊断页从真实应用可重复生成，不含账号或租户数据。
- 图标：`resources/logo-source.png` → `scripts/make-icons.mjs`（sharp + iconutil）→ `build/icon.icns`、`build/icon.png`、`website/public/*`。

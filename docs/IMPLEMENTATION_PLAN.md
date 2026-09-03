# FeishuDevTools 实施计划（接力手册）

> 面向接力的人或 AI。读完本文件 + `docs/ARCHITECTURE.md` + `docs/progress.md`，不看聊天记录也能继续。
> 所有阶段都以「可验证的验收标准」结束；未经真实飞书环境验证的项一律标为 **UAT 待做**，不要在文档里写成已完成。

## 0. 目标与边界

**目标**：1:1 复刻飞书开发者工具「网页调试」模块（界面 + 工作流），原生 Apple Silicon，加 MCP；v0.1.0 可投入日常 H5 开发。

**范围内**（用户原始需求 1–6）

| # | 需求 | 代码位置 | 状态 |
| --- | --- | --- | --- |
| 1a | 设备机型切换（模拟器） | `src/shared/devices.ts`, `src/main/guest.ts`(CDP 仿真), `renderer/components/Simulator.tsx` | 完成，E2E 覆盖 |
| 1b | 调试器（Chromium DevTools 停靠） | `src/main/devtools-dock.ts`, `renderer/components/DevToolsPane.tsx` | 完成，E2E 覆盖 |
| 1c | 飞书扫码登录 / 多租户切换 | `src/main/account.ts`, `renderer/components/AccountMenu.tsx` | 代码完成，**UAT 待做** |
| 1d | 飞书官方 JSAPI（真实 `config` 鉴权 + `requestAuthCode` 等） | `src/preload/guest.ts`, `renderer/jsapi/host.ts`, `src/main/jsapi-backend.ts`, `src/main/openapi.ts` | 桥与路由完成；`requestAccess` 授权确认 UI 未做；鉴权链路 **UAT 待做** |
| 1e | 外观切换（暗/亮/系统） | `src/main/theme.ts`, `renderer/store/app.ts`, `styles/app.css` | 完成，E2E 覆盖 |
| 1f | URL 输入记录 | `settings.urlHistory`, `renderer/components/UrlBar.tsx` | 完成 |
| 1g | 二维码预览 / 推送 PC 端预览 | `src/main/preview.ts`, `renderer/components/modals/PreviewModal.tsx` | 二维码完成；PC 推送 **UAT 待做** |
| 1h | 清缓存 | `guest.ts#clearCache` | 完成，E2E 覆盖 |
| 1i | 自动更新（下载→安装→重启） | `src/main/updater.ts`, `modals/UpdateDialog.tsx`, `.github/workflows/release.yml` | 代码完成，**需要一次真实 Release 才能 UAT** |
| 1j | 系统菜单（帮助/设置/关于/检查更新…） | `src/main/menu.ts` + 各 modal | 完成 |
| 2 | MCP | `src/main/mcp.ts`（Streamable HTTP，仅回环） | 完成，E2E 就是通过 MCP 驱动的 |
| 3 | 名称/图标 | `build/icon.icns`, `resources/`, `scripts/make-icons.mjs` | 完成 |
| 4 | 官网（Apple 风、暗色切换） | `website/`（纯静态，无构建） + `pages.yml` | 完成；hero 为 CSS 绘制的产品图，可替换为真截图 |
| 5 | GitHub、v0.1.0、无 bug | `.github/workflows/*`, 本文件 §3 | 仓库/CI 完成；**v0.1.0 发布需走 §3 阶段 7** |

**范围外 / 不做**：小程序/网关/工作台等其它开发者工具模块；Intel/Windows/Linux 构建；账号密码自动登录；任何形式的"假登录"或伪造 open-apis 响应；把 `<webview>` 的 `contextIsolation`/`sandbox` 关掉。

**硬约束（违反即回退）**

1. `<webview>` 保持 `contextIsolation=true, sandbox=true, nodeIntegration=false`（`src/main/window.ts` 的 `will-attach-webview` 强制）。JSAPI 桥只能通过 `src/preload/guest.ts` 注入。
2. 主进程只暴露 `src/shared/ipc.ts` 里声明过的通道；新增通道必须同时改 `shared/ipc.ts`、`preload/shell.ts` 白名单、`main/ipc.ts`。
3. MCP 只监听 `127.0.0.1`，默认端口 17331；不做鉴权以外的"远程调试"。
4. 不提交密钥、Cookie、租户信息、截图中的个人信息。会话仅用 `safeStorage` 存于 userData。
5. 只支持 macOS arm64（`electron-builder.yml` 只有 `arm64`），最低 macOS 12。

## 1. 现状快照（写于 2026-09-03）

- 代码量约 7.3k 行 TS/TSX（`src/`），全部通过 `pnpm typecheck`（三个 tsconfig，strict + exactOptionalPropertyTypes）。
- `pnpm build` 产出 `out/main/index.js`（ESM）、`out/preload/{shell,guest}.js`（CJS，sandbox 要求）、`out/renderer/`。
- 自动化验证（本机全部通过，见 `docs/progress.md`）：
  - `pnpm test`：`tests/shared.test.ts` 7 个用例（URL 归一化、设备/UA、JSAPI 错误格式、i18n）。
  - `pnpm e2e`：`scripts/e2e.mjs` 启动应用，通过 MCP 依次验证：启动/健康检查、iPhone 13 仿真（390×733，dpr 3，screen 390×844）、Lark UA、JSAPI 回调 `:ok`、JSAPI 日志、Android 机型切换、缩放不改变 CSS 视口、DevTools 停靠 + 截图、关闭、窗口截图、主题切换、清缓存。
- 尚未做过：真实飞书账号登录、`tt.config` 真实鉴权、PC 预览推送、签名/公证、真实 Release 的自动更新。

## 2. 开发环境与命令

```bash
# 需要 Node ≥ 22.12、pnpm ≥ 10（package.json 里 packageManager 指定了 pnpm 版本，corepack 会自动用）
pnpm install
pnpm dev              # electron-vite 热更新开发
pnpm typecheck        # 三个 tsconfig
pnpm test             # vitest（tests/**）
pnpm build            # 产出 out/
pnpm e2e              # 需要先 build；MCP 驱动的端到端冒烟（本机有屏幕即可，不需要登录）
pnpm dist:unsigned    # 本机打未签名 dmg/zip 到 dist/（验证打包与启动）
pnpm icons            # 由 resources/logo-source.png 重新生成 icns/png
pnpm format           # prettier --write
```

- 日志：`~/Library/Application Support/FeishuDevTools/logs/main.log`（菜单「帮助 → 打开日志目录」）。
- 设置：同目录 `settings.json`；会话：`account.json`（Cookie 经 safeStorage 加密）。
- 一次性自检：`pnpm exec electron . --smoke-test=/tmp/smoke.png`（CI 用；等 guest 附着后截图退出，非 0 表示失败）。
- 开发时 MCP 地址：`http://127.0.0.1:17331/mcp`，健康检查 `GET /health`。

## 3. 阶段计划

每个阶段 = 目标 → 具体步骤 → 验收标准 → 验证命令。按顺序做；阶段 5–7 需要真实飞书账号和 Apple 开发者账号，由用户配合。

### 阶段 1 — 交互与像素级还原复核（0.5 天）

目标：对照 `docs/RESEARCH_OFFICIAL_TOOL.md` §2、§3 逐项核对 UI。

1. 运行 `pnpm dev`，与官方工具（`/Applications/飞书开发者工具.app`，如仍可运行）并排比对：工具栏高度 82px、标题栏 38px、模拟器工具条 28px、按钮态色 `#51565d`、地址栏 hover/focus、历史下拉、机型/缩放下拉。
2. 检查亮色主题下 `styles/app.css` 的 token（官方仅有暗色，亮色是按同一结构推导的），确保对比度 ≥ 4.5:1。
3. 检查 iPad/PC 机型下窗口最小尺寸是否够（`window.ts` `minWidth/minHeight`），过小时 Simulator 应出现滚动条而非裁切。

验收：无明显错位；截图对比差异只在字体渲染层面。验证：`pnpm e2e` 仍通过；人工截图存 `/tmp`（不要提交）。

### 阶段 2 — JSAPI 覆盖面补齐（1 天）

目标：官方 preload 支持而我们缺失的方法补全；保持三类路由（`main`/`shell`/`mock`，见 `shared/jsapi.ts`）。

1. 用官方 `extraResources/h5/preload.js` 的方法表（研究文档 §5.3）对比 `JSAPI_MAIN_METHODS`/`JSAPI_SHELL_METHODS`/`jsapi-mocks.ts`，列出差集。
2. `shell` 类（UI）：补 `biz.navigation.setLeft/setRight/setMenu` 的按钮渲染细节、`previewImage` 手势、`showActionSheet` 取消项文案；UI 全在 `renderer/components/JsapiOverlays.tsx` 与 `NavBar.tsx`。
3. `mock` 类：与官方相同的固定值（`jsapi-mocks.ts`），不要"更真实"。
4. `main` 类：`device.geolocation.*` 使用 `settings.mockLocation`（设置里可改）；无 mockLocation 时返回官方相同的默认坐标。
5. 每加一个方法：在 `tests/` 加路由分类断言；在 `scripts/e2e.mjs` 的测试页里加一次调用并断言 `:ok`。

验收：`pnpm test`、`pnpm e2e` 通过；`get_jsapi_log` 中无 `not handler api` 的常用方法。

### 阶段 3 — `requestAccess` 授权确认 UI（0.5 天）

目标：官方在 `requestAccess`（scope 授权）时会弹确认页 `/authen/v1/confirm_inner`。当前 `src/main/jsapi-backend.ts:100` 直接走无确认分支。

1. 在 `openapi.ts#requestAccess` 收到需要确认的响应（研究文档 §5.4 记录的 code）时，主进程用 `BrowserWindow`（`parent: mainWindow, modal: true`，独立 `partition` 与登录窗一致）加载确认 URL，携带账号 Cookie。
2. 监听 `will-redirect`/`did-navigate` 到成功页后取 `code` 返回给页面；用户关窗 → `JSAPI_ERROR.USER_CANCEL`。
3. 未登录时先触发 `account.login()`，成功后重试一次。

验收：用一个真实 H5（有 `requestAccess` 调用）走通；`get_jsapi_log` 显示 `requestAccess` 返回 `code`。**需要真实账号（UAT）。**

### 阶段 4 — 官网真图与文案（0.5 天）

1. 运行应用，打开一个公开页面（如 `https://open.feishu.cn/document/...`），暗/亮各截一张窗口图：可用 MCP `screenshot` 的 `window`（工具栏 + 模拟器）与 `devtools`（DevTools 面板）两张合成，或用 macOS 截屏。禁止包含账号信息。
2. 存到 `website/assets/hero-{dark,light}.png`，替换 `website/index.html` 中 `.shot` 的 CSS 产品图（保留 CSS 版本作为 `<noscript>`/回退也可）。
3. `pages.yml` 已配置；仓库 Settings → Pages → Source 选 GitHub Actions 后自动部署到 `https://ihopefulchina.github.io/FeishuDevTools/`。

验收：Pages 部署成功，Lighthouse 性能/可访问性 ≥ 90。

### 阶段 5 — 真实飞书 UAT（1 天，需要用户账号）

按下列清单逐项验证并把结果写进 `docs/progress.md`（只写结论，不写账号/租户名）：

1. 登录：右上「登录」→ 子窗口出现 passport 扫码页 → 扫码 → 窗口自动关闭 → 头像/姓名/租户显示正确。断网重试提示正确。
2. 会话恢复：退出应用再打开仍为登录态（`account.json` 中的密文由 safeStorage 解密）。
3. 切换租户：菜单列出所有租户；切换后 `account:changed` 事件刷新 UI，页面重新 `config` 成功。
4. 退出登录：Cookie 清除，页面 `config` 返回 `99991691`。
5. `tt.config`：在真实 H5 页面（用飞书 JSSDK）调用 → `verifyJsapiSignature` 走 `/open-apis/...`（研究文档 §5.4） → `config:ok`。
6. `tt.requestAuthCode`：返回 code，后端换 token 成功。
7. 预览：二维码用飞书 App 扫描能打开页面（`lark://client/web?isDev=1&url=...`）；`localhost` 被替换成局域网 IP 的提示正确；「PC 预览」能唤起本机飞书桌面端打开页面。
8. 环境切换（飞书/Lark）后所有域名随之切换，且切换时强制登出。

任何一项失败：先看 `main.log`；接口字段与研究文档不一致时，以线上真实响应为准更新 `account.ts`/`openapi.ts`，并把差异记进研究文档。

### 阶段 6 — 签名、公证与自动更新 UAT（0.5–1 天，需要 Apple 开发者账号）

1. 在仓库 Secrets 配置：`CSC_LINK`（Developer ID Application .p12 的 base64）、`CSC_KEY_PASSWORD`、`APPLE_ID`、`APPLE_APP_SPECIFIC_PASSWORD`、`APPLE_TEAM_ID`。没有证书时 Release 仍会产出未签名包（`CSC_IDENTITY_AUTO_DISCOVERY=false`），网站 FAQ 已写明 Gatekeeper 处理方式。
2. 先发一个预发布：`package.json` version 改为 `0.1.0-rc.1`，打 tag `v0.1.0-rc.1` 推送 → `release.yml` 产出 dmg/zip/`latest-mac.yml`。
3. 安装 rc.1；把 version 改为 `0.1.0-rc.2` 再发一次；在 rc.1 里「检查更新」→ 出现更新对话框 → 下载进度 → 「重启安装」→ 重启后版本为 rc.2。
4. 若 `electron-updater` 报签名校验错误，说明包未签名：macOS 上自动更新**必须**签名，此时只能保留"提示前往下载"路径（`UpdateDialog` 已有 GitHub Release 链接兜底）。

验收：rc→rc 自动更新一次成功；`spctl -a -vv FeishuDevTools.app` 显示 accepted（签名时）。

### 阶段 7 — v0.1.0 正式发布（0.5 天）

1. 阶段 1–6 的验收全部为通过或已在 `progress.md` 明确标注的已知限制。
2. 更新 `CHANGELOG.md`（新建）与 README 截图；`package.json` version = `0.1.0`。
3. `git tag v0.1.0 && git push --tags` → Release 产出并自动发布；网站的下载按钮通过 GitHub API 自动指向最新 arm64 dmg。
4. 发布后在一台干净的 Apple Silicon Mac 上首次安装验证：启动、登录、加载 H5、DevTools、预览、更新检查。

### 后续（v0.2+，非必须）

- DevTools 面板宽度可拖拽（现为固定比例）；记忆宽度到 settings。
- MCP：增加 `set_mock_location`、`login_state`、`network_log`（通过 `debugger` 的 `Network.*`）。
- 网络代理设置生效验证（`settings.proxy` → `session.setProxy`）。
- 多语言 DevTools（`--lang`）与 DevTools 主题跟随应用主题。

## 4. 关键实现约定（改代码前必读）

- **设备仿真**走 `webContents.debugger`（CDP `Emulation.setDeviceMetricsOverride` + `setTouchEmulationEnabled` + `setUserAgentOverride`），不是 `enableDeviceEmulation`。渲染层通过 `guest:setDevice` 把 `guestViewport(device)` 计算出的 CSS 视口尺寸传给主进程，主进程按 `{ width, height, deviceScaleFactor, mobile, screenWidth, screenHeight }` 下发。改机型 = `simulatorActions.changeDevice()` 一处。
- **DevTools 停靠**：`<webview>` 不能做 DevTools 宿主（electron#15874 Elements 空白）。用主进程 `WebContentsView` 叠加在窗口上，渲染层 `DevToolsPane` 只负责占位与上报 `getBoundingClientRect()`。两个坑已在 `devtools-dock.ts` 注释：① devtools:// 前端提交后 RWHV 处于 hidden，`did-finish-load` 后需 remove+add 一次 child view 才会绘制；② 相同 bounds 不要重复 `setBounds`，否则 surface 重置、`capturePage` 失败。模态框打开时 `setDevToolsBounds(visible=false)` 隐藏叠层。
- **JSAPI 桥**：`preload/guest.ts` 在主世界注入三种桥（iOS `WebViewJavascriptBridge`、PC `__LarkPCSDK__`、Android `LkWebViewJavascriptBridge`），根据机型 UA 选择；消息经 `ipcRenderer.sendToHost` → 渲染层 `jsapi/host.ts` 路由：`main` 走 `jsapi:backend` IPC，`shell` 由 React 覆盖层渲染，`mock` 直接回。所有调用记入 `jsapi:log`（MCP `get_jsapi_log`）。
- **账号**：`account.ts` 在子窗口加载 passport 登录页（研究文档 §4），成功页跳转时抓 `session` 等 Cookie；Cookie 明文只存在内存，落盘经 `safeStorage.encryptString`。`env` 切换必登出。
- **设置**：`store.ts` 原子写 JSON，Zod schema 在 `main/settings-schema.ts`（不要把 zod 打进渲染包）。渲染层通过 `settings:get/set` 与 `settings:changed` 事件同步（zustand `useApp`）。
- **IPC 契约**：`shared/ipc.ts` 是唯一事实来源；`preload/shell.ts` 只放白名单通道；`renderer/lib/bridge.ts` 的 `invoke/on` 带类型。
- **MCP**：`@modelcontextprotocol/sdk` `McpServer` + `StreamableHTTPServerTransport`，每请求无状态；工具列表见 README。新增工具 = 在 `mcp.ts` `registerTool` 一处 + README 表格 + `scripts/e2e.mjs` 一条断言。

## 5. 验证矩阵（提交前必跑）

| 命令 | 覆盖 | 时长 |
| --- | --- | --- |
| `pnpm format:check` | 代码风格 | 2s |
| `pnpm typecheck` | 三进程类型 | 10s |
| `pnpm test` | 纯函数 | 1s |
| `pnpm build && pnpm e2e` | 启动、仿真、JSAPI、DevTools、截图、主题、清缓存 | 15s |
| `pnpm dist:unsigned` 后打开 `dist/mac-arm64/FeishuDevTools.app` | 打包完整性 | 2min |

CI（`.github/workflows/ci.yml`）跑前四项 + `--smoke-test`。E2E 需要有显示器的 macOS runner，GitHub 的 macos-latest 可以跑但不作为必需项，避免偶发失败阻塞。

## 6. 风险与应对

| 风险 | 表现 | 应对 |
| --- | --- | --- |
| passport/open-apis 接口变更 | 登录后取不到用户/租户；`config` 一直失败 | 以线上响应为准修正 `account.ts`/`openapi.ts`；研究文档记录抓包字段 |
| DevTools 前端行为随 Electron 升级变化 | Elements 空白 / 不绘制 | 固定 Electron 主版本；`e2e` 的 DevTools 截图断言会第一时间暴露 |
| 未签名导致自动更新不可用 | `electron-updater` 报 code signature 错误 | 阶段 6；退化为"前往下载" |
| macOS 权限（定位/剪贴板） | JSAPI 返回 fail | `entitlements.mac.plist` 已声明；首次调用需用户在系统设置允许 |
| pnpm ≥10 阻止依赖构建脚本 | `electron` 二进制缺失 | `pnpm-workspace.yaml` 的 `allowBuilds` 已放行 electron/esbuild/sharp |

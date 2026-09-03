# 进度日志

按时间倒序追加。每条写清：做了什么、怎么验证的、结论、遗留。不要写账号/租户/密钥。

## 2026-09-03 — 基底框架完成（首次提交）

**完成**

- 逆向官方「飞书开发者工具」网页调试模块（ASAR 解包 + 运行时 CDP 检查），产出 `docs/RESEARCH_OFFICIAL_TOOL.md`：布局尺寸、色板、机型表、UA 规则、JSAPI 三种桥的消息格式、passport 登录流程、预览 schema、鉴权接口。
- 工程：Electron 44.1.1 / electron-vite 5 / React 19 / TS 5.9 strict（含 `exactOptionalPropertyTypes`）/ pnpm 11。三个 tsconfig；main ESM、preload CJS。
- 主进程全部模块（window/menu/theme/store/guest/devtools-dock/account/openapi/jsapi-backend/preview/updater/mcp/ipc/logger/http）。
- preload：shell 桥（白名单 IPC）与 guest JSAPI 桥（iOS/PC/Android 三种）。
- 渲染层：工具栏、地址栏 + 历史、账号菜单、模拟器（状态栏/导航栏/机型/缩放）、JSAPI 覆盖层（alert/confirm/prompt/toast/actionSheet/preloader/previewImage）、DevTools 占位、设置/关于/预览/更新四个 modal、中英文、三态主题。
- MCP：17 个工具（见 README），Streamable HTTP，仅回环。
- 官网 `website/`（纯静态，Apple 风格，暗/亮切换，GitHub API 自动填充最新 Release 下载链接）。
- CI：`ci.yml`（format/typecheck/test/build/--smoke-test）、`release.yml`（tag → arm64 dmg/zip → GitHub Release；签名/公证凭据可选）、`pages.yml`。

**验证（本机 macOS arm64）**

- `pnpm format:check` / `pnpm typecheck` / `pnpm test`（7 用例）通过。
- `pnpm build && pnpm e2e` 全部 PASS：启动与 MCP 健康、iPhone 13 仿真（innerWidth 390、dpr 3、screen 390×844）、Lark UA、JSAPI `setTitle`/`toast`/`getSystemInfo` 回调 `:ok` 且进入 JSAPI 日志、Nexus 5 切换（Android UA、360 宽）、缩放 75% 不改 CSS 视口、DevTools 停靠 + 面板截图（Elements 面板有 DOM 树）、关闭、窗口截图、主题切换、清缓存后页面存活。
- 手工核对 DevTools 截图：Elements/Styles 正常，非空白。

**过程中修掉的问题（供参考）**

1. `webview` 作为 DevTools 宿主时 Elements 面板空白（electron#15874）→ 改为主进程 `WebContentsView` 叠加。
2. `WebContentsView` 中 devtools:// 前端提交后 RWHV 保持 hidden（`document.visibilityState === 'hidden'`，`capturePage` 报 "Current display surface not available for capture"）→ `did-finish-load` 后 remove+add child view 一次即可绘制。
3. 相同 bounds 重复 `setBounds` 导致 surface 重置 → `devtools-dock.ts#setBounds` 去重。
4. `enableDeviceEmulation` 不稳定 → 改为 CDP `Emulation.*`，并由渲染层传入精确 CSS 视口。
5. 测试页内容溢出导致 Chromium 移动端视口缩放让 `innerWidth` 变 4 倍 → 测试页加 `word-break`；真实页面不受影响，但说明 `mobile: true` 时页面需自己设置 viewport meta。
6. `normalizeUrl('localhost:5173')` 被当作 `localhost:` 协议 → 只把 `scheme://` 或 `about:/data:/blob:/file:` 视为带协议。
7. `Session can only be received when app is ready` → `guestManager.installGlobalHooks()` 移到 `app.whenReady()` 之后。
8. zod 被打进渲染包 → schema 拆到 `main/settings-schema.ts`。

**未做 / 待 UAT（详见 IMPLEMENTATION_PLAN.md §3）**

- 真实飞书扫码登录、租户切换、`tt.config` 鉴权、`requestAuthCode`、PC 预览推送：代码完成，未用真实账号跑过。
- `requestAccess` 授权确认 UI 未实现（`jsapi-backend.ts` 内有注释）。
- 签名/公证、真实 Release 自动更新链路未验证。
- 官网 hero 目前是 CSS 绘制的产品图，未放真实截图。
- 未在干净机器上安装验证 dmg。

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

## 2026-09-04 — 阶段 1–4：布局复核、JSAPI 差集、requestAccess 授权弹窗、官网真图

**做了什么**

- 阶段 1（布局复核）：用 MCP 驱动应用逐个截取 iPhone 13 / iPhone 8 / Nexus 5 / iPad / iPad Pro / PC、缩放 75%/150%、深/浅主题、DevTools 开关的窗口截图（`/tmp/fdt-e2e/p1-*.png`，未入库）对照研究文档 §2。修正三处：
  1. 窗口最小宽度随机型：`window.ts#fitWindowToDevice()` 实现官方 `setBrowserOptions` 的 `deviceWidth + 70 + 387 + 100` 规则（PC 回到 909，按显示器工作区裁剪），`guest:setDevice` 之后调用，窗口过窄时自动加宽（iPad Pro → 1581）。
  2. 模拟器溢出：`.simulatorContent` 原来 `justify-content: center` 在内容超宽时会把左边裁掉且滚不到；改为 `.gadgetBox`（缩放后的实际尺寸）+ `margin: 0 auto`，`.gadget` 以左上角为缩放原点。PC 机型由 `.gadgetBox.pc` 填满列。
  3. 滚动条由常显改为悬停显示（`:hover::-webkit-scrollbar-thumb`）。
- 阶段 2（JSAPI 差集）：研究文档 §5.3 全部方法与 `JSAPI_MAIN_METHODS` / `JSAPI_SHELL_METHODS` / `jsapi-mocks.ts` 逐项对比，无缺失；未改代码。
- 阶段 3（`requestAccess` 授权确认）：重新读官方 `vendor.js` 中 passport `AuthzModal` 与 `libs/main/browsers/base.js`，确认官方流程是「`get_auth_info_inner` → 渲染层弹窗 → 同参数 `confirm_inner`」而非打开确认网页（已把结论写进 IMPLEMENTATION_PLAN 阶段 3）。实现：
  - `openapi.ts`：`AuthInfoInnerData` 类型、`parseAccessConsent()`、`confirmAccess()`；
  - `main/consent.ts`：`ConsentBroker`（事件 `jsapi:consent` → 等待 `jsapi:consentDecision`，180 s 超时 / 窗口关闭 / 新请求覆盖 = 拒绝）；
  - 新 IPC：事件 `jsapi:consent`、请求 `jsapi:consentDecision`（`shared/ipc.ts` + `preload/shell.ts` 白名单 + `main/ipc.ts`）；
  - `ConsentModal.tsx`：应用图标 ⇄ 飞书图标、「{appName}请求你的授权」、授权账号、权限列表（前 3 项 + 查看更多）、取消 / 授权；Esc、遮罩、切换到其它 modal 均按拒绝处理；DevTools 叠层在弹窗期间自动隐藏；
  - 错误码 `JSAPI_ERROR.ACCESS_REFUSED = 20047`、`ACCESS_INTERNAL = 20050`（passport 常量）；i18n `consent.*` 中英文。
- 阶段 4（官网真图）：应用加载本地示例 H5（虚构审批列表）、iPhone 13 + 停靠 DevTools，用 MCP `screenshot(window)` 与 `screenshot(devtools)` 按 `get_state().devtools.bounds` 合成，裁掉 Chromium DevTools 顶部「切换到中文」信息条，暗/亮各一张 → `website/public/hero-{dark,light}.webp`。`index.html` 的 `.shot` 改为两张 `<img>` 按 `data-theme` 切换，删除 CSS 产品图及其 token。
- 顺手修的真 bug：
  1. **DevTools 不跟随外观切换**：DevTools 前端只在加载时读 `prefers-color-scheme`，切深/浅色后仍是旧主题 → `devtools-dock.ts` 监听 `nativeTheme#updated` 重建 view；必须等 `devtools-closed` 再 `open`，否则 Elements 面板为空（已验证）。
  2. **父进程退出后日志 EPIPE 死循环**：spawn 应用的脚本先退出时 `console.error` 抛 EPIPE → `uncaughtException` 再 `console.error` → 无限循环刷 `main.log` 且占着单实例锁与 MCP 端口 → `logger.ts` 吞掉 stdout/stderr 的 `error` 并停止镜像到控制台。`scripts/e2e.mjs` 启动前先探测 `/health`，若已有实例在跑直接报错退出，避免测到旧实例。
- 测试基建：新增 `vitest.config.ts`（`@shared` 别名，`tests/**/*.test.ts`），`tests/openapi.test.ts` 4 个用例（授权载荷解析 / verify 错误码映射）。

**验证**

- `pnpm format:check` / `pnpm typecheck` / `pnpm test`（11 用例）/ `pnpm build` / `pnpm e2e`（14 项全部 PASS）。
- 人工截图核对（未入库）：六机型布局、75%/150% 缩放居中、iPad Pro 开 DevTools 时窗口自动加宽到 1581 且机身完整、深/浅主题、ConsentModal 深/浅两版（用临时环境变量触发 `ConsentBroker.ask()` 后已删除该调试代码）、切换主题后 DevTools 重建且 Elements 有 DOM 树、官网本地预览两种主题下 hero 图切换正常。

**遗留**

- `requestAccess` 只验证了 UI 与解析逻辑，`get_auth_info_inner` / `confirm_inner` 真实响应字段需 UAT 时核对（阶段 5）。
- DevTools 顶部的 Chromium「DevTools is now available in Chinese」信息条无法通过预置 `Preferences` 关闭（尝试 `electron.devtools.preferences` 与 `synced_preferences_sync_disabled` 均无效）；用户点一次「Don't show again」即持久关闭。
- 仍待用户执行：`gh repo create ihopefulChina/FeishuDevTools --public --source=. --remote=origin --push`，随后开启 Pages（Source: GitHub Actions）。

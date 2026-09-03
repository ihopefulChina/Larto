<p align="center">
  <img src="resources/icon.png" width="96" alt="FeishuDevTools" />
</p>
<h1 align="center">FeishuDevTools</h1>
<p align="center">
  飞书开发者工具「网页调试」模块的开源复刻，原生支持 Apple Silicon，内建 MCP。<br/>
  <a href="https://ihopefulchina.github.io/FeishuDevTools/">官网</a> ·
  <a href="https://github.com/ihopefulChina/FeishuDevTools/releases/latest">下载</a> ·
  <a href="docs/IMPLEMENTATION_PLAN.md">实施计划</a> ·
  <a href="docs/ARCHITECTURE.md">架构</a>
</p>

官方飞书开发者工具即将停止支持 ARM 版本。FeishuDevTools 以 1:1 的界面与工作流复刻其网页调试模块，让 H5 开发在 Apple Silicon Mac 上继续工作，并为 AI 助手加上了 MCP 接口。

## 功能

- **设备模拟器**：iPhone / Android / iPad / PC 机型预设，真实 UA（`Lark/x.y.z`）、DPR、屏幕尺寸与安全区；缩放 50%–150%；状态栏与导航栏同步渲染。
- **调试器**：完整 Chromium DevTools 停靠在窗口右侧（Elements / Console / Sources / Network / Application…）。
- **飞书扫码登录**：passport 扫码登录、多租户切换；会话经 `safeStorage`（Keychain）加密保存。
- **官方 JSAPI**：注入与飞书客户端一致的 JSAPI 桥（iOS / PC / Android 三种），`tt.config` 真实鉴权、`requestAuthCode`、`requestAccess`（含与飞书一致的授权确认弹窗）、剪贴板、定位、Toast / Modal / ActionSheet / 导航栏等。
- **预览**：生成真机预览二维码（`lark://client/web?isDev=1&url=…`，`localhost` 自动换成局域网 IP）或推送到本机飞书桌面端。
- **外观**：深色 / 浅色 / 跟随系统；中英文界面。
- **地址栏历史**（10 条）、**清缓存**、**自动更新**（GitHub Releases，下载后一键重启安装）。
- **系统菜单**：设置、关于、检查更新、帮助文档、日志目录等。
- **MCP 服务**：让 Cursor / Claude 等 AI 客户端直接操控模拟器。

## 安装

在 [Releases](https://github.com/ihopefulChina/FeishuDevTools/releases/latest) 下载 `FeishuDevTools-x.y.z-arm64.dmg`，拖入「应用程序」。要求 macOS 12+，Apple Silicon。

未经 Apple 公证的构建首次打开会被 Gatekeeper 拦截：在「系统设置 → 隐私与安全性」点击「仍要打开」，或执行
`xattr -dr com.apple.quarantine /Applications/FeishuDevTools.app`。

## MCP

应用启动后在 `http://127.0.0.1:17331/mcp` 提供 Streamable HTTP 的 MCP 服务（仅本机回环，端口可在设置里改）。

```jsonc
// Cursor: .cursor/mcp.json
{
  "mcpServers": {
    "feishu-dev-tools": { "url": "http://127.0.0.1:17331/mcp" }
  }
}
```

| 工具 | 作用 |
| --- | --- |
| `get_state` | 当前 URL、标题、机型、缩放、主题、DevTools 状态、账号、版本 |
| `navigate` / `reload` | 加载 URL（写入历史）/ 刷新 |
| `list_devices` / `set_device` | 机型列表 / 切换机型 |
| `set_zoom` / `set_theme` | 缩放（50/75/85/100/125/150）/ 外观 |
| `toggle_devtools` | 显示/隐藏停靠的 DevTools |
| `clear_cache` | 清理模拟器会话数据并刷新 |
| `screenshot` | `page`（页面）/ `window`（工具栏 + 模拟器）/ `devtools`（DevTools 面板）PNG |
| `evaluate` / `get_dom` / `click` / `fill` | 在页面执行 JS、读取 DOM、点击、填表 |
| `get_console` / `clear_console` | 页面控制台日志 |
| `get_jsapi_log` | 页面发起的 JSAPI 调用及模拟器的应答 |
| `focus_window` | 把窗口带到前台 |

`GET http://127.0.0.1:17331/health` 返回 guest 附着状态，可用于等待应用就绪。

## 开发

```bash
pnpm install          # Node ≥ 22.12, pnpm ≥ 10
pnpm dev              # 开发模式
pnpm typecheck && pnpm test
pnpm build && pnpm e2e   # MCP 驱动的端到端冒烟（约 15s）
pnpm dist:unsigned    # 本机打未签名 dmg/zip
```

目录：`src/main`（主进程）、`src/preload`（shell 桥 / guest JSAPI 桥）、`src/renderer`（React）、`src/shared`（契约与常量）、`website/`（官网，纯静态）、`docs/`（研究、架构、计划、进度）。详见 [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)。

## 发布

1. 修改 `package.json` 的 `version`，提交。
2. `git tag vX.Y.Z && git push --tags`。
3. `release.yml` 在 macOS runner 上构建 arm64 dmg/zip 与 `latest-mac.yml` 并发布到 GitHub Release；应用内自动更新与官网下载按钮都读取这个 Release。

签名与公证是可选的：在仓库 Secrets 中配置 `CSC_LINK`、`CSC_KEY_PASSWORD`、`APPLE_ID`、`APPLE_APP_SPECIFIC_PASSWORD`、`APPLE_TEAM_ID` 后自动生效。注意 macOS 上 electron-updater 的自动安装要求应用已签名；未签名时更新对话框会退化为跳转下载页。

## 状态

v0.1.0 基底框架已完成并通过自动化验证；真实飞书登录、JSAPI 鉴权、PC 预览推送、签名与自动更新链路仍待真实环境验收。详细状态、阶段计划与验收标准见 [`docs/IMPLEMENTATION_PLAN.md`](docs/IMPLEMENTATION_PLAN.md) 与 [`docs/progress.md`](docs/progress.md)。

## 致谢与声明

界面与交互参考飞书官方开发者工具。本项目为社区项目，与飞书 / 字节跳动无关；「飞书」是其所有者的商标。MIT License。

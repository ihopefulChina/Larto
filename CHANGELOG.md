# Changelog

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [SemVer](https://semver.org/lang/zh-CN/)。

## [0.1.0] — 2026-09-04

首个公开版本。飞书开发者工具「网页调试」模块的开源复刻，原生 Apple Silicon，内建 MCP。

### 新增

- 设备模拟器：iPhone / Android / iPad / PC 机型预设，真实 UA（`Lark/x.y.z`）、DPR、屏幕尺寸与安全区；缩放 50% / 75% / 85% / 100% / 125% / 150%。
- 停靠的 Chromium DevTools（Elements / Console / Sources / Network / Application）。
- 飞书 passport 扫码登录、多租户切换；会话经 `safeStorage`（Keychain）加密保存。
- 官方 JSAPI 桥（iOS / PC / Android）：`tt.config` 鉴权、`requestAuthCode`、`requestAccess`（含授权确认弹窗）、剪贴板、定位、Toast / Modal / ActionSheet / 导航栏等。
- 真机预览二维码（`lark://client/web?isDev=1&url=…`，`localhost` 自动换成局域网 IP）与推送到本机飞书桌面端。
- 深色 / 浅色 / 跟随系统；中英文界面；地址栏历史（10 条）；清缓存；系统菜单。
- MCP（`http://127.0.0.1:17331/mcp`，仅回环）：导航、机型、缩放、主题、DevTools、截图、DOM / 控制台 / JSAPI 日志等。
- 自动更新（GitHub Releases）。未签名构建无法走 macOS 自动安装，会退化为打开下载页。
- 官网：https://ihopefulchina.github.io/FeishuDevTools/

### 已知限制

- 真实飞书登录、`tt.config` / `requestAuthCode` / `requestAccess` 鉴权、PC 预览推送：代码已实现，**尚未用真实账号验收**。
- 本版本 **未签名、未公证**。首次打开需在「系统设置 → 隐私与安全性」选择「仍要打开」，或执行 `xattr -dr com.apple.quarantine /Applications/FeishuDevTools.app`。
- 仅 macOS 13+ Apple Silicon（arm64）。不做 Intel / Windows / 小程序等其它模块。

[0.1.0]: https://github.com/ihopefulChina/FeishuDevTools/releases/tag/v0.1.0

# Changelog

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [SemVer](https://semver.org/lang/zh-CN/)。

## [0.1.1] — 2026-09-04

跨平台发布版本。将网页调试工作台扩展到 macOS 双架构、Windows x64 与 Linux x64，并把下载、校验、MCP 发布和安全披露纳入同一条可追溯的发版链路。

### 新增

- macOS Apple Silicon（arm64）与 Intel（x64）各提供 DMG / ZIP。
- Windows x64 提供 NSIS 安装版、便携版与 ZIP。
- Linux x64 提供 AppImage、DEB、RPM 与 tar.gz。
- Release 汇总生成 `SHA256SUMS.txt`，所有资产文件名明确标注平台与架构。
- Release 在 macOS Apple Silicon / Intel、Windows 与 Linux 原生 runner 上启动打包后的应用并验证非空截图，再允许聚合发布；产物同时生成 GitHub artifact attestation。
- `feishu-devtools-mcp@0.1.1` 作为公开 npm stdio 桥发布；支持 Cursor、Claude Code、Claude Desktop 与 Codex 一键注册，并能跨平台拉起已安装的应用。
- 跨平台 CI / Release 矩阵在对应原生 runner 上验证、构建并汇总发布资产。

### 修复

- 修复飞书 passport `{code, data}` 信封、多租户列表与 `credential_id` 解析错误造成的扫码后仍显示登录失败。
- 修复应用未 ready 时读取 `safeStorage` 导致已有会话被误判为退出的问题；过期头像保持原色并用状态描边提示。
- 修复 MCP 健康检查先于模拟器 attach 时，首个 `navigate` 请求可能被吞掉的问题。
- 修复移动设备触摸模拟干扰 DevTools「选择元素」，以及原生 DevTools 盖住账号菜单、地址历史和弹窗的问题。
- 修复深色模式下模拟器外壳仍为白色、iPhone Home Indicator 产生独立有色安全区、地址栏与定位 placeholder 对比过强等视觉问题。
- PC 模拟器支持直接拖动 viewport，并可在随窗口伸缩与固定尺寸之间切换。
- 检查更新在离线启动时保持安静，跳过版本与手动检查行为分离；更新说明以白名单清洗后显示。
- Linux 没有受保护的 Secret Service / KWallet 后端时不再持久化登录 Cookie，并在设置中明确提示会话只保留到退出应用。
- AppImage 不再携带 `--no-sandbox`；如果启动环境仍注入该参数，应用会在载入网页前拒绝启动。网页的剪贴板读取、媒体、定位、通知、全屏与 pointer lock 改为按来源明确授权；JSAPI 的剪贴板读写也必须经主进程按当前 guest 来源确认，未知权限默认拒绝。Passport 登录分区不需要 Web 权限并全部拒绝。
- 本地开发服务器的自签名证书例外现在先确认主机名是实际私网 IP；形似 `127.example.com` 或 `10.example.com` 的公网域名不再被误判为私网并放行无效证书。
- 特权 shell 只允许导航到精确的打包入口或开发服务器同源页面；主进程 IPC 同时校验主窗口、主 frame 与 shell URL，不再把任意 `file:` 页面视为可信调用方。
- MCP 端口切换改为串行生命周期，连续修改设置不会并发监听或显示旧状态；客户端安装器以原子替换写配置，覆盖前保留 `.bak`，并兼容符号链接与带 UTF-8 BOM 的 Windows JSON。
- 设置只有在原子写盘成功后才更新内存与通知界面；网络、账号与 JSAPI 异常日志改为安全摘要，不再写入原始响应。

### 变更

- 默认外观改为深色、默认设备改为 iPhone 17 Pro；默认窗口按设备完整高度计算。
- 应用 Bundle ID 统一为 `app.ihopeful.FeishuDevTools`。
- 工具栏、设置、检查更新、设备与缩放控制重新整理为更接近开发者工具的信息密度与层级。
- README 与官网重写为跨平台发布文档；新增自动平台识别、手动下载矩阵、安全边界、签名状态、SHA-256 校验与 UAT 状态说明。
- 官网的六张明暗主题产品图改为由匿名本地诊断页与临时 profile 可重复生成，避免账号、租户或内部地址进入公开截图。

### 已知限制

- 真实飞书扫码登录、多租户切换、`tt.config`、`requestAuthCode`、`requestAccess` 与 PC 推送已实现，但仍需真实账号 / 租户 UAT。
- macOS DMG / ZIP 内的 `.app` 当前仅做 ad-hoc 签名且未公证，下载容器没有 Developer ID 签名；Windows 与 Linux 构建未签名。首次启动可能出现系统安全提示，正式代码签名仍待配置。
- Linux 登录会话的 `safeStorage` 保护强度取决于桌面环境提供的密钥环；建议启用兼容 Secret Service 的安全存储。
- macOS x64、Windows x64 与 Linux x64 的原生安装、更新和桌面集成仍需在对应系统持续 UAT。

## [0.1.0] — 2026-09-04

首个公开版本。飞书开发者工具「网页调试」模块的开源复刻，原生 Apple Silicon，内建 MCP。

### 新增

- 设备模拟器：iPhone / Android / iPad / PC 机型预设（默认 iPhone 17 Pro，机身圆角），真实 UA（`Lark/x.y.z`）、DPR、屏幕尺寸与安全区；缩放 50% / 75% / 85% / 100% / 125% / 150%。
- 停靠的 Chromium DevTools（Elements / Console / Sources / Network / Application），默认打开；深色主题与应用配色一致；「选择元素」可在模拟器中直接取元素。
- 飞书 passport 扫码登录、多租户切换；会话经 `safeStorage`（Keychain）加密保存。
- 官方 JSAPI 桥（iOS / PC / Android）：`tt.config` 鉴权、`requestAuthCode`、`requestAccess`（含授权确认弹窗）、剪贴板、定位、Toast / Modal / ActionSheet / 导航栏等。
- 真机预览二维码（`lark://client/web?isDev=1&url=…`，`localhost` 自动换成局域网 IP）与推送到本机飞书桌面端。
- 深色 / 浅色 / 跟随系统；中英文界面；地址栏历史（10 条）；清缓存；系统菜单。
- MCP（`http://127.0.0.1:17331/mcp`，仅回环）：导航、机型、缩放、主题、DevTools、截图、DOM / 控制台 / JSAPI 日志等。
- 自动更新（GitHub Releases）。未签名构建无法走 macOS 自动安装，会退化为打开下载页。
- 官网：https://ihopefulchina.github.io/FeishuDevTools/

### 2026-09-04 重新打包（版本号不变）

首次打包的试用反馈，已在同一版本号下修正并重新发布：

- 应用图标：macOS 26 会把形状不符合系统 squircle 网格的旧式图标缩小放进灰色底板，这就是图标"偏小、四周留白"的原因。现在把图标渲染进精确的 macOS squircle（824/1024、连续曲率圆角），Dock / Finder 中与其它 App 同样大小、无底板。
- 窗口默认尺寸按机型算（iPhone 17 Pro → 1180×1050），能完整露出模拟器；切到更高的机型或放大缩放时窗口自动撑高，不超过屏幕。
- 首次启动默认深色主题、iPhone 17 Pro，且调试器随窗口打开；模拟器机身四角圆角。
- DevTools「选择元素」：移动机型的触摸模拟会吞掉鼠标 hover，导致不高亮、点不中；进入选择模式时自动暂停触摸模拟，选完恢复。
- DevTools 深色主题改为应用同款配色（#1f2329 / #2b2f36 / #373c43）。
- 账号菜单、地址栏历史等弹层会被原生 DevTools 视图盖住：弹层打开时先截图冻结面板再隐藏视图，关闭后恢复。
- 未登录时点「登录」直接打开登录窗口，不再先展开二级菜单。
- 扫码登录后仍显示未登录：passport 接口响应是 `{code, data}` 信封，此前按裸对象解析导致用户信息读不到；同时按 `code 34/4401/4` 识别会话过期、正确解析 `web_list` / `user_center` 租户列表、租户切换改用目标身份的 `credential_id`。
- 「无法打开」：完全未签名的包在 Apple Silicon 上被 Gatekeeper 判为「已损坏」且无法放行。打包时若没有 Developer ID 证书，现在对 `.app` 做 ad-hoc 签名，首次打开变为可在「隐私与安全性」中「仍要打开」的常规提示。
- 检查更新对话框重做为 Sparkle 风格：应用图标、版本行、GitHub Release 的更新说明（HTML 经白名单清洗）、「自动检查更新」复选框；按钮为「跳过这个版本 / 稍后提醒我 / 安装更新」，下载完成后「安装并重新启动」，失败时「前往下载页」。跳过的版本静默检查不再提示，手动检查仍会报告。离线启动不再弹出「检查更新失败」。
- 应用启动后立刻通过 MCP `navigate` 会被吞掉（`/health` 就绪早于渲染层拿到 webview）：现在 attach 失败会重试，早到的 URL 排队到 attach 后加载。
- 深色主题下模拟器机身、状态栏、导航栏和 Home 指示条仍为白色 → 改为跟随主题的 `--sim-*` 色板；网页内容自身配色不变，无背景的页面仍在白色画布上渲染（与官方 `#iframeContainer webview` 一致）。
- 地址栏不再随窗口拉伸：输入框固定 320px（与官方 `.urlbox .select { width: 320px }` 一致），整体约 386px（含历史箭头），「预览 / 清缓存」紧随其后。
- 工具条「预览 / 清缓存 / 模拟器 / 调试器 / 登录」改为 14px 图标 + 文案的描边按钮（高仍 28px）；地址栏内刷新/历史保持无边框。
- 新增待首次发布的 npm 包 `feishu-devtools-mcp`：stdio ↔ 本地 MCP 服务器的桥，应用未运行时自动拉起并等待就绪；发布后以 `npx --yes feishu-devtools-mcp@latest install <cursor|claude-code|claude-desktop|codex>` 一条命令写入客户端配置。
- 官网与 README 重写：跟随系统外观、真实截图（模拟器 / DevTools 分栏）、MCP 与 npm 桥的接入说明、Gatekeeper 与登录数据的常见问题。
- 刘海机型状态栏时间 / 信号贴在圆角上：水平内边距改为随圆角半径计算（14 Pro 约 26px）。
- 机型列表在官方 20 组之外增加 iPhone 15 / 16 / 17 / Air。
- PC 预设默认仍随窗口伸缩（官方 `calc(100% - 40px)`）；右下角可直接拖动调整 viewport，工具条也可指定宽高，或点「适应窗口」回到随窗口。
- 14 Pro 及更新机型的状态栏改为灵动岛（居中胶囊），时间 / 信号与岛垂直对齐；iPhone 13 仍为刘海。登录后头像不再套工具条描边芯片。机型菜单按 iPhone / Android / iPad / PC 分组。
- 启动时在 `app.ready` 之前解密登录会话会抛错并把已登录用户打成未登录；现在等 ready 后再读 Keychain。
- 应用 Bundle ID 改为 `app.ihopeful.FeishuDevTools`；登录资料请求避免默认 Session Cookie 覆盖扫码会话，过期头像保持原色并用描边提示。
- 设置与检查更新界面统一为深色分组卡片；地址栏和模拟定位 placeholder 降低视觉噪音，设备/缩放控制收成紧凑胶囊；iPhone Home Indicator 改为覆盖层，不再产生独立有色安全区。

### 已知限制

- 真实飞书登录、`tt.config` / `requestAuthCode` / `requestAccess` 鉴权、PC 预览推送：代码已实现，**尚未用真实账号验收**。
- 本版本为 **ad-hoc 签名、未公证**。首次打开需在「系统设置 → 隐私与安全性」选择「仍要打开」；若提示「已损坏」，执行 `xattr -dr com.apple.quarantine /Applications/FeishuDevTools.app` 后重试。macOS 上 electron-updater 的静默安装需要 Developer ID 签名，因此应用内更新会跳转下载页。
- 仅 macOS 13+ Apple Silicon（arm64）。不做 Intel / Windows / 小程序等其它模块。

[0.1.1]: https://github.com/ihopefulChina/FeishuDevTools/releases/tag/v0.1.1
[0.1.0]: https://github.com/ihopefulChina/FeishuDevTools/releases/tag/v0.1.0

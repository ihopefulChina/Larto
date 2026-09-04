# 进度日志

按时间倒序追加。每条写清：做了什么、怎么验证的、结论、遗留。不要写账号/租户/密钥。

## 2026-09-04 — v0.1.1 npm、Release 与本机安装

**做了什么**

- 首次公开发布 `feishu-devtools-mcp@0.1.1`，并把 `ihopefulChina/FeishuDevTools` 的 `.github/workflows/release.yml` 配置为 npm Trusted Publisher；Codex 用户配置只新增 `[mcp_servers.feishu-devtools]`，运行命令为 `npx --yes feishu-devtools-mcp@latest`，原配置完整备份到 `config.toml.bak`。
- 创建并推送注释 tag `v0.1.1`。Release 工作流重新在原生 runner 生成 macOS arm64/x64、Windows x64、Linux x64 包，完成打包后启动 smoke、19 项发布资产校验、SHA-256 清单和 GitHub artifact attestation，再将含 20 个附件的 Release 从草稿原子公开。
- 将本机 `/Applications/FeishuDevTools.app` 的旧 0.1.0 移入废纸篓后安装 0.1.1 arm64，并刷新 LaunchServices/Dock 图标缓存；用户设置目录未删除。旧开发实例不响应正常退出且忽略 `SIGTERM`，确认其精确 PID/可执行路径后仅终止该实例，再执行替换。
- 正式 tag 流程的 `publish-mcp` 在包已存在时暴露顺序缺陷：内容检查先执行 `npm publish --dry-run`，npm 11 将不可覆盖的既有版本判为失败，使后续“已发布则跳过”无法运行。内容检查改为不访问 registry 的 `npm pack --dry-run --ignore-scripts`；实际发布步骤仍先查询精确版本，存在即保持不变。

**验证**

- `npm view feishu-devtools-mcp@0.1.1` 返回 `latest=0.1.1`、发布 integrity/shasum；`npx --yes feishu-devtools-mcp@0.1.1 --version` 返回 0.1.1。Trusted Publisher 创建成功，限定仓库、`release.yml` 和 publish 权限。
- 手动 Release 门禁 `33871463954` 全平台成功；正式 tag run `33873672040` 的 validate、macOS arm64/x64、Windows、Linux 与 `publish-release` 全部成功。公开 Release 为非草稿、非预发布，20 个附件均为 uploaded；attestation 为 19 个发布主体并进入 Sigstore/Rekor。
- 从公开 Release 重新下载 `SHA256SUMS.txt` 与 arm64 DMG：清单恰含 19 项，DMG 的 SHA-256 匹配，`hdiutil verify` 通过，`gh attestation verify --repo ihopefulChina/FeishuDevTools` 返回成功。
- 本机安装版版本 0.1.1、Bundle ID `app.ihopeful.FeishuDevTools`、arm64、最低 macOS 13；新图标 SHA-256 为 `fd02dc5e0c4d5f4d0596890e31defa2fef148527831aefdece4a4595e973e128`，`codesign --verify --deep --strict` 与 `/health` 200 通过，当前从 `/Applications` 启动。Codex `config.toml` 与备份均为有效 TOML、权限 0600；结构化比对确认除新增 MCP 表外其余配置未变。
- 工作流修复运行 MCP Node Test 20/20、`npm pack --dry-run --ignore-scripts`、定向 Prettier 与 `git diff --check`，全部通过。

**结论 / 遗留**

- v0.1.1 应用 Release 与 npm MCP 已公开，本机应用和 Codex MCP 已安装；Codex 需要重启一次后在 `/mcp` 查看新 server。
- 正式 tag run 的最终总状态因上述 npm dry-run 顺序缺陷显示 failure，但应用 Release、证明与 npm 实际状态均已独立核验成功；修复保留在 main，供后续 tag 使用，不移动已公开的 v0.1.1 tag。
- 真实飞书扫码登录、多租户、`tt.config` / `requestAuthCode` / `requestAccess`、真实更新下载安装仍待账号/租户 UAT。macOS 仅 ad-hoc 签名且未公证，Windows/Linux 未签名；Linux unpacked smoke 不等于每一种安装格式的真实发行版 UAT。

## 2026-09-04 — v0.1.1 图标复核与跨平台 CI 收口

**做了什么**

- 核对用户截图、已安装应用与当前候选包：`/Applications/FeishuDevTools.app` 仍是 0.1.0，旧 ICNS 会被 macOS 26 缩进灰色系统底板；0.1.1 的现有 ICNS 已按标准 squircle 重生成。本轮不引入只有 Xcode 26 能重现的静态 `Assets.car`，保持 macOS 13–15 回退路径单一。
- 修复 Windows runner 的全库 Prettier 假失败：新增 `.gitattributes` 将文本工作树统一为 LF，不放宽 Prettier 规则，二进制图片仍由 Git 自动识别为 `-text`。
- 修复 Ubuntu runner 的 Electron smoke 启动失败：在源码 smoke 和打包后 `linux-unpacked` smoke 前，验证 `chrome-sandbox` 是工作区内的普通文件，再设置为 `root:root 4755` 并断言数值权限。依旧禁止 `--no-sandbox`，不用 root 启动应用；PR 不对可修改的工作区二进制设 SUID，完整 Linux smoke 在 main push 上执行。
- 远程 Intel smoke 暴露官方欢迎页的公网依赖：应用与设备仿真已启动，但加载飞书 CDN 超时导致假失败。CI 和 Release 的四平台 smoke 改用隔离 userData 中的本地 `data:` 页，正常用户的默认首页不变。
- Windows 单测不再把 macOS `/Applications/...` 字面路径当作跨平台 fixture；改用当前平台的绝对路径 round-trip，保持生产代码对打包入口的精确匹配，不放宽 shell 导航安全边界。
- Release 的 macOS Intel 打包后 smoke 补齐隔离配置中的 `lastUrl`，与 arm64、Windows、Linux 一致使用本地 `data:` 页，不再在正式发布矩阵里重新引入公网依赖。
- Ubuntu 源码 smoke 已完成安全沙箱、guest 仿真与 DevTools 附着，但 Xvfb 的 GPU 截图路径偶发 `UnknownVizError`；该步骤补 `--disable-gpu`，与既有 Linux 打包后 smoke 保持一致，不改变应用默认启动参数。
- MCP 包的跨平台路径分支不再借用运行测试机器的默认 `node:path.join`：macOS/Linux 显式用 `posix`、Windows 继续用 `win32`，确保 Windows 上也能可靠校验和生成各平台应用候选及 Claude Desktop 配置路径。

**验证**

- macOS 26.6.2 用 `NSWorkspace.icon(forFile:)` 实际渲染：0.1.0 安装包精确复现「灰底大图标 + 居中小图标」；纯 ICNS 的 0.1.1 候选包为满尺寸图标、无灰底。重打 arm64 app 后确认版本 0.1.1、`CFBundleIconFile=icon.icns`、无 `CFBundleIconName`/`Assets.car`，且 `codesign --verify --deep --strict` 通过（ad-hoc）；已启动该候选包供试用。
- `git ls-files --eol` 显示文本为 `i/lf w/lf attr/text=auto eol=lf`，现有 PNG/ICNS/WebP 仍为 `-text`。`pnpm format:check && pnpm typecheck && pnpm test && pnpm build && FDT_MCP_PORT=17471 pnpm e2e` 全部通过：Vitest 15 文件 / 78 项、Node Test 23/23，E2E 含 18 个 MCP 工具与 stdio 往返。使用与远程相同的隔离配置运行本地 `data:` smoke，6 秒内完成 guest/DevTools 附着、生成非空截图并返回 0。
- `pnpm exec vitest run tests/window.test.ts`：4/4 通过；MCP 路径修复后又运行 `node --test packages/feishu-devtools-mcp/test/*.test.mjs`（20/20）以及 `pnpm format:check && pnpm typecheck && pnpm test && pnpm build && FDT_MCP_PORT=17482 pnpm e2e`，全部通过（Vitest 15 文件 / 78 项、Node Test 23/23、E2E 24/24）。远端 Windows 仍以新 commit 的原生 runner 结果为准。

**结论 / 遗留**

- 图标问题是试用时误启动旧安装包，0.1.1 候选资产已满足当前视觉验收；发布时不能混入 0.1.0 包。
- 本条记录时 Windows LF 与 Linux sandbox 修复尚待最终 commit 的远程原生 CI 验证；四平台全绿前不创建 tag/Release。AppImage/DEB/RPM/tar.gz 的真实安装 UAT 仍不能由 `linux-unpacked` smoke 代替。

## 2026-09-04 — v0.1.1 跨平台发布候选与公开资料收口

**做了什么**

- 将发布目标扩展为 macOS arm64/x64（DMG、ZIP）、Windows x64（NSIS、portable、ZIP）与 Linux x64（AppImage、DEB、RPM、tar.gz）；CI/Release 使用对应原生 runner 构建和启动 unpacked app，聚合前校验 19 个目标资产，再生成 SHA-256 清单与 GitHub artifact attestation。应用、MCP、更新元数据与 Release 统一为 0.1.1。
- 新增公开 npm 包 `feishu-devtools-mcp`：stdio 桥、跨平台应用发现与拉起、Cursor / Claude Code / Claude Desktop / Codex 安装命令。安装器只合并自身条目，以同目录临时文件 + rename 原子替换，覆盖前保留 `.bak`；保留 JSON/TOML 换行与缩进、文件权限、符号链接及 UTF-8 BOM，无变化不重写。
- README、官网、CHANGELOG 与 SECURITY 重写为可核验的跨平台发布资料：明确下载矩阵、系统要求、校验命令、MCP 边界、真实 UAT 状态和签名限制；官网换为六张匿名诊断页实机截图，未包含账号、租户或内部地址。仓库启用 GitHub 私密漏洞报告。
- 继续收口发布前缺陷：MCP 监听生命周期串行化；设置原子写盘成功后才更新内存/广播；登录、HTTP 与 JSAPI 异常日志只保留错误类型、错误码、状态码和主机等安全摘要。特权 shell 的开发态导航同时校验协议和 origin，并拦截重定向；CI 专用 smoke 截图完成后确定性退出，避免原生 helper teardown 造成假超时。
- 保留本轮工作台与试用修复：默认深色/iPhone 17 Pro、PC viewport 拖拽、透明移动端底部安全区、低噪声地址栏/placeholder、设置/更新二级界面、登录 Cookie/头像、更新与设备切换竞态。产品仍只做官方「网页调试」范围，没有加入小程序编译、编辑器或上传。

**验证**

- 最终源码运行 `pnpm format:check && pnpm typecheck && pnpm test && pnpm build && pnpm e2e`：全部通过；Vitest 15 文件 / 78 项，Node Test 23/23。E2E 覆盖首次 iPhone 17 Pro 仿真、650ms 慢页面与连续切机 latest-only、PC resize、DevTools、主题、缓存、npm tarball 安装后的 18 个 MCP 工具与 stdio 往返。
- `pnpm dist:unsigned` 生成最终 macOS 双架构候选；`verify-release-assets` 校验 9 个 macOS 资产，Mach-O 分别为 arm64/x86_64，两个 `.app` 的 Bundle ID 均为 `app.ihopeful.FeishuDevTools`、版本均为 0.1.1。两份 `.app` 通过 `codesign --verify --deep --strict`（ad-hoc），两份 DMG 通过 `hdiutil verify`。
- 最终 arm64 包与 x64 包（Rosetta）均真实启动、完成 guest/DevTools 附着、生成非空截图并返回 0；arm64 16s，x64 冷启动 115s。此前发现的截图后退出等待已改为 CI smoke 确定性结束并在这轮验证。
- 独立只读终审未发现剩余 P0/P1 代码缺陷；发现的配置写入、MCP 并发、日志脱敏、开发态 `blob:`/redirect 边界均已在最终候选补齐并新增回归测试。

**结论 / 遗留**

- 本地源码、完整 E2E 与 macOS 双架构候选通过，可以进入远端门禁；本条记录时尚未提交、推送、发布 npm、创建 v0.1.1 tag 或公开 Release。
- 必须先让最终 commit 的 main CI、Pages 与手动 Release 全平台原生矩阵通过，并先完成 npm 首次发布/Trusted Publisher，再创建 tag；任何一步失败都不能宣称 0.1.1 已发布。
- 真实飞书扫码登录、多租户、`tt.config` / `requestAuthCode` / `requestAccess`、真实更新下载安装仍待账号/租户 UAT。macOS 仅 ad-hoc 签名且未公证，Windows/Linux 未签名；这些限制继续在 README、官网、SECURITY 与 Release 公开披露。

## 2026-09-04 — 试用反馈第三轮：登录 Cookie、iPhone 17 Pro、PC 拖拽与二级界面

**做了什么**

- 应用 Bundle ID 改为 `app.ihopeful.FeishuDevTools`；MCP stdio 包的自动拉起目标同步更新。
- 新增独立 iPhone 17 Pro（402×874、DPR 3、iOS 26）并设为首启默认；默认主题保持深色，窗口继续按完整机身高度计算。Home Indicator 改为网页上方的透明覆盖层，guest viewport 不再为底部额外扣一段高度或绘制独立背景。
- PC 模式新增右下角拖拽手柄：拖动过程实时预览 CDP viewport，latest-only 单飞队列避免乱序，松手后只持久化一次；拖动时固定左上角保证手柄 1:1 跟手，结束后恢复居中。支持 Esc 取消、方向键微调、宽高输入与「适应窗口」。PC 不再显示无效的移动端缩放下拉。
- 登录资料请求继续走 Electron Session 代理，但加 `credentials: 'omit'`，防止 default Session 的同名 Cookie 覆盖扫码临时分区取得并显式传入的 `session/session_list`；补回归测试。过期账号头像保留原色，仅用琥珀描边提示状态。
- 深色工作台按微信开发者工具式层级继续收口：外部模拟器画布、机身与控件跟随深色；被调试 H5 仍按自身颜色渲染，透明页面使用浏览器白色画布，避免篡改页面后出现黑字黑底。地址栏改为低对比表面；设备/缩放模块收成紧凑胶囊。
- 设置页改为分组卡片；MCP、更新、代理、模拟定位分别成组，深色 placeholder 使用独立 token 且经纬度有可辨识示例。检查更新弹窗统一表面、间距、按钮层级与模糊遮罩。修复前端层样式误把过期头像灰阶化的问题。
- `feishu-devtools-mcp` 补 package-local MIT LICENSE 与公开发布配置；安装器/文档生成 `npx --yes feishu-devtools-mcp@latest`。E2E 先 `npm pack`、安装生成的 tarball，再运行安装后的 bin 做真实 stdio 往返；准备阶段失败也清理临时目录。

**验证**

- `pnpm format:check && pnpm typecheck && pnpm test && pnpm build && pnpm e2e`：全部通过；Vitest 8 文件 / 46 项、MCP Node Test 11/11。E2E 覆盖首启 iPhone 17 Pro（inner 402×771、screen 402×874、DPR 3、touch 5）、iOS/Android/PC、快速切机竞态、DevTools、主题、缓存，以及从 npm tarball 安装后的 18 个 MCP 工具与 `get_state` 往返。
- CUA 实机视觉检查设置页、检查更新与默认工作台；PC 手柄从 550×870 拖到 687×870，实时值变化并在松手后进入 1:1 固定模式。检查中发现透明欢迎页在强制深色 canvas 下对比度丢失，已改回中性白色网页 canvas 后再复核。
- `npm pack --dry-run --json`：包内含 LICENSE；registry 查询当前仍为 404，未把源码存在误报为已发布。
- `pnpm dist:unsigned`：arm64 app / dmg / zip 构建完成；`Info.plist` 的 `CFBundleIdentifier = app.ihopeful.FeishuDevTools`、版本 0.1.0，`codesign --verify --deep --strict` 与 `hdiutil verify` 均通过（ad-hoc，未公证）。

**结论 / 遗留**

- 本地代码、构建、自动化和本机拖拽/视觉检查通过；未提交、未推送、未打 tag、未发布 npm 或应用 Release。
- 仍待用户真实 UAT：飞书扫码登录后的账号资料/头像/租户切换、`tt.config` / `requestAuthCode` / `requestAccess`，以及真实更新下载安装。
- `feishu-devtools-mcp` 仍需获得明确发布授权并由有 npm 权限的账号完成首次 registry 发布；在 registry 可见前，`npx ...@latest` 不能作为已可用能力宣传。

## 2026-09-04 — Bug 收口 + 微信开发者工具式工作台重构

**做了什么**

- 先按真实调用链修 Bug：
  - 首次 H5 导航先停在 `about:blank`，等待 guest attach 与全部 CDP 设备仿真完成；PC 自适应首次加载还会等布局并使用实际面板尺寸，避免首屏脚本读到桌面 viewport、`maxTouchPoints=0` 或 `inner/screen` 不一致。attach 期间切换设备会按最新稳定设置重配；CDP 任一指令失败会真实回传、保持空白并重试，不再带着半应用状态加载页面。`/health` 只在 renderer 配置完成且首个真实导航已经完成或失败后才报告 ready；重试耗尽会显示错误与重试按钮。
  - 运行中切机增加 renderer/main 双 generation：快速连续操作不再让旧调用重载页面；最新操作失败会恢复上一机型、UA 与完整 CDP 参数，恢复也失败才保持安全空白。MCP `set_device` 用 request id 精确关联，等对应 reload 停止后才返回；任何更新的切机操作都会在 renderer 立即淘汰仍在等待的旧 MCP 请求，新 MCP 请求还会在主进程先行淘汰上一请求，避免改 UA 提前终止旧 reload 时误报成功。慢页面与重叠命令均已加入 E2E。
  - 网络代理统一覆盖 default、guest、登录临时分区与 electron-updater；Passport/Open Platform 改走 Electron Session fetch；切换策略后关闭旧连接池，确保下一次请求立即生效。手动空地址不能落盘/伪装成系统代理；打开中的登录窗会热切换并刷新；一次应用会先等所有 Session settle，运行中部分失败再回滚全部 Session 与设置，避免迟到操作覆盖回滚，启动应用失败也不再阻断窗口。
  - DevTools 主题重开增加 generation/target/timer 取消，显式关闭后旧回调不会把面板复活；更新检查的并发自动/手动调用共享一次操作，手动意图不会被静默检查覆盖，已有可用版本或下载状态不会被新检查覆盖，下载连点也由同步状态锁挡住；不再覆盖 updater 对 rc 频道的自动识别。
  - 修复下拉菜单被工具条 overflow 裁切、PC 切换后 ResizeObserver 结果被旧尺寸覆盖、离开 PC 后排队回调反向覆盖新机型、隐藏/最小化窗口下 `requestAnimationFrame` 永不回调、StrictMode 重复永久监听、未登录租户仍可点击、无效 URL 写入历史、iPhone 15–17 沿用旧 iOS UA；PC 后台尺寸上报不再增加显式切机 generation 或抢走回执。
  - MCP stdio 桥对 SSE 中断、超时、空/非 JSON/未完成响应均只给尚未完成的请求返回一次 `-32000`，notification 保持静默；安装器不再把注释 TOML 当活动配置，并识别单双引号等价表头。
  - 下拉菜单经 Escape 或键盘选择后统一把焦点交回触发按钮；地址栏补齐 combobox/listbox 关联，设备与缩放项使用单选菜单语义。
- 界面按参考图改成微信开发者工具式深色高密度工作台：40px 顶部命令栏；左侧地址栏、设备画布、居中的设备/缩放控制与页面状态；右侧原生 DevTools 从顶栏下方铺满。保留本项目 H5 网页调试边界，没有引入小程序编译、编辑器、上传等越界模块；系统/浅色主题仍可从设置切换。
- 更新架构文档与 E2E：首屏同时断言 viewport、screen、DPR、touch；增加 PC 自适应 `inner === screen`；产出可合成的 shell/DevTools 同状态截图。

**验证**

- `pnpm format:check`：通过。
- `pnpm typecheck`：三个 tsconfig 全部通过。
- `pnpm test`：Vitest 7 文件 / 42 项通过；MCP Node Test 10/10 通过。
- `pnpm build`：main / preload / renderer 全部通过。
- `FDT_MCP_PORT=17431 pnpm e2e`：24 项全部 PASS，覆盖首次仿真、650ms 慢页面切机等待、重叠命令淘汰、1200ms PC 切机与 DevTools 并发、iOS/Android/PC、JSAPI、DevTools、主题、缓存与 stdio bridge；隔离 userData 由脚本清理。
- 最终压力复跑：重新构建后在 17441 / 17442 / 17443 连续三轮 E2E 均 24/24 PASS，第三轮启用 `NODE_OPTIONS=--unhandled-rejections=strict`；三轮均无运行期 ERROR 或未处理 rejection，端口与临时进程均已清理。
- 独立只读终审：首导航后立即切机精确复现 5/5 通过；1200ms PC 切机 + 250ms 后切换 DevTools 在约 1.28s 正确返回；本轮关注的代理、更新、attach 与隐藏窗口布局链路未发现剩余 P0/P1/P2。
- 独立运行时键盘复核：设备菜单 ArrowDown + Enter、缩放菜单 ArrowDown + Space 均实际切换并把 AX 焦点恢复到原触发按钮；本范围未发现剩余 P0/P1。
- 将用户参考图与最终 iPhone + DevTools 实机截图放入同一画布逐项对照：顶栏层级、左右分栏、设备画布、底部控制/状态、深色表面与分割线均达到当前视觉验收；最终合成截图在 `/tmp/fdt-e2e/final-current.png`，对照图在 `/tmp/fdt-design-compare-final.png`，均不入库。

**结论 / 遗留**

- 本地代码、构建、E2E 与当前视觉验收通过；没有提交、推送、打 tag 或发布。
- 待真实 UAT：飞书扫码登录、租户切换、`tt.config` / `requestAuthCode` / `requestAccess`、真实代理链路、更新下载、Developer ID 签名 / 公证 / Gatekeeper。
- Chromium DevTools 顶部语言提示条仍需用户点一次 “Don't show again”；909px 最小窗口只做了布局约束检查，未做鼠标拖拽实测。历史按钮直接按 ArrowDown 进入选项、真实账号退出后的焦点交接属于后续低优先级无障碍打磨，不阻塞本轮。

## 2026-09-04 — 验收前剩余壳层问题

**做了什么**（对照试用中仍会绊验收的细节，不重开 15/16/17 与 PC 改尺寸争论）

- 14 Pro+ 状态栏：原先所有刘海机都画成从上沿垂下来的舌形缺口；14 Pro 起改为居中胶囊（灵动岛），时间 / 信号垂直居中。13 及更早仍为刘海。水平内边距继续用 `statusBarInset()`。
- 登录后头像：工具条芯片选择器误伤了 `.dropdown > .tbtn`，头像被套上 28px 描边方钮；现在芯片只打在带文案的顶栏按钮上。
- 机身 1px 描边：`.gadget` 的 `overflow: hidden` 会裁掉外阴影，浅色下几乎看不见边；改为 `inset` 阴影。
- 机型下拉在 iPhone / Android / iPad / PC 之间加分隔线（目录变长后好扫）。
- PC 宽高 `input[type=number]` 去掉步进器（22×56 的格子里步进器会挤掉数字）。
- 顶栏过窄时允许横向滚动，避免图标+文案芯片把「登录」顶出窗口。
- 登录会话：`AccountService` 在 `app.ready` 前调 `safeStorage.decrypt`，macOS 抛错后走「本轮登出、保留文件」分支，每次启动都显示未登录。改为 `whenReady` 之后再 `restore()`。

**验证**：prettier 触及文件；`pnpm typecheck` 通过；`pnpm test` vitest 29 + MCP 4 通过。未跑 e2e（无 guest/MCP/导航契约变更）。已重启 `electron-vite preview`；`GET /health` 200，本轮日志无 `safeStorage cannot be used before app is ready`。

**遗留**：真机 UAT；PC 适应窗口时缩放下拉仍无视觉效果（与官方 `calc(100% - 40px)` 一致）；未提交。

## 2026-09-04 — 工具条图标 + 按钮轮廓

**做了什么**

- 预览 / 清缓存 / 模拟器 / 调试器：SVG 图标（QR / 垃圾桶 / 手机框 / 尖括号）+ 原有文案；`aria-hidden`。登录仍用 `UserIcon`，同一套 `.tbtn` 描边。
- `.tbtn` 在顶栏是 28px 描边芯片（`var(--border)` + 相对工具条略抬的填充）；hover/active/selected 仍走原 token。地址栏内部图标、模拟器工具条不套这层描边。

**验证**：`prettier --write` 触及文件（unchanged）；`pnpm typecheck` 通过；`pnpm test` vitest 27 + MCP 4 通过。未跑 e2e。已重启 `electron-vite preview`（MCP 17331）便于验收。

**遗留**：待窗口里看一眼深/浅色；机型 15/16/17 与 PC 改尺寸不是本条。

## 2026-09-04 — 状态栏安全区 / 15–17 机型 / PC 可改尺寸

**做了什么**

- 刘海机型状态栏左右 14px 贴在 47–62px 圆角上：`statusBarInset()` = `max(20, radius×0.48)`（14 Pro ≈ 26）。圆角仍按状态栏高度估（与真机显示圆角接近），所以圆角和间距是联动的。
- 官方目录停在 iPhone 14：补 15/15 Pro、15 Plus/Max、16、16 Plus、16 Pro/17/17 Pro、16 Pro Max/17 Pro Max、Air。
- PC：官方是 `calc(100% - 40px)` 随列宽，不是不能改；现在工具条可输入宽高写入 `settings.pcViewport`，「适应窗口」清空后回到随窗口。`ResizeObserver` 把实测尺寸交给 CDP。

**验证**：prettier / typecheck / vitest 27 + MCP 4。未跑 e2e。官网文案已改。

**遗留**：真机 UAT；PC 无拖拽把手（数字输入）。

## 2026-09-04 — 壳层 UI 细节打磨（官方 token，不改产品气质）

**做了什么**（对照官方 §2.2 色板 + UI/UX Pro Max：焦点、按压、对比、键盘、icon 语义；不采用 OLED/文档站那套无关推荐）

- Token：次级文字对比提到约 4.5:1；浅色遮罩 0.45；按压色 `--bg-active` / `--accent-press`；`--ease/--dur`。
- 控件：`:focus-visible` 2px 飞书蓝；hover/active 不位移；禁用「模拟器」按钮不再发灰；地址栏浅色下有描边；机型菜单可滚动 + 勾选标记（不只靠颜色）；历史空态文案；登录中小 spinner 替代「…」。
- 弹窗：焦点陷阱、Escape/点遮罩关闭；授权弹窗关闭 = 拒绝；关闭钮改 SVG；关于/更新图标不再二次圆角裁 squircle。
- 下拉：方向键/Home/End；`aria-expanded` / `role="menu"`；设置分段控件 `radiogroup`；预览 tab + 二维码加载。
- `prefers-reduced-motion`；toast `role="status"`。

**验证**

- `prettier --write` 触及文件；`pnpm typecheck` 通过；`pnpm test` 26 + 4 通过。
- 未跑 e2e（纯壳层视觉/a11y，无 IPC/MCP 契约变更）。待用户在已开窗口里过一遍。

**结论 / 遗留**

- 壳层交互更齐，视觉仍是官方深色工具条。待验收；未提交。

## 2026-09-04 — v0.1.0 第二批抛光（更新 UI / MCP npm / 官网 / 深色机身 / 地址栏；待验收后再发布）

**做了什么**（承接试用反馈修复；同版本号 0.1.0，未重新发 Release）

- **检查更新对话框**：Sparkle 风格（图标、版本行、Release 说明经 `sanitizeReleaseNotes` 白名单清洗、「自动检查」；按钮「跳过 / 稍后 / 安装」；`skippedUpdateVersion` + `update:skip`；静默检查尊重跳过，手动检查仍报告；离线 `error` 不自动弹窗）。dev 可用 `FDT_UPDATE_FEED`。
- **afterPack ad-hoc 签名**：`scripts/after-pack.mjs`，无 `CSC_LINK`/`CSC_NAME` 时对 `.app` 做 `codesign --force --deep --sign -`，避免 Gatekeeper「已损坏」。
- **npm stdio 桥**：`packages/feishu-devtools-mcp` + `.github/workflows/npm-mcp.yml`；`install` 写入 cursor / claude-code / claude-desktop / codex；应用未运行时自动拉起并等 `/health`。
- **官网 + README 重写**：跟随系统外观、真实截图（hero / simulator / DevTools）、MCP 与 npm 桥说明、Gatekeeper FAQ；MCP 工具表与 `src/main/mcp.ts` 共 18 个工具对齐。
- **导航竞态**：`pendingUrl` / `flushPendingUrl`；`Simulator.tsx#attachGuest` 失败后重试，避免 MCP `navigate` 早于 webview attach 被吞。
- **深色模拟器机身**：`--sim-*` 色板跟随主题；网页内容配色不变，无背景页仍在白色画布上（对齐官方 `#iframeContainer webview`）。
- **地址栏**：输入框固定 320px（官方 `.urlbox .select`），整体约 386px，不再随窗口拉伸。
- **图标 squircle / 窗口按机型撑开**：已在上一批落地。
- **文档收尾**：`CHANGELOG.md` 补深色机身与地址栏两条；`docs/ARCHITECTURE.md` 此前已含 updater / pendingUrl / stdio / afterPack / website。工作树 `git add -A` 对齐 index，确认无 `__nav` 调试残留。

**验证**（本会话收尾复跑；打包验证沿用既有 `dist/`）

- `git add -A` 后 `rg "__nav|dbg.push"`：`src/` 无匹配；`simulator.ts` 仅 `pendingUrl` / `flushPendingUrl`。
- `prettier --write`（CHANGELOG / progress）+ `prettier --check .` → 通过。
- `pnpm typecheck`（tsc ×3）→ 通过。
- `pnpm test`：vitest 26 用例 + `feishu-devtools-mcp` node --test 4 用例 → 全部通过。
- `pnpm build`（electron-vite）→ 通过。
- `node scripts/e2e.mjs`：19 项 PASS（含 fresh iPhone 13 + debugger、首屏 emulation、stdio bridge tools/list = 18）。
- 既有 `dist/mac-arm64/FeishuDevTools.app`：`codesign --verify --deep --strict` 通过（adhoc，`com.feishudevtools.app`）；本会话未重打包。

**结论**

- 第二批抛光与文档已齐；未提交、未推送、未改 tag（仍为 0.1.0）、未发 Release。工作树可供用户验收后再决定同版本号重新打包发布。

**遗留 / 待 UAT**

- 真实飞书扫码登录、租户切换、`tt.config` / `requestAuthCode` / `requestAccess` 鉴权、PC 预览推送。
- Developer ID 签名与 Apple 公证；干净机器 Gatekeeper「仍要打开」流程。
- 用户验收通过后再重新发布 0.1.0 产物；`feishu-devtools-mcp` 需 `NPM_TOKEN` 随发布；官网改动需合并 `main` 后由 `pages.yml` 部署。

## 2026-09-04 — v0.1.0 试用反馈修复（同版本号重新打包，待验收后再发布）

**做了什么**（对应用户反馈 1–10）

1. **图标偏小/留白**：`scripts/make-icons.mjs` 先 `trim()` 掉素材四周透明边距，再铺满画布；重新生成 `build/icon.icns|png`、`resources/icon*.png`、`src/renderer/src/assets/icon.png`（关于弹窗）、`website/public/*`。`iconutil` 在沙箱里报 Invalid Iconset，需在沙箱外执行。按 macOS 网格 824/1024 铺满和改成 90% 两版用户都说"还是小"——用 Swift 调 `NSWorkspace.icon(forFile:)` 渲染打包后的 .app 才看清根因：**macOS 26 会拿旧式 .icns 的 alpha 形状对照系统 squircle 网格，形状不符（我们的卡片圆角比 Apple 的圆得多）就缩小放进一块灰色系统底板**，所以填多少画布都没用。第三版把卡片渲染*进*精确的 squircle：`squirclePath()`（figma-squircle 算法，半径 22.37%、平滑 0.6）做 1024 画布上 824 的蒙版，卡片放大 5% 让自身圆角落在蒙版外、底下垫卡片边框均值色，再 `dest-in` 裁切。IconServices 实渲染：无灰底板、尺寸与官方图标一致（`/tmp/fdt-probe/sys/final-compare.png`）。
    **默认窗口盖不住模拟器**（追加反馈）：旧默认 1180×845 放不下 iPhone 13@100%（需要 82+28+20×2+844 = 994）。`window.ts#sizeForDevice()` 按机型 + 缩放算尺寸并裁到工作区，首次启动用它当默认；`fitWindowToDevice(device, zoom)` 改成"只增不减"地撑到能完整露出机身（宽度同时满足官方 `deviceWidth+557` 最小宽度），启动恢复旧 bounds 后也跑一次，`zoom` 变化经 `settings.on('change')` 触发；PC 机型不撑高。
2. （用户第 2 条为空图，未处理。）
3. **默认机型不是 iPhone 13**：根因是 `scripts/e2e.mjs` / `--smoke-test` 一直写真实 `settings.json`（上次 e2e 结束在 Nexus 5）。新增 `FDT_USER_DATA` 环境变量（`main/index.ts` 在实例锁之前 `setPath('userData'|'sessionData')`），e2e 每次用 `mkdtemp` 临时目录并在结束时删除。**机身圆角**：`shared/devices.ts#deviceCornerRadius()`（带刘海机型 = 状态栏高度，iPad Pro 18，其它移动机型 12，PC 8），`Simulator.tsx` 套到 `.gadget`。
4. **调试器默认打开**：`DEFAULT_SETTINGS.showDevTools = true`。
5. **选择元素不可用 / "DevTools 连接"**：实测（CDP 抓前端↔后端协议）移动机型开着 `Emulation.setTouchEmulationEnabled` 时 hover 完全不产生 `Overlay.nodeHighlightRequested`，关掉触摸模拟后 hover 高亮、点击 `inspectNodeRequested` 正常。方案：`main/devtools-frontend.ts` 向 DevTools 前端注入 `INSPECT_HOOK_JS`（包 `InspectorFrontendHost.sendMessageToBackend`，见到 `Overlay.setInspectMode` 就 `console.info('[fdt] inspect:on|off')`），`devtools-dock.ts` 在前端 `console-message` 识别并 emit `inspect-mode`，`index.ts` 接到 `guestManager.setInspecting()` 暂停/恢复触摸模拟（`applyEmulation(scope:'touch')`）。DevTools 关闭时也恢复。"连接"本身经首启动、关开、reload、从加载失败页导航四种场景核对 Elements 树均正常（此前看到的空面板是前端冷启动 4–6 s 内截图太早）。
6. **DevTools 深色与应用不一致**：`THEME_CSS` 通过 `insertCSS` 覆盖 `--sys-color-cdt-base-container / surface / base / divider / --color-background*` 等 token 为 app.css 深色配色；浅色不动。
7. **登录层级低于 DevTools**：原生 `WebContentsView` 永远盖住 DOM。新增 `guest:snapshotDevTools`（IPC 三处同步）与 `useApp.devtoolsCovers` 计数 + `useCoversDevTools(open, ref)` 钩子（`Dropdown`/`UrlBar` 历史）；`DevToolsPane` 在弹层或 modal 打开时先把 `capturePage()` 的 PNG 画进占位 div，再隐藏 view，关闭后恢复并延迟 400 ms 清掉底图。登录窗口本身是 `parent` 子窗口，本来就在上面。
8. **点登录还要点二级按钮**：`AccountMenu` 未登录时只渲染一个「登录」按钮直接触发 `account:login`；已登录/过期才是头像 + 下拉（过期头像半透明、菜单里给「登录」）。`login()` 进行中再点只聚焦登录窗口。
9. **扫码后仍未登录**：日志 `Cannot read properties of undefined (reading 'id')`——passport 响应是 `{code, message, data}` 信封，原来当裸对象读。抽出 `main/passport.ts`（`unwrapPassport`、`toUserEntries`、`brandMatchesEnv`、`parseSessionCookies`、`SessionExpiredError`），`loadAccount()` 三个接口都走信封解析，`code 34/4401/4` 与 HTTP 401 一样视为过期；`switchTenant` 改用目标身份的 `user_id + credential_id` 并从 `Set-Cookie` 取新 cookie；取消重新登录不再清掉有效会话。日志不再打印用户名。
10. **复查其它 bug**（子代理只读走查 + 人工确认，修掉的）：
    - **首屏没有设备仿真**：`Simulator.tsx` 原来在 `dom-ready` 才 `guest:attach`/`guest:setDevice`，第一页的脚本跑在默认 DPR/无触摸下，且 attach 之前的 console 全丢。现在主进程在 `did-attach-webview`（早于 `<webview>` 发起 `src` 导航）就 `guestManager.attach()`，启动时用持久化的 `deviceId` `presetDevice()`；`viewport` 不再可能为 0×0；三条 Emulation 命令并发下发。渲染层 `did-attach`/`dom-ready` 的 attach 变成幂等兜底。
    - **离线启动弹「检查更新失败」**：`update:state` 只在 `available`/`downloaded` 时自动弹窗，`error` 留给用户从菜单打开时看；consent 弹窗期间不抢。
    - **更新说明 `dangerouslySetInnerHTML`**：改为扁平化成文本渲染（`htmlToText`）。
    - **切换租户状态漂移 / 静默失败**：`switchTenant` 先用新 cookie `loadAccount` 成功再一起替换 `secrets` + 状态；登录（非用户取消）/切换失败在模拟器列顶部 toast 提示（`toolbar.loginFailed` / `toolbar.switchTenantFailed`）。过期状态下取消重新登录保留头像；解密失败不再删 `account.json`。
    - **toast 被 DevTools 盖住**：`appToast` 从窗口居中改到 `.simulatorColumn` 内绝对定位（调试器默认打开后窗口中心就在 DevTools 下面）；toast 状态挪进 `useApp.showToast()`。
    - **`settings.json` 一个字段坏了全部重置**：`JsonStore.read()` 只剔除报错的顶层 key（`tests/store.test.ts` 6 个用例）。
    - **DevTools 每次开关多挂一个 guest 监听器**：`devtools-dock.ts` 记录 handler 并在 `close()` 里 `off`。
    - **JSAPI 弹窗在换页时挂起**：`resetPage()` 先 resolve 未决的 dialog/actionSheet；主框架 `did-navigate` 统一 `resetPage()`（链接点击、重定向也会清掉上一页的 preloader/toast/closed）。
    - 语言切换后 UA 的 `LarkLocale` 不更新（`useragent` 属性首航后失效）→ `setUserAgent`，下次加载生效；设置里经纬度只填一项时不再把空值当 0 写入；主题切换同步 `win.setBackgroundColor`。
    - `SettingsStore.patchWritable()` 原来只在类型上限制白名单，运行时任何 key 都能写；现在按 `WritableSettingKeys` 过滤（`urlHistory`/`windowBounds` 等只能由主进程写）。`useT()` 返回值按语言 `useCallback`，否则 `App` 里依赖 `t` 的 `shell:command` 订阅每次渲染都重挂。
    - **未修、记录在案**：代理设置未作用于登录窗口分区与 passport/开放平台请求（Node `fetch` 不走 Electron 代理）；PC 机型下缩放下拉仍可选但无效果；`init()` 在 StrictMode 下重复注册监听（仅 dev）；无效 URL 仍写入历史。

**验证**

- `prettier --check` / `tsc ×3` / `vitest`（26 用例，新增 `tests/passport.test.ts` 8 个、`tests/store.test.ts` 7 个）/ `electron-vite build` / `scripts/e2e.mjs`（16 项 PASS，新增「fresh profile defaults: iPhone 13 + debugger docked」与「first page load already emulated and its console captured」，后者靠预置 `settings.json.lastUrl` 指向测试页）。
- 临时脚本（`/tmp/fdt-probe/*.mjs`，未入库）用 `--remote-debugging-port` 连 DevTools 前端与 guest 两个 target 实测：进入选择模式 `navigator.maxTouchPoints` 5→0，hover 有 `Overlay.nodeHighlightRequested`，点击 `inspectNodeRequested` 且 Elements 选中 `<div id="b">`，选完/手动关闭/关掉 DevTools 三种路径都恢复为 5；主题 token 计算值 `#1f2329`；历史弹层打开时 `devtools.visible=false` 且占位 div 有 PNG 底图，关闭后恢复；首屏脚本读到 `innerWidth 390 / dpr 3`（本地零延迟服务器下 `maxTouchPoints` 偶有一次读到 0，30 ms 延迟即稳定 5——触摸标志经 WebPreferences 异步下发，真实网络页面不受影响）；清缓存 toast 显示在模拟器列内；窗口尺寸（CDP 读 shell 的 `innerHeight` 与 `.simulatorContent` 溢出）：新配置 1180×994 无溢出、缩放 125% → 1205、存了 845 高的旧配置启动后 994、PC 不变、iPad Pro → 1581×工作区高并滚动。合成截图（窗口 + DevTools）深/浅各一张人工核对。
- 未跑：真实飞书扫码登录（本机 shell 无法直连外网，且需要用户账号）、Gatekeeper 首次安装。

**结论**

- 10 条反馈中 1、3–9 已修并验证；2 为空；10 的复查修掉 12 处、记录 4 处。未提交、未打 tag、未发布，等用户验收。

**遗留**

- 真实账号 UAT：扫码登录 → 头像/租户列表 → 切换租户 → `tt.config`，仍待用户跑一遍。
- DevTools 顶部「DevTools is now available in Chinese」信息条仍需用户点一次「Don't show again」。

## 2026-09-04 — 阶段 7：v0.1.0 文档、本机打包、打 tag

**做了什么**

- 新建 [`CHANGELOG.md`](../CHANGELOG.md)；README 补产品截图（`website/public/hero-dark.webp`）、状态改为 v0.1.0 已发布并写明已知限制。
- 官网缩放文案 50%–200% → 50%–150%（与 `ZOOM_LEVELS` 一致）。
- `electron-builder.yml` `minimumSystemVersion` 12.0 → 13.0（Electron 44 要求 Ventura）；README / 实施计划硬约束同步。
- 仓库此前已推到 GitHub：CI 与 Pages 在 `main` 均 success；官网 https://ihopefulchina.github.io/FeishuDevTools/ 可访问。
- 本机 `pnpm dist:unsigned`：`dist/FeishuDevTools-0.1.0-arm64.dmg`（105 MB）与 `.zip`（113 MB）；`Info.plist` 版本 0.1.0、最低系统 13.0。
- 打 annotated tag `v0.1.0` 并推送。
- 第一次 Release 失败：空 `CSC_LINK` 被当成证书路径 → `not a file`。已 `unset` 空变量。
- 第二次 Release 打包成功，但 dmg 与 zip 并行 `POST /releases`，后到的请求 422 `tag_name already_exists`。已改为 `--publish never` + `softprops/action-gh-release`。
- 本机未签名产物已上传到 GitHub Release：`FeishuDevTools-0.1.0-arm64.dmg`（105 MB）、`.zip`（113 MB）、`latest-mac.yml`、两份 blockmap。

**验证**

- `pnpm format:check` / `pnpm typecheck` / `pnpm test`（11 用例）/ `pnpm build` / `pnpm e2e`（14 项全部 PASS）。
- 打包应用 `--smoke-test` 退出码 0，窗口截图有工具栏与模拟器机身（未入库）。因 userData 里上次 e2e 留下的 `lastUrl` 已失效，guest 落到 `about:blank`，不影响启动结论。
- 未跑：Lighthouse；真实飞书登录 / JSAPI 鉴权 / PC 预览；签名与公证；干净机器首次安装。

**结论**

- v0.1.0 已发布：https://github.com/ihopefulChina/FeishuDevTools/releases/tag/v0.1.0 。官网下载按钮会指向最新 arm64 dmg。包未签名。

**遗留**

- 阶段 5（真实飞书 UAT）、阶段 6（签名 / 公证 / 自动更新 UAT）仍待用户账号与 Apple 开发者证书。
- `gh` 钥匙串 token 已失效；本次推送走 SSH。
- 干净 Apple Silicon Mac 上的首次安装 Gatekeeper 流程待人工走一遍。

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
- 仓库已公开，CI 与 Pages 已跑通（见同日阶段 7 条目）。

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

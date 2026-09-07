# AGENTS

## 开工前

1. 读 `docs/IMPLEMENTATION_PLAN.md`（目标、边界、阶段与验收标准）、`docs/ARCHITECTURE.md`（模块与数据流）、`docs/progress.md`（最新状态与已知问题）。官方工具的行为依据在 `docs/RESEARCH_OFFICIAL_TOOL.md`。
2. 只做当前阶段验收标准要求的最小完整改动；不重构无关代码，不提前做后续阶段。
3. 结束时在 `docs/progress.md` 追加一条：做了什么、跑了哪些验证、结论、遗留。

## 项目边界（不可越过）

- 目标是复刻官方「网页调试」模块；发布目标为 macOS arm64/x64、Windows x64 与 Linux x64；不做小程序/网关/工作台等其它模块。
- 真实飞书登录、真实 JSAPI 鉴权（`config`/`requestAuthCode`/`requestAccess`）。禁止伪造登录态或伪造 open-apis 响应；只有 `src/shared/jsapi-mocks.ts` 中与官方工具一致的固定值算合法 mock。
- `<webview>` 必须保持 `contextIsolation=true, sandbox=true, nodeIntegration=false`；JSAPI 桥只能在 `src/preload/guest.ts` 注入。
- 新增 IPC 必须同时更新 `src/shared/ipc.ts`、`src/preload/shell.ts` 白名单、`src/main/ipc.ts`；新增 MCP 工具必须更新 README 表格与 `scripts/e2e.mjs`。
- MCP 只监听 `127.0.0.1`。
- 先复用现有实现；未经当前阶段需要，不新增依赖、不改公共契约、不升级 Electron 主版本。

## 验证

- 先跑最窄的相关验证，提交前跑全套：`pnpm format:check && pnpm typecheck && pnpm test && pnpm build && pnpm e2e`。
- E2E 需要本机有显示器；截图输出在 `/tmp/larto-e2e/`，不要提交。
- 静态检查/单平台构建通过 ≠ 跨平台原生启动、真实飞书 UAT、签名或发布通过；未做过的项在文档里明确写「待 UAT」。
- 报告时列出：已运行的检查、结果、未运行项。

## 版本控制

- 保留用户现有改动；禁止 `git reset --hard`、`git clean`、覆盖式 checkout、force push。
- 除非任务明确要求，不提交、不推送、不建 PR、不打 tag、不发 Release。要求推送时只包含当前阶段的范围。
- 不提交密钥、token、Cookie、账号/租户数据、签名证书、含个人或租户信息的截图。`account.json`、`settings.json`、日志都在 userData，不在仓库。

## 参考与禁区

- `/Applications/飞书开发者工具.app` 是只读参考，用于比对界面与行为；不要复制其代码或资源到仓库。
- 相邻目录 `../FeiDev`（如存在）是废弃的历史原型，只作对照，不迁移代码。

## CodeGraph

只有仓库根目录存在 `.codegraph/` 时才先使用 CodeGraph；不存在则使用 `rg`/`rg --files`，不要自行建立索引。

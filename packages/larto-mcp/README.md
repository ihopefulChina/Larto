# larto-mcp

Cross-platform stdio bridge for the MCP server built into [Larto](https://ihopefulchina.github.io/Larto/), the Feishu / Lark H5 debugger for macOS, Windows and Linux.

Larto serves MCP over Streamable HTTP at `http://127.0.0.1:17331/mcp`. Clients that speak HTTP (Cursor, Claude Code, Codex) can use that URL directly. This package is for everything else, and for convenience:

- **stdio transport** — Claude Desktop and other stdio-only clients get the same tools.
- **One-command setup** — `npx --yes larto-mcp@latest install <client>` writes the client config.
- **On-demand launch** — an actual tool call starts the app if needed and waits until the simulator is ready. Starting the bridge or discovering its tools does not open the app.

Requires Node.js 20 or newer and Larto installed on a supported desktop platform: macOS arm64 / x64, Windows x64 or Linux x64 ([download](https://github.com/ihopefulChina/Larto/releases/latest)).

The tagged `0.1.3` release workflow publishes this package alongside the desktop app. If the npm
registry has not finished publishing or propagating a new release, use the app's local HTTP endpoint
until the package is visible; do not install an identically named package from another source.

## Install into a client

```bash
npx --yes larto-mcp@0.1.3 install cursor          # add --project for ./.cursor/mcp.json
npx --yes larto-mcp@0.1.3 install claude-code
npx --yes larto-mcp@0.1.3 install claude-desktop  # writes the native config path for this OS
npx --yes larto-mcp@0.1.3 install codex
```

Each of these registers a server named `larto` that runs `npx --yes larto-mcp@latest`. To see the entry without writing it:

```bash
npx --yes larto-mcp@latest print
```

```json
{
  "mcpServers": {
    "larto": {
      "command": "npx",
      "args": ["--yes", "larto-mcp@latest"]
    }
  }
}
```

If you changed the MCP port in Larto → Settings, pass `--port <n>` to `install`; it is forwarded to the bridge.

## Options

```
larto-mcp [--port <n>] [--no-launch]     run as an MCP stdio server
larto-mcp install <client> [--project] [--port <n>]
larto-mcp print [--port <n>]
```

`--no-launch` never starts the app. Initialization and tool discovery still work; a tool call fails fast if the app is unavailable. `LARTO_MCP_PORT` is honoured as a default for `--port`.
`--project` selects project scope for Cursor or Claude Code; other clients reject that option
instead of silently writing a user-level configuration.

## Tools

The bridge includes a local tool catalog for Larto 0.1.3: `get_state`, `navigate`, `reload`, `list_devices`, `set_device`, `set_zoom`, `set_theme`, `toggle_devtools`, `clear_cache`, `screenshot`, `evaluate`, `get_dom`, `click`, `fill`, `get_console`, `clear_console`, `get_jsapi_log` and `focus_window`. The catalog is checked against the desktop app's tool contract by automated tests, so discovery works without starting the app. See the [project README](https://github.com/ihopefulChina/Larto#mcp) for details.

## How it works

The bridge answers `initialize`, `ping`, and `tools/list` locally. These requests and bridge startup never launch the desktop app. Only an actual `tools/call` checks the app and starts it if needed, unless `--no-launch` is set. The call is then POSTed to `/mcp`; the SSE (or JSON) response is written back to stdout one message per line. The app's server is stateless, and the bridge stores no tool results. All diagnostics go to stderr.

This behavior requires `larto-mcp` 0.1.3 or newer. Updating the desktop app alone does not update an older bridge: update pinned package versions and configurations that run an old local script as well.

The bridge connects only to `127.0.0.1`, stores no Feishu credentials and never exposes the MCP
endpoint to the LAN. Set `LARTO_PATH` when using a portable archive or a non-default
install location that cannot be discovered automatically.

MIT License.

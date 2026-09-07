# larto-mcp

Cross-platform stdio bridge for the MCP server built into [Larto](https://ihopefulchina.github.io/Larto/), the Feishu / Lark H5 debugger for macOS, Windows and Linux.

Larto serves MCP over Streamable HTTP at `http://127.0.0.1:17331/mcp`. Clients that speak HTTP (Cursor, Claude Code, Codex) can use that URL directly. This package is for everything else, and for convenience:

- **stdio transport** — Claude Desktop and other stdio-only clients get the same tools.
- **One-command setup** — `npx --yes larto-mcp@latest install <client>` writes the client config.
- **Auto-launch** — if the app is not running, the bridge starts it and waits until the simulator is ready, so an agent can open the tool by itself.

Requires Node.js 20 or newer and Larto installed on a supported desktop platform: macOS arm64 / x64, Windows x64 or Linux x64 ([download](https://github.com/ihopefulChina/Larto/releases/latest)).

The tagged `0.1.1` release workflow publishes this package alongside the desktop app. If the npm
registry has not finished publishing or propagating a new release, use the app's local HTTP endpoint
until the package is visible; do not install an identically named package from another source.

## Install into a client

```bash
npx --yes larto-mcp@0.1.1 install cursor          # add --project for ./.cursor/mcp.json
npx --yes larto-mcp@0.1.1 install claude-code
npx --yes larto-mcp@0.1.1 install claude-desktop  # writes the native config path for this OS
npx --yes larto-mcp@0.1.1 install codex
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

`--no-launch` makes the bridge fail fast instead of starting the app. `LARTO_MCP_PORT` is honoured as a default for `--port`.
`--project` selects project scope for Cursor or Claude Code; other clients reject that option
instead of silently writing a user-level configuration.

## Tools

The bridge exposes whatever the running app provides; with Larto 0.1.1 that is `get_state`, `navigate`, `reload`, `list_devices`, `set_device`, `set_zoom`, `set_theme`, `toggle_devtools`, `clear_cache`, `screenshot`, `evaluate`, `get_dom`, `click`, `fill`, `get_console`, `clear_console`, `get_jsapi_log` and `focus_window`. See the [project README](https://github.com/ihopefulChina/Larto#mcp) for details.

## How it works

Every JSON-RPC message from stdin is POSTed to `/mcp`; the SSE (or JSON) response is written back to stdout one message per line. The app's server is stateless, so concurrent requests are fine and nothing is cached in the bridge. All diagnostics go to stderr.

The bridge connects only to `127.0.0.1`, stores no Feishu credentials and never exposes the MCP
endpoint to the LAN. Set `LARTO_PATH` when using a portable archive or a non-default
install location that cannot be discovered automatically.

MIT License.

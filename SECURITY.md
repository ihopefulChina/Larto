# Security Policy

Larto is a pre-1.0 community project that handles authenticated Feishu/Lark sessions and
can execute debugging actions inside the page currently loaded in its simulator. Please read the
boundaries below before using it with a real account.

## Supported versions

| Version | Security updates |
| --- | --- |
| 0.1.1 | Supported |
| 0.1.0 and earlier | Not supported; upgrade to the latest release |

## Report a vulnerability

Use [GitHub Private Vulnerability Reporting](https://github.com/ihopefulChina/Larto/security/advisories/new).
Please include the affected version and operating system, impact, minimal reproduction steps, and
any mitigation you have already tested.

Do not open a public issue for an undisclosed vulnerability. Do not include account cookies,
tokens, tenant data, QR codes, or other credentials in the report or its attachments. We will
coordinate disclosure after the issue has been reproduced and a fix is available.

## Security boundaries

- The simulated page runs with `contextIsolation=true`, `sandbox=true`, and
  `nodeIntegration=false`. The JSAPI bridge is injected only by the guest preload.
- The privileged shell accepts navigation only to its exact packaged entry (or the configured
  development origin). Main-process IPC additionally requires the main window's main frame and a
  trusted shell URL; another `file:` page cannot reuse the shell preload as an IPC authority.
- Sensitive guest permissions are confirmed per web origin for the current process. JSAPI
  clipboard reads and writes use the same main-process policy and derive the origin from the
  active guest rather than trusting a page-supplied URL. The temporary passport partition denies
  all web permissions.
- Authentication and protected JSAPI calls use real Feishu/Lark endpoints. The application does
  not manufacture login state or successful Open Platform responses.
- Account sessions are encrypted with Electron `safeStorage` only where the operating system
  provides a protected backend. On Linux, `basic_text`, `unknown`, and unavailable keyring backends
  are treated as insecure: new session cookies are not written to disk and remain valid only in the
  current application process.
- The Linux AppImage desktop entry is verified not to include `--no-sandbox`, and the application
  exits when that option, Electron's effective switch, or the `ELECTRON_DISABLE_SANDBOX`
  environment variable is detected at runtime. If Chromium sandbox support is unavailable, fix
  the system's user-namespace configuration or use another package format; do not bypass it.
- MCP listens only on `127.0.0.1`. It intentionally has no separate authentication layer and can
  navigate, inspect, and evaluate code in the current guest page. Any process running as the same
  local user may be able to call it; disable MCP in Settings when it is not needed and do not
  forward its port.
- Version 0.1.1 is an early release: the `.app` inside each macOS DMG/ZIP is ad-hoc signed and not
  notarized, while the download containers have no Developer ID signature. Windows and Linux
  artifacts are unsigned. This is disclosed in the README, website, and Release.
- Automated tests and packaged smoke checks do not establish real-account UAT, tenant-specific
  JSAPI validation, native installation coverage, notarization, or commercial code signing.

## Verify a release

Download artifacts only from this repository's
[GitHub Releases](https://github.com/ihopefulChina/Larto/releases). The 0.1.1 release
workflow is configured to publish `SHA256SUMS.txt` and GitHub artifact attestations. Before trusting
a download, confirm that the workflow succeeded, the checksum file is present, and attestation
verification succeeds.

```bash
sha256sum Larto-0.1.1-linux-x64.AppImage
gh attestation verify Larto-0.1.1-mac-arm64.dmg \
  --repo ihopefulChina/Larto
```

Compare the first command's output with the same filename in `SHA256SUMS.txt`. The manifest lists
every platform asset, so checking the whole manifest with `-c` requires downloading every listed
file. On macOS, use `shasum -a 256 <downloaded-file>` when `sha256sum` is unavailable.

/**
 * Snippets injected into the docked DevTools frontend (a devtools:// page we own).
 * Nothing here talks to the inspected guest; it only re-skins the frontend and reports
 * inspect-mode toggles back to the main process through console messages.
 */

/** Marker printed by the frontend hook; matched by DevToolsDock. */
export const INSPECT_MARK = '[fdt] inspect:'

/**
 * Wraps `InspectorFrontendHost.sendMessageToBackend` so we learn when the user enters or leaves
 * "select an element" mode (`Overlay.setInspectMode`). There is no frontend API for this and the
 * frontend has no preload, so a tagged console message is the channel back to the main process.
 */
export const INSPECT_HOOK_JS = `(() => {
  const host = globalThis.InspectorFrontendHost;
  if (!host || globalThis.__fdtInspectHook) return;
  globalThis.__fdtInspectHook = true;
  const send = host.sendMessageToBackend;
  host.sendMessageToBackend = function (message) {
    try {
      const { method, params } = JSON.parse(message);
      if (method === 'Overlay.setInspectMode')
        console.info(${JSON.stringify(INSPECT_MARK)} + (params && params.mode !== 'none' ? 'on' : 'off'));
    } catch {}
    return send.call(this, message);
  };
})();`

/**
 * Dark-theme overrides so the docked DevTools uses the shell's palette (app.css dark tokens:
 * window #1f2329, panel #2b2f36, toolbar #373c43, hover #51565d) instead of Chromium's neutral
 * greys. Only surface/divider tokens are remapped; syntax and semantic colours stay stock.
 * Light theme is left untouched (Chromium's white already matches the shell).
 */
export const THEME_CSS = `
:root.theme-with-dark-background {
  --sys-color-cdt-base-container: #1f2329 !important;
  --sys-color-base-container: #1f2329 !important;
  --sys-color-omnibox-container: #1f2329 !important;
  --sys-color-surface: #1f2329 !important;
  --sys-color-inverse-on-surface: #1f2329 !important;
  --sys-color-cdt-base: #2b2f36 !important;
  --sys-color-base: #2b2f36 !important;
  --sys-color-base-container-elevated: #2b2f36 !important;
  --sys-color-surface1: #262a31 !important;
  --sys-color-surface2: #2b2f36 !important;
  --sys-color-surface3: #30353c !important;
  --sys-color-surface4: #343941 !important;
  --sys-color-surface5: #373c43 !important;
  --sys-color-neutral-container: #373c43 !important;
  --sys-color-header-container: #373c43 !important;
  --sys-color-surface-variant: #51565d !important;
  --sys-color-divider: rgba(255, 255, 255, 0.16) !important;
  --sys-color-divider-on-tonal-container: rgba(255, 255, 255, 0.16) !important;
  --sys-color-on-base-divider: rgba(255, 255, 255, 0.16) !important;
  --sys-color-divider-prominent: rgba(255, 255, 255, 0.28) !important;
  --sys-color-neutral-outline: #646a73 !important;
  --sys-color-state-hover-dim-blend-protection: rgba(31, 35, 41, 0.1) !important;
  --sys-color-state-hover-bright-blend-protection: rgba(31, 35, 41, 0.16) !important;
  --color-background: #1f2329 !important;
  --color-background-opacity-50: rgba(31, 35, 41, 0.5) !important;
  --color-background-opacity-80: rgba(31, 35, 41, 0.8) !important;
  --color-background-elevation-1: #2b2f36 !important;
  --color-background-elevation-2: #373c43 !important;
  --color-background-elevation-dark-only: #2b2f36 !important;
}
`
